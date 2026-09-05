/**
 * Question importer.
 *
 * Turns a plain-text question list — the format a human (or a model) actually
 * writes questions in — into a typed pack the game can load. Run it with:
 *
 *     npm run content:import [path-to-text-file]
 *
 * The rules here are deliberately conservative. A question that cannot be
 * converted with confidence is *skipped and reported*, never guessed at: a
 * silently mis-keyed answer is far worse for a player than a missing question.
 * Everything it does emit then still has to pass `npm run content:check`.
 *
 * Output is generated, so hand-edits belong in OVERRIDES below rather than in
 * the emitted file — that way a re-run cannot quietly undo them.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Category, Difficulty, Question } from '@trivia/shared';
import { PACKS } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

const INPUT = resolve(repoRoot, process.argv[2] ?? 'Claude_New_Questions.txt');
const OUTPUT = resolve(here, '../src/packs/wide/questions.ts');
const PACK_PREFIX = 'wide';
/** The pack this script owns, in packages/content/src/index.ts. */
const PACK_ID = 'wide.core';

/* ------------------------------------------------------------------ *
 * Hand corrections
 *
 * Keyed by the number the question carries in the source file. Anything set
 * here wins over what the parser worked out. Use it for the handful of entries
 * whose phrasing defeats the general rules — never to paper over a rule that
 * is wrong for a whole class of questions.
 * ------------------------------------------------------------------ */

interface Override {
  /** Drop the question entirely, with a reason for the report. */
  skip?: string;
  type?: Question['type'];
  answer?: number;
  unit?: string;
  options?: string[];
  answerIndex?: number;
  category?: Category;
  difficulty?: Difficulty;
  prompt?: string;
}

const OVERRIDES: Record<number, Override> = {
  // Already in the bank in a different phrasing. The automatic check compares
  // subjects, so these — same fact, different wording — need saying out loud.
  1: { skip: 'already asked as space.earths-to-moon' },
  29: { skip: 'already asked as space.sun-mass-share' },
  33: { skip: 'conflicts with the existing Sahara comparison, which uses the contiguous US' },
  53: { skip: 'the bank already asks the land/water split the other way round' },
  74: { skip: 'already asked as the grains-of-rice question' },
  91: { skip: 'already asked as the Rome / New York latitude comparison' },
  100: { skip: 'already asked as the five-machines puzzle' },
  124: { skip: 'already asked as the bat-and-ball puzzle' },

  // The quantity is stated in words the number parser cannot reach.
  75: { answer: 10, unit: 'tonnes' },

  // A look-and-say sequence. The answer is a *pattern*, and scoring how close
  // the digits land to 312211 would be meaningless.
  172: { skip: 'sequence puzzle — no format scores it sensibly' },
};

/* ------------------------------------------------------------------ *
 * Parsing the text format
 * ------------------------------------------------------------------ */

interface Block {
  n: number;
  prompt: string;
  options: string[];
  fields: Record<string, string>;
}

const HEAD = /^(\d{1,3})\.\s+(.*)$/;
const FIELD =
  /^\s*(Answer|Type|Category|Difficulty|Reveal|Source|Acceptable ballpark|Acceptable range|Assumptions?|Best input|Total)\s*:\s*(.*)$/;
const OPTION = /^\s*([A-F])\)\s*(.+)$/;

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let promptLines: string[] = [];
  let current: (Omit<Block, 'prompt'> & { lastField: string | null }) | null = null;

  const flush = () => {
    if (current) blocks.push({ ...current, prompt: promptLines.join(' ').trim() });
  };

  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const head = HEAD.exec(raw);
    if (head) {
      flush();
      promptLines = [head[2].trim()];
      current = { n: Number(head[1]), options: [], fields: {}, lastField: null };
      continue;
    }
    if (!current) continue;

    const field = FIELD.exec(raw);
    if (field) {
      const key = field[1];
      current.lastField = key;
      current.fields[key] = current.fields[key] ? `${current.fields[key]} ${field[2].trim()}` : field[2].trim();
      continue;
    }

    const option = OPTION.exec(raw);
    if (option && !current.fields.Answer) {
      current.options.push(option[2].trim());
      continue;
    }

    const line = raw.trim();
    if (!line) {
      current.lastField = null;
      continue;
    }
    // A reveal is often several sentences across several lines.
    if (current.lastField === 'Reveal') {
      current.fields.Reveal += ` ${line}`;
      continue;
    }
    // Before the answer, anything else is a continuation of the prompt. After
    // it, it is a restatement in other units or a stray section heading.
    if (!current.fields.Answer) promptLines.push(line);
  }
  flush();
  return blocks;
}

