// Per-frame drawing context shared by every render module: the world → device
// transform (including screen shake), view bounds, clocks, and the river edges
// sampled at fixed river distances so scenery scrolls rigidly with the river.

import { WORLD_W } from '../config';
import { noise1 } from '../engine/rng';
import { riverEdgesAt } from '../game/river';
import type { World } from '../types';

export interface Sprite {
  img: HTMLCanvasElement;
  /** Size in world units; drawn centred on the anchor. */
  w: number;
  h: number;
}

/**
 * Renders `draw` into an offscreen canvas at `ppu` device pixels per world unit,
 * with the origin at the sprite centre, so drawing it back is a 1:1 pixel copy.
 */
export function makeSprite(
  w: number,
  h: number,
  ppu: number,
  draw: (c: CanvasRenderingContext2D) => void,
): Sprite {
  const img = document.createElement('canvas');
  img.width = Math.max(1, Math.ceil(w * ppu));
  img.height = Math.max(1, Math.ceil(h * ppu));
  const c = img.getContext('2d');
  if (c) {
    c.setTransform(img.width / w, 0, 0, img.height / h, img.width / 2, img.height / 2);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    draw(c);
  }
  return { img, w, h };
}

/**
 * Edge-sample spacing along the river (units). The banks are smooth at this
 * scale (their wobble has a ~110-unit period), and every edge layer (water,
 * floor, mud, wet line, two foam lines) re-traces these samples, so a coarser
 * step directly cuts per-frame path work.
 */
export const RIVER_STEP = 12;
const STEP = RIVER_STEP;
/** Edge cache size (power of two): covers far more river than any screen shows. */
const CACHE = 1024;

export class Gfx {
  ctx: CanvasRenderingContext2D;
  /** Device px per world unit. */
  k = 1;
  /** Device px of world origin, including shake. */
  ox = 0;
  oy = 0;
  /** Device px per world unit used for sprites (same as k without shake). */
  ppu = 1;
  dpr = 1;
  /** Canvas size in device px. */
  cw = 1;
  ch = 1;
  /** Safe-area insets in CSS px. */
  safeTop = 0;
  safeBottom = 0;
  /** Visible world bounds. */
  viewL = 0;
  viewR = WORLD_W;
  viewH = 740;
  /** Ambient clock (always runs, also while paused) and its frame delta. */
  t = 0;
  dt = 0;
  /** Effects delta: 0 while the run is frozen (pause / countdown). */
  edt = 0;
  reduced = false;

  // River frame.
  seed = 0;
  dist = 0;
  /** Player view y (the anchor of river distance). */
  py = 0;

  /** Samples ordered bottom (index 0) to top. */
  n = 0;
  k0 = 0;
  ys = new Float32Array(256);
  /** Raw water edges (match gameplay collisions). */
  ls = new Float32Array(256);
  rs = new Float32Array(256);
  /** Edges with a little visual wobble so banks look organic. */
  lw = new Float32Array(256);
  rw = new Float32Array(256);

  private cacheSeed = -1;
  private cacheK = new Int32Array(CACHE).fill(0x7fffffff);
  private cacheL = new Float32Array(CACHE);
  private cacheR = new Float32Array(CACHE);
  private cacheWL = new Float32Array(CACHE);
  private cacheWR = new Float32Array(CACHE);

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  /** Base transform: draw in world units. */
  world(): void {
    this.ctx.setTransform(this.k, 0, 0, this.k, this.ox, this.oy);
  }

