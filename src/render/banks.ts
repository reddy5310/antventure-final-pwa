// River banks and the jungle beyond them. Everything is placed by river
// distance (hash of seed + slot index) so it scrolls exactly with the water and
// is identical for every player on the same seed (the Daily River looks the same
// for everyone).
//
// Zones restyle the banks: a floor wash that follows the zone along the river,
// and a planting recipe per zone (Marsh: reeds, grass and flowers, softer and
// lower; Rapids: boulders and pebbles; Night: the Jungle, in the dark). Each
// plant slot picks its recipe from the zone at its own river distance, dithered
// across the 12 m transition, so the vegetation changes character gradually as
// the next zone scrolls into view.

import { WORLD_W } from '../config';
import type { World, ZoneId } from '../types';
import type { FoliageSprites, Tile } from './foliage';
import type { Gfx, Sprite } from './gfx';
import { P, ZONE_TINTS, ZP } from './palette';
import { TAU, hash } from './util';
import { EdgeWeights, frameLook, strokeWeighted, ZoneWash, type ZoneLook } from './zonelook';

/** Slot spacing (river units) of the edge, inner and far foliage rows. */
const ROW_A = 15;
const ROW_B = 26;
const ROW_C = 84;

/** What a planting slot can be; each recipe is a cumulative table of these. */
type Plant =
  | 'fern'
  | 'grass'
  | 'grass2'
  | 'broadleaf'
  | 'flowers'
  | 'monstera'
  | 'palm'
  | 'canopy'
  | 'pebbles'
  | 'mushrooms'
  | 'reed'
  | 'boulder';

/** Share of slots left empty (`skip`), then cumulative cut points over [0, 1] mapped to plants. */
interface Recipe {
  skip: number;
  cut: readonly number[];
  plant: readonly Plant[];
}

const JUNGLE_EDGE: Recipe = {
  skip: 0.86,
  cut: [0.24, 0.42, 0.58, 0.7, 0.84, 0.92, 1],
  plant: ['fern', 'grass', 'broadleaf', 'flowers', 'pebbles', 'grass2', 'mushrooms'],
};
const JUNGLE_INNER: Recipe = {
  skip: 0.8,
  cut: [0.3, 0.46, 0.6, 0.74, 0.9, 1],
  plant: ['broadleaf', 'monstera', 'fern', 'flowers', 'palm', 'canopy'],
};

/** Edge (waterline) and inner (a little back) recipes per zone. Night is the Jungle in the dark. */
const EDGE: Record<ZoneId, Recipe> = {
  jungle: JUNGLE_EDGE,
  night: JUNGLE_EDGE,
  marsh: {
    skip: 0.93,
    cut: [0.34, 0.54, 0.64, 0.74, 0.82, 0.88, 0.94, 1],
    plant: ['reed', 'grass', 'flowers', 'grass2', 'fern', 'broadleaf', 'pebbles', 'mushrooms'],
  },
  rapids: {
    skip: 0.8,
    cut: [0.38, 0.62, 0.72, 0.8, 0.88, 0.94, 1],
    plant: ['pebbles', 'boulder', 'grass', 'fern', 'broadleaf', 'flowers', 'mushrooms'],
  },
};
const INNER: Record<ZoneId, Recipe> = {
  jungle: JUNGLE_INNER,
  night: JUNGLE_INNER,
  marsh: {
    skip: 0.76,
    cut: [0.34, 0.52, 0.68, 0.78, 0.9, 1],
    plant: ['reed', 'broadleaf', 'flowers', 'fern', 'palm', 'canopy'],
  },
  rapids: {
    skip: 0.78,
    cut: [0.28, 0.44, 0.58, 0.74, 0.88, 1],
    plant: ['boulder', 'fern', 'broadleaf', 'pebbles', 'palm', 'canopy'],
  },
};

function plantOf(r: Recipe, t: number): Plant {
  for (let i = 0; i < r.cut.length; i++) if (t < r.cut[i]) return r.plant[i];
  return r.plant[r.plant.length - 1];
}

