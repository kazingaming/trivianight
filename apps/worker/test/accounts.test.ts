/**
 * Optional accounts, against the real runtime.
 *
 * Two things are being proven here, and the first matters more than the
 * second: that a player who never signs in is unaffected in every way, and
 * that a player who does gets a profile and a high score that survive.
 *
 * Google itself is not exercised — that needs credentials this repo does not
 * and must not carry. What is exercised is everything on our side of it: the
 * session cookie, the profile Durable Object, the score merge, and the refusal
 * of every account route to an unauthenticated caller.
 */

import type { ChildProcess } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { freePort, httpJson, startWorker, stopWorker } from './harness.js';

let worker: ChildProcess | null = null;
let port = 0;

/** The session cookie, carried by hand the way a browser would. */
let cookie = '';

/*
 * A fresh local account per run. `wrangler dev` persists Durable Object
 * storage between runs, so a fixed name would inherit the previous run's
 * profile and "first sign-in" would not be first.
 */
const DEV_ACCOUNT = `t${Date.now().toString(36)}`;
const DEV_LOGIN = `/api/auth/dev-login?as=${DEV_ACCOUNT}`;

function base(): string {
  return `http://127.0.0.1:${port}`;
}

async function call(
  path: string,
  init: RequestInit & { auth?: boolean } = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.auth !== false && cookie) headers.set('cookie', cookie);
  if (init.body) headers.set('content-type', 'application/json');
  const response = await fetch(`${base()}${path}`, { ...init, headers, redirect: 'manual' });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  return response;
}

interface Me {
  signedIn: boolean;
  profile?: { id: string; username: string; avatar: string | null; color: number };
  records?: { soloScore: number; soloRounds: number; soloStreak: number };
}

beforeAll(async () => {
  port = await freePort();
  worker = await startWorker(port);
}, 120_000);

afterAll(async () => {
  await stopWorker(worker);
});

describe('a deployment with no credentials', () => {
  it('reports that Google sign-in is unavailable', async () => {
    const config = await httpJson<{ available: boolean; google: boolean; devLogin: boolean }>(
      port,
      '/api/auth/config',
    );
    expect(config.google).toBe(false);
    // Loopback, so the local stand-in is offered instead.
    expect(config.devLogin).toBe(true);
    expect(config.available).toBe(true);
  });

  it('still serves the game to a caller with no session', async () => {
    const health = await httpJson<{ ok: boolean; questions: number }>(port, '/api/health');
    expect(health.ok).toBe(true);
    expect(health.questions).toBeGreaterThan(300);

    const me = await httpJson<Me>(port, '/api/auth/me');
    expect(me.signedIn).toBe(false);
  });

  it('lets a guest create and read a private room', async () => {
    const room = await httpJson<{ ok: boolean; data: { code: string } }>(port, '/api/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'duel' }),
    });
    expect(room.ok).toBe(true);
    expect(room.data.code).toMatch(/^[A-Z0-9]{4,5}$/);
  });
});

describe('every account route without a session', () => {
  it('refuses to change a profile', async () => {
    const response = await fetch(`${base()}/api/account/profile`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'Intruder' }),
    });
    expect(response.status).toBe(401);
  });

  it('refuses to record a score', async () => {
    const response = await fetch(`${base()}/api/account/score`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ score: 999_999 }),
    });
    expect(response.status).toBe(401);
  });

  it('refuses a forged session cookie', async () => {
    const forged = 'ce_session=' + btoa(JSON.stringify({ uid: 'google:1', exp: 2e12 })) + '.nope';
    const me = (await (
      await fetch(`${base()}/api/auth/me`, { headers: { cookie: forged } })
    ).json()) as Me;
    expect(me.signedIn).toBe(false);
  });
});

