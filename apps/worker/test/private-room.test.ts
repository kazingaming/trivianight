/**
 * Private rooms, end to end.
 *
 * The secondary multiplayer path: create a room over HTTP, share the code,
 * everyone connects, the party leader starts. The leader is a social role —
 * the Durable Object is still the only thing that decides anything.
 */

import type { ChildProcess } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RoomSnapshot } from '@trivia/shared';

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

beforeAll(async () => {
  port = await freePort();
  worker = await startWorker(port);
}, 120_000);

afterAll(async () => {
  for (const client of open) client.close();
  await stopWorker(worker);
  worker = null;
});

describe('private rooms', () => {
  it('runs create, join, start, play, reveal and final standings', async () => {
    const code = await createRoom('duel');
    expect(code).toMatch(/^[A-Z0-9]{4,5}$/);

    const host = await join(code, 'pr-host', 'Host');
    const guest = await join(code, 'pr-guest', 'Guest', 2);

    // The creator's connection becomes the party leader.
    const lobby = await host.waitForState(
      (s) => s.phase === 'lobby' && s.players.length === 2,
      'both in the lobby',
    );
    expect(lobby.visibility).toBe('private');
    expect(lobby.hostId).toBeTruthy();
    expect(lobby.players.filter((player) => player.isHost)).toHaveLength(1);

    // Only the leader may configure or start.
    const guestStart = await guest.request('game:start');
    expect(guestStart.ok).toBe(false);
    if (!guestStart.ok) expect(guestStart.error.code).toBe('NOT_HOST');

    const settings = await host.request<RoomSnapshot>('room:settings', { rounds: 3 });
    expect(settings.ok).toBe(true);
    if (settings.ok) expect(settings.data.settings.rounds).toBe(3);

    const started = await host.request<RoomSnapshot>('game:start');
    expect(started.ok).toBe(true);

    let snapshot = await host.waitForState(
      (s) => s.phase === 'question' && s.round === 1,
      'round 1',
    );
    expect(snapshot.totalRounds).toBe(3);

    for (let round = 1; round <= 3; round++) {
      const questionId = snapshot.question!.id;
      const revealSeen = host.waitForState(
        (s) => s.phase === 'reveal' && s.round === round,
        `reveal ${round}`,
      );

      await host.request('round:guess', { questionId, guess: guessFor(snapshot, 1.1) });
      await guest.request('round:guess', { questionId, guess: guessFor(snapshot, 0.6) });

      const revealed = await revealSeen;
      expect(revealed.reveal!.results).toHaveLength(2);
      expect(revealed.reveal!.payload.answerLabel.length).toBeGreaterThan(0);

      const next = host.waitForState(
        (s) => (round < 3 ? s.phase === 'question' && s.round === round + 1 : s.phase === 'final'),
        round < 3 ? `round ${round + 1}` : 'final',
      );
      host.send('round:ready');
      guest.send('round:ready');
      snapshot = await next;
    }

    expect(snapshot.phase).toBe('final');
    expect(snapshot.final!.reason).toBe('complete');
    expect(snapshot.final!.standings).toHaveLength(2);
    expect(snapshot.final!.standings[0].rank).toBe(1);

    // A rematch resets scores and starts again.
    const rematch = await host.request<RoomSnapshot>('game:rematch');
    expect(rematch.ok).toBe(true);
    const fresh = await host.waitForState(
      (s) => s.phase === 'question' && s.round === 1,
      'rematch round 1',
    );
    expect(fresh.players.every((player) => player.score === 0)).toBe(true);

    host.close();
    guest.close();
  }, 150_000);

  it('refuses a third player in a duel and an unknown code', async () => {
    const code = await createRoom('duel');
    const host = await join(code, 'full-host', 'Host');
    const guest = await join(code, 'full-guest', 'Guest', 1);
    await host.waitForState((s) => s.players.length === 2, 'both seated');

    // A third connection to a two-player room is rejected at the upgrade.
    await expect(join(code, 'full-extra', 'Alan', 3)).rejects.toBeTruthy();

    // An unknown code never opens.
    await expect(join('ZZZZ', 'nobody', 'Nobody')).rejects.toBeTruthy();

    host.close();
    guest.close();
  }, 90_000);

  it('hands the party leader role on when the leader leaves', async () => {
    const code = await createRoom('ffa');
    const host = await join(code, 'ho-host', 'Host');
    const guest = await join(code, 'ho-guest', 'Guest', 2);

    const lobby = await host.waitForState((s) => s.players.length === 2, 'both seated');
    const originalHost = lobby.hostId;

    const promoted = guest.waitForState(
      (s) => s.hostId !== originalHost && s.hostId !== '',
      'leader handed over',
      30_000,
    );
    host.send('room:leave');

    const after = await promoted;
    expect(after.hostId).not.toBe(originalHost);
    expect(after.players.some((player) => player.isHost)).toBe(true);

    guest.close();
  }, 90_000);
});
