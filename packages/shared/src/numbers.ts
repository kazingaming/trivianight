/**
 * Human number handling.
 *
 * Players must never have to type 20000000000000000. They type "20q" or
 * "20 quadrillion" or "2e16" and we show them exactly what we understood.
 */

export interface ParsedNumber {
  ok: boolean;
  value: number;
  /** Grouped digits, e.g. "20,000,000,000,000,000". */
  formatted: string;
  /** Compact words, e.g. "20 quadrillion". Empty for small numbers. */
  compact: string;
  /** Why the parse failed, for inline validation copy. */
  error?: string;
}

const SCALES: Array<{ names: string[]; factor: number }> = [
  { names: ['hundred'], factor: 1e2 },
  { names: ['k', 'thousand', 'thousands'], factor: 1e3 },
  { names: ['m', 'mn', 'mm', 'million', 'millions'], factor: 1e6 },
  { names: ['b', 'bn', 'billion', 'billions'], factor: 1e9 },
  { names: ['t', 'tn', 'tr', 'trillion', 'trillions'], factor: 1e12 },
  { names: ['q', 'qd', 'quad', 'quadrillion', 'quadrillions'], factor: 1e15 },
  { names: ['qn', 'quint', 'quintillion', 'quintillions'], factor: 1e18 },
  { names: ['sext', 'sextillion', 'sextillions'], factor: 1e21 },
  { names: ['sept', 'septillion', 'septillions'], factor: 1e24 },
];

const SCALE_LOOKUP: Map<string, number> = new Map();
for (const scale of SCALES) {
  for (const name of scale.names) SCALE_LOOKUP.set(name, scale.factor);
}

/** Words we accept as a compact suffix, longest-first so "million" beats "m". */
const SCALE_WORDS = [...SCALE_LOOKUP.keys()].sort((a, b) => b.length - a.length);

const COMPACT_UNITS: Array<{ factor: number; word: string }> = [
  { factor: 1e24, word: 'septillion' },
  { factor: 1e21, word: 'sextillion' },
  { factor: 1e18, word: 'quintillion' },
  { factor: 1e15, word: 'quadrillion' },
  { factor: 1e12, word: 'trillion' },
  { factor: 1e9, word: 'billion' },
  { factor: 1e6, word: 'million' },
  { factor: 1e3, word: 'thousand' },
];

const SHORT_UNITS: Array<{ factor: number; suffix: string }> = [
  { factor: 1e24, suffix: 'Sp' },
  { factor: 1e21, suffix: 'Sx' },
  { factor: 1e18, suffix: 'Qn' },
  { factor: 1e15, suffix: 'Qd' },
  { factor: 1e12, suffix: 'T' },
  { factor: 1e9, suffix: 'B' },
  { factor: 1e6, suffix: 'M' },
  { factor: 1e3, suffix: 'K' },
];

/**
 * Parse anything a human might reasonably type into a number field.
 * Accepts: 1234 · 1,234 · 1.5k · 2.5 million · 7b · 3.2e8 · 45% · -12
 */
export function parseHumanNumber(raw: string): ParsedNumber {
  const fail = (error: string): ParsedNumber => ({
    ok: false,
    value: Number.NaN,
    formatted: '',
    compact: '',
    error,
  });

  if (raw == null) return fail('Enter a number');
  let text = String(raw).trim().toLowerCase();
  if (!text) return fail('Enter a number');

  // Strip grouping and decorative characters.
  text = text.replace(/[,_\s]/g, '');
  const isPercent = text.endsWith('%');
  if (isPercent) text = text.slice(0, -1);
  if (!text) return fail('Enter a number');

  let sign = 1;
  if (text.startsWith('-')) {
    sign = -1;
    text = text.slice(1);
  } else if (text.startsWith('+')) {
    text = text.slice(1);
  }
  if (!text) return fail('Enter a number');

  // Scientific notation passes straight through: 3.2e8
  const scientific = /^(\d+(?:\.\d+)?)e([+-]?\d+)$/.exec(text);
  if (scientific) {
    const value = sign * Number(scientific[1]) * Math.pow(10, Number(scientific[2]));
    return finish(value);
  }

  // Caret notation, which is how people actually write huge numbers:
  // 10^80, 2x10^23, 1.5*10^9
  const caret = /^(?:(\d+(?:\.\d+)?)\s*[x*]\s*)?(\d+(?:\.\d+)?)\^([+-]?\d+)$/.exec(text);
  if (caret) {
    const mantissa = caret[1] ? Number(caret[1]) : 1;
    const value = sign * mantissa * Math.pow(Number(caret[2]), Number(caret[3]));
    return finish(value);
  }

  let factor = 1;
  for (const word of SCALE_WORDS) {
    if (text.endsWith(word) && text.length > word.length) {
      factor = SCALE_LOOKUP.get(word)!;
      text = text.slice(0, -word.length);
      break;
    }
  }

  // A bare suffix ("m") is not a number.
  if (!text) return fail('Add a number before the suffix');
  if (!/^\d*\.?\d*$/.test(text) || text === '.') {
    return fail('That is not a number I understand');
  }

  const base = Number(text);
  if (!Number.isFinite(base)) return fail('That is not a number I understand');

  return finish(sign * base * factor);

  function finish(value: number): ParsedNumber {
    if (!Number.isFinite(value)) return fail('That number is too large');
    // Generous enough for the wildcard questions, tight enough to catch typos.
    if (Math.abs(value) > 1e150) return fail('That number is off the scale');
    return {
      ok: true,
      value,
      formatted: formatGrouped(value),
      compact: formatCompactWords(value),
    };
  }
}

