// Transient effects spawned from game events: pooled particles (struct of
// arrays, nothing allocated per frame), rings and whoosh arcs, floating
// near-miss text, screen shake and the hit vignette. Effects on the water are
// anchored to the river (they scroll with it); effects on the leaf or in the
// air are anchored to the screen (they stay with the ant).

import type { GameEvent, World } from '../types';
import { makeSprite, type Gfx, type Sprite } from './gfx';
import { COMBO_TIERS, CONFETTI, FONT_FAMILY, P, comboTier } from './palette';
import { TAU, clamp01, easeOutBack, easeOutCubic } from './util';

const MAXP = 420;
const MAXR = 48;
const MAXT = 8;
/** Floating text: lifetime (s) and how far it rises (units). */
const TEXT_LIFE = 0.95;
const TEXT_RISE = 34;
/** A near-miss within this long of the last one folds into its text (a chain reads as one growing total). */
const TEXT_MERGE_WINDOW = 0.5;
/** Age a merged text restarts from: just inside the pop, so each graze bumps it. */
const TEXT_MERGE_AGE = 0.12;
const textRise = (age: number) => easeOutCubic(clamp01(age / TEXT_LIFE)) * TEXT_RISE;

const DROPLET = 0;
const FOAM = 1;
const CONF = 2;
const CHIP = 3;
const BUBBLE = 4;
const SPARK = 5;

/** Particle colour table (indexed by a byte per particle). */
const COLORS: readonly string[] = [
  P.foam, // 0
  P.dropBody, // 1
  P.bark, // 2
  P.rockLight, // 3
  P.foliageLight, // 4
  P.gold, // 5
  P.danger, // 6
  ...CONFETTI, // 7..
];
const C_FOAM = 0;
const C_DROP = 1;
const C_BARK = 2;
const C_ROCK = 3;
const C_LEAF = 4;
const C_GOLD = 5;
const C_DANGER = 6;
const C_CONF0 = 7;

const NEAR_MISS_FONT = `700 19px ${FONT_FAMILY}`;
const MULT_FONT = `700 13px ${FONT_FAMILY}`;

export class Effects {
  // Particles.
  private px = new Float32Array(MAXP);
  private py = new Float32Array(MAXP);
  private pvx = new Float32Array(MAXP);
  private pvy = new Float32Array(MAXP);
  private pz = new Float32Array(MAXP);
  private pvz = new Float32Array(MAXP);
  private plife = new Float32Array(MAXP);
  private pmax = new Float32Array(MAXP);
  private psize = new Float32Array(MAXP);
  private prot = new Float32Array(MAXP);
  private pvr = new Float32Array(MAXP);
  /** River distance at spawn for anchored particles; NaN = screen-anchored. */
  private pd0 = new Float64Array(MAXP);
  private pkind = new Uint8Array(MAXP);
  private pcol = new Uint8Array(MAXP);
  private pNext = 0;

  // Rings and arcs.
  private rx = new Float32Array(MAXR);
  private ry = new Float32Array(MAXR);
  private rd0 = new Float64Array(MAXR);
  private r0 = new Float32Array(MAXR);
  private r1 = new Float32Array(MAXR);
  private rlife = new Float32Array(MAXR);
  private rmax = new Float32Array(MAXR);
  private rw = new Float32Array(MAXR);
  private rdelay = new Float32Array(MAXR);
  private ra0 = new Float32Array(MAXR);
  private ralen = new Float32Array(MAXR);
  private rcol = new Uint8Array(MAXR);
  private rNext = 0;

  // Floating texts.
  private tx = new Float32Array(MAXT);
  private ty = new Float32Array(MAXT);
  private tage = new Float32Array(MAXT).fill(99);
  private tcol: string[] = new Array<string>(MAXT).fill('#fff');
  private ta: string[] = new Array<string>(MAXT).fill('');
  private tb: string[] = new Array<string>(MAXT).fill('');
  private taw = new Float32Array(MAXT);
  /** Points shown by each text (merged chains accumulate). */
  private tpts = new Float32Array(MAXT);
  private tNext = 0;

