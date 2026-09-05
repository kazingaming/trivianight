/**
 * The question bank.
 *
 * Adding content means adding a data file and listing it in PACKS below.
 * Nothing in the UI or the game loop needs to change, and `npm run
 * content:check` will refuse anything malformed before it reaches a player.
 */

import {
  createRng,
  rollDifficulty,
  shuffle,
  type Difficulty,
  type GameMode,
  type Question,
  type QuestionType,
  type Rng,
} from '@trivia/shared';

import { anchorQuestions } from './packs/core/anchors.js';
import { wildcardQuestions } from './packs/core/wildcards.js';
import { scaleQuestions } from './packs/core/scale.js';
import { humanQuestions } from './packs/core/humans.js';
import { earthQuestions } from './packs/core/earth.js';
import { spaceQuestions } from './packs/core/space.js';
import { historyQuestions } from './packs/core/history.js';
import { everydayQuestions } from './packs/core/everyday.js';
import { logicQuestions } from './packs/core/logic.js';

export interface Pack {
  id: string;
  name: string;
  description: string;
  questions: Question[];
}

export const PACKS: Pack[] = [
  {
    id: 'core.anchors',
    name: 'Anchors',
    description: 'The reference points every other estimate is built on.',
    questions: anchorQuestions,
  },
  {
    id: 'core.scale',
    name: 'Scale',
    description: 'Quantities so large the only way in is reasoning.',
    questions: scaleQuestions,
  },
  {
    id: 'core.humans',
    name: 'People',
    description: 'Populations, bodies and the shape of humanity.',
    questions: humanQuestions,
  },
  {
    id: 'core.earth',
    name: 'Earth',
    description: 'Oceans, deserts, weather and where things actually are.',
    questions: earthQuestions,
  },
  {
    id: 'core.space',
    name: 'Space',
    description: 'Distances that defeat intuition.',
    questions: spaceQuestions,
  },
  {
    id: 'core.history',
    name: 'History',
    description: 'Ancient, medieval and mythological — and how badly we compress time.',
    questions: historyQuestions,
  },
  {
    id: 'core.everyday',
    name: 'Everyday',
    description: 'Objects, technology, money and food at unexpected scale.',
    questions: everydayQuestions,
  },
  {
    id: 'core.logic',
    name: 'Logic',
    description: 'Probability and reasoning puzzles that fight your instincts.',
    questions: logicQuestions,
  },
  {
    id: 'core.wildcards',
    name: 'Wildcards',
    description: 'The deep end. Absurd quantities that are still reachable.',
    questions: wildcardQuestions,
  },
];

export const ALL_QUESTIONS: Question[] = PACKS.flatMap((pack) => pack.questions);

const BY_ID = new Map(ALL_QUESTIONS.map((question) => [question.id, question]));

export function getQuestion(id: string): Question | undefined {
  return BY_ID.get(id);
}

export function questionsByDifficulty(difficulty: Difficulty): Question[] {
  return ALL_QUESTIONS.filter((question) => question.difficulty === difficulty);
}

export interface ContentStats {
  total: number;
  byDifficulty: Record<Difficulty, number>;
  byType: Record<string, number>;
  byCategory: Record<string, number>;
  volatile: number;
  missingSource: string[];
}

