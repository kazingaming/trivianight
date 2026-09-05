/**
 * Test harness.
 *
 * Boots the real Worker under `wrangler dev`, which runs workerd — the same
 * runtime Cloudflare runs in production, with real Durable Objects. Tests then
 * drive it over real WebSockets. Nothing here reaches past the wire, so a test
 * passing means a browser would have worked too.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import WebSocket from 'ws';
import type { Ack, RoomSnapshot, WireInbound, WireRequest } from '@trivia/shared';

const here = dirname(fileURLToPath(import.meta.url));
export const workerDir = resolve(here, '..');
export const repoRoot = resolve(here, '../../..');

export function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.once('error', fail);
    probe.listen(0, () => {
      const address = probe.address();
      const chosen = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => done(chosen));
    });
  });
}

/**
 * Start `wrangler dev` on a free port.
 *
 * `--local` keeps everything on this machine: no Cloudflare account, no login,
 * no network calls, and Durable Objects backed by local storage.
 */
export function startWorker(port: number): Promise<ChildProcess> {
  return new Promise((done, fail) => {
    const proc = spawn(
      process.execPath,
      [
        resolve(repoRoot, 'node_modules/wrangler/bin/wrangler.js'),
        'dev',
        '--local',
        '--port',
        String(port),
        '--inspector-port',
        '0',
      ],
      {
        cwd: workerDir,
        env: {
          ...process.env,
          // Keep wrangler non-interactive and quiet during tests.
          CI: '1',
          WRANGLER_SEND_METRICS: 'false',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    const timer = setTimeout(() => {
      proc.kill();
      fail(new Error(`wrangler did not start in time:\n${output}`));
    }, 90_000);

    let output = '';
    let settled = false;

    const check = (chunk: Buffer) => {
      output += chunk.toString();
      if (settled) return;
      // Wrangler prints "Ready on http://localhost:PORT" when it can serve.
      if (/Ready on https?:\/\//i.test(output)) {
        settled = true;
        clearTimeout(timer);
        // Give workerd a beat to finish binding before the first request.
        setTimeout(() => done(proc), 700);
      }
    };

    proc.stdout?.on('data', check);
    proc.stderr?.on('data', check);
    proc.once('exit', (code) => {
      if (settled) return;
      clearTimeout(timer);
      fail(new Error(`wrangler exited early (${code}):\n${output}`));
    });
  });
}

export async function stopWorker(proc: ChildProcess | null): Promise<void> {
  if (!proc || proc.killed) return;
  await new Promise<void>((done) => {
    proc.once('exit', () => done());
    proc.kill();
    setTimeout(done, 4000);
  });
}

/* -------------------------------------------------------------------- *
 * Clients
 * -------------------------------------------------------------------- */

export interface TestClient {
  socket: WebSocket;
  /** Send a request and wait for its acknowledgement. */
  request<T>(type: string, data?: unknown): Promise<Ack<T>>;
  /** Fire and forget. */
  send(type: string, data?: unknown): void;
  /** Resolve on the next event of this type. */
  once<T>(event: string, timeoutMs?: number): Promise<T>;
  /** Resolve on the next room:state matching a predicate. */
  waitForState(
    predicate: (snapshot: RoomSnapshot) => boolean,
    label: string,
    timeoutMs?: number,
  ): Promise<RoomSnapshot>;
  /** Every event of a type seen so far. */
  seen(event: string): unknown[];
  close(): void;
}

export interface Identity {
  clientId: string;
  name: string;
  color: number;
}

export function identity(seed: string, name: string, color = 0): Identity {
  return { clientId: `test-${seed}`.padEnd(12, '0'), name, color };
}

function query(id: Identity): string {
  const params = new URLSearchParams();
  params.set('cid', id.clientId);
  params.set('n', id.name);
  params.set('c', String(id.color));
  return params.toString();
}

/** Open a client socket to any Worker path and wrap it in helpers. */
export function connect(
  port: number,
  path: string,
  id: Identity,
  timeoutMs = 15_000,
): Promise<TestClient> {
  return new Promise((done, fail) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}${path}?${query(id)}`);
    const pending = new Map<number, (value: Ack<never>) => void>();
    const listeners = new Map<string, Set<(data: unknown) => void>>();
    const history = new Map<string, unknown[]>();
    let nextId = 1;

    const timer = setTimeout(() => {
      socket.close();
      fail(new Error(`socket to ${path} did not open`));
    }, timeoutMs);

    socket.on('open', () => {
      clearTimeout(timer);
      done(client);
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      fail(error);
    });

    socket.on('message', (raw) => {
      let message: WireInbound;
      try {
        message = JSON.parse(raw.toString()) as WireInbound;
      } catch {
        return;
      }

      if ('i' in message && 'ok' in message) {
        const resolve = pending.get(message.i);
        if (!resolve) return;
        pending.delete(message.i);
        resolve(
          message.ok
            ? ({ ok: true, data: message.d } as Ack<never>)
            : ({ ok: false, error: message.e } as Ack<never>),
        );
        return;
      }

      const event = message as { t: string; d: unknown };
      if (!event.t) return;
      const bucket = history.get(event.t) ?? [];
      bucket.push(event.d);
      history.set(event.t, bucket);
      for (const listener of listeners.get(event.t) ?? []) listener(event.d);
    });

    const client: TestClient = {
      socket,

      request<T>(type: string, data?: unknown): Promise<Ack<T>> {
        const id = nextId++;
        return new Promise((resolve) => {
          const bail = setTimeout(
            () =>
              resolve({
                ok: false,
                error: { code: 'SERVER_ERROR', message: `${type} timed out` },
              }),
            15_000,
          );
          pending.set(id, (value) => {
            clearTimeout(bail);
            resolve(value as Ack<T>);
          });
          const frame: WireRequest =
            data === undefined ? { i: id, t: type } : { i: id, t: type, d: data };
          socket.send(JSON.stringify(frame));
        });
      },

      send(type: string, data?: unknown): void {
        const frame: WireRequest = data === undefined ? { t: type } : { t: type, d: data };
        socket.send(JSON.stringify(frame));
      },

      once<T>(event: string, waitMs = 20_000): Promise<T> {
        return new Promise((resolve, reject) => {
          const bail = setTimeout(() => {
            listeners.get(event)?.delete(handler);
            reject(new Error(`timed out waiting for ${event}`));
          }, waitMs);
          const handler = (data: unknown) => {
            clearTimeout(bail);
            listeners.get(event)?.delete(handler);
            resolve(data as T);
          };
          const bucket = listeners.get(event) ?? new Set();
          bucket.add(handler);
          listeners.set(event, bucket);
        });
      },

      waitForState(predicate, label, waitMs = 45_000): Promise<RoomSnapshot> {
        return new Promise((resolve, reject) => {
          // A matching snapshot may already have arrived.
          const past = (history.get('room:state') ?? []) as RoomSnapshot[];
          const already = past[past.length - 1];
          if (already && predicate(already)) {
            resolve(already);
            return;
          }
          const bail = setTimeout(() => {
            listeners.get('room:state')?.delete(handler);
            reject(new Error(`timed out waiting for ${label}`));
          }, waitMs);
          const handler = (data: unknown) => {
            const snapshot = data as RoomSnapshot;
            if (!predicate(snapshot)) return;
            clearTimeout(bail);
            listeners.get('room:state')?.delete(handler);
            resolve(snapshot);
          };
          const bucket = listeners.get('room:state') ?? new Set();
          bucket.add(handler);
          listeners.set('room:state', bucket);
        });
      },

      seen(event: string): unknown[] {
        return history.get(event) ?? [];
      },

      close(): void {
        try {
          socket.close();
        } catch {
          // Already closed.
        }
      },
    };
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

/** A guess of the right shape for whatever format this round happens to be. */
export function guessFor(snapshot: RoomSnapshot, bias: number) {
  const question = snapshot.question!;
  switch (question.type) {
    case 'numeric':
      return { kind: 'number' as const, value: 1000 * bias };
    case 'percentage':
    case 'probability':
      return { kind: 'number' as const, value: Math.min(99, 30 * bias) };
    case 'year':
      return { kind: 'number' as const, value: 1500 };
    case 'higher-lower':
      return { kind: 'higher-lower' as const, value: bias > 1 ? 'higher' : ('lower' as const) };
    case 'order':
      return { kind: 'order' as const, value: (question.items ?? []).map((item) => item.id) };
    default:
      return { kind: 'binary' as const, value: (bias > 1 ? 1 : 0) as 0 | 1 };
  }
}

export async function httpJson<T>(port: number, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, init);
  return (await response.json()) as T;
}
