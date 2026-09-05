/**
 * Feedback voice.
 *
 * The same six words every round kills the mood, so every band has a pool and
 * the pick is seeded by player + question. That keeps it varied for a player
 * while staying identical on every screen in a multiplayer room.
 */

import type { FeedbackBand } from './scoring.js';
import { hashString } from './util.js';

interface BandVoice {
  /** Short shout shown large next to the guess. */
  headlines: string[];
  /** Optional quieter second line. Works for any question format. */
  asides: string[];
  /**
   * Asides that talk about magnitude and scale. Only used for open numeric
   * estimates — "right order of magnitude" makes no sense on an ordering
   * question.
   */
  scaleAsides?: string[];
}

const VOICE: Record<FeedbackBand, BandVoice> = {
  perfect: {
    headlines: [
      'Bullseye',
      'Suspiciously accurate',
      'Nailed it',
      'Dead on',
      'Absurdly close',
      'Textbook',
      'Called it',
    ],
    asides: [
      'Did you already know that?',
      'That is a little unsettling.',
      'Frame it.',
      'Nobody guesses that well twice.',
      'Straight through the middle.',
    ],
  },
  great: {
    headlines: [
      'Ridiculously close',
      'Excellent guess',
      'Sharp',
      'Locked on',
      'Barely missed',
      'That is a great read',
    ],
    asides: [
      'A hair off.',
      'You clearly reasoned that one.',
      'Almost embarrassing for the answer.',
      'That is estimation done right.',
    ],
  },
  good: {
    headlines: [
      'Good guess',
      'Solid',
      'Right neighbourhood',
      'You were onto it',
      'Nicely judged',
      'That will do',
    ],
    asides: ['Close enough to be proud of.', 'The instinct was correct.'],
    scaleAsides: ['Right shape, slightly wrong size.'],
  },
  fair: {
    headlines: [
      'In the ballpark',
      'Not bad',
      'Roughly there',
      'Same postcode',
      'Half right',
      'Within reach',
    ],
    asides: ['You were thinking about it correctly.', 'A nudge would have done it.'],
    scaleAsides: ['Right order of magnitude, at least.'],
  },
  miss: {
    headlines: [
      'Way off',
      'Bold',
      'Optimistic',
      'Not quite',
      'That got away',
      'Swing and a miss',
    ],
    asides: ['Everyone gets this one wrong.', 'Worth it for the confidence.'],
    scaleAsides: ['The scale is sneakier than it looks.'],
  },
  disaster: {
    headlines: [
      'Different universe',
      'Spectacular',
      'That is a choice',
      'Wildly off',
      'Absolutely not',
      'Wrong by a lot',
      'Somewhere else entirely',
    ],
    asides: ['At least you committed.', 'Screenshot that one.', 'We will pretend that did not happen.'],
    scaleAsides: ['Some numbers just do not behave.'],
  },
};

const BINARY_RIGHT = ['Correct', 'Got it', 'Right call', 'Good instinct', 'Well reasoned'];
const BINARY_WRONG = ['Wrong', 'Not this time', 'Fooled you', 'Other one', 'So close to a coin flip'];
const NO_ANSWER = ['No guess', 'Ran out of clock', 'Silence', 'Nothing locked in'];

export interface Feedback {
  headline: string;
  aside?: string;
}

function pick<T>(pool: T[], seed: number, salt: number): T {
  if (pool.length === 0) throw new Error('empty feedback pool');
  const index = Math.abs((seed ^ (salt * 0x9e3779b1)) >>> 0) % pool.length;
  return pool[index];
}

export interface FeedbackInput {
  band: FeedbackBand;
  answered: boolean;
  /** True/false for binary formats, null for open estimates. */
  correct: boolean | null;
  /** Anything stable and unique per player+round. */
  seed: string;
  /** Unlocks the magnitude-flavoured asides. */
  numeric?: boolean;
}

export function getFeedback(input: FeedbackInput): Feedback {
  const seed = hashString(input.seed);
  if (!input.answered) return { headline: pick(NO_ANSWER, seed, 3) };

  if (input.correct !== null) {
    return {
      headline: input.correct ? pick(BINARY_RIGHT, seed, 5) : pick(BINARY_WRONG, seed, 7),
    };
  }

  const voice = VOICE[input.band];
  const pool = input.numeric ? [...voice.asides, ...(voice.scaleAsides ?? [])] : voice.asides;
  // Asides are occasional so they stay a treat rather than noise.
  const showAside = pool.length > 0 && (seed >>> 3) % 5 !== 0;
  return {
    headline: pick(voice.headlines, seed, 11),
    aside: showAside ? pick(pool, seed, 13) : undefined,
  };
}

/** Copy for the running solo streak indicator. */
export function streakLabel(streak: number): string | null {
  if (streak < 2) return null;
  if (streak < 4) return `${streak} in a row`;
  if (streak < 6) return `${streak} straight — heating up`;
  if (streak < 9) return `${streak} straight — on fire`;
  return `${streak} straight — unreal`;
}
