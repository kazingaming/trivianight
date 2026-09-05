/**
 * Local persistence.
 *
 * Everything here is a convenience, never a requirement: private windows,
 * cleared storage and locked-down browsers all have to keep working, so every
 * read falls back to a default and every write is allowed to fail silently.
 */

import { createId, type TimerPreference } from '@trivia/shared';

const PREFIX = 'trivia-night';
const VERSION = 1;

function key(name: string): string {
  return `${PREFIX}:v${VERSION}:${name}`;
}

function read<T>(name: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key(name));
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as T;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function write(name: string, value: unknown): void {
  try {
    localStorage.setItem(key(name), JSON.stringify(value));
  } catch {
    // Storage full, disabled or unavailable. The game plays on regardless.
  }
}

/* --- Identity --------------------------------------------------------- */

export interface Identity {
  clientId: string;
  name: string;
  color: number;
}

/** Held in memory when even sessionStorage is unavailable. */
let fallbackClientId = '';

/**
 * The seat token lives in sessionStorage, not localStorage, and that is
 * deliberate. It survives a refresh — so reconnecting reclaims your seat and
 * your score — but it is unique per tab, so two tabs on one machine are two
 * different players. That makes local multiplayer testing work without a
 * second browser profile.
 */
function loadClientId(): string {
  try {
    const existing = sessionStorage.getItem(key('client-id'));
    if (existing) return existing;
    const created = createId('p');
    sessionStorage.setItem(key('client-id'), created);
    return created;
  } catch {
    if (!fallbackClientId) fallbackClientId = createId('p');
    return fallbackClientId;
  }
}

/** Name and colour are preferences, so they persist across tabs and sessions. */
export function loadIdentity(): Identity {
  const stored = read<{ name?: string; color?: number }>('identity', {});
  return {
    clientId: loadClientId(),
    name: typeof stored.name === 'string' ? stored.name : '',
    color: Number.isInteger(stored.color) ? (stored.color as number) : Math.floor(Math.random() * 8),
  };
}

export function saveIdentity(identity: Identity): void {
  write('identity', { name: identity.name, color: identity.color });
}

/* --- Settings --------------------------------------------------------- */

export type MotionPreference = 'full' | 'reduced' | 'off';

export interface Settings {
  sound: boolean;
  volume: number;
  motion: MotionPreference;
  timer: TimerPreference;
  /** Show the reaction animation before the numbers land. */
  reactions: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  sound: true,
  volume: 0.55,
  motion: 'full',
  timer: 'standard',
  reactions: true,
};

export function loadSettings(): Settings {
  const stored = read<Partial<Settings>>('settings', {});
  return {
    sound: typeof stored.sound === 'boolean' ? stored.sound : DEFAULT_SETTINGS.sound,
    volume:
      typeof stored.volume === 'number' && stored.volume >= 0 && stored.volume <= 1
        ? stored.volume
        : DEFAULT_SETTINGS.volume,
    motion:
      stored.motion === 'full' || stored.motion === 'reduced' || stored.motion === 'off'
        ? stored.motion
        : DEFAULT_SETTINGS.motion,
    timer:
      stored.timer === 'relaxed' || stored.timer === 'standard' || stored.timer === 'blitz'
        ? stored.timer
        : DEFAULT_SETTINGS.timer,
    reactions: typeof stored.reactions === 'boolean' ? stored.reactions : DEFAULT_SETTINGS.reactions,
  };
}

export function saveSettings(settings: Settings): void {
  write('settings', settings);
}

/* --- Personal bests ---------------------------------------------------- */

export interface SoloRecord {
  score: number;
  rounds: number;
  streak: number;
  at: number;
}

const EMPTY_RECORD: SoloRecord = { score: 0, rounds: 0, streak: 0, at: 0 };

export function loadSoloRecord(): SoloRecord {
  const stored = read<Partial<SoloRecord>>('solo-best', {});
  return {
    score: numberOr(stored.score, 0),
    rounds: numberOr(stored.rounds, 0),
    streak: numberOr(stored.streak, 0),
    at: numberOr(stored.at, 0),
  };
}

/** Records improve independently — a short run can still set a streak best. */
export function saveSoloRecord(run: Omit<SoloRecord, 'at'>): SoloRecord {
  const previous = loadSoloRecord();
  const next: SoloRecord = {
    score: Math.max(previous.score, run.score),
    rounds: Math.max(previous.rounds, run.rounds),
    streak: Math.max(previous.streak, run.streak),
    at: run.score > previous.score ? Date.now() : previous.at,
  };
  write('solo-best', next);
  return next;
}

export function clearSoloRecord(): SoloRecord {
  write('solo-best', EMPTY_RECORD);
  return { ...EMPTY_RECORD };
}

/* --- Recently seen ------------------------------------------------------ */

const RECENT_LIMIT = 60;

/**
 * Question ids seen in recent solo runs, so a fresh run does not open with the
 * same three questions. Capped, and never allowed to starve the pool.
 */
export function loadRecentQuestions(): string[] {
  const stored = read<string[]>('recent-questions', []);
  return Array.isArray(stored) ? stored.filter((id) => typeof id === 'string') : [];
}

export function rememberQuestions(ids: string[]): void {
  if (ids.length === 0) return;
  const merged = [...ids, ...loadRecentQuestions()];
  const unique = [...new Set(merged)].slice(0, RECENT_LIMIT);
  write('recent-questions', unique);
}

export function clearRecentQuestions(): void {
  write('recent-questions', []);
}

/* --- Last room ---------------------------------------------------------- */

export function loadLastRoom(): string {
  return read<string>('last-room', '');
}

export function saveLastRoom(code: string): void {
  write('last-room', code);
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