/* ------------------------------------------------------------------ *
 * Numbers
 * ------------------------------------------------------------------ */

const SCALES: Record<string, number> = {
  hundred: 1e2,
  thousand: 1e3,
  million: 1e6,
  billion: 1e9,
  trillion: 1e12,
  quadrillion: 1e15,
  quintillion: 1e18,
  sextillion: 1e21,
};

/** Leading hedges. Stripped for parsing; the original text is kept for display. */
const HEDGE =
  /^(?:roughly|approximately|approx\.?|about|around|nearly|almost|just over|just under|a little over|a little under|slightly over|slightly under|over|under|more than|less than|up to about|up to|at least|some|~)\s+/i;

const NUMBER = String.raw`\d[\d,]*(?:\.\d+)?`;
const SCALE_WORDS = Object.keys(SCALES).join('|');

interface ParsedAnswer {
  value: number;
  unit?: string;
  percent: boolean;
}

function stripHedges(text: string): string {
  let out = text.trim();
  for (let i = 0; i < 4; i++) {
    const next = out.replace(HEDGE, '');
    if (next === out) break;
    out = next;
  }
  return out;
}

/**
 * Read a quantity out of an answer line.
 *
 * Handles "About 3.7 km", "Roughly 30 trillion", "About 50,000–60,000 workers"
 * and "About 14× larger". A stated range collapses to its geometric mean,
 * which is the midpoint that log-ratio scoring actually treats as central.
 */
function parseAnswerValue(raw: string): ParsedAnswer | null {
  const text = stripHedges(raw.replace(/[−–—]/g, (m) => (m === '−' ? '-' : '–')));

  const pattern = new RegExp(
    String.raw`^(-?${NUMBER})(?:\s*(?:–|-|\s+to\s+)\s*(-?${NUMBER}))?\s*(%)?\s*(${SCALE_WORDS})?\s*(.*)$`,
    'i',
  );
  const match = pattern.exec(text);
  if (!match) return null;

  const toNumber = (value: string | undefined) =>
    value === undefined ? undefined : Number(value.replace(/,/g, ''));

  const low = toNumber(match[1]);
  const high = toNumber(match[2]);
  if (low === undefined || !Number.isFinite(low)) return null;
  if (high !== undefined && !Number.isFinite(high)) return null;

  const scale = match[4] ? SCALES[match[4].toLowerCase()] : 1;
  let value =
    high === undefined
      ? low
      : low > 0 && high > 0
        ? Math.sqrt(low * high)
        : (low + high) / 2;
  value *= scale;

  let rest = (match[5] ?? '').trim();
  // "2/3, or about 66.7%" and "3:40" are a fraction and a clock time, not a
  // quantity with a unit. Refuse them here; a later rule may still cope.
  if (/^[/:]/.test(rest)) return null;

  const percent = Boolean(match[3]) || /^%/.test(rest);
  if (percent) rest = rest.replace(/^%/, '').trim();

  // The midpoint of a stated range is an approximation. Do not dress it up
  // as 54772.25575051661.
  if (high !== undefined) value = Number(value.toPrecision(3));

  return { value, unit: cleanUnit(rest), percent };
}

