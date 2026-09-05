/**
 * Reaction scenes.
 *
 * After you lock in, a short micro-scene plays out whose *outcome* mirrors how
 * accurate you were — and, crucially, in which direction you were wrong. Guess
 * too high and the projectile sails past the target; guess too low and it
 * falls short. You start to know how you did before a single digit appears.
 *
 * One engine drives the physics and timing; themes supply the paint, so
 * adding a new scene is a data change rather than another animation loop.
 */

import { THEMES, type Theme, type ThemeId } from './themes.js';
import { createRng, type Rng } from '@trivia/shared';

export const SCENE_DURATION_MS = 1750;

export interface Palette {
  ink: string;
  sky: string;
  ground: string;
  line: string;
  target: string;
  actor: string;
  accent: string;
  good: string;
  bad: string;
}

export const PALETTE: Palette = {
  ink: '#06070d',
  sky: '#0f1119',
  ground: '#1c2030',
  line: '#343a50',
  target: '#ffd84d',
  actor: '#f4f6ff',
  accent: '#4de1ff',
  good: '#5be49b',
  bad: '#ff5d8f',
};

export type MissDirection = 'high' | 'low' | 'exact';

export interface SceneInput {
  /** 0..1 from the scoring system. */
  accuracy: number;
  /** Which way the guess was wrong. Drives overshoot vs undershoot. */
  direction: MissDirection;
  /** Anything stable per round, so a replay looks the same. */
  seed: string;
  theme: ThemeId;
}

export interface Frame {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  /** 0..1 across the whole scene. */
  t: number;
  /** 0..1 across the flight portion only. */
  flight: number;
  x: number;
  y: number;
  /** Radians, pointing along the direction of travel. */
  angle: number;
  /** Total rotation for things that tumble. */
  spin: number;
  landed: boolean;
  /** 0..1 after impact, for shockwaves and debris. */
  impact: number;
  target: { x: number; y: number };
  landing: { x: number; y: number };
  /** The actual trajectory, so trails and ghosts stay in sync with the actor. */
  path: (flight: number) => { x: number; y: number };
  accuracy: number;
  direction: MissDirection;
  palette: Palette;
  rng: Rng;
  /** Deterministic per-scene noise in 0..1, stable across frames. */
  noise: number[];
}

const WIND_UP = 0.1;
const FLIGHT = 0.62;

/** How far a total miss can land from the target, as a fraction of width. */
const MAX_SPREAD = 0.42;

export function pickTheme(seed: string): ThemeId {
  const ids = Object.keys(THEMES) as ThemeId[];
  const rng = createRng(`theme:${seed}`);
  return ids[Math.floor(rng() * ids.length)] ?? 'archery';
}

/**
 * Start a scene on a canvas. Returns a stop function; call it on unmount.
 * The canvas is sized from its CSS box and re-read on resize.
 */
export function runScene(
  canvas: HTMLCanvasElement,
  input: SceneInput,
  options: { onDone?: () => void; speed?: number } = {},
): () => void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};

  const theme: Theme = THEMES[input.theme] ?? THEMES.archery;
  const rng = createRng(input.seed);
  const noise = Array.from({ length: 24 }, () => rng());
  const speed = options.speed ?? 1;

  let width = 0;
  let height = 0;
  let raf = 0;
  let stopped = false;
  /**
   * The last frame we painted. Setting canvas.width wipes the bitmap, so a
   * resize after the loop has finished (the reveal below us growing, say)
   * would otherwise leave an empty box behind.
   */
  let lastT = 0;
  const startedAt = performance.now();

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const nextWidth = Math.max(1, Math.round(rect.width));
    const nextHeight = Math.max(1, Math.round(rect.height));
    if (nextWidth === width && nextHeight === height && canvas.width > 0) return;
    width = nextWidth;
    height = nextHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render(lastT);
  };

  const render = (t: number) => {
    if (width === 0 || height === 0) return;

    const start = theme.start(width, height);
    const target = theme.target(width, height);

    // Where it actually ends up: offset from the target along the travel axis.
    const shortfall = Math.pow(1 - clamp01(input.accuracy), 1.25) * MAX_SPREAD * width;
    const sign = input.direction === 'high' ? 1 : input.direction === 'low' ? -1 : 0;
    // A dead-centre hit still gets a hair of wobble so it never looks canned.
    const jitter = (noise[0] - 0.5) * 6 * (1 - clamp01(input.accuracy));
    const landing =
      theme.axis === 'vertical'
        ? { x: target.x + jitter, y: target.y - sign * shortfall * 0.5 }
        : { x: target.x + sign * shortfall + jitter, y: target.y };

    const flightRaw = clamp01((t - WIND_UP) / FLIGHT);
    const flight = theme.mode === 'roll' ? easeOutCubic(flightRaw) : flightRaw;
    const landed = flightRaw >= 1;
    const impact = clamp01((t - (WIND_UP + FLIGHT)) / (1 - WIND_UP - FLIGHT));

    const arcHeight = theme.arc * height;

    // One definition of the path, shared by the actor, its trail and its ghosts.
    const path = (at: number): { x: number; y: number } => {
      const px = start.x + (landing.x - start.x) * at;
      const lift = theme.mode === 'roll' ? 0 : Math.sin(Math.PI * at) * arcHeight;
      const wobble =
        theme.mode === 'glide' ? Math.sin(at * Math.PI * 3 + noise[1] * 6) * height * 0.05 : 0;
      return { x: px, y: start.y + (landing.y - start.y) * at - lift + wobble };
    };

    const { x, y } = path(flight);

    // Angle from a short finite difference, so it always points where it goes.
    const previous = path(Math.max(0, flight - 0.02));
    const travelAngle = Math.atan2(y - previous.y, x - previous.x);
    const angle = landed && theme.restAngle !== undefined ? theme.restAngle : travelAngle;

    const frame: Frame = {
      ctx,
      w: width,
      h: height,
      t,
      flight,
      x,
      y,
      angle,
      spin: flightRaw * Math.PI * 2 * (theme.spin ?? 0),
      landed,
      impact,
      target,
      landing,
      path,
      accuracy: clamp01(input.accuracy),
      direction: input.direction,
      palette: PALETTE,
      rng,
      noise,
    };

    ctx.clearRect(0, 0, width, height);
    theme.drawScene(frame);
    if (landed && theme.drawImpact) theme.drawImpact(frame);
    theme.drawActor(frame);
  };

  const draw = (now: number) => {
    if (stopped) return;
    const elapsed = (now - startedAt) * speed;
    const t = Math.min(1, elapsed / SCENE_DURATION_MS);
    lastT = t;
    render(t);

    if (t < 1) {
      raf = requestAnimationFrame(draw);
    } else {
      options.onDone?.();
    }
  };

  resize();
  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  observer?.observe(canvas);

  raf = requestAnimationFrame(draw);

  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    observer?.disconnect();
  };
}