export class Banks {
  private f: FoliageSprites | null = null;
  private tile: Tile | null = null;
  private pattern: CanvasPattern | null = null;
  private m = new DOMMatrix();
  private shadeL: CanvasGradient | null = null;
  private shadeR: CanvasGradient | null = null;
  private floor = new ZoneWash(ZONE_TINTS.floor);
  private grade = new ZoneWash(ZONE_TINTS.grade);
  private marsh = new EdgeWeights();
  private rapids = new EdgeWeights();
  private night = new EdgeWeights();

  build(ctx: CanvasRenderingContext2D, foliage: FoliageSprites, tile: Tile): void {
    this.f = foliage;
    this.tile = tile;
    this.pattern = ctx.createPattern(tile.img, 'repeat');
    // Darken the far jungle on wide screens so the playfield column reads first.
    const l = ctx.createLinearGradient(-6, 0, -380, 0);
    l.addColorStop(0, 'rgba(3, 12, 8, 0)');
    l.addColorStop(0.35, 'rgba(3, 12, 8, 0.28)');
    l.addColorStop(1, 'rgba(3, 12, 8, 0.62)');
    const r = ctx.createLinearGradient(WORLD_W + 6, 0, WORLD_W + 380, 0);
    r.addColorStop(0, 'rgba(3, 12, 8, 0)');
    r.addColorStop(0.35, 'rgba(3, 12, 8, 0.28)');
    r.addColorStop(1, 'rgba(3, 12, 8, 0.62)');
    this.shadeL = l;
    this.shadeR = r;
  }

  draw(g: Gfx, world: World): void {
    const { f, tile, pattern } = this;
    if (!f || !tile) return;
    const { ctx } = g;
    const look = frameLook(g);
    g.world();

    // Jungle floor: both banks in one path, one pattern fill.
    this.floorPath(g);
    if (pattern) {
      // 1:1 device-pixel mapping (the tile was rendered at this frame's scale).
      const inv = 1 / g.k;
      const period = tile.img.height / g.k;
      const m = this.m;
      m.a = inv;
      m.b = 0;
      m.c = 0;
      m.d = inv;
      m.e = g.alignX(0);
      m.f = g.alignY((g.py + g.dist) % period);
      pattern.setTransform(m);
      ctx.fillStyle = pattern;
    } else {
      ctx.fillStyle = P.jungleDark;
    }
    ctx.fill();
    // The zone's floor colour over the same path (leaf litter becomes marsh
    // grass, gravel or moonlit shade).
    this.floor.fillPath(g, look);

    // Mud lip and the wet line right at the waterline.
    ctx.lineJoin = 'round';
    ctx.strokeStyle = P.mud;
    ctx.lineWidth = 9;
    this.edges(g, -4.2, 4.2);
    ctx.stroke();
    this.drawLips(g, look);
    ctx.strokeStyle = P.mudWet;
    ctx.lineWidth = 2.6;
    this.edges(g, -0.6, 0.6);
    ctx.stroke();

    const seed = world.seed;
    const wide = g.viewL < -24 || g.viewR > WORLD_W + 24;
    if (wide) this.drawFar(g, f, seed, look);
    this.drawInner(g, f, seed, look);
    this.drawEdge(g, f, seed, look);

    if (this.grade.visible(look)) {
      this.floorPath(g);
      this.grade.fillPath(g, look);
    }
  }

  /** The ground beyond both banks as one path (fill only: it is device-space once built). */
  private floorPath(g: Gfx): void {
    const { ctx, ys, lw, rw, n } = g;
    g.world();
    const xl = g.viewL - 40;
    const xr = g.viewR + 40;
    ctx.beginPath();
    ctx.moveTo(xl, ys[0]);
    for (let i = 0; i < n; i++) ctx.lineTo(lw[i], ys[i]);
    ctx.lineTo(xl, ys[n - 1]);
    ctx.closePath();
    ctx.moveTo(xr, ys[0]);
    for (let i = 0; i < n; i++) ctx.lineTo(rw[i], ys[i]);
    ctx.lineTo(xr, ys[n - 1]);
    ctx.closePath();
  }

