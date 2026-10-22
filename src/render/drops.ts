// Raindrop telegraphs, the most important readability element in the game.
//
// Reading order for the player:
//   1. a dark disc appears exactly the size of the splash and darkens as impact nears;
//   2. a bright ring (with a dark outline so it reads on light leaf and dark water
//      alike) closes in on the disc edge: ring meets edge = impact;
//   3. in the last moment the drop itself streaks in from above.
// Aimed drops carry four inward ticks on the ring (shape, not colour). When the
// ant is inside a splash zone the ring gets thicker and pulses, so "you are in
// it" reads by thickness and motion, not hue alone.

import { ANT_HIT_R } from '../config';
import type { Drop, World } from '../types';
import type { Gfx } from './gfx';
import { P } from './palette';
import { TAU, clamp01 } from './util';

/** Seconds before impact that the falling drop becomes visible. */
const STREAK_TIME = 0.2;
const STREAK_HEIGHT = 150;
/** How far outside r the closing ring starts (multiple of r). */
const RING_START = 1.25;

/** `drops` defaults to the world's; the menu backdrop passes its cosmetic demo drops. */
export function drawDrops(g: Gfx, world: World, drops: readonly Drop[] = world.drops): void {
  if (!drops.length) return;
  const { ctx } = g;
  const ant = world.player;
  const alive = world.state === 'running';
  g.world();

  // Pass 1: shadows. Drawn first for every drop so overlapping zones never hide a ring.
  for (let i = 0; i < drops.length; i++) {
    const d = drops[i];
    if (d.age < 0) continue;
    const t = d.fall > 0 ? clamp01(d.age / d.fall) : 1;
    const fade = clamp01(d.age / 0.12);
    ctx.globalAlpha = (0.16 + 0.42 * t * t) * fade;
    ctx.fillStyle = P.shadow;
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r, 0, TAU);
    ctx.fill();
    // A darker, growing core: the shadow focusing as the drop gets closer.
    ctx.globalAlpha = (0.12 + 0.34 * t) * fade;
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r * (0.22 + 0.5 * t), 0, TAU);
    ctx.fill();
  }

  // Pass 2: zone edge, closing ring, aimed ticks.
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

    // Zone edge: a faint light rim so the size reads on dark water too.
    ctx.globalAlpha = (0.16 + 0.34 * t) * fade;
    ctx.strokeStyle = P.ringLight;
    ctx.lineWidth = urgent ? 1.6 : 1;
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r, 0, TAU);
    ctx.stroke();

    // Closing ring.
    const rr = d.r * (1 + RING_START * (1 - t) ** 1.35);
    const w = (threat ? 2.9 : 2) + (urgent ? 0.7 : 0) + pulse * 0.8;
    ctx.globalAlpha = 0.55 * fade;
    ctx.strokeStyle = P.ringDark;
    ctx.lineWidth = w + 2.4;
    ringPath(ctx, d, rr, g.t);
    ctx.stroke();
    ctx.globalAlpha = (0.55 + 0.45 * t) * fade;
    ctx.strokeStyle = threat ? P.goldLight : P.ringLight;
    ctx.lineWidth = w;
    ringPath(ctx, d, rr, g.t);
    ctx.stroke();
  }

  // Pass 3: the drop itself, streaking in from above for the last moment.
  for (let i = 0; i < drops.length; i++) {
    const d = drops[i];
    const remaining = d.fall - d.age;
    if (remaining > STREAK_TIME || remaining < 0) continue;
    const h = remaining / STREAK_TIME;
    const x = d.x + h * 22;
    const y = d.y - h * STREAK_HEIGHT;
    const tail = 16 + 22 * h;
    ctx.globalAlpha = clamp01((1 - h) * 3) * 0.95;
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
