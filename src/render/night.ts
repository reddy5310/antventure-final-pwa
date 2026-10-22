// Night River darkness: everything but a pool of light around the leaf goes
// dark. Drawn above the leaf/ant and BELOW drop telegraphs, so telegraphs are
// always visible (a fairness rule), and rocks, pads and twigs keep a faint glowing
// foam outline beyond the light so the course stays readable.
//
// Cost: the darkness is ONE cached offscreen radial mask (built on resize only)
// drawn scaled around the leaf, plus four solid strips for the rest of the screen,
// all on whole device pixels so no seams show. Growing the pool for the firefly
// power just scales the same mask: no gradient is ever built per frame.
//
// Everything that glows (ambient fireflies, bank glowcaps, outlines) draws after the
// mask. Reduced motion: fireflies, glowcaps and outlines hold steady, the light does
// not flicker.

import { hasPower } from '../game/powers';
import type { World } from '../types';
import { makeSprite, type Gfx, type Sprite } from './gfx';
import { ZP } from './palette';
import { PAD_R0, ROCK_R0, padIndex, padPath, rockIndex, rockPath } from './silhouettes';
import { TAU, clamp01, hash, smoothstep } from './util';

/** Radius (units) at which the light has faded to half: the "pool of light". */
export const POOL_R = 150;
/** Pool multiplier while a firefly power-up is active. */
export const FIREFLY_LIGHT = 1.8;
/** Darkness outside the light at full night (the rest still shows through). */
const MAX_DARK = 0.86;
/** The mask image reaches full dark at this multiple of POOL_R. */
const MASK_SPAN = 1.5;
const MASK_PX = 256;
const LUT_N = 64;
/** The light sits a little ahead of the leaf: obstacles come from upstream. */
const AHEAD = 20;

const FIREFLY_SLOT = 62;
const CAP_SLOT = 84;

/** 0 at the leaf, rising smoothly to 1 at the mask's edge (the fraction of full darkness). */
function profile(rho: number): number {
  const u = clamp01((rho - 0.18) / 0.82);
  return smoothstep(u) ** 1.4;
}

export class NightArt {
  private mask: HTMLCanvasElement | null = null;
  private glow: Sprite | null = null;
  private warm: Sprite | null = null;
  private cap: Sprite | null = null;
  private lut = new Float32Array(LUT_N + 1);
  /** Current pool radius (units): eases towards its target so the firefly power swells and fades the light. */
  private radius = POOL_R;

  build(ppu: number): void {
    const mask = document.createElement('canvas');
    mask.width = MASK_PX;
    mask.height = MASK_PX;
    const c = mask.getContext('2d');
    if (c) {
      const half = MASK_PX / 2;
      const grad = c.createRadialGradient(half, half, 0, half, half, half);
      const steps = 24;
      for (let i = 0; i <= steps; i++) {
        const rho = i / steps;
        grad.addColorStop(rho, `rgba(2, 6, 15, ${profile(rho).toFixed(4)})`);
      }
      c.fillStyle = grad;
      c.fillRect(0, 0, MASK_PX, MASK_PX);
    }
    this.mask = mask;
    for (let i = 0; i <= LUT_N; i++) this.lut[i] = profile(i / LUT_N);

    // Firefly: a small bright core in a soft glow (drawn additively).
    this.glow = makeSprite(30, 30, Math.min(ppu, 2), (g) => {
      const rg = g.createRadialGradient(0, 0, 0, 0, 0, 15);
      rg.addColorStop(0, 'rgba(250, 255, 200, 1)');
      rg.addColorStop(0.1, 'rgba(236, 255, 150, 0.95)');
      rg.addColorStop(0.28, 'rgba(190, 255, 90, 0.34)');
      rg.addColorStop(1, 'rgba(160, 255, 70, 0)');
      g.fillStyle = rg;
      g.fillRect(-15, -15, 30, 30);
    });
    // Glowcaps: little bioluminescent mushrooms on the banks, teal so they never read as crumbs or fireflies.
    this.cap = makeSprite(34, 34, Math.min(ppu, 2), (g) => {
      const rg = g.createRadialGradient(0, 0, 0, 0, 0, 17);
      rg.addColorStop(0, 'rgba(94, 230, 208, 0.42)');
      rg.addColorStop(0.5, 'rgba(60, 190, 190, 0.14)');
      rg.addColorStop(1, 'rgba(40, 160, 180, 0)');
      g.fillStyle = rg;
      g.fillRect(-17, -17, 34, 34);
      const caps: [number, number, number][] = [
        [-2.6, 1.4, 3.3],
        [3.2, -1.6, 2.5],
        [1, 4.4, 1.9],
      ];
      for (const [x, y, r] of caps) {
        g.fillStyle = ZP.glowcapDeep;
        g.beginPath();
        g.arc(x, y, r, 0, TAU);
        g.fill();
        g.fillStyle = ZP.glowcap;
        g.beginPath();
        g.arc(x - r * 0.1, y - r * 0.12, r * 0.74, 0, TAU);
        g.fill();
        g.fillStyle = 'rgba(235, 255, 250, 0.85)';
        g.beginPath();
        g.arc(x - r * 0.32, y - r * 0.36, r * 0.24, 0, TAU);
        g.fill();
      }
    });
    // The warm glow the firefly power casts around the leaf.
    this.warm = makeSprite(64, 64, 1, (g) => {
      const rg = g.createRadialGradient(0, 0, 0, 0, 0, 32);
      rg.addColorStop(0, 'rgba(210, 255, 150, 0.5)');
      rg.addColorStop(0.5, 'rgba(180, 255, 120, 0.16)');
      rg.addColorStop(1, 'rgba(160, 255, 100, 0)');
      g.fillStyle = rg;
      g.fillRect(-32, -32, 64, 64);
    });
  }

