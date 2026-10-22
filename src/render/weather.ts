// Weather and atmosphere: ambient rain streaks (two depth layers), rain
// ripples on the water, fireflies over the banks, the storm's darkening tint and
// vignette, lightning, and the soft scrims that keep the HUD area calm. Lily
// Marsh adds low drifting mist over the water; the Night River hands the
// fireflies over to night.ts, which draws them above the darkness.

import { WORLD_W } from '../config';
import type { StormPhase, World } from '../types';
import { makeSprite, type Gfx, type Sprite } from './gfx';
import { P } from './palette';
import { TAU, clamp01, hash } from './util';
import { frameLook } from './zonelook';

const RAIN_N = 300;
const RIPPLE_N = 48;
const RIPPLE_LIFE = 0.6;
const FIREFLY_SLOT = 70;
const MIST_SLOT = 150;
/** Horizontal drift per unit of fall: the wind. */
const WIND = -0.2;

export class Weather {
  private rx = new Float32Array(RAIN_N);
  private ry = new Float32Array(RAIN_N);
  private rs = new Float32Array(RAIN_N);
  private seeded = false;

  private ipx = new Float32Array(RIPPLE_N);
  private ipy = new Float32Array(RIPPLE_N);
  private ipd = new Float64Array(RIPPLE_N);
  private ipa = new Float32Array(RIPPLE_N).fill(9);
  private ipNext = 0;
  private ripAcc = 0;

  private flashAge = 9;
  private flashPower = 0;
  private flashSoft = false;
  private nextBolt = 8;

  private glow: Sprite | null = null;
  private dark: Sprite | null = null;
  private scrim: Sprite | null = null;
  private mist: Sprite | null = null;

  build(ppu: number): void {
    this.glow = makeSprite(22, 22, Math.min(ppu, 2), (c) => {
      const g = c.createRadialGradient(0, 0, 0, 0, 0, 11);
      g.addColorStop(0, 'rgba(255, 250, 200, 1)');
      g.addColorStop(0.18, 'rgba(255, 238, 140, 0.85)');
      g.addColorStop(0.5, 'rgba(230, 255, 120, 0.22)');
      g.addColorStop(1, 'rgba(230, 255, 120, 0)');
      c.fillStyle = g;
      c.fillRect(-11, -11, 22, 22);
    });
    // Storm darkening and edge vignette in one sprite: a light veil in the
    // middle, darker toward the edges. One full-screen pass instead of two.
    this.dark = makeSprite(128, 128, 1, (c) => {
      const g = c.createRadialGradient(0, 0, 20, 0, 0, 92);
      g.addColorStop(0, 'rgba(8, 20, 37, 0.22)');
      g.addColorStop(0.55, 'rgba(6, 16, 28, 0.42)');
      g.addColorStop(1, 'rgba(2, 8, 14, 0.95)');
      c.fillStyle = g;
      c.fillRect(-64, -64, 128, 128);
    });
    // Mist: a soft, wide puff (low resolution on purpose: it is a blur).
    this.mist = makeSprite(120, 80, 1, (c) => {
      c.scale(1, 0.667);
      const g = c.createRadialGradient(0, 0, 0, 0, 0, 60);
      g.addColorStop(0, 'rgba(225, 255, 236, 0.5)');
      g.addColorStop(0.45, 'rgba(210, 250, 226, 0.22)');
      g.addColorStop(1, 'rgba(200, 245, 220, 0)');
      c.fillStyle = g;
      c.fillRect(-60, -60, 120, 120);
    });
    this.scrim = makeSprite(4, 64, 1, (c) => {
      const g = c.createLinearGradient(0, -32, 0, 32);
      g.addColorStop(0, 'rgba(3, 12, 18, 0.62)');
      g.addColorStop(0.5, 'rgba(3, 12, 18, 0.22)');
      g.addColorStop(1, 'rgba(3, 12, 18, 0)');
      c.fillStyle = g;
      c.fillRect(-2, -32, 4, 64);
    });
  }

  reset(): void {
    this.ipa.fill(9);
    this.flashAge = 9;
    this.nextBolt = 8;
  }

  /** Storm phase changed: a flash in sync with the thunder main plays. */
  onStorm(phase: StormPhase, reduced: boolean): void {
    if (phase === 'calm') return;
    this.flash(phase === 'drizzle' ? 0.22 : phase === 'downpour' ? 0.42 : 0.6, reduced);
  }

  private flash(power: number, reduced: boolean): void {
    this.flashAge = 0;
    this.flashPower = power;
    this.flashSoft = reduced;
  }

  private rainAmount(world: World): number {
    return world.state === 'attract' ? 0.3 : 0.16 + 0.84 * clamp01(world.intensity);
  }