  private shake = 0;
  private hitPulse = 0;
  private hitSoft = false;
  private time = 0;
  private vignette: Sprite | null = null;
  private measure: CanvasRenderingContext2D | null = null;

  build(ctx: CanvasRenderingContext2D): void {
    this.measure = ctx;
    this.vignette = makeSprite(128, 128, 1, (c) => {
      const g = c.createRadialGradient(0, 0, 36, 0, 0, 92);
      g.addColorStop(0, 'rgba(255, 30, 60, 0)');
      g.addColorStop(0.5, 'rgba(255, 30, 60, 0.22)');
      g.addColorStop(1, 'rgba(220, 0, 40, 1)');
      c.fillStyle = g;
      c.fillRect(-64, -64, 128, 128);
    });
  }

  reset(): void {
    this.plife.fill(0);
    this.rlife.fill(0);
    this.tage.fill(99);
    this.shake = 0;
    this.hitPulse = 0;
  }

  /** Screen-shake offset in world units for this frame. */
  shakeX(): number {
    const a = this.shake * this.shake * 7;
    return a ? a * (Math.sin(this.time * 83) * 0.6 + Math.sin(this.time * 137) * 0.4) : 0;
  }
  shakeY(): number {
    const a = this.shake * this.shake * 7;
    return a ? a * (Math.cos(this.time * 71) * 0.6 + Math.sin(this.time * 113) * 0.4) : 0;
  }