export function contentStats(questions: Question[] = ALL_QUESTIONS): ContentStats {
  const byDifficulty = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<Difficulty, number>;
  const byType: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  const missingSource: string[] = [];
  let volatile = 0;

  for (const question of questions) {
    byDifficulty[question.difficulty] = (byDifficulty[question.difficulty] ?? 0) + 1;
    byType[question.type] = (byType[question.type] ?? 0) + 1;
    byCategory[question.category] = (byCategory[question.category] ?? 0) + 1;
    if (question.source?.volatile) volatile++;
    if (!question.source) missingSource.push(question.id);
  }

  return { total: questions.length, byDifficulty, byType, byCategory, volatile, missingSource };
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

export interface ValidationIssue {
  questionId: string;
  severity: 'error' | 'warning';
  message: string;
}

const VALID_TYPES = new Set<QuestionType>([
  'numeric',
  'percentage',
  'probability',
  'year',
  'higher-lower',
  'which-is-bigger',
  'which-is-closer',
  'order',
  'multiple-choice',
]);

/** Structural checks plus the editorial rules we care about. */
export function validateQuestion(question: Question): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const error = (message: string) =>
    issues.push({ questionId: question.id, severity: 'error', message });
  const warn = (message: string) =>
    issues.push({ questionId: question.id, severity: 'warning', message });

  if (!question.id) error('missing id');
  if (!question.prompt || question.prompt.trim().length < 8) error('prompt is missing or too short');
  if (!VALID_TYPES.has(question.type)) error(`unknown type "${question.type}"`);
  if (![1, 2, 3, 4, 5].includes(question.difficulty)) error('difficulty must be 1-5');
  if (!question.reveal?.explanation || question.reveal.explanation.trim().length < 20) {
    error('reveal.explanation is missing or too short — the reveal is the payoff');
  }
  if (question.timeLimitSec !== undefined && question.timeLimitSec < 10) {
    error('timeLimitSec under 10 seconds is not enough time to reason');
  }

  switch (question.type) {
    case 'numeric':
      if (!Number.isFinite(question.answer)) error('numeric answer must be a finite number');
      if (question.answer <= 0) {
        warn('non-positive answers score poorly under log-ratio accuracy');
      }
      if (question.tolerance !== undefined && question.tolerance <= 0) {
        error('tolerance must be positive');
      }
      break;
    case 'percentage':
    case 'probability':
      if (!(question.answer >= 0 && question.answer <= 100)) {
        error(`${question.type} answer must be between 0 and 100`);
      }
      break;
    case 'year':
      if (!Number.isFinite(question.answer)) error('year answer must be a finite number');
      if (question.range && question.range.min >= question.range.max) {
        error('range.min must be below range.max');
      }
      if (question.range && (question.answer < question.range.min || question.answer > question.range.max)) {
        error('answer falls outside its own range');
      }
      break;
    case 'higher-lower':
      if (question.answer !== 'higher' && question.answer !== 'lower') {
        error('higher-lower answer must be "higher" or "lower"');
      }
      if (!question.reference) error('higher-lower needs a reference');
      if (!question.actual) error('higher-lower needs the actual value for the reveal');
      break;
    case 'which-is-bigger':
    case 'which-is-closer':
      if (question.options?.length !== 2) error('comparison questions need exactly 2 options');
      if (question.answer !== 0 && question.answer !== 1) error('answer must be 0 or 1');
      if (question.options?.some((option) => !option.label)) error('every option needs a label');
      break;
    case 'multiple-choice':
      if (!question.options || question.options.length < 2) error('needs at least 2 options');
      if (
        question.answer === undefined ||
        question.answer < 0 ||
        question.answer >= (question.options?.length ?? 0)
      ) {
        error('answer index is out of range');
      }
      if (new Set(question.options).size !== question.options?.length) {
        error('duplicate options');
      }
      break;
    case 'order':
      if (!question.items || question.items.length < 3) error('order questions need 3+ items');
      if (question.items && new Set(question.items.map((i) => i.id)).size !== question.items.length) {
        error('duplicate item ids');
      }
      if (!question.instruction) error('order questions need an instruction');
      break;
    default:
      break;
  }

  if (!question.source) {
    warn('no source — factual claims should be attributable');
  } else {
    if (!question.source.citation) error('source needs a citation');
    // A number that moves needs a date attached or the reveal is dishonest.
    if (question.source.volatile && !question.source.statisticYear && !question.source.year) {
      error('volatile statistics must carry a year');
    }
  }

  return issues;
}

export function validateAll(questions: Question[] = ALL_QUESTIONS): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  for (const question of questions) {
    if (seen.has(question.id)) {
      issues.push({
        questionId: question.id,
        severity: 'error',
        message: 'duplicate question id',
      });
    }
    seen.add(question.id);
    issues.push(...validateQuestion(question));
  }
  return issues;
}

/* ------------------------------------------------------------------ *
 * Selection
 * ------------------------------------------------------------------ */

export interface PoolOptions {
  mode: GameMode;
  /** Question ids to skip — already played this match, or recently seen. */
  exclude?: Iterable<string>;
  /** Restrict to specific packs. Empty/undefined means everything. */
  packIds?: string[];
  seed?: string | number;
}

/**
 * Draws questions for a match.
 *
 * Rolls the target difficulty from the mode's curve, then takes the nearest
 * available tier if that one is exhausted — so a small bank degrades into
 * "close enough" rather than repeating or running dry.
 */
export class QuestionPool {
  private readonly rng: Rng;
  private readonly used = new Set<string>();
  private readonly available: Question[];
  private readonly mode: GameMode;

  constructor(options: PoolOptions) {
    this.mode = options.mode;
    this.rng = createRng(options.seed ?? Math.random());
    const packs = options.packIds?.length
      ? PACKS.filter((pack) => options.packIds!.includes(pack.id))
      : PACKS;
    const excluded = new Set(options.exclude ?? []);
    this.available = shuffle(
      packs.flatMap((pack) => pack.questions).filter((question) => !excluded.has(question.id)),
      this.rng,
    );
  }

  get remaining(): number {
    return this.available.length - this.used.size;
  }

  /** Mark a question as spent without drawing it (used when resuming). */
  markUsed(id: string): void {
    this.used.add(id);
  }

  /** Draw the next question for a round, or null when the bank runs dry. */
  next(round: number): Question | null {
    if (this.remaining <= 0) return null;
    const target = rollDifficulty(this.mode, round, this.rng);

    // Walk outward from the target tier: 3 -> 3,2,4,1,5
    for (const tier of tiersByDistance(target)) {
      const candidate = this.available.find(
        (question) => question.difficulty === tier && !this.used.has(question.id),
      );
      if (candidate) {
        this.used.add(candidate.id);
        return candidate;
      }
    }
    return null;
  }
}

function tiersByDistance(target: Difficulty): Difficulty[] {
  const tiers: Difficulty[] = [1, 2, 3, 4, 5];
  return tiers.sort((a, b) => {
    const distance = Math.abs(a - target) - Math.abs(b - target);
    // Ties break downward: an easier substitute is kinder than a harder one.
    return distance !== 0 ? distance : a - b;
  });
}

export type { Question } from '@trivia/shared';