/** A unit is a short noun. Anything longer is prose and is dropped. */
function cleanUnit(raw: string): string | undefined {
  let unit = raw
    .replace(/^(?:of|per|a|an|the)\s+/i, '')
    .replace(/[.,;:]+$/, '')
    .trim();
  if (!unit) return undefined;

  // "14× larger" and "16 times more" both mean the unit is a multiplier.
  // No  after ×: it is not a word character, so there is no boundary there.
  if (/^(?:×|x|times)/i.test(unit)) return '×';

  // "feet / 1,800–2,400 m" restates the same quantity in other units. Keep
  // the first, which is the one the number was read from. "km/h" has no
  // spaces around its slash, so it survives.
  unit = unit.split(/\s\/\s/)[0].trim();
  // Trailing commentary: "litres per day, which is …"
  unit = unit.split(/[,(]/)[0].trim();
  const words = unit.split(/\s+/);
  if (words.length > 3 || unit.length > 18) return undefined;
  if (/(?:than|which|because|and|or|is|are|was|were)/i.test(unit)) return undefined;
  return unit;
}

function magnitudeFor(value: number): 'small' | 'thousands' | 'millions' | 'billions' | 'astronomical' {
  const size = Math.abs(value);
  if (size < 1e3) return 'small';
  if (size < 1e6) return 'thousands';
  if (size < 1e9) return 'millions';
  if (size < 1e12) return 'billions';
  return 'astronomical';
}

/* ------------------------------------------------------------------ *
 * Text matching
 * ------------------------------------------------------------------ */

const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'by', 'for', 'and', 'or',
  'is', 'are', 'was', 'were', 'it', 'its', 'entire', 'whole', 'all', 'total',
  'about', 'roughly', 'approximately', 'only', 'just', 'more', 'than', 'that',
]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    // Single digits are kept: "$1 bill" and "$100 bill" differ only there.
    .filter((word) => (word.length > 1 || /\d/.test(word)) && !STOPWORDS.has(word));
}

function sharedWords(a: string, b: string): { shared: number; small: number; large: number } {
  const left = new Set(tokens(a));
  const right = new Set(tokens(b));
  let shared = 0;
  for (const word of left) if (right.has(word)) shared++;
  return {
    shared,
    small: Math.min(left.size, right.size),
    large: Math.max(left.size, right.size),
  };
}

/**
 * How well a short label matches a longer one — "The Moon" against "the entire
 * Moon". Scored over the *smaller* set, because a correct answer is routinely
 * a fragment of the option it names.
 */
function similarity(a: string, b: string): number {
  const { shared, small } = sharedWords(a, b);
  return small === 0 ? 0 : shared / small;
}