  onEvent(e: GameEvent, world: World, reduced: boolean): void {
    const p = world.player;
    const dist = world.distance;
    switch (e.type) {
      case 'start':
        this.ring(p.x, p.y, NaN, 30, 86, 0.7, 2.5, C_FOAM);
        break;
      case 'drop-impact': {
        if (e.onLeaf) {
          this.ring(e.x, e.y, NaN, e.r * 0.45, e.r * 1.5, 0.45, 3, C_FOAM);
          this.ring(e.x, e.y, NaN, e.r * 0.2, e.r * 1.05, 0.4, 1.8, C_FOAM, 0.06);
          this.burst(DROPLET, e.x, e.y, NaN, 12, 40, 120, C_DROP, 1.6, 0.55);
        } else {
          this.ring(e.x, e.y, dist, e.r * 0.4, e.r * 1.35, 0.5, 2.6, C_FOAM);
          this.ring(e.x, e.y, dist, e.r * 0.15, e.r * 0.9, 0.45, 1.5, C_FOAM, 0.08);
          this.burst(DROPLET, e.x, e.y, dist, 7, 30, 90, C_DROP, 1.4, 0.5);
          this.burst(FOAM, e.x, e.y, dist, 3, 6, 20, C_FOAM, 2.2, 0.6);
        }
        break;
      }
      case 'near-miss': {
        const tier = comboTier(e.combo);
        const col = COMBO_TIERS[tier];
        const ang = Math.atan2(e.y - p.y, e.x - p.x);
        // Whoosh: an arc on the side the drop fell, sweeping around the ant.
        this.ring(p.x, p.y, NaN, 20, 36, 0.36, 4, C_FOAM, 0, ang - 0.95, 1.9);
        this.ring(p.x, p.y, NaN, 26, 44, 0.36, 1.8, C_FOAM, 0.04, ang - 0.7, 1.4);
        for (let i = 0; i < 4 + tier; i++) {
          const a = ang + (Math.random() - 0.5) * 1.8;
          const r = 22 + Math.random() * 10;
          this.spawn(SPARK, p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, NaN, Math.cos(a) * 40, Math.sin(a) * 40, 0, 0, 0.35 + Math.random() * 0.2, 3 + Math.random() * 2, tier >= 2 ? C_GOLD : C_FOAM, Math.random() * TAU, 4);
        }
        this.text(p.x, p.y, e.points, world.multiplier, col);
        break;
      }
      case 'hit': {
        this.hitPulse = 1;
        this.hitSoft = reduced;
        if (!reduced) this.shake = Math.max(this.shake, 1);
        this.ring(e.x, e.y, NaN, 14, 52, 0.5, 5, C_DANGER);
        this.ring(e.x, e.y, NaN, 10, 30, 0.35, 2, C_FOAM, 0.05);
        if (e.source === 'drop') {
          this.burst(DROPLET, e.x, e.y, NaN, 16, 50, 140, C_DROP, 1.7, 0.6);
        } else {
          const col = e.source === 'rock' ? C_ROCK : C_BARK;
          this.burst(CHIP, e.x, e.y, NaN, 10, 40, 130, col, 2.2, 0.7);
          this.burst(CHIP, e.x, e.y, NaN, 4, 30, 90, C_LEAF, 2.4, 0.8);
          this.burst(FOAM, e.x, e.y, dist, 6, 10, 40, C_FOAM, 2.6, 0.7);
        }
        break;
      }
      case 'bank-bump': {
        const dir = -e.side;
        for (let i = 0; i < 8; i++) {
          const a = (Math.random() - 0.5) * 2.2;
          const sp = 20 + Math.random() * 45;
          this.spawn(FOAM, e.x, e.y + (Math.random() - 0.5) * 22, dist, Math.cos(a) * sp * dir, Math.sin(a) * sp, 0, 0, 0.5 + Math.random() * 0.3, 2 + Math.random() * 2, C_FOAM, 0, 0);
        }
        this.burst(DROPLET, e.x, e.y, dist, 5, 25, 70, C_DROP, 1.3, 0.45);
        break;
      }
      case 'combo-lost':
        this.ring(p.x, p.y, NaN, 36, 18, 0.35, 2, C_ROCK);
        break;
      case 'milestone':
        this.ring(p.x, p.y, NaN, 30, 76, 0.7, 3, C_GOLD);
        this.burst(SPARK, p.x, p.y, NaN, 10, 60, 120, C_GOLD, 3.5, 0.6);
        break;
      case 'new-best':
        this.ring(p.x, p.y, NaN, 24, 120, 0.9, 4, C_GOLD);
        this.ring(p.x, p.y, NaN, 16, 80, 0.7, 2, C_FOAM, 0.08);
        for (let i = 0; i < 56; i++) {
          const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.6;
          const sp = 120 + Math.random() * 200;
          this.spawn(CONF, p.x, p.y - 6, NaN, Math.cos(a) * sp, Math.sin(a) * sp, 0, 0, 1.4 + Math.random() * 0.8, 3 + Math.random() * 2.5, C_CONF0 + (i % CONFETTI.length), Math.random() * TAU, (Math.random() - 0.5) * 14);
        }
        break;
      case 'death':
        if (!reduced) this.shake = Math.max(this.shake, 1.15);
        this.ring(e.x, e.y, NaN, 20, 90, 0.9, 4, C_FOAM);
        this.ring(e.x, e.y, NaN, 10, 60, 0.8, 2.5, C_FOAM, 0.12);
        this.ring(e.x, e.y, NaN, 6, 40, 0.7, 1.5, C_FOAM, 0.3);
        this.burst(DROPLET, e.x, e.y, NaN, 30, 60, 180, C_DROP, 2, 0.8);
        this.burst(FOAM, e.x, e.y, NaN, 14, 15, 60, C_FOAM, 3, 1);
        break;
      case 'storm':
      case 'game-over':
        break;
    }
  }

  /** Occasional bubbles where the leaf went down. */
  bubble(x: number, y: number): void {
    this.spawn(BUBBLE, x + (Math.random() - 0.5) * 30, y + (Math.random() - 0.5) * 20, NaN, 0, -6, 0, 0, 0.9 + Math.random() * 0.6, 1.5 + Math.random() * 2.5, C_FOAM, 0, 0);
  }