  /**
   * Zone shorelines over the Jungle mud lip, fading in along the river: soft
   * green marsh mud, a stony gravel bank with pale pebbles for the Rapids, and
   * a cold blue-black edge at Night.
   */
  private drawLips(g: Gfx, look: ZoneLook): void {
    const { ctx } = g;
    this.marsh.fill(g, look, 'marsh');
    this.rapids.fill(g, look, 'rapids');
    this.night.fill(g, look, 'night');
    ctx.lineCap = 'butt';
    if (this.marsh.any) {
      ctx.strokeStyle = ZP.marshLip;
      ctx.lineWidth = 11;
      strokeWeighted(g, this.marsh, -4.6, 4.6, 0.85);
      // A soft reed-green blush spilling onto the water: no hard mud line.
      ctx.strokeStyle = ZP.marshShallow;
      ctx.lineWidth = 9;
      strokeWeighted(g, this.marsh, 5, -5, 0.2);
    }
    if (this.rapids.any) {
      ctx.strokeStyle = ZP.gravel;
      ctx.lineWidth = 11;
      strokeWeighted(g, this.rapids, -4.8, 4.8, 0.95);
      ctx.strokeStyle = ZP.gravelLight;
      ctx.lineWidth = 2.6;
      ctx.setLineDash(GRAVEL_DASH);
      strokeWeighted(g, this.rapids, -3.4, 3.4, 0.75);
      ctx.setLineDash(NO_DASH);
    }
    if (this.night.any) {
      ctx.strokeStyle = ZP.nightBank;
      ctx.lineWidth = 11;
      strokeWeighted(g, this.night, -4.6, 4.6, 0.8);
    }
    ctx.lineCap = 'round';
  }

  /** Both bank edges as one path, offset outward by the given amounts. */
  private edges(g: Gfx, dl: number, dr: number): void {
    const { ctx, ys, lw, rw, n } = g;
    ctx.beginPath();
    ctx.moveTo(lw[0] + dl, ys[0]);
    for (let i = 1; i < n; i++) ctx.lineTo(lw[i] + dl, ys[i]);
    ctx.moveTo(rw[0] + dr, ys[0]);
    for (let i = 1; i < n; i++) ctx.lineTo(rw[i] + dr, ys[i]);
  }

  private slotRange(g: Gfx, spacing: number, pad: number): [number, number] {
    const dBot = g.dist + g.py - g.viewH - pad;
    const dTop = g.dist + g.py + pad;
    return [Math.floor(dBot / spacing), Math.ceil(dTop / spacing)];
  }

