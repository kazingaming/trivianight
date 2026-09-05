/**
 * A single multiplayer room.
 *
 * The room owns the truth: which question is live, when the clock expires,
 * what everyone guessed and what the score is. Clients only ever receive
 * snapshots, and guesses are held here until every seat has locked in.
 */

import { QuestionPool } from '@trivia/content';
import {
  computeRoundPoints,
  extendsStreak,
  guessLabel,
  MODES,
  resolveTimeLimit,
  sanitizeName,
  scoreGuess,
  toPublicQuestion,
  toRevealPayload,
  uniqueName,
  type FinalResult,
  type FinalStanding,
  type GameMode,
  type Guess,
  type PlayerRoundResult,
  type PublicPlayer,
  type PublicQuestion,
  type Question,
  type RoomPhase,
  type RoomSettings,
  type RoomSnapshot,
  type RoomVisibility,
  type RoundReveal,
  type EndReason,
} from '@trivia/shared';

export const COUNTDOWN_MS = 3200;
/** A beat between the last lock-in and the reveal, so it lands rather than snaps. */
export const ALL_LOCKED_DELAY_MS = 900;
/** How long a seat is held open for someone who dropped out. */
export const DISCONNECT_GRACE_MS = 90_000;
/**
 * A public match that falls below its minimum player count is given this long
 * to recover before it is called off. Ninety seconds of staring at a dead duel
 * is worse than an honest "your opponent left".
 */
export const ABANDON_GRACE_MS = 25_000;

export interface PlayerSeat {
  id: string;
  socketId: string | null;
  name: string;
  color: number;
  score: number;
  streak: number;
  roundsWon: number;
  ready: boolean;
  connected: boolean;
  disconnectedAt: number | null;
  guess: Guess | null;
  guessAt: number | null;
  bestAccuracy: number;
  bestRound: number | null;
  joinedAt: number;
}

type Broadcast = (room: Room) => void;
type Notify = (room: Room, event: 'allLocked', payload: unknown) => void;

export class Room {
  readonly code: string;
  readonly mode: GameMode;
  readonly visibility: RoomVisibility;
  readonly createdAt = Date.now();

  phase: RoomPhase = 'lobby';
  round = 0;
  /** Empty string in a public room: matchmade games have no party leader. */
  hostId: string;
  settings: RoomSettings;
  lastActivity = Date.now();

  private readonly players = new Map<string, PlayerSeat>();
  private pool: QuestionPool;
  private question: Question | null = null;
  private publicQuestion: PublicQuestion | null = null;
  private deadline: number | null = null;
  private questionStartedAt: number | null = null;
  private startsAt: number | null = null;
  private revealUntil: number | null = null;
  private reveal: RoundReveal | null = null;
  private final: FinalResult | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Separate from `timer` so an abandonment check cannot cancel the round. */
  private abandonTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(
    code: string,
    mode: GameMode,
    hostId: string,
    settings: Partial<RoomSettings> | undefined,
    private readonly broadcast: Broadcast,
    private readonly notify: Notify,
    visibility: RoomVisibility = 'private',
  ) {
    this.code = code;
    this.mode = mode;
    this.visibility = visibility;
    this.hostId = visibility === 'public' ? '' : hostId;
    this.settings = {
      timer: settings?.timer ?? 'standard',
      rounds: clampRounds(mode, settings?.rounds ?? MODES[mode].rounds ?? 10),
    };
    this.pool = new QuestionPool({ mode, seed: `${code}:${this.createdAt}` });
  }

  /* ---------------------------------------------------------------- *
   * Membership
   * ---------------------------------------------------------------- */

  get playerCount(): number {
    return this.players.size;
  }

  get connectedCount(): number {
    return [...this.players.values()].filter((player) => player.connected).length;
  }

  get isFull(): boolean {
    return this.players.size >= MODES[this.mode].maxPlayers;
  }

  get isEmpty(): boolean {
    return this.players.size === 0;
  }

  get inProgress(): boolean {
    return this.phase !== 'lobby' && this.phase !== 'final';
  }

