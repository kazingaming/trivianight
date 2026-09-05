/**
 * Difficulty progression.
 *
 * Every mode ramps, but at its own pace: Solo climbs fastest because it is a
 * survival run, Duel starts around medium, and Free For All eases a room in
 * so nobody is humiliated on question one.
 *
 * Rather than a hardcoded table (which players would learn and exploit), each
 * round produces a *distribution* centred on a moving target. The spread keeps
 * selection unpredictable while the centre keeps the arc intentional.
 */

import type { Difficulty } from './types.js';
import { pickWeighted, type Rng } from './util.js';

export type GameMode = 'solo' | 'duel' | 'ffa';

export interface ModeConfig {
  id: GameMode;
  label: string;
  /** Null for endless survival. */
  rounds: number | null;
  lives: number | null;
  minPlayers: number;
  maxPlayers: number;
  /** Seconds, before the player's speed preference is applied. */
  defaultTimeLimit: number;
  /** Seconds the reveal stays up before auto-advancing. */
  revealDuration: number;
  curve: { start: number; end: number; ramp: number };
  blurb: string;
}

export const MODES: Record<GameMode, ModeConfig> = {
  solo: {
    id: 'solo',
    label: 'Solo Gauntlet',
    rounds: null,
    lives: 3,
    minPlayers: 1,
    maxPlayers: 1,
    defaultTimeLimit: 45,
    revealDuration: 0,
    curve: { start: 1, end: 4.8, ramp: 11 },
    blurb: 'Survive as long as your instincts hold. Three lives, no ceiling.',
  },
  duel: {
    id: 'duel',
    label: '1v1 Duel',
    rounds: 8,
    lives: null,
    minPlayers: 2,
    maxPlayers: 2,
    // 30 seconds: enough to reason and commit, not enough to go looking.
    defaultTimeLimit: 30,
    revealDuration: 13,
    // Opens around medium and climbs to hard — never into wildcard territory.
    curve: { start: 1.9, end: 3.6, ramp: 9 },
    blurb: 'Two minds, same question. Closest guess takes the round.',
  },
  ffa: {
    id: 'ffa',
    label: 'Free For All',
    rounds: 10,
    lives: null,
    minPlayers: 2,
    maxPlayers: 4,
    defaultTimeLimit: 30,
    revealDuration: 14,
    // The gentlest ramp of the three: a room gets to settle in first.
    curve: { start: 1, end: 3.8, ramp: 12 },
    blurb: 'Up to four players. Loud reveals, bigger arguments.',
  },
};

/** How much of the ramp has been climbed by this round. 0..1 */
export function pressure(mode: GameMode, round: number): number {
  const { ramp } = MODES[mode].curve;
  return Math.min(1, Math.max(0, (round - 1) / ramp));
}

const SPREAD = 0.8;
/** Wildcards start appearing once a room has found its feet. */
const WILDCARD_FROM_ROUND = 4;
const WILDCARD_WEIGHT = 0.07;

/**
 * Weight per difficulty tier for a given round.
 * Exported so the content checker can prove every tier is reachable.
 */
export function difficultyWeights(mode: GameMode, round: number): Record<Difficulty, number> {
  const config = MODES[mode].curve;
  const centre = config.start + (config.end - config.start) * pressure(mode, round);
  const weights = {} as Record<Difficulty, number>;
  for (const tier of [1, 2, 3, 4, 5] as Difficulty[]) {
    const distance = tier - centre;
    let weight = Math.exp(-(distance * distance) / (2 * SPREAD * SPREAD));
    if (tier === 5 && round >= WILDCARD_FROM_ROUND) weight += WILDCARD_WEIGHT;
    // Never let a tier fully vanish; tiny odds keep selection unpredictable.
    weights[tier] = Math.max(weight, 0.005);
  }
  return weights;
}

export function rollDifficulty(mode: GameMode, round: number, rng: Rng = Math.random): Difficulty {
  const weights = difficultyWeights(mode, round);
  const entries = (Object.keys(weights) as unknown as string[]).map((key) => ({
    value: Number(key) as Difficulty,
    weight: weights[Number(key) as Difficulty],
  }));
  return pickWeighted(entries, rng) ?? 2;
}

export type TimerPreference = 'relaxed' | 'standard' | 'blitz';

export const TIMER_SCALE: Record<TimerPreference, number> = {
  relaxed: 1.45,
  standard: 1,
  blitz: 0.6,
};

export const TIMER_LABELS: Record<TimerPreference, string> = {
  relaxed: 'Relaxed',
  standard: 'Standard',
  blitz: 'Blitz',
};

/** Resolve the clock for a round: question override, mode default, preference. */
export function resolveTimeLimit(
  mode: GameMode,
  preference: TimerPreference,
  questionOverride?: number,
): number {
  const base = questionOverride ?? MODES[mode].defaultTimeLimit;
  return Math.round(Math.max(10, base * TIMER_SCALE[preference]));
}
