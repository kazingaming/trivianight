/**
 * Scene themes.
 *
 * Each one is a different way of missing a target. They share the engine's
 * physics and only supply paint, so the library grows by adding an entry here.
 */

import {
  clamp01,
  drawBurst,
  drawGround,
  drawRings,
  drawTrail,
  withAlpha,
  type Frame,
} from './engine.js';

export type ThemeId =
  | 'archery'
  | 'hoops'
  | 'darts'
  | 'landing'
  | 'curling'
  | 'putt'
  | 'paperplane';

export interface Theme {
  id: ThemeId;
  label: string;
  mode: 'arc' | 'roll' | 'glide';
  /** Vertical themes spread the miss up and down instead of left and right. */
  axis: 'horizontal' | 'vertical';
  /** Peak height of the arc, as a fraction of canvas height. */
  arc: number;
  /** Full rotations during flight, for things that tumble. */
  spin?: number;
  /** Angle to settle at once it lands. Undefined keeps the travel angle. */
  restAngle?: number;
  start: (w: number, h: number) => { x: number; y: number };
  target: (w: number, h: number) => { x: number; y: number };
  drawScene: (frame: Frame) => void;
  drawActor: (frame: Frame) => void;
  drawImpact?: (frame: Frame) => void;
}

/** Good result colour vs bad result colour, chosen by accuracy. */
function verdictColor(frame: Frame): string {
  const { palette, accuracy } = frame;
  if (accuracy >= 0.9) return palette.target;
  if (accuracy >= 0.45) return palette.good;
  return palette.bad;
}

function burstStrength(frame: Frame): number {
  return 0.5 + frame.accuracy * 1.1;
}

/* --------------------------------------------------------------------- */

const archery: Theme = {
  id: 'archery',
  label: 'Archery',
  mode: 'arc',
  axis: 'horizontal',
  arc: 0.3,
  start: (w, h) => ({ x: w * 0.08, y: h * 0.62 }),
  target: (w, h) => ({ x: w * 0.76, y: h * 0.5 }),
  drawScene: (frame) => {
    const { ctx, palette, target } = frame;
    const groundY = drawGround(frame, 0.82);

    // Stand
    ctx.strokeStyle = withAlpha(palette.line, 0.9);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(target.x, target.y);
    ctx.lineTo(target.x, groundY);
    ctx.stroke();

    const radius = Math.min(frame.h * 0.19, 46);
    drawRings(frame, target.x, target.y, radius, [
      withAlpha(palette.actor, 0.92),
      withAlpha(palette.ink, 0.9),
      withAlpha(palette.actor, 0.85),
      withAlpha(palette.bad, 0.9),
      withAlpha(palette.target, 0.95),
    ]);

    // Bow, drawn during the wind-up then released
    const pull = frame.t < 0.1 ? 1 - frame.t / 0.1 : 0;
    const bx = frame.w * 0.09;
    const by = frame.h * 0.62;
    ctx.strokeStyle = withAlpha(palette.accent, 0.75);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(bx, by, 22, -Math.PI * 0.62, Math.PI * 0.62);
    ctx.stroke();
    ctx.strokeStyle = withAlpha(palette.actor, 0.5);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bx + Math.cos(-Math.PI * 0.62) * 22, by + Math.sin(-Math.PI * 0.62) * 22);
    ctx.lineTo(bx - 9 * pull, by);
    ctx.lineTo(bx + Math.cos(Math.PI * 0.62) * 22, by + Math.sin(Math.PI * 0.62) * 22);
    ctx.stroke();
  },
  drawActor: (frame) => {
    const { ctx, x, y, angle, palette } = frame;
    if (frame.t < 0.1) return;
    drawTrail(frame, palette.accent, 1.8);

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.strokeStyle = palette.actor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-16, 0);
    ctx.lineTo(8, 0);
    ctx.stroke();
    // Head
    ctx.fillStyle = verdictColor(frame);
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(6, -3.5);
    ctx.lineTo(6, 3.5);
    ctx.closePath();
    ctx.fill();
    // Fletching
    ctx.strokeStyle = withAlpha(palette.accent, 0.9);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-16, 0);
    ctx.lineTo(-11, -4);
    ctx.moveTo(-16, 0);
    ctx.lineTo(-11, 4);
    ctx.stroke();
    ctx.restore();
  },
  drawImpact: (frame) => drawBurst(frame, verdictColor(frame), burstStrength(frame)),
};

