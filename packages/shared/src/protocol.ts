/**
 * The wire contract between the browser and the game server.
 *
 * The server is authoritative: it owns the question pool, the clock and the
 * scoreboard. Clients render snapshots and send intent. Answers never travel
 * to other clients before the reveal — not even as an opaque blob.
 */

import type { GameMode, TimerPreference } from './curve.js';
import type { RoundPoints } from './scoring.js';
import type { FeedbackBand } from './scoring.js';
import type { Guess, PublicQuestion, RevealPayload } from './types.js';

export const PLAYER_COLORS = 8;

export type RoomPhase = 'lobby' | 'countdown' | 'question' | 'reveal' | 'final';

export type PlayerActivity = 'waiting' | 'thinking' | 'locked' | 'disconnected';

export interface PublicPlayer {
  id: string;
  name: string;
  /** Index into the client colour palette. Stable for the life of the room. */
  color: number;
  isHost: boolean;
  connected: boolean;
  activity: PlayerActivity;
  score: number;
  streak: number;
  /** Tapped "ready" during a reveal. */
  ready: boolean;
  /** Rounds where this player was the closest. Fun to show on the podium. */
  roundsWon: number;
}

export interface RoomSettings {
  timer: TimerPreference;
  /** Ignored for solo. */
  rounds: number;
}

/**
 * Public rooms come from matchmaking and have no host: nobody starts them,
 * nobody configures them, nobody can kick. Private rooms keep a party leader
 * who presses start — a UX role only, never an authority one.
 */
export type RoomVisibility = 'public' | 'private';

/** Why a match ended before its last round. */
export type EndReason = 'complete' | 'pool-exhausted' | 'abandoned';

export interface PlayerRoundResult {
  playerId: string;
  guess: Guess;
  /** Pre-rendered so every client shows the same string. */
  guessLabel: string;
  accuracy: number;
  band: FeedbackBand;
  /** e.g. "2.2x too low". Null for formats without a notion of distance. */
  missLabel: string | null;
  points: RoundPoints;
  closest: boolean;
  totalScore: number;
  answered: boolean;
  correct: boolean | null;
}

export interface RoundReveal {
  round: number;
  questionId: string;
  question: PublicQuestion;
  payload: RevealPayload;
  results: PlayerRoundResult[];
}

export interface FinalStanding {
  playerId: string;
  name: string;
  color: number;
  score: number;
  rank: number;
  roundsWon: number;
  bestAccuracy: number;
  /** Round number of their single best guess, for the highlight reel. */
  bestRound: number | null;
}

export interface FinalResult {
  standings: FinalStanding[];
  /** Tied first places are all listed. */
  winnerIds: string[];
  /** Lets the podium say "your opponent left" instead of pretending. */
  reason: EndReason;
}

export interface RoomSnapshot {
  code: string;
  mode: GameMode;
  visibility: RoomVisibility;
  phase: RoomPhase;
  round: number;
  totalRounds: number | null;
  hostId: string;
  players: PublicPlayer[];
  settings: RoomSettings;
  /** Present during 'question'. Never contains the answer. */
  question?: PublicQuestion;
  /** Epoch ms when guessing closes. */
  deadline?: number;
  /** Epoch ms when the question opened, so clients can size the timer bar. */
  questionStartedAt?: number;
  /** Epoch ms when the countdown to round one ends. */
  startsAt?: number;
  /** Epoch ms when the reveal auto-advances. */
  revealUntil?: number;
  reveal?: RoundReveal;
  final?: FinalResult;
  /** Lets clients correct for clock skew instead of trusting local time. */
  serverTime: number;
  /** Questions left in the pool; surfaces the "out of questions" end state. */
  poolRemaining: number;
}

/* -------------------------------------------------------------------- *
 * Matchmaking
 * -------------------------------------------------------------------- */

/** Only the two public modes can be queued for. */
export type QueueMode = 'duel' | 'ffa';

/**
 * Attributes a matchmaking policy may consider.
 *
 * Everything here is optional and unused by the current first-come policy.
 * It exists so that adding rating bands, regions or a ranked/unranked split
 * later is a policy change rather than a protocol change.
 */
export interface TicketAttributes {
  /** Future Elo/MMR. Absent today. */
  rating?: number;
  /** Future region hint, e.g. "eu". Absent today. */
  region?: string;
  /** Future ranked queue split. Absent today. */
  ranked?: boolean;
}

export type QueuePhase = 'searching' | 'matched' | 'cancelled' | 'failed';