  draw(g: Gfx, world: World): void {
    const p = world.player;
    // The pool eases towards its target every frame, even by day, so a firefly
    // power picked up just before the night arrives does not pop the light.
    const power = firefly(world);
    const target = lightRadius(world);
    this.radius += (target - this.radius) * (1 - Math.exp(-4.5 * Math.min(0.1, g.dt)));

    // The backdrop keeps some light so the menu stays readable; after death the
    // dark lifts a little so the last moments show what happened.
    const ended = world.state === 'dying' || world.state === 'over' ? smoothstep(world.deathTimer / 1.1) : 0;
    const dark = clamp01(world.darkness) * (world.state === 'attract' ? 0.6 : 1) * (1 - 0.45 * ended);
    if (dark < 0.01 || !this.mask) return;

    const flick = g.reduced ? 0 : Math.sin(g.t * 7.1) * 0.012 + Math.sin(g.t * 11.3 + 1) * 0.008;
    const R = this.radius * (1 + flick) * (1 + 0.3 * ended);
    const cx = p.x;
    const cy = p.y - AHEAD;
    const half = R * MASK_SPAN;
    this.drawMask(g, cx, cy, half, dark * MAX_DARK);
    if (power > 0.02) this.drawWarm(g, cx, p.y, R, power * dark);
    this.drawOutlines(g, world, cx, cy, half, dark);
    this.drawGlowcaps(g, world, dark);
    this.drawFireflies(g, world, cx, cy, half, dark, power);
  }

  /** The mask square around the light and four strips covering the rest, on whole device pixels. */
  private drawMask(g: Gfx, cx: number, cy: number, half: number, alpha: number): void {
    const { ctx, cw, ch, k } = g;
    g.screen();
    const px = Math.round(g.ox + cx * k);
    const py = Math.round(g.oy + cy * k);
    const hs = Math.max(2, Math.round(half * k));
    const x0 = px - hs;
    const y0 = py - hs;
    const x1 = px + hs;
    const y1 = py + hs;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = ZP.nightMask;
    if (y0 > 0) ctx.fillRect(0, 0, cw, y0);
    if (y1 < ch) ctx.fillRect(0, y1, cw, ch - y1);
    const top = Math.max(0, y0);
    const bottom = Math.min(ch, y1);
    if (bottom > top) {
      if (x0 > 0) ctx.fillRect(0, top, x0, bottom - top);
      if (x1 < cw) ctx.fillRect(x1, top, cw - x1, bottom - top);
    }
    ctx.drawImage(this.mask as HTMLCanvasElement, x0, y0, hs * 2, hs * 2);
    ctx.globalAlpha = 1;
  }

