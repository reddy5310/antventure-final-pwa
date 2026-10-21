// The river surface: depth gradient, two drifting caustic layers, shallows and
// bank shade, flow streaks, deterministic decorations (lily pads, petals, foam
// flecks) and the foam that laps the waterline. Decorations are deliberately
// light, green or warm and never dark-disc-with-ring shaped, so nothing here can
// be mistaken for a raindrop telegraph.

import { WORLD_W } from '../config';
import type { World } from '../types';
import type { FoliageSprites } from './foliage';
import type { Gfx } from './gfx';
import { P } from './palette';
import { TAU, frac, hash, makeRand } from './util';

const STREAK_SLOT = 19;
const LILY_SLOT = 62;
const PETAL_SLOT = 44;
const FLECK_SLOT = 17;
const FOAM_DASH = [4, 9];
/** Water tile period (units): two caustic periods, tall enough that the baked deep pools don't visibly repeat. */
const BASE_H = 480;
const CAUSTIC_T = 240;
const CAUSTIC2_SCALE = 1.45;
const NO_DASH: number[] = [];

/**
 * Caustic network as Worley F2-F1 lines on a jittered grid, computed once into a
 * small seamless tile (a build-time pixel loop, never per frame). Represents
 * CAUSTIC_T units; it is upscaled into the device-resolution water tiles.
 */
function buildWorley(): HTMLCanvasElement {
  const px = 160;
  const cells = 5;
  const img = newCanvas(px, px);
  const c = img.getContext('2d');
  if (!c) return img;
  const rand = makeRand(777);
  const fx = new Float32Array(cells * cells);
  const fy = new Float32Array(cells * cells);
  for (let i = 0; i < cells * cells; i++) {
    fx[i] = 0.15 + rand() * 0.7;
    fy[i] = 0.15 + rand() * 0.7;
  }
  const data = c.createImageData(px, px);
  const cellPx = px / cells;
  // Periodic domain warp (integer frequencies keep the tile seamless) bends the
  // straight Voronoi edges into the curvy lines real caustics have.
  const warp = cellPx * 0.2;
  const w = (TAU / px);
  for (let y = 0; y < px; y++) {
    for (let x0 = 0; x0 < px; x0++) {
      const x = x0 + Math.sin(y * w * 2 + 1.3) * warp + Math.sin(y * w * 5 + 0.2) * warp * 0.4;
      const yy = y + Math.sin(x0 * w * 3 + 0.4) * warp + Math.sin(x0 * w * 4 + 2.1) * warp * 0.4;
      const gx = Math.floor(x / cellPx);
      const gy = Math.floor(yy / cellPx);
      let f1 = 1e9;
      let f2 = 1e9;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const cx = gx + ox;
          const cy = gy + oy;
          const wx = ((cx % cells) + cells) % cells;
          const wy = ((cy % cells) + cells) % cells;
          const k = wy * cells + wx;
          const dx = (cx + fx[k]) * cellPx - x;
          const dy = (cy + fy[k]) * cellPx - yy;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < f1) {
            f2 = f1;
            f1 = d;
          } else if (d < f2) {
            f2 = d;
          }
        }
      }
      const edge = (f2 - f1) / cellPx;
      const v = edge < 0.085 ? 1 - edge / 0.085 : 0;
      const o = (y * px + x0) * 4;
      data.data[o] = 255;
      data.data[o + 1] = 255;
      data.data[o + 2] = 255;
      data.data[o + 3] = Math.round(v * v * 255);
    }
  }
  c.putImageData(data, 0, 0);
  return img;
}

function newCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

/**
 * The opaque base water tile at device resolution: depth gradient (deep in the
 * middle), soft deep pools and the first caustic layer, all baked so the frame
 * pays for one 1:1 blit instead of three blended full-screen passes.
 */