/** Proper nouns and figures — the words that make a question about a thing. */
function subjects(text: string): Set<string> {
  const out = new Set<string>();
  const words = text.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const word = words[i].replace(/[^A-Za-z0-9'’-]/g, '');
    if (!word) continue;
    // Skip the first word of a sentence: its capital says nothing.
    const sentenceStart = i === 0 || /[.?!:]$/.test(words[i - 1]);
    if (/^\d/.test(word) || (!sentenceStart && /^[A-Z]/.test(word))) {
      out.add(word.toLowerCase());
    }
  }
  return out;
}

/**
 * Whether two questions are the same question.
 *
 * Scored over the *larger* token set, so a terse prompt cannot swallow every
 * question that happens to share its words — and gated on the subjects, so
 * "…border with Germany" and "…border with China" stay two questions however
 * identical the rest of the sentence is.
 */
function sameQuestion(a: string, b: string): boolean {
  const left = subjects(a);
  const right = subjects(b);
  if (left.size !== right.size) return false;
  for (const word of left) if (!right.has(word)) return false;

  const { shared, large } = sharedWords(a, b);
  return large >= 3 && shared / large >= 0.72;
}

/** Everything that identifies a question: what it asks, and what it offers. */
function identity(question: Question): string {
  const parts: string[] = [question.prompt];
  if (question.type === 'multiple-choice') parts.push(...question.options);
  if (question.type === 'which-is-bigger' || question.type === 'which-is-closer') {
    parts.push(...question.options.map((option) => option.label));
  }
  if (question.type === 'order') parts.push(...question.items.map((item) => item.label));
  return parts.join(' ');
}

/** The part of an answer that names a thing, before any qualification. */
function answerHead(answer: string): string {
  return answer.split(/\s+[—–-]\s+|,\s+(?:but|by|and|though|although)\b|\.\s/)[0].trim();
}

/* ------------------------------------------------------------------ *
 * Field mapping
 * ------------------------------------------------------------------ */

const DIFFICULTY: Record<string, Difficulty> = {
  easy: 1,
  'easy / medium': 2,
  'easy/medium': 2,
  medium: 3,
  'medium / hard': 4,
  'medium/hard': 4,
  hard: 4,
  'hard, but fun': 5,
  wildcard: 5,
};

const CATEGORY: Array<[RegExp, Category]> = [
  [/mytholog/i, 'Mythology'],
  [/space|astronom|solar|planet/i, 'Space'],
  [/human body|anatomy|human perception|psycholog|human scale|^humans?\b|people|population/i, 'People'],
  [/animal|bird|insect|marine life|evolution/i, 'Animals'],
  [/geograph|ocean|geolog|map|countr|continent|capital city|national flag|land border/i, 'Geography'],
  [/earth|climate|weather|water/i, 'Earth'],
  [/nature|plant|forest/i, 'Nature'],
  [/histor|ancient|inventions?|calendar/i, 'History'],
  [/logic|probabilit|deduction|reasoning|spatial|math|combinator|pattern|optimi/i, 'Logic'],
  [/food|cooking|drink/i, 'Food'],
  [/money|econom|finance|cost/i, 'Money'],
  [/technolog|comput|internet|engineering|infrastructure|microwave|engine|barcode|laser|printer|phone|radio/i, 'Technology'],
  [/physic|chemis|science|biolog|energy|time/i, 'Science'],
  [/everyday|object|life|cultur/i, 'Everyday'],
];

function mapDifficulty(raw: string | undefined): Difficulty {
  const key = (raw ?? '').trim().toLowerCase().replace(/\s*\/\s*/g, ' / ');
  return DIFFICULTY[key] ?? 3;
}

/**
 * Two passes, in order of trust.
 *
 * The authored Category and Type lines say what a question is *about*; the
 * prompt only says what words it happens to contain — "if there are 13 people
 * in a room" is a logic puzzle, not a question about people. So the prompt is
 * consulted only when nothing was authored.
 */
function mapCategory(block: Block): Category {
  const authored = `${block.fields.Category ?? ''} ${block.fields.Type ?? ''}`.trim();
  for (const [pattern, category] of CATEGORY) {
    if (authored && pattern.test(authored)) return category;
  }
  for (const [pattern, category] of CATEGORY) {
    if (pattern.test(block.prompt)) return category;
  }
  return 'Everyday';
}

function mapSource(raw: string | undefined): Question['source'] {
  const citation = (raw ?? '').trim().replace(/[.\s]+$/, '');
  if (!citation) return undefined;
  const kind = /calculat|mathematic|logical|definition|derived|puzzle|chronolog/i.test(citation)
    ? 'definitional'
    : /model|simulat|projection/i.test(citation)
      ? 'modelled'
      : /estimate|consensus|research/i.test(citation)
        ? 'estimated'
        : 'measured';
  return { citation, kind };
}

/* ------------------------------------------------------------------ *
 * Conversion
 * ------------------------------------------------------------------ */

interface Skip {
  n: number;
  reason: string;
  prompt: string;
}

const skipped: Skip[] = [];

function slug(text: string, n: number): string {
  const words = tokens(text).slice(0, 5).join('-').replace(/[^a-z0-9-]/g, '');
  return `${PACK_PREFIX}.${String(n).padStart(3, '0')}-${words || 'question'}`;
}

function convert(block: Block): Question | null {
  const override = OVERRIDES[block.n] ?? {};
  const drop = (reason: string): null => {
    skipped.push({ n: block.n, reason, prompt: block.prompt.slice(0, 72) });
    return null;
  };

  if (override.skip) return drop(override.skip);

  const prompt = (override.prompt ?? block.prompt).trim();
  const answerText = (block.fields.Answer ?? '').trim();
  const explanation = (block.fields.Reveal ?? '').trim();

  if (prompt.length < 12) return drop('prompt too short');
  if (!answerText) return drop('no answer');
  if (explanation.length < 20) return drop('reveal too short — the reveal is the payoff');

  const common = {
    id: slug(prompt, block.n),
    prompt,
    category: override.category ?? mapCategory(block),
    difficulty: override.difficulty ?? mapDifficulty(block.fields.Difficulty),
    reveal: { explanation },
    source: mapSource(block.fields.Source),
  };

  const typeHint = `${block.fields.Type ?? ''} ${block.fields.Category ?? ''}`;

  /* --- Explicit multiple choice ------------------------------------- */
  const options = override.options ?? block.options;
  if (options.length >= 2) {
    const index =
      override.answerIndex ?? matchOption(answerText, options);
    if (index === null) return drop(`answer "${answerText.slice(0, 40)}" matches no option`);
    if (new Set(options).size !== options.length) return drop('duplicate options');
    return {
      ...common,
      type: 'multiple-choice',
      options,
      answer: index,
      reveal: { ...common.reveal, headline: options[index] },
    };
  }

  /* --- Yes / no ------------------------------------------------------ */
  const yesNo = /^(yes|no)\b/i.exec(answerText);
  if (yesNo && answerText.length < 60) {
    const pair = ['Yes', 'No'];
    return {
      ...common,
      type: 'multiple-choice',
      options: pair,
      answer: yesNo[1].toLowerCase() === 'yes' ? 0 : 1,
      reveal: { ...common.reveal, headline: answerText },
    };
  }

  /* --- Numbers ------------------------------------------------------- */
  const parsed = override.answer !== undefined
    ? { value: override.answer, unit: override.unit, percent: false }
    : parseAnswerValue(answerText);

  if (parsed) {
    const isPercent =
      parsed.percent ||
      /percent/i.test(typeHint) ||
      (/percentage|what share|what proportion/i.test(prompt) && parsed.value <= 100);

    if (isPercent && parsed.value >= 0 && parsed.value <= 100) {
      const isProbability =
        /probabilit|chance|odds/i.test(`${typeHint} ${prompt}`);
      return {
        ...common,
        type: isProbability ? 'probability' : 'percentage',
        answer: parsed.value,
        displayAnswer: answerText,
        reveal: { ...common.reveal, headline: answerText },
      };
    }

    if (!isPercent && Number.isFinite(parsed.value) && parsed.value > 0) {
      return {
        ...common,
        type: 'numeric',
        answer: parsed.value,
        displayAnswer: answerText,
        unit: override.unit ?? parsed.unit,
        magnitude: magnitudeFor(parsed.value),
        reveal: { ...common.reveal, headline: answerText },
      };
    }
  }

  /* --- A percentage stated after something else ---------------------- *
   * "2/3, or about 66.7%" leads with a fraction the number parser refuses.
   * The percentage after it is the answer the game can actually score.
   */
  if (!parsed) {
    const trailing = /(\d[\d,]*(?:\.\d+)?)\s*%/.exec(answerText);
    const value = trailing ? Number(trailing[1].replace(/,/g, '')) : Number.NaN;
    if (Number.isFinite(value) && value >= 0 && value <= 100) {
      const isProbability = /probabilit|chance|odds/i.test(`${typeHint} ${prompt}`);
      return {
        ...common,
        type: isProbability ? 'probability' : 'percentage',
        answer: value,
        displayAnswer: answerText,
        reveal: { ...common.reveal, headline: answerText },
      };
    }
  }

  /* --- Two-way comparison -------------------------------------------- */
  const comparison = parseComparison(prompt, answerText);
  if (comparison) {
    const closer = /closer|farther|further|nearer/i.test(`${typeHint} ${prompt}`);
    return {
      ...common,
      prompt: comparison.prompt,
      type: closer ? 'which-is-closer' : 'which-is-bigger',
      options: [{ label: comparison.options[0] }, { label: comparison.options[1] }],
      answer: comparison.answer,
      reveal: { ...common.reveal, headline: answerText },
    };
  }

  return drop(`no rule converts answer "${answerText.slice(0, 48)}"`);
}

/**
 * Match a free-text answer to one of a list of options.
 *
 * An answer written as its own option letter ("C", or "B — the surrounding
 * air") names the option directly, so that is checked before any text scoring.
 */
function matchOption(answer: string, options: string[]): number | null {
  const letter = /^([A-F])(?:\)|\.|\s*[—–-]\s|$)/.exec(answer.trim());
  if (letter) {
    const index = letter[1].charCodeAt(0) - 65;
    if (index < options.length) return index;
  }

  const head = answerHead(answer.replace(/^[A-F]\)\s*/, ''));
  const scores = options.map((option) => similarity(head, option));
  let best = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i;
  const runnerUp = scores.filter((_, i) => i !== best).reduce((max, s) => Math.max(max, s), 0);
  if (scores[best] < 0.6 || scores[best] <= runnerUp) return null;
  return best;
}

