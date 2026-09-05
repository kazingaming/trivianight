/**
 * The year slider's axis.
 *
 * Every year question shares one timeline, and the handle always opens at the
 * same point on it. That is the entire point. A per-question range is authored
 * *around* its answer, so the midpoint of that range is a hint — and on more
 * than one question the old slider opened within a few years of the answer, or
 * on it. A single shared axis with a fixed starting position cannot leak
 * anything, because it is identical no matter what the answer is.
 *
 * The axis is logarithmic in years-before-present, so one control spans deep
 * prehistory and still resolves single years in the modern era, where almost
 * all of the questions live.
 */

/** Fixed rather than "this year", so the axis never shifts under a player. */
export const YEAR_AXIS_LATEST = 2030;
export const YEAR_AXIS_OLDEST = -50_000;

/** Slider positions. Fine enough that a drag lands on a specific year. */
export const YEAR_SLIDER_STEPS = 1000;

/**
 * Where the handle sits before the player touches it: the middle of the track,
 * for every single question. It works out around 1800 CE, which is a fact
 * about the axis and not about any answer.
 */
export const YEAR_SLIDER_DEFAULT = YEAR_SLIDER_STEPS / 2;

const SPAN = YEAR_AXIS_LATEST - YEAR_AXIS_OLDEST;
const LOG_SPAN = Math.log1p(SPAN);

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Slider position (0..YEAR_SLIDER_STEPS) to a year. */
export function yearFromSlider(position: number): number {
  if (!Number.isFinite(position)) return YEAR_AXIS_LATEST;
  const u = clamp01(position / YEAR_SLIDER_STEPS);
  const beforeLatest = Math.expm1((1 - u) * LOG_SPAN);
  return Math.round(YEAR_AXIS_LATEST - beforeLatest);
}

/** A year back to the nearest slider position, for typed input. */
export function sliderFromYear(year: number): number {
  if (!Number.isFinite(year)) return YEAR_SLIDER_DEFAULT;
  const beforeLatest = Math.min(SPAN, Math.max(0, YEAR_AXIS_LATEST - year));
  const u = 1 - Math.log1p(beforeLatest) / LOG_SPAN;
  return Math.round(clamp01(u) * YEAR_SLIDER_STEPS);
}

/** Keep a typed year on the axis. */
export function clampYear(year: number): number {
  if (!Number.isFinite(year)) return YEAR_SLIDER_DEFAULT;
  return Math.round(Math.min(YEAR_AXIS_LATEST, Math.max(YEAR_AXIS_OLDEST, year)));
}

/** The year the slider opens on. Constant, and independent of every answer. */
export const YEAR_SLIDER_DEFAULT_YEAR = yearFromSlider(YEAR_SLIDER_DEFAULT);