export interface QueueStatus {
  mode: QueueMode;
  phase: QueuePhase;
  /** Players gathered for this match so far, including you. */
  found: number;
  /** Players needed before the match can start right now. */
  target: number;
  /** The mode's ideal party size, even if we would start smaller. */
  idealTarget: number;
  /** Epoch ms the search began, for an honest elapsed timer. */
  searchingSince: number;
  /** How many people are queued for this mode in total. */
  queueDepth: number;
  /** Server time when the status was built, for clock-skew correction. */
  serverTime: number;
}

export interface MatchFound {
  /** The room to join. Clients navigate here. */
  code: string;
  mode: QueueMode;
  /** Display names of everyone in the match, in seat order. */
  players: Array<{ id: string; name: string; color: number }>;
  /** Epoch ms when the first question opens. */
  startsAt: number;
}

export interface QueueRequest extends JoinIdentity {
  mode: QueueMode;
  /** Reserved; ignored by the current policy. */
  attributes?: TicketAttributes;
}

export type RoomErrorCode =
  | 'INVALID_CODE'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'GAME_IN_PROGRESS'
  | 'NOT_HOST'
  | 'NOT_ENOUGH_PLAYERS'
  | 'ROOM_CLOSED'
  | 'BAD_REQUEST'
  | 'RATE_LIMITED'
  | 'POOL_EXHAUSTED'
  | 'ALREADY_QUEUED'
  | 'QUEUE_UNAVAILABLE'
  | 'SERVER_ERROR';

export interface RoomError {
  code: RoomErrorCode;
  message: string;
}

export type Ack<T> = { ok: true; data: T } | { ok: false; error: RoomError };

export interface JoinIdentity {
  /** Persisted in localStorage so a refresh reclaims the same seat. */
  clientId: string;
  name: string;
  color: number;
}

export interface CreateRoomRequest extends JoinIdentity {
  mode: GameMode;
  settings?: Partial<RoomSettings>;
}

export interface JoinRoomRequest extends JoinIdentity {
  code: string;
}

export interface GuessRequest {
  questionId: string;
  guess: Guess;
}

/** Events the client sends. */
export interface ClientToServerEvents {
  'room:create': (payload: CreateRoomRequest, ack: (result: Ack<RoomSnapshot>) => void) => void;
  'room:join': (payload: JoinRoomRequest, ack: (result: Ack<RoomSnapshot>) => void) => void;
  'room:leave': () => void;
  'room:settings': (
    payload: Partial<RoomSettings>,
    ack?: (result: Ack<RoomSnapshot>) => void,
  ) => void;
  'room:rename': (payload: { name: string }, ack?: (result: Ack<RoomSnapshot>) => void) => void;
  'game:start': (ack?: (result: Ack<RoomSnapshot>) => void) => void;
  'game:rematch': (ack?: (result: Ack<RoomSnapshot>) => void) => void;
  'round:guess': (payload: GuessRequest, ack?: (result: Ack<{ locked: true }>) => void) => void;
  'round:ready': () => void;
  'queue:join': (payload: QueueRequest, ack?: (result: Ack<QueueStatus>) => void) => void;
  'queue:leave': (ack?: (result: Ack<{ left: true }>) => void) => void;
  ping: (ack: (serverTime: number) => void) => void;
}

/** Events the server sends. */
export interface ServerToClientEvents {
  'room:state': (snapshot: RoomSnapshot) => void;
  'room:error': (error: RoomError) => void;
  'room:closed': (payload: { reason: string }) => void;
  /** Fired the instant everyone has locked in, so the UI can react early. */
  'round:allLocked': (payload: { round: number }) => void;
  /** Queue progress, pushed whenever it changes rather than polled. */
  'queue:update': (status: QueueStatus) => void;
  /** A match exists. The client should head to the room. */
  'queue:matched': (payload: MatchFound) => void;
}

export const ERROR_MESSAGES: Record<RoomErrorCode, string> = {
  INVALID_CODE: 'That code does not look right.',
  ROOM_NOT_FOUND: 'No room with that code. It may have closed.',
  ROOM_FULL: 'That room is full.',
  GAME_IN_PROGRESS: 'That match has already started.',
  NOT_HOST: 'Only the host can do that.',
  NOT_ENOUGH_PLAYERS: 'You need another player before you can start.',
  ROOM_CLOSED: 'The room closed.',
  BAD_REQUEST: 'Something about that request was off.',
  RATE_LIMITED: 'Slow down a moment.',
  POOL_EXHAUSTED: 'No questions left in the pool.',
  ALREADY_QUEUED: 'You are already searching for a match.',
  QUEUE_UNAVAILABLE: 'Matchmaking is unavailable right now. Try again shortly.',
  SERVER_ERROR: 'The server had a problem. Try again.',
};

export function roomError(code: RoomErrorCode, message?: string): RoomError {
  return { code, message: message ?? ERROR_MESSAGES[code] };
}