function buildBase(ppu: number, worley: HTMLCanvasElement): HTMLCanvasElement {
  const bw = Math.round(WORLD_W * ppu);
  const bh = Math.round(BASE_H * ppu);
  const img = newCanvas(bw, bh);
  const b = img.getContext('2d');
  if (!b) return img;
  b.setTransform(bw / WORLD_W, 0, 0, bh / BASE_H, 0, 0);
  const g = b.createLinearGradient(0, 0, WORLD_W, 0);
  g.addColorStop(0, P.waterShallow);
  g.addColorStop(0.17, P.waterMid);
  g.addColorStop(0.5, P.waterDeep);
  g.addColorStop(0.83, P.waterMid);
  g.addColorStop(1, P.waterShallow);
  b.fillStyle = g;
  b.fillRect(0, 0, WORLD_W, BASE_H);
  const rand = makeRand(9001);
  for (let i = 0; i < 5; i++) {
    const x = WORLD_W / 2 + (rand() - 0.5) * 170;
    const y = rand() * BASE_H;
    const r = 70 + rand() * 60;
    const sy = 1.2 + rand() * 0.6;
    for (let dy = -BASE_H; dy <= BASE_H; dy += BASE_H) {
      b.save();
      b.translate(x, y + dy);
      b.scale(1, sy);
      const rg = b.createRadialGradient(0, 0, 0, 0, 0, r);
      rg.addColorStop(0, 'rgba(3, 30, 45, 0.34)');
      rg.addColorStop(0.55, 'rgba(3, 30, 45, 0.16)');
      rg.addColorStop(1, 'rgba(3, 30, 45, 0)');
      b.fillStyle = rg;
      b.beginPath();
      b.arc(0, 0, r, 0, TAU);
      b.fill();
      b.restore();
    }
  }
  const pat = b.createPattern(worley, 'repeat');
  if (pat) {
    const m = new DOMMatrix();
    m.a = CAUSTIC_T / worley.width;
    m.d = CAUSTIC_T / worley.height;
    pat.setTransform(m);
    b.globalAlpha = 0.06;
    b.fillStyle = pat;
    b.fillRect(0, 0, WORLD_W, BASE_H);
    b.globalAlpha = 1;
  }
  return img;
}

export class Water {
  private base: HTMLCanvasElement | null = null;
  private basePattern: CanvasPattern | null = null;
  private c2: HTMLCanvasElement | null = null;
  private c2Pattern: CanvasPattern | null = null;
  private m = new DOMMatrix();
  private f: FoliageSprites | null = null;

  build(ctx: CanvasRenderingContext2D, ppu: number, foliage: FoliageSprites): void {
    this.f = foliage;
    const worley = buildWorley();
    this.base = buildBase(ppu, worley);
    this.basePattern = ctx.createPattern(this.base, 'repeat-y');
    // Second caustic layer pre-scaled to its final size, so it also blits 1:1.
    const s2 = Math.round(CAUSTIC_T * CAUSTIC2_SCALE * ppu);
    this.c2 = newCanvas(s2, s2);
    const c = this.c2.getContext('2d');
    if (c) {
      c.imageSmoothingQuality = 'high';
      c.drawImage(worley, 0, 0, s2, s2);
    }
    this.c2Pattern = ctx.createPattern(this.c2, 'repeat');
  }

  draw(g: Gfx, world: World): void {
    const { ctx } = g;
    const seed = world.seed;
    g.world();
    this.drawSurface(g);

    // Shallows along each bank, then the bank's own shade at the very edge.
    g.world();
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = P.waterShallow;
    ctx.lineWidth = 46;
    edges(g, 0);
    ctx.stroke();
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = P.waterShade;
    ctx.lineWidth = 9;
    ctx.stroke();
    ctx.globalAlpha = 1;

    this.drawStreaks(g, seed);
    this.drawDecor(g, seed);
    this.drawFoam(g);
  }

  /**
   * Base tile + second caustic layer. Both patterns are mapped 1:1 to device
   * pixels at integer offsets, the cheapest way to cover the screen. The two
   * layers drift at slightly different rates; their interference is the shimmer.
   */
  private drawSurface(g: Gfx): void {
    const { ctx, k } = g;
    const m = this.m;
    const anchor = g.py + g.dist;
    m.a = 1 / k;
    m.b = 0;
    m.c = 0;
    m.d = 1 / k;
    if (this.base && this.basePattern) {
      m.e = g.alignX(0);
      m.f = g.alignY(mod(anchor + g.t * 7, this.base.height / k));
      this.basePattern.setTransform(m);
      ctx.fillStyle = this.basePattern;
      ctx.fillRect(-30, -30, WORLD_W + 60, g.viewH + 60);
    } else {
      ctx.fillStyle = P.waterMid;
      ctx.fillRect(-30, -30, WORLD_W + 60, g.viewH + 60);
    }
    if (this.c2 && this.c2Pattern) {
      m.e = g.alignX(70 + Math.cos(g.t * 0.27) * 9);
      m.f = g.alignY(mod(anchor - g.t * 5, this.c2.height / k));
      this.c2Pattern.setTransform(m);
      ctx.fillStyle = this.c2Pattern;
      ctx.globalAlpha = 0.045;
      ctx.fillRect(0, -10, WORLD_W, g.viewH + 20);
      ctx.globalAlpha = 1;
    }
  }

