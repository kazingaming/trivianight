/**
 * Close Enough on Cloudflare.
 *
 * One Worker is the whole backend. It serves the built client from the edge,
 * answers a small HTTP API, and routes WebSocket upgrades to the Durable
 * Object that owns the relevant state:
 *
 *   /ws/queue      -> MatchmakerDO  (one global instance)
 *   /ws/room/CODE  -> RoomDO        (one instance per room)
 *
 * Requests that match a built asset never reach this code at all — the asset
 * router serves them first. Everything else lands here, which is how the API,
 * the sockets and the single-page-app fallback are all handled explicitly.
 */

import { ALL_QUESTIONS, contentStats } from '@trivia/content';
import { createRoomCode, MODES, normalizeRoomCode, roomError, type GameMode } from '@trivia/shared';

import { errorResponse, jsonResponse } from './ws.js';
import {
  authAvailable,
  beginGoogleSignIn,
  clearCookie,
  clearOAuthCookie,
  completeGoogleSignIn,
  devLoginAllowed,
  fetchAvatar,
  googleConfig,
  issueSession,
  readSession,
  SESSION_COOKIE,
} from './auth.js';

export { RoomDO } from './room-do.js';
export { MatchmakerDO } from './matchmaker-do.js';
export { UserDO } from './user-do.js';

/** The matchmaker is a singleton; every player routes to the same instance. */
const MATCHMAKER_NAME = 'global';
const CODE_ATTEMPTS = 12;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === '/ws/queue') return routeToMatchmaker(request, env, url);
      if (path.startsWith('/ws/room/')) return routeToRoom(request, env, url, path);
      if (path.startsWith('/api/')) return handleApi(request, env, url, path);

      // Anything else is a client-side route: hand back the app shell.
      return serveAppShell(request, env, url);
    } catch (error) {
      console.error('[worker] unhandled', error);
      return errorResponse(500, roomError('SERVER_ERROR'));
    }
  },
} satisfies ExportedHandler<Env>;

/* -------------------------------------------------------------------- *
 * Routing
 * -------------------------------------------------------------------- */

function matchmakerStub(env: Env) {
  return env.MATCHMAKER.get(env.MATCHMAKER.idFromName(MATCHMAKER_NAME));
}

function routeToMatchmaker(request: Request, env: Env, url: URL): Promise<Response> {
  const target = new URL('https://matchmaker/ws');
  target.search = url.search;
  return matchmakerStub(env).fetch(new Request(target, request));
}

function routeToRoom(request: Request, env: Env, url: URL, path: string): Promise<Response> {
  const code = normalizeRoomCode(path.slice('/ws/room/'.length));
  if (code.length < 4) {
    return Promise.resolve(errorResponse(400, roomError('INVALID_CODE')));
  }
  const stub = env.ROOM.get(env.ROOM.idFromName(code));
  const target = new URL('https://room/ws');
  target.search = url.search;
  return stub.fetch(new Request(target, request));
}

/* -------------------------------------------------------------------- *
 * HTTP API
 * -------------------------------------------------------------------- */

async function handleApi(request: Request, env: Env, url: URL, path: string): Promise<Response> {
  if (path === '/api/health') {
    const stats = await matchmakerStub(env)
      .fetch('https://matchmaker/stats')
      .then((response) => response.json())
      .catch(() => null);
    return jsonResponse({
      ok: true,
      questions: ALL_QUESTIONS.length,
      queues: stats,
    });
  }

  if (path === '/api/content') {
    const stats = contentStats();
    return jsonResponse({
      total: stats.total,
      byDifficulty: stats.byDifficulty,
      byType: stats.byType,
      byCategory: stats.byCategory,
    });
  }

  // Create a private room. Public rooms are created by the matchmaker only.
  if (path === '/api/rooms' && request.method === 'POST') {
    const body = (await request.json().catch(() => null)) as { mode?: unknown } | null;
    const mode = body?.mode;
    if (mode !== 'duel' && mode !== 'ffa') {
      return errorResponse(400, roomError('BAD_REQUEST', 'Unknown mode.'));
    }

    const code = await allocatePrivateRoom(env, mode);
    if (!code) return errorResponse(503, roomError('SERVER_ERROR', 'Could not create a room.'));
    return jsonResponse({ ok: true, data: { code, mode } });
  }

  if (path.startsWith('/api/auth/') || path.startsWith('/api/account/')) {
    return handleAccounts(request, env, url, path);
  }

  if (path === '/api/room' && request.method === 'GET') {
    const code = normalizeRoomCode(url.searchParams.get('code') ?? '');
    if (code.length < 4) return errorResponse(400, roomError('INVALID_CODE'));
    const stub = env.ROOM.get(env.ROOM.idFromName(code));
    const state = await stub.fetch('https://room/state').then((response) => response.json());
    return jsonResponse(state);
  }

  return errorResponse(404, roomError('BAD_REQUEST', 'Unknown endpoint.'));
}

/* -------------------------------------------------------------------- *
 * Accounts
 *
 * Every route here is optional. A player who never touches them gets the
 * whole game; a player who signs in gets their name, picture and best runs
 * carried between devices.
 * -------------------------------------------------------------------- */

function userStub(env: Env, uid: string) {
  return env.USER.get(env.USER.idFromName(uid));
}

