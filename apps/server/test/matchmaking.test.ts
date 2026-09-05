/**
 * Matchmaking, end to end.
 *
 * Every test here drives real socket clients against the real server binary,
 * because the interesting failures in matchmaking are all about timing,
 * disconnects and who ends up in which room — none of which a unit test of the
 * queue data structure would catch.
 */

import type { ChildProcess } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Socket } from 'socket.io-client';
import type { MatchFound, QueueStatus, RoomSnapshot } from '@trivia/shared';

import {
  connect,
  emit,
  freePort,
  guessFor,
  identity,
  sleep,
  startServer,
  waitForEvent,
  waitForState,
} from './harness.js';

let child: ChildProcess | null = null;
let port = 0;
const open: Socket[] = [];

async function client(): Promise<Socket> {
  const socket = await connect(port);
  open.push(socket);
  return socket;
}

beforeAll(async () => {
  port = await freePort();
  child = await startServer(port);
}, 45_000);

afterAll(() => {
  for (const socket of open) socket.disconnect();
  child?.kill();
  child = null;
});

describe('Quick 1v1', () => {
  it('pairs two searching players and runs a full match', async () => {
    const a = await client();
    const b = await client();

    const foundA = waitForEvent<MatchFound>(a, 'queue:matched');
    const foundB = waitForEvent<MatchFound>(b, 'queue:matched');

    const queuedA = await emit<QueueStatus>(a, 'queue:join', {
      mode: 'duel',
      ...identity('duel-a', 'Ada'),
    });
    expect(queuedA.ok).toBe(true);
    await emit<QueueStatus>(b, 'queue:join', { mode: 'duel', ...identity('duel-b', 'Grace', 2) });

    const [matchA, matchB] = await Promise.all([foundA, foundB]);
    // Both players are told about the same room — nobody hosts it.
    expect(matchA.code).toBe(matchB.code);
    expect(matchA.mode).toBe('duel');
    expect(matchA.players).toHaveLength(2);

    // The match starts on its own: no start button, no host.
    let snapshot = await waitForState(a, (s) => s.phase === 'question' && s.round === 1, 'round 1');
    expect(snapshot.visibility).toBe('public');
    expect(snapshot.hostId).toBe('');
    expect(snapshot.players.every((player) => !player.isHost)).toBe(true);
    expect(snapshot.totalRounds).toBe(8);

    // The authoritative clock is 30 seconds, set by the server.
    const window = (snapshot.deadline ?? 0) - (snapshot.questionStartedAt ?? 0);
    expect(window).toBeGreaterThan(25_000);
    expect(window).toBeLessThanOrEqual(31_000);

    for (let round = 1; round <= 3; round++) {
      expect(snapshot.round).toBe(round);
      expect(JSON.stringify(snapshot.question)).not.toContain('"answer"');

      const questionId = snapshot.question!.id;
      const revealSeen = waitForState(
        a,
        (s) => s.phase === 'reveal' && s.round === round,
        `reveal ${round}`,
      );

      await emit(a, 'round:guess', { questionId, guess: guessFor(snapshot, 1.2) });

      // Between the two lock-ins, B must not be able to see A's number.
      const midRound = await emit<RoomSnapshot>(b, 'room:rename', { name: 'Grace' });
      if (midRound.ok) {
        expect(JSON.stringify(midRound.data)).not.toContain('"guess"');
        const activity = midRound.data.players.map((player) => player.activity);
        expect(activity).toContain('locked');
        expect(activity).toContain('thinking');
      }

      await emit(b, 'round:guess', { questionId, guess: guessFor(snapshot, 0.4) });

      const revealed = await revealSeen;
      expect(revealed.reveal!.results).toHaveLength(2);
      // Both players are scored on accuracy; this is not winner-takes-all.
      for (const result of revealed.reveal!.results) {
        expect(result.points.total).toBeGreaterThanOrEqual(0);
        expect(result.guessLabel).toBeTruthy();
      }

      // Only wait when there is a next round; a promise nobody awaits would
      // reject into the void once its timeout elapsed.
      if (round < 3) {
        const next = waitForState(
          a,
          (s) => s.phase === 'question' && s.round === round + 1,
          `round ${round + 1}`,
        );
        a.emit('round:ready');
        b.emit('round:ready');
        snapshot = await next;
      }
    }

    a.disconnect();
    b.disconnect();
  }, 120_000);

  it('resolves a round when one player never answers', async () => {
    const a = await client();
    const b = await client();

    const found = waitForEvent<MatchFound>(a, 'queue:matched');
    await emit(a, 'queue:join', { mode: 'duel', ...identity('to-a', 'Ada') });
    await emit(b, 'queue:join', { mode: 'duel', ...identity('to-b', 'Grace', 3) });
    await found;

    const snapshot = await waitForState(a, (s) => s.phase === 'question', 'question');
    const revealSeen = waitForState(a, (s) => s.phase === 'reveal', 'reveal after timeout', 45_000);

    // Only A answers. B is left to the server's deadline.
    await emit(a, 'round:guess', {
      questionId: snapshot.question!.id,
      guess: guessFor(snapshot, 1),
    });

    const revealed = await revealSeen;
    const results = revealed.reveal!.results;
    expect(results).toHaveLength(2);
    const silent = results.find((result) => !result.answered);
    expect(silent).toBeDefined();
    expect(silent!.guessLabel).toBe('No guess');
    expect(silent!.points.total).toBe(0);

    a.disconnect();
    b.disconnect();
  }, 90_000);
});

