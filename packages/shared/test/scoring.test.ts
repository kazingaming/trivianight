import { describe, expect, it } from 'vitest';
import {
  bandFor,
  computeRoundPoints,
  costsLife,
  numericAccuracy,
  orderAccuracy,
  scoreGuess,
} from '../src/scoring.js';
import { difficultyWeights, MODES, rollDifficulty } from '../src/curve.js';
import { createRng } from '../src/util.js';
import type { NumericQuestion, OrderQuestion, Question } from '../src/types.js';

const blind: NumericQuestion = {
  id: 'test-blind',
  type: 'numeric',
  prompt: 'How many people were blind worldwide in 2020?',
  category: 'People',
  difficulty: 2,
  answer: 43_300_000,
  reveal: { explanation: 'test' },
};

describe('numeric accuracy is scale-free', () => {
  it('treats a 2x miss the same at any magnitude', () => {
    const small = numericAccuracy(50, 100, 0.32);
    const huge = numericAccuracy(5e9, 1e10, 0.32);
    expect(small).toBeCloseTo(huge, 10);
  });

  it('rewards being almost right', () => {
    expect(numericAccuracy(100, 100, 0.32)).toBe(1);
    expect(numericAccuracy(110, 100, 0.32)).toBeGreaterThan(0.9);
    expect(numericAccuracy(150, 100, 0.32)).toBeGreaterThan(0.6);
  });

  it('still pays something for the right ballpark', () => {
    const twoTimesOff = numericAccuracy(200, 100, 0.32);
    expect(twoTimesOff).toBeGreaterThan(0.3);
    expect(twoTimesOff).toBeLessThan(0.5);
  });

  it('punishes orders of magnitude', () => {
    expect(numericAccuracy(1000, 100, 0.32)).toBeLessThan(0.05);
    expect(numericAccuracy(100_000, 100, 0.32)).toBeLessThan(0.001);
  });

  it('is symmetric above and below', () => {
    expect(numericAccuracy(200, 100, 0.32)).toBeCloseTo(numericAccuracy(50, 100, 0.32), 10);
  });

  it('scores zero for impossible guesses instead of NaN', () => {
    expect(numericAccuracy(0, 100, 0.32)).toBe(0);
    expect(numericAccuracy(-5, 100, 0.32)).toBe(0);
    expect(numericAccuracy(Number.NaN, 100, 0.32)).toBe(0);
  });
});

describe('scoreGuess', () => {
  it('gives the worked example a respectable score', () => {
    // 20 million against 43.3 million: wrong, but the right order of magnitude.
    const result = scoreGuess(blind, { kind: 'number', value: 20_000_000 });
    expect(result.accuracy).toBeGreaterThan(0.25);
    expect(result.accuracy).toBeLessThan(0.6);
    expect(result.miss?.label).toMatch(/too low/);
    expect(result.band).toBe('fair');
  });

  it('treats a missing guess as unanswered rather than zero-accuracy noise', () => {
    const result = scoreGuess(blind, { kind: 'none' });
    expect(result.answered).toBe(false);
    expect(result.basePoints).toBe(0);
    expect(costsLife(result)).toBe(true);
  });

  it('ignores a guess of the wrong shape', () => {
    const result = scoreGuess(blind, { kind: 'binary', value: 1 });
    expect(result.answered).toBe(false);
  });

  it('scores binary formats all or nothing, with a speed nudge', () => {
    const question: Question = {
      id: 'q',
      type: 'which-is-closer',
      prompt: 'p',
      category: 'History',
      difficulty: 2,
      options: [{ label: 'A' }, { label: 'B' }],
      answer: 1,
      reveal: { explanation: 'x' },
    };
    const fast = scoreGuess(question, { kind: 'binary', value: 1 }, { speed: 1 });
    const slow = scoreGuess(question, { kind: 'binary', value: 1 }, { speed: 0 });
    const wrong = scoreGuess(question, { kind: 'binary', value: 0 });
    expect(fast.basePoints).toBeGreaterThan(slow.basePoints);
    expect(slow.basePoints).toBeGreaterThan(0);
    expect(wrong.basePoints).toBe(0);
    expect(wrong.correct).toBe(false);
  });
});