  /** Device-pixel transform (full-screen overlays). */
  screen(): void {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** Local transform at world (x, y), rotated and scaled; flip mirrors on x. */
  local(x: number, y: number, rot = 0, s = 1, flip = false): void {
    const ks = this.k * s;
    const fx = flip ? -1 : 1;
    if (rot === 0) {
      this.ctx.setTransform(ks * fx, 0, 0, ks, this.ox + this.k * x, this.oy + this.k * y);
      return;
    }
    const c = Math.cos(rot) * ks;
    const sn = Math.sin(rot) * ks;
    this.ctx.setTransform(c * fx, sn * fx, -sn, c, this.ox + this.k * x, this.oy + this.k * y);
  }

  sprite(s: Sprite, x: number, y: number, rot = 0, scale = 1, flip = false): void {
    this.local(x, y, rot, scale, flip);
    this.ctx.drawImage(s.img, -s.w / 2, -s.h / 2, s.w, s.h);
  }

  /**
   * World offsets nudged so they land on whole device pixels; patterns drawn at
   * 1/k scale with these offsets blit 1:1 (no resampling).
   */
  alignX(u: number): number {
    return (Math.round(this.ox + this.k * u) - this.ox) / this.k;
  }
  alignY(u: number): number {
    return (Math.round(this.oy + this.k * u) - this.oy) / this.k;
  }

  /** River distance → view y. */
  yOfD(d: number): number {
    return this.py - (d - this.dist);
  }

  /** View y → river distance. */
  dOfY(y: number): number {
    return this.dist + this.py - y;
  }

  /** Samples the river edges covering the view (plus padding) for this frame. */
  sampleRiver(world: World, pad: number): void {
    if (world.seed !== this.cacheSeed) {
      this.cacheSeed = world.seed;
      this.cacheK.fill(0x7fffffff);
    }
    this.seed = world.seed;
    this.dist = world.distance;
    this.py = world.player.y;
    const dTop = this.dist + this.py + pad;
    const dBot = this.dist + this.py - (this.viewH + pad);
    const k0 = Math.floor(dBot / STEP);
    const k1 = Math.ceil(dTop / STEP);
    const n = k1 - k0 + 1;
    if (n > this.ys.length) {
      const cap = Math.ceil(n * 1.5);
      this.ys = new Float32Array(cap);
      this.ls = new Float32Array(cap);
      this.rs = new Float32Array(cap);
      this.lw = new Float32Array(cap);
      this.rw = new Float32Array(cap);
    }
    this.n = n;
    this.k0 = k0;
    for (let i = 0; i < n; i++) {
      const k = k0 + i;
      const slot = k & (CACHE - 1);
      if (this.cacheK[slot] !== k) this.fill(slot, k);
      this.ys[i] = this.py - (k * STEP - this.dist);
      this.ls[i] = this.cacheL[slot];
      this.rs[i] = this.cacheR[slot];
      this.lw[i] = this.cacheWL[slot];
      this.rw[i] = this.cacheWR[slot];
    }
  }

  private fill(slot: number, k: number): void {
    const d = k * STEP;
    const e = riverEdgesAt(this.seed, d);
    // Two octaves of small wobble: visual only, a few units, so the soft-wall
    // collision still matches what the player sees.
    const wl = noise1(this.seed ^ 0x3c3c, d * 0.055) * 2.2 + noise1(this.seed ^ 0x5d5d, d * 0.016) * 3;
    const wr = noise1(this.seed ^ 0x6e6e, d * 0.055) * 2.2 + noise1(this.seed ^ 0x7f7f, d * 0.016) * 3;
    this.cacheK[slot] = k;
    this.cacheL[slot] = e.left;
    this.cacheR[slot] = e.right;
    this.cacheWL[slot] = e.left + wl;
    this.cacheWR[slot] = e.right + wr;
  }

  /** Fractional sample index for a view y. */
  private idx(y: number): number {
    const i = (this.dOfY(y) - this.k0 * STEP) / STEP;
    return i < 0 ? 0 : i > this.n - 1 ? this.n - 1 : i;
  }

  private at(arr: Float32Array, y: number): number {
    const f = this.idx(y);
    const i = Math.floor(f);
    const j = i + 1 < this.n ? i + 1 : i;
    const u = f - i;
    return arr[i] + (arr[j] - arr[i]) * u;
  }

  /** Raw left/right water edge at view y. */
  leftAt(y: number): number {
    return this.at(this.ls, y);
  }
  rightAt(y: number): number {
    return this.at(this.rs, y);
  }
  /** Wobbled (drawn) edges at view y. */
  leftDrawnAt(y: number): number {
    return this.at(this.lw, y);
  }
  rightDrawnAt(y: number): number {
    return this.at(this.rw, y);
  }

  /** Strokes a polyline through one edge array, offset in x. */
  edgePath(arr: Float32Array, dx: number): void {
    const { ctx, ys, n } = this;
    ctx.beginPath();
    ctx.moveTo(arr[0] + dx, ys[0]);
    for (let i = 1; i < n; i++) ctx.lineTo(arr[i] + dx, ys[i]);
  }
}
