/**
 * Matchmaking.
 *
 * Players queue for a mode; the matchmaker gathers compatible tickets and
 * hands finished parties to the caller, which builds the room.
 *
 * The pairing rule lives behind `MatchmakingPolicy`. Today there is exactly
 * one implementation — first come, first served — because there is no rating
 * to match on. When Elo, regions or a ranked split arrive, they become a new
 * policy: the queue, the ticket lifecycle, the sweeper, the status pushes and
 * the socket protocol all stay as they are.
 */

import { MODES, createId, type GameMode, type QueueMode, type TicketAttributes } from '@trivia/shared';

/** A player waiting in a queue. */
export interface Ticket {
  id: string;
  /** Stable player identity. One ticket per player, always. */
  clientId: string;
  socketId: string;
  name: string;
  color: number;
  mode: QueueMode;
  enqueuedAt: number;
  /** Unused by the current policy; reserved for rating/region matching. */
  attributes: TicketAttributes;
}

/** What the player should be told about their search right now. */
export interface SearchProgress {
  /** How many players are needed to start at this instant. */
  target: number;
  /** The mode's ideal party size, even when we would start smaller. */
  idealTarget: number;
}

export interface MatchmakingPolicy {
  readonly mode: QueueMode;
  /**
   * Whether two waiting players may share a match.
   * Always true today; an Elo policy would compare ratings here, widening the
   * acceptable gap as `now - enqueuedAt` grows.
   */
  isCompatible(a: Ticket, b: Ticket, now: number): boolean;
  /**
   * How large a party the oldest waiting ticket will currently accept.
   * This is where "wait for four, but settle for three after a while" lives.
   */
  progressFor(oldest: Ticket, now: number): SearchProgress;
}

/**
 * The only policy today: pair whoever has been waiting longest.
 *
 * For Free For All the target starts at the ideal party size and relaxes on a
 * schedule, because a four-player queue that never fills is worse than a
 * three-player game. It never fills seats with bots — every player in a match
 * is a real one, and the UI says how many are in.
 */
export class FirstComePolicy implements MatchmakingPolicy {
  constructor(
    readonly mode: QueueMode,
    /** [millisecondsWaited, acceptableSize] pairs, largest size first. */
    private readonly relaxation: Array<[number, number]>,
  ) {}

  isCompatible(): boolean {
    return true;
  }

  progressFor(oldest: Ticket, now: number): SearchProgress {
    const waited = now - oldest.enqueuedAt;
    const ideal = MODES[this.mode as GameMode].maxPlayers;
    let target = ideal;
    for (const [after, size] of this.relaxation) {
      if (waited >= after) target = size;
    }
    return { target: Math.max(MODES[this.mode as GameMode].minPlayers, target), idealTarget: ideal };
  }
}

export const DEFAULT_POLICIES: Record<QueueMode, MatchmakingPolicy> = {
  // A duel needs exactly two, so there is nothing to relax.
  duel: new FirstComePolicy('duel', []),
  // Four is the flagship party. After 40s take three, after 75s take two.
  ffa: new FirstComePolicy('ffa', [
    [40_000, 3],
    [75_000, 2],
  ]),
};

/** How long a ticket may sit before we assume the client is gone. */
export const TICKET_MAX_AGE_MS = 10 * 60_000;

export interface MatchmakerHooks {
  /** A party is ready. Return false to reject and requeue the tickets. */
  onMatch: (mode: QueueMode, tickets: Ticket[]) => boolean;
  /** Push queue progress to one player. */
  onStatus: (ticket: Ticket, progress: SearchProgress, queueDepth: number) => void;
  /** The socket is still connected? Used to evict ghosts. */
  isConnected: (socketId: string) => boolean;
}

