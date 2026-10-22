// Raindrop telegraphs, the most important readability element in the game.
//
// Reading order for the player (it must never look like a rock, which is a solid,
// warm, dark-edged thing):
//   1. a pale, slowly turning DASHED "rain circle" appears exactly the size of the
//      splash and fills with light blue as impact nears; a dashed line says
//      "zone", never "solid object". A small teardrop sits in its centre;
//   2. a bright ring (with a dark outline so it reads on light leaf and dark water
//      alike) closes in on the circle edge: ring meets edge = impact. The ring is
//      the timer and is always drawn on top of everything else;
//   3. in the last moment the drop itself streaks in from above.
// Aimed drops carry four inward ticks on the ring (shape, not colour). When the
// ant is inside a splash zone the ring gets thicker and pulses, so "you are in
// it" reads by thickness and motion, not hue alone.
//
// At night (world.darkness rising) telegraphs are drawn above the darkness and
// GLOW: the splash zone fills with pale light, the dashed rim brightens and every
// ring gets a halo, so they are easier to read in the dark than by day.

import { ANT_HIT_R } from '../config';
import type { Drop, World } from '../types';
import type { Gfx } from './gfx';
import { P, ZP } from './palette';
import { TAU, clamp01 } from './util';

/** Seconds before impact that the falling drop becomes visible. */
const STREAK_TIME = 0.2;
const STREAK_HEIGHT = 150;
/** How far outside r the closing ring starts (multiple of r). */
const RING_START = 1.25;

/** Dashed rim: one dash plus one gap is about this long (units); the rim is fitted to a whole number of them. */
const DASH_PERIOD = 11;
/** Share of each period that is dash (6 of 11). */
const DASH_ON = 6 / 11;
/** Rim turn speed along the circle (units per second). */
const DASH_SPEED = 10;
/** Reused for every setLineDash call (rewritten per drop) so no array is allocated per frame. */
const DASH: number[] = [DASH_PERIOD * DASH_ON, DASH_PERIOD * (1 - DASH_ON)];
const NO_DASH: number[] = [];

// Teardrop: a circle of radius b with the tip D = 2.1 b above its centre, joined by tangent
// lines. The tangent points sit at angle PHI either side of straight up.
const TEAR_D = 2.1;
const TEAR_SIN = Math.sqrt(1 - 1 / (TEAR_D * TEAR_D));
const TEAR_COS = 1 / TEAR_D;
const TEAR_PHI = Math.acos(TEAR_COS);
/** Circle radius per unit of half-height hh: the whole icon is (D + 1) b = 2 hh tall. */
const TEAR_B = 2 / (TEAR_D + 1);
/** The real drop streaks in during the last STREAK_TIME; the icon is gone for the final stretch. */
const TEAR_FADE = 0.1;

