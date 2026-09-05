/**
 * The client half of the wire protocol.
 *
 * Replaces socket.io-client with roughly a hundred lines: request/acknowledge,
 * events, and reconnection with backoff. Cloudflare Workers speak plain
 * WebSockets, and this is all the game ever needed from a socket library.
 */

import {
  buildConnectQuery,
  isAck,
  parseWire,
  type ConnectParams,
  type RoomError,
  type WireInbound,
  type WireRequest,
} from '@trivia/shared';

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

export type Ack<T> = { ok: true; data: T } | { ok: false; error: RoomError };

type EventHandler = (data: unknown) => void;

const REQUEST_TIMEOUT_MS = 9000;
const MAX_ATTEMPTS = 6;

/**
 * Where the backend lives.
 *
 * Empty means same origin, which is correct for local development and for the
 * deployed Worker (which serves the client too). Set VITE_SERVER_URL only if
 * you host the frontend somewhere other than the Worker.
 */
const SERVER_URL = (import.meta.env.VITE_SERVER_URL ?? '').trim();

function socketUrl(path: string, params: ConnectParams): string {
  const base = SERVER_URL || window.location.origin;
  const url = new URL(path, base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.search = buildConnectQuery(params);
  return url.toString();
}

export interface ConnectionOptions {
  path: string;
  params: ConnectParams;
  onStatus?: (status: ConnectionStatus) => void;
  /** Called after every successful (re)connect, for re-sending intent. */
  onOpen?: () => void;
}

export class GameConnection {
  private socket: WebSocket | null = null;
  private status: ConnectionStatus = 'idle';
  private nextId = 1;
  private attempts = 0;
  private closedByUs = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly pending = new Map<
    number,
    { resolve: (value: Ack<never>) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private readonly handlers = new Map<string, Set<EventHandler>>();

  constructor(private readonly options: ConnectionOptions) {}

  get state(): ConnectionStatus {
    return this.status;
  }

  connect(): void {
    if (this.socket && (this.status === 'connected' || this.status === 'connecting')) return;
    this.closedByUs = false;
    this.open();
  }

  private open(): void {
    this.setStatus(this.attempts === 0 ? 'connecting' : 'reconnecting');

    let socket: WebSocket;
    try {
      socket = new WebSocket(socketUrl(this.options.path, this.options.params));
    } catch {
      this.scheduleRetry();
      return;
    }
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.attempts = 0;
      this.setStatus('connected');
      this.options.onOpen?.();
    });

    socket.addEventListener('message', (event) => this.receive(event.data));

    socket.addEventListener('close', () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.failPending({ code: 'SERVER_ERROR', message: 'The connection closed.' });
      if (this.closedByUs) {
        this.setStatus('idle');
        return;
      }
      this.scheduleRetry();
    });

    socket.addEventListener('error', () => {
      // 'close' always follows, and that is where reconnection is handled.
    });
  }

  private scheduleRetry(): void {
    if (this.closedByUs) return;
    if (this.attempts >= MAX_ATTEMPTS) {
      this.setStatus('failed');
      return;
    }
    this.attempts += 1;
    this.setStatus('reconnecting');
    // 600ms, 1.2s, 2.4s, ... capped, so a brief blip recovers quickly.
    const delay = Math.min(600 * 2 ** (this.attempts - 1), 5000);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.open(), delay);
  }

  private receive(raw: unknown): void {
    const message = parseWire<WireInbound>(raw);
    if (!message) return;

    if (isAck(message)) {
      const waiting = this.pending.get(message.i);
      if (!waiting) return;
      clearTimeout(waiting.timer);
      this.pending.delete(message.i);
      waiting.resolve(
        message.ok
          ? ({ ok: true, data: message.d } as Ack<never>)
          : ({ ok: false, error: message.e } as Ack<never>),
      );
      return;
    }

    const listeners = this.handlers.get(message.t);
    if (!listeners) return;
    for (const listener of listeners) listener(message.d);
  }

  /** Fire and forget. */
  send(type: string, data?: unknown): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    const frame: WireRequest = data === undefined ? { t: type } : { t: type, d: data };
    this.socket.send(JSON.stringify(frame));
  }

  /** Send and wait for the server's answer. */
  request<T>(type: string, data?: unknown): Promise<Ack<T>> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.resolve({
        ok: false,
        error: { code: 'SERVER_ERROR', message: 'Not connected.' },
      });
    }

    const id = this.nextId++;
    return new Promise<Ack<T>>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, error: { code: 'SERVER_ERROR', message: 'The server did not respond.' } });
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(id, {
        resolve: resolve as (value: Ack<never>) => void,
        timer,
      });

      const frame: WireRequest = data === undefined ? { i: id, t: type } : { i: id, t: type, d: data };
      this.socket!.send(JSON.stringify(frame));
    });
  }

  on(event: string, handler: EventHandler): () => void {
    let listeners = this.handlers.get(event);
    if (!listeners) {
      listeners = new Set();
      this.handlers.set(event, listeners);
    }
    listeners.add(handler);
    return () => listeners!.delete(handler);
  }

  /** Update the identity used for the next (re)connection. */
  setParams(params: ConnectParams): void {
    this.options.params = params;
  }

  close(): void {
    this.closedByUs = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.failPending({ code: 'SERVER_ERROR', message: 'The connection closed.' });
    try {
      this.socket?.close(1000, 'Client closed');
    } catch {
      // Already closed.
    }
    this.socket = null;
    this.setStatus('idle');
  }

  private failPending(error: RoomError): void {
    for (const [, waiting] of this.pending) {
      clearTimeout(waiting.timer);
      waiting.resolve({ ok: false, error } as Ack<never>);
    }
    this.pending.clear();
  }

  private setStatus(next: ConnectionStatus): void {
    if (this.status === next) return;
    this.status = next;
    this.options.onStatus?.(next);
  }
}

/** POST helper for the small HTTP API (creating a private room). */
export async function apiPost<T>(path: string, body: unknown): Promise<Ack<T>> {
  const base = SERVER_URL || window.location.origin;
  try {
    const response = await fetch(new URL(path, base), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as
      | { ok: true; data: T }
      | { ok: false; error: RoomError };
    if (!response.ok || !payload.ok) {
      return {
        ok: false,
        error: 'error' in payload ? payload.error : { code: 'SERVER_ERROR', message: 'Request failed.' },
      };
    }
    return { ok: true, data: payload.data };
  } catch {
    return {
      ok: false,
      error: { code: 'SERVER_ERROR', message: 'Could not reach the game server.' },
    };
  }
}