  /** Tree canopies filling the extra width of desktop / landscape screens. */
  private drawFar(g: Gfx, f: FoliageSprites, seed: number, look: ZoneLook): void {
    const { ctx } = g;
    const [k0, k1] = this.slotRange(g, ROW_C, 80);
    for (let k = k0; k <= k1; k++) {
      for (let side = -1; side <= 1; side += 2) {
        for (let col = 0; col < 12; col++) {
          const h = hash(seed ^ 0xc0ffee, k, side * 31 + col);
          const d = k * ROW_C + h * ROW_C * 0.7 + (col % 2) * ROW_C * 0.5;
          const y = g.yOfD(d);
          if (y < -80 || y > g.viewH + 80) continue;
          const edge = side < 0 ? g.leftDrawnAt(y) : g.rightDrawnAt(y);
          // Sparse on purpose: the floor pattern already textures this area, so
          // canopies only need to break up its repetition (overdraw ~1.2x, not 4x).
          const off = 74 + col * 100 + hash(seed, k, col + 7) * 34;
          const x = edge + side * off;
          if (side < 0 ? x < g.viewL - 70 : x > g.viewR + 70) break;
          const pickU = hash(seed, k, col + 99);
          const sizeU = hash(seed, k, col + 77);
          const rot = hash(seed, k, col + 51) * TAU;
          // The far ground follows the zone too: low reeds and broadleaf in the
          // Marsh, boulders and ferns on the stony Rapids banks, canopy elsewhere.
          const zone = look.pickAt(d, hash(seed ^ 0xfa2, k, side * 31 + col));
          if (zone === 'marsh' && pickU < 0.72) {
            g.sprite(pickU < 0.4 ? pick(f.reed, sizeU) : pick(f.broadleaf, sizeU), x, y, rot, 2.1 + sizeU * 0.8);
          } else if (zone === 'rapids' && pickU < 0.72) {
            g.sprite(pickU < 0.42 ? pick(f.boulder, sizeU) : pick(f.fern, sizeU), x, y, rot, pickU < 0.42 ? 2.2 + sizeU * 1.1 : 2.1 + sizeU * 0.6);
          } else {
            g.sprite(f.canopy[Math.floor(pickU * f.canopy.length)], x, y, rot, 1.05 + sizeU * 0.45);
          }
        }
      }
    }
    g.world();
    if (g.viewL < -6 && this.shadeL) {
      ctx.fillStyle = this.shadeL;
      ctx.fillRect(g.viewL - 40, -40, -6 - (g.viewL - 40), g.viewH + 80);
    }
    if (g.viewR > WORLD_W + 6 && this.shadeR) {
      ctx.fillStyle = this.shadeR;
      ctx.fillRect(WORLD_W + 6, -40, g.viewR + 40 - (WORLD_W + 6), g.viewH + 80);
    }
  }

  /** Larger plants a little back from the water. */
  private drawInner(g: Gfx, f: FoliageSprites, seed: number, look: ZoneLook): void {
    const [k0, k1] = this.slotRange(g, ROW_B, 60);
    for (let k = k0; k <= k1; k++) {
      for (let side = -1; side <= 1; side += 2) {
        const d = k * ROW_B + hash(seed ^ 0xb1, k, side) * ROW_B * 0.7;
        const recipe = INNER[look.pickAt(d, hash(seed ^ 0xb6, k, side))];
        const h = hash(seed ^ 0xb0b0, k, side);
        if (h > recipe.skip) continue;
        const y = g.yOfD(d);
        if (y < -60 || y > g.viewH + 60) continue;
        const edge = side < 0 ? g.leftDrawnAt(y) : g.rightDrawnAt(y);
        const t = hash(seed ^ 0xb2, k, side);
        const v = hash(seed ^ 0xb3, k, side);
        const rot = hash(seed ^ 0xb4, k, side) * TAU;
        const flip = v < 0.5;
        let s: Sprite;
        let scale: number;
        let off: number;
        let angle = rot;
        switch (plantOf(recipe, t)) {
          case 'broadleaf':
            s = pick(f.broadleaf, v);
            scale = 1.05 + v * 0.35;
            off = 24 + v * 26;
            break;
          case 'monstera':
            s = pick(f.monstera, v);
            scale = 0.9 + v * 0.3;
            off = 28 + v * 22;
            break;
          case 'fern':
            s = pick(f.fern, v);
            scale = 1.1 + v * 0.3;
            off = 24 + v * 24;
            break;
          case 'flowers':
            s = pick(f.flowers, hash(seed ^ 0xb5, k, side));
            scale = 1 + v * 0.25;
            off = 20 + v * 22;
            break;
          case 'palm':
            // Palm fronds lean out over the water a little.
            s = pick(f.palm, v);
            scale = 0.85 + v * 0.25;
            off = s.w * scale * 0.5 - 6 - v * 6;
            angle = (side < 0 ? 0 : Math.PI) + (rot / TAU - 0.5) * 0.9;
            break;
          case 'reed':
            s = pick(f.reed, v);
            scale = 1.15 + v * 0.55;
            off = 20 + v * 26;
            break;
          case 'boulder':
            s = pick(f.boulder, v);
            scale = 1.1 + v * 0.7;
            off = 24 + v * 24;
            break;
          case 'pebbles':
            s = pick(f.pebbles, v);
            scale = 1.2 + v * 0.5;
            off = 20 + v * 22;
            break;
          default:
            s = pick(f.canopy, v);
            scale = 0.6 + v * 0.2;
            off = 40 + v * 20;
        }
        g.sprite(s, edge + side * off, y, angle, scale, flip);
      }
    }
  }

