/**
 * Trivia Night game server.
 *
 * Express for a couple of health endpoints and (in production) the built
 * client; Socket.IO for the actual game. Run it with `npm run dev`.
 */

import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import { Server, type Socket } from 'socket.io';

import { ALL_QUESTIONS, contentStats } from '@trivia/content';
import {
  MODES,
  normalizeRoomCode,
  roomError,
  sanitizeName,
  type Ack,
  type ClientToServerEvents,
  type CreateRoomRequest,
  type GameMode,
  type GuessRequest,
  type JoinRoomRequest,
  type MatchFound,
  type QueueMode,
  type QueueRequest,
  type RoomSettings,
  type RoomSnapshot,
  type ServerToClientEvents,
} from '@trivia/shared';

import { Room } from './room.js';
import { RoomRegistry } from './rooms.js';
import { Matchmaker } from './matchmaking.js';

/**
 * TRIVIA_PORT wins over PORT so an ambient PORT from a launcher (which often
 * belongs to the web dev server) can never drag the game server onto the same
 * socket. Hosting platforms that only set PORT still work.
 */
const PORT = Number(process.env.TRIVIA_PORT ?? process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? '0.0.0.0';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * Origins allowed to open a socket, comma separated.
 *
 * Only needed when the client is served from a different origin than this
 * server (a split deploy: static frontend on one host, backend on another).
 * When the server serves its own client, everything is same-origin and this
 * can stay unset. Unset in production means "reflect any origin", which is
 * fine for a game with no cookies or credentials, but setting it is better.
 */
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsOrigin = ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS : true;

const here = dirname(fileURLToPath(import.meta.url));
const clientDist = resolve(here, '../../web/dist');

const app = express();
const httpServer = createServer(app);

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  // Same-origin when the server serves its own client, and proxied by Vite in
  // development. ALLOWED_ORIGINS matters only for a split deployment.
  cors: { origin: corsOrigin, credentials: true },
  pingInterval: 10_000,
  pingTimeout: 20_000,
});

const rooms = new RoomRegistry({
  broadcast: (room) => {
    const snapshot = room.snapshot();
    io.to(roomChannel(room.code)).emit('room:state', snapshot);
  },
  notify: (room, event, payload) => {
    if (event === 'allLocked') {
      io.to(roomChannel(room.code)).emit('round:allLocked', payload as { round: number });
    }
  },
});

function roomChannel(code: string): string {
  return `room:${code}`;
}

/* -------------------------------------------------------------------- *
 * Matchmaking
 * -------------------------------------------------------------------- */

/** How long the "opponent found" beat plays before the first question. */
const MATCH_INTRO_MS = 3600;

const matchmaker = new Matchmaker({
  isConnected: (socketId) => io.sockets.sockets.has(socketId),

  onStatus: (ticket, progress, queueDepth) => {
    const socket = io.sockets.sockets.get(ticket.socketId);
    socket?.emit('queue:update', {
      mode: ticket.mode,
      phase: 'searching',
      // The player themselves always counts as one of the found players.
      found: Math.min(queueDepth, progress.target),
      target: progress.target,
      idealTarget: progress.idealTarget,
      searchingSince: ticket.enqueuedAt,
      queueDepth,
      serverTime: Date.now(),
    });
  },

  onMatch: (mode, tickets) => {
    const room = rooms.createPublic(mode);
    if (!room) {
      console.error(`[matchmaking] could not create a ${mode} room`);
      return false;
    }

    // Seat everyone whose socket is still alive.
    const seated: typeof tickets = [];
    for (const ticket of tickets) {
      const socket = io.sockets.sockets.get(ticket.socketId);
      if (!socket) continue;
      room.join(ticket.clientId, ticket.name, ticket.color, ticket.socketId);
      socket.join(roomChannel(room.code));
      seated.push(ticket);
    }

    // Someone vanished between matching and seating: scrap it and requeue.
    if (seated.length < MODES[mode].minPlayers) {
      rooms.destroy(room.code);
      return false;
    }

    room.autoStart(MATCH_INTRO_MS);
    const payload: MatchFound = {
      code: room.code,
      mode,
      players: room
        .snapshot()
        .players.map((player) => ({ id: player.id, name: player.name, color: player.color })),
      startsAt: room.startingAt ?? Date.now() + MATCH_INTRO_MS,
    };

    for (const ticket of seated) {
      io.sockets.sockets.get(ticket.socketId)?.emit('queue:matched', payload);
    }
    console.log(`[matchmaking] ${mode} match ${room.code} with ${seated.length} players`);
    return true;
  },
});

matchmaker.start();

