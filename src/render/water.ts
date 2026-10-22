// The river surface: depth gradient, two drifting caustic layers, shallows and
// bank shade, flow streaks, deterministic decorations (lily pads, petals, foam
// flecks) and the foam that laps the waterline. Decorations are deliberately
// light, green or warm and never dark-disc-with-ring shaped, so nothing here can
// be mistaken for a raindrop telegraph.
//
// Zones restyle the same water: a colour wash that follows the zone along the
// river (jade Marsh, dark Rapids, blue-black Night), and per-zone extras that
// fade in with the zone's weight at each river distance: duckweed and many lily
// pads in the Marsh, fast white-water chop and standing waves in the Rapids,
// moon glints at Night. Everything is placed by river distance, so the next
// zone's water is already there as it scrolls into view.

import { WORLD_W } from '../config';
import type { World } from '../types';
import type { FoliageSprites } from './foliage';
import { RIVER_STEP, type Gfx } from './gfx';
import { P, ZONE_TINTS, ZP } from './palette';
import { TAU, frac, hash, makeRand } from './util';
import { EdgeWeights, frameLook, strokeWeighted, ZoneWash, type ZoneLook } from './zonelook';

const STREAK_SLOT = 19;
const LILY_SLOT = 62;
const PETAL_SLOT = 44;
const FLECK_SLOT = 17;
const FOAM_DASH = [4, 9];
const BUBBLE_DASH = [0.1, 7];
const CHOP_SLOT = 15;
const CREST_SLOT = 62;
const GLINT_SLOT = 20;
const DUCK_SLOT = 13;
const MARSH_LILY_SLOT = 26;
const MARSH_FAR_LILY_SLOT = 88;
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
  private wash = new ZoneWash(ZONE_TINTS.water);
  private rapids = new EdgeWeights();
  private marsh = new EdgeWeights();
  /** Surface drift clock: runs faster in the Rapids and slower in the Marsh, without ever jumping. */
  private flow = 0;

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
    const look = frameLook(g);
    this.flow += g.dt * (1 + 2.4 * look.weightAt('rapids', g.dist) - 0.4 * look.weightAt('marsh', g.dist));
    g.world();
    this.drawSurface(g);
    this.rapids.fill(g, look, 'rapids');
    this.marsh.fill(g, look, 'marsh');

    // Shallows along each bank, then the bank's own shade at the very edge.
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
    // The zone's colour over all of it (Jungle water is the baseline), blended along the river.
    this.wash.fillRect(g, look, -30, -30, WORLD_W + 60, g.viewH + 60);
    if (this.marsh.any) {
      // Marsh banks shelve gently: a broad, pale band of shallows.
      ctx.lineCap = 'butt';
      ctx.strokeStyle = ZP.marshShallow;
      ctx.lineWidth = 78;
      strokeWeighted(g, this.marsh, 0, 0, 0.16);
      ctx.lineCap = 'round';
    }

    this.drawStreaks(g, seed, look);
    this.drawDecor(g, seed, look);
    if (this.marsh.any) this.drawMarsh(g, seed, look);
    if (this.rapids.any) this.drawWhitewater(g, seed, look);
    if (look.involves('night')) this.drawGlints(g, seed, look);
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
      m.f = g.alignY(mod(anchor + this.flow * 7, this.base.height / k));
      this.basePattern.setTransform(m);
      ctx.fillStyle = this.basePattern;
      ctx.fillRect(-30, -30, WORLD_W + 60, g.viewH + 60);
    } else {
      ctx.fillStyle = P.waterMid;
      ctx.fillRect(-30, -30, WORLD_W + 60, g.viewH + 60);
    }
    if (this.c2 && this.c2Pattern) {
      m.e = g.alignX(70 + Math.cos(g.t * 0.27) * 9);
      m.f = g.alignY(mod(anchor - this.flow * 5, this.c2.height / k));
      this.c2Pattern.setTransform(m);
      ctx.fillStyle = this.c2Pattern;
      ctx.globalAlpha = 0.045;
      ctx.fillRect(0, -10, WORLD_W, g.viewH + 20);
      ctx.globalAlpha = 1;
    }
  }

  /**
   * Flow streaks: each lives in its slot and slides downstream while fading in
   * and out, so none ever pops. In the Rapids there are more of them, longer,
   * brighter and sliding much faster; in the Marsh fewer and lazier.
   */
  private drawStreaks(g: Gfx, seed: number, look: ZoneLook): void {
    const { ctx } = g;
    const [k0, k1] = range(g, STREAK_SLOT, 70);
    ctx.lineCap = 'round';
    ctx.strokeStyle = P.foam;
    for (let bucket = 0; bucket < 3; bucket++) {
      ctx.lineWidth = 1.2 + bucket * 0.35;
      ctx.globalAlpha = 0.07 + bucket * 0.07;
      ctx.beginPath();
      for (let k = k0; k <= k1; k++) {
        const wr = look.weightAt('rapids', k * STREAK_SLOT + STREAK_SLOT / 2);
        const wm = look.weightAt('marsh', k * STREAK_SLOT + STREAK_SLOT / 2);
        for (let j = 0; j < 3; j++) {
          const h = hash(seed ^ 0x5e5e, k, j);
          // The third streak per slot exists only in white water.
          if (j === 2 ? h > wr * 0.8 : h > 0.72 + 0.26 * wr - 0.22 * wm) continue;
          const u = frac(g.t * (0.28 + h * 0.3) * (1 + 1.9 * wr - 0.4 * wm) + hash(seed ^ 0x5e5f, k, j));
          const a = Math.sin(u * Math.PI) * (0.4 + hash(seed ^ 0x5e60, k, j) * 0.6) * (1 + 0.9 * wr);
          const b = a > 0.66 ? 2 : a > 0.33 ? 1 : 0;
          if (b !== bucket || a < 0.08) continue;
          const d = k * STREAK_SLOT + hash(seed ^ 0x5e61, k, j) * STREAK_SLOT - u * (36 + 100 * wr);
          const y = g.yOfD(d);
          if (y < -70 || y > g.viewH + 70) continue;
          const l = g.leftAt(y);
          const r = g.rightAt(y);
          const x = l + 10 + (r - l - 20) * hash(seed ^ 0x5e62, k, j);
          const len = (14 + 28 * hash(seed ^ 0x5e63, k, j)) * (1 + 0.35 * wr);
          const sway = (hash(seed ^ 0x5e64, k, j) - 0.5) * 6;
          ctx.moveTo(x, y - len / 2);
          ctx.quadraticCurveTo(x + sway, y, x + sway * 0.3, y + len / 2);
        }
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private drawDecor(g: Gfx, seed: number, look: ZoneLook): void {
    const f = this.f;
    if (!f) return;
    const { ctx } = g;

    // Foam flecks: one path, one fill. Plentiful in the Rapids.
    {
      const [k0, k1] = range(g, FLECK_SLOT, 20);
      ctx.fillStyle = P.foam;
      ctx.globalAlpha = 0.32;
      ctx.beginPath();
      for (let k = k0; k <= k1; k++) {
        const h = hash(seed ^ 0xf1ec, k);
        const wr = look.weightAt('rapids', k * FLECK_SLOT);
        if (h > 0.55 + 0.4 * wr) continue;
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

    // Lily pads hug the banks, out of the main lane (rare in white water).
    {
      const [k0, k1] = range(g, LILY_SLOT, 40);
      for (let k = k0; k <= k1; k++) {
        const wr = look.weightAt('rapids', k * LILY_SLOT);
        const keep = 0.4 * (1 - 0.9 * wr);
        for (let side = -1; side <= 1; side += 2) {
          const h = hash(seed ^ 0x1111, k, side);
          if (h > keep) continue;
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
        const wr = look.weightAt('rapids', k * PETAL_SLOT);
        if (h > 0.5 * (1 - 0.8 * wr)) continue;
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

  /**
   * Lily Marsh water: a skin of duckweed, a crowd of small lily pads and lotus
   * blooms along the banks and a few out in the open. All smaller than the
   * big bumper pads (which have a notch and a pale rim), and never dark discs.
   */
  private drawMarsh(g: Gfx, seed: number, look: ZoneLook): void {
    const f = this.f;
    if (!f) return;
    const { ctx } = g;
    g.world();

    // Duckweed: tiny pale-green specks in loose clusters.
    {
      const [k0, k1] = range(g, DUCK_SLOT, 16);
      ctx.fillStyle = ZP.duckweed;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      for (let k = k0; k <= k1; k++) {
        const h = hash(seed ^ 0xd0c1, k);
        if (h > 0.7 * look.weightAt('marsh', k * DUCK_SLOT)) continue;
        const y = g.yOfD(k * DUCK_SLOT + h * DUCK_SLOT);
        const l = g.leftAt(y);
        const r = g.rightAt(y);
        // Clusters gather towards the banks.
        const e = hash(seed ^ 0xd0c2, k);
        const side = e < 0.5 ? 0 : 1;
        const near = (e * 2 - side) ** 1.6 * 0.5;
        const x = side ? r - 4 - near * (r - l) : l + 4 + near * (r - l);
        const n = 3 + Math.floor(hash(seed ^ 0xd0c3, k) * 4);
        for (let i = 0; i < n; i++) {
          const rr = 0.7 + hash(seed ^ 0xd0c4, k, i) * 1.1;
          const ox = (hash(seed ^ 0xd0c5, k, i) - 0.5) * 12;
          const oy = (hash(seed ^ 0xd0c6, k, i) - 0.5) * 9;
          ctx.moveTo(x + ox + rr, y + oy);
          ctx.arc(x + ox, y + oy, rr, 0, TAU);
        }
      }
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Lily pads and lotus blooms: dense near the banks, rare in the lane.
    {
      const [k0, k1] = range(g, MARSH_LILY_SLOT, 36);
      for (let k = k0; k <= k1; k++) {
        const wm = look.weightAt('marsh', k * MARSH_LILY_SLOT);
        if (wm <= 0) continue;
        for (let side = -1; side <= 1; side += 2) {
          const h = hash(seed ^ 0x3a31, k, side);
          if (h > 0.9 * wm) continue;
          const y = g.yOfD(k * MARSH_LILY_SLOT + hash(seed ^ 0x3a32, k, side) * MARSH_LILY_SLOT);
          if (y < -30 || y > g.viewH + 30) continue;
          const edge = side < 0 ? g.leftAt(y) : g.rightAt(y);
          const v = hash(seed ^ 0x3a33, k, side);
          const off = 6 + v * v * 74;
          const pick = hash(seed ^ 0x3a34, k, side);
          // Plain pads most often, blooms and clusters for colour.
          const s = pick < 0.4 ? f.lily[0] : pick < 0.62 ? f.lily[3] : pick < 0.82 ? f.lily[1] : f.lily[2];
          const spin = (v - 0.5) * 0.12;
          g.sprite(s, edge - side * off, y, v * TAU + g.t * spin, 0.72 + h * 0.5);
        }
      }
      // A few small ones in the open water, smaller than a bumper pad.
      const [m0, m1] = range(g, MARSH_FAR_LILY_SLOT, 30);
      for (let k = m0; k <= m1; k++) {
        const wm = look.weightAt('marsh', k * MARSH_FAR_LILY_SLOT);
        const h = hash(seed ^ 0x3a41, k);
        if (h > 0.55 * wm) continue;
        const y = g.yOfD(k * MARSH_FAR_LILY_SLOT + hash(seed ^ 0x3a42, k) * MARSH_FAR_LILY_SLOT);
        if (y < -30 || y > g.viewH + 30) continue;
        const l = g.leftAt(y);
        const r = g.rightAt(y);
        const v = hash(seed ^ 0x3a43, k);
        const s = f.lily[hash(seed ^ 0x3a44, k) < 0.35 ? 1 : 0];
        g.sprite(s, l + 30 + (r - l - 60) * v, y, v * TAU + g.t * (v - 0.5) * 0.1, 0.62 + h * 0.3);
      }
    }
  }

  /**
   * Rapids water: patches of white water (clusters of curled foam dashes with
   * froth bubbles) that rush down the screen, and bold standing-wave crests.
   * Density follows the Rapids weight at each slot, so the white water builds up
   * as the zone approaches and thins out as it ends.
   */
  private drawWhitewater(g: Gfx, seed: number, look: ZoneLook): void {
    const { ctx } = g;
    g.world();
    ctx.lineCap = 'round';
    ctx.strokeStyle = ZP.spray;
    ctx.fillStyle = ZP.spray;
    // Patches: three alpha buckets, one path each. A patch is 3-5 dashes close together.
    const [k0, k1] = range(g, CHOP_SLOT, 80);
    for (let bucket = 0; bucket < 3; bucket++) {
      ctx.lineWidth = 2.8 + bucket * 0.8;
      ctx.globalAlpha = 0.2 + bucket * 0.15;
      ctx.beginPath();
      for (let k = k0; k <= k1; k++) {
        const wr = look.weightAt('rapids', k * CHOP_SLOT);
        if (wr <= 0) continue;
        const h = hash(seed ^ 0xc40b, k);
        if (h > wr * 0.7) continue;
        const u = frac(g.t * (0.7 + hash(seed ^ 0xc40c, k) * 0.7) + hash(seed ^ 0xc40d, k));
        const a = Math.sin(u * Math.PI);
        const b = a > 0.7 ? 2 : a > 0.35 ? 1 : 0;
        if (b !== bucket || a < 0.1) continue;
        const cy = g.yOfD(k * CHOP_SLOT + hash(seed ^ 0xc40e, k) * CHOP_SLOT - u * 130);
        if (cy < -50 || cy > g.viewH + 50) continue;
        const l = g.leftAt(cy);
        const r = g.rightAt(cy);
        // Everywhere on the river, but rougher towards the banks.
        const e = hash(seed ^ 0xc40f, k);
        const q = hash(seed ^ 0xc412, k);
        const cx = e < 0.4 ? l + 10 + q * (r - l - 20) : e < 0.7 ? l + 8 + q * q * (r - l) * 0.4 : r - 8 - q * q * (r - l) * 0.4;
        const n = 3 + Math.floor(hash(seed ^ 0xc413, k) * 3);
        for (let i = 0; i < n; i++) {
          const ox = (hash(seed ^ 0xc414, k, i) - 0.5) * 16;
          const oy = (hash(seed ^ 0xc415, k, i) - 0.5) * 22;
          const len = 5 + hash(seed ^ 0xc410, k, i) * 12;
          const curl = (hash(seed ^ 0xc411, k, i) - 0.5) * 10;
          const x = cx + ox;
          const y = cy + oy;
          ctx.moveTo(x, y - len / 2);
          ctx.quadraticCurveTo(x + curl, y, x - curl * 0.3, y + len / 2);
        }
      }
      ctx.stroke();
    }

    // Froth: bubbles scattered around the patches, one fill.
    ctx.globalAlpha = 0.42;
    ctx.beginPath();
    for (let k = k0; k <= k1; k++) {
      const wr = look.weightAt('rapids', k * CHOP_SLOT);
      if (wr <= 0) continue;
      const h = hash(seed ^ 0xc420, k);
      if (h > wr * 0.8) continue;
      const y = g.yOfD(k * CHOP_SLOT + hash(seed ^ 0xc421, k) * CHOP_SLOT - frac(g.t * 0.35 + h) * 40);
      if (y < -20 || y > g.viewH + 20) continue;
      const l = g.leftAt(y);
      const r = g.rightAt(y);
      const near = hash(seed ^ 0xc422, k);
      const x = near < 0.5 ? l + 6 + hash(seed ^ 0xc423, k) ** 2 * (r - l) * 0.5 : r - 6 - hash(seed ^ 0xc423, k) ** 2 * (r - l) * 0.5;
      for (let i = 0; i < 4; i++) {
        const rr = 0.9 + hash(seed ^ 0xc424, k, i) * 1.8;
        const px = x + (hash(seed ^ 0xc425, k, i) - 0.5) * 14;
        const py = y + (hash(seed ^ 0xc426, k, i) - 0.5) * 12;
        ctx.moveTo(px + rr, py);
        ctx.arc(px, py, rr, 0, TAU);
      }
    }
    ctx.fill();

    // Standing waves: bold crescents across the stream that rush by.
    const [c0, c1] = range(g, CREST_SLOT, 50);
    for (let bucket = 0; bucket < 2; bucket++) {
      ctx.lineWidth = 2.4 + bucket * 1;
      ctx.globalAlpha = 0.24 + bucket * 0.18;
      ctx.beginPath();
      for (let k = c0; k <= c1; k++) {
        const wr = look.weightAt('rapids', k * CREST_SLOT);
        if (wr <= 0) continue;
        for (let j = 0; j < 2; j++) {
          const h = hash(seed ^ 0xc5e1, k, j);
          if (h > wr * 0.9) continue;
          const u = frac(g.t * (0.3 + hash(seed ^ 0xc5e2, k, j) * 0.25) + hash(seed ^ 0xc5e3, k, j));
          const a = Math.sin(u * Math.PI);
          if ((a > 0.6 ? 1 : 0) !== bucket || a < 0.12) continue;
          const y = g.yOfD(k * CREST_SLOT + hash(seed ^ 0xc5e4, k, j) * CREST_SLOT - u * 150);
          if (y < -30 || y > g.viewH + 30) continue;
          const l = g.leftAt(y);
          const r = g.rightAt(y);
          const w = 20 + hash(seed ^ 0xc5e5, k, j) * 28;
          const x = l + 16 + w / 2 + (r - l - 32 - w) * hash(seed ^ 0xc5e6, k, j);
          ctx.moveTo(x - w / 2, y + 4);
          ctx.quadraticCurveTo(x, y - 8, x + w / 2, y + 4);
        }
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Moon glints at Night: tiny horizontal sparkles that pulse in and out on the
   * dark water, gathered loosely along a moon path that wanders down the
   * river. They are lit by the pool of light like everything else; beyond it
   * only their faint remains show, which is exactly the point of the dark.
   * Reduced motion holds them at a steady glimmer instead of pulsing.
   */
  private drawGlints(g: Gfx, seed: number, look: ZoneLook): void {
    const { ctx } = g;
    g.world();
    const [k0, k1] = range(g, GLINT_SLOT, 30);
    ctx.lineCap = 'round';
    ctx.strokeStyle = ZP.moonGlint;
    for (let bucket = 0; bucket < 2; bucket++) {
      ctx.lineWidth = bucket ? 1.7 : 1.1;
      ctx.globalAlpha = bucket ? 0.9 : 0.4;
      ctx.beginPath();
      for (let k = k0; k <= k1; k++) {
        const wn = look.weightAt('night', k * GLINT_SLOT);
        if (wn <= 0) continue;
        for (let j = 0; j < 2; j++) {
          const h = hash(seed ^ 0x61a7, k, j);
          if (h > 0.8 * wn) continue;
          const ph = hash(seed ^ 0x61a8, k, j);
          const tw = g.reduced ? 0.45 : Math.max(0, Math.sin(g.t * (0.6 + ph * 1.3) + ph * TAU)) ** 3;
          if (tw < 0.06 || (tw > 0.55 ? 1 : 0) !== bucket) continue;
          const d = k * GLINT_SLOT + hash(seed ^ 0x61a9, k, j) * GLINT_SLOT;
          const y = g.yOfD(d);
          if (y < -10 || y > g.viewH + 10) continue;
          const l = g.leftAt(y);
          const r = g.rightAt(y);
          const along = hash(seed ^ 0x61aa, k, j);
          // 55% gather on the moon path, the rest anywhere.
          const path = (l + r) / 2 + Math.sin(d * 0.004 + 1.7) * (r - l) * 0.22;
          const x = along < 0.55 ? path + (hash(seed ^ 0x61ab, k, j) - 0.5) * 70 : l + 8 + (r - l - 16) * hash(seed ^ 0x61ac, k, j);
          const len = 2.5 + hash(seed ^ 0x61ad, k, j) * 5 * (bucket ? 1.3 : 1);
          ctx.moveTo(x - len / 2, y);
          ctx.lineTo(x + len / 2, y);
        }
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
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
    // Anchored to the river (the path starts at sample k0) so the dashes scroll with the water.
    ctx.lineDashOffset = (k0 * RIVER_STEP) % 13;
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

    if (this.rapids.any) {
      // White water piles up against the banks: a thick, ragged foam band.
      ctx.strokeStyle = ZP.spray;
      ctx.lineCap = 'butt';
      ctx.lineWidth = 5.5;
      strokeWeighted(g, this.rapids, 5.2, -5.2, 0.3);
      // A line of foam bubbles: round dots along the band, drifting downstream.
      ctx.lineCap = 'round';
      ctx.lineWidth = 3.2;
      ctx.setLineDash(BUBBLE_DASH);
      ctx.lineDashOffset = ((k0 * RIVER_STEP) % 7.1) + t * 14;
      strokeWeighted(g, this.rapids, 10, -10, 0.55);
      ctx.setLineDash(NO_DASH);
    }
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
