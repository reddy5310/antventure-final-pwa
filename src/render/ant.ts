// The ant, drawn live so it can animate: tripod walk cycle, elbowed antennae,
// big expressive eyes (they track steering and incoming drops), wet gloss,
// hurt flash, invulnerability shield and death flailing. Dark body + light
// outline glints keep it readable on the light-green leaf by luminance alone.
// Skins (src/meta/skins.ts) swap the palette and add a pattern: stripes, a glow
// halo or a slow shine. The body drawing is `drawAnt`, shared with the shop
// preview (preview.ts), so what you buy is exactly what you play.

import type { Skin, SkinPalette, World } from '../types';
import { skinById } from '../meta/skins';
import type { Gfx, Sprite } from './gfx';
import { makeSprite } from './gfx';
import type { LeafPose } from './leaf';
import { P } from './palette';
import { TAU, clamp, clamp01 } from './util';

// Leg geometry for the right side (the left mirrors it): attach, knee, foot.
const LEGS = [
  [2.3, -2.4, 7.0, -5.8, 8.2, -11.6],
  [2.9, -0.4, 8.4, -0.9, 12.3, 1.4],
  [2.5, 1.6, 7.3, 4.9, 9.6, 11.2],
] as const;
// Tripod gait: front+hind on one side move with the middle leg of the other.
const PHASE_R = [Math.PI, 0, Math.PI] as const;
const PHASE_L = [0, Math.PI, 0] as const;

const BEADS: readonly [number, number, number][] = [
  [-2.6, 7.4, 1.15],
  [2.4, 10.4, 0.95],
  [1.9, -7.2, 0.85],
];

/** Everything `drawAnt` needs besides the palette. One object is reused per caller, never reallocated. */
export interface AntLook {
  /** Ambient clock (s): antenna wiggle, glow pulse, shine sweep. */
  t: number;
  /** Leg phase (rad) and swing amplitude. */
  walk: number;
  amp: number;
  /** Eye direction (unit-ish). */
  lookX: number;
  lookY: number;
  /** Dying: flailing antennae and X eyes. */
  dying: boolean;
  /** Squeezed-shut eyes. */
  hurt: boolean;
  /** White hit flash frame, or the reduced-motion red tint. */
  flash: boolean;
  redTint: boolean;
  wet: number;
  alpha: number;
  reduced: boolean;
}

export function newAntLook(): AntLook {
  return { t: 0, walk: 0, amp: 0.1, lookX: 0, lookY: -1, dying: false, hurt: false, flash: false, redTint: false, wet: 0, alpha: 1, reduced: false };
}

// Glow halos are rendered once per accent colour and reused (never a per-frame gradient).
const glowCache = new Map<string, Sprite>();

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** The soft halo sprite for a glow skin, or null for any other pattern. */
export function glowFor(pal: SkinPalette): Sprite | null {
  if (pal.pattern !== 'glow') return null;
  let s = glowCache.get(pal.accent);
  if (!s) {
    // 3 px per unit is plenty for a blurry halo and keeps the sprite tiny. It
    // fades to nothing inside the sprite, so no hard edge shows, and it is small
    // enough to sit inside the shop preview frame.
    s = makeSprite(44, 62, 3, (c) => {
      c.scale(44 / 62, 1);
      const gr = c.createRadialGradient(0, 0, 0, 0, 0, 31);
      gr.addColorStop(0, hexA(pal.accent, 0.62));
      gr.addColorStop(0.55, hexA(pal.accent, 0.3));
      gr.addColorStop(1, hexA(pal.accent, 0));
      c.fillStyle = gr;
      c.fillRect(-31, -31, 62, 62);
    });
    glowCache.set(pal.accent, s);
  }
  return s;
}

export class AntArt {
  private walk = 0;
  private lookX = 0;
  private lookY = -1;
  private pal: SkinPalette = skinById('classic').palette;
  private glow: Sprite | null = null;
  private readonly look = newAntLook();

  /** Draw with this skin's palette from now on. Cheap no-op when the skin is unchanged. */
  setSkin(skin: Skin): void {
    if (skin.palette === this.pal) return;
    this.pal = skin.palette;
    this.glow = glowFor(skin.palette);
  }

  reset(): void {
    this.walk = 0;
    this.lookX = 0;
    this.lookY = -1;
  }

