/**
 * MatchmakerDO — a single global Durable Object holding the public queues.
 *
 * One instance for the whole game is the right shape: matchmaking is inherently
 * a rendezvous problem, and a Durable Object is the platform's answer to "one
 * place everybody agrees on". At this scale a single object is nowhere near its
 * throughput ceiling, and keeping the queues together means a player can never
 * hold a place in two of them at once.
 *
 * There is no polling loop. Party sizes are fixed, so a match can only become
 * possible when the queue changes; an alarm runs only while somebody is
 * waiting, purely to evict tickets whose sockets died without a close frame.
 */

import { Matchmaker, type Ticket } from '@trivia/engine';
import {
  createRoomCode,
  MODES,
  parseWire,
  readConnectParams,
  roomError,
  sanitizeName,
  type MatchFound,
  type QueueMode,
  type QueueStatus,
  type WireRequest,
} from '@trivia/shared';

import {
  errorResponse,
  jsonResponse,
  nextConnectionId,
  RateLimiter,
  sendError,
  sendEvent,
  sendOk,
  type Connection,
} from './ws.js';

/** Sweep cadence while anybody is queued. Stops when the queue empties. */
const SWEEP_INTERVAL_MS = 30_000;
/** How many codes to try before giving up on finding a free one. */
const CODE_ATTEMPTS = 12;

export class MatchmakerDO implements DurableObject {
  private readonly connections = new Map<string, Connection>();
  private readonly limiters = new WeakMap<WebSocket, RateLimiter>();
  private readonly matchmaker: Matchmaker;
  private alarmScheduled = false;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {
    this.matchmaker = new Matchmaker({
      isConnected: (socketId) => this.connections.has(socketId),

      onStatus: (ticket, progress, queueDepth) => {
        const connection = this.connections.get(ticket.socketId);
        if (!connection) return;
        sendEvent<QueueStatus>(connection.socket, 'queue:update', {
          mode: ticket.mode,
          phase: 'searching',
          found: Math.min(queueDepth, progress.target),
          target: progress.target,
          idealTarget: progress.idealTarget,
          searchingSince: ticket.enqueuedAt,
          queueDepth,
          serverTime: Date.now(),
        });
      },

      /*
       * Building a room is asynchronous, but the engine wants a synchronous
       * yes or no. We accept immediately and, if the room cannot be created,
       * put the party back in the queue rather than dropping them.
       */
      onMatch: (mode, tickets) => {
        void this.createMatch(mode, tickets);
        return true;
      },
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/ws') return this.handleUpgrade(request, url);
    if (url.pathname === '/stats') return jsonResponse(this.matchmaker.stats());
    return new Response('Not found', { status: 404 });
  }

  /* ---------------------------------------------------------------- *
   * Connections
   * ---------------------------------------------------------------- */

  private handleUpgrade(request: Request, url: URL): Response {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426 });
    }

    const params = readConnectParams(url);
    if (!params) return errorResponse(400, roomError('BAD_REQUEST', 'Missing player details.'));

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();

    const connection: Connection = {
      id: nextConnectionId('q'),
      socket: server,
      clientId: params.clientId,
      name: sanitizeName(params.name) || 'Player',
      color: params.color,
    };

    // A player searching from a new tab replaces their old search.
    for (const [id, existing] of this.connections) {
      if (existing.clientId !== connection.clientId) continue;
      this.connections.delete(id);
      this.matchmaker.cancelBySocket(id);
      try {
        existing.socket.close(4000, 'Replaced by a newer search');
      } catch {
        // Already gone.
      }
    }

    this.connections.set(connection.id, connection);
    this.limiters.set(server, new RateLimiter(20, 1000));

    server.addEventListener('message', (event) => this.onMessage(connection, event.data));
    const drop = () => this.onClose(connection);
    server.addEventListener('close', drop);
    server.addEventListener('error', drop);

