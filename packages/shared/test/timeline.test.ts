import { describe, expect, it } from 'vitest';

import {
  clampYear,
  createRng,
  randomSeed,
  sliderFromYear,
  YEAR_AXIS_LATEST,
  YEAR_AXIS_OLDEST,
  YEAR_SLIDER_DEFAULT,
  YEAR_SLIDER_DEFAULT_YEAR,
  YEAR_SLIDER_STEPS,
  yearFromSlider,
} from '../src/index.js';

describe('the year axis', () => {
  it('is the same for every question, so its start reveals nothing', () => {
    // The whole point: there is one axis and one starting position. Nothing
    // here takes a question, so no answer can move it.
    expect(YEAR_SLIDER_DEFAULT).toBe(YEAR_SLIDER_STEPS / 2);
    expect(YEAR_SLIDER_DEFAULT_YEAR).toBe(yearFromSlider(YEAR_SLIDER_DEFAULT));
  });

  it('starts nowhere near either end', () => {
    expect(YEAR_SLIDER_DEFAULT_YEAR).toBeGreaterThan(1500);
    expect(YEAR_SLIDER_DEFAULT_YEAR).toBeLessThan(YEAR_AXIS_LATEST - 100);
  });

  it('spans the ends exactly', () => {
    expect(yearFromSlider(0)).toBe(YEAR_AXIS_OLDEST);
    expect(yearFromSlider(YEAR_SLIDER_STEPS)).toBe(YEAR_AXIS_LATEST);
  });

  it('is monotonic', () => {
    let previous = -Infinity;
    for (let position = 0; position <= YEAR_SLIDER_STEPS; position++) {
      const year = yearFromSlider(position);
      expect(year).toBeGreaterThanOrEqual(previous);
      previous = year;
    }
  });

  it('resolves single years in the modern era', () => {
    for (const year of [1969, 1994, 2001, 2019]) {
      expect(yearFromSlider(sliderFromYear(year))).toBe(year);
    }
  });

  it('round-trips deep history to within a human lifetime', () => {
    for (const year of [-3000, -1200, 476, 1066]) {
      const back = yearFromSlider(sliderFromYear(year));
      const slack = Math.max(2, Math.abs(YEAR_AXIS_LATEST - year) * 0.02);
      expect(Math.abs(back - year)).toBeLessThanOrEqual(slack);
    }
  });

  it('clamps and survives nonsense', () => {
    expect(clampYear(99_999)).toBe(YEAR_AXIS_LATEST);
    expect(clampYear(-99_999)).toBe(YEAR_AXIS_OLDEST);
    expect(Number.isFinite(clampYear(Number.NaN))).toBe(true);
    expect(Number.isFinite(yearFromSlider(Number.NaN))).toBe(true);
    expect(Number.isFinite(sliderFromYear(Number.POSITIVE_INFINITY))).toBe(true);
  });
});

describe('seeding', () => {
  it('does not collapse fractional seeds to one stream', () => {
    // 0.4 >>> 0 is 0. Before this was fixed, every createRng(Math.random())
    // produced byte-identical output.
    const firsts = new Set<number>();
    for (let i = 0; i < 50; i++) firsts.add(createRng(Math.random())());
    expect(firsts.size).toBeGreaterThan(40);
  });

  it('mints distinct integer seeds', () => {
    const seeds = new Set<number>();
    for (let i = 0; i < 200; i++) seeds.add(randomSeed());
    expect(seeds.size).toBeGreaterThan(190);
    for (const seed of seeds) expect(Number.isInteger(seed)).toBe(true);
  });

  it('is still deterministic for a given seed', () => {
    const a = createRng('room:ABCD');
    const b = createRng('room:ABCD');
    for (let i = 0; i < 20; i++) expect(a()).toBe(b());
  });
});