  draw(g: Gfx, world: World, leaf: LeafPose): void {
    const p = world.player;
    const dying = world.state === 'dying' || world.state === 'over';
    if (dying && leaf.sink >= 1) return;
    const { ctx } = g;

    // Animation drivers.
    const speed = clamp01(Math.abs(p.vx) / 200);
    const flail = dying ? 1 : 0;
    this.walk += g.dt * (flail ? 30 : 2.2 + 15 * speed);
    const amp = flail ? 0.6 : 0.07 + 0.3 * speed;

    // Eyes: look where we steer, or at the most urgent drop nearby.
    let tx = clamp(p.vx / 260, -1, 1);
    let ty = -0.6;
    let best = 0;
    for (let i = 0; i < world.drops.length; i++) {
      const d = world.drops[i];
      const dx = d.x - p.x;
      const dy = d.y - p.y;
      const dist2 = dx * dx + dy * dy;
      const t = d.fall > 0 ? d.age / d.fall : 1;
      if (t < 0.45 || dist2 > 110 * 110) continue;
      const urgency = t - Math.sqrt(dist2) / 300;
      if (urgency > best) {
        best = urgency;
        const inv = 1 / Math.max(1, Math.sqrt(dist2));
        tx = dx * inv;
        ty = dy * inv;
      }
    }
    const ease = 1 - Math.exp(-g.dt * 14);
    this.lookX += (tx - this.lookX) * ease;
    this.lookY += (ty - this.lookY) * ease;

    // State looks.
    let alpha = leaf.alpha;
    if (p.invuln > 0 && p.hurt <= 0 && !dying) {
      alpha *= g.reduced ? 0.7 : Math.floor(g.t * 12) % 2 === 0 ? 0.4 : 1;
    }
    const a = this.look;
    a.t = g.t;
    a.walk = this.walk;
    a.amp = amp;
    a.lookX = this.lookX;
    a.lookY = this.lookY;
    a.dying = dying;
    a.hurt = p.hurt > 0;
    a.flash = p.hurt > 0 && !g.reduced && Math.floor(g.t * 22) % 2 === 0;
    a.redTint = p.hurt > 0 && g.reduced;
    a.wet = clamp01(p.wet);
    a.alpha = alpha;
    a.reduced = g.reduced;

    const lean = dying ? Math.sin(g.t * 9) * 0.3 : clamp(p.vx / 700, -0.22, 0.22);
    g.local(leaf.x, leaf.y, leaf.rot + lean, leaf.scale);
    drawAnt(ctx, this.pal, this.glow, a);

    // Invulnerability shield: a soft bubble that reads even without the blink.
    if (p.invuln > 0 && !dying) {
      const k = clamp01(p.invuln / 0.4);
      ctx.globalAlpha = 0.5 * k;
      ctx.strokeStyle = P.waterLight;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(0, -1, 19 + (g.reduced ? 0 : Math.sin(g.t * 8) * 0.8), 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.globalAlpha = 0.7 * k;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(0, -1, 16.5, Math.PI * 1.1, Math.PI * 1.4);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}

/**
 * Draws the ant centred on the current transform (head up, units as in LEGS).
 * Shared by the game and the shop preview. Leaves globalAlpha at `a.alpha`.
 */
export function drawAnt(ctx: CanvasRenderingContext2D, pal: SkinPalette, glow: Sprite | null, a: AntLook): void {
  const { alpha, flash, wet, dying } = a;
  const body = flash ? '#ffffff' : pal.body;
  const bodyHi = flash ? '#ffe1e1' : pal.mid;
  const limb = flash ? '#ffffff' : pal.outline;

  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Contact shadow on the leaf.
  ctx.fillStyle = 'rgba(16, 52, 18, 0.32)';
  ctx.beginPath();
  ctx.ellipse(1.4, 2.4, 8.5, 14.5, 0, 0, TAU);
  ctx.fill();

  // Glow skins: the halo sits under the ant and breathes slowly.
  if (glow) {
    ctx.globalAlpha = alpha * (a.reduced ? 0.9 : 0.82 + 0.18 * Math.sin(a.t * 3));
    ctx.drawImage(glow.img, -glow.w / 2, -2 - glow.h / 2, glow.w, glow.h);
    ctx.globalAlpha = alpha;
  }

  // Legs.
  ctx.strokeStyle = limb;
  ctx.lineWidth = 1.75;
  ctx.beginPath();
  for (let side = -1; side <= 1; side += 2) {
    for (let li = 0; li < 3; li++) {
      const L = LEGS[li];
      const ph = side > 0 ? PHASE_R[li] : PHASE_L[li];
      const sw = Math.sin(a.walk + ph) * a.amp * side;
      const c = Math.cos(sw);
      const s = Math.sin(sw);
      const ax = L[0] * side;
      const ay = L[1];
      const kx = (L[2] - L[0]) * side;
      const ky = L[3] - L[1];
      const fx = (L[4] - L[0]) * side;
      const fy = L[5] - L[1];
      // Foot lifts (shortens) on the forward swing.
      const lift = 1 - Math.max(0, Math.cos(a.walk + ph)) * a.amp * 0.35;
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax + kx * c - ky * s, ay + kx * s + ky * c);
      ctx.lineTo(ax + (fx * c - fy * s) * lift, ay + (fx * s + fy * c) * lift);
    }
  }
  ctx.stroke();

  // Antennae: elbowed, wiggling; wild while flailing.
  const at = a.t * (dying ? 3 : 1);
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  for (let side = -1; side <= 1; side += 2) {
    const w1 = Math.sin(at * 4.3 + side) * 0.9;
    const w2 = Math.sin(at * 5.7 + side * 2.1) * 1.7 + Math.sin(at * 1.3 + side) * 0.8;
    const bx = 1.9 * side;
    const by = -12.2;
    const ex = (5 + w1) * side;
    const ey = -15.6 + w1 * 0.4;
    const tipx = (3.4 + w2) * side + a.lookX * 1.2;
    const tipy = -21.6 + Math.abs(w2) * 0.3;
    ctx.moveTo(bx, by);
    ctx.lineTo(ex, ey);
    ctx.quadraticCurveTo((ex + tipx) / 2 + side * 0.8, (ey + tipy) / 2, tipx, tipy);
  }
  ctx.stroke();
  ctx.fillStyle = limb;
  for (let side = -1; side <= 1; side += 2) {
    const w2 = Math.sin(at * 5.7 + side * 2.1) * 1.7 + Math.sin(at * 1.3 + side) * 0.8;
    ctx.beginPath();
    ctx.arc((3.4 + w2) * side + a.lookX * 1.2, -21.6 + Math.abs(w2) * 0.3, 1.15, 0, TAU);
    ctx.fill();
  }

  // Body: abdomen, petiole, thorax, head.
  ctx.strokeStyle = pal.outline;
  ctx.lineWidth = 1.1;
  ctx.fillStyle = body;
  part(ctx, 0, 8.6, 6.3, 7.5);
  part(ctx, 0, 3.3, 1.6, 1.6);
  part(ctx, 0, -0.5, 3.4, 4.1);
  part(ctx, 0, -8.6, 5.6, 5.1);

  // Abdomen segments.
  ctx.strokeStyle = flash ? '#f3c0c0' : pal.dark;
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.ellipse(0, 6.6, 5.9, 2.3, 0, 0.08 * Math.PI, 0.92 * Math.PI);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(0, 10.3, 4.8, 2, 0, 0.1 * Math.PI, 0.9 * Math.PI);
  ctx.stroke();

  // Lit side of each part.
  ctx.fillStyle = bodyHi;
  blob(ctx, -1.6, 6.6, 3.2, 4);
  blob(ctx, -1, -1.4, 1.6, 2.2);
  blob(ctx, -1.6, -10.2, 2.8, 2.2);

  // Skin patterns that live on the body (the glow halo is drawn under it). The
  // hit flash stays a clean all-white frame, so patterns skip it.
  if (!flash) {
    if (pal.pattern === 'stripes') stripes(ctx, pal.accent);
    else if (pal.pattern === 'shine') shine(ctx, pal.accent, a.reduced ? 0.78 : a.t, alpha);
  }

  // Gloss: stronger and crisper when wet.
  ctx.fillStyle = flash ? '#ffffff' : pal.highlight;
  ctx.globalAlpha = alpha * (0.55 + 0.25 * wet);
  blob(ctx, -2.4, 5.4, 1.3, 1.9);
  blob(ctx, -2.5, -11.1, 1.2, 0.9);
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = alpha * (0.25 + 0.6 * wet);
  blob(ctx, -2.8, 4.6, 0.7, 1.1);
  blob(ctx, -1.1, -2.6, 0.5, 0.8);
  ctx.globalAlpha = alpha;

  // Wet: darker overall plus beads of water.
  if (wet > 0.05 && !flash) {
    ctx.fillStyle = '#080303';
    ctx.globalAlpha = alpha * wet * 0.28;
    part(ctx, 0, 8.6, 6.3, 7.5, false);
    part(ctx, 0, -8.6, 5.6, 5.1, false);
    ctx.globalAlpha = alpha * clamp01((wet - 0.25) * 1.6);
    for (const [bx, by, br] of BEADS) {
      ctx.fillStyle = 'rgba(205, 238, 255, 0.9)';
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(bx - br * 0.35, by - br * 0.35, br * 0.38, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = alpha;
  }

  if (a.redTint) {
    ctx.fillStyle = P.danger;
    ctx.globalAlpha = alpha * 0.45;
    part(ctx, 0, 8.6, 6.3, 7.5, false);
    part(ctx, 0, -0.5, 3.4, 4.1, false);
    part(ctx, 0, -8.6, 5.6, 5.1, false);
    ctx.globalAlpha = alpha;
  }

  // Mandibles.
  ctx.strokeStyle = limb;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(1.3, -13.1);
  ctx.quadraticCurveTo(2.6, -14.9, 0.5, -15.6);
  ctx.moveTo(-1.3, -13.1);
  ctx.quadraticCurveTo(-2.6, -14.9, -0.5, -15.6);
  ctx.stroke();

  eyes(ctx, pal, a);
}

// Band centres on the abdomen (curved like the segment lines). Three bands, as
// wide as the gaps, read as a bee even at the small in-game size.
const STRIPE_Y = [3.8, 7.6, 11.4] as const;

function stripes(ctx: CanvasRenderingContext2D, accent: string): void {
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, 8.6, 6.3, 7.5, 0, 0, TAU);
  ctx.clip();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.lineCap = 'butt';
  for (let i = 0; i < STRIPE_Y.length; i++) {
    ctx.beginPath();
    ctx.ellipse(0, STRIPE_Y[i], 8.4, 2.6, 0, 0.04 * Math.PI, 0.96 * Math.PI);
    ctx.stroke();
  }
  ctx.restore();
}

/** A soft glint that sweeps head to tail, then rests, so it reads as a polished shell. */
function shine(ctx: CanvasRenderingContext2D, accent: string, t: number, alpha: number): void {
  // Reduced motion passes a fixed t, which parks the glint mid-body.
  const u = (t * 0.55) % 1.7;
  if (u > 1) return;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(6.3, 8.6);
  ctx.ellipse(0, 8.6, 6.3, 7.5, 0, 0, TAU);
  ctx.moveTo(3.4, -0.5);
  ctx.ellipse(0, -0.5, 3.4, 4.1, 0, 0, TAU);
  ctx.moveTo(5.6, -8.6);
  ctx.ellipse(0, -8.6, 5.6, 5.1, 0, 0, TAU);
  ctx.clip();
  ctx.fillStyle = accent;
  ctx.globalAlpha = alpha * 0.8 * Math.sin(u * Math.PI);
  ctx.beginPath();
  ctx.ellipse(-0.6, -14 + u * 32, 1.7, 4.8, 0.55, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function eyes(ctx: CanvasRenderingContext2D, pal: SkinPalette, a: AntLook): void {
  if (a.dying) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let side = -1; side <= 1; side += 2) {
      const ex = 2.7 * side;
      const ey = -10;
      ctx.moveTo(ex - 1.3, ey - 1.3);
      ctx.lineTo(ex + 1.3, ey + 1.3);
      ctx.moveTo(ex + 1.3, ey - 1.3);
      ctx.lineTo(ex - 1.3, ey + 1.3);
    }
    ctx.stroke();
    return;
  }
  if (a.hurt) {
    // Squeezed shut: > <
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-3.9, -11.2);
    ctx.lineTo(-2, -10);
    ctx.lineTo(-3.9, -8.8);
    ctx.moveTo(3.9, -11.2);
    ctx.lineTo(2, -10);
    ctx.lineTo(3.9, -8.8);
    ctx.stroke();
    return;
  }
  const lx = a.lookX * 0.75;
  const ly = a.lookY * 0.75;
  ctx.fillStyle = P.white;
  ctx.beginPath();
  ctx.ellipse(-2.7, -10, 2.05, 2.25, -0.2, 0, TAU);
  ctx.moveTo(4.75, -10);
  ctx.ellipse(2.7, -10, 2.05, 2.25, 0.2, 0, TAU);
  ctx.fill();
  ctx.fillStyle = pal.outline;
  ctx.beginPath();
  ctx.arc(-2.7 + lx, -10 + ly, 1.2, 0, TAU);
  ctx.moveTo(2.7 + lx + 1.2, -10 + ly);
  ctx.arc(2.7 + lx, -10 + ly, 1.2, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(-3.1 + lx, -10.5 + ly, 0.45, 0, TAU);
  ctx.moveTo(2.3 + lx + 0.45, -10.5 + ly);
  ctx.arc(2.3 + lx, -10.5 + ly, 0.45, 0, TAU);
  ctx.fill();
}

/** A body segment: filled ellipse with optional outline. */
function part(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, outline = true): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
  ctx.fill();
  if (outline) ctx.stroke();
}

function blob(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, -0.35, 0, TAU);
  ctx.fill();
}