  hasSeat(clientId: string): boolean {
    return this.players.has(clientId);
  }

  getSeat(clientId: string): PlayerSeat | undefined {
    return this.players.get(clientId);
  }

  findBySocket(socketId: string): PlayerSeat | undefined {
    for (const player of this.players.values()) {
      if (player.socketId === socketId) return player;
    }
    return undefined;
  }

  /**
   * Seat a player, or reattach one who dropped. Returning players keep their
   * score, colour and host status — a refresh should cost nothing.
   */
  join(clientId: string, name: string, color: number, socketId: string): PlayerSeat {
    this.touch();
    const existing = this.players.get(clientId);
    if (existing) {
      existing.socketId = socketId;
      existing.connected = true;
      existing.disconnectedAt = null;
      // Let a returning player pick up a name change from another device.
      const desired = sanitizeName(name);
      if (desired && desired !== existing.name) {
        existing.name = uniqueName(desired, this.takenNames(clientId));
      }
      return existing;
    }

    const seat: PlayerSeat = {
      id: clientId,
      socketId,
      name: uniqueName(sanitizeName(name) || 'Player', this.takenNames()),
      color: this.nextColor(color),
      score: 0,
      streak: 0,
      roundsWon: 0,
      ready: false,
      connected: true,
      disconnectedAt: null,
      guess: null,
      guessAt: null,
      bestAccuracy: 0,
      bestRound: null,
      joinedAt: Date.now(),
    };
    this.players.set(clientId, seat);
    // Private rooms need a party leader; matchmade ones must never acquire one.
    if (this.visibility === 'private' && !this.players.has(this.hostId)) {
      this.hostId = clientId;
    }
    return seat;
  }

  rename(clientId: string, name: string): void {
    const seat = this.players.get(clientId);
    if (!seat) return;
    const desired = sanitizeName(name);
    if (!desired) return;
    seat.name = uniqueName(desired, this.takenNames(clientId));
    this.touch();
  }

  markDisconnected(socketId: string): PlayerSeat | undefined {
    const seat = this.findBySocket(socketId);
    if (!seat) return undefined;
    seat.socketId = null;
    seat.connected = false;
    seat.disconnectedAt = Date.now();
    this.reassignHostIfNeeded();
    this.checkAbandonment();
    // Their absence may be the only thing the round was waiting on.
    if (this.phase === 'question') this.maybeCloseRound();
    return seat;
  }

  leave(clientId: string): void {
    this.players.delete(clientId);
    this.reassignHostIfNeeded();
    this.checkAbandonment();
    this.touch();
    if (this.phase === 'question') this.maybeCloseRound();
  }

  /** Evict seats whose grace period has expired. Returns true if anything changed. */
  sweepDisconnected(now = Date.now()): boolean {
    let changed = false;
    for (const [id, seat] of this.players) {
      if (seat.connected || seat.disconnectedAt === null) continue;
      if (now - seat.disconnectedAt > DISCONNECT_GRACE_MS) {
        this.players.delete(id);
        changed = true;
      }
    }
    if (changed) {
      this.reassignHostIfNeeded();
      this.checkAbandonment();
      if (this.phase === 'question') this.maybeCloseRound();
    }
    return changed;
  }

  private takenNames(exceptId?: string): string[] {
    return [...this.players.values()]
      .filter((player) => player.id !== exceptId)
      .map((player) => player.name);
  }

  /** Honour the requested colour unless it is taken, then find the next free one. */
  private nextColor(preferred: number): number {
    const used = new Set([...this.players.values()].map((player) => player.color));
    const start = Number.isInteger(preferred) ? ((preferred % 8) + 8) % 8 : 0;
    for (let offset = 0; offset < 8; offset++) {
      const candidate = (start + offset) % 8;
      if (!used.has(candidate)) return candidate;
    }
    return start;
  }

