/** Small deterministic helpers shared by the client and the server. */

/** FNV-1a. Stable across engines, which matters for seeded picks. */
export function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export type Rng = () => number;

/** mulberry32 — tiny, fast, good enough for shuffling a question pool. */
export function createRng(seed: number | string): Rng {
  let state = (typeof seed === 'string' ? hashString(seed) : seed >>> 0) || 1;
  return function next(): number {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates. Returns a new array; never mutates the input. */
export function shuffle<T>(items: readonly T[], rng: Rng = Math.random): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function pickOne<T>(items: readonly T[], rng: Rng = Math.random): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(rng() * items.length)];
}

/** Weighted pick. Weights need not sum to 1. */
export function pickWeighted<T>(
  entries: ReadonlyArray<{ value: T; weight: number }>,
  rng: Rng = Math.random,
): T | undefined {
  const total = entries.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0);
  if (total <= 0) return entries[0]?.value;
  let roll = rng() * total;
  for (const entry of entries) {
    roll -= Math.max(0, entry.weight);
    if (roll <= 0) return entry.value;
  }
  return entries[entries.length - 1]?.value;
}

/**
 * Characters that survive being read aloud or squinted at across a room.
 * Drops every lookalike pair: O/0, I/1/L, S/5, Z/2, B/8, Q/O.
 */
const CODE_ALPHABET = 'ACDEFGHJKMNPRTUVWXY34679';

export function createRoomCode(length = 4, rng: Rng = Math.random): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[Math.floor(rng() * CODE_ALPHABET.length)];
  }
  return code;
}

/** Lookalikes a player might type instead of the character actually shown. */
const CODE_CORRECTIONS: Record<string, string> = {
  '0': 'D',
  O: 'D',
  Q: 'D',
  '1': 'T',
  I: 'T',
  L: 'T',
  '5': 'F',
  S: 'F',
  '2': 'X',
  Z: 'X',
  '8': 'H',
  B: 'H',
};

/**
 * Tidy user input into a candidate code. Unknown characters are corrected to
 * their nearest in-alphabet lookalike so a misread O still finds the room.
 */
export function normalizeRoomCode(input: string): string {
  const cleaned = String(input ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
  let out = '';
  for (const char of cleaned) {
    if (CODE_ALPHABET.includes(char)) out += char;
    else out += CODE_CORRECTIONS[char] ?? char;
  }
  return out;
}

export function createId(prefix = ''): string {
  const random = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return `${prefix}${prefix ? '_' : ''}${time}${random}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Strip control characters, collapse whitespace, cap length.
 * Written as a loop rather than a regex class so no literal control
 * characters ever end up in this source file.
 */
export function sanitizeName(raw: string, maxLength = 14): string {
  let out = '';
  for (const char of String(raw ?? '')) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 32 || code === 127) continue;
    out += char;
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

export function uniqueName(desired: string, taken: readonly string[]): string {
  const base = desired || 'Player';
  const lower = new Set(taken.map((name) => name.toLowerCase()));
  if (!lower.has(base.toLowerCase())) return base;
  for (let suffix = 2; suffix < 100; suffix++) {
    const candidate = `${base} ${suffix}`;
    if (!lower.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} ${Math.floor(Math.random() * 1000)}`;
}

/** Wall-clock milliseconds. Wrapped so tests can stub it in one place. */
export function now(): number {
  return Date.now();
}