async function handleAccounts(
  request: Request,
  env: Env,
  url: URL,
  path: string,
): Promise<Response> {
  /* --- What the client is allowed to offer --------------------------- */
  if (path === '/api/auth/config') {
    return jsonResponse({
      // Whether to show a sign-in control at all.
      available: authAvailable(env, url),
      google: googleConfig(env) !== null,
      devLogin: devLoginAllowed(env, url),
    });
  }

  /* --- Google round trip --------------------------------------------- */
  if (path === '/api/auth/google/start') {
    const redirect = await beginGoogleSignIn(env, url);
    return redirect ?? errorResponse(503, roomError('SERVER_ERROR', 'Sign-in is not configured.'));
  }

  if (path === '/api/auth/google/callback') {
    const result = await completeGoogleSignIn(request, env, url);
    if ('error' in result) return signInFailed(url, result.error);

    const uid = `google:${result.identity.sub}`;
    const response = await userStub(env, uid).fetch('https://user/ensure', {
      method: 'POST',
      body: JSON.stringify({
        id: uid,
        name: result.identity.name,
        avatar: await fetchAvatar(result.identity.picture),
      }),
    });
    if (!response.ok) return signInFailed(url, 'Could not open your account.');

    const cookie = await issueSession(env, url, uid);
    if (!cookie) return signInFailed(url, 'Sign-in is not configured.');

    const headers = new Headers({ location: result.next });
    headers.append('set-cookie', cookie);
    headers.append('set-cookie', clearOAuthCookie(url));
    return new Response(null, { status: 302, headers });
  }

  /*
   * The local-only shortcut. See devLoginAllowed: it needs both an
   * unconfigured deployment and a loopback host, which together cannot
   * describe anything reachable from the internet.
   */
  if (path === '/api/auth/dev-login' && request.method === 'POST') {
    if (!devLoginAllowed(env, url)) {
      return errorResponse(404, roomError('BAD_REQUEST', 'Unknown endpoint.'));
    }
    /*
     * `?as=` picks which local account to open. It exists so tests can start
     * from a genuinely empty one — `wrangler dev` keeps Durable Object storage
     * between runs, so a fixed name would inherit whatever the last session
     * left behind. Browsing to the page uses the default.
     */
    const label = (url.searchParams.get('as') ?? 'local').replace(/[^a-z0-9-]/gi, '').slice(0, 40);
    const uid = `dev:${label || 'local'}`;
    await userStub(env, uid).fetch('https://user/ensure', {
      method: 'POST',
      body: JSON.stringify({ id: uid, name: 'Local Tester', avatar: null }),
    });
    const cookie = await issueSession(env, url, uid);
    if (!cookie) return errorResponse(503, roomError('SERVER_ERROR'));
    return jsonResponse({ ok: true }, 200, cookie);
  }

  if (path === '/api/auth/logout' && request.method === 'POST') {
    return jsonResponse({ ok: true }, 200, clearCookie(SESSION_COOKIE, url));
  }

  /* --- Everything below needs a session ------------------------------ */
  const session = await readSession(request, env, url);

  if (path === '/api/auth/me') {
    if (!session) return jsonResponse({ signedIn: false });
    const response = await userStub(env, session.uid).fetch('https://user/profile');
    // The account is gone but the cookie is not. Drop the cookie.
    if (!response.ok) {
      return jsonResponse({ signedIn: false }, 200, clearCookie(SESSION_COOKIE, url));
    }
    const data = (await response.json()) as object;
    return jsonResponse({ signedIn: true, ...data });
  }

  if (!session) return errorResponse(401, roomError('BAD_REQUEST', 'Not signed in.'));

  if (path === '/api/account/profile' && request.method === 'PATCH') {
    return userStub(env, session.uid).fetch('https://user/profile', {
      method: 'PATCH',
      body: await request.text(),
    });
  }

  if (path === '/api/account/score' && request.method === 'POST') {
    return userStub(env, session.uid).fetch('https://user/score', {
      method: 'POST',
      body: await request.text(),
    });
  }

  return errorResponse(404, roomError('BAD_REQUEST', 'Unknown endpoint.'));
}

/** Bounce back to the app with something it can show the player. */
function signInFailed(url: URL, message: string): Response {
  const target = new URL('/account', url.origin);
  target.searchParams.set('error', message);
  return new Response(null, {
    status: 302,
    headers: { location: target.toString(), 'set-cookie': clearOAuthCookie(url) },
  });
}

async function allocatePrivateRoom(env: Env, mode: GameMode): Promise<string | null> {
  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
    const code = createRoomCode(attempt < 8 ? 4 : 5);
    const stub = env.ROOM.get(env.ROOM.idFromName(code));
    const response = await stub.fetch(`https://room/init?code=${code}`, {
      method: 'POST',
      body: JSON.stringify({
        mode,
        visibility: 'private',
        settings: { timer: 'standard', rounds: MODES[mode].rounds ?? 10 },
      }),
    });
    if (response.ok) return code;
  }
  return null;
}

/* -------------------------------------------------------------------- *
 * Static assets
 * -------------------------------------------------------------------- */

/**
 * Serve index.html for client-side routes.
 *
 * Reaching here means the asset router already failed to find a file, so this
 * is either a deep link like /room/ABCD or a genuine 404 — and the client
 * router is the thing that knows which.
 */
async function serveAppShell(request: Request, env: Env, url: URL): Promise<Response> {
  const shell = await env.ASSETS.fetch(new Request(new URL('/index.html', url.origin), request));
  if (!shell.ok) return shell;
  return new Response(shell.body, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // The shell must never be cached: it names the hashed bundles.
      'cache-control': 'no-cache',
    },
  });
}