  private reassignHostIfNeeded(): void {
    // Matchmade rooms never have a host, so there is nothing to hand over.
    if (this.visibility === 'public') return;
    if (this.players.has(this.hostId) && this.players.get(this.hostId)!.connected) return;
    // Prefer a connected player; fall back to whoever has been here longest.
    const candidates = [...this.players.values()].sort((a, b) => a.joinedAt - b.joinedAt);
    const next = candidates.find((player) => player.connected) ?? candidates[0];
    if (next) this.hostId = next.id;
  }

  /**
   * A public match with too few players left is on borrowed time.
   * We wait a grace period in case it was a blip, then end it honestly rather
   * than leaving someone alone in a duel for the rest of the rounds.
   */
  private checkAbandonment(): void {
    if (this.visibility !== 'public' || !this.inProgress) return;
    const minimum = MODES[this.mode].minPlayers;

    if (this.connectedCount >= minimum) {
      if (this.abandonTimer) clearTimeout(this.abandonTimer);
      this.abandonTimer = null;
      return;
    }
    if (this.abandonTimer) return;

    this.abandonTimer = setTimeout(() => {
      this.abandonTimer = null;
      if (this.closed || !this.inProgress) return;
      if (this.connectedCount >= MODES[this.mode].minPlayers) return;
      this.finish('abandoned');
    }, ABANDON_GRACE_MS);
    this.abandonTimer.unref?.();
  }

  /* ---------------------------------------------------------------- *
   * Game flow
   * ---------------------------------------------------------------- */

  updateSettings(patch: Partial<RoomSettings>): void {
    // Matchmade games use fixed settings — there is nobody entitled to change them.
    if (this.visibility === 'public') return;
    if (this.phase !== 'lobby' && this.phase !== 'final') return;
    if (patch.timer) this.settings.timer = patch.timer;
    if (patch.rounds !== undefined) {
      this.settings.rounds = clampRounds(this.mode, patch.rounds);
    }
    this.touch();
    this.publish();
  }

  canStart(): boolean {
    return this.connectedCount >= MODES[this.mode].minPlayers;
  }

  start(): void {
    if (this.inProgress) return;
    this.round = 0;
    this.final = null;
    this.reveal = null;
    for (const player of this.players.values()) {
      player.score = 0;
      player.streak = 0;
      player.roundsWon = 0;
      player.bestAccuracy = 0;
      player.bestRound = null;
      player.ready = false;
    }
    this.pool = new QuestionPool({ mode: this.mode, seed: `${this.code}:${Date.now()}` });
    this.phase = 'countdown';
    this.startsAt = Date.now() + COUNTDOWN_MS;
    this.touch();
    this.publish();
    this.schedule(() => this.nextRound(), COUNTDOWN_MS);
  }

  rematch(): void {
    if (this.phase !== 'final') return;
    this.start();
  }

  /**
   * Begin a matchmade game.
   *
   * Nobody presses start in a public match — the server does, once the party
   * is seated and the "opponent found" beat has had time to play.
   */
  autoStart(delayMs: number): void {
    if (this.visibility !== 'public' || this.inProgress) return;
    this.phase = 'countdown';
    this.startsAt = Date.now() + delayMs;
    this.touch();
    this.publish();
    this.schedule(() => {
      // Re-check: someone may have dropped between matching and starting.
      if (this.closed) return;
      if (this.connectedCount < MODES[this.mode].minPlayers) {
        this.finish('abandoned');
        return;
      }
      this.round = 0;
      this.nextRound();
    }, delayMs);
  }

  /** When the first question opens, for the match-found screen's countdown. */
  get startingAt(): number | null {
    return this.startsAt;
  }

  private nextRound(): void {
    if (this.closed) return;
    if (this.round >= this.settings.rounds) return this.finish();

    const question = this.pool.next(this.round + 1);
    if (!question) return this.finish('pool-exhausted');

    this.round += 1;
    this.question = question;
    this.publicQuestion = toPublicQuestion(question);
    this.reveal = null;
    this.startsAt = null;
    for (const player of this.players.values()) {
      player.guess = null;
      player.guessAt = null;
      player.ready = false;
    }

    const seconds = resolveTimeLimit(this.mode, this.settings.timer, question.timeLimitSec);
    this.phase = 'question';
    this.questionStartedAt = Date.now();
    this.deadline = this.questionStartedAt + seconds * 1000;
    this.touch();
    this.publish();
    this.schedule(() => this.closeRound(), seconds * 1000 + 250);
  }