/* --------------------------------------------------------------------- */

const hoops: Theme = {
  id: 'hoops',
  label: 'Free throw',
  mode: 'arc',
  axis: 'horizontal',
  arc: 0.46,
  spin: 1.5,
  start: (w, h) => ({ x: w * 0.1, y: h * 0.7 }),
  target: (w, h) => ({ x: w * 0.78, y: h * 0.44 }),
  drawScene: (frame) => {
    const { ctx, palette, target, h } = frame;
    drawGround(frame, 0.88);

    // Backboard
    ctx.fillStyle = withAlpha(palette.line, 0.55);
    ctx.fillRect(target.x + 34, target.y - h * 0.24, 5, h * 0.3);
    ctx.strokeStyle = withAlpha(palette.actor, 0.45);
    ctx.lineWidth = 2;
    ctx.strokeRect(target.x + 8, target.y - h * 0.15, 30, h * 0.13);

    // Rim, drawn as an ellipse so it reads as a hoop in perspective
    ctx.strokeStyle = palette.target;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.ellipse(target.x, target.y, 26, 7, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Net
    ctx.strokeStyle = withAlpha(palette.actor, 0.3);
    ctx.lineWidth = 1;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(target.x + Math.cos(a) * 26, target.y + Math.sin(a) * 7);
      ctx.lineTo(target.x + Math.cos(a) * 12, target.y + 26);
      ctx.stroke();
    }
  },
  drawActor: (frame) => {
    const { ctx, x, y, spin, palette } = frame;
    drawTrail(frame, withAlpha('#ff9a4d', 0.8), 2.4);
    const r = 11;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(spin);
    const gradient = ctx.createRadialGradient(-r * 0.3, -r * 0.3, 1, 0, 0, r);
    gradient.addColorStop(0, '#ffb367');
    gradient.addColorStop(1, '#d1652a');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = withAlpha(palette.ink, 0.65);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-r, 0);
    ctx.lineTo(r, 0);
    ctx.moveTo(0, -r);
    ctx.lineTo(0, r);
    ctx.stroke();
    ctx.restore();
  },
  drawImpact: (frame) => drawBurst(frame, verdictColor(frame), burstStrength(frame)),
};

/* --------------------------------------------------------------------- */