/** Above this, digits stop being readable and we switch to powers of ten. */
const POWER_THRESHOLD = 1e27;

/** 8.07e67 -> "8.1 x 10^67". The only sane way to show wildcard answers. */
export function formatPowerOfTen(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  const exponent = Math.floor(Math.log10(Math.abs(value)));
  const mantissa = value / Math.pow(10, exponent);
  const rounded = Math.round(mantissa * 10) / 10;
  return rounded === 1 ? `10^${exponent}` : `${rounded} x 10^${exponent}`;
}

/** 20000000 -> "20,000,000". Keeps up to 4 decimals for small values. */
export function formatGrouped(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= POWER_THRESHOLD) return formatPowerOfTen(value);
  if (abs !== 0 && abs < 0.001) return value.toExponential(2);
  const decimals = abs >= 1000 || Number.isInteger(value) ? 0 : abs >= 1 ? 2 : 4;
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

/** 43300000 -> "43.3 million". Returns "" below 10,000 where digits read fine. */
export function formatCompactWords(value: number): string {
  const abs = Math.abs(value);
  if (!Number.isFinite(value) || abs < 10_000) return '';
  if (abs >= POWER_THRESHOLD) return formatPowerOfTen(value);
  for (const unit of COMPACT_UNITS) {
    if (abs >= unit.factor) {
      const scaled = value / unit.factor;
      return `${trimNumber(scaled)} ${unit.word}`;
    }
  }
  return '';
}

/** 43300000 -> "43.3M". Used where space is tight (chips, axis labels). */
export function formatShort(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= POWER_THRESHOLD) return formatPowerOfTen(value);
  if (abs < 1000) return trimNumber(value);
  for (const unit of SHORT_UNITS) {
    if (abs >= unit.factor) return `${trimNumber(value / unit.factor)}${unit.suffix}`;
  }
  return trimNumber(value);
}

/** Best single-line rendering of a quantity for the reveal screen. */
export function formatDisplay(value: number, unit?: string): string {
  const compact = formatCompactWords(value);
  const body = compact || formatGrouped(value);
  return unit ? `${body} ${unit}` : body;
}

function stripTrailingZero(text: string): string {
  return text.endsWith('.0') ? text.slice(0, -2) : text;
}

function trimNumber(value: number): string {
  const abs = Math.abs(value);
  const decimals = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  const fixed = value.toFixed(decimals);
  return fixed.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

/** Year rendering that respects BCE. -69 -> "69 BCE", 2007 -> "2007". */
export function formatYear(year: number): string {
  const rounded = Math.round(year);
  if (rounded < 0) return `${Math.abs(rounded).toLocaleString('en-US')} BCE`;
  if (rounded === 0) return '1 BCE';
  return String(rounded);
}

export type MissDirection = 'high' | 'low' | 'exact';

export interface MissDescription {
  direction: MissDirection;
  /** e.g. "2.17x too low", "8% high", "43 years early". */
  label: string;
  /** Ratio guess/answer where meaningful, else null. */
  ratio: number | null;
}

/**
 * Describe a numeric miss the way a person would say it out loud.
 * Within 2x we talk in percentages; beyond that, multiples read better.
 */
export function describeNumericMiss(guess: number, answer: number): MissDescription {
  if (guess === answer) return { direction: 'exact', label: 'Exactly right', ratio: 1 };
  const direction: MissDirection = guess > answer ? 'high' : 'low';

  // Ratios are meaningless around zero or across a sign change.
  if (answer === 0 || guess === 0 || Math.sign(guess) !== Math.sign(answer)) {
    return { direction, label: `${formatShort(Math.abs(guess - answer))} off`, ratio: null };
  }

  const ratio = guess / answer;
  const absRatio = ratio > 1 ? ratio : 1 / ratio;

  if (absRatio < 2) {
    const pct = Math.abs((guess - answer) / answer) * 100;
    // "8% high" reads better than "8.0% high"; keep the decimal only when it says something.
    const shown = pct >= 10 ? String(Math.round(pct)) : stripTrailingZero(pct.toFixed(1));
    return { direction, label: `${shown}% ${direction}`, ratio };
  }

  const multiple = absRatio >= 1000 ? formatShort(absRatio) : trimNumber(absRatio);
  return { direction, label: `${multiple}x too ${direction}`, ratio };
}

/** Percentage-point framing, e.g. "12 points high". */
export function describePointMiss(guess: number, answer: number): MissDescription {
  if (Math.abs(guess - answer) < 0.05) {
    return { direction: 'exact', label: 'Exactly right', ratio: 1 };
  }
  const direction: MissDirection = guess > answer ? 'high' : 'low';
  const diff = Math.abs(guess - answer);
  const shown = diff < 1 ? diff.toFixed(1) : Math.round(diff).toString();
  const noun = shown === '1' ? 'point' : 'points';
  return { direction, label: `${shown} ${noun} ${direction}`, ratio: null };
}

/** Year framing, e.g. "43 years too early". */
export function describeYearMiss(guess: number, answer: number): MissDescription {
  const diff = Math.round(Math.abs(guess - answer));
  if (diff === 0) return { direction: 'exact', label: 'Exact year', ratio: 1 };
  const direction: MissDirection = guess > answer ? 'high' : 'low';
  const word = direction === 'high' ? 'too late' : 'too early';
  const noun = diff === 1 ? 'year' : 'years';
  return { direction, label: `${diff.toLocaleString('en-US')} ${noun} ${word}`, ratio: null };
}
