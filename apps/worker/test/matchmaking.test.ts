/**
 * Matchmaking, end to end, against the real Worker runtime.
 *
 * Every test drives WebSocket clients at `wrangler dev`, so Durable Objects,
 * routing and the wire protocol are all genuinely exercised. The interesting
 * failures in matchmaking are about timing, disconnects and who ends up in
 * which room — none of which a unit test of the queue would catch.
 */

import type { ChildProcess } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MatchFound, QueueStatus, RoomSnapshot } from '@trivia/shared';

import {
  connect,
  freePort,
  guessFor,
  httpJson,
  identity,
  sleep,
  startWorker,
  stopWorker,
  type TestClient,
} from './harness.js';

let worker: ChildProcess | null = null;
let port = 0;
const open: TestClient[] = [];

async function queueClient(seed: string, name: string, color = 0): Promise<TestClient> {
  const client = await connect(port, '/ws/queue', identity(seed, name, color));
  open.push(client);
  return client;
}

async function roomClient(
  code: string,
  seed: string,
  name: string,
  color = 0,
): Promise<TestClient> {
  const client = await connect(port, `/ws/room/${code}`, identity(seed, name, color));
  open.push(client);
  return client;
}

/** Queue, wait to be matched, then connect to the room that was created. */
async function playInto(
  client: TestClient,
  mode: 'duel' | 'ffa',
  seed: string,
  name: string,
  color: number,
): Promise<{ match: MatchFound; room: TestClient }> {
  const found = client.once<MatchFound>('queue:matched', 30_000);
  await client.request('queue:join', { mode, name });
  const match = await found;
  const room = await roomClient(match.code, seed, name, color);
  return { match, room };
}

beforeAll(async () => {
  port = await freePort();
  worker = await startWorker(port);
}, 120_000);

afterAll(async () => {
  for (const client of open) client.close();
  await stopWorker(worker);
  worker = null;
});