  /** Record a guess. Returns false if it arrived too late or out of context. */
  submitGuess(clientId: string, questionId: string, guess: Guess): boolean {
    if (this.phase !== 'question' || !this.question) return false;
    if (questionId !== this.question.id) return false;
    const seat = this.players.get(clientId);
    if (!seat || seat.guess) return false;
    if (this.deadline !== null && Date.now() > this.deadline + 1500) return false;

    seat.guess = guess;
    seat.guessAt = Date.now();
    this.touch();
    this.publish();
    this.maybeCloseRound();
    return true;
  }

  /** Everyone who *can* answer has answered — close early. */
  private maybeCloseRound(): void {
    if (this.phase !== 'question') return;
    const active = [...this.players.values()].filter((player) => player.connected);
    if (active.length === 0) return;
    if (!active.every((player) => player.guess !== null)) return;

    this.notify(this, 'allLocked', { round: this.round });
    this.schedule(() => this.closeRound(), ALL_LOCKED_DELAY_MS);
  }

  private closeRound(): void {
    if (this.closed || this.phase !== 'question' || !this.question || !this.publicQuestion) return;

    const question = this.question;
    const publicQuestion = this.publicQuestion;
    const seats = [...this.players.values()];
    const openedAt = this.questionStartedAt ?? Date.now();
    const timeLimitMs = Math.max(1, (this.deadline ?? openedAt + 1) - openedAt);

    const scored = seats.map((seat) => {
      const speed =
        seat.guessAt === null ? 0 : 1 - Math.min(1, Math.max(0, (seat.guessAt - openedAt) / timeLimitMs));
      return { seat, score: scoreGuess(question, seat.guess, { speed }) };
    });

    // Closest player: highest accuracy, ties broken by who committed first.
    const contenders = scored.filter((entry) => entry.score.answered && entry.score.accuracy > 0);
    let closestId: string | null = null;
    if (contenders.length > 0) {
      const best = contenders.reduce((leader, entry) => {
        if (entry.score.accuracy > leader.score.accuracy) return entry;
        if (entry.score.accuracy < leader.score.accuracy) return leader;
        return (entry.seat.guessAt ?? Infinity) < (leader.seat.guessAt ?? Infinity) ? entry : leader;
      });
      closestId = best.seat.id;
    }

    const answeredCount = scored.filter((entry) => entry.score.answered).length;

    const results: PlayerRoundResult[] = scored.map(({ seat, score }) => {
      const closest = seat.id === closestId;
      const points = computeRoundPoints({
        score,
        difficulty: question.difficulty,
        streak: seat.streak,
        closest,
        contenders: answeredCount,
      });

      seat.score += points.total;
      seat.streak = extendsStreak(score) ? seat.streak + 1 : 0;
      if (closest) seat.roundsWon += 1;
      if (score.accuracy > seat.bestAccuracy) {
        seat.bestAccuracy = score.accuracy;
        seat.bestRound = this.round;
      }

      return {
        playerId: seat.id,
        guess: seat.guess ?? { kind: 'none' },
        guessLabel: guessLabel(publicQuestion, seat.guess),
        accuracy: score.accuracy,
        band: score.band,
        missLabel: score.miss?.label ?? null,
        points,
        closest,
        totalScore: seat.score,
        answered: score.answered,
        correct: score.correct,
      };
    });

    results.sort((a, b) => b.accuracy - a.accuracy);

    this.reveal = {
      round: this.round,
      questionId: question.id,
      question: publicQuestion,
      payload: toRevealPayload(question),
      results,
    };
    this.phase = 'reveal';
    this.deadline = null;
    this.questionStartedAt = null;
    const revealMs = MODES[this.mode].revealDuration * 1000;
    this.revealUntil = Date.now() + revealMs;
    this.touch();
    this.publish();
    this.schedule(() => this.nextRound(), revealMs);
  }