/* --- shared drawing helpers, used by every theme --------------------- */

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${clamp01(alpha)})`;
}

/** The horizon every ground-based theme shares. */
export function drawGround(frame: Frame, yFraction = 0.78): number {
  const { ctx, w, h, palette } = frame;
  const groundY = h * yFraction;
  const gradient = ctx.createLinearGradient(0, groundY, 0, h);
  gradient.addColorStop(0, withAlpha(palette.ground, 0.95));
  gradient.addColorStop(1, withAlpha(palette.ink, 0.9));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, groundY, w, h - groundY);

  ctx.strokeStyle = withAlpha(palette.line, 0.8);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, groundY + 0.5);
  ctx.lineTo(w, groundY + 0.5);
  ctx.stroke();
  return groundY;
}

/** A fading trail behind the actor, following the real trajectory. */
export function drawTrail(frame: Frame, color: string, thickness = 2): void {
  const { ctx, flight, path, palette } = frame;
  if (flight <= 0.02) return;
  const steps = 14;
  ctx.lineCap = 'round';
  for (let i = 1; i <= steps; i++) {
    const back = flight - (i / steps) * 0.22;
    if (back <= 0) break;
    const point = path(back);
    const next = path(Math.max(0, back - 0.02));
    ctx.strokeStyle = withAlpha(color || palette.actor, (1 - i / steps) * 0.5);
    ctx.lineWidth = thickness * (1 - i / steps) + 0.4;
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
    ctx.lineTo(next.x, next.y);
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
}

/** Impact burst: a ring plus a few sparks, scaled by how good the result was. */
export function drawBurst(frame: Frame, color: string, strength = 1): void {
  const { ctx, landing, impact, noise } = frame;
  if (impact <= 0) return;
  const eased = easeOutCubic(impact);

  ctx.strokeStyle = withAlpha(color, (1 - eased) * 0.85 * strength);
  ctx.lineWidth = 2 * (1 - eased) + 0.5;
  ctx.beginPath();
  ctx.arc(landing.x, landing.y, 6 + eased * 34 * strength, 0, Math.PI * 2);
  ctx.stroke();

  const sparks = Math.round(5 + strength * 7);
  for (let i = 0; i < sparks; i++) {
    const angle = noise[(i % noise.length)] * Math.PI * 2 + i;
    const distance = eased * (14 + noise[(i + 3) % noise.length] * 40) * strength;
    const size = (1 - eased) * 2.4 * strength;
    if (size <= 0) continue;
    ctx.fillStyle = withAlpha(color, (1 - eased) * 0.9);
    ctx.beginPath();
    ctx.arc(
      landing.x + Math.cos(angle) * distance,
      landing.y + Math.sin(angle) * distance * 0.7,
      Math.max(0.2, size),
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
}

/** Concentric rings, reused by several targets. */
export function drawRings(
  frame: Frame,
  cx: number,
  cy: number,
  radius: number,
  colors: string[],
): void {
  const { ctx } = frame;
  const bands = colors.length;
  for (let i = 0; i < bands; i++) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius * (1 - i / bands), 0, Math.PI * 2);
    ctx.fillStyle = colors[i];
    ctx.fill();
  }
}
