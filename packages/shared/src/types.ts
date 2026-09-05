/**
 * Trivia Night — content model.
 *
 * Questions are *data*, never code. Everything the game needs to present,
 * score, reveal and cite a question lives in these structures, so the content
 * bank can grow to thousands of entries (packs, seasons, localisation) without
 * a single UI file changing.
 */

/** How hard the question is to *reason toward*, not how obscure the fact is. */
export type Difficulty = 1 | 2 | 3 | 4 | 5;

export const DIFFICULTY_NAMES: Record<Difficulty, string> = {
  1: 'Easy',
  2: 'Medium',
  3: 'Hard',
  4: 'Very Hard',
  5: 'Wildcard',
};

export type Category =
  | 'People'
  | 'Animals'
  | 'Nature'
  | 'Earth'
  | 'Space'
  | 'Science'
  | 'History'
  | 'Mythology'
  | 'Geography'
  | 'Everyday'
  | 'Technology'
  | 'Money'
  | 'Logic'
  | 'Food';

/** Is the published value a hard count, a scientific estimate, or a model output? */
export type EvidenceKind = 'measured' | 'estimated' | 'modelled' | 'definitional';

export interface QuestionSource {
  /** Short human citation, e.g. "Crowther et al., Nature". */
  citation: string;
  /** Publisher / journal / institution. */
  publisher?: string;
  /** Year the source was published. */
  year?: number;
  /** Year the *statistic itself* describes (may differ from publication). */
  statisticYear?: number;
  /** Domain-level link. Deliberately not deep-linked so it cannot rot silently. */
  url?: string;
  kind: EvidenceKind;
  /** Assumptions that make the question answerable. Shown on the reveal. */
  assumptions?: string[];
  /**
   * Values that drift (populations, internet users) should be re-checked.
   * Stable physical facts can leave this undefined.
   */
  volatile?: boolean;
}

export interface QuestionReveal {
  /**
   * The big number/phrase shown on reveal. Optional — numeric questions can
   * derive it from the answer, but an explicit form lets us write
   * "about 43.3 million" instead of "43,300,000".
   */
  headline?: string;
  /** Two or three sentences. This is the payoff; make it interesting. */
  explanation: string;
  /** One line that makes a huge quantity graspable. */
  comparison?: string;
}

interface QuestionCommon {
  id: string;
  prompt: string;
  /** Optional second line, e.g. an assumption the player needs up front. */
  subPrompt?: string;
  category: Category;
  difficulty: Difficulty;
  tags?: string[];
  reveal: QuestionReveal;
  source?: QuestionSource;
  /** Override the mode default clock for questions that need more thought. */
  timeLimitSec?: number;
}

/** Free numeric estimate — the flagship format. Scored on log-ratio closeness. */
export interface NumericQuestion extends QuestionCommon {
  type: 'numeric';
  answer: number;
  /** e.g. "people", "km", "tonnes". Rendered next to the input and the answer. */
  unit?: string;
  /** Pre-formatted answer, e.g. "43.3 million". Avoids false precision. */
  displayAnswer?: string;
  /**
   * Decades of log10 error at which the player scores roughly 37%.
   * Lower = stricter. Default 0.32 (about 2x off scores around a third).
   */
  tolerance?: number;
  /** Nudges the input shorthand chips, e.g. show B/T for huge answers. */
  magnitude?: 'small' | 'thousands' | 'millions' | 'billions' | 'astronomical';
}

/** 0-100 estimate. Scored on absolute percentage-point distance. */
export interface PercentageQuestion extends QuestionCommon {
  type: 'percentage';
  answer: number;
  displayAnswer?: string;
  /** Percentage points of error scoring roughly 37%. Default 12. */
  tolerance?: number;
}

/** 0-100 probability. Same maths as percentage, different framing and copy. */
export interface ProbabilityQuestion extends QuestionCommon {
  type: 'probability';
  answer: number;
  displayAnswer?: string;
  tolerance?: number;
}

