// Obstacle silhouettes shared by the day art (obstacles.ts builds its sprites
// from them) and the night art (night.ts outlines them in the dark).
//
// At night the telegraphs are the loudest thing on screen: a dark disc with a
// bright closing ring. A rock outlined with a perfect circle would look just
// like one, so the night outline follows the rock's own faceted shape (and a
// lily pad's notch) instead. Shape, not brightness, is what tells a player
// "this is a hazard, not a raindrop".
//
// Everything here is a pure function of the variant index, built once as
// Path2D objects, so the night pass allocates nothing per frame.

import { TAU, makeRand } from './util';

/** Reference radius the rock sprites are rendered at; scaled to each rock's r. */
export const ROCK_R0 = 34;
export const ROCK_VARIANTS = 6;
/** Reference radius of the lily pad sprites (pads are 18..30 units). */
export const PAD_R0 = 30;
export const PAD_VARIANTS = 4;

const ROCK_SEED = 300;
const PAD_SEED = 400;

export interface RockShape {
  verts: number;
  /** Corner radii, averaging ~0.93 of ROCK_R0 so the drawn rock matches its collision circle. */
  rs: number[];
  /** The generator, positioned just after the shape's draws (the sprite keeps drawing from it). */
  rand: () => number;
}

/** The irregular rock outline for a seed. The sprite and the night outline draw the same one. */
export function rockShape(seed: number): RockShape {
  const rand = makeRand(seed);
  const verts = 7 + Math.floor(rand() * 3);
  const rs: number[] = [];
  for (let i = 0; i < verts; i++) rs.push(ROCK_R0 * (0.8 + rand() * 0.26));
  return { verts, rs, rand };
}

/** Rock outline scaled by `s` and moved by (ox, oy), as a smooth closed curve through the corner midpoints (the caller begins the path). */
export function traceRock(c: CanvasPath, shape: RockShape, s: number, ox = 0, oy = 0): void {
  const { verts, rs } = shape;
  for (let i = 0; i <= verts; i++) {
    const a0 = (i / verts) * TAU;
    const a1 = ((i + 1) / verts) * TAU;
    const p0x = ox + Math.cos(a0) * rs[i % verts] * s;
    const p0y = oy + Math.sin(a0) * rs[i % verts] * s;
    const p1x = ox + Math.cos(a1) * rs[(i + 1) % verts] * s;
    const p1y = oy + Math.sin(a1) * rs[(i + 1) % verts] * s;
    const mx = (p0x + p1x) / 2;
    const my = (p0y + p1y) / 2;
    if (i === 0) c.moveTo(mx, my);
    else c.quadraticCurveTo(p0x, p0y, mx, my);
  }
  c.closePath();
}

/** The wedge the stem notch cuts out of a pad (radians), a stable draw per pad variant. */
export function padNotch(seed: number): number {
  return 0.3 + makeRand(seed)() * 0.16;
}

/** The pad outline: a disc with a wedge cut to the stem, at radius `r`. */
export function tracePad(c: CanvasPath, notch: number, r: number, ox = 0, oy = 0): void {
  c.moveTo(ox, oy);
  c.arc(ox, oy, r, notch / 2, TAU - notch / 2);
  c.closePath();
}

let rockPaths: Path2D[] | null = null;
let padPaths: Path2D[] | null = null;

/** Cached outline (at ROCK_R0 scale) for rock variant index `i`. */
export function rockPath(i: number): Path2D {
  if (!rockPaths) {
    rockPaths = [];
    for (let v = 0; v < ROCK_VARIANTS; v++) {
      const p = new Path2D();
      traceRock(p, rockShape(ROCK_SEED + v), 1);
      rockPaths.push(p);
    }
  }
  return rockPaths[Math.min(ROCK_VARIANTS - 1, Math.max(0, i))];
}

/** Cached outline (at PAD_R0 scale) for pad variant index `i`. */
export function padPath(i: number): Path2D {
  if (!padPaths) {
    padPaths = [];
    for (let v = 0; v < PAD_VARIANTS; v++) {
      const p = new Path2D();
      tracePad(p, padNotch(PAD_SEED + v), PAD_R0);
      padPaths.push(p);
    }
  }
  return padPaths[Math.min(PAD_VARIANTS - 1, Math.max(0, i))];
}

/** Seeds the sprite builders use (kept beside the paths so they cannot drift apart). */
export const rockSeed = (i: number): number => ROCK_SEED + i;
export const padSeed = (i: number): number => PAD_SEED + i;

/** Variant index for an obstacle's stable 0..1 `variant`. */
export const rockIndex = (variant: number): number => Math.min(ROCK_VARIANTS - 1, Math.floor(variant * ROCK_VARIANTS));
export const padIndex = (variant: number): number => Math.min(PAD_VARIANTS - 1, Math.floor(variant * PAD_VARIANTS));