    return new Response(null, { status: 101, webSocket: client });
  }

  private onClose(connection: Connection): void {
    if (this.connections.get(connection.id) !== connection) return;
    this.connections.delete(connection.id);
    // Closing the tab is how most searches end. Leave no ghost behind.
    this.matchmaker.cancelBySocket(connection.id);
    this.matchmaker.tick();
  }

  private onMessage(connection: Connection, raw: unknown): void {
    const limiter = this.limiters.get(connection.socket);
    if (limiter?.exceeded()) {
      sendError(connection.socket, undefined, 'RATE_LIMITED');
      return;
    }

    const message = parseWire<WireRequest>(raw);
    if (!message || typeof message.t !== 'string') return;

    switch (message.t) {
      case 'queue:join': {
        const payload = message.d as { mode?: unknown; name?: unknown } | undefined;
        const mode = payload?.mode;
        if (mode !== 'duel' && mode !== 'ffa') {
          sendError(connection.socket, message.i, 'BAD_REQUEST', 'Unknown queue.');
          return;
        }
        if (typeof payload?.name === 'string') {
          connection.name = sanitizeName(payload.name) || connection.name;
        }

        const ticket = this.matchmaker.enqueue({
          clientId: connection.clientId,
          socketId: connection.id,
          name: connection.name,
          color: connection.color,
          mode,
        });

        const depth = this.matchmaker.depth(mode);
        sendOk<QueueStatus>(connection.socket, message.i, {
          mode,
          phase: 'searching',
          found: Math.min(depth, MODES[mode].maxPlayers),
          target: MODES[mode].maxPlayers,
          idealTarget: MODES[mode].maxPlayers,
          searchingSince: ticket.enqueuedAt,
          queueDepth: depth,
          serverTime: Date.now(),
        });

        // Fixed party sizes mean a join is the only moment a match can appear.
        this.matchmaker.tick();
        void this.ensureAlarm();
        return;
      }

      case 'queue:leave': {
        this.matchmaker.cancel(connection.clientId);
        this.matchmaker.tick();
        sendOk(connection.socket, message.i, { left: true });
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
   * Match creation
   * ---------------------------------------------------------------- */

  private async createMatch(mode: QueueMode, tickets: Ticket[]): Promise<void> {
    // Drop anyone whose socket died in the moment between matching and this.
    const party = tickets.filter((ticket) => this.connections.has(ticket.socketId));
    if (party.length !== tickets.length) {
      this.requeue(party);
      return;
    }

    const code = await this.allocateRoom(mode, party);
    if (!code) {
      console.error(`[matchmaking] could not allocate a ${mode} room`);
      this.requeue(party);
      return;
    }

    const payload: MatchFound = {
      code,
      mode,
      players: party.map((ticket) => ({
        id: ticket.clientId,
        name: ticket.name,
        color: ticket.color,
      })),
      // The room opens its own countdown once the party connects; this is
      // only so the client can pace the "found" animation.
      startsAt: Date.now() + 3600,
    };

    for (const ticket of party) {
      const connection = this.connections.get(ticket.socketId);
      if (connection) sendEvent(connection.socket, 'queue:matched', payload);
    }
    console.log(`[matchmaking] ${mode} match ${code} with ${party.length} players`);
  }

  /** Find a free room code and initialise its Durable Object. */
  private async allocateRoom(mode: QueueMode, party: Ticket[]): Promise<string | null> {
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
      const code = createRoomCode(attempt < 8 ? 4 : 5);
      const stub = this.env.ROOM.get(this.env.ROOM.idFromName(code));
      const response = await stub.fetch(`https://room/init?code=${code}`, {
        method: 'POST',
        body: JSON.stringify({
          mode,
          visibility: 'public',
          settings: { timer: 'standard' },
          reserved: party.map((ticket) => ({
            clientId: ticket.clientId,
            name: ticket.name,
            color: ticket.color,
          })),
        }),
      });
      if (response.ok) return code;
      // 409 means the code is taken; anything else is worth another try too.
    }
    return null;
  }

  private requeue(party: Ticket[]): void {
    for (const ticket of party) {
      if (!this.connections.has(ticket.socketId)) continue;
      this.matchmaker.enqueue({
        clientId: ticket.clientId,
        socketId: ticket.socketId,
        name: ticket.name,
        color: ticket.color,
        mode: ticket.mode,
      });
    }
    this.matchmaker.tick();
  }

  /* ---------------------------------------------------------------- *
   * Housekeeping
   * ---------------------------------------------------------------- */

  private async ensureAlarm(): Promise<void> {
    if (this.alarmScheduled) return;
    const existing = await this.state.storage.getAlarm();
    if (existing !== null) {
      this.alarmScheduled = true;
      return;
    }
    await this.state.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS);
    this.alarmScheduled = true;
  }

  async alarm(): Promise<void> {
    this.alarmScheduled = false;
    // Evicts tickets whose socket vanished without a close frame, then tries
    // to form matches from whoever genuinely remains.
    this.matchmaker.tick();

    // Only keep the alarm running while there is something to look after.
    if (!this.matchmaker.isEmpty) {
      await this.state.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS);
      this.alarmScheduled = true;
    }
  }
}