/* -------------------------------------------------------------------- *
 * HTTP
 * -------------------------------------------------------------------- */

app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
    uptime: process.uptime(),
    ...rooms.stats(),
    queues: matchmaker.stats(),
  });
});

app.get('/api/content', (_request, response) => {
  const stats = contentStats();
  response.json({
    total: stats.total,
    byDifficulty: stats.byDifficulty,
    byType: stats.byType,
    byCategory: stats.byCategory,
  });
});

if (IS_PRODUCTION && existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // SPA fallback: any non-API path renders the client and lets the router decide.
  app.get(/^(?!\/api\/|\/socket\.io\/).*/, (_request, response) => {
    response.sendFile(resolve(clientDist, 'index.html'));
  });
}

/* -------------------------------------------------------------------- *
 * Sockets
 * -------------------------------------------------------------------- */

/** Cheap per-socket throttle so a stuck client cannot spin the server. */
const RATE_LIMIT = { windowMs: 1000, max: 25 };
const rateState = new WeakMap<Socket, { count: number; resetAt: number }>();

function rateLimited(socket: Socket): boolean {
  const now = Date.now();
  const state = rateState.get(socket);
  if (!state || now > state.resetAt) {
    rateState.set(socket, { count: 1, resetAt: now + RATE_LIMIT.windowMs });
    return false;
  }
  state.count += 1;
  return state.count > RATE_LIMIT.max;
}

function fail<T>(code: Parameters<typeof roomError>[0], message?: string): Ack<T> {
  return { ok: false, error: roomError(code, message) };
}

function ok<T>(data: T): Ack<T> {
  return { ok: true, data };
}

function isValidIdentity(payload: { clientId?: unknown; name?: unknown }): boolean {
  return (
    typeof payload?.clientId === 'string' &&
    payload.clientId.length >= 6 &&
    payload.clientId.length <= 64 &&
    typeof payload.name === 'string'
  );
}

