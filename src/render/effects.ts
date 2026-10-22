// Transient effects spawned from game events: pooled particles (struct of
// arrays, nothing allocated per frame), rings and whoosh arcs, floating
// near-miss text, screen shake and the hit vignette. Effects on the water are
// anchored to the river (they scroll with it); effects on the leaf or in the
// air are anchored to the screen (they stay with the ant).
//
// Phase 2 adds pickup feedback: crumb sparkles and an aggregated "+N" label,
// the Perfect-trail banner, power-up pops, the mushroom shield shattering into
// petals, rising hearts for a heal and a splash for a lily-pad bump. Labels and
// icon pops live in their own small pools so they never evict near-miss texts.

import type { GameEvent, PickupKind, World } from '../types';
import { makeSprite, type Gfx, type Sprite } from './gfx';
import { COMBO_TIERS, CONFETTI, FONT_FAMILY, P, comboTier } from './palette';
import { iconSprite, type IconKind } from './pickups';
import { TAU, clamp01, easeOutBack, easeOutCubic } from './util';

const MAXP = 520;
const MAXR = 64;
const MAXT = 8;
/** Pickup labels ("+30", "PERFECT TRAIL") and power-up icon pops. */
const MAXL = 4;
const MAXI = 3;
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
const HEART = 6;
const PETAL = 7;
const PUFF = 8;

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
  '#fff3cf', // cream
  '#ff5c52', // mushroom red
  '#ffb82e', // honey amber
  '#ff80ac', // ladybug pink
  '#ceff5c', // firefly lime
  '#ff4d6d', // heart
  '#fff7ea', // cap spot
];
const C_FOAM = 0;
const C_DROP = 1;
const C_BARK = 2;
const C_ROCK = 3;
const C_LEAF = 4;
const C_GOLD = 5;
const C_DANGER = 6;
const C_CONF0 = 7;
const C_CREAM = C_CONF0 + CONFETTI.length;
const C_RED = C_CREAM + 1;
const C_AMBER = C_CREAM + 2;
const C_PINK = C_CREAM + 3;
const C_LIME = C_CREAM + 4;
const C_HEART = C_CREAM + 5;
const C_SPOT = C_CREAM + 6;

/** Particle colour of a pickup kind. */
function kindColor(kind: PickupKind): number {
  return kind === 'mushroom' ? C_RED : kind === 'honey' ? C_AMBER : kind === 'ladybug' ? C_PINK : kind === 'firefly' ? C_LIME : C_CREAM;
}

// Pickup labels: style 0 is the crumb total, style 1 a banner.
const LABEL_LIFE = [0.85, 1.4] as const;
const LABEL_RISE = [22, 30] as const;
const LABEL_FONTS = [`700 15px ${FONT_FAMILY}`, `700 18px ${FONT_FAMILY}`] as const;
const LABEL_OUTLINE = [4, 5] as const;
/** A crumb within this long of the last one folds into its label, so a trail reads as one growing total. */
const LABEL_MERGE_WINDOW = 0.55;
const LABEL_MERGE_AGE = 0.1;
/** Power-up icon pop: seconds, rise (units). */
const ICON_LIFE = 1;
const ICON_RISE = 26;
const labelRise = (style: number, age: number) => easeOutCubic(clamp01(age / LABEL_LIFE[style])) * LABEL_RISE[style];