  update(g: Gfx, world: World): void {
    const width = g.viewR - g.viewL + 60;
    if (!this.seeded) {
      this.seeded = true;
      for (let i = 0; i < RAIN_N; i++) {
        this.rx[i] = g.viewL + Math.random() * width;
        this.ry[i] = Math.random() * g.viewH;
        this.rs[i] = 900 + Math.random() * 500;
      }
    }
    const dt = g.dt;
    for (let i = 0; i < RAIN_N; i++) {
      const fall = this.rs[i] * dt;
      this.ry[i] += fall;
      this.rx[i] += fall * WIND;
      if (this.ry[i] > g.viewH + 40) {
        this.ry[i] -= g.viewH + 80 + Math.random() * 60;
        this.rx[i] = g.viewL + Math.random() * width;
      }
      if (this.rx[i] < g.viewL - 30) this.rx[i] += width;
      else if (this.rx[i] > g.viewR + 30) this.rx[i] -= width;
    }

    // Ripples land on the river and ride it.
    const rate = world.state === 'attract' ? 7 : 4 + clamp01(world.intensity) * 36;
    this.ripAcc += g.dt * rate;
    while (this.ripAcc >= 1) {
      this.ripAcc -= 1;
      const i = this.ipNext;
      this.ipNext = (i + 1) % RIPPLE_N;
      const y = Math.random() * g.viewH;
      const l = g.leftAt(y);
      const r = g.rightAt(y);
      this.ipx[i] = l + 8 + Math.random() * Math.max(0, r - l - 16);
      this.ipy[i] = y;
      this.ipd[i] = g.dist;
      this.ipa[i] = 0;
    }
    for (let i = 0; i < RIPPLE_N; i++) if (this.ipa[i] < 9) this.ipa[i] += g.dt;

    // Ambient lightning in the heaviest phases.
    this.flashAge += g.dt;
    if (world.state === 'running' && (world.storm === 'cloudburst' || world.storm === 'downpour')) {
      this.nextBolt -= g.dt;
      if (this.nextBolt <= 0) {
        const heavy = world.storm === 'cloudburst';
        this.nextBolt = heavy ? 5 + Math.random() * 7 : 11 + Math.random() * 9;
        this.flash(heavy ? 0.3 : 0.18, g.reduced);
      }
    }
  }