describe('Quick 1v1', () => {
  it('pairs two searching players and runs a full match', async () => {
    const a = await queueClient('duel-a', 'Ada');
    const b = await queueClient('duel-b', 'Grace', 2);

    const foundA = a.once<MatchFound>('queue:matched', 30_000);
    const foundB = b.once<MatchFound>('queue:matched', 30_000);

    const queued = await a.request<QueueStatus>('queue:join', { mode: 'duel', name: 'Ada' });
    expect(queued.ok).toBe(true);
    if (queued.ok) expect(queued.data.target).toBe(2);
    await b.request('queue:join', { mode: 'duel', name: 'Grace' });

    const [matchA, matchB] = await Promise.all([foundA, foundB]);
    // Both players are pointed at the same room — nobody hosts it.
    expect(matchA.code).toBe(matchB.code);
    expect(matchA.players).toHaveLength(2);

    const roomA = await roomClient(matchA.code, 'duel-a', 'Ada');
    const roomB = await roomClient(matchB.code, 'duel-b', 'Grace', 2);

    let snapshot = await roomA.waitForState(
      (s) => s.phase === 'question' && s.round === 1,
      'round 1',
    );
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
      const revealSeen = roomA.waitForState(
        (s) => s.phase === 'reveal' && s.round === round,
        `reveal ${round}`,
      );

      await roomA.request('round:guess', { questionId, guess: guessFor(snapshot, 1.2) });

      // Between the two lock-ins, B must not be able to see A's number.
      const mid = await roomB.request<RoomSnapshot>('room:rename', { name: 'Grace' });
      if (mid.ok) {
        expect(JSON.stringify(mid.data)).not.toContain('"guess"');
        const activity = mid.data.players.map((player) => player.activity);
        expect(activity).toContain('locked');
        expect(activity).toContain('thinking');
      }

      await roomB.request('round:guess', { questionId, guess: guessFor(snapshot, 0.4) });

      const revealed = await revealSeen;
      expect(revealed.reveal!.results).toHaveLength(2);
      // Both players are scored on accuracy; this is not winner-takes-all.
      for (const result of revealed.reveal!.results) {
        expect(result.points.total).toBeGreaterThanOrEqual(0);
        expect(result.guessLabel).toBeTruthy();
      }

      if (round < 3) {
        const next = roomA.waitForState(
          (s) => s.phase === 'question' && s.round === round + 1,
          `round ${round + 1}`,
        );
        roomA.send('round:ready');
        roomB.send('round:ready');
        snapshot = await next;
      }
    }

    roomA.close();
    roomB.close();
    a.close();
    b.close();
  }, 150_000);

  it('resolves a round when one player never answers', async () => {
    const a = await queueClient('to-a', 'Ada');
    const b = await queueClient('to-b', 'Grace', 3);

    const found = a.once<MatchFound>('queue:matched', 30_000);
    await a.request('queue:join', { mode: 'duel', name: 'Ada' });
    await b.request('queue:join', { mode: 'duel', name: 'Grace' });
    const match = await found;

    const roomA = await roomClient(match.code, 'to-a', 'Ada');
    const roomB = await roomClient(match.code, 'to-b', 'Grace', 3);

    const snapshot = await roomA.waitForState((s) => s.phase === 'question', 'question');
    const revealSeen = roomA.waitForState(
      (s) => s.phase === 'reveal',
      'reveal after timeout',
      60_000,
    );

    // Only A answers. B is left to the server's deadline.
    await roomA.request('round:guess', {
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

    roomA.close();
    roomB.close();
    a.close();
    b.close();
  }, 150_000);
});

describe('Quick FFA', () => {
  it('gathers exactly four players into one match', async () => {
    const clients = await Promise.all([
      queueClient('ffa-0', 'Player1', 0),
      queueClient('ffa-1', 'Player2', 1),
      queueClient('ffa-2', 'Player3', 2),
      queueClient('ffa-3', 'Player4', 3),
    ]);
    const found = clients.map((client) => client.once<MatchFound>('queue:matched', 30_000));

    for (const [index, client] of clients.entries()) {
      const queued = await client.request<QueueStatus>('queue:join', {
        mode: 'ffa',
        name: `Player${index + 1}`,
      });
      expect(queued.ok).toBe(true);
      // The advertised target is always four; it never shrinks.
      if (queued.ok) {
        expect(queued.data.target).toBe(4);
        expect(queued.data.idealTarget).toBe(4);
      }
    }

    const matches = await Promise.all(found);
    // One match, not two pairs.
    expect(new Set(matches.map((match) => match.code)).size).toBe(1);
    expect(matches[0].players).toHaveLength(4);

    const rooms = await Promise.all(
      clients.map((_, index) => roomClient(matches[0].code, `ffa-${index}`, `Player${index + 1}`, index)),
    );

    const snapshot = await rooms[0].waitForState(
      (s) => s.phase === 'question' && s.round === 1,
      'ffa round 1',
    );
    expect(snapshot.players).toHaveLength(4);
    expect(snapshot.visibility).toBe('public');
    expect(snapshot.totalRounds).toBe(10);

    // Everyone gets the same question.
    const questionId = snapshot.question!.id;
    for (const room of rooms.slice(1)) {
      const view = await room.waitForState((s) => s.phase === 'question', 'their view', 20_000);
      expect(view.question!.id).toBe(questionId);
    }

    const revealSeen = rooms[0].waitForState((s) => s.phase === 'reveal', 'ffa reveal');
    for (const [index, room] of rooms.entries()) {
      await room.request('round:guess', { questionId, guess: guessFor(snapshot, 0.5 + index * 0.5) });
    }

    const revealed = await revealSeen;
    expect(revealed.reveal!.results).toHaveLength(4);
    /*
     * The scripted guesses are deliberately poor and the question is random, so
     * asserting that somebody scored would be a coin flip. What must hold is
     * that scoring ran for everyone and the scoreboard agrees with the round
     * results.
     */
    for (const result of revealed.reveal!.results) {
      expect(result.answered).toBe(true);
      expect(Number.isFinite(result.points.total)).toBe(true);
      const player = revealed.players.find((entry) => entry.id === result.playerId);
      expect(player?.score).toBe(result.totalScore);
    }
    // Exactly one closest player, unless nobody scored at all.
    const closest = revealed.reveal!.results.filter((result) => result.closest);
    const anyoneScored = revealed.reveal!.results.some((result) => result.accuracy > 0);
    expect(closest.length).toBe(anyoneScored ? 1 : 0);

    for (const room of rooms) room.close();
    for (const client of clients) client.close();
  }, 150_000);

  it('never starts with two or three players, however long they wait', async () => {
    const clients = await Promise.all([
      queueClient('wait-a', 'Ada', 0),
      queueClient('wait-b', 'Grace', 1),
      queueClient('wait-c', 'Alan', 2),
    ]);

    let matched = false;
    for (const client of clients) {
      client.once<MatchFound>('queue:matched', 60_000).then(
        () => {
          matched = true;
        },
        () => {
          /* the expected outcome is that this never resolves */
        },
      );
    }

    for (const [index, client] of clients.entries()) {
      await client.request('queue:join', { mode: 'ffa', name: ['Ada', 'Grace', 'Alan'][index] });
    }

    /*
     * Well past every deadline the old relaxation schedule used, and past two
     * full sweep cycles. Three players must still be waiting.
     */
    await sleep(35_000);
    expect(matched).toBe(false);

    const health = await httpJson<{ queues: { ffa: number } }>(port, '/api/health');
    expect(health.queues.ffa).toBe(3);

    // The fourth player is what unblocks it — and only the fourth.
    const fourth = await queueClient('wait-d', 'Grace Hopper', 3);
    const found = fourth.once<MatchFound>('queue:matched', 30_000);
    await fourth.request('queue:join', { mode: 'ffa', name: 'Grace Hopper' });
    const match = await found;
    expect(match.players).toHaveLength(4);

    for (const client of clients) client.close();
    fourth.close();
  }, 150_000);
});

describe('queue lifecycle', () => {
  it('removes a cancelled player so they cannot be matched', async () => {
    const a = await queueClient('cancel-a', 'Ada');
    const b = await queueClient('cancel-b', 'Grace', 5);

    let matchedA = false;
    a.once<MatchFound>('queue:matched', 8000).then(
      () => {
        matchedA = true;
      },
      () => {},
    );

    await a.request('queue:join', { mode: 'duel', name: 'Ada' });
    const left = await a.request<{ left: true }>('queue:leave');
    expect(left.ok).toBe(true);

    // B arrives after A left: there is nobody to pair with.
    await b.request('queue:join', { mode: 'duel', name: 'Grace' });
    await sleep(2500);
    expect(matchedA).toBe(false);

    const health = await httpJson<{ queues: { duel: number } }>(port, '/api/health');
    expect(health.queues.duel).toBe(1);

    a.close();
    b.close();
    await sleep(500);
  }, 90_000);

  it('clears the ticket of a player who disconnects while searching', async () => {
    const ghost = await queueClient('ghost', 'Ghost');
    await ghost.request('queue:join', { mode: 'duel', name: 'Ghost' });
    ghost.close();
    await sleep(1500);

    const health = await httpJson<{ queues: { duel: number; waiting: number } }>(
      port,
      '/api/health',
    );
    expect(health.queues.duel).toBe(0);
    expect(health.queues.waiting).toBe(0);

    // A fresh pair still matches normally, proving the ghost is really gone.
    const a = await queueClient('post-ghost-a', 'Ada');
    const b = await queueClient('post-ghost-b', 'Grace', 6);
    const found = a.once<MatchFound>('queue:matched', 30_000);
    await a.request('queue:join', { mode: 'duel', name: 'Ada' });
    await b.request('queue:join', { mode: 'duel', name: 'Grace' });
    const match = await found;
    expect(match.players).toHaveLength(2);

    a.close();
    b.close();
  }, 90_000);

  it('holds one place per player, however many times they ask', async () => {
    const a = await queueClient('dupe', 'Ada');
    await a.request('queue:join', { mode: 'duel', name: 'Ada' });
    await a.request('queue:join', { mode: 'duel', name: 'Ada' });
    await a.request('queue:join', { mode: 'duel', name: 'Ada' });
    await sleep(500);

    const health = await httpJson<{ queues: { duel: number; waiting: number } }>(
      port,
      '/api/health',
    );
    expect(health.queues.duel).toBe(1);
    expect(health.queues.waiting).toBe(1);

    a.close();
    await sleep(800);
  }, 90_000);

  it('moves a player between queues instead of leaving a ghost behind', async () => {
    const a = await queueClient('switch', 'Ada');
    await a.request('queue:join', { mode: 'duel', name: 'Ada' });
    await sleep(300);
    await a.request('queue:join', { mode: 'ffa', name: 'Ada' });
    await sleep(400);

    const health = await httpJson<{ queues: { duel: number; ffa: number } }>(port, '/api/health');
    expect(health.queues.duel).toBe(0);
    expect(health.queues.ffa).toBe(1);

    a.close();
    await sleep(800);
  }, 90_000);
});

describe('match disconnects', () => {
  it('ends a duel honestly when the opponent leaves', async () => {
    const a = await queueClient('drop-a', 'Ada');
    const b = await queueClient('drop-b', 'Grace', 7);

    const found = a.once<MatchFound>('queue:matched', 30_000);
    await a.request('queue:join', { mode: 'duel', name: 'Ada' });
    await b.request('queue:join', { mode: 'duel', name: 'Grace' });
    const match = await found;

    const roomA = await roomClient(match.code, 'drop-a', 'Ada');
    const roomB = await roomClient(match.code, 'drop-b', 'Grace', 7);

    await roomA.waitForState((s) => s.phase === 'question', 'question');

    const ended = roomA.waitForState((s) => s.phase === 'final', 'abandoned final', 90_000);
    roomB.close();

    const final = await ended;
    expect(final.final!.reason).toBe('abandoned');
    // The remaining player still gets a result screen rather than a hang.
    expect(final.final!.standings.length).toBeGreaterThanOrEqual(1);

    roomA.close();
    a.close();
    b.close();
  }, 150_000);

  it('lets a player reconnect to their seat with their score intact', async () => {
    const a = await queueClient('rec-a', 'Ada');
    const b = await queueClient('rec-b', 'Grace', 4);

    const found = a.once<MatchFound>('queue:matched', 30_000);
    await a.request('queue:join', { mode: 'duel', name: 'Ada' });
    await b.request('queue:join', { mode: 'duel', name: 'Grace' });
    const match = await found;

    const roomA = await roomClient(match.code, 'rec-a', 'Ada');
    const roomB = await roomClient(match.code, 'rec-b', 'Grace', 4);

    const snapshot = await roomA.waitForState((s) => s.phase === 'question', 'question');
    const questionId = snapshot.question!.id;
    await roomA.request('round:guess', { questionId, guess: guessFor(snapshot, 1) });
    await roomB.request('round:guess', { questionId, guess: guessFor(snapshot, 1.1) });

    const revealed = await roomA.waitForState((s) => s.phase === 'reveal', 'reveal');
    const before = revealed.players.find((player) => player.name === 'Ada');
    expect(before).toBeDefined();
    /*
     * The scripted guesses are deliberately poor, so the score may legitimately
     * be zero. What matters here is that whatever it is survives the round trip
     * — not that it happens to be large.
     */
    const scoreBefore = before!.score;
    const roundsBefore = revealed.round;

    // Drop and come back, exactly as a browser refresh would.
    roomA.close();
    await sleep(1200);
    const roomAgain = await roomClient(match.code, 'rec-a', 'Ada');
    const resumed = await roomAgain.waitForState(() => true, 'resumed state', 20_000);

    const me = resumed.players.find((player) => player.name === 'Ada');
    expect(me).toBeDefined();
    // Same seat, same score, and reconnected rather than seated afresh.
    expect(me!.score).toBe(scoreBefore);
    expect(me!.connected).toBe(true);
    expect(resumed.players).toHaveLength(2);
    expect(resumed.round).toBeGreaterThanOrEqual(roundsBefore);

    roomAgain.close();
    roomB.close();
    a.close();
    b.close();
  }, 150_000);
});
