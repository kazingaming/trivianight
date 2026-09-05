/**
 * RoomDO — one Durable Object per room, and the authority for that match.
 *
 * A Durable Object is a natural fit here: it is a single-threaded, addressable
 * piece of state that every player in the room routes to. That gives us the
 * one thing authoritative multiplayer needs — a single place that owns the
 * question, the clock and the scoreboard — without a server process that has
 * to stay awake between games.
 *
 * Round timers use setTimeout rather than alarms because the object is kept
 * alive by its open WebSockets for exactly as long as a match is being played.
 * Alarms are used for the slower housekeeping that must survive an idle object.
 */

import { Room } from '@trivia/engine';
import {
  MODES,
  parseWire,
  readConnectParams,
  roomError,
  sanitizeName,
  type GameMode,
  type Guess,
  type RoomSettings,
  type RoomVisibility,
  type WireRequest,
} from '@trivia/shared';

import {
  broadcastEvent,
  errorResponse,
  jsonResponse,
  nextConnectionId,
  RateLimiter,
  sendError,
  sendEvent,
  sendOk,
  type Connection,
} from './ws.js';

/** How long the "opponent found" beat plays before the first question. */
const MATCH_INTRO_MS = 3600;
/** How long a matchmade room waits for its reserved players to arrive. */
const RESERVATION_TIMEOUT_MS = 15_000;
/** Housekeeping cadence: seat sweeping and expiry. */
const ALARM_INTERVAL_MS = 30_000;
/** An idle room is collected after this long, freeing its code for reuse. */
const IDLE_TTL_MS = 45 * 60_000;

interface InitPayload {
  mode: GameMode;
  visibility: RoomVisibility;
  settings?: Partial<RoomSettings>;
  /** Matchmade rooms name their party up front; private rooms do not. */
  reserved?: Array<{ clientId: string; name: string; color: number }>;
}

interface RoomRecord {
  mode: GameMode;
  visibility: RoomVisibility;
  createdAt: number;
}

export class RoomDO implements DurableObject {
  private room: Room | null = null;
  private record: RoomRecord | null = null;
  private code = '';
  private reserved = new Set<string>();
  private reservationTimer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private lastActivity = Date.now();

