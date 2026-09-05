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
  easeOutCubic,
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
  | 'paperplane'
  | 'cannon'
  | 'bowling'
  | 'ringtoss'
  | 'discgolf'
  | 'parachute'
  | 'javelin'
  | 'penalty'
  | 'skipstone'
  | 'balloon';

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
  /**
   * Scales how far a miss travels, 1 by default. Scenes with a short axis —
   * anything vertical in a 16:7 box — turn this down so a bad guess still
   * lands somewhere visible.
   */
  spread?: number;
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

/* --------------------------------------------------------------------- */

const cannon: Theme = {
  id: 'cannon',
  label: 'Cannon',
  mode: 'arc',
  axis: 'horizontal',
  arc: 0.44,
  start: (w, h) => ({ x: w * 0.09, y: h * 0.7 }),
  target: (w, h) => ({ x: w * 0.78, y: h * 0.66 }),
  drawScene: (frame) => {
    const { ctx, palette, target, h } = frame;
    const groundY = drawGround(frame, 0.8);

    // A squat fort, because a wall you can miss reads better than a dot.
    const wallTop = target.y - h * 0.12;
    ctx.fillStyle = withAlpha(palette.ground, 0.95);
    ctx.fillRect(target.x - 40, wallTop, 80, groundY - wallTop);
    ctx.strokeStyle = withAlpha(palette.line, 1);
    ctx.lineWidth = 2;
    ctx.strokeRect(target.x - 40, wallTop, 80, groundY - wallTop);
    for (let i = 0; i < 4; i++) {
      ctx.fillRect(target.x - 40 + i * 22, wallTop - 8, 12, 8);
    }
    // The bullseye is the gate.
    drawRings(frame, target.x, target.y, 14, [withAlpha(palette.ink, 0.9), palette.target]);

    // Barrel, kicking back on the shot.
    const recoil = frame.t < 0.1 ? (1 - frame.t / 0.1) * 7 : 0;
    ctx.save();
    ctx.translate(frame.w * 0.08 - recoil, frame.h * 0.72 + recoil * 0.4);
    ctx.rotate(-Math.PI / 5);
    ctx.fillStyle = withAlpha(palette.actor, 0.8);
    ctx.fillRect(0, -6, 34, 12);
    ctx.restore();
    ctx.fillStyle = withAlpha(palette.line, 1);
    ctx.beginPath();
    ctx.arc(frame.w * 0.08, frame.h * 0.76, 9, 0, Math.PI * 2);
    ctx.fill();
  },
  drawActor: (frame) => {
    const { ctx, x, y, palette, flight, noise } = frame;
    if (frame.t < 0.06) return;

    // Smoke, thinning as it falls behind.
    for (let i = 1; i <= 7; i++) {
      const back = flight - i * 0.035;
      if (back <= 0) break;
      const point = frame.path(back);
      const drift = noise[i % noise.length] * 4 - 2;
      ctx.fillStyle = withAlpha(palette.line, (1 - i / 7) * 0.4);
      ctx.beginPath();
      ctx.arc(point.x + drift, point.y - i * 1.6, 2 + i * 1.4, 0, Math.PI * 2);
      ctx.fill();
    }

    const gradient = ctx.createRadialGradient(x - 3, y - 3, 1, x, y, 10);
    gradient.addColorStop(0, '#6a7186');
    gradient.addColorStop(1, '#14161f');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = withAlpha(verdictColor(frame), 0.7);
    ctx.lineWidth = 1.2;
    ctx.stroke();
  },
  drawImpact: (frame) => drawBurst(frame, verdictColor(frame), burstStrength(frame) * 1.3),
};

/* --------------------------------------------------------------------- */

