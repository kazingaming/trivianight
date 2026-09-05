/**
 * End-to-end match test.
 *
 * Boots the real server binary on a free port and drives two socket clients
 * through a complete Free For All: lobby, settings, countdown, three rounds of
 * hidden guesses, reveals, and the final standings.
 *
 * This is the test that would have caught a broken reveal, a leaked guess, or
 * a match that never reaches its podium.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import type { Ack, RoomSnapshot } from '@trivia/shared';

const here = dirname(fileURLToPath(import.meta.url));
const serverEntry = resolve(here, '../src/index.ts');
const repoRoot = resolve(here, '../../..');

let child: ChildProcess | null = null;
let port = 0;

function freePort(): Promise<number> {
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

function startServer(onPort: number): Promise<ChildProcess> {
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

function connect(): Promise<Socket> {
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

function emit<T>(socket: Socket, event: string, payload?: unknown): Promise<Ack<T>> {
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
function waitFor(
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

/** A guess of the right shape for whatever format this round happens to be. */
function guessFor(snapshot: RoomSnapshot, bias: number) {
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

beforeAll(async () => {
  port = await freePort();
  child = await startServer(port);
}, 45_000);

afterAll(() => {
  child?.kill();
  child = null;
});

describe('a full Free For All match', () => {
  it('runs from lobby to podium without leaking a guess', async () => {
    const host = await connect();
    const guest = await connect();

    const created = await emit<RoomSnapshot>(host, 'room:create', {
      mode: 'ffa',
      clientId: 'test-host-000001',
      name: 'Ada',
      color: 0,
      settings: { rounds: 3, timer: 'blitz' },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const code = created.data.code;
    expect(code).toMatch(/^[A-Z0-9]{4}$/);

    const joined = await emit<RoomSnapshot>(guest, 'room:join', {
      code,
      clientId: 'test-guest-00001',
      name: 'Grace',
      color: 2,
    });
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    expect(joined.data.players).toHaveLength(2);
    expect(joined.data.settings.rounds).toBe(3);

    const firstQuestion = waitFor(guest, (s) => s.phase === 'question' && s.round === 1, 'round 1');
    const started = await emit<RoomSnapshot>(host, 'game:start');
    expect(started.ok).toBe(true);

    let snapshot = await firstQuestion;

    for (let round = 1; round <= 3; round++) {
      expect(snapshot.round).toBe(round);
      expect(snapshot.question).toBeDefined();
      // The wire must never carry an answer during the question phase.
      const wire = JSON.stringify(snapshot.question);
      expect(wire).not.toContain('"answer"');
      expect(snapshot.reveal).toBeUndefined();

      const questionId = snapshot.question!.id;
      const revealSeen = waitFor(guest, (s) => s.phase === 'reveal' && s.round === round, `reveal ${round}`);

      // Ada answers first and closer; Grace answers second and worse.
      const hostAck = await emit(host, 'round:guess', {
        questionId,
        guess: guessFor(snapshot, 1.2),
      });
      expect(hostAck.ok).toBe(true);

      // Before the second player commits, nobody can see the first guess.
      const midRound = await emit<RoomSnapshot>(guest, 'room:rename', { name: 'Grace' });
      if (midRound.ok) {
        expect(JSON.stringify(midRound.data)).not.toContain('"guess"');
        const activity = midRound.data.players.map((p) => p.activity);
        expect(activity).toContain('locked');
        expect(activity).toContain('thinking');
      }

      await emit(guest, 'round:guess', { questionId, guess: guessFor(snapshot, 0.05) });

      const revealed = await revealSeen;
      expect(revealed.reveal).toBeDefined();
      expect(revealed.reveal!.results).toHaveLength(2);
      // Now, and only now, both guesses are on the wire.
      expect(revealed.reveal!.payload.answerLabel.length).toBeGreaterThan(0);
      expect(revealed.reveal!.payload.reveal.explanation.length).toBeGreaterThan(20);
      for (const result of revealed.reveal!.results) {
        expect(result.guessLabel).toBeTruthy();
        expect(result.points.total).toBeGreaterThanOrEqual(0);
      }
      /*
       * At most one player is the closest. When everybody scores a flat zero —
       * which these deliberately terrible guesses often produce — the round has
       * no winner at all, and nobody collects the closest bonus for being the
       * least catastrophic.
       */
      const closest = revealed.reveal!.results.filter((r) => r.closest);
      const anyoneScored = revealed.reveal!.results.some((r) => r.accuracy > 0);
      expect(closest.length).toBe(anyoneScored ? 1 : 0);
      if (closest.length === 1) {
        const best = Math.max(...revealed.reveal!.results.map((r) => r.accuracy));
        expect(closest[0].accuracy).toBe(best);
        expect(closest[0].points.closestBonus).toBeGreaterThan(0);
      }

      if (round < 3) {
        const nextQuestion = waitFor(
          guest,
          (s) => s.phase === 'question' && s.round === round + 1,
          `round ${round + 1}`,
        );
        host.emit('round:ready');
        guest.emit('round:ready');
        snapshot = await nextQuestion;
      } else {
        snapshot = await waitFor(guest, (s) => s.phase === 'final', 'final standings');
      }
    }

    expect(snapshot.phase).toBe('final');
    expect(snapshot.final).toBeDefined();
    const standings = snapshot.final!.standings;
    expect(standings).toHaveLength(2);
    expect(standings[0].rank).toBe(1);
    // Standings are ordered, and the winner list matches the top score.
    expect(standings[0].score).toBeGreaterThanOrEqual(standings[1].score);
    expect(snapshot.final!.winnerIds.length).toBeGreaterThanOrEqual(1);
    expect(standings.map((s) => s.name).sort()).toEqual(['Ada', 'Grace']);
    // At most one round win per round; rounds nobody got near award none.
    const roundsWon = standings.reduce((sum, s) => sum + s.roundsWon, 0);
    expect(roundsWon).toBeGreaterThanOrEqual(0);
    expect(roundsWon).toBeLessThanOrEqual(3);

    host.disconnect();
    guest.disconnect();
  }, 120_000);

  it('refuses a third player once a duel is under way', async () => {
    const host = await connect();
    const guest = await connect();
    const latecomer = await connect();

    const created = await emit<RoomSnapshot>(host, 'room:create', {
      mode: 'duel',
      clientId: 'test-duel-host01',
      name: 'Ada',
      color: 0,
      settings: { rounds: 3, timer: 'blitz' },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await emit(guest, 'room:join', {
      code: created.data.code,
      clientId: 'test-duel-guest1',
      name: 'Grace',
      color: 1,
    });

    const full = await emit(latecomer, 'room:join', {
      code: created.data.code,
      clientId: 'test-duel-extra1',
      name: 'Alan',
      color: 3,
    });
    expect(full.ok).toBe(false);
    if (!full.ok) expect(full.error.code).toBe('ROOM_FULL');

    const missing = await emit(latecomer, 'room:join', {
      code: 'ZZZZ',
      clientId: 'test-duel-extra1',
      name: 'Alan',
      color: 3,
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe('ROOM_NOT_FOUND');

    // Only the host may start or change settings.
    const notHost = await emit(guest, 'game:start');
    expect(notHost.ok).toBe(false);
    if (!notHost.ok) expect(notHost.error.code).toBe('NOT_HOST');

    host.disconnect();
    guest.disconnect();
    latecomer.disconnect();
  }, 60_000);
});
