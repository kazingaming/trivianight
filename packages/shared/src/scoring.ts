/**
 * Scoring.
 *
 * North star: being almost right should feel nearly as good as knowing.
 *
 * For open quantities we score on *log-ratio* error, so guessing 5 billion
 * against 10 billion earns the same as guessing 50 against 100. Absolute error
 * would make every large-number question a lottery.
 *
 * accuracy = exp(-(error / tolerance) ^ 1.3)
 *
 * With the default numeric tolerance of 0.32 decades that yields, roughly:
 *
 *   within  1.014x -> 0.995   Bullseye
 *   within  1.14x  -> 0.90    Ridiculously close
 *   within  1.37x  -> 0.72    Good guess
 *   within  2.34x  -> 0.30    In the ballpark
 *   within  4.05x  -> 0.10    Way off
 *   10x off        -> 0.012   Different universe
 *
 * The "in the ballpark" band deliberately reaches past 2x. Guessing 20 million
 * when the answer is 43.3 million is wrong, but it is the *right kind* of
 * wrong, and the game should say so.
 */

import {
  describeNumericMiss,
  describePointMiss,
  describeYearMiss,
  type MissDescription,
} from './numbers.js';
import type { Difficulty, Guess, Question } from './types.js';

export const BASE_POINTS = 1000;

/** Shape of the accuracy curve. Higher = flatter near the answer. */
const CURVE_EXPONENT = 1.3;

export const DEFAULT_TOLERANCE = {
  /** Decades of log10 error. */
  numeric: 0.32,
  /**
   * Percentage points. A blind guess on a 0-100 scale is about 33 points out,
   * so 15 keeps "meaningfully better than random" inside the ballpark band.
   */
  percentage: 15,
  probability: 15,
  /** Years. */
  year: 30,
} as const;

/** Deeper questions are worth more, which is what makes a gauntlet run tense. */
export const DIFFICULTY_MULTIPLIER: Record<Difficulty, number> = {
  1: 1,
  2: 1.15,
  3: 1.35,
  4: 1.6,
  5: 1.85,
};

export type FeedbackBand = 'perfect' | 'great' | 'good' | 'fair' | 'miss' | 'disaster';

/** Ordered best-first so the first threshold that matches wins. */
const BAND_THRESHOLDS: Array<[FeedbackBand, number]> = [
  ['perfect', 0.995],
  ['great', 0.9],
  ['good', 0.72],
  ['fair', 0.3],
  ['miss', 0.1],
  ['disaster', 0],
];

export function bandFor(accuracy: number): FeedbackBand {
  for (const [band, threshold] of BAND_THRESHOLDS) {
    if (accuracy >= threshold) return band;
  }
  return 'disaster';
}

/** Below this a solo run loses a life: roughly 3.7x or more off the truth. */
export const SURVIVAL_THRESHOLD = 0.12;

export interface ScoreResult {
  /** 0..1. The single number every other system derives from. */
  accuracy: number;
  band: FeedbackBand;
  /** Points before streak, difficulty and closest-player bonuses. */
  basePoints: number;
  /** Human phrasing of the error, e.g. "2.2x too low". Null when not numeric. */
  miss: MissDescription | null;
  /** For binary formats. Null for open estimates. */
  correct: boolean | null;
  /** True when the player never locked anything in. */
  answered: boolean;
}

const NO_ANSWER: ScoreResult = {
  accuracy: 0,
  band: 'disaster',
  basePoints: 0,
  miss: null,
  correct: null,
  answered: false,
};