  /** A player tapped "ready" during a reveal. Everyone ready skips the wait. */
  markReady(clientId: string): void {
    if (this.phase !== 'reveal') return;
    const seat = this.players.get(clientId);
    if (!seat || seat.ready) return;
    seat.ready = true;
    this.touch();
    this.publish();

    const active = [...this.players.values()].filter((player) => player.connected);
    if (active.length > 0 && active.every((player) => player.ready)) {
      this.schedule(() => this.nextRound(), 350);
    }
  }

  private finish(reason: EndReason = 'complete'): void {
    const standings: FinalStanding[] = [...this.players.values()]
      .sort((a, b) => b.score - a.score || b.roundsWon - a.roundsWon)
      .map((seat, index) => ({
        playerId: seat.id,
        name: seat.name,
        color: seat.color,
        score: seat.score,
        rank: index + 1,
        roundsWon: seat.roundsWon,
        bestAccuracy: seat.bestAccuracy,
        bestRound: seat.bestRound,
      }));

    // Equal scores share the rank rather than being ordered arbitrarily.
    for (let i = 1; i < standings.length; i++) {
      if (standings[i].score === standings[i - 1].score) standings[i].rank = standings[i - 1].rank;
    }

    const topScore = standings[0]?.score ?? 0;
    this.final = {
      standings,
      winnerIds: standings.filter((entry) => entry.score === topScore).map((entry) => entry.playerId),
      reason,
    };
    this.phase = 'final';
    this.question = null;
    this.publicQuestion = null;
    this.deadline = null;
    this.questionStartedAt = null;
    this.revealUntil = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.touch();
    this.publish();
  }

  /* ---------------------------------------------------------------- *
   * Snapshots
   * ---------------------------------------------------------------- */

  snapshot(): RoomSnapshot {
    return {
      code: this.code,
      mode: this.mode,
      visibility: this.visibility,
      phase: this.phase,
      round: this.round,
      totalRounds: this.settings.rounds,
      hostId: this.hostId,
      players: this.publicPlayers(),
      settings: { ...this.settings },
      question: this.phase === 'question' ? this.publicQuestion ?? undefined : undefined,
      deadline: this.deadline ?? undefined,
      questionStartedAt: this.phase === 'question' ? this.questionStartedAt ?? undefined : undefined,
      startsAt: this.startsAt ?? undefined,
      revealUntil: this.phase === 'reveal' ? this.revealUntil ?? undefined : undefined,
      reveal: this.phase === 'reveal' ? this.reveal ?? undefined : undefined,
      final: this.phase === 'final' ? this.final ?? undefined : undefined,
      serverTime: Date.now(),
      poolRemaining: this.pool.remaining,
    };
  }

  private publicPlayers(): PublicPlayer[] {
    return [...this.players.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((seat) => ({
        id: seat.id,
        name: seat.name,
        color: seat.color,
        isHost: seat.id === this.hostId,
        connected: seat.connected,
        activity: !seat.connected
          ? ('disconnected' as const)
          : this.phase === 'question'
            ? seat.guess
              ? ('locked' as const)
              : ('thinking' as const)
            : ('waiting' as const),
        score: seat.score,
        streak: seat.streak,
        ready: seat.ready,
        roundsWon: seat.roundsWon,
      }));
  }

  publish(): void {
    if (!this.closed) this.broadcast(this);
  }

  private schedule(action: () => void, delayMs: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      try {
        action();
      } catch (error) {
        console.error(`[room ${this.code}] scheduled action failed`, error);
      }
    }, Math.max(0, delayMs));
  }

  private touch(): void {
    this.lastActivity = Date.now();
  }

  dispose(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.abandonTimer) clearTimeout(this.abandonTimer);
    this.timer = null;
    this.abandonTimer = null;
  }
}

function clampRounds(mode: GameMode, rounds: number): number {
  const fallback = MODES[mode].rounds ?? 10;
  if (!Number.isFinite(rounds)) return fallback;
  return Math.min(20, Math.max(3, Math.round(rounds)));
}