const bowling: Theme = {
  id: 'bowling',
  label: 'Bowling',
  mode: 'roll',
  axis: 'horizontal',
  arc: 0,
  spin: 1.1,
  spread: 0.7,
  start: (w, h) => ({ x: w * 0.06, y: h * 0.64 }),
  target: (w, h) => ({ x: w * 0.8, y: h * 0.6 }),
  drawScene: (frame) => {
    const { ctx, palette, target, w, h, accuracy, impact, landed } = frame;

    const lane = ctx.createLinearGradient(0, h * 0.34, 0, h);
    lane.addColorStop(0, withAlpha(palette.target, 0.045));
    lane.addColorStop(1, withAlpha(palette.ink, 0.9));
    ctx.fillStyle = lane;
    ctx.fillRect(0, h * 0.34, w, h * 0.66);

    // Gutters.
    ctx.strokeStyle = withAlpha(palette.line, 0.8);
    ctx.lineWidth = 2;
    for (const y of [h * 0.36, h * 0.9]) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Ten pins, in the usual triangle. They fall in proportion to the result.
    const knocked = landed ? clamp01(accuracy * 1.15) : 0;
    const fall = landed ? easeOutCubic(impact) : 0;
    let index = 0;
    for (let row = 0; row < 4; row++) {
      for (let seat = 0; seat <= row; seat++) {
        const px = target.x + row * 13;
        const py = target.y + (seat - row / 2) * 15;
        const down = index / 10 < knocked;
        index++;
        ctx.save();
        ctx.translate(px, py);
        if (down) ctx.rotate(fall * (Math.PI / 2.2) * (seat % 2 ? 1 : -1));
        ctx.fillStyle = down ? withAlpha(palette.actor, 0.45) : palette.actor;
        ctx.beginPath();
        ctx.ellipse(0, 0, 4, 9, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = withAlpha(palette.bad, down ? 0.4 : 0.9);
        ctx.fillRect(-4, -4, 8, 2);
        ctx.restore();
      }
    }
  },
  drawActor: (frame) => {
    const { ctx, x, y, spin, palette } = frame;
    ctx.fillStyle = withAlpha(palette.ink, 0.55);
    ctx.beginPath();
    ctx.ellipse(x, y + 9, 13, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(spin);
    const gradient = ctx.createRadialGradient(-4, -5, 1, 0, 0, 13);
    gradient.addColorStop(0, '#5b6ad6');
    gradient.addColorStop(1, '#161a2e');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = withAlpha(palette.ink, 0.85);
    for (const [hx, hy] of [
      [-3, -4],
      [2, -5],
      [0, 1],
    ]) {
      ctx.beginPath();
      ctx.arc(hx, hy, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  },
  drawImpact: (frame) => drawBurst(frame, verdictColor(frame), burstStrength(frame) * 0.7),
};

/* --------------------------------------------------------------------- */

const ringtoss: Theme = {
  id: 'ringtoss',
  label: 'Ring toss',
  mode: 'arc',
  axis: 'horizontal',
  arc: 0.42,
  spin: 2.5,
  start: (w, h) => ({ x: w * 0.1, y: h * 0.72 }),
  target: (w, h) => ({ x: w * 0.76, y: h * 0.7 }),
  drawScene: (frame) => {
    const { ctx, palette, target, h } = frame;
    drawGround(frame, 0.84);

    // Base, then the peg.
    ctx.fillStyle = withAlpha(palette.line, 0.9);
    ctx.beginPath();
    ctx.ellipse(target.x, target.y + 6, 30, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = withAlpha(palette.target, 0.6);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(target.x, target.y + 6, 18, 5, 0, 0, Math.PI * 2);
    ctx.stroke();

    const pegTop = target.y - h * 0.26;
    ctx.strokeStyle = palette.actor;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(target.x, target.y + 4);
    ctx.lineTo(target.x, pegTop);
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.fillStyle = palette.target;
    ctx.beginPath();
    ctx.arc(target.x, pegTop, 4.5, 0, Math.PI * 2);
    ctx.fill();
  },
  drawActor: (frame) => {
    const { ctx, x, y, spin, palette, landed, accuracy } = frame;
    // A ringer settles flat around the peg; a miss lands on its edge.
    const settled = landed && accuracy >= 0.88;
    const tilt = settled ? Math.PI / 2 : spin;
    ctx.save();
    ctx.translate(x, y + (settled ? 6 : 0));
    ctx.rotate(landed ? (settled ? 0 : spin) : 0);
    ctx.strokeStyle = verdictColor(frame);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(0, 0, 15, settled ? 5 : Math.abs(Math.cos(tilt)) * 13 + 2, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = withAlpha(palette.actor, 0.35);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  },
  drawImpact: (frame) =>
    drawBurst(frame, verdictColor(frame), frame.accuracy >= 0.88 ? 1.5 : 0.4),
};

/* --------------------------------------------------------------------- */

const discgolf: Theme = {
  id: 'discgolf',
  label: 'Disc golf',
  mode: 'glide',
  axis: 'horizontal',
  arc: 0.24,
  start: (w, h) => ({ x: w * 0.06, y: h * 0.4 }),
  target: (w, h) => ({ x: w * 0.78, y: h * 0.56 }),
  drawScene: (frame) => {
    const { ctx, palette, target, h } = frame;
    drawGround(frame, 0.86);

    // Pole.
    ctx.strokeStyle = withAlpha(palette.actor, 0.75);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(target.x, target.y - h * 0.18);
    ctx.lineTo(target.x, h * 0.86);
    ctx.stroke();

    // Chains.
    ctx.strokeStyle = withAlpha(palette.line, 0.95);
    ctx.lineWidth = 1;
    for (let i = -4; i <= 4; i++) {
      ctx.beginPath();
      ctx.moveTo(target.x + i * 3.6, target.y - h * 0.16);
      ctx.lineTo(target.x + i * 4.6, target.y + 16);
      ctx.stroke();
    }

    // Basket.
    ctx.strokeStyle = palette.target;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(target.x, target.y + 16, 22, 6, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(target.x - 22, target.y + 16);
    ctx.lineTo(target.x - 17, target.y + 32);
    ctx.lineTo(target.x + 17, target.y + 32);
    ctx.lineTo(target.x + 22, target.y + 16);
    ctx.stroke();
  },
  drawActor: (frame) => {
    const { ctx, x, y, angle, palette } = frame;
    drawTrail(frame, withAlpha(palette.good, 0.55), 1.4);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle * 0.35);
    ctx.fillStyle = verdictColor(frame);
    ctx.beginPath();
    ctx.ellipse(0, 0, 14, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = withAlpha(palette.ink, 0.7);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(0, -1.5, 10, 2.2, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  },
  drawImpact: (frame) => drawBurst(frame, verdictColor(frame), burstStrength(frame) * 0.9),
};

/* --------------------------------------------------------------------- */

const parachute: Theme = {
  id: 'parachute',
  label: 'Drop zone',
  mode: 'glide',
  axis: 'horizontal',
  arc: 0.04,
  spread: 0.8,
  start: (w, h) => ({ x: w * 0.2, y: h * 0.02 }),
  target: (w, h) => ({ x: w * 0.64, y: h * 0.78 }),
  drawScene: (frame) => {
    const { ctx, palette, target, noise, w, h } = frame;
    drawGround(frame, 0.82);

    // Clouds, from stable noise so they do not shimmer.
    for (let i = 0; i < 4; i++) {
      const cx = w * (0.1 + noise[i] * 0.8);
      const cy = h * (0.1 + noise[i + 6] * 0.3);
      ctx.fillStyle = withAlpha(palette.line, 0.22);
      for (const [dx, dy, r] of [
        [0, 0, 13],
        [12, 2, 9],
        [-12, 3, 8],
      ]) {
        ctx.beginPath();
        ctx.ellipse(cx + dx, cy + dy, r, r * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // The cross on the ground.
    ctx.strokeStyle = palette.target;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(target.x - 16, target.y - 7);
    ctx.lineTo(target.x + 16, target.y + 7);
    ctx.moveTo(target.x + 16, target.y - 7);
    ctx.lineTo(target.x - 16, target.y + 7);
    ctx.stroke();
    ctx.strokeStyle = withAlpha(palette.target, 0.35);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(target.x, target.y, 34, 14, 0, 0, Math.PI * 2);
    ctx.stroke();
  },
  drawActor: (frame) => {
    const { ctx, x, y, palette, landed, t } = frame;
    const sway = Math.sin(t * 9) * (landed ? 0 : 5);

    ctx.save();
    ctx.translate(x + sway, y);

    // Canopy, collapsing once it is down.
    const spread = landed ? 8 : 20;
    ctx.fillStyle = withAlpha(verdictColor(frame), 0.85);
    ctx.beginPath();
    ctx.ellipse(0, -22, spread, landed ? 4 : 12, 0, Math.PI, 0);
    ctx.fill();
    ctx.strokeStyle = withAlpha(palette.actor, 0.5);
    ctx.lineWidth = 1;
    for (const dx of [-spread, 0, spread]) {
      ctx.beginPath();
      ctx.moveTo(dx, -22);
      ctx.lineTo(0, -4);
      ctx.stroke();
    }

    // Jumper.
    ctx.fillStyle = palette.actor;
    ctx.beginPath();
    ctx.arc(0, -1, 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = palette.actor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 2);
    ctx.lineTo(0, 8);
    ctx.moveTo(0, 8);
    ctx.lineTo(-3, 13);
    ctx.moveTo(0, 8);
    ctx.lineTo(3, 13);
    ctx.stroke();
    ctx.restore();
  },
  drawImpact: (frame) => drawBurst(frame, frame.palette.line, 0.55 + frame.accuracy * 0.7),
};

/* --------------------------------------------------------------------- */

const javelin: Theme = {
  id: 'javelin',
  label: 'Javelin',
  mode: 'arc',
  axis: 'horizontal',
  arc: 0.36,
  restAngle: Math.PI / 3,
  start: (w, h) => ({ x: w * 0.06, y: h * 0.6 }),
  target: (w, h) => ({ x: w * 0.74, y: h * 0.8 }),
  drawScene: (frame) => {
    const { ctx, palette, target, w, h } = frame;
    const groundY = drawGround(frame, 0.78);

    // Distance markers, sparse enough to read at a glance.
    ctx.strokeStyle = withAlpha(palette.line, 0.7);
    ctx.lineWidth = 1;
    for (let i = 1; i < 8; i++) {
      const x = w * (i / 8);
      ctx.beginPath();
      ctx.moveTo(x, groundY);
      ctx.lineTo(x, groundY + h * 0.05);
      ctx.stroke();
    }

    // The line you are aiming at.
    ctx.strokeStyle = palette.target;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(target.x, groundY - 4);
    ctx.lineTo(target.x, h);
    ctx.stroke();
    ctx.fillStyle = withAlpha(palette.target, 0.16);
    ctx.fillRect(target.x - 26, groundY, 52, h - groundY);
  },
  drawActor: (frame) => {
    const { ctx, x, y, angle, palette } = frame;
    drawTrail(frame, withAlpha(palette.accent, 0.5), 1);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.strokeStyle = palette.actor;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(-24, 0);
    ctx.lineTo(18, 0);
    ctx.stroke();
    ctx.fillStyle = verdictColor(frame);
    ctx.beginPath();
    ctx.moveTo(25, 0);
    ctx.lineTo(16, -3);
    ctx.lineTo(16, 3);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = withAlpha(palette.accent, 0.85);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-6, 0);
    ctx.lineTo(2, 0);
    ctx.stroke();
    ctx.restore();
  },
  drawImpact: (frame) => drawBurst(frame, frame.palette.line, 0.5 + frame.accuracy * 0.6),
};

/* --------------------------------------------------------------------- */

const penalty: Theme = {
  id: 'penalty',
  label: 'Penalty',
  mode: 'arc',
  axis: 'horizontal',
  arc: 0.3,
  spin: 1.6,
  start: (w, h) => ({ x: w * 0.09, y: h * 0.78 }),
  target: (w, h) => ({ x: w * 0.74, y: h * 0.52 }),
  drawScene: (frame) => {
    const { ctx, palette, target, h, noise } = frame;
    drawGround(frame, 0.84);

    const left = target.x - h * 0.3;
    const right = target.x + h * 0.3;
    const top = target.y - h * 0.24;
    const base = h * 0.84;

    // Net.
    ctx.strokeStyle = withAlpha(palette.line, 0.5);
    ctx.lineWidth = 0.8;
    for (let i = 0; i <= 10; i++) {
      const x = left + ((right - left) * i) / 10;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, base);
      ctx.stroke();
    }
    for (let i = 0; i <= 5; i++) {
      const y = top + ((base - top) * i) / 5;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
    }

    // Frame.
    ctx.strokeStyle = palette.actor;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(left, base);
    ctx.lineTo(left, top);
    ctx.lineTo(right, top);
    ctx.lineTo(right, base);
    ctx.stroke();

    // A keeper, committed to one side before the ball is struck.
    const side = noise[2] > 0.5 ? 1 : -1;
    const dive = Math.min(1, frame.t / 0.6);
    const kx = target.x + side * dive * h * 0.2;
    const ky = base - h * 0.1 - dive * h * 0.03;
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(kx - 9 * side, ky - 6);
    ctx.lineTo(kx + 9 * side, ky + 8);
    ctx.stroke();
    ctx.fillStyle = palette.accent;
    ctx.beginPath();
    ctx.arc(kx - 11 * side, ky - 9, 4, 0, Math.PI * 2);
    ctx.fill();
  },
  drawActor: (frame) => {
    const { ctx, x, y, spin, palette } = frame;
    drawTrail(frame, withAlpha(palette.actor, 0.4), 1.6);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(spin);
    ctx.fillStyle = '#f2f4ff';
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = withAlpha(palette.ink, 0.85);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * 5.5, Math.sin(a) * 5.5, 2.1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(0, 0, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  },
  drawImpact: (frame) => drawBurst(frame, verdictColor(frame), burstStrength(frame)),
};

/* --------------------------------------------------------------------- */

const skipstone: Theme = {
  id: 'skipstone',
  label: 'Skipping stone',
  mode: 'roll',
  axis: 'horizontal',
  arc: 0,
  start: (w, h) => ({ x: w * 0.05, y: h * 0.6 }),
  target: (w, h) => ({ x: w * 0.78, y: h * 0.62 }),
  drawScene: (frame) => {
    const { ctx, palette, target, w, h, noise } = frame;

    const water = ctx.createLinearGradient(0, h * 0.42, 0, h);
    water.addColorStop(0, withAlpha(palette.accent, 0.14));
    water.addColorStop(1, withAlpha(palette.ink, 0.92));
    ctx.fillStyle = water;
    ctx.fillRect(0, h * 0.42, w, h * 0.58);
    ctx.strokeStyle = withAlpha(palette.line, 0.8);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.42);
    ctx.lineTo(w, h * 0.42);
    ctx.stroke();

    for (let i = 0; i < 6; i++) {
      const y = h * (0.5 + noise[i] * 0.42);
      ctx.strokeStyle = withAlpha(palette.actor, 0.08);
      ctx.beginPath();
      ctx.moveTo(w * noise[i + 8] * 0.6, y);
      ctx.lineTo(w * noise[i + 8] * 0.6 + 40, y);
      ctx.stroke();
    }

    // Buoy.
    ctx.fillStyle = palette.target;
    ctx.beginPath();
    ctx.moveTo(target.x, target.y - 22);
    ctx.lineTo(target.x + 8, target.y);
    ctx.lineTo(target.x - 8, target.y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = withAlpha(palette.actor, 0.6);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(target.x, target.y + 1, 12, 4, 0, 0, Math.PI * 2);
    ctx.stroke();
  },
  drawActor: (frame) => {
    const { ctx, x, y, flight, palette, landed } = frame;

    // Each bounce leaves a ring behind on the water.
    const BOUNCES = 4;
    for (let i = 1; i <= BOUNCES; i++) {
      const at = i / BOUNCES;
      if (at > flight) break;
      const point = frame.path(at);
      const age = (flight - at) / Math.max(0.01, flight);
      ctx.strokeStyle = withAlpha(palette.accent, (1 - age) * 0.55);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(point.x, point.y, 6 + age * 22, 2 + age * 7, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    const hop = landed ? 0 : Math.abs(Math.sin(flight * Math.PI * BOUNCES)) * 24 * (1 - flight);
    ctx.save();
    ctx.translate(x, y - hop);
    ctx.rotate(-0.25);
    ctx.fillStyle = landed ? withAlpha(palette.actor, 0.5) : palette.actor;
    ctx.beginPath();
    ctx.ellipse(0, 0, 9, 3.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = withAlpha(verdictColor(frame), 0.9);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  },
  drawImpact: (frame) => drawBurst(frame, frame.palette.accent, 0.4 + frame.accuracy * 0.8),
};

/* --------------------------------------------------------------------- */

const balloon: Theme = {
  id: 'balloon',
  label: 'Altitude',
  mode: 'roll',
  axis: 'vertical',
  arc: 0,
  spread: 0.4,
  start: (w, h) => ({ x: w * 0.5, y: h * 0.95 }),
  target: (w, h) => ({ x: w * 0.5, y: h * 0.34 }),
  drawScene: (frame) => {
    const { ctx, palette, target, w, h, noise } = frame;
    drawGround(frame, 0.93);

    // The altitude you were asked for.
    ctx.setLineDash([7, 6]);
    ctx.strokeStyle = palette.target;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, target.y);
    ctx.lineTo(w, target.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = withAlpha(palette.target, 0.1);
    ctx.fillRect(0, target.y - 9, w, 18);

    // Neighbouring altitudes, so the band means something.
    ctx.strokeStyle = withAlpha(palette.line, 0.55);
    ctx.lineWidth = 1;
    for (const fraction of [0.16, 0.5, 0.66, 0.82]) {
      ctx.beginPath();
      ctx.moveTo(w * 0.06, h * fraction);
      ctx.lineTo(w * 0.16, h * fraction);
      ctx.moveTo(w * 0.84, h * fraction);
      ctx.lineTo(w * 0.94, h * fraction);
      ctx.stroke();
    }

    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = withAlpha(palette.line, 0.18);
      ctx.beginPath();
      ctx.ellipse(w * (0.14 + noise[i] * 0.72), h * (0.12 + noise[i + 3] * 0.5), 16, 6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  drawActor: (frame) => {
    const { ctx, x, y, palette, t } = frame;
    const sway = Math.sin(t * 5.5) * 3;
    ctx.save();
    ctx.translate(x + sway, y);

    // Envelope.
    const gradient = ctx.createLinearGradient(0, -34, 0, 2);
    gradient.addColorStop(0, verdictColor(frame));
    gradient.addColorStop(1, withAlpha(palette.ink, 0.9));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(0, 4);
    ctx.bezierCurveTo(-20, -12, -17, -36, 0, -36);
    ctx.bezierCurveTo(17, -36, 20, -12, 0, 4);
    ctx.fill();
    ctx.strokeStyle = withAlpha(palette.actor, 0.35);
    ctx.lineWidth = 1;
    ctx.stroke();

    // Basket.
    ctx.strokeStyle = withAlpha(palette.actor, 0.7);
    ctx.beginPath();
    ctx.moveTo(-5, 4);
    ctx.lineTo(-4, 11);
    ctx.moveTo(5, 4);
    ctx.lineTo(4, 11);
    ctx.stroke();
    ctx.fillStyle = palette.line;
    ctx.fillRect(-5, 10, 10, 7);
    ctx.restore();
  },
  drawImpact: (frame) => drawBurst(frame, verdictColor(frame), 0.35 + frame.accuracy * 0.8),
};

export const THEMES: Record<ThemeId, Theme> = {
  archery,
  hoops,
  darts,
  landing,
  curling,
  putt,
  paperplane,
  cannon,
  bowling,
  ringtoss,
  discgolf,
  parachute,
  javelin,
  penalty,
  skipstone,
  balloon,
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
