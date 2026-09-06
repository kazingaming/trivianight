/**
 * Host-configured private matches.
 *
 * Two things reported from real play: the thinking-time setting appeared to do
 * nothing, and a match configured for eleven rounds ended after ten. Both are
 * really the same question — does what the host chose in the lobby reach the
 * authoritative clock and the authoritative round counter — so both are proven
 * here against the real Worker rather than against the engine in isolation.
 */

import type { ChildProcess } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MODES, TIMER_SCALE, type RoomSnapshot, type TimerPreference } from '@trivia/shared';

import {
  connect,
  freePort,
  guessFor,
  httpJson,
  identity,
  startWorker,
  stopWorker,
  type TestClient,
} from './harness.js';

let worker: ChildProcess | null = null;
let port = 0;
const open: TestClient[] = [];

async function createRoom(mode: 'duel' | 'ffa'): Promise<string> {
  const result = await httpJson<{ ok: boolean; data: { code: string } }>(port, '/api/rooms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  expect(result.ok).toBe(true);
  return result.data.code;
}

async function join(code: string, seed: string, name: string, color = 0): Promise<TestClient> {
  const client = await connect(port, `/ws/room/${code}`, identity(seed, name, color));
  open.push(client);
  return client;
}

/** The clock the server actually opened, in seconds. */
function clockSeconds(snapshot: RoomSnapshot): number {
  return Math.round(((snapshot.deadline ?? 0) - (snapshot.questionStartedAt ?? 0)) / 1000);
}

/** Answer the live round from both seats and wait for the reveal. */
async function playRound(
  host: TestClient,
  guest: TestClient,
  snapshot: RoomSnapshot,
): Promise<RoomSnapshot> {
  const round = snapshot.round;
  const questionId = snapshot.question!.id;
  const revealSeen = host.waitForState(
    (s) => s.phase === 'reveal' && s.round === round,
    `reveal ${round}`,
  );
  await host.request('round:guess', { questionId, guess: guessFor(snapshot, 1.1) });
  await guest.request('round:guess', { questionId, guess: guessFor(snapshot, 0.7) });
  return revealSeen;
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

describe('the thinking-time setting', () => {
  it('sets the authoritative clock, and keeps it for every round', async () => {
    const code = await createRoom('duel');
    const host = await join(code, 'tm-host', 'Host');
    const guest = await join(code, 'tm-guest', 'Guest', 2);
    await host.waitForState((s) => s.players.length === 2, 'both seated');

    const chosen: TimerPreference = 'blitz';
    const settings = await host.request<RoomSnapshot>('room:settings', {
      timer: chosen,
      rounds: 3,
    });
    expect(settings.ok).toBe(true);
    if (settings.ok) expect(settings.data.settings.timer).toBe(chosen);

    await host.request('game:start');
    let snapshot = await host.waitForState((s) => s.phase === 'question' && s.round === 1, 'round 1');

    // The clock the server opened must be the chosen one, not the mode default.
    const expected = Math.round(MODES.duel.defaultTimeLimit * TIMER_SCALE[chosen]);
    expect(snapshot.settings.timer).toBe(chosen);
    expect(clockSeconds(snapshot)).toBe(expected);
    expect(expected).not.toBe(MODES.duel.defaultTimeLimit);

    // And it must survive the round transition, not just the first question.
    for (let round = 1; round <= 2; round++) {
      await playRound(host, guest, snapshot);
      const next = host.waitForState(
        (s) => s.phase === 'question' && s.round === round + 1,
        `round ${round + 1}`,
      );
      host.send('round:ready');
      guest.send('round:ready');
      snapshot = await next;
      expect(clockSeconds(snapshot), `round ${round + 1} clock`).toBe(expected);
    }

    host.close();
    guest.close();
  }, 150_000);

  it('gives a relaxed room a longer clock than a blitz one', async () => {
    const clocks: Record<string, number> = {};

    for (const preference of ['relaxed', 'standard'] as TimerPreference[]) {
      const code = await createRoom('duel');
      const host = await join(code, `rx-${preference}-h`, 'Host');
      const guest = await join(code, `rx-${preference}-g`, 'Guest', 3);
      await host.waitForState((s) => s.players.length === 2, 'both seated');

      await host.request('room:settings', { timer: preference, rounds: 3 });
      await host.request('game:start');
      const snapshot = await host.waitForState(
        (s) => s.phase === 'question' && s.round === 1,
        `${preference} round 1`,
      );
      clocks[preference] = clockSeconds(snapshot);

      host.close();
      guest.close();
    }

    expect(clocks.relaxed).toBeGreaterThan(clocks.standard);
    expect(clocks.standard).toBe(MODES.duel.defaultTimeLimit);
  }, 150_000);

  it('keeps the last value when the host drags the slider', async () => {
    // A range input fires an event per step. Losing the final one would leave
    // the room configured for whatever the host dragged *through*.
    const code = await createRoom('ffa');
    const host = await join(code, 'dr-host', 'Host');
    await host.waitForState((s) => s.players.length === 1, 'seated');

    for (let rounds = 4; rounds <= 14; rounds++) {
      host.send('room:settings', { rounds });
    }
    const settled = await host.request<RoomSnapshot>('room:settings', { rounds: 14 });
    expect(settled.ok).toBe(true);
    if (settled.ok) expect(settled.data.settings.rounds).toBe(14);

    const snapshot = await host.waitForState((s) => s.settings.rounds === 14, 'slider settled');
    expect(snapshot.totalRounds).toBe(14);

    host.close();
  }, 90_000);
});

describe('the round count', () => {
  it('plays every configured round past the mode default of ten', async () => {
    const ROUNDS = 11;
    const code = await createRoom('ffa');
    const host = await join(code, 'r11-host', 'Host');
    const guest = await join(code, 'r11-guest', 'Guest', 4);
    await host.waitForState((s) => s.players.length === 2, 'both seated');

    // Blitz keeps the test honest about time without changing what it proves.
    const settings = await host.request<RoomSnapshot>('room:settings', {
      rounds: ROUNDS,
      timer: 'blitz',
    });
    expect(settings.ok).toBe(true);
    if (settings.ok) expect(settings.data.settings.rounds).toBe(ROUNDS);

    await host.request('game:start');
    let snapshot = await host.waitForState((s) => s.phase === 'question' && s.round === 1, 'round 1');
    expect(snapshot.totalRounds).toBe(ROUNDS);

    for (let round = 1; round <= ROUNDS; round++) {
      expect(snapshot.round, 'round number').toBe(round);
      await playRound(host, guest, snapshot);

      const last = round === ROUNDS;
      const next = host.waitForState(
        (s) => (last ? s.phase === 'final' : s.phase === 'question' && s.round === round + 1),
        last ? 'final' : `round ${round + 1}`,
      );
      host.send('round:ready');
      guest.send('round:ready');
      snapshot = await next;
    }

    // Eleven rounds played, and the match ended because it finished.
    expect(snapshot.phase).toBe('final');
    expect(snapshot.final!.reason).toBe('complete');
    expect(snapshot.round).toBe(ROUNDS);

    // The room is still there afterwards: a player who refreshes gets back in.
    const returning = await join(code, 'r11-host', 'Host');
    const rejoined = await returning.waitForState((s) => s.phase === 'final', 'rejoined');
    expect(rejoined.final!.standings).toHaveLength(2);
    returning.close();

    guest.close();
  }, 240_000);

  it('accepts the whole range the lobby slider offers', async () => {
    const code = await createRoom('ffa');
    const host = await join(code, 'rg-host', 'Host');
    await host.waitForState((s) => s.players.length === 1, 'seated');

    for (const rounds of [3, 10, 11, 16]) {
      const result = await host.request<RoomSnapshot>('room:settings', { rounds });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data.settings.rounds, `rounds=${rounds}`).toBe(rounds);
    }

    host.close();
  }, 90_000);
});