describe('order questions', () => {
  const question: OrderQuestion = {
    id: 'order',
    type: 'order',
    prompt: 'Order these',
    instruction: 'Largest first',
    category: 'Geography',
    difficulty: 2,
    items: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
      { id: 'c', label: 'C' },
      { id: 'd', label: 'D' },
    ],
    reveal: { explanation: 'x' },
  };

  it('gives full marks for a perfect order', () => {
    expect(orderAccuracy(['a', 'b', 'c', 'd'], ['a', 'b', 'c', 'd'])).toBe(1);
  });

  it('gives nothing for a reversed order', () => {
    expect(orderAccuracy(['d', 'c', 'b', 'a'], ['a', 'b', 'c', 'd'])).toBe(0);
  });

  it('gives partial credit for one swap', () => {
    const accuracy = orderAccuracy(['a', 'c', 'b', 'd'], ['a', 'b', 'c', 'd']);
    expect(accuracy).toBeGreaterThan(0.5);
    expect(accuracy).toBeLessThan(1);
  });

  it('does not reward a coin-flip ordering', () => {
    const result = scoreGuess(question, { kind: 'order', value: ['b', 'a', 'd', 'c'] });
    expect(result.accuracy).toBeLessThan(0.6);
  });
});

describe('round points', () => {
  it('pays more for harder questions', () => {
    const score = scoreGuess(blind, { kind: 'number', value: 43_300_000 });
    const easy = computeRoundPoints({ score, difficulty: 1 });
    const hard = computeRoundPoints({ score, difficulty: 4 });
    expect(hard.total).toBeGreaterThan(easy.total);
  });

  it('only pays a streak bonus on a solid round', () => {
    const good = scoreGuess(blind, { kind: 'number', value: 44_000_000 });
    const bad = scoreGuess(blind, { kind: 'number', value: 400 });
    expect(computeRoundPoints({ score: good, difficulty: 2, streak: 4 }).streakBonus).toBeGreaterThan(
      0,
    );
    expect(computeRoundPoints({ score: bad, difficulty: 2, streak: 4 }).streakBonus).toBe(0);
  });

  it('does not award a closest bonus in a single-player round', () => {
    const score = scoreGuess(blind, { kind: 'number', value: 43_000_000 });
    expect(
      computeRoundPoints({ score, difficulty: 2, closest: true, contenders: 1 }).closestBonus,
    ).toBe(0);
    expect(
      computeRoundPoints({ score, difficulty: 2, closest: true, contenders: 3 }).closestBonus,
    ).toBeGreaterThan(0);
  });

  it('never lets a close second score zero because someone edged them', () => {
    const winner = scoreGuess(blind, { kind: 'number', value: 43_000_000 });
    const runnerUp = scoreGuess(blind, { kind: 'number', value: 41_000_000 });
    const winnerPoints = computeRoundPoints({
      score: winner,
      difficulty: 2,
      closest: true,
      contenders: 2,
    });
    const runnerUpPoints = computeRoundPoints({ score: runnerUp, difficulty: 2, contenders: 2 });
    expect(runnerUpPoints.total).toBeGreaterThan(winnerPoints.total * 0.6);
  });
});

describe('bands', () => {
  it('reserves the top band for near-exact guesses', () => {
    expect(bandFor(numericAccuracy(101, 100, 0.32))).toBe('perfect');
    expect(bandFor(numericAccuracy(120, 100, 0.32))).not.toBe('perfect');
    expect(bandFor(0)).toBe('disaster');
  });
});

describe('difficulty curve', () => {
  it('climbs in every mode', () => {
    for (const mode of ['solo', 'duel', 'ffa'] as const) {
      const early = difficultyWeights(mode, 1);
      const late = difficultyWeights(mode, 20);
      expect(late[4] + late[5]).toBeGreaterThan(early[4] + early[5]);
      expect(early[1] + early[2]).toBeGreaterThan(late[1] + late[2]);
    }
  });

  it('climbs fastest in solo and gentlest in free for all', () => {
    const centreOf = (mode: 'solo' | 'duel' | 'ffa', round: number) => {
      const weights = difficultyWeights(mode, round);
      const total = Object.values(weights).reduce((a, b) => a + b, 0);
      return (
        Object.entries(weights).reduce((sum, [tier, w]) => sum + Number(tier) * w, 0) / total
      );
    };
    expect(centreOf('solo', 6)).toBeGreaterThan(centreOf('ffa', 6));
    expect(centreOf('duel', 6)).toBeGreaterThan(centreOf('ffa', 6));
  });

  it('produces a spread rather than a fixed tier', () => {
    const rng = createRng('seed');
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) seen.add(rollDifficulty('ffa', 8, rng));
    expect(seen.size).toBeGreaterThan(1);
  });

  it('keeps every mode configured coherently', () => {
    for (const mode of Object.values(MODES)) {
      expect(mode.maxPlayers).toBeGreaterThanOrEqual(mode.minPlayers);
      expect(mode.defaultTimeLimit).toBeGreaterThan(10);
    }
  });
});