/**
 * Pull two comparable things out of a prompt.
 *
 * Two shapes are accepted, both explicit:
 *   "Which is older: X or Y?"        — the choice follows a colon
 *   "Which city is farther north? X or Y"  — it follows the question mark
 *
 * Nothing looser. A prompt split in the wrong place produces a nonsense pair
 * of options, which is worse for a player than the question not existing.
 */
interface Comparison {
  options: [string, string];
  answer: 0 | 1;
  /** The prompt with any trailing choice list removed. */
  prompt: string;
}

function parseComparison(prompt: string, answer: string): Comparison | null {
  const colon = prompt.lastIndexOf(':');
  if (colon !== -1) {
    const found = fromChoiceList(prompt.slice(colon + 1), answer);
    if (found) return { ...found, prompt };
  }

  const question = prompt.lastIndexOf('?');
  if (question !== -1 && question < prompt.length - 4) {
    const tail = prompt.slice(question + 1);
    // A real choice list is one clause. Anything with sentence punctuation in
    // it is prose that happens to contain the word "or".
    if (!/[.?!:;]/.test(tail)) {
      const found = fromChoiceList(tail, answer);
      if (found) return { ...found, prompt: prompt.slice(0, question + 1).trim() };
    }
  }

  return null;
}

function fromChoiceList(raw: string, answer: string): Omit<Comparison, 'prompt'> | null {
  const tail = raw.replace(/\?\s*$/, '').trim();
  if (!tail) return null;

  const split = /^(.*?)(?:,\s*|\s+)or\s+(.*)$/i.exec(tail);
  if (!split) return null;
  // Two options, not three. A second "or", or a comma still sitting inside the
  // first option, means this is a list — "pink, white/gray, or black" — and
  // collapsing it to a pair would offer the player a nonsense choice.
  if (/or/i.test(split[2]) || split[1].includes(',')) return null;

  const left = tidyOption(split[1]);
  const right = tidyOption(split[2]);
  if (!left || !right) return null;
  if (left.length > 80 || right.length > 80) return null;

  const index = matchOption(answer, [left, right]);
  if (index === null) return null;
  return { options: [left, right], answer: index as 0 | 1 };
}

