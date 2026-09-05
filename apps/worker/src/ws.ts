/**
 * WebSocket plumbing shared by both Durable Objects.
 *
 * Thin on purpose: send a frame, answer a request, and keep a registry of live
 * connections. Everything above this is game logic; everything below is the
 * platform.
 */

import { roomError, type RoomError, type RoomErrorCode } from '@trivia/shared';
import type { WireAck, WireEvent } from '@trivia/shared';

export interface Connection {
  /** Unique per socket. This is the engine's `socketId`. */
  id: string;
  socket: WebSocket;
  clientId: string;
  name: string;
  color: number;
}

let counter = 0;

export function nextConnectionId(prefix: string): string {
  counter = (counter + 1) % Number.MAX_SAFE_INTEGER;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}`;
}

function post(socket: WebSocket, payload: unknown): void {
  try {
    socket.send(JSON.stringify(payload));
  } catch {
    // The peer went away between our check and this send. Nothing to do:
    // the close handler will clean the connection up.
  }
}

export function sendEvent<T>(socket: WebSocket, type: string, data: T): void {
  post(socket, { t: type, d: data } satisfies WireEvent<T>);
}

export function sendOk<T>(socket: WebSocket, id: number | undefined, data: T): void {
  if (id === undefined) return;
  post(socket, { i: id, ok: true, d: data } satisfies WireAck<T>);
}

export function sendError(
  socket: WebSocket,
  id: number | undefined,
  code: RoomErrorCode,
  message?: string,
): void {
  if (id === undefined) return;
  post(socket, { i: id, ok: false, e: roomError(code, message) } satisfies WireAck<never>);
}

/** Push an event to many sockets at once. */
export function broadcastEvent<T>(
  connections: Iterable<Connection>,
  type: string,
  data: T,
): void {
  const frame = JSON.stringify({ t: type, d: data } satisfies WireEvent<T>);
  for (const connection of connections) {
    try {
      connection.socket.send(frame);
    } catch {
      // Same as above: a dead socket is handled by its close event.
    }
  }
}

export function errorResponse(status: number, error: RoomError): Response {
  return new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * A cheap per-connection throttle.
 *
 * Not anti-cheat — just enough that one stuck or hostile client cannot spin a
 * Durable Object and burn the account's request budget.
 */
export class RateLimiter {
  private count = 0;
  private resetAt = 0;

  constructor(
    private readonly max = 40,
    private readonly windowMs = 1000,
  ) {}

  exceeded(now = Date.now()): boolean {
    if (now > this.resetAt) {
      this.resetAt = now + this.windowMs;
      this.count = 1;
      return false;
    }
    this.count += 1;
    return this.count > this.max;
  }
}