  private readonly connections = new Map<string, Connection>();
  private readonly limiters = new WeakMap<WebSocket, RateLimiter>();

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/init') return this.handleInit(request);
    if (url.pathname === '/ws') return this.handleUpgrade(request, url);
    if (url.pathname === '/state') {
      return jsonResponse({
        exists: this.room !== null,
        players: this.room?.playerCount ?? 0,
        phase: this.room?.phase ?? null,
      });
    }
    return new Response('Not found', { status: 404 });
  }

  /* ---------------------------------------------------------------- *
   * Lifecycle
   * ---------------------------------------------------------------- */

  /**
   * Claim this room code.
   *
   * Returns 409 if the code is already taken, which is how the caller knows to
   * try another one. The claim is persisted so a code cannot be handed out
   * twice even if the object is evicted between matches.
   */
  private async handleInit(request: Request): Promise<Response> {
    const existing = await this.load();
    if (existing) {
      return errorResponse(409, roomError('BAD_REQUEST', 'That room code is in use.'));
    }

    const payload = (await request.json()) as InitPayload;
    if (!payload?.mode || !MODES[payload.mode]) {
      return errorResponse(400, roomError('BAD_REQUEST', 'Unknown mode.'));
    }

    this.code = new URL(request.url).searchParams.get('code') ?? '';
    this.record = {
      mode: payload.mode,
      visibility: payload.visibility,
      createdAt: Date.now(),
    };
    await this.state.storage.put('record', this.record);

    this.room = new Room(
      this.code,
      payload.mode,
      '',
      payload.settings,
      () => this.publish(),
      (_room, _event, data) => {
        broadcastEvent(this.connections.values(), 'round:allLocked', data);
      },
      payload.visibility,
    );

    this.reserved = new Set((payload.reserved ?? []).map((player) => player.clientId));
    this.started = false;

    if (this.reserved.size > 0) {
      // Nobody has connected yet. If some of the party never shows up, start
      // with whoever did rather than waiting forever.
      this.reservationTimer = setTimeout(() => this.beginIfReady(true), RESERVATION_TIMEOUT_MS);
    }

    await this.state.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
    this.touch();
    return jsonResponse({ ok: true, code: this.code });
  }

  private async load(): Promise<RoomRecord | null> {
    if (this.record) return this.record;
    const stored = await this.state.storage.get<RoomRecord>('record');
    if (stored) this.record = stored;
    return this.record;
  }

  /* ---------------------------------------------------------------- *
   * Connections
   * ---------------------------------------------------------------- */

  private async handleUpgrade(request: Request, url: URL): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426 });
    }

    await this.load();
    if (!this.room) {
      return errorResponse(404, roomError('ROOM_NOT_FOUND'));
    }

    const params = readConnectParams(url);
    if (!params) return errorResponse(400, roomError('BAD_REQUEST', 'Missing player details.'));

    const room = this.room;
    const returning = room.hasSeat(params.clientId);
    const invited = this.reserved.has(params.clientId);

    // Matchmade rooms only admit the party the matchmaker put together.
    if (!returning && !invited && room.visibility === 'public') {
      return errorResponse(403, roomError('ROOM_NOT_FOUND'));
    }
    if (!returning && room.isFull) return errorResponse(409, roomError('ROOM_FULL'));
    if (!returning && !invited && room.inProgress) {
      return errorResponse(409, roomError('GAME_IN_PROGRESS'));
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();

    const connection: Connection = {
      id: nextConnectionId('c'),
      socket: server,
      clientId: params.clientId,
      name: sanitizeName(params.name) || 'Player',
      color: params.color,
    };

    // One socket per player: a second tab replaces the first rather than
    // producing a ghost seat that never answers.
    for (const [id, existing] of this.connections) {
      if (existing.clientId !== connection.clientId) continue;
      this.connections.delete(id);
      try {
        existing.socket.close(4000, 'Replaced by a newer connection');
      } catch {
        // Already gone.
      }
    }

    this.connections.set(connection.id, connection);
    this.limiters.set(server, new RateLimiter());

    room.join(connection.clientId, connection.name, connection.color, connection.id);
    this.touch();

    server.addEventListener('message', (event) => {
      this.onMessage(connection, event.data);
    });
    const drop = () => this.onClose(connection);
    server.addEventListener('close', drop);
    server.addEventListener('error', drop);

    // Send the current state immediately so the client never renders empty.
    sendEvent(server, 'room:state', room.snapshot());
    this.publish();
    this.beginIfReady(false);

    return new Response(null, { status: 101, webSocket: client });
  }

  private onClose(connection: Connection): void {
    if (this.connections.get(connection.id) !== connection) return;
    this.connections.delete(connection.id);
    if (!this.room) return;
    this.room.markDisconnected(connection.id);
    this.publish();
  }

  /* ---------------------------------------------------------------- *
   * Messages
   * ---------------------------------------------------------------- */

  private onMessage(connection: Connection, raw: unknown): void {
    const room = this.room;
    if (!room) return;

    const limiter = this.limiters.get(connection.socket);
    if (limiter?.exceeded()) {
      sendError(connection.socket, undefined, 'RATE_LIMITED');
      return;
    }

    const message = parseWire<WireRequest>(raw);
    if (!message || typeof message.t !== 'string') return;
    this.touch();

    const seat = room.findBySocket(connection.id);
    if (!seat) {
      sendError(connection.socket, message.i, 'ROOM_NOT_FOUND');
      return;
    }

    switch (message.t) {
      case 'round:guess': {
        const payload = message.d as { questionId?: unknown; guess?: unknown } | undefined;
        if (typeof payload?.questionId !== 'string' || !isGuess(payload.guess)) {
          sendError(connection.socket, message.i, 'BAD_REQUEST', 'That guess was malformed.');
          return;
        }
        const accepted = room.submitGuess(seat.id, payload.questionId, payload.guess);
        if (!accepted) {
          sendError(connection.socket, message.i, 'BAD_REQUEST', 'Too late, or already locked in.');
          return;
        }
        sendOk(connection.socket, message.i, { locked: true });
        return;
      }

      case 'round:ready':
        room.markReady(seat.id);
        sendOk(connection.socket, message.i, { ready: true });
        return;

      case 'room:rename': {
        const name = (message.d as { name?: unknown } | undefined)?.name;
        room.rename(seat.id, typeof name === 'string' ? name : '');
        this.publish();
        sendOk(connection.socket, message.i, room.snapshot());
        return;
      }

      case 'room:settings': {
        if (room.visibility === 'public') {
          sendError(connection.socket, message.i, 'NOT_HOST', 'Matchmade games use fixed settings.');
          return;
        }
        if (seat.id !== room.hostId) {
          sendError(connection.socket, message.i, 'NOT_HOST');
          return;
        }
        room.updateSettings(sanitizeSettings(message.d));
        sendOk(connection.socket, message.i, room.snapshot());
        return;
      }

      case 'game:start': {
        if (room.visibility === 'public') {
          sendError(connection.socket, message.i, 'NOT_HOST', 'Matchmade games start on their own.');
          return;
        }
        if (seat.id !== room.hostId) {
          sendError(connection.socket, message.i, 'NOT_HOST');
          return;
        }
        if (room.inProgress) {
          sendError(connection.socket, message.i, 'GAME_IN_PROGRESS');
          return;
        }
        if (!room.canStart()) {
          const needed = MODES[room.mode].minPlayers;
          sendError(
            connection.socket,
            message.i,
            'NOT_ENOUGH_PLAYERS',
            `${MODES[room.mode].label} needs ${needed} players.`,
          );
          return;
        }
        room.start();
        sendOk(connection.socket, message.i, room.snapshot());
        return;
      }

      case 'game:rematch': {
        if (room.visibility === 'public') {
          sendError(connection.socket, message.i, 'NOT_HOST', 'Search for a new match instead.');
          return;
        }
        if (seat.id !== room.hostId) {
          sendError(connection.socket, message.i, 'NOT_HOST');
          return;
        }
        if (!room.canStart()) {
          sendError(connection.socket, message.i, 'NOT_ENOUGH_PLAYERS');
          return;
        }
        room.rematch();
        sendOk(connection.socket, message.i, room.snapshot());
        return;
      }

      case 'room:leave': {
        room.leave(seat.id);
        this.connections.delete(connection.id);
        this.publish();
        sendOk(connection.socket, message.i, { left: true });
        try {
          connection.socket.close(1000, 'Left the room');
        } catch {
          // Already closing.
        }
        return;
      }

      case 'ping':
        sendOk(connection.socket, message.i, { serverTime: Date.now() });
        return;

      default:
        sendError(connection.socket, message.i, 'BAD_REQUEST', 'Unknown message.');
    }
  }

  /* ---------------------------------------------------------------- *
   * Starting
   * ---------------------------------------------------------------- */

  /** Begin a matchmade game once its party has arrived (or time is up). */
  private beginIfReady(timedOut: boolean): void {
    const room = this.room;
    if (!room || this.started || room.visibility !== 'public') return;
    if (this.reserved.size === 0) return;

    const present = new Set(
      [...this.connections.values()].map((connection) => connection.clientId),
    );
    const everyone = [...this.reserved].every((clientId) => present.has(clientId));
    if (!everyone && !timedOut) return;

    if (this.reservationTimer) clearTimeout(this.reservationTimer);
    this.reservationTimer = null;

    if (room.connectedCount < MODES[room.mode].minPlayers) {
      // Not enough of the party turned up to play at all.
      if (timedOut) this.shutdown('Nobody arrived for this match.');
      return;
    }

    this.started = true;
    room.autoStart(MATCH_INTRO_MS);
  }

  /* ---------------------------------------------------------------- *
   * Housekeeping
   * ---------------------------------------------------------------- */

  private publish(): void {
    if (!this.room) return;
    broadcastEvent(this.connections.values(), 'room:state', this.room.snapshot());
  }

  private touch(): void {
    this.lastActivity = Date.now();
  }

  async alarm(): Promise<void> {
    const room = this.room;
    const idleFor = Date.now() - this.lastActivity;

    if (room && room.sweepDisconnected()) this.publish();

    const empty = !room || room.isEmpty || this.connections.size === 0;
    if ((empty && idleFor > 3 * 60_000) || idleFor > IDLE_TTL_MS) {
      this.shutdown('This room expired.');
      return;
    }

    await this.state.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
  }

  /** Release the room and, with it, its code. */
  private shutdown(reason: string): void {
    for (const connection of this.connections.values()) {
      sendEvent(connection.socket, 'room:closed', { reason });
      try {
        connection.socket.close(1001, reason);
      } catch {
        // Already gone.
      }
    }
    this.connections.clear();
    this.room?.dispose();
    this.room = null;
    this.record = null;
    if (this.reservationTimer) clearTimeout(this.reservationTimer);
    this.reservationTimer = null;
    void this.state.storage.deleteAll();
  }
}

/* --- Validation ------------------------------------------------------- */

/** Structural only — the room still validates the guess against the question. */
function isGuess(value: unknown): value is Guess {
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

function sanitizeSettings(value: unknown): Partial<RoomSettings> {
  if (!value || typeof value !== 'object') return {};
  const patch = value as Partial<RoomSettings>;
  const out: Partial<RoomSettings> = {};
  if (patch.timer === 'relaxed' || patch.timer === 'standard' || patch.timer === 'blitz') {
    out.timer = patch.timer;
  }
  if (typeof patch.rounds === 'number' && Number.isFinite(patch.rounds)) out.rounds = patch.rounds;
  return out;
}