  /** A soft warm light around the leaf while the firefly power is active. */
  private drawWarm(g: Gfx, x: number, y: number, R: number, strength: number): void {
    const warm = this.warm;
    if (!warm) return;
    const { ctx } = g;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.3 * strength;
    const s = (R * 1.5) / 32;
    g.sprite(warm, x, y, 0, s);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * Obstacles beyond the light keep a faint glowing outline, brighter the
   * darker their spot is, so every hazard stays readable (the shape, not the
   * detail). The outline follows the obstacle's own silhouette (a faceted rock,
   * a lily pad with its notch, a twig's capsule) and is cooler and dimmer than
   * a telegraph ring on purpose: a dark disc with a bright circle at night must
   * only ever mean "rain is coming".
   */
  private drawOutlines(g: Gfx, world: World, cx: number, cy: number, half: number, dark: number): void {
    const list = world.obstacles;
    if (!list.length) return;
    const { ctx, t } = g;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      const ext = o.r + o.len;
      if (o.y < -ext - 20 || o.y > g.viewH + ext + 20) continue;
      const dx = o.x - cx;
      const dy = o.y - cy;
      // Hidden fraction at the obstacle's nearest edge to the light centre.
      const rho = Math.max(0, Math.sqrt(dx * dx + dy * dy) - ext * 0.6) / half;
      const hidden = rho >= 1 ? 1 : this.lut[Math.floor(rho * LUT_N)];
      if (hidden < 0.04) continue;
      const shimmer = g.reduced ? 0.8 : 0.78 + 0.22 * Math.sin(t * 2.2 + o.id * 1.7);
      const a = hidden * dark * shimmer * (o.hit ? 0.45 : 1);
      if (o.kind === 'twig') {
        g.local(o.x, o.y, o.angle);
        this.capsule(ctx, o.len, o.r + 2);
        this.edge(ctx, null, a, 1.5);
      } else if (o.kind === 'rock') {
        const s = (o.r / ROCK_R0) * 1.1;
        g.local(o.x, o.y, o.angle, s);
        this.edge(ctx, rockPath(rockIndex(o.variant)), a, 1.5 / s);
      } else {
        const s = (o.r / PAD_R0) * 1.06;
        g.local(o.x, o.y, o.angle, s);
        this.edge(ctx, padPath(padIndex(o.variant)), a, 1.5 / s);
      }
    }
    ctx.globalAlpha = 1;
    g.world();
  }

  /**
   * Fills (a faint body, so a hidden hazard reads as an object and not as a hole
   * in the water) and strokes (a wide faint halo, then the crisp edge) either
   * `path` or, when null, the current path.
   */
  private edge(ctx: CanvasRenderingContext2D, path: Path2D | null, a: number, lw: number): void {
    ctx.fillStyle = ZP.nightRockFill;
    ctx.strokeStyle = ZP.nightRockEdge;
    ctx.globalAlpha = a * 0.16;
    if (path) ctx.fill(path);
    else ctx.fill();
    ctx.globalAlpha = a * 0.14;
    ctx.lineWidth = lw * 3.6;
    if (path) ctx.stroke(path);
    else ctx.stroke();
    ctx.globalAlpha = a * 0.62;
    ctx.lineWidth = lw;
    if (path) ctx.stroke(path);
    else ctx.stroke();
  }

  private capsule(ctx: CanvasRenderingContext2D, len: number, h: number): void {
    ctx.beginPath();
    ctx.arc(-len, 0, h, Math.PI / 2, Math.PI * 1.5);
    ctx.lineTo(len, -h);
    ctx.arc(len, 0, h, -Math.PI / 2, Math.PI / 2);
    ctx.closePath();
  }