function curve(error: number, tolerance: number): number {
  if (!Number.isFinite(error)) return 0;
  if (tolerance <= 0) return error === 0 ? 1 : 0;
  const accuracy = Math.exp(-Math.pow(Math.abs(error) / tolerance, CURVE_EXPONENT));
  return clamp01(accuracy);
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Log-ratio accuracy for open quantities. */
export function numericAccuracy(guess: number, answer: number, tolerance: number): number {
  if (!Number.isFinite(guess)) return 0;
  // Fall back to absolute framing when a ratio is undefined.
  if (answer === 0) return curve(Math.abs(guess), Math.max(tolerance, 1));
  if (guess === 0 || Math.sign(guess) !== Math.sign(answer)) return 0;
  const logError = Math.abs(Math.log10(Math.abs(guess) / Math.abs(answer)));
  return curve(logError, tolerance);
}

/** Fraction of correctly ordered pairs, rescaled so a random order scores ~0. */
export function orderAccuracy(guess: string[], correct: string[]): number {
  if (guess.length < 2) return 0;
  const rank = new Map(correct.map((id, index) => [id, index]));
  let concordant = 0;
  let total = 0;
  for (let i = 0; i < guess.length; i++) {
    for (let j = i + 1; j < guess.length; j++) {
      const a = rank.get(guess[i]);
      const b = rank.get(guess[j]);
      if (a === undefined || b === undefined) continue;
      total++;
      if (a < b) concordant++;
    }
  }
  if (total === 0) return 0;
  const fraction = concordant / total;
  // A shuffle averages 0.5, so anything at or below that earns nothing.
  return clamp01(Math.pow(clamp01((fraction - 0.45) / 0.55), 1.1));
}

export interface ScoreOptions {
  /**
   * 0..1, how much of the clock was left when the player locked in.
   * Only nudges binary formats, where there is no notion of closeness.
   */
  speed?: number;
}

/** Score one guess against one question. Pure — safe to run on both ends. */
export function scoreGuess(
  question: Question,
  guess: Guess | null | undefined,
  options: ScoreOptions = {},
): ScoreResult {
  if (!guess || guess.kind === 'none') return { ...NO_ANSWER };
  const speed = clamp01(options.speed ?? 0.5);

  switch (question.type) {
    case 'numeric': {
      if (guess.kind !== 'number' || !Number.isFinite(guess.value)) return { ...NO_ANSWER };
      const tolerance = question.tolerance ?? DEFAULT_TOLERANCE.numeric;
      const accuracy = numericAccuracy(guess.value, question.answer, tolerance);
      return open(accuracy, describeNumericMiss(guess.value, question.answer));
    }
    case 'percentage':
    case 'probability': {
      if (guess.kind !== 'number' || !Number.isFinite(guess.value)) return { ...NO_ANSWER };
      const tolerance =
        question.tolerance ??
        (question.type === 'percentage'
          ? DEFAULT_TOLERANCE.percentage
          : DEFAULT_TOLERANCE.probability);
      const accuracy = curve(guess.value - question.answer, tolerance);
      return open(accuracy, describePointMiss(guess.value, question.answer));
    }
    case 'year': {
      if (guess.kind !== 'number' || !Number.isFinite(guess.value)) return { ...NO_ANSWER };
      const tolerance = question.tolerance ?? DEFAULT_TOLERANCE.year;
      const accuracy = curve(guess.value - question.answer, tolerance);
      return open(accuracy, describeYearMiss(guess.value, question.answer));
    }
    case 'higher-lower': {
      if (guess.kind !== 'higher-lower') return { ...NO_ANSWER };
      return binary(guess.value === question.answer, speed);
    }
    case 'which-is-bigger':
    case 'which-is-closer': {
      if (guess.kind !== 'binary') return { ...NO_ANSWER };
      return binary(guess.value === question.answer, speed);
    }
    case 'multiple-choice': {
      if (guess.kind !== 'binary' && guess.kind !== 'number') return { ...NO_ANSWER };
      const picked = guess.kind === 'binary' ? guess.value : guess.value;
      return binary(picked === question.answer, speed);
    }
    case 'order': {
      if (guess.kind !== 'order') return { ...NO_ANSWER };
      const correct = question.items.map((item) => item.id);
      const accuracy = orderAccuracy(guess.value, correct);
      return open(accuracy, null);
    }
    default:
      return { ...NO_ANSWER };
  }

  function open(accuracy: number, miss: MissDescription | null): ScoreResult {
    return {
      accuracy,
      band: bandFor(accuracy),
      basePoints: Math.round(BASE_POINTS * accuracy),
      miss,
      correct: null,
      answered: true,
    };
  }

  function binary(correct: boolean, speedFraction: number): ScoreResult {
    // Right answers still vary a little so a decisive player edges a dawdler.
    const accuracy = correct ? 1 : 0;
    const points = correct ? Math.round(BASE_POINTS * (0.75 + 0.25 * speedFraction)) : 0;
    return {
      accuracy,
      band: correct ? 'perfect' : 'disaster',
      basePoints: points,
      miss: null,
      correct,
      answered: true,
    };
  }
}

export interface RoundPointsInput {
  score: ScoreResult;
  difficulty: Difficulty;
  /** Consecutive solid rounds *before* this one. */
  streak?: number;
  /** True when this player was the closest in a multiplayer round. */
  closest?: boolean;
  /** Number of players who actually answered. No bonus when alone. */
  contenders?: number;
}

export interface RoundPoints {
  total: number;
  base: number;
  difficultyBonus: number;
  streakBonus: number;
  closestBonus: number;
}

/** A round of at least this accuracy extends a streak. */
export const STREAK_THRESHOLD = 0.6;
const MAX_STREAK_BONUS_STEPS = 8;

export function computeRoundPoints(input: RoundPointsInput): RoundPoints {
  const { score, difficulty } = input;
  const base = score.basePoints;
  const multiplier = DIFFICULTY_MULTIPLIER[difficulty] ?? 1;
  const withDifficulty = Math.round(base * multiplier);
  const difficultyBonus = withDifficulty - base;

  const streak = Math.max(0, input.streak ?? 0);
  const streakSteps = Math.min(streak, MAX_STREAK_BONUS_STEPS);
  // Streaks only pay out on a round that is itself solid.
  const streakBonus =
    score.accuracy >= STREAK_THRESHOLD ? Math.round(withDifficulty * 0.05 * streakSteps) : 0;

  const contenders = input.contenders ?? 1;
  const closestBonus =
    input.closest && contenders > 1 && score.accuracy > 0 ? Math.round(BASE_POINTS * 0.25) : 0;

  return {
    total: Math.max(0, withDifficulty + streakBonus + closestBonus),
    base,
    difficultyBonus,
    streakBonus,
    closestBonus,
  };
}

/** Did this round keep the streak alive? */
export function extendsStreak(score: ScoreResult): boolean {
  return score.answered && score.accuracy >= STREAK_THRESHOLD;
}

/** Did this round cost a life in a survival mode? */
export function costsLife(score: ScoreResult): boolean {
  return !score.answered || score.accuracy < SURVIVAL_THRESHOLD;
}