describe('a signed-in player', () => {
  it('gets a profile on first sign-in', async () => {
    const response = await call(DEV_LOGIN, { method: 'POST', auth: false });
    expect(response.status).toBe(200);
    expect(cookie).toContain('ce_session=');

    const me = (await (await call('/api/auth/me')).json()) as Me;
    expect(me.signedIn).toBe(true);
    expect(me.profile?.username).toBe('Local Tester');
    expect(me.records?.soloScore).toBe(0);
  });

  it('never exposes the identity provider id as the username', async () => {
    const me = (await (await call('/api/auth/me')).json()) as Me;
    expect(me.profile?.username).not.toContain('dev:');
  });

  it('can change its display name', async () => {
    const response = await call('/api/account/profile', {
      method: 'PATCH',
      body: JSON.stringify({ username: '  Estimator  ' }),
    });
    expect(response.status).toBe(200);
    const me = (await (await call('/api/auth/me')).json()) as Me;
    expect(me.profile?.username).toBe('Estimator');
  });

  it('rejects a name that is not a name', async () => {
    const response = await call('/api/account/profile', {
      method: 'PATCH',
      body: JSON.stringify({ username: ' ' }),
    });
    expect(response.status).toBe(400);
  });

  it('accepts a small raster avatar and refuses anything else', async () => {
    // A one-pixel PNG.
    const png =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    expect((await call('/api/account/profile', { method: 'PATCH', body: JSON.stringify({ avatar: png }) })).status).toBe(200);

    const me = (await (await call('/api/auth/me')).json()) as Me;
    expect(me.profile?.avatar).toBe(png);

    // SVG can carry script, so it is not an accepted avatar type.
    const svg = 'data:image/svg+xml;base64,PHN2Zy8+';
    expect((await call('/api/account/profile', { method: 'PATCH', body: JSON.stringify({ avatar: svg }) })).status).toBe(400);

    // Neither is something far too large to be a 128px thumbnail.
    const huge = `data:image/png;base64,${'A'.repeat(60_000)}`;
    expect((await call('/api/account/profile', { method: 'PATCH', body: JSON.stringify({ avatar: huge }) })).status).toBe(400);

    // Clearing it is allowed, and falls back to the initials avatar.
    expect((await call('/api/account/profile', { method: 'PATCH', body: JSON.stringify({ avatar: null }) })).status).toBe(200);
    const cleared = (await (await call('/api/auth/me')).json()) as Me;
    expect(cleared.profile?.avatar).toBeNull();
  });

  it('keeps the best of every record and never lowers one', async () => {
    await call('/api/account/score', {
      method: 'POST',
      body: JSON.stringify({ score: 4200, rounds: 11, streak: 5 }),
    });
    // A later, worse run must not overwrite it — but its longer streak counts.
    await call('/api/account/score', {
      method: 'POST',
      body: JSON.stringify({ score: 900, rounds: 3, streak: 7 }),
    });

    const me = (await (await call('/api/auth/me')).json()) as Me;
    expect(me.records?.soloScore).toBe(4200);
    expect(me.records?.soloRounds).toBe(11);
    expect(me.records?.soloStreak).toBe(7);
  });

  it('ignores a nonsense score rather than storing it', async () => {
    await call('/api/account/score', {
      method: 'POST',
      body: JSON.stringify({ score: 'lots', rounds: -4, streak: Number.POSITIVE_INFINITY }),
    });
    const me = (await (await call('/api/auth/me')).json()) as Me;
    expect(me.records?.soloScore).toBe(4200);
    expect(me.records?.soloRounds).toBe(11);
  });

  it('comes back to the same account and the same records after signing in again', async () => {
    await call('/api/auth/logout', { method: 'POST' });
    const guest = (await (await call('/api/auth/me')).json()) as Me;
    expect(guest.signedIn).toBe(false);

    await call(DEV_LOGIN, { method: 'POST', auth: false });
    const back = (await (await call('/api/auth/me')).json()) as Me;
    expect(back.signedIn).toBe(true);
    // The name and score chosen earlier survived the round trip.
    expect(back.profile?.username).toBe('Estimator');
    expect(back.records?.soloScore).toBe(4200);
  });
});