  /** Flow streaks: each lives in its slot and slides downstream while fading in and out, so none ever pops. */
  private drawStreaks(g: Gfx, seed: number): void {
    const { ctx } = g;
    const [k0, k1] = range(g, STREAK_SLOT, 60);
    ctx.lineCap = 'round';
    ctx.strokeStyle = P.foam;
    for (let bucket = 0; bucket < 3; bucket++) {
      ctx.lineWidth = 1.2 + bucket * 0.35;
      ctx.globalAlpha = 0.07 + bucket * 0.07;
      ctx.beginPath();
      for (let k = k0; k <= k1; k++) {
        for (let j = 0; j < 2; j++) {
          const h = hash(seed ^ 0x5e5e, k, j);
          if (h > 0.72) continue;
          const u = frac(g.t * (0.28 + h * 0.3) + hash(seed ^ 0x5e5f, k, j));
          const a = Math.sin(u * Math.PI) * (0.4 + hash(seed ^ 0x5e60, k, j) * 0.6);
          const b = a > 0.66 ? 2 : a > 0.33 ? 1 : 0;
          if (b !== bucket || a < 0.08) continue;
          const d = k * STREAK_SLOT + hash(seed ^ 0x5e61, k, j) * STREAK_SLOT - u * 36;
          const y = g.yOfD(d);
          if (y < -40 || y > g.viewH + 40) continue;
          const l = g.leftAt(y);
          const r = g.rightAt(y);
          const x = l + 10 + (r - l - 20) * hash(seed ^ 0x5e62, k, j);
          const len = 14 + 28 * hash(seed ^ 0x5e63, k, j);
          const sway = (hash(seed ^ 0x5e64, k, j) - 0.5) * 6;
          ctx.moveTo(x, y - len / 2);
          ctx.quadraticCurveTo(x + sway, y, x + sway * 0.3, y + len / 2);
        }
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private drawDecor(g: Gfx, seed: number): void {
    const f = this.f;
    if (!f) return;
    const { ctx } = g;

    // Foam flecks: one path, one fill.
    {
      const [k0, k1] = range(g, FLECK_SLOT, 20);
      ctx.fillStyle = P.foam;
      ctx.globalAlpha = 0.32;
      ctx.beginPath();
      for (let k = k0; k <= k1; k++) {
        const h = hash(seed ^ 0xf1ec, k);
        if (h > 0.55) continue;
        const y = g.yOfD(k * FLECK_SLOT + h * FLECK_SLOT);
        const l = g.leftAt(y);
        const r = g.rightAt(y);
        const x = l + 6 + (r - l - 12) * hash(seed ^ 0xf1ed, k);
        const n = 1 + Math.floor(hash(seed ^ 0xf1ee, k) * 3);
        for (let i = 0; i < n; i++) {
          const rr = 0.8 + hash(seed ^ 0xf1ef, k, i) * 1.1;
          const ox = (hash(seed ^ 0xf1f0, k, i) - 0.5) * 7;
          const oy = (hash(seed ^ 0xf1f1, k, i) - 0.5) * 7;
          ctx.moveTo(x + ox + rr, y + oy);
          ctx.arc(x + ox, y + oy, rr, 0, TAU);
        }
      }
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Lily pads hug the banks, out of the main lane.
    {
      const [k0, k1] = range(g, LILY_SLOT, 40);
      for (let k = k0; k <= k1; k++) {
        for (let side = -1; side <= 1; side += 2) {
          const h = hash(seed ^ 0x1111, k, side);
          if (h > 0.4) continue;
          const y = g.yOfD(k * LILY_SLOT + hash(seed ^ 0x1112, k, side) * LILY_SLOT);
          if (y < -30 || y > g.viewH + 30) continue;
          const edge = side < 0 ? g.leftAt(y) : g.rightAt(y);
          const v = hash(seed ^ 0x1113, k, side);
          const off = 10 + v * 26;
          const s = f.lily[Math.floor(hash(seed ^ 0x1114, k, side) * f.lily.length)];
          const spin = (v - 0.5) * 0.16;
          g.sprite(s, edge - side * off, y, v * TAU + g.t * spin, 0.85 + h * 0.5);
        }
      }
    }

    // Petals drifting anywhere on the river.
    {
      const [k0, k1] = range(g, PETAL_SLOT, 20);
      for (let k = k0; k <= k1; k++) {
        const h = hash(seed ^ 0x2222, k);
        if (h > 0.5) continue;
        const y = g.yOfD(k * PETAL_SLOT + h * PETAL_SLOT);
        if (y < -10 || y > g.viewH + 10) continue;
        const l = g.leftAt(y);
        const r = g.rightAt(y);
        const v = hash(seed ^ 0x2223, k);
        const x = l + 14 + (r - l - 28) * v + Math.sin(g.t * 0.7 + v * 20) * 4;
        const s = f.petal[Math.floor(hash(seed ^ 0x2224, k) * f.petal.length)];
        g.sprite(s, x, y, v * TAU + g.t * (v - 0.5) * 1.2, 1);
      }
    }
  }

  /** Foam lapping the waterline: a solid lip plus a broken, slower line. */
  private drawFoam(g: Gfx): void {
    const { ctx, ys, lw, rw, n, k0, t } = g;
    g.world();
    ctx.strokeStyle = P.foam;
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 2.3;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const w = Math.sin((k0 + i) * 0.9 + t * 2.3) * 0.7;
      if (i === 0) ctx.moveTo(lw[i] + 2.4 + w, ys[i]);
      else ctx.lineTo(lw[i] + 2.4 + w, ys[i]);
    }
    for (let i = 0; i < n; i++) {
      const w = Math.sin((k0 + i) * 0.9 + t * 2.1 + 1.7) * 0.7;
      if (i === 0) ctx.moveTo(rw[i] - 2.4 + w, ys[i]);
      else ctx.lineTo(rw[i] - 2.4 + w, ys[i]);
    }
    ctx.stroke();

    ctx.globalAlpha = 0.3;
    ctx.lineWidth = 1.6;
    ctx.setLineDash(FOAM_DASH);
    ctx.lineDashOffset = (k0 * 8) % 13;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const w = Math.sin((k0 + i) * 0.5 + t * 1.4) * 1.6;
      if (i === 0) ctx.moveTo(lw[i] + 7 + w, ys[i]);
      else ctx.lineTo(lw[i] + 7 + w, ys[i]);
    }
    for (let i = 0; i < n; i++) {
      const w = Math.sin((k0 + i) * 0.5 + t * 1.3 + 2.2) * 1.6;
      if (i === 0) ctx.moveTo(rw[i] - 7 + w, ys[i]);
      else ctx.lineTo(rw[i] - 7 + w, ys[i]);
    }
    ctx.stroke();
    ctx.setLineDash(NO_DASH);
    ctx.globalAlpha = 1;
  }
}

function mod(v: number, m: number): number {
  return ((v % m) + m) % m;
}

function range(g: Gfx, spacing: number, pad: number): [number, number] {
  const dBot = g.dist + g.py - g.viewH - pad;
  const dTop = g.dist + g.py + pad;
  return [Math.floor(dBot / spacing), Math.ceil(dTop / spacing)];
}

/** Both drawn edges as one path. */
function edges(g: Gfx, off: number): void {
  const { ctx, ys, lw, rw, n } = g;
  ctx.beginPath();
  ctx.moveTo(lw[0] + off, ys[0]);
  for (let i = 1; i < n; i++) ctx.lineTo(lw[i] + off, ys[i]);
  ctx.moveTo(rw[0] - off, ys[0]);
  for (let i = 1; i < n; i++) ctx.lineTo(rw[i] - off, ys[i]);
}