/** `drops` defaults to the world's; the menu backdrop passes its cosmetic demo drops. */
export function drawDrops(g: Gfx, world: World, drops: readonly Drop[] = world.drops): void {
  if (!drops.length) return;
  const { ctx } = g;
  const ant = world.player;
  const alive = world.state === 'running';
  // 0 by day .. 1 in full darkness (the menu backdrop stays a little lighter).
  const night = clamp01(world.darkness) * (world.state === 'attract' ? 0.6 : 1);
  g.world();

  // Pass 1: rain circles. Drawn first for every drop so overlapping zones never hide a ring.
  for (let i = 0; i < drops.length; i++) {
    const d = drops[i];
    if (d.age < 0) continue;
    const t = d.fall > 0 ? clamp01(d.age / d.fall) : 1;
    const fade = clamp01(d.age / 0.12);
    // A pale fill that strengthens as impact nears (no dark disc: that read as a rock).
    // At night the blue thins out and the nightFoam light below takes over.
    ctx.globalAlpha = (0.12 + 0.22 * t * t) * fade * (1 - 0.4 * night);
    ctx.fillStyle = P.rainFill;
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r, 0, TAU);
    ctx.fill();
    if (night > 0.02) {
      ctx.globalAlpha = night * (0.07 + 0.16 * t) * fade;
      ctx.fillStyle = ZP.nightFoam;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, TAU);
      ctx.fill();
    }
  }

  // Pass 2: the dashed rim and the teardrop of every drop (rings come after, so they are always on top).
  ctx.lineJoin = 'round';
  for (let i = 0; i < drops.length; i++) {
    const d = drops[i];
    if (d.age < 0) continue;
    const t = d.fall > 0 ? clamp01(d.age / d.fall) : 1;
    const fade = clamp01(d.age / 0.12);
    const remaining = d.fall - d.age;
    const urgent = remaining < 0.28;
    const rimW = (urgent ? 2.4 : 2) + 0.8 * night;
    // The rim turns slowly (a still dashed circle looks like a printed target); reduced motion keeps it still.
    const spin = g.reduced ? 0 : -g.t * DASH_SPEED;
    // Dark under-stroke first, a little longer and wider than the dashes it backs, so each light
    // dash is outlined and reads on the pale Marsh water as well as on dark water.
    ctx.lineCap = 'butt';
    ctx.globalAlpha = (0.3 + 0.1 * t) * fade;
    ctx.strokeStyle = P.ringDark;
    ctx.lineWidth = rimW + 1.6;
    fitDash(ctx, d.r, 1.6);
    ctx.lineDashOffset = spin + 0.8;
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = Math.min(0.95, (0.5 + 0.4 * t) * (1 + 0.5 * night)) * fade;
    ctx.strokeStyle = P.rainRim;
    ctx.lineWidth = rimW;
    fitDash(ctx, d.r, 0);
    ctx.lineDashOffset = spin;
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r, 0, TAU);
    ctx.stroke();
    // Solid again for everything that follows.
    ctx.setLineDash(NO_DASH);
    ctx.lineDashOffset = 0;

    // Teardrop in the centre, gone for the last moment when the real drop streaks in.
    const tearA = fade * clamp01(remaining / TEAR_FADE);
    if (tearA > 0.01) {
      ctx.globalAlpha = tearA;
      teardrop(ctx, d.x, d.y, d.r * (0.32 + 0.22 * t));
    }
  }

  // Pass 3: closing ring, aimed ticks.
  ctx.lineCap = 'round';
  for (let i = 0; i < drops.length; i++) {
    const d = drops[i];
    if (d.age < 0) continue;
    const t = d.fall > 0 ? clamp01(d.age / d.fall) : 1;
    const fade = clamp01(d.age / 0.12);
    const remaining = d.fall - d.age;
    const threat = alive && isThreat(d, ant.x, ant.y);
    const urgent = remaining < 0.28;
    const pulse = threat && !g.reduced ? 0.5 + 0.5 * Math.sin(g.t * 26) : 0;

    // Closing ring.
    const rr = d.r * (1 + RING_START * (1 - t) ** 1.35);
    const w = (threat ? 2.9 : 2) + (urgent ? 0.7 : 0) + pulse * 0.8;
    if (night > 0.02) {
      // Night glow: two soft halos under the ring (no blur filters: cheap strokes).
      ctx.strokeStyle = threat ? P.goldLight : ZP.nightGlow;
      ctx.lineWidth = w + 10;
      ctx.globalAlpha = 0.1 * night * fade * (0.6 + 0.4 * t);
      ringPath(ctx, d, rr, g.t);
      ctx.stroke();
      ctx.lineWidth = w + 5;
      ctx.globalAlpha = 0.2 * night * fade * (0.6 + 0.4 * t);
      ringPath(ctx, d, rr, g.t);
      ctx.stroke();
    }
    // By day the outline is firmer: on the pale Marsh water and among the
    // Rapids' white foam arcs a thin grey ring is the faintest in the game.
    const day = 1 - night;
    ctx.globalAlpha = (0.55 + 0.2 * day) * fade;
    ctx.strokeStyle = P.ringDark;
    ctx.lineWidth = w + 2.4 + 1.2 * day;
    ringPath(ctx, d, rr, g.t);
    ctx.stroke();
    ctx.globalAlpha = (0.55 + 0.45 * t) * fade;
    ctx.strokeStyle = threat ? P.goldLight : P.ringLight;
    ctx.lineWidth = w;
    ringPath(ctx, d, rr, g.t);
    ctx.stroke();
  }

  // Pass 4: the drop itself, streaking in from above for the last moment.
  for (let i = 0; i < drops.length; i++) {
    const d = drops[i];
    const remaining = d.fall - d.age;
    if (remaining > STREAK_TIME || remaining < 0) continue;
    const h = remaining / STREAK_TIME;
    const x = d.x + h * 22;
    const y = d.y - h * STREAK_HEIGHT;
    const tail = 16 + 22 * h;
    ctx.globalAlpha = clamp01((1 - h) * 3) * 0.95;
    if (night > 0.02) {
      ctx.strokeStyle = ZP.nightGlow;
      ctx.lineWidth = 11;
      ctx.globalAlpha *= 0.22 * night;
      ctx.beginPath();
      ctx.moveTo(x + tail * 0.15, y - tail);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.globalAlpha = clamp01((1 - h) * 3) * 0.95;
    }
    ctx.strokeStyle = P.ringDark;
    ctx.lineWidth = 5.4;
    ctx.beginPath();
    ctx.moveTo(x + tail * 0.15, y - tail);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.strokeStyle = P.dropBody;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = P.ringLight;
    ctx.beginPath();
    ctx.arc(x, y, 2.6, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** Sets a dash pattern that fits the circle exactly (no ragged seam); `pad` lengthens each dash for the under-stroke. */
function fitDash(ctx: CanvasRenderingContext2D, r: number, pad: number): void {
  const n = Math.max(6, Math.round((TAU * r) / DASH_PERIOD));
  const period = (TAU * r) / n;
  DASH[0] = period * DASH_ON + pad;
  DASH[1] = period - DASH[0];
  ctx.setLineDash(DASH);
}

/**
 * A raindrop icon centred on (x, y), `hh` tall above and below the centre: point up, round
 * bottom, pale body, dark outline and a highlight. Uses the current globalAlpha.
 */
function teardrop(ctx: CanvasRenderingContext2D, x: number, y: number, hh: number): void {
  const b = hh * TEAR_B;
  const cy = y + hh - b;
  const top = y - hh;
  const tx = b * TEAR_SIN;
  const ty = cy - b * TEAR_COS;
  // Slightly concave sides (control point pulled toward the axis) give the classic drop silhouette.
  const cx = tx * 0.3;
  const cyc = (top + ty) / 2;
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.quadraticCurveTo(x + cx, cyc, x + tx, ty);
  ctx.arc(x, cy, b, -Math.PI / 2 + TEAR_PHI, (3 * Math.PI) / 2 - TEAR_PHI);
  ctx.quadraticCurveTo(x - cx, cyc, x, top);
  ctx.closePath();
  ctx.fillStyle = P.dropBody;
  ctx.fill();
  ctx.strokeStyle = P.ringDark;
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.fillStyle = P.white;
  ctx.beginPath();
  ctx.arc(x - b * 0.38, cy - b * 0.22, b * 0.26, 0, TAU);
  ctx.fill();
}

function isThreat(d: Drop, ax: number, ay: number): boolean {
  const dx = d.x - ax;
  const dy = d.y - ay;
  const rr = d.r + ANT_HIT_R;
  return dx * dx + dy * dy < rr * rr;
}

/** The ring path; aimed drops add four inward ticks that slowly turn. */
function ringPath(ctx: CanvasRenderingContext2D, d: Drop, rr: number, t: number): void {
  ctx.beginPath();
  ctx.arc(d.x, d.y, rr, 0, TAU);
  if (!d.aimed) return;
  const tick = Math.max(4, d.r * 0.3);
  const a0 = t * 1.2 + d.id;
  for (let k = 0; k < 4; k++) {
    const a = a0 + (k * Math.PI) / 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    ctx.moveTo(d.x + c * rr, d.y + s * rr);
    ctx.lineTo(d.x + c * (rr - tick), d.y + s * (rr - tick));
  }
}
