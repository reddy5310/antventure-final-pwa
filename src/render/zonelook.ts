// What zone each part of the screen is in, for the renderer. The sim's zones are
// a pure function of (seed, river distance), so the renderer asks the same
// question for every row it draws: the next zone's banks and water scroll into
// view before the leaf reaches them, and the Daily River looks the same for
// everyone.
//
// A boundary blends over BLEND_M, and segments are far longer than a screen,
// so at most ONE transition is ever visible. That keeps this cheap: each frame
// finds it with two zoneAt() calls (plus a short bisection on the rare frames
// where it sits mid-screen), and every per-slot question ("which zone is this
// bush in?") becomes closed-form arithmetic on its river distance.
//
// ZoneWash paints a per-zone colour wash across that transition with ONE cached
// unit gradient per zone pair, mapped to the screen by the transform at fill
// time: no per-frame gradient allocation.

import { UNITS_PER_METER } from '../config';
import { BLEND_M, createZoneSample, zoneAt } from '../game/zones';
import type { ZoneId } from '../types';
import { RIVER_STEP, type Gfx } from './gfx';
import type { Tint } from './palette';

const BLEND_U = BLEND_M * UNITS_PER_METER;
/** Extra river (units) looked at beyond the view: covers the tallest sprites and slot padding. */
const PAD = 160;

export const ZONE_INDEX: Readonly<Record<ZoneId, number>> = { jungle: 0, marsh: 1, rapids: 2, night: 3 };
const ZONE_LIST: readonly ZoneId[] = ['jungle', 'marsh', 'rapids', 'night'];

/** This frame's zones across the view. Shared by every render module through `frameLook`. */
export class ZoneLook {
  /** True when the whole view is one zone (`a`). */
  flat = true;
  /** Zone below the transition (the only zone when flat). */
  a: ZoneId = 'jungle';
  /** Zone above the transition. */
  b: ZoneId = 'jungle';
  /** River distance where the transition begins (blend 0). */
  start = 0;
  /** View y where the blend is 0 (lower on screen) and where it reaches 1 (higher). */
  yFrom = 0;
  yTo = 0;

  private seed = NaN;
  private dist = NaN;
  private py = NaN;
  private viewH = NaN;
  private s0 = createZoneSample();
  private s1 = createZoneSample();
  private mid = createZoneSample();

  /** Recomputes for this frame's river window; a no-op when nothing moved. */
  update(g: Gfx): void {
    if (g.seed === this.seed && g.dist === this.dist && g.py === this.py && g.viewH === this.viewH) return;
    this.seed = g.seed;
    this.dist = g.dist;
    this.py = g.py;
    this.viewH = g.viewH;
    const dBot = g.dist + g.py - g.viewH - PAD;
    const dTop = g.dist + g.py + PAD;
    const s0 = zoneAt(g.seed, dBot, this.s0);
    const s1 = zoneAt(g.seed, dTop, this.s1);
    if (s0.zone !== s0.next) {
      // The bottom of the view is inside a transition.
      this.set(s0.zone, s0.next, dBot - s0.blend * BLEND_U, g);
    } else if (s1.zone !== s1.next) {
      this.set(s1.zone, s1.next, dTop - s1.blend * BLEND_U, g);
    } else if (s0.index === s1.index) {
      this.flat = true;
      this.a = this.b = s0.zone;
    } else {
      // A boundary lies between the two ends but both ends are clear of the
      // blend (a tall view): bisect for where the segment index flips.
      let lo = dBot;
      let hi = dTop;
      for (let i = 0; i < 18; i++) {
        const mid = (lo + hi) / 2;
        if (zoneAt(g.seed, mid, this.mid).index > s0.index) hi = mid;
        else lo = mid;
      }
      this.set(s0.zone, s1.zone, hi, g);
    }
  }

  private set(a: ZoneId, b: ZoneId, start: number, g: Gfx): void {
    this.a = a;
    this.b = b;
    this.start = start;
    this.flat = a === b;
    this.yFrom = g.yOfD(start);
    this.yTo = g.yOfD(start + BLEND_U);
  }

  /** 0..1 progress through the transition at river distance `d` (0 before it, 1 after). */
  blendAt(d: number): number {
    if (this.flat) return 0;
    const t = (d - this.start) / BLEND_U;
    return t <= 0 ? 0 : t >= 1 ? 1 : t;
  }

  /** How much of `zone` the look at `d` contains, 0..1 (the two zones' weights sum to 1). */
  weightAt(zone: ZoneId, d: number): number {
    if (this.flat) return this.a === zone ? 1 : 0;
    const t = this.blendAt(d);
    return (this.a === zone ? 1 - t : 0) + (this.b === zone ? t : 0);
  }

  /**
   * One zone for a scenery slot at `d`: below the transition the old zone, above
   * it the new one, and inside it a dither (`u`, a stable 0..1 hash of the slot)
   * so the vegetation changes character gradually rather than in a line.
   */
  pickAt(d: number, u: number): ZoneId {
    if (this.flat) return this.a;
    return u < this.blendAt(d) ? this.b : this.a;
  }

  /** True if any part of the view (and its padding) is `zone` or blends towards it. */
  involves(zone: ZoneId): boolean {
    return this.a === zone || this.b === zone;
  }
}

const LOOK = new ZoneLook();

/** The shared, per-frame zone look for this river window. */
export function frameLook(g: Gfx): ZoneLook {
  LOOK.update(g);
  return LOOK;
}

const css = (t: Tint, rgbFrom: Tint): string => `rgba(${rgbFrom[0]}, ${rgbFrom[1]}, ${rgbFrom[2]}, ${t[3]})`;