  update(dt: number, ambientDt: number): void {
    this.time += ambientDt;
    // Shake and the hit pulse decay on the ambient clock so a pause can't freeze the screen mid-shake.
    this.shake = Math.max(0, this.shake - ambientDt * 3);
    this.hitPulse = Math.max(0, this.hitPulse - ambientDt * (this.hitSoft ? 1.3 : 2.4));
    if (dt <= 0) return;
    const drag = Math.exp(-3 * dt);
    const confDrag = Math.exp(-2.2 * dt);
    for (let i = 0; i < MAXP; i++) {
      if (this.plife[i] <= 0) continue;
      this.plife[i] -= dt;
      const k = this.pkind[i];
      this.px[i] += this.pvx[i] * dt;
      this.py[i] += this.pvy[i] * dt;
      if (k === DROPLET || k === CHIP) {
        this.pvz[i] -= 520 * dt;
        this.pz[i] += this.pvz[i] * dt;
        if (this.pz[i] < 0 && this.pvz[i] < 0) this.plife[i] = 0;
        this.prot[i] += this.pvr[i] * dt;
      } else if (k === FOAM) {
        this.pvx[i] *= drag;
        this.pvy[i] *= drag;
      } else if (k === CONF) {
        this.pvx[i] *= confDrag;
        this.pvy[i] = this.pvy[i] * confDrag + 140 * dt;
        this.prot[i] += this.pvr[i] * dt;
      } else if (k === SPARK) {
        this.pvx[i] *= drag;
        this.pvy[i] *= drag;
        this.prot[i] += this.pvr[i] * dt;
      }
    }
    for (let i = 0; i < MAXR; i++) {
      if (this.rlife[i] <= 0) continue;
      if (this.rdelay[i] > 0) this.rdelay[i] -= dt;
      else this.rlife[i] -= dt;
    }
    for (let i = 0; i < MAXT; i++) if (this.tage[i] < 9) this.tage[i] += dt;
  }