const darts: Theme = {
  id: 'darts',
  label: 'Darts',
  mode: 'arc',
  axis: 'horizontal',
  arc: 0.12,
  start: (w, h) => ({ x: w * 0.06, y: h * 0.56 }),
  target: (w, h) => ({ x: w * 0.74, y: h * 0.48 }),
  drawScene: (frame) => {
    const { ctx, palette, target } = frame;
    const radius = Math.min(frame.h * 0.22, 54);

    ctx.fillStyle = withAlpha(palette.ink, 0.85);
    ctx.beginPath();
    ctx.arc(target.x, target.y, radius + 6, 0, Math.PI * 2);
    ctx.fill();

    // Alternating wedges
    for (let i = 0; i < 20; i++) {
      const a0 = (i / 20) * Math.PI * 2;
      const a1 = ((i + 1) / 20) * Math.PI * 2;
      ctx.fillStyle = i % 2 === 0 ? withAlpha(palette.actor, 0.14) : withAlpha(palette.ink, 0.9);
      ctx.beginPath();
      ctx.moveTo(target.x, target.y);
      ctx.arc(target.x, target.y, radius, a0, a1);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = withAlpha(palette.bad, 0.8);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(target.x, target.y, radius * 0.62, 0, Math.PI * 2);
    ctx.stroke();

    drawRings(frame, target.x, target.y, radius * 0.2, [
      withAlpha(palette.good, 0.95),
      palette.bad,
    ]);
  },
  drawActor: (frame) => {
    const { ctx, x, y, angle, palette } = frame;
    drawTrail(frame, palette.accent, 1.4);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.strokeStyle = palette.actor;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(-14, 0);
    ctx.lineTo(10, 0);
    ctx.stroke();
    ctx.fillStyle = verdictColor(frame);
    ctx.beginPath();
    ctx.moveTo(15, 0);
    ctx.lineTo(8, -3);
    ctx.lineTo(8, 3);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = withAlpha(palette.accent, 0.9);
    ctx.beginPath();
    ctx.moveTo(-14, 0);
    ctx.lineTo(-7, -5);
    ctx.lineTo(-4, 0);
    ctx.lineTo(-7, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  },
  drawImpact: (frame) => drawBurst(frame, verdictColor(frame), burstStrength(frame) * 0.8),
};

/* --------------------------------------------------------------------- */

const landing: Theme = {
  id: 'landing',
  label: 'Booster landing',
  mode: 'arc',
  axis: 'horizontal',
  arc: 0.08,
  restAngle: -Math.PI / 2,
  start: (w, h) => ({ x: w * 0.12, y: h * 0.08 }),
  target: (w, h) => ({ x: w * 0.7, y: h * 0.74 }),
  drawScene: (frame) => {
    const { ctx, palette, target } = frame;
    drawGround(frame, 0.78);

    // Landing pad
    ctx.fillStyle = withAlpha(palette.line, 0.9);
    ctx.beginPath();
    ctx.ellipse(target.x, target.y + 4, 54, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = withAlpha(palette.target, 0.85);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(target.x, target.y + 4, 40, 9, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(target.x, target.y + 4, 14, 3.5, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Stars
    for (let i = 0; i < 14; i++) {
      const n = frame.noise[i % frame.noise.length];
      ctx.fillStyle = withAlpha(palette.actor, 0.14 + n * 0.2);
      ctx.beginPath();
      ctx.arc(frame.w * n, frame.h * 0.1 + frame.noise[(i + 5) % frame.noise.length] * frame.h * 0.4, 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  drawActor: (frame) => {
    const { ctx, x, y, angle, palette, landed } = frame;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(landed ? -Math.PI / 2 : angle);

    // Exhaust, only while descending
    if (!landed) {
      const flare = 16 + Math.sin(frame.t * 60) * 6;
      const gradient = ctx.createLinearGradient(-8, 0, -8 - flare, 0);
      gradient.addColorStop(0, withAlpha(palette.target, 0.9));
      gradient.addColorStop(1, withAlpha(palette.bad, 0));
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(-8, -4);
      ctx.lineTo(-8 - flare, 0);
      ctx.lineTo(-8, 4);
      ctx.closePath();
      ctx.fill();
    }

    ctx.fillStyle = palette.actor;
    ctx.fillRect(-8, -5, 22, 10);
    ctx.fillStyle = verdictColor(frame);
    ctx.beginPath();
    ctx.moveTo(14, -5);
    ctx.lineTo(22, 0);
    ctx.lineTo(14, 5);
    ctx.closePath();
    ctx.fill();
    // Fins
    ctx.fillStyle = withAlpha(palette.accent, 0.85);
    ctx.beginPath();
    ctx.moveTo(-8, -5);
    ctx.lineTo(-14, -9);
    ctx.lineTo(-8, -1);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-8, 5);
    ctx.lineTo(-14, 9);
    ctx.lineTo(-8, 1);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  },
  drawImpact: (frame) => {
    const { ctx, landing: point, impact, palette, accuracy } = frame;
    // A good landing puffs dust; a bad one goes up in a fireball.
    const color = accuracy >= 0.6 ? palette.line : palette.bad;
    drawBurst(frame, color, accuracy >= 0.6 ? 0.7 : 1.6);
    if (accuracy < 0.3) {
      ctx.fillStyle = withAlpha(palette.bad, (1 - impact) * 0.4);
      ctx.beginPath();
      ctx.arc(point.x, point.y, 10 + impact * 46, 0, Math.PI * 2);
      ctx.fill();
    }
  },
};

/* --------------------------------------------------------------------- */

const curling: Theme = {
  id: 'curling',
  label: 'Curling',
  mode: 'roll',
  axis: 'horizontal',
  arc: 0,
  spin: 0.8,
  start: (w, h) => ({ x: w * 0.06, y: h * 0.62 }),
  target: (w, h) => ({ x: w * 0.74, y: h * 0.62 }),
  drawScene: (frame) => {
    const { ctx, palette, target, w, h } = frame;

    // Sheet
    const ice = ctx.createLinearGradient(0, h * 0.35, 0, h);
    ice.addColorStop(0, withAlpha(palette.accent, 0.09));
    ice.addColorStop(1, withAlpha(palette.ink, 0.85));
    ctx.fillStyle = ice;
    ctx.fillRect(0, h * 0.35, w, h * 0.65);

    // House
    drawRings(frame, target.x, target.y, Math.min(h * 0.26, 60), [
      withAlpha(palette.accent, 0.28),
      withAlpha(palette.ink, 0.85),
      withAlpha(palette.bad, 0.55),
      withAlpha(palette.target, 0.9),
    ]);

    ctx.strokeStyle = withAlpha(palette.actor, 0.18);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, target.y);
    ctx.lineTo(w, target.y);
    ctx.stroke();
  },
  drawActor: (frame) => {
    const { ctx, x, y, spin, palette } = frame;
    ctx.save();
    ctx.translate(x, y);
    // Shadow on the ice
    ctx.fillStyle = withAlpha(palette.ink, 0.5);
    ctx.beginPath();
    ctx.ellipse(0, 5, 15, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.rotate(spin);
    const gradient = ctx.createRadialGradient(-4, -4, 2, 0, 0, 14);
    gradient.addColorStop(0, '#6e768f');
    gradient.addColorStop(1, '#2b3145');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = withAlpha(palette.actor, 0.35);
    ctx.lineWidth = 1;
    ctx.stroke();
    // Handle
    ctx.strokeStyle = verdictColor(frame);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, -2, 6, Math.PI, 0);
    ctx.stroke();
    ctx.restore();
  },
  drawImpact: (frame) => drawBurst(frame, verdictColor(frame), burstStrength(frame) * 0.6),
};

/* --------------------------------------------------------------------- */

const putt: Theme = {
  id: 'putt',
  label: 'Putting green',
  mode: 'roll',
  axis: 'horizontal',
  arc: 0,
  spin: 2,
  start: (w, h) => ({ x: w * 0.08, y: h * 0.68 }),
  target: (w, h) => ({ x: w * 0.76, y: h * 0.68 }),
  drawScene: (frame) => {
    const { ctx, palette, target, w, h } = frame;
    const green = ctx.createLinearGradient(0, h * 0.42, 0, h);
    green.addColorStop(0, withAlpha(palette.good, 0.16));
    green.addColorStop(1, withAlpha(palette.ink, 0.9));
    ctx.fillStyle = green;
    ctx.fillRect(0, h * 0.42, w, h * 0.58);

    // Hole
    ctx.fillStyle = palette.ink;
    ctx.beginPath();
    ctx.ellipse(target.x, target.y, 13, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = withAlpha(palette.actor, 0.35);
    ctx.lineWidth = 1;
    ctx.stroke();

    // Flag
    ctx.strokeStyle = withAlpha(palette.actor, 0.75);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(target.x, target.y - 3);
    ctx.lineTo(target.x, target.y - h * 0.3);
    ctx.stroke();
    ctx.fillStyle = palette.target;
    ctx.beginPath();
    ctx.moveTo(target.x, target.y - h * 0.3);
    ctx.lineTo(target.x + 26, target.y - h * 0.26);
    ctx.lineTo(target.x, target.y - h * 0.22);
    ctx.closePath();
    ctx.fill();
  },
  drawActor: (frame) => {
    const { ctx, x, y, palette, accuracy, landed } = frame;
    // A holed putt drops out of sight.
    const sunk = landed && accuracy >= 0.92;
    const drop = sunk ? Math.min(10, frame.impact * 22) : 0;
    ctx.fillStyle = withAlpha(palette.ink, 0.45);
    ctx.beginPath();
    ctx.ellipse(x, y + 6, 8, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    if (drop >= 9) return;

    const gradient = ctx.createRadialGradient(x - 3, y - 3 + drop, 1, x, y + drop, 9);
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(1, '#b9c0d6');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y + drop, 8 - drop * 0.4, 0, Math.PI * 2);
    ctx.fill();
  },
  drawImpact: (frame) =>
    drawBurst(frame, verdictColor(frame), frame.accuracy >= 0.92 ? 1.4 : 0.45),
};

/* --------------------------------------------------------------------- */

const paperplane: Theme = {
  id: 'paperplane',
  label: 'Paper plane',
  mode: 'glide',
  axis: 'horizontal',
  arc: 0.2,
  start: (w, h) => ({ x: w * 0.06, y: h * 0.3 }),
  target: (w, h) => ({ x: w * 0.76, y: h * 0.7 }),
  drawScene: (frame) => {
    const { ctx, palette, target } = frame;
    drawGround(frame, 0.84);

    // Wastebasket
    const top = target.y - 6;
    const bottom = target.y + 34;
    ctx.strokeStyle = withAlpha(palette.line, 1);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(target.x - 24, top);
    ctx.lineTo(target.x - 18, bottom);
    ctx.lineTo(target.x + 18, bottom);
    ctx.lineTo(target.x + 24, top);
    ctx.stroke();
    ctx.strokeStyle = withAlpha(palette.target, 0.85);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(target.x, top, 24, 6, 0, 0, Math.PI * 2);
    ctx.stroke();
  },
  drawActor: (frame) => {
    const { ctx, x, y, angle, palette } = frame;
    drawTrail(frame, withAlpha(palette.accent, 0.6), 1.2);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle * 0.7);
    ctx.fillStyle = palette.actor;
    ctx.beginPath();
    ctx.moveTo(15, 0);
    ctx.lineTo(-11, -8);
    ctx.lineTo(-5, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = withAlpha(palette.actor, 0.62);
    ctx.beginPath();
    ctx.moveTo(15, 0);
    ctx.lineTo(-11, 8);
    ctx.lineTo(-5, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = withAlpha(verdictColor(frame), 0.9);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(15, 0);
    ctx.lineTo(-5, 0);
    ctx.stroke();
    ctx.restore();
  },
  drawImpact: (frame) => drawBurst(frame, verdictColor(frame), burstStrength(frame) * 0.7),
};

export const THEMES: Record<ThemeId, Theme> = {
  archery,
  hoops,
  darts,
  landing,
  curling,
  putt,
  paperplane,
};

/** Copy shown beneath a scene when animations are switched off. */
export function staticVerdict(accuracy: number): string {
  const value = clamp01(accuracy);
  if (value >= 0.995) return 'Dead centre';
  if (value >= 0.9) return 'Just off the middle';
  if (value >= 0.72) return 'On the target';
  if (value >= 0.3) return 'Clipped the edge';
  if (value >= 0.1) return 'Missed the target';
  return 'Missed everything';
}