export class Matchmaker {
  private readonly queues = new Map<QueueMode, Ticket[]>();
  /** clientId -> ticket, so a player can never hold two places at once. */
  private readonly byClient = new Map<string, Ticket>();
  private ticker: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly hooks: MatchmakerHooks,
    private readonly policies: Record<QueueMode, MatchmakingPolicy> = DEFAULT_POLICIES,
    private readonly tickMs = 500,
  ) {
    for (const mode of ['duel', 'ffa'] as QueueMode[]) this.queues.set(mode, []);
  }

  start(): void {
    if (this.ticker) return;
    this.ticker = setInterval(() => this.tick(), this.tickMs);
    this.ticker.unref?.();
  }

  stop(): void {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
  }

  depth(mode: QueueMode): number {
    return this.queues.get(mode)?.length ?? 0;
  }

  ticketFor(clientId: string): Ticket | undefined {
    return this.byClient.get(clientId);
  }

  /**
   * Put a player in a queue.
   *
   * Enqueuing is idempotent per player: a duplicate request for the same mode
   * returns the existing ticket rather than a second place in line, and
   * switching modes moves the player instead of leaving a ghost behind.
   */
  enqueue(input: {
    clientId: string;
    socketId: string;
    name: string;
    color: number;
    mode: QueueMode;
    attributes?: TicketAttributes;
  }): Ticket {
    const existing = this.byClient.get(input.clientId);
    if (existing) {
      if (existing.mode === input.mode) {
        // Same queue: refresh the connection details and keep their place.
        existing.socketId = input.socketId;
        existing.name = input.name;
        existing.color = input.color;
        return existing;
      }
      this.remove(existing);
    }

    const ticket: Ticket = {
      id: createId('t'),
      clientId: input.clientId,
      socketId: input.socketId,
      name: input.name,
      color: input.color,
      mode: input.mode,
      enqueuedAt: Date.now(),
      attributes: input.attributes ?? {},
    };
    this.queues.get(input.mode)!.push(ticket);
    this.byClient.set(ticket.clientId, ticket);
    this.publish(input.mode);
    return ticket;
  }

  /** Leave whatever queue this player is in. */
  cancel(clientId: string): Ticket | null {
    const ticket = this.byClient.get(clientId);
    if (!ticket) return null;
    this.remove(ticket);
    this.publish(ticket.mode);
    return ticket;
  }

  /** A socket dropped: its ticket goes with it. */
  cancelBySocket(socketId: string): Ticket | null {
    for (const ticket of this.byClient.values()) {
      if (ticket.socketId === socketId) {
        this.remove(ticket);
        this.publish(ticket.mode);
        return ticket;
      }
    }
    return null;
  }

  private remove(ticket: Ticket): void {
    const queue = this.queues.get(ticket.mode);
    if (queue) {
      const index = queue.indexOf(ticket);
      if (index >= 0) queue.splice(index, 1);
    }
    // Only clear the index if it still points at this exact ticket.
    if (this.byClient.get(ticket.clientId) === ticket) this.byClient.delete(ticket.clientId);
  }

  /** One matchmaking pass over every queue. Safe to call by hand in tests. */
  tick(now = Date.now()): void {
    this.sweep(now);
    for (const mode of this.queues.keys()) {
      this.formMatches(mode, now);
      this.publish(mode, now);
    }
  }

  /** Drop tickets whose socket has gone or that have waited absurdly long. */
  private sweep(now: number): void {
    for (const [mode, queue] of this.queues) {
      const survivors = queue.filter((ticket) => {
        const alive = this.hooks.isConnected(ticket.socketId);
        const fresh = now - ticket.enqueuedAt < TICKET_MAX_AGE_MS;
        if (alive && fresh) return true;
        if (this.byClient.get(ticket.clientId) === ticket) this.byClient.delete(ticket.clientId);
        return false;
      });
      if (survivors.length !== queue.length) this.queues.set(mode, survivors);
    }
  }

  private formMatches(mode: QueueMode, now: number): void {
    const policy = this.policies[mode];
    let queue = this.queues.get(mode)!;

    // Keep forming while the front of the line can fill a party.
    for (let guard = 0; guard < 32; guard++) {
      if (queue.length === 0) return;
      const oldest = queue[0];
      const { target } = policy.progressFor(oldest, now);
      if (queue.length < target) return;

      const party: Ticket[] = [oldest];
      for (let i = 1; i < queue.length && party.length < target; i++) {
        const candidate = queue[i];
        if (party.every((member) => policy.isCompatible(member, candidate, now))) {
          party.push(candidate);
        }
      }
      if (party.length < target) return;

      // Remove them before handing over, so a slow room build cannot double-match.
      for (const ticket of party) this.remove(ticket);
      queue = this.queues.get(mode)!;

      const accepted = this.hooks.onMatch(mode, party);
      if (!accepted) {
        // The room could not be built. Put them back at the front and stop
        // trying this pass rather than spinning on a broken dependency.
        const restored = this.queues.get(mode)!;
        restored.unshift(...party);
        for (const ticket of party) this.byClient.set(ticket.clientId, ticket);
        return;
      }
    }
  }

  /** Push progress to everyone still waiting in a queue. */
  private publish(mode: QueueMode, now = Date.now()): void {
    const queue = this.queues.get(mode);
    if (!queue || queue.length === 0) return;
    const policy = this.policies[mode];
    const progress = policy.progressFor(queue[0], now);
    for (const ticket of queue) this.hooks.onStatus(ticket, progress, queue.length);
  }

  stats() {
    return {
      duel: this.depth('duel'),
      ffa: this.depth('ffa'),
      waiting: this.byClient.size,
    };
  }

  dispose(): void {
    this.stop();
    this.queues.forEach((_, mode) => this.queues.set(mode, []));
    this.byClient.clear();
  }
}