io.on('connection', (socket) => {
  socket.on('ping', (ack) => {
    if (typeof ack === 'function') ack(Date.now());
  });

  socket.on('room:create', (payload: CreateRoomRequest, ack) => {
    const respond = typeof ack === 'function' ? ack : () => {};
    if (rateLimited(socket)) return respond(fail('RATE_LIMITED'));
    if (!isValidIdentity(payload)) return respond(fail('BAD_REQUEST', 'Missing player details.'));
    if (!isGameMode(payload.mode)) return respond(fail('BAD_REQUEST', 'Unknown game mode.'));
    if (payload.mode === 'solo') {
      return respond(fail('BAD_REQUEST', 'Solo runs in your browser — no room needed.'));
    }

    leaveCurrentRoom(socket);

    const room = rooms.create(payload.mode, payload.clientId, sanitizeSettings(payload.settings));
    if (!room) return respond(fail('SERVER_ERROR', 'Could not create a room right now.'));

    room.join(payload.clientId, sanitizeName(payload.name), toColor(payload.color), socket.id);
    socket.join(roomChannel(room.code));
    respond(ok(room.snapshot()));
    room.publish();
  });

  socket.on('room:join', (payload: JoinRoomRequest, ack) => {
    const respond = typeof ack === 'function' ? ack : () => {};
    if (rateLimited(socket)) return respond(fail('RATE_LIMITED'));
    if (!isValidIdentity(payload)) return respond(fail('BAD_REQUEST', 'Missing player details.'));

    const code = normalizeRoomCode(String(payload.code ?? ''));
    if (code.length < 4) return respond(fail('INVALID_CODE'));

    const room = rooms.get(code);
    if (!room) return respond(fail('ROOM_NOT_FOUND'));

    const returning = room.hasSeat(payload.clientId);
    if (process.env.TRIVIA_DEBUG) {
      console.log(
        `[join] ${code} client=${payload.clientId} returning=${returning} ` +
          `players=${room.playerCount} phase=${room.phase}`,
      );
    }
    if (!returning && room.isFull) return respond(fail('ROOM_FULL'));
    if (!returning && room.inProgress) return respond(fail('GAME_IN_PROGRESS'));

    leaveCurrentRoom(socket, room.code);

    room.join(payload.clientId, sanitizeName(payload.name), toColor(payload.color), socket.id);
    socket.join(roomChannel(room.code));
    respond(ok(room.snapshot()));
    room.publish();
  });

  socket.on('room:leave', () => {
    leaveCurrentRoom(socket);
  });

  socket.on('room:settings', (patch: Partial<RoomSettings>, ack) => {
    const respond = typeof ack === 'function' ? ack : () => {};
    const context = contextFor(socket);
    if (!context) return respond(fail('ROOM_NOT_FOUND'));
    if (context.room.visibility === 'public') {
      return respond(fail('NOT_HOST', 'Matchmade games use fixed settings.'));
    }
    if (context.seat.id !== context.room.hostId) return respond(fail('NOT_HOST'));
    context.room.updateSettings(sanitizeSettings(patch) ?? {});
    respond(ok(context.room.snapshot()));
  });

  socket.on('room:rename', (payload: { name: string }, ack) => {
    const respond = typeof ack === 'function' ? ack : () => {};
    const context = contextFor(socket);
    if (!context) return respond(fail('ROOM_NOT_FOUND'));
    context.room.rename(context.seat.id, String(payload?.name ?? ''));
    context.room.publish();
    respond(ok(context.room.snapshot()));
  });

  socket.on('game:start', (ack) => {
    const respond = typeof ack === 'function' ? ack : () => {};
    const context = contextFor(socket);
    if (!context) return respond(fail('ROOM_NOT_FOUND'));
    const { room, seat } = context;
    if (room.visibility === 'public') {
      return respond(fail('NOT_HOST', 'Matchmade games start on their own.'));
    }
    if (seat.id !== room.hostId) return respond(fail('NOT_HOST'));
    if (room.inProgress) return respond(fail('GAME_IN_PROGRESS'));
    if (!room.canStart()) {
      const needed = MODES[room.mode].minPlayers;
      return respond(
        fail('NOT_ENOUGH_PLAYERS', `${MODES[room.mode].label} needs ${needed} players.`),
      );
    }
    room.start();
    respond(ok(room.snapshot()));
  });

  socket.on('game:rematch', (ack) => {
    const respond = typeof ack === 'function' ? ack : () => {};
    const context = contextFor(socket);
    if (!context) return respond(fail('ROOM_NOT_FOUND'));
    const { room, seat } = context;
    // A public rematch would be a private lobby by another name; those players
    // requeue instead, which is what "find another match" does.
    if (room.visibility === 'public') {
      return respond(fail('NOT_HOST', 'Search for a new match instead.'));
    }
    if (seat.id !== room.hostId) return respond(fail('NOT_HOST'));
    if (!room.canStart()) return respond(fail('NOT_ENOUGH_PLAYERS'));
    room.rematch();
    respond(ok(room.snapshot()));
  });

  socket.on('round:guess', (payload: GuessRequest, ack) => {
    const respond = typeof ack === 'function' ? ack : () => {};
    if (rateLimited(socket)) return respond(fail('RATE_LIMITED'));
    const context = contextFor(socket);
    if (!context) return respond(fail('ROOM_NOT_FOUND'));
    if (!payload || typeof payload.questionId !== 'string' || !isGuess(payload.guess)) {
      return respond(fail('BAD_REQUEST', 'That guess was malformed.'));
    }
    const accepted = context.room.submitGuess(context.seat.id, payload.questionId, payload.guess);
    if (!accepted) return respond(fail('BAD_REQUEST', 'Too late, or already locked in.'));
    respond(ok({ locked: true as const }));
  });

  socket.on('round:ready', () => {
    const context = contextFor(socket);
    if (!context) return;
    context.room.markReady(context.seat.id);
  });

  socket.on('queue:join', (payload: QueueRequest, ack) => {
    const respond = typeof ack === 'function' ? ack : () => {};
    if (rateLimited(socket)) return respond(fail('RATE_LIMITED'));
    if (!isValidIdentity(payload)) return respond(fail('BAD_REQUEST', 'Missing player details.'));
    if (!isQueueMode(payload.mode)) return respond(fail('BAD_REQUEST', 'Unknown queue.'));

    /*
     * A player who is already in a live match must not be pulled out of it by
     * a queue request. This matters beyond the obvious double-click: the
     * instant matchmaking seats someone, a duplicate `queue:join` still in
     * flight would otherwise evict them from the match they just joined.
     */
    const current = rooms.findBySocket(socket.id);
    if (current?.inProgress) {
      return respond(fail('GAME_IN_PROGRESS', 'You are already in a match.'));
    }

    // Leaving an idle lobby to go looking for a public game is fine.
    leaveCurrentRoom(socket);

    const ticket = matchmaker.enqueue({
      clientId: payload.clientId,
      socketId: socket.id,
      name: sanitizeName(payload.name) || 'Player',
      color: toColor(payload.color),
      mode: payload.mode,
      attributes: payload.attributes,
    });

    const depth = matchmaker.depth(ticket.mode);
    respond(
      ok({
        mode: ticket.mode,
        phase: 'searching' as const,
        found: Math.min(depth, MODES[ticket.mode].maxPlayers),
        target: MODES[ticket.mode].maxPlayers,
        idealTarget: MODES[ticket.mode].maxPlayers,
        searchingSince: ticket.enqueuedAt,
        queueDepth: depth,
        serverTime: Date.now(),
      }),
    );

    // Try immediately so a waiting pair does not sit through a tick.
    matchmaker.tick();
  });

  socket.on('queue:leave', (ack) => {
    const respond = typeof ack === 'function' ? ack : () => {};
    matchmaker.cancelBySocket(socket.id);
    respond(ok({ left: true as const }));
  });

  socket.on('disconnect', () => {
    // A player who closes the tab while queued must not linger as a ghost.
    matchmaker.cancelBySocket(socket.id);

    const room = rooms.findBySocket(socket.id);
    if (!room) return;
    room.markDisconnected(socket.id);
    room.publish();
  });
});