  /** Small plants, pebbles and roots right on the waterline. */
  private drawEdge(g: Gfx, f: FoliageSprites, seed: number, look: ZoneLook): void {
    const [k0, k1] = this.slotRange(g, ROW_A, 40);
    for (let k = k0; k <= k1; k++) {
      for (let side = -1; side <= 1; side += 2) {
        const d = k * ROW_A + hash(seed ^ 0xa1, k, side) * ROW_A * 0.8;
        const recipe = EDGE[look.pickAt(d, hash(seed ^ 0xa6, k, side))];
        const h = hash(seed ^ 0xa0a0, k, side);
        if (h > recipe.skip) continue;
        const y = g.yOfD(d);
        if (y < -40 || y > g.viewH + 40) continue;
        const edge = side < 0 ? g.leftDrawnAt(y) : g.rightDrawnAt(y);
        const t = hash(seed ^ 0xa2, k, side);
        const v = hash(seed ^ 0xa3, k, side);
        const rot = hash(seed ^ 0xa4, k, side) * TAU;
        const flip = v > 0.5;
        let s: Sprite;
        let scale: number;
        // How far the sprite's centre sits back from the edge, as a fraction of its radius.
        let back: number;
        switch (plantOf(recipe, t)) {
          case 'fern':
            s = pick(f.fern, v);
            scale = 0.7 + v * 0.3;
            back = 0.62 + v * 0.3;
            break;
          case 'grass':
            s = pick(f.grass, v);
            scale = 0.8 + v * 0.4;
            back = 0.45 + v * 0.3;
            break;
          case 'broadleaf':
            s = pick(f.broadleaf, v);
            scale = 0.62 + v * 0.26;
            back = 0.62 + v * 0.3;
            break;
          case 'flowers':
            s = pick(f.flowers, hash(seed ^ 0xa5, k, side));
            scale = 0.72 + v * 0.26;
            back = 0.7 + v * 0.3;
            break;
          case 'pebbles':
            // Pebbles sit on the waterline. (No roots or sticks poking into the
            // water here: they read as twig hazards.)
            s = pick(f.pebbles, v);
            scale = 0.85 + v * 0.4;
            back = 0.25 + v * 0.25;
            break;
          case 'grass2':
            s = pick(f.grass, 1 - v);
            scale = 0.9 + v * 0.3;
            back = 0.7 + v * 0.3;
            break;
          case 'reed':
            // Reeds stand with their feet in the shallows.
            s = pick(f.reed, v);
            scale = 0.85 + v * 0.45;
            back = 0.3 + v * 0.35;
            break;
          case 'boulder':
            s = pick(f.boulder, v);
            scale = 0.85 + v * 0.45;
            back = 0.55 + v * 0.3;
            break;
          default:
            s = pick(f.mushrooms, v);
            scale = 0.9 + v * 0.3;
            back = 1.1 + v * 0.5;
        }
        const r = s.w * scale * 0.5;
        g.sprite(s, edge + side * r * back, y, rot, scale, flip);
      }
    }
  }
}

const GRAVEL_DASH = [3, 6];
const NO_DASH: number[] = [];

function pick(list: Sprite[], u: number): Sprite {
  return list[Math.min(list.length - 1, Math.floor(u * list.length))];
}