/** Year estimate. Negative years are BCE. */
export interface YearQuestion extends QuestionCommon {
  type: 'year';
  answer: number;
  displayAnswer?: string;
  /** Years of error scoring roughly 37%. Ancient questions need a wider window. */
  tolerance?: number;
  /** Bounds for the slider/stepper affordance. */
  range?: { min: number; max: number };
}

/** Is the true value above or below a stated reference? */
export interface HigherLowerQuestion extends QuestionCommon {
  type: 'higher-lower';
  /** The reference the player compares against, e.g. "1 million". */
  reference: string;
  answer: 'higher' | 'lower';
  /** The real figure, revealed afterwards. */
  actual: string;
}

export interface ChoiceOption {
  label: string;
  /** Shown on reveal beneath the label, e.g. "9.2 million km2". */
  detail?: string;
}

/** Two options, pick one. Covers "which is bigger" and "which is closer". */
export interface ChoiceQuestion extends QuestionCommon {
  type: 'which-is-bigger' | 'which-is-closer';
  options: [ChoiceOption, ChoiceOption];
  answer: 0 | 1;
}

export interface OrderItem {
  id: string;
  label: string;
  /** Shown on reveal, e.g. "17.1 million km2". */
  detail?: string;
}

/** Arrange items. Partial credit via pairwise concordance. */
export interface OrderQuestion extends QuestionCommon {
  type: 'order';
  /** What the ordering means, e.g. "Largest first". */
  instruction: string;
  /** Authoring order == correct order. Presented shuffled. */
  items: OrderItem[];
}

/** Deduction / logic. Used sparingly — never the dominant format. */
export interface MultipleChoiceQuestion extends QuestionCommon {
  type: 'multiple-choice';
  options: string[];
  answer: number;
}

export type Question =
  | NumericQuestion
  | PercentageQuestion
  | ProbabilityQuestion
  | YearQuestion
  | HigherLowerQuestion
  | ChoiceQuestion
  | OrderQuestion
  | MultipleChoiceQuestion;

export type QuestionType = Question['type'];

export const QUESTION_TYPES: QuestionType[] = [
  'numeric',
  'percentage',
  'probability',
  'year',
  'higher-lower',
  'which-is-bigger',
  'which-is-closer',
  'order',
  'multiple-choice',
];

/** Question types where the player enters/derives a number. */
export const NUMERIC_TYPES: QuestionType[] = ['numeric', 'percentage', 'probability', 'year'];

/** A player submission, discriminated the same way as the question. */
export type Guess =
  | { kind: 'number'; value: number }
  | { kind: 'binary'; value: 0 | 1 }
  | { kind: 'higher-lower'; value: 'higher' | 'lower' }
  | { kind: 'order'; value: string[] }
  | { kind: 'none' };

export const NO_GUESS: Guess = { kind: 'none' };

/**
 * A question as sent to clients: the answer, reveal text and source are
 * stripped so they can never leak into the network tab before the reveal.
 */
export type PublicQuestion = {
  id: string;
  type: QuestionType;
  prompt: string;
  subPrompt?: string;
  category: Category;
  tags?: string[];
  unit?: string;
  magnitude?: NumericQuestion['magnitude'];
  range?: YearQuestion['range'];
  reference?: string;
  instruction?: string;
  options?: ChoiceOption[] | string[];
  items?: OrderItem[];
};

/** Everything the reveal screen needs, sent only once every guess is locked. */
export interface RevealPayload {
  /** Numeric truth for numeric/percentage/probability/year questions. */
  answerValue: number | null;
  /** Human-readable answer, e.g. "about 43.3 million". */
  answerLabel: string;
  unit?: string;
  /** For choice / multiple-choice questions. */
  correctIndex?: number;
  /** For higher-lower. */
  correctSide?: 'higher' | 'lower';
  actual?: string;
  /** For order questions: item ids in correct order. */
  correctOrder?: string[];
  /** Per-option detail strings, revealed alongside the answer. */
  optionDetails?: (string | undefined)[];
  reveal: QuestionReveal;
  source?: QuestionSource;
}
