/**
 * Trivia Night on Cloudflare.
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

export { RoomDO } from './room-do.js';
export { MatchmakerDO } from './matchmaker-do.js';

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

  if (path === '/api/room' && request.method === 'GET') {
    const code = normalizeRoomCode(url.searchParams.get('code') ?? '');
    if (code.length < 4) return errorResponse(400, roomError('INVALID_CODE'));
    const stub = env.ROOM.get(env.ROOM.idFromName(code));
    const state = await stub.fetch('https://room/state').then((response) => response.json());
    return jsonResponse(state);
  }

  return errorResponse(404, roomError('BAD_REQUEST', 'Unknown endpoint.'));
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