/**
 * A colour wash that follows the zones. `fill`/`fillPath` set the transform and
 * fill style and leave the geometry to the caller (always paint after, then
 * restore the world transform with `g.world()` if drawing continues).
 */
export class ZoneWash {
  private flatCss: string[] = [];
  private pairs: (CanvasGradient | null)[] = new Array(16).fill(null);

  constructor(private tints: Readonly<Record<ZoneId, Tint>>) {
    for (const z of ZONE_LIST) this.flatCss.push(css(tints[z], tints[z]));
  }

  /** Is anything but the Jungle's "no wash" visible? */
  visible(look: ZoneLook): boolean {
    return this.tints[look.a][3] > 0 || this.tints[look.b][3] > 0;
  }

  /** Paints `rect` (world units) with the wash. */
  fillRect(g: Gfx, look: ZoneLook, x: number, y: number, w: number, h: number): void {
    const { ctx } = g;
    if (!this.visible(look)) return;
    g.world();
    if (look.flat) {
      ctx.fillStyle = this.flatCss[ZONE_INDEX[look.a]];
      ctx.fillRect(x, y, w, h);
      return;
    }
    const span = look.yTo - look.yFrom;
    this.mapGradient(g, look, span);
    // Rect in gradient space: y becomes the fraction of the transition.
    const u0 = (y - look.yFrom) / span;
    const u1 = (y + h - look.yFrom) / span;
    ctx.fillRect(x, Math.min(u0, u1), w, Math.abs(u1 - u0));
    g.world();
  }

  /** Fills the current path (built under `g.world()`) with the wash. */
  fillPath(g: Gfx, look: ZoneLook): void {
    const { ctx } = g;
    if (!this.visible(look)) return;
    if (look.flat) {
      ctx.fillStyle = this.flatCss[ZONE_INDEX[look.a]];
    } else {
      this.mapGradient(g, look, look.yTo - look.yFrom);
    }
    // The path keeps the device coordinates it was built with, so the transform
    // changed for the gradient does not move it.
    ctx.fill();
    g.world();
  }

  private mapGradient(g: Gfx, look: ZoneLook, span: number): void {
    const { ctx } = g;
    const i = ZONE_INDEX[look.a] * 4 + ZONE_INDEX[look.b];
    let grad = this.pairs[i];
    if (!grad) {
      grad = ctx.createLinearGradient(0, 0, 0, 1);
      const ta = this.tints[look.a];
      const tb = this.tints[look.b];
      // A "no wash" end borrows the other end's colour so the blend fades in
      // rather than passing through black.
      grad.addColorStop(0, css(ta, ta[3] > 0 ? ta : tb));
      grad.addColorStop(1, css(tb, tb[3] > 0 ? tb : ta));
      this.pairs[i] = grad;
    }
    ctx.fillStyle = grad;
    ctx.setTransform(g.k, 0, 0, g.k * span, g.ox, g.oy + g.k * look.yFrom);
  }
}

/** Alpha steps used when a zone's weight fades a stroke in along the river. */
const WEIGHT_STEPS = 5;

/**
 * How much of one zone each of this frame's river samples contains. Strokes
 * cannot take the wash gradient (line width would stretch with it), so strokes
 * that belong to a zone fade in along the river in a few alpha steps instead.
 */
export class EdgeWeights {
  w = new Float32Array(256);
  /** Any sample has weight (otherwise there is nothing to draw). */
  any = false;

  fill(g: Gfx, look: ZoneLook, zone: ZoneId): void {
    if (!look.involves(zone)) {
      this.any = false;
      return;
    }
    if (this.w.length < g.n) this.w = new Float32Array(Math.ceil(g.n * 1.5));
    let any = false;
    for (let i = 0; i < g.n; i++) {
      const v = look.weightAt(zone, (g.k0 + i) * RIVER_STEP);
      this.w[i] = v;
      if (v > 0) any = true;
    }
    this.any = any;
  }
}

/**
 * Strokes both drawn river edges (left offset by `dl`, right by `dr`) with the
 * current stroke style, fading from nothing to `maxAlpha` as the weight rises.
 */
export function strokeWeighted(g: Gfx, ew: EdgeWeights, dl: number, dr: number, maxAlpha: number): void {
  if (!ew.any) return;
  const { ctx, ys, lw, rw, n } = g;
  const w = ew.w;
  for (let b = 1; b <= WEIGHT_STEPS; b++) {
    ctx.beginPath();
    let used = false;
    let open = false;
    for (let i = 0; i < n - 1; i++) {
      const seg = (w[i] + w[i + 1]) * 0.5;
      const bucket = seg <= 0 ? 0 : Math.min(WEIGHT_STEPS, Math.ceil(seg * WEIGHT_STEPS - 1e-6));
      if (bucket !== b) {
        open = false;
        continue;
      }
      if (!open) {
        ctx.moveTo(lw[i] + dl, ys[i]);
        open = true;
      }
      ctx.lineTo(lw[i + 1] + dl, ys[i + 1]);
      used = true;
    }
    open = false;
    for (let i = 0; i < n - 1; i++) {
      const seg = (w[i] + w[i + 1]) * 0.5;
      const bucket = seg <= 0 ? 0 : Math.min(WEIGHT_STEPS, Math.ceil(seg * WEIGHT_STEPS - 1e-6));
      if (bucket !== b) {
        open = false;
        continue;
      }
      if (!open) {
        ctx.moveTo(rw[i] + dr, ys[i]);
        open = true;
      }
      ctx.lineTo(rw[i + 1] + dr, ys[i + 1]);
    }
    if (!used) continue;
    ctx.globalAlpha = maxAlpha * (b / WEIGHT_STEPS);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