describe('Quick FFA', () => {
  it('gathers four players into one match', async () => {
    const clients = await Promise.all([client(), client(), client(), client()]);
    const found = clients.map((socket) => waitForEvent<MatchFound>(socket, 'queue:matched'));

    for (const [index, socket] of clients.entries()) {
      await emit(socket, 'queue:join', {
        mode: 'ffa',
        ...identity(`ffa-${index}`, `Player${index + 1}`, index),
      });
    }

    const matches = await Promise.all(found);
    const codes = new Set(matches.map((match) => match.code));
    // One match, not two pairs.
    expect(codes.size).toBe(1);
    expect(matches[0].players).toHaveLength(4);

    const snapshot = await waitForState(
      clients[0],
      (s) => s.phase === 'question' && s.round === 1,
      'ffa round 1',
    );
    expect(snapshot.players).toHaveLength(4);
    expect(snapshot.mode).toBe('ffa');
    expect(snapshot.visibility).toBe('public');
    expect(snapshot.totalRounds).toBe(10);

    // Everyone gets the same question.
    const questionId = snapshot.question!.id;
    for (const socket of clients.slice(1)) {
      const view = await waitForState(socket, (s) => s.phase === 'question', 'their view', 15_000);
      expect(view.question!.id).toBe(questionId);
    }

    const revealSeen = waitForState(clients[0], (s) => s.phase === 'reveal', 'ffa reveal');
    for (const [index, socket] of clients.entries()) {
      await emit(socket, 'round:guess', { questionId, guess: guessFor(snapshot, 0.5 + index * 0.5) });
    }

    const revealed = await revealSeen;
    expect(revealed.reveal!.results).toHaveLength(4);
    expect(revealed.players.map((player) => player.score).some((score) => score > 0)).toBe(true);

    for (const socket of clients) socket.disconnect();
  }, 120_000);

  it('does not start a four-player game with fewer players', async () => {
    const a = await client();
    const b = await client();

    let matched = false;
    a.on('queue:matched', () => {
      matched = true;
    });

    await emit(a, 'queue:join', { mode: 'ffa', ...identity('wait-a', 'Ada') });
    await emit(b, 'queue:join', { mode: 'ffa', ...identity('wait-b', 'Grace', 4) });

    // Two players is below the ideal party size, and the relaxation schedule
    // does not kick in for well over half a minute.
    await sleep(3000);
    expect(matched).toBe(false);

    a.disconnect();
    b.disconnect();
  }, 40_000);
});