  /** Glowcaps along both banks: a soft teal glimmer that also shows where the river's edge runs in the dark. */
  private drawGlowcaps(g: Gfx, world: World, dark: number): void {
    const cap = this.cap;
    if (!cap) return;
    const { ctx, t } = g;
    const seed = world.seed;
    const k0 = Math.floor((g.dist + g.py - g.viewH - 40) / CAP_SLOT);
    const k1 = Math.ceil((g.dist + g.py + 40) / CAP_SLOT);
    ctx.globalCompositeOperation = 'lighter';
    for (let k = k0; k <= k1; k++) {
      for (let side = -1; side <= 1; side += 2) {
        const h = hash(seed ^ 0xca95, k, side);
        if (h > 0.6) continue;
        const y = g.yOfD(k * CAP_SLOT + hash(seed ^ 0xca96, k, side) * CAP_SLOT);
        if (y < -20 || y > g.viewH + 20) continue;
        const edge = side < 0 ? g.leftDrawnAt(y) : g.rightDrawnAt(y);
        const room = side < 0 ? edge - g.viewL : g.viewR - edge;
        if (room < 8) continue;
        const ph = hash(seed ^ 0xca97, k, side) * TAU;
        const pulse = g.reduced ? 0.8 : 0.7 + 0.3 * Math.sin(t * 0.9 + ph);
        ctx.globalAlpha = dark * pulse * 0.85;
        const x = edge + side * (9 + hash(seed ^ 0xca98, k, side) * Math.min(34, room - 8));
        g.sprite(cap, x, y, ph, 0.8 + 0.4 * hash(seed ^ 0xca99, k, side));
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * Ambient fireflies drifting over the banks and the water. Placed by river
   * distance like all scenery (so the Daily River is the same for everyone),
   * each wandering on its own slow loop and blinking in its own time. Small and
   * green-gold on purpose: nothing about them resembles a crumb, a power-up or a
   * telegraph ring.
   */
  private drawFireflies(g: Gfx, world: World, cx: number, cy: number, half: number, dark: number, power: number): void {
    const glow = this.glow;
    if (!glow) return;
    const { ctx, t } = g;
    // Reduced motion: they hover where they are instead of wandering.
    const wander = g.reduced ? 0 : t;
    const seed = world.seed;
    const dBot = g.dist + g.py - g.viewH - 60;
    const dTop = g.dist + g.py + 60;
    const k0 = Math.floor(dBot / FIREFLY_SLOT);
    const k1 = Math.ceil(dTop / FIREFLY_SLOT);
    const vis = dark * dark;
    ctx.globalCompositeOperation = 'lighter';
    for (let k = k0; k <= k1; k++) {
      for (let j = 0; j < 2; j++) {
        const h = hash(seed ^ 0xf1fe, k, j);
        if (h > 0.8) continue;
        const ph = hash(seed ^ 0xf1ff, k, j) * TAU;
        const d0 = k * FIREFLY_SLOT + h * (FIREFLY_SLOT / 0.8);
        const y = g.yOfD(d0) + Math.cos(wander * 0.27 + ph * 1.3) * 18 + Math.sin(wander * 0.71 + ph) * 4;
        if (y < -20 || y > g.viewH + 20) continue;
        const l = g.leftAt(y);
        const r = g.rightAt(y);
        const side = hash(seed ^ 0xf200, k, j);
        const reach = hash(seed ^ 0xf201, k, j);
        let x: number;
        if (side < 0.35) x = l - 6 - reach * Math.min(150, Math.max(10, l - g.viewL - 6));
        else if (side < 0.7) x = r + 6 + reach * Math.min(150, Math.max(10, g.viewR - r - 6));
        else x = l + 14 + (r - l - 28) * reach;
        x += Math.sin(wander * 0.31 + ph) * 16 + Math.sin(wander * 0.83 + ph * 2) * 5;
        // Blink in and out (a steady glimmer under reduced motion).
        const blink = g.reduced ? 0.75 : 0.5 + 0.5 * Math.sin(t * (0.9 + hash(seed ^ 0xf202, k, j) * 1.4) + ph * 3);
        let a = blink ** 1.5 * vis * 0.9;
        // The firefly power wakes them: those inside the light shine brighter.
        if (power > 0.02) {
          const dx = x - cx;
          const dy = y - cy;
          if (dx * dx + dy * dy < half * half * 0.5) a = Math.min(1, a * (1 + 0.8 * power));
        }
        if (a < 0.03) continue;
        ctx.globalAlpha = a;
        g.sprite(glow, x, y, 0, 0.5 + 0.35 * blink);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}

/**
 * Radius (units) of the pool of light around the leaf right now, firefly power
 * included. For other render modules that ease their own glow off where the
 * light already reaches (pickups); the mask itself eases towards this value.
 */
export function lightRadius(world: World): number {
  return POOL_R * (1 + (FIREFLY_LIGHT - 1) * firefly(world));
}

/** 0..1: how strongly the firefly power is lighting the way (fades out over its last second). */
function firefly(world: World): number {
  if (!hasPower(world, 'firefly')) return 0;
  const list = world.powers;
  for (let i = 0; i < list.length; i++) if (list[i].kind === 'firefly') return clamp01(list[i].left / 1.2);
  return 0;
}
