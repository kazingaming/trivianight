import { describe, expect, it } from 'vitest';

import { ALL_QUESTIONS, PACKS, QuestionPool, validateAll } from '../src/index.js';
import { createRng, difficultyWeights, MODES, toPublicQuestion } from '@trivia/shared';
import type { Difficulty } from '@trivia/shared';

/** Play a whole run and return what was drawn. */
function run(mode: 'solo' | 'duel' | 'ffa', rounds: number, exclude: string[] = []) {
  const pool = new QuestionPool({ mode, exclude });
  const drawn = [];
  for (let round = 1; round <= rounds; round++) {
    const question = pool.next(round);
    if (!question) break;
    drawn.push(question);
  }
  return drawn;
}

describe('the bank', () => {
  it('is large enough to be worth randomising', () => {
    expect(ALL_QUESTIONS.length).toBeGreaterThan(300);
  });

  it('has no validation errors', () => {
    const errors = validateAll().filter((issue) => issue.severity === 'error');
    expect(errors).toEqual([]);
  });

  it('has unique ids across every pack', () => {
    const ids = PACKS.flatMap((pack) => pack.questions).map((question) => question.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('random draws', () => {
  /*
   * The regression this covers: createRng was seeded with Math.random(), and
   * `0.4 >>> 0` is 0 for every value it can return — so every pool used one
   * identical stream and Solo opened on the same question every single time.
   */
  it('opens on a different question across fresh runs', () => {
    const openings = new Set<string>();
    for (let i = 0; i < 40; i++) openings.add(run('solo', 1)[0].id);
    expect(openings.size).toBeGreaterThan(6);
  });

  it('does not favour one opening question', () => {
    const counts = new Map<string, number>();
    const trials = 400;
    for (let i = 0; i < trials; i++) {
      const id = run('solo', 1)[0].id;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const commonest = Math.max(...counts.values());
    // Round one is nearly all tier 1, so the ceiling is a fair share of that
    // tier plus slack — not "the same question every time".
    expect(commonest).toBeLessThan(trials * 0.25);
  });

  it('never repeats a question inside one run', () => {
    for (let i = 0; i < 20; i++) {
      const ids = run('solo', 60).map((question) => question.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('honours an exclusion list', () => {
    const excluded = ALL_QUESTIONS.slice(0, 30).map((question) => question.id);
    const ids = run('solo', 40, excluded).map((question) => question.id);
    for (const id of ids) expect(excluded).not.toContain(id);
  });

  it('is reproducible from a seed, so a room can resume', () => {
    const first = new QuestionPool({ mode: 'duel', seed: 'ABCD:123' });
    const second = new QuestionPool({ mode: 'duel', seed: 'ABCD:123' });
    for (let round = 1; round <= 8; round++) {
      expect(first.next(round)!.id).toBe(second.next(round)!.id);
    }
  });

  it('draws down to empty rather than returning null early', () => {
    const pool = new QuestionPool({ mode: 'solo' });
    const total = ALL_QUESTIONS.length;
    for (let round = 1; round <= total; round++) {
      expect(pool.next(round), `round ${round}`).not.toBeNull();
    }
    expect(pool.remaining).toBe(0);
    expect(pool.next(total + 1)).toBeNull();
  });
});

describe('the difficulty curve survives randomisation', () => {
  const average = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

  it('climbs across a solo gauntlet', () => {
    const early: number[] = [];
    const late: number[] = [];
    for (let i = 0; i < 60; i++) {
      const drawn = run('solo', 14);
      early.push(...drawn.slice(0, 3).map((question) => question.difficulty));
      late.push(...drawn.slice(10, 14).map((question) => question.difficulty));
    }
    expect(average(early)).toBeLessThan(average(late) - 0.8);
  });

  it('opens gently and ends hard in every mode', () => {
    for (const mode of ['solo', 'duel', 'ffa'] as const) {
      const rounds = MODES[mode].rounds ?? 12;
      const first: number[] = [];
      const last: number[] = [];
      for (let i = 0; i < 50; i++) {
        const drawn = run(mode, rounds);
        first.push(drawn[0].difficulty);
        last.push(drawn[drawn.length - 1].difficulty);
      }
      expect(average(first), mode).toBeLessThan(average(last));
    }
  });

  it('can actually fill the tier each round asks for', () => {
    const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<Difficulty, number>;
    for (const question of ALL_QUESTIONS) counts[question.difficulty]++;
    for (const mode of ['solo', 'duel', 'ffa'] as const) {
      for (let round = 1; round <= (MODES[mode].rounds ?? 15); round++) {
        const weights = difficultyWeights(mode, round);
        const dominant = (Object.entries(weights) as Array<[string, number]>).sort(
          (a, b) => b[1] - a[1],
        )[0];
        expect(counts[Number(dominant[0]) as Difficulty], `${mode} round ${round}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('what reaches the client', () => {
  it('never ships an answer, a reveal or a source', () => {
    const rng = createRng('public');
    for (const question of ALL_QUESTIONS) {
      const json = JSON.stringify(toPublicQuestion(question, rng));
      expect(json).not.toContain('"answer"');
      expect(json).not.toContain('"reveal"');
      expect(json).not.toContain('"source"');
      expect(json).not.toContain('"difficulty"');
    }
  });

  it('ships no year bounds, which would be authored around the answer', () => {
    const years = ALL_QUESTIONS.filter((question) => question.type === 'year');
    expect(years.length).toBeGreaterThan(0);
    for (const question of years) {
      expect(JSON.stringify(toPublicQuestion(question))).not.toContain('range');
    }
  });
});