const ICON_ORDER: readonly IconKind[] = ['mushroom', 'honey', 'ladybug', 'firefly'];
const CRUMB_TEXT = '#fff1b8';

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

  // Pickup labels and icon pops.
  private lx = new Float32Array(MAXL);
  private ly = new Float32Array(MAXL);
  private lage = new Float32Array(MAXL).fill(99);
  private lstyle = new Uint8Array(MAXL);
  private lpts = new Float32Array(MAXL);
  private lcol: string[] = new Array<string>(MAXL).fill('#fff');
  private ltext: string[] = new Array<string>(MAXL).fill('');
  private lNext = 0;
  /** Slot of the live crumb total, or -1. */
  private crumbLabel = -1;
  private ix = new Float32Array(MAXI);
  private iy = new Float32Array(MAXI);
  private iage = new Float32Array(MAXI).fill(99);
  private ikind = new Uint8Array(MAXI);
  private iNext = 0;
  /** Effect clock of the last shield block (the cap's power-end must not add a puff on top of the shatter). */
  private blockAt = -9;

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
    this.lage.fill(99);
    this.iage.fill(99);
    this.crumbLabel = -1;
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
      case 'pickup': {
        if (e.kind === 'crumb') {
          // A small sparkle pop where it was plucked (a longer streak pops a little bigger), and a couple of hopping bits.
          const n = 3 + Math.min(3, e.streak >> 1);
          for (let i = 0; i < n; i++) {
            const a = Math.random() * TAU;
            const sp = 28 + Math.random() * 40;
            this.spawn(SPARK, e.x, e.y, dist, Math.cos(a) * sp, Math.sin(a) * sp, 0, 0, 0.28 + Math.random() * 0.2, 3 + Math.random() * 2, i & 1 ? C_CREAM : C_GOLD, Math.random() * TAU, 5);
          }
          this.burst(CHIP, e.x, e.y, dist, 2, 14, 34, C_CREAM, 1.8, 0.45);
          this.crumbTotal(p.x, p.y, e.points);
          break;
        }
        // A power-up: its bubble pops in the colour of the kind, and the icon pops up over the ant.
        const col = kindColor(e.kind);
        this.ring(e.x, e.y, dist, 6, 40, 0.45, 3, col);
        this.ring(e.x, e.y, dist, 4, 26, 0.4, 1.6, C_FOAM, 0.04);
        for (let i = 0; i < 10; i++) {
          const a = Math.random() * TAU;
          const sp = 60 + Math.random() * 70;
          this.spawn(SPARK, e.x, e.y, dist, Math.cos(a) * sp, Math.sin(a) * sp, 0, 0, 0.45 + Math.random() * 0.25, 3 + Math.random() * 2.2, col, Math.random() * TAU, 6);
        }
        for (let i = 0; i < 7; i++) {
          const a = Math.random() * TAU;
          const sp = 25 + Math.random() * 40;
          this.spawn(BUBBLE, e.x + Math.cos(a) * 10, e.y + Math.sin(a) * 10, dist, Math.cos(a) * sp, Math.sin(a) * sp, 0, 0, 0.5 + Math.random() * 0.3, 2 + Math.random() * 1.6, C_FOAM, 0, 0);
        }
        this.iconPop(p.x, p.y, e.kind);
        // A ladybug at full hearts pays points instead of healing.
        if (e.points > 0) this.banner(p.x, p.y - 56, `+${e.points}`, P.gold);
        break;
      }
      case 'trail-complete': {
        this.ring(p.x, p.y, NaN, 22, 94, 0.8, 4, C_GOLD);
        this.ring(p.x, p.y, NaN, 14, 62, 0.65, 2, C_CREAM, 0.08);
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * TAU + Math.random() * 0.3;
          const sp = 90 + Math.random() * 90;
          this.spawn(SPARK, p.x + Math.cos(a) * 16, p.y + Math.sin(a) * 16, NaN, Math.cos(a) * sp, Math.sin(a) * sp, 0, 0, 0.5 + Math.random() * 0.35, 3 + Math.random() * 2.5, i & 1 ? C_GOLD : C_CREAM, Math.random() * TAU, 5);
        }
        for (let i = 0; i < 8; i++) {
          const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
          const sp = 90 + Math.random() * 110;
          this.spawn(CONF, p.x, p.y - 6, NaN, Math.cos(a) * sp, Math.sin(a) * sp, 0, 0, 0.9 + Math.random() * 0.5, 3 + Math.random() * 1.8, i & 1 ? C_GOLD : C_CREAM, Math.random() * TAU, (Math.random() - 0.5) * 14);
        }
        this.banner(p.x, p.y - 66, `PERFECT TRAIL +${e.points}`, P.gold);
        break;
      }
      case 'power-start': {
        const col = kindColor(e.kind);
        this.ring(p.x, p.y, NaN, 24, 80, 0.6, 3.5, col);
        this.ring(p.x, p.y, NaN, 16, 56, 0.5, 2, C_FOAM, 0.07);
        const n = reduced ? 6 : 12;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU + Math.random() * 0.4;
          this.spawn(SPARK, p.x + Math.cos(a) * 20, p.y + Math.sin(a) * 20, NaN, Math.cos(a) * 80, Math.sin(a) * 80, 0, 0, 0.4 + Math.random() * 0.2, 3 + Math.random() * 2, col, Math.random() * TAU, 4);
        }
        break;
      }
      case 'power-end': {
        // The cap already shattered if a hit ended it: no second puff on top.
        if (e.kind === 'mushroom' && this.time - this.blockAt < 0.3) break;
        const col = kindColor(e.kind);
        this.ring(p.x, p.y, NaN, 34, 16, 0.4, 2, col);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU + Math.random() * 0.6;
          const r = 12 + Math.random() * 10;
          this.spawn(PUFF, p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, NaN, Math.cos(a) * 18, Math.sin(a) * 18, 0, 0, 0.6 + Math.random() * 0.3, 5 + Math.random() * 3, col, 0, 0);
        }
        break;
      }
      case 'shield-block': {
        // The cap takes the hit: it bursts into petals. Deliberately no red vignette; a small thump unless reduced motion.
        this.blockAt = this.time;
        if (!reduced) this.shake = Math.max(this.shake, 0.4);
        const ang = Math.atan2(e.y - p.y, e.x - p.x);
        this.ring(p.x, p.y, NaN, 22, 84, 0.55, 4.5, C_RED);
        this.ring(p.x, p.y, NaN, 16, 56, 0.45, 2, C_FOAM, 0.05);
        this.ring(p.x, p.y, NaN, 26, 44, 0.32, 3.5, C_FOAM, 0, ang - 0.8, 1.6);
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * TAU + Math.random() * 0.4;
          const sp = 70 + Math.random() * 90;
          const r = 16 + Math.random() * 8;
          this.spawn(PETAL, p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, NaN, Math.cos(a) * sp, Math.sin(a) * sp, 0, 0, 0.6 + Math.random() * 0.4, 4.4 + Math.random() * 3, i % 3 === 2 ? C_SPOT : C_RED, Math.random() * TAU, (Math.random() - 0.5) * 16);
        }
        if (e.source === 'drop') this.burst(DROPLET, e.x, e.y, NaN, 8, 30, 90, C_DROP, 1.4, 0.5);
        else this.burst(CHIP, e.x, e.y, NaN, 8, 30, 100, e.source === 'rock' ? C_ROCK : C_BARK, 2, 0.6);
        break;
      }
      case 'heal':
        this.ring(p.x, p.y, NaN, 16, 58, 0.6, 3, C_PINK);
        for (let i = 0; i < 7; i++) {
          // Fanned out to both sides of the ant so the hearts never sit on top of it.
          const side = i & 1 ? 1 : -1;
          this.spawn(HEART, p.x + side * (12 + Math.random() * 16), p.y - 8 + Math.random() * 12, NaN, 0, -(42 + Math.random() * 48), 0, 0, 0.95 + Math.random() * 0.5, 4.4 + Math.random() * 2.4, i % 3 ? C_HEART : C_PINK, Math.random() * TAU, 2.5 + Math.random() * 2.5);
        }
        break;
      case 'pad-bump':
        this.ring(e.x, e.y, dist, 6, 38, 0.55, 3, C_FOAM);
        this.ring(e.x, e.y, dist, 3, 24, 0.5, 1.8, C_FOAM, 0.08);
        this.burst(FOAM, e.x, e.y, dist, 6, 10, 34, C_FOAM, 2.4, 0.55);
        this.burst(DROPLET, e.x, e.y, dist, 5, 22, 65, C_DROP, 1.3, 0.45);
        break;
      case 'storm':
      case 'zone':
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
    const heartDrag = Math.exp(-1.1 * dt);
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
      } else if (k === SPARK || k === PETAL) {
        this.pvx[i] *= drag;
        this.pvy[i] *= drag;
        this.prot[i] += this.pvr[i] * dt;
      } else if (k === HEART) {
        // Rises, easing off, swaying on its own phase.
        this.px[i] += Math.sin(this.prot[i]) * 14 * dt;
        this.prot[i] += this.pvr[i] * dt;
        this.pvy[i] *= heartDrag;
      } else if (k === PUFF) {
        this.pvx[i] *= drag;
        this.pvy[i] *= drag;
      }
    }
    for (let i = 0; i < MAXR; i++) {
      if (this.rlife[i] <= 0) continue;
      if (this.rdelay[i] > 0) this.rdelay[i] -= dt;
      else this.rlife[i] -= dt;
    }
    for (let i = 0; i < MAXT; i++) if (this.tage[i] < 9) this.tage[i] += dt;
    for (let i = 0; i < MAXL; i++) if (this.lage[i] < 9) this.lage[i] += dt;
    for (let i = 0; i < MAXI; i++) if (this.iage[i] < 9) this.iage[i] += dt;
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
      } else if (k === HEART) {
        ctx.globalAlpha = Math.min(1, lf * 2.2) * 0.95;
        // Pops in over the first moments, then drifts up.
        const hs = s * Math.min(1, (1 - lf) * 7 + 0.25);
        ctx.beginPath();
        ctx.moveTo(x, y + hs * 0.95);
        ctx.bezierCurveTo(x - hs * 1.7, y - hs * 0.1, x - hs * 0.85, y - hs * 1.3, x, y - hs * 0.45);
        ctx.bezierCurveTo(x + hs * 0.85, y - hs * 1.3, x + hs * 1.7, y - hs * 0.1, x, y + hs * 0.95);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = P.ink;
        ctx.lineWidth = 1;
        ctx.globalAlpha *= 0.55;
        ctx.stroke();
      } else if (k === PETAL) {
        ctx.globalAlpha = Math.min(1, lf * 2.5);
        const rot = this.prot[i];
        // Tumbles: the petal flips as it spins.
        const flip = 0.25 + 0.75 * Math.abs(Math.cos(rot * 1.3));
        g.local(x, y, rot, 1);
        ctx.beginPath();
        ctx.moveTo(-s, 0);
        ctx.quadraticCurveTo(0, -s * 0.8 * flip, s, 0);
        ctx.quadraticCurveTo(0, s * 0.8 * flip, -s, 0);
        ctx.fill();
        g.world();
      } else if (k === PUFF) {
        ctx.globalAlpha = lf * 0.5;
        ctx.beginPath();
        ctx.arc(x, y, s * (0.6 + (1 - lf) * 1.3), 0, TAU);
        ctx.fill();
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

  /** Floating texts and icon pops, drawn above the weather so they stay crisp. */
  drawTexts(g: Gfx): void {
    const { ctx } = g;
    let any = false;
    for (let i = 0; i < MAXT; i++) if (this.tage[i] < TEXT_LIFE) any = true;
    for (let i = 0; i < MAXL; i++) if (this.lage[i] < LABEL_LIFE[this.lstyle[i]]) any = true;
    for (let i = 0; i < MAXI; i++) if (this.iage[i] < ICON_LIFE) any = true;
    if (!any) return;

    // Power-up icons popping over the ant.
    for (let i = 0; i < MAXI; i++) {
      const a = this.iage[i];
      if (a >= ICON_LIFE) continue;
      const spr = iconSprite(ICON_ORDER[this.ikind[i]]);
      if (!spr) continue;
      const pop = g.reduced || a >= 0.28 ? 1 : Math.max(0.01, easeOutBack(a / 0.28));
      const settle = 1.2 - 0.2 * clamp01((a - 0.28) / 0.4);
      ctx.globalAlpha = a > 0.65 ? 1 - (a - 0.65) / 0.35 : 1;
      g.sprite(spr, this.ix[i], this.iy[i] - easeOutCubic(a / ICON_LIFE) * ICON_RISE, 0, (0.15 + 0.85 * pop) * settle * 1.15);
    }

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

    // Pickup labels: the crumb total and the banners.
    ctx.textAlign = 'center';
    for (let i = 0; i < MAXL; i++) {
      const a = this.lage[i];
      const st = this.lstyle[i];
      const life = LABEL_LIFE[st];
      if (a >= life) continue;
      const pop = g.reduced ? 1 : a < 0.18 ? Math.max(0.01, easeOutBack(a / 0.18)) : 1;
      ctx.globalAlpha = a > life * 0.62 ? 1 - (a - life * 0.62) / (life * 0.38) : 1;
      g.local(this.lx[i], this.ly[i] - labelRise(st, a), 0, pop);
      ctx.font = LABEL_FONTS[st];
      ctx.strokeStyle = P.ink;
      ctx.lineWidth = LABEL_OUTLINE[st];
      ctx.strokeText(this.ltext[i], 0, 0);
      ctx.fillStyle = this.lcol[i];
      ctx.fillText(this.ltext[i], 0, 0);
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

  private newLabel(x: number, y: number, style: number, text: string, col: string, points: number): number {
    const i = this.lNext;
    this.lNext = (i + 1) % MAXL;
    this.lx[i] = x;
    this.ly[i] = y;
    this.lage[i] = 0;
    this.lstyle[i] = style;
    this.lpts[i] = points;
    this.ltext[i] = text;
    this.lcol[i] = col;
    return i;
  }

  /** The running "+N" for crumbs: each new crumb within the window grows the live label instead of adding another. */
  private crumbTotal(px: number, py: number, points: number): void {
    let i = this.crumbLabel;
    if (i >= 0 && this.lstyle[i] === 0 && this.lage[i] < LABEL_MERGE_WINDOW) {
      // Re-anchor so the restarted rise continues from where the label is on screen.
      this.ly[i] += labelRise(0, this.lage[i]) - labelRise(0, LABEL_MERGE_AGE);
      this.lage[i] = LABEL_MERGE_AGE;
      this.lpts[i] += points;
    } else {
      // Beside the ant (the open side), clear of the near-miss text above it.
      const side = px < 200 ? 1 : -1;
      i = this.newLabel(Math.min(366, Math.max(34, px + side * 34)), py - 18, 0, '', CRUMB_TEXT, points);
      this.crumbLabel = i;
    }
    this.ltext[i] = `+${Math.round(this.lpts[i])}`;
  }

  /** A one-off banner label centred over x (kept inside the field). */
  private banner(x: number, y: number, text: string, col: string): void {
    let cx = x;
    const m = this.measure;
    if (m) {
      m.font = LABEL_FONTS[1];
      const half = m.measureText(text).width / 2 + 8;
      cx = Math.min(400 - half, Math.max(half, x));
    }
    this.newLabel(cx, y, 1, text, col, 0);
  }

  private iconPop(x: number, y: number, kind: IconKind): void {
    const i = this.iNext;
    this.iNext = (i + 1) % MAXI;
    this.ix[i] = Math.min(370, Math.max(30, x));
    this.iy[i] = y - 42;
    this.iage[i] = 0;
    this.ikind[i] = ICON_ORDER.indexOf(kind);
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
    this.tb[i] = mult > 1 ? multLabel(mult) : '';
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

/** "×2.25": the same text as the HUD (fmtMult), cached since the multiplier has only a handful of values. */
const multLabels = new Map<number, string>();
function multLabel(mult: number): string {
  let s = multLabels.get(mult);
  if (s === undefined) {
    s = `×${Math.round(mult * 100) / 100}`;
    multLabels.set(mult, s);
  }
  return s;
}