/** Words that stay lowercase inside a title, unless they lead it. */
const MINOR_WORDS = new Set([
  'a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'or', 'by', 'per',
]);

function tidyOption(raw: string): string {
  const text = raw.replace(/[.,;]\s*$/, '').trim();
  if (!text) return '';

  // Source prompts sometimes SHOUT the choices. A button should not, and
  // lowercasing outright would demote real names ("MEXICO CITY" -> "Mexico
  // city"), so shouted text is title-cased instead.
  if (text === text.toUpperCase() && /[A-Z]{3}/.test(text)) {
    return text
      .toLowerCase()
      .split(' ')
      .map((word, index) =>
        index > 0 && MINOR_WORDS.has(word)
          ? word
          : word.replace(/(^|-)([a-z])/g, (_, lead, letter) => lead + letter.toUpperCase()),
      )
      .join(' ');
  }

  return text.charAt(0).toUpperCase() + text.slice(1);
}

/* ------------------------------------------------------------------ *
 * Emit
 * ------------------------------------------------------------------ */

function literal(value: unknown, indent = 2): string {
  const pad = ' '.repeat(indent);
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((item) => `${pad}  ${literal(item, indent + 2)}`).join(',\n');
    return `[\n${items},\n${pad}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return '{}';
  const body = entries
    .map(([key, v]) => `${pad}  ${/^[A-Za-z_$][\w$]*$/.test(key) ? key : `'${key}'`}: ${literal(v, indent + 2)}`)
    .join(',\n');
  return `{\n${body},\n${pad}}`;
}

function main(): void {
  const text = readFileSync(INPUT, 'utf8');
  const blocks = parseBlocks(text);

  // Nothing that duplicates a question already in the bank, or each other.
  // The pack this script writes is excluded: once it is registered, comparing
  // against it would make every question a duplicate of its own last run.
  const seen = PACKS.filter((pack) => pack.id !== PACK_ID)
    .flatMap((pack) => pack.questions)
    .map(identity);
  const questions: Question[] = [];
  /** Pairs that scored close but were kept, so a human can settle them. */
  const nearMisses: string[] = [];

  for (const block of blocks) {
    const question = convert(block);
    if (!question) continue;

    const key = identity(question);
    const clash = seen.find((other) => sameQuestion(other, key));
    if (clash) {
      skipped.push({
        n: block.n,
        reason: `duplicate of "${clash.slice(0, 48)}"`,
        prompt: question.prompt.slice(0, 72),
      });
      continue;
    }

    const near = seen.find((other) => {
      const { shared, large } = sharedWords(other, key);
      return large >= 4 && shared / large >= 0.55;
    });
    if (near) nearMisses.push(`${String(block.n).padStart(3)}  ${question.prompt.slice(0, 60)}
       ~ ${near.slice(0, 60)}`);

    questions.push(question);
    seen.push(key);
  }

  const header = `/**
 * The wide bank.
 *
 * Generated by \`npm run content:import\` from a plain-text question list.
 * Do not hand-edit: corrections belong in scripts/import-questions.ts, which
 * is what a re-run reads. Every entry here has passed \`npm run content:check\`.
 */

import type { Question } from '@trivia/shared';

export const wideQuestions: Question[] = [
`;

  const body = questions.map((question) => `  ${literal(question, 2)},`).join('\n');
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${header}${body}\n];\n`, 'utf8');

  /* --- Report ------------------------------------------------------- */

  const byType = new Map<string, number>();
  const byDifficulty = new Map<number, number>();
  for (const question of questions) {
    byType.set(question.type, (byType.get(question.type) ?? 0) + 1);
    byDifficulty.set(question.difficulty, (byDifficulty.get(question.difficulty) ?? 0) + 1);
  }

  console.log('');
  console.log(`  Read      ${blocks.length} blocks from ${INPUT}`);
  console.log(`  Imported  ${questions.length}`);
  console.log(`  Skipped   ${skipped.length}`);
  console.log('');
  console.log('  By format');
  for (const [type, count] of [...byType].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${type.padEnd(16)} ${String(count).padStart(3)}`);
  }
  console.log('');
  console.log('  By difficulty');
  for (const tier of [1, 2, 3, 4, 5]) {
    console.log(`    ${tier}  ${String(byDifficulty.get(tier) ?? 0).padStart(3)}`);
  }
  console.log('');
  if (skipped.length) {
    console.log('  Skipped');
    for (const skip of skipped) {
      console.log(`    ${String(skip.n).padStart(3)}  ${skip.reason}`);
      console.log(`         ${skip.prompt}`);
    }
    console.log('');
  }
  if (nearMisses.length) {
    console.log(`  Kept, but close to something already in the bank (${nearMisses.length})`);
    for (const line of nearMisses) console.log(`    ${line}`);
    console.log('');
  }
  console.log(`  Wrote ${OUTPUT}`);
  console.log('');
}

main();