  drawRipples(g: Gfx): void {
    const { ctx } = g;
    g.world();
    ctx.strokeStyle = P.foam;
    ctx.lineWidth = 0.9;
    for (let i = 0; i < RIPPLE_N; i++) {
      const a = this.ipa[i];
      if (a >= RIPPLE_LIFE) continue;
      const u = a / RIPPLE_LIFE;
      const y = this.ipy[i] + (g.dist - this.ipd[i]);
      ctx.globalAlpha = (1 - u) * (1 - u) * 0.3;
      ctx.beginPath();
      ctx.arc(this.ipx[i], y, 1.5 + u * 7, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** Fireflies over the banks; they hide as the storm builds, and at night (night.ts has its own, above the dark). */
  drawFireflies(g: Gfx, world: World): void {
    const glow = this.glow;
    if (!glow) return;
    const calm = 1 - clamp01(world.intensity);
    const vis = calm * calm * (world.state === 'attract' ? 1 : 0.8) * (1 - clamp01(world.darkness));
    if (vis < 0.03) return;
    const { ctx } = g;
    const seed = world.seed;
    const dBot = g.dist + g.py - g.viewH - 40;
    const dTop = g.dist + g.py + 40;
    const k0 = Math.floor(dBot / FIREFLY_SLOT);
    const k1 = Math.ceil(dTop / FIREFLY_SLOT);
    for (let k = k0; k <= k1; k++) {
      for (let side = -1; side <= 1; side += 2) {
        const h = hash(seed ^ 0xf1f1, k, side);
        if (h > 0.6) continue;
        const y = g.yOfD(k * FIREFLY_SLOT + h * FIREFLY_SLOT) + Math.cos(g.t * 0.9 + h * 7) * 9;
        const edge = side < 0 ? g.leftDrawnAt(y) : g.rightDrawnAt(y);
        const room = side < 0 ? edge - g.viewL : g.viewR - edge;
        if (room < 10) continue;
        const off = 6 + hash(seed ^ 0xf1f2, k, side) * Math.min(room - 6, 220);
        const x = edge + side * off + Math.sin(g.t * 0.7 + h * 10) * 7;
        const flick = 0.5 + 0.5 * Math.sin(g.t * (1.6 + h) + h * 20);
        if (flick < 0.12) continue;
        ctx.globalAlpha = flick * vis;
        g.sprite(glow, x, y, 0, 0.7 + 0.45 * flick);
      }
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Lily Marsh mist: slow low puffs over the water that scroll with the river,
   * thickest where the Marsh is fully in. Above the water and banks, below every
   * hazard and the leaf, so it only ever softens the scenery.
   */
  private drawMist(g: Gfx, world: World): void {
    const mist = this.mist;
    const look = frameLook(g);
    if (!mist || !look.involves('marsh')) return;
    const { ctx } = g;
    const seed = world.seed;
    const dBot = g.dist + g.py - g.viewH - 140;
    const dTop = g.dist + g.py + 140;
    const k0 = Math.floor(dBot / MIST_SLOT);
    const k1 = Math.ceil(dTop / MIST_SLOT);
    for (let k = k0; k <= k1; k++) {
      const wm = look.weightAt('marsh', k * MIST_SLOT);
      if (wm <= 0) continue;
      // One puff per slot: they are big, soft and translucent, so each one costs a
      // lot of overdraw for very little extra haze.
      const h = hash(seed ^ 0x3157, k);
      if (h > 0.9 * wm) continue;
      const y = g.yOfD(k * MIST_SLOT + hash(seed ^ 0x3158, k) * MIST_SLOT);
      if (y < -90 || y > g.viewH + 90) continue;
      const l = g.leftAt(y);
      const r = g.rightAt(y);
      const ph = hash(seed ^ 0x3159, k) * TAU;
      const x = l + (r - l) * hash(seed ^ 0x315a, k) + (g.reduced ? 0 : Math.sin(g.t * 0.08 + ph) * 26);
      const breathe = g.reduced ? 0.8 : 0.75 + 0.25 * Math.sin(g.t * 0.2 + ph * 1.7);
      ctx.globalAlpha = (0.26 + 0.22 * hash(seed ^ 0x315b, k)) * breathe * wm;
      g.sprite(mist, x, y, 0, 1.4 + 1.2 * hash(seed ^ 0x315c, k));
    }
    ctx.globalAlpha = 1;
  }

  /** Storm darkening, applied to the environment before gameplay elements so they pop. */
  drawTint(g: Gfx, world: World): void {
    this.drawMist(g, world);
    if (!this.dark) return;
    const { ctx } = g;
    g.screen();
    ctx.globalAlpha = Math.min(1, 0.22 + clamp01(world.intensity) * 0.7);
    ctx.drawImage(this.dark.img, 0, 0, g.cw, g.ch);
    ctx.globalAlpha = 1;
  }

  drawRain(g: Gfx, world: World): void {
    const { ctx } = g;
    const amount = this.rainAmount(world);
    const widthFactor = (g.viewR - g.viewL) / WORLD_W;
    const count = Math.min(RAIN_N, Math.floor(150 * amount * widthFactor));
    if (count <= 0) return;
    g.world();
    ctx.strokeStyle = P.rain;
    ctx.lineCap = 'round';
    for (let layer = 0; layer < 2; layer++) {
      const near = layer === 1;
      ctx.lineWidth = near ? 1.25 : 0.8;
      ctx.globalAlpha = (near ? 0.26 : 0.16) + clamp01(world.intensity) * 0.08;
      const lenK = near ? 0.03 : 0.018;
      ctx.beginPath();
      for (let i = layer; i < count; i += 2) {
        const x = this.rx[i];
        const y = this.ry[i];
        const len = this.rs[i] * lenK;
        ctx.moveTo(x, y);
        ctx.lineTo(x - len * WIND, y - len);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** Lightning and the HUD scrims (device space). */
  drawOverlay(g: Gfx): void {
    const { ctx } = g;
    g.screen();
    if (this.flashAge < 1) {
      const a = this.flashAge;
      let alpha: number;
      if (this.flashSoft) {
        // Reduced motion: a slow, gentle brightening instead of a strobe.
        alpha = a < 0.9 ? Math.sin((a / 0.9) * Math.PI) * 0.1 * (this.flashPower / 0.6 + 0.4) : 0;
      } else {
        // A bright strike and a weaker after-flicker.
        alpha = Math.max(0, 1 - a / 0.12) * this.flashPower + Math.max(0, 1 - Math.abs(a - 0.24) / 0.07) * this.flashPower * 0.6;
      }
      if (alpha > 0) {
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#eaf4ff';
        ctx.fillRect(0, 0, g.cw, g.ch);
      }
    }
    if (this.scrim) {
      ctx.globalAlpha = 1;
      const top = (96 + g.safeTop) * g.dpr;
      ctx.drawImage(this.scrim.img, 0, 0, g.cw, top);
      const bot = (34 + g.safeBottom) * g.dpr;
      ctx.globalAlpha = 0.55;
      // The same gradient flipped: darkest at the very bottom edge.
      ctx.setTransform(1, 0, 0, -1, 0, g.ch);
      ctx.drawImage(this.scrim.img, 0, 0, g.cw, bot);
      g.screen();
    }
    ctx.globalAlpha = 1;
  }
}