  /** Rings and particles (world space). */
  draw(g: Gfx): void {
    const { ctx } = g;
    g.world();
    ctx.lineCap = 'round';
    for (let i = 0; i < MAXR; i++) {
      if (this.rlife[i] <= 0 || this.rdelay[i] > 0) continue;
      const u = 1 - this.rlife[i] / this.rmax[i];
      const e = easeOutCubic(u);
      const r = this.r0[i] + (this.r1[i] - this.r0[i]) * e;
      const y = this.anchorY(g, this.ry[i], this.rd0[i]);
      // Whoosh arcs fade linearly so the sweep stays visible; rings ease out faster.
      ctx.globalAlpha = this.ralen[i] > 0 ? (1 - u) * 0.95 : (1 - u) * (1 - u) * 0.9;
      ctx.strokeStyle = COLORS[this.rcol[i]];
      ctx.lineWidth = this.rw[i] * (1 - u * 0.6);
      ctx.beginPath();
      if (this.ralen[i] > 0) {
        // Whoosh arcs also sweep around the ant as they expand.
        const a0 = this.ra0[i] + e * 0.6;
        ctx.arc(this.rx[i], y, r, a0, a0 + this.ralen[i] * (0.6 + 0.4 * e));
      } else {
        ctx.arc(this.rx[i], y, Math.max(0.1, r), 0, TAU);
      }
      ctx.stroke();
    }

    for (let i = 0; i < MAXP; i++) {
      const life = this.plife[i];
      if (life <= 0) continue;
      const lf = life / this.pmax[i];
      const k = this.pkind[i];
      const x = this.px[i];
      const y = this.anchorY(g, this.py[i], this.pd0[i]);
      const s = this.psize[i];
      ctx.fillStyle = COLORS[this.pcol[i]];
      if (k === DROPLET) {
        ctx.globalAlpha = Math.min(1, lf * 2.5) * 0.9;
        ctx.beginPath();
        ctx.arc(x, y - this.pz[i], s, 0, TAU);
        ctx.fill();
      } else if (k === FOAM) {
        ctx.globalAlpha = lf * 0.7;
        ctx.beginPath();
        ctx.arc(x, y, s * (1.6 - lf * 0.6), 0, TAU);
        ctx.fill();
      } else if (k === BUBBLE) {
        ctx.globalAlpha = Math.min(1, lf * 3) * 0.6;
        ctx.strokeStyle = COLORS[this.pcol[i]];
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.arc(x, y, s * (1.3 - lf * 0.3), 0, TAU);
        ctx.stroke();
      } else if (k === CONF || k === CHIP) {
        ctx.globalAlpha = Math.min(1, lf * 3);
        const rot = this.prot[i];
        // Confetti flips in 3D: squash one axis with the spin.
        const sy = k === CONF ? Math.cos(rot * 1.7) : 1;
        g.local(x, y - (k === CHIP ? this.pz[i] : 0), rot, 1);
        ctx.fillRect(-s / 2, (-s * 0.3) * sy, s, s * 0.6 * sy + 0.01);
        g.world();
      } else if (k === SPARK) {
        ctx.globalAlpha = lf;
        ctx.strokeStyle = COLORS[this.pcol[i]];
        ctx.lineWidth = 1.4;
        const r = s * (0.5 + (1 - lf) * 0.8);
        const c = Math.cos(this.prot[i]) * r;
        const sn = Math.sin(this.prot[i]) * r;
        ctx.beginPath();
        ctx.moveTo(x - c, y - sn);
        ctx.lineTo(x + c, y + sn);
        ctx.moveTo(x + sn, y - c);
        ctx.lineTo(x - sn, y + c);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Floating texts, drawn above the weather so they stay crisp. */
  drawTexts(g: Gfx): void {
    const { ctx } = g;
    let any = false;
    for (let i = 0; i < MAXT; i++) if (this.tage[i] < TEXT_LIFE) any = true;
    if (!any) return;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (let i = 0; i < MAXT; i++) {
      const a = this.tage[i];
      if (a >= TEXT_LIFE) continue;
      const pop = g.reduced ? 1 : a < 0.2 ? Math.max(0.01, easeOutBack(a / 0.2)) : 1;
      const rise = textRise(a);
      ctx.globalAlpha = a > 0.6 ? 1 - (a - 0.6) / 0.35 : 1;
      const hasMult = this.tb[i] !== '';
      g.local(this.tx[i], this.ty[i] - rise, 0, pop);
      ctx.font = NEAR_MISS_FONT;
      ctx.textAlign = hasMult ? 'right' : 'center';
      const ax = hasMult ? this.taw[i] : 0;
      ctx.strokeStyle = P.ink;
      ctx.lineWidth = 4.5;
      ctx.strokeText(this.ta[i], ax, 0);
      ctx.fillStyle = this.tcol[i];
      ctx.fillText(this.ta[i], ax, 0);
      if (hasMult) {
        ctx.font = MULT_FONT;
        ctx.textAlign = 'left';
        ctx.lineWidth = 3.6;
        ctx.strokeText(this.tb[i], ax + 3, 1.5);
        ctx.fillStyle = P.white;
        ctx.fillText(this.tb[i], ax + 3, 1.5);
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Red hit vignette (device space). */
  drawVignette(g: Gfx): void {
    if (this.hitPulse <= 0 || !this.vignette) return;
    const { ctx } = g;
    // Reduced motion: a soft fade instead of a flash.
    const a = this.hitSoft ? Math.sin(this.hitPulse * Math.PI) * 0.35 : Math.min(1, this.hitPulse * 1.25) * 0.85;
    g.screen();
    ctx.globalAlpha = a;
    ctx.drawImage(this.vignette.img, 0, 0, g.cw, g.ch);
    if (!this.hitSoft && this.hitPulse > 0.75) {
      // A single-frame-ish red wash on impact; never with reduced motion.
      ctx.globalAlpha = (this.hitPulse - 0.75) * 0.45;
      ctx.fillStyle = P.danger;
      ctx.fillRect(0, 0, g.cw, g.ch);
    }
    ctx.globalAlpha = 1;
  }

  private anchorY(g: Gfx, y: number, d0: number): number {
    return d0 === d0 ? y + (g.dist - d0) : y;
  }

  private spawn(
    kind: number,
    x: number,
    y: number,
    d0: number,
    vx: number,
    vy: number,
    z: number,
    vz: number,
    life: number,
    size: number,
    col: number,
    rot: number,
    vr: number,
  ): void {
    const i = this.pNext;
    this.pNext = (i + 1) % MAXP;
    this.pkind[i] = kind;
    this.px[i] = x;
    this.py[i] = y;
    this.pd0[i] = d0;
    this.pvx[i] = vx;
    this.pvy[i] = vy;
    this.pz[i] = z;
    this.pvz[i] = vz;
    this.plife[i] = life;
    this.pmax[i] = life;
    this.psize[i] = size;
    this.pcol[i] = col;
    this.prot[i] = rot;
    this.pvr[i] = vr;
  }

  /** Radial burst; droplets and chips also get an upward (z) kick so they arc. */
  private burst(kind: number, x: number, y: number, d0: number, n: number, sMin: number, sMax: number, col: number, size: number, life: number): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const sp = sMin + Math.random() * (sMax - sMin);
      const airborne = kind === DROPLET || kind === CHIP;
      this.spawn(
        kind,
        x + Math.cos(a) * 3,
        y + Math.sin(a) * 3,
        d0,
        Math.cos(a) * sp,
        Math.sin(a) * sp * 0.8,
        airborne ? 1 : 0,
        airborne ? 60 + Math.random() * 110 : 0,
        life * (0.7 + Math.random() * 0.6),
        size * (0.6 + Math.random() * 0.6),
        col,
        Math.random() * TAU,
        (Math.random() - 0.5) * 16,
      );
    }
  }

  private ring(x: number, y: number, d0: number, r0: number, r1: number, life: number, w: number, col: number, delay = 0, a0 = 0, alen = 0): void {
    const i = this.rNext;
    this.rNext = (i + 1) % MAXR;
    this.rx[i] = x;
    this.ry[i] = y;
    this.rd0[i] = d0;
    this.r0[i] = r0;
    this.r1[i] = r1;
    this.rlife[i] = life;
    this.rmax[i] = life;
    this.rw[i] = w;
    this.rcol[i] = col;
    this.rdelay[i] = delay;
    this.ra0[i] = a0;
    this.ralen[i] = alen;
  }

  private text(x: number, y: number, points: number, mult: number, col: string): void {
    const last = (this.tNext + MAXT - 1) % MAXT;
    const lastAge = this.tage[last];
    let i: number;
    if (lastAge < TEXT_MERGE_WINDOW) {
      // Chain: fold into the live text instead of piling new ones on top of it.
      // Re-anchor so the restarted rise continues from where it is on screen.
      i = last;
      this.ty[i] += textRise(lastAge) - textRise(TEXT_MERGE_AGE);
      this.tage[i] = TEXT_MERGE_AGE;
      this.tpts[i] += points;
    } else {
      i = this.tNext;
      this.tNext = (i + 1) % MAXT;
      this.tx[i] = Math.min(360, Math.max(40, x));
      this.ty[i] = y - 44;
      this.tage[i] = 0;
      this.tpts[i] = points;
    }
    this.tcol[i] = col;
    this.ta[i] = `+${Math.round(this.tpts[i])}`;
    this.tb[i] = mult > 1 ? `×${Number.isInteger(mult) ? mult : mult.toFixed(1)}` : '';
    const m = this.measure;
    if (m && this.tb[i]) {
      m.font = NEAR_MISS_FONT;
      const wa = m.measureText(this.ta[i]).width;
      m.font = MULT_FONT;
      const wb = m.measureText(this.tb[i]).width + 3;
      // Right edge of the points text, chosen so "+25 ×2.5" is centred on the ant as a pair.
      this.taw[i] = wa - (wa + wb) / 2;
    } else {
      this.taw[i] = 0;
    }
  }
}