describe('queue lifecycle', () => {
  it('removes a cancelled player so they cannot be matched', async () => {
    const a = await client();
    const b = await client();

    let matchedA = false;
    a.on('queue:matched', () => {
      matchedA = true;
    });

    await emit(a, 'queue:join', { mode: 'duel', ...identity('cancel-a', 'Ada') });
    const left = await emit<{ left: true }>(a, 'queue:leave');
    expect(left.ok).toBe(true);

    // B arrives after A left: there is nobody to pair with.
    await emit(b, 'queue:join', { mode: 'duel', ...identity('cancel-b', 'Grace', 5) });
    await sleep(2000);
    expect(matchedA).toBe(false);

    a.disconnect();
    b.disconnect();
  }, 40_000);

  it('clears the ticket of a player who disconnects while searching', async () => {
    const ghost = await client();
    await emit(ghost, 'queue:join', { mode: 'duel', ...identity('ghost', 'Ghost') });
    ghost.disconnect();
    await sleep(1200);

    const health = await fetch(`http://localhost:${port}/api/health`).then((r) => r.json());
    expect(health.queues.duel).toBe(0);

    // A fresh pair still matches normally, proving the ghost is really gone.
    const a = await client();
    const b = await client();
    const found = waitForEvent<MatchFound>(a, 'queue:matched');
    await emit(a, 'queue:join', { mode: 'duel', ...identity('post-ghost-a', 'Ada') });
    await emit(b, 'queue:join', { mode: 'duel', ...identity('post-ghost-b', 'Grace', 6) });
    const match = await found;
    expect(match.players).toHaveLength(2);

    a.disconnect();
    b.disconnect();
  }, 60_000);

  it('holds one place per player, however many times they ask', async () => {
    const a = await client();
    await emit(a, 'queue:join', { mode: 'duel', ...identity('dupe', 'Ada') });
    await emit(a, 'queue:join', { mode: 'duel', ...identity('dupe', 'Ada') });
    await emit(a, 'queue:join', { mode: 'duel', ...identity('dupe', 'Ada') });
    await sleep(400);

    const health = await fetch(`http://localhost:${port}/api/health`).then((r) => r.json());
    expect(health.queues.duel).toBe(1);
    expect(health.queues.waiting).toBe(1);

    a.disconnect();
    await sleep(600);
  }, 40_000);

  it('moves a player between queues instead of leaving a ghost behind', async () => {
    const a = await client();
    await emit(a, 'queue:join', { mode: 'duel', ...identity('switch', 'Ada') });
    await sleep(300);
    await emit(a, 'queue:join', { mode: 'ffa', ...identity('switch', 'Ada') });
    await sleep(300);

    const health = await fetch(`http://localhost:${port}/api/health`).then((r) => r.json());
    expect(health.queues.duel).toBe(0);
    expect(health.queues.ffa).toBe(1);

    a.disconnect();
    await sleep(600);
  }, 40_000);
});

describe('match disconnects', () => {
  it('ends a duel honestly when the opponent leaves', async () => {
    const a = await client();
    const b = await client();

    const found = waitForEvent<MatchFound>(a, 'queue:matched');
    await emit(a, 'queue:join', { mode: 'duel', ...identity('drop-a', 'Ada') });
    await emit(b, 'queue:join', { mode: 'duel', ...identity('drop-b', 'Grace', 7) });
    await found;

    await waitForState(a, (s) => s.phase === 'question', 'question');

    const ended = waitForState(a, (s) => s.phase === 'final', 'abandoned final', 60_000);
    b.disconnect();

    const final = await ended;
    expect(final.final!.reason).toBe('abandoned');
    // The remaining player still gets a result screen rather than a hang.
    expect(final.final!.standings.length).toBeGreaterThanOrEqual(1);

    a.disconnect();
  }, 90_000);
});