function contextFor(socket: Socket) {
  const room = rooms.findBySocket(socket.id);
  if (!room) return null;
  const seat = room.findBySocket(socket.id);
  if (!seat) return null;
  return { room, seat };
}

/**
 * Detach a socket from whatever room it is in.
 * Players who leave deliberately give up their seat immediately — unlike a
 * disconnect, which holds the seat open in case they come back.
 */
function leaveCurrentRoom(socket: Socket, exceptCode?: string): void {
  const room = rooms.findBySocket(socket.id);
  if (!room || room.code === exceptCode) return;
  const seat = room.findBySocket(socket.id);
  if (process.env.TRIVIA_DEBUG) {
    console.log(`[leave] ${room.code} seat=${seat?.id ?? 'none'} except=${exceptCode ?? 'none'}`);
  }
  socket.leave(roomChannel(room.code));
  if (seat) room.leave(seat.id);
  if (room.isEmpty) rooms.destroy(room.code);
  else room.publish();
}

function isGameMode(value: unknown): value is GameMode {
  return typeof value === 'string' && value in MODES;
}

function isQueueMode(value: unknown): value is QueueMode {
  return value === 'duel' || value === 'ffa';
}

function toColor(value: unknown): number {
  const numeric = Number(value);
  return Number.isInteger(numeric) ? ((numeric % 8) + 8) % 8 : 0;
}

function sanitizeSettings(patch: Partial<RoomSettings> | undefined): Partial<RoomSettings> | undefined {
  if (!patch || typeof patch !== 'object') return undefined;
  const out: Partial<RoomSettings> = {};
  if (patch.timer === 'relaxed' || patch.timer === 'standard' || patch.timer === 'blitz') {
    out.timer = patch.timer;
  }
  if (typeof patch.rounds === 'number' && Number.isFinite(patch.rounds)) {
    out.rounds = patch.rounds;
  }
  return out;
}

/** Structural check — the room still validates the guess against the question. */
function isGuess(value: unknown): value is GuessRequest['guess'] {
  if (!value || typeof value !== 'object') return false;
  const guess = value as { kind?: unknown; value?: unknown };
  switch (guess.kind) {
    case 'number':
      return typeof guess.value === 'number' && Number.isFinite(guess.value);
    case 'binary':
      return guess.value === 0 || guess.value === 1;
    case 'higher-lower':
      return guess.value === 'higher' || guess.value === 'lower';
    case 'order':
      return (
        Array.isArray(guess.value) &&
        guess.value.length <= 12 &&
        guess.value.every((item) => typeof item === 'string')
      );
    case 'none':
      return true;
    default:
      return false;
  }
}

/* -------------------------------------------------------------------- *
 * Boot
 * -------------------------------------------------------------------- */

// Windows will happily let a second process share a bound port, which produces
// baffling intermittent 404s. Fail loudly instead.
httpServer.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use. Set TRIVIA_PORT to something else.\n`);
    process.exit(1);
  }
  throw error;
});

httpServer.listen(PORT, HOST, () => {
  const stats = contentStats();
  console.log('');
  console.log('  Trivia Night server');
  console.log(`  http://localhost:${PORT}`);
  console.log(`  ${ALL_QUESTIONS.length} questions loaded across ${Object.keys(stats.byCategory).length} categories`);
  if (IS_PRODUCTION) {
    console.log(existsSync(clientDist) ? '  serving built client' : '  no client build found — run npm run build');
  } else {
    console.log('  dev mode — open the Vite URL, not this one');
  }
  console.log('');
});

function shutdown(signal: string): void {
  console.log(`\n  ${signal} received, shutting down.`);
  matchmaker.dispose();
  rooms.dispose();
  io.close();
  httpServer.close(() => process.exit(0));
  // Do not hang forever on a stuck connection.
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export type { RoomSnapshot };
export { Room };
