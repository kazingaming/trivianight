import { describe, expect, it } from 'vitest';
import {
  describeNumericMiss,
  describePointMiss,
  describeYearMiss,
  formatCompactWords,
  formatGrouped,
  formatShort,
  formatYear,
  parseHumanNumber,
} from '../src/numbers.js';

describe('parseHumanNumber', () => {
  it('reads plain digits and grouping', () => {
    expect(parseHumanNumber('1234').value).toBe(1234);
    expect(parseHumanNumber('20,000,000').value).toBe(20_000_000);
    expect(parseHumanNumber(' 42 ').value).toBe(42);
  });

  it('reads single-letter shorthand', () => {
    expect(parseHumanNumber('25k').value).toBe(25_000);
    expect(parseHumanNumber('2.5m').value).toBe(2_500_000);
    expect(parseHumanNumber('7b').value).toBe(7_000_000_000);
    expect(parseHumanNumber('3.2t').value).toBe(3.2e12);
    expect(parseHumanNumber('20q').value).toBe(2e16);
  });

  it('reads written scale words with or without a space', () => {
    expect(parseHumanNumber('43.3 million').value).toBeCloseTo(43_300_000);
    expect(parseHumanNumber('3.04trillion').value).toBeCloseTo(3.04e12);
    expect(parseHumanNumber('117 BILLION').value).toBeCloseTo(1.17e11);
    expect(parseHumanNumber('20 quadrillion').value).toBe(2e16);
  });

  it('reads scientific notation and signs', () => {
    expect(parseHumanNumber('3.2e8').value).toBeCloseTo(3.2e8);
    expect(parseHumanNumber('-12').value).toBe(-12);
    expect(parseHumanNumber('50%').value).toBe(50);
  });

  it('rejects nonsense without throwing', () => {
    expect(parseHumanNumber('').ok).toBe(false);
    expect(parseHumanNumber('abc').ok).toBe(false);
    expect(parseHumanNumber('m').ok).toBe(false);
    expect(parseHumanNumber('.').ok).toBe(false);
    expect(parseHumanNumber('12..3').ok).toBe(false);
  });

  it('reads caret notation for the wildcard-scale questions', () => {
    expect(parseHumanNumber('10^80').value).toBe(1e80);
    expect(parseHumanNumber('8 x 10^67').value).toBeCloseTo(8e67);
    expect(parseHumanNumber('1.5*10^9').value).toBeCloseTo(1.5e9);
  });

  it('refuses absurd magnitudes rather than producing Infinity', () => {
    expect(parseHumanNumber('9e200').ok).toBe(false);
    expect(parseHumanNumber('10^500').ok).toBe(false);
  });

  it('echoes back what it understood', () => {
    const parsed = parseHumanNumber('2.5m');
    expect(parsed.formatted).toBe('2,500,000');
    expect(parsed.compact).toBe('2.5 million');
  });
});

describe('formatting', () => {
  it('groups digits', () => {
    expect(formatGrouped(43_300_000)).toBe('43,300,000');
    expect(formatGrouped(0)).toBe('0');
  });

  it('writes big numbers as words', () => {
    expect(formatCompactWords(43_300_000)).toBe('43.3 million');
    expect(formatCompactWords(2e16)).toBe('20 quadrillion');
    expect(formatCompactWords(3.04e12)).toBe('3.04 trillion');
    expect(formatCompactWords(500)).toBe('');
  });

  it('shortens for tight spaces', () => {
    expect(formatShort(43_300_000)).toBe('43.3M');
    expect(formatShort(999)).toBe('999');
  });

  it('handles BCE years', () => {
    expect(formatYear(-69)).toBe('69 BCE');
    expect(formatYear(2007)).toBe('2007');
  });
});

describe('miss descriptions', () => {
  it('uses percentages inside 2x', () => {
    expect(describeNumericMiss(108, 100).label).toBe('8% high');
    expect(describeNumericMiss(90, 100).label).toBe('10% low');
  });

  it('uses multiples beyond 2x', () => {
    const miss = describeNumericMiss(20_000_000, 43_300_000);
    expect(miss.direction).toBe('low');
    expect(miss.label).toMatch(/x too low$/);
  });

  it('describes an exact hit', () => {
    expect(describeNumericMiss(100, 100).direction).toBe('exact');
  });

  it('never divides by zero', () => {
    expect(describeNumericMiss(5, 0).label).toContain('off');
    expect(describeNumericMiss(0, 5).label).toContain('off');
  });

  it('talks in points for percentages and years for dates', () => {
    expect(describePointMiss(62, 50).label).toBe('12 points high');
    expect(describeYearMiss(1950, 1969).label).toBe('19 years too early');
  });
});
