/**
 * Shared test harness.
 *
 * Boots the real server binary on a free port and gives tests a small set of
 * socket helpers. Everything here talks to the server the way a browser does —
 * no internal imports, no reaching past the wire.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { io, type Socket } from 'socket.io-client';
import type { Ack, RoomSnapshot } from '@trivia/shared';

const here = dirname(fileURLToPath(import.meta.url));
export const serverEntry = resolve(here, '../src/index.ts');
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

export function startServer(onPort: number): Promise<ChildProcess> {
  return new Promise((done, fail) => {
    const proc = spawn(
      process.execPath,
      [resolve(repoRoot, 'node_modules/tsx/dist/cli.mjs'), serverEntry],
      {
        cwd: repoRoot,
        env: { ...process.env, TRIVIA_PORT: String(onPort), NODE_ENV: 'test' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    const timer = setTimeout(() => fail(new Error('server did not start in time')), 30_000);
    let output = '';

    proc.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes('questions loaded')) {
        clearTimeout(timer);
        done(proc);
      }
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    proc.once('exit', (code) => {
      clearTimeout(timer);
      fail(new Error(`server exited early (${code}):\n${output}`));
    });
  });
}

export function connect(port: number): Promise<Socket> {
  return new Promise((done, fail) => {
    const socket = io(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
    const timer = setTimeout(() => fail(new Error('socket did not connect')), 10_000);
    socket.on('connect', () => {
      clearTimeout(timer);
      done(socket);
    });
    socket.on('connect_error', (error) => {
      clearTimeout(timer);
      fail(error);
    });
  });
}

export function emit<T>(socket: Socket, event: string, payload?: unknown): Promise<Ack<T>> {
  return new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error(`${event} timed out`)), 10_000);
    const callback = (result: Ack<T>) => {
      clearTimeout(timer);
      done(result);
    };
    if (payload === undefined) socket.emit(event, callback);
    else socket.emit(event, payload, callback);
  });
}

/** Resolve on the next snapshot that satisfies `predicate`. */
export function waitForState(
  socket: Socket,
  predicate: (snapshot: RoomSnapshot) => boolean,
  label: string,
  timeoutMs = 30_000,
): Promise<RoomSnapshot> {
  return new Promise((done, fail) => {
    const timer = setTimeout(() => {
      socket.off('room:state', listener);
      fail(new Error(`timed out waiting for ${label}`));
    }, timeoutMs);

    const listener = (snapshot: RoomSnapshot) => {
      if (!predicate(snapshot)) return;
      clearTimeout(timer);
      socket.off('room:state', listener);
      done(snapshot);
    };
    socket.on('room:state', listener);
  });
}

/** Resolve on the next occurrence of an arbitrary event. */
export function waitForEvent<T>(socket: Socket, event: string, timeoutMs = 20_000): Promise<T> {
  return new Promise((done, fail) => {
    const timer = setTimeout(() => {
      socket.off(event, listener);
      fail(new Error(`timed out waiting for ${event}`));
    }, timeoutMs);
    const listener = (payload: T) => {
      clearTimeout(timer);
      done(payload);
    };
    socket.once(event, listener);
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

export function identity(seed: string, name: string, color = 0) {
  return { clientId: `test-${seed}`.padEnd(16, '0').slice(0, 24), name, color };
}
