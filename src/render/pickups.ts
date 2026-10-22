// Things to collect on the water: sugar crumbs and the four power-up bubbles
// (mushroom, honey, ladybug, firefly), plus their glow above the night overlay.
//
// Readability rules this art follows:
//  - Nothing here is a ring or a dark disc, the two shapes drop telegraphs use.
//    Crumbs are small faceted chunks with a dark warm outline; power-ups are
//    glassy bubbles with an icon, a dashed (never solid) kind-coloured ring and
//    a pulse that grows *outwards*, where a telegraph ring closes in.
//  - Colour-blind safe: the four icons have different silhouettes (dome and
//    stem, hexagon and drop, round body with head, long body with wings), so
//    hue is only a bonus.
//  - Bubbles, not lily pads: pads are the Lily Marsh obstacles.
//
// Everything is pre-rendered in build(ppu) (DPR aware); per frame this only
// blits sprites and strokes a few arcs, with nothing allocated.

import type { Pickup, PickupKind, World } from '../types';
import { makeSprite, type Gfx, type Sprite } from './gfx';
import { TAU, clamp01, frac } from './util';

/** Pickups that are not crumbs: they get a bubble and an icon. */
export type IconKind = Exclude<PickupKind, 'crumb'>;

/** Accent colour per kind as "r, g, b": rings, glows, spark particles. */
const ACCENT: Readonly<Record<PickupKind, string>> = {
  crumb: '255, 226, 150',
  mushroom: '255, 92, 82',
  honey: '255, 184, 46',
  ladybug: '255, 128, 172',
  firefly: '206, 255, 92',
};

/** The same accents as hex, for the code that wants a colour string (effects, powers). */
export const KIND_COLOR: Readonly<Record<PickupKind, string>> = {
  crumb: '#ffe296',
  mushroom: '#ff5c52',
  honey: '#ffb82e',
  ladybug: '#ff80ac',
  firefly: '#ceff5c',
};

const ICON_KINDS: readonly IconKind[] = ['mushroom', 'honey', 'ladybug', 'firefly'];
const kindIndex = (k: IconKind): number => (k === 'mushroom' ? 0 : k === 'honey' ? 1 : k === 'ladybug' ? 2 : 3);

const EDGE = '#5a3716';

const CRUMB_VARIANTS = 4;
/** Canvas sizes (world units). The art inside is smaller; the margin holds the soft edges. */
const CRUMB_BOX = 28;
/** Crumb art is drawn at this scale inside its canvas: big enough to read at a glance on a phone. */
const CRUMB_ART = 1.22;
const BUBBLE_BOX = 48;
const BUBBLE_R = 17.5;
const ICON_BOX = 28;
const GLOW_BOX = 80;
/** Seconds a taken pickup animates out (matches the sim's TAKEN_LINGER). */
const POP_TIME = 0.22;
/**
 * Rough size of the night light pool around the leaf (units). Pickups inside it
 * are already lit, so their glow is eased off there instead of blowing out.
 */
const LIGHT_R = 160;
/** Dashed ring around a power-up bubble. */
const RING_R = 24;
const RING_DASHES = 10;

// Sprites live at module level so the effects module can pop the same icons
// without owning a second copy. Rebuilt on every resize.
const icons: (Sprite | null)[] = [null, null, null, null];
let glows: Sprite[] = [];

/** Icon-only sprite (no bubble) for floating pop-ups; null before the first build. */
export function iconSprite(kind: IconKind): Sprite | null {
  return icons[kindIndex(kind)];
}

/** Soft radial glow in a kind's accent colour; null before the first build. */
export function glowSprite(kind: PickupKind): Sprite | null {
  return glows[kind === 'crumb' ? 0 : kindIndex(kind) + 1] ?? null;
}

// --- Sprite builders ----------------------------------------------------------

function ellipse(c: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot = 0): void {
  c.beginPath();
  c.ellipse(x, y, rx, ry, rot, 0, TAU);
}

function polygon(c: CanvasRenderingContext2D, pts: readonly number[], ox = 0, oy = 0, s = 1): void {
  c.beginPath();
  c.moveTo(ox + pts[0] * s, oy + pts[1] * s);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(ox + pts[i] * s, oy + pts[i + 1] * s);
  c.closePath();
}

function hexagon(c: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number): void {
  c.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = rot + (i * TAU) / 6;
    if (i === 0) c.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    else c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  c.closePath();
}

function star4(c: CanvasRenderingContext2D, r: number, inner: number): void {
  c.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 - Math.PI / 2;
    const rr = i % 2 ? inner : r;
    if (i === 0) c.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  c.closePath();
}

/**
 * Four crumb shapes so a trail never looks stamped: a sugar crystal, a biscuit
 * crumb, a sugar cube and a pair of shards. All are light, warm and outlined in
 * dark brown, which separates them from the teal water by luminance.
 */
function crumbSprite(ppu: number, v: number): Sprite {
  return makeSprite(CRUMB_BOX, CRUMB_BOX, ppu, (c) => {
    c.scale(CRUMB_ART, CRUMB_ART);
    c.lineWidth = 1.2;
    c.strokeStyle = EDGE;
    if (v === 0) {
      // Sugar crystal: a hexagonal prism seen from above, lit from the top left.
      hexagon(c, 0, 0, 7.4, 0.3);
      c.fillStyle = '#f0c46c';
      c.fill();
      c.stroke();
      hexagon(c, -1, -1.1, 4.7, 0.3);
      c.fillStyle = '#fff3cf';
      c.fill();
      c.strokeStyle = 'rgba(160, 100, 36, 0.55)';
      c.lineWidth = 0.8;
      c.beginPath();
      for (let i = 0; i < 6; i += 2) {
        const a = 0.3 + (i * TAU) / 6;
        c.moveTo(-1 + Math.cos(a) * 4.7, -1.1 + Math.sin(a) * 4.7);
        c.lineTo(Math.cos(a) * 7.4, Math.sin(a) * 7.4);
      }
      c.stroke();
    } else if (v === 1) {
      // Biscuit crumb: irregular, golden brown, speckled.
      const pts = [-7.6, -1.4, -4.4, -6.6, 1.8, -7.6, 7.4, -3.2, 7, 3.8, 1.6, 7.4, -5.2, 5.8];
      polygon(c, pts);
      c.fillStyle = '#d99a4c';
      c.fill();
      c.stroke();
      polygon(c, pts, -1, -1.1, 0.72);
      c.fillStyle = '#f5cf86';
      c.fill();
      c.fillStyle = 'rgba(120, 70, 24, 0.7)';
      for (const [x, y] of [[2.6, 2.4], [-3.4, 1.8], [3.4, -2.6], [-0.6, -3.6]]) {
        c.beginPath();
        c.arc(x, y, 0.75, 0, TAU);
        c.fill();
      }
    } else if (v === 2) {
      // Sugar cube: three faces, the lit top nearly white.
      c.rotate(-0.18);
      polygon(c, [-6.6, -3.2, 0, -0.1, 0, 7.2, -6.6, 3.8]);
      c.fillStyle = '#e6d6b0';
      c.fill();
      c.stroke();
      polygon(c, [0, -0.1, 6.6, -3.2, 6.6, 3.8, 0, 7.2]);
      c.fillStyle = '#c9b585';
      c.fill();
      c.stroke();
      polygon(c, [0, -7.4, 6.6, -3.2, 0, -0.1, -6.6, -3.2]);
      c.fillStyle = '#fffaf0';
      c.fill();
      c.stroke();
    } else {
      // A cluster of three sugar grains.
      for (const [x, y, r, rot] of [[-3.4, 2.4, 4.2, 0.2], [3.6, 2.2, 3.8, 0.7], [0, -3.2, 4.4, 0.45]]) {
        hexagon(c, x, y, r, rot);
        c.fillStyle = '#efc269';
        c.fill();
        c.stroke();
        hexagon(c, x - 0.6, y - 0.7, r * 0.6, rot);
        c.fillStyle = '#fff1c4';
        c.fill();
      }
    }
  });
}

function glintSprite(ppu: number): Sprite {
  return makeSprite(18, 18, ppu, (c) => {
    const g = c.createRadialGradient(0, 0, 0, 0, 0, 5.5);
    g.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    g.addColorStop(1, 'rgba(255, 255, 255, 0)');
    c.fillStyle = g;
    c.beginPath();
    c.arc(0, 0, 5.5, 0, TAU);
    c.fill();
    c.fillStyle = '#ffffff';
    star4(c, 8, 1.1);
    c.fill();
  });
}

function glowFor(ppu: number, rgb: string): Sprite {
  // Soft by nature, so a coarse bitmap is plenty (and cheap to blit).
  return makeSprite(GLOW_BOX, GLOW_BOX, Math.min(ppu, 1.25), (c) => {
    const g = c.createRadialGradient(0, 0, 0, 0, 0, GLOW_BOX / 2);
    g.addColorStop(0, `rgba(${rgb}, 0.9)`);
    g.addColorStop(0.3, `rgba(${rgb}, 0.42)`);
    g.addColorStop(0.65, `rgba(${rgb}, 0.12)`);
    g.addColorStop(1, `rgba(${rgb}, 0)`);
    c.fillStyle = g;
    c.fillRect(-GLOW_BOX / 2, -GLOW_BOX / 2, GLOW_BOX, GLOW_BOX);
  });
}

/** Mushroom: red cap with cream dots on a pale stem. Side view, so it reads as a mushroom, not a dot. */
function drawMushroom(c: CanvasRenderingContext2D): void {
  c.lineWidth = 1.3;
  c.strokeStyle = '#4a0f1c';
  // Stem.
  c.beginPath();
  c.moveTo(-3.2, 0.4);
  c.quadraticCurveTo(-3.7, 6.6, -4.8, 9.8);
  c.quadraticCurveTo(0, 11.5, 4.8, 9.8);
  c.quadraticCurveTo(3.7, 6.6, 3.2, 0.4);
  c.closePath();
  c.fillStyle = '#f8ecd2';
  c.fill();
  c.stroke();
  c.fillStyle = 'rgba(190, 150, 96, 0.5)';
  c.beginPath();
  c.moveTo(0.8, 1);
  c.lineTo(3.2, 0.4);
  c.quadraticCurveTo(3.7, 6.6, 4.8, 9.8);
  c.quadraticCurveTo(2.8, 10.6, 1.4, 10.6);
  c.quadraticCurveTo(1.7, 6, 0.8, 1);
  c.fill();
  // Cap.
  c.beginPath();
  c.moveTo(-11, 2.4);
  c.bezierCurveTo(-12, -9.8, 12, -9.8, 11, 2.4);
  c.quadraticCurveTo(0, 5.8, -11, 2.4);
  c.closePath();
  const g = c.createLinearGradient(0, -9, 0, 5);
  g.addColorStop(0, '#ff7b6e');
  g.addColorStop(1, '#cf2338');
  c.fillStyle = g;
  c.fill();
  c.stroke();
  // Dots.
  c.fillStyle = '#fff7ea';
  for (const [x, y, r] of [[-4.6, -3.6, 2.4], [3.2, -5.4, 2], [6.4, -0.4, 1.6], [-7.6, 0.2, 1.3], [0.4, -0.3, 1.5]]) {
    c.beginPath();
    c.arc(x, y, r, 0, TAU);
    c.fill();
  }
  // Wet sheen.
  c.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  c.lineWidth = 1.2;
  c.beginPath();
  c.arc(0, 1.6, 9, Math.PI * 1.1, Math.PI * 1.34);
  c.stroke();
}

/** Honey: an amber drop in front of a honeycomb cell. */
function drawHoney(c: CanvasRenderingContext2D): void {
  c.lineWidth = 1.5;
  c.strokeStyle = '#5a2c04';
  hexagon(c, 0, 0.4, 11, -Math.PI / 2);
  const comb = c.createLinearGradient(0, -10, 0, 10);
  comb.addColorStop(0, '#ffdc6e');
  comb.addColorStop(1, '#f0a626');
  c.fillStyle = comb;
  c.fill();
  c.stroke();
  hexagon(c, 0, 0.4, 7.8, -Math.PI / 2);
  c.strokeStyle = 'rgba(120, 60, 4, 0.5)';
  c.lineWidth = 0.9;
  c.stroke();
  // The drop.
  c.strokeStyle = '#4a2203';
  c.lineWidth = 1.4;
  c.beginPath();
  c.moveTo(0, -8.6);
  c.bezierCurveTo(1.4, -5.6, 5.6, -1.6, 5.6, 2.8);
  c.arc(0, 2.8, 5.6, 0, Math.PI);
  c.bezierCurveTo(-5.6, -1.6, -1.4, -5.6, 0, -8.6);
  c.closePath();
  const g = c.createLinearGradient(0, -8, 0, 8);
  g.addColorStop(0, '#f7a81a');
  g.addColorStop(1, '#c4640a');
  c.fillStyle = g;
  c.fill();
  c.stroke();
  c.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ellipse(c, -2.1, 1.8, 1.2, 2.5, 0.25);
  c.fill();
}

/** Ladybug from above: red shell with black spots, dark head, white eyes. */
function drawLadybug(c: CanvasRenderingContext2D): void {
  c.lineCap = 'round';
  // Legs.
  c.strokeStyle = '#2a1416';
  c.lineWidth = 1.2;
  c.beginPath();
  for (const s of [-1, 1]) {
    c.moveTo(s * 6.6, -2.4);
    c.lineTo(s * 10.6, -4.4);
    c.moveTo(s * 7.8, 2.2);
    c.lineTo(s * 11.4, 2.6);
    c.moveTo(s * 6.6, 6.4);
    c.lineTo(s * 10, 9.2);
  }
  c.stroke();
  // Antennae.
  c.lineWidth = 0.9;
  c.beginPath();
  c.moveTo(-1.4, -9.6);
  c.quadraticCurveTo(-3, -12.6, -5.4, -12.4);
  c.moveTo(1.4, -9.6);
  c.quadraticCurveTo(3, -12.6, 5.4, -12.4);
  c.stroke();
  // Shell.
  c.lineWidth = 1.3;
  c.strokeStyle = '#2a0b10';
  ellipse(c, 0, 2.2, 8.4, 8.8);
  const g = c.createLinearGradient(-6, -6, 6, 10);
  g.addColorStop(0, '#ff6a5c');
  g.addColorStop(1, '#c4162a');
  c.fillStyle = g;
  c.fill();
  c.stroke();
  // Wing split and spots.
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(0, -6.4);
  c.lineTo(0, 11);
  c.stroke();
  c.fillStyle = '#1c0d10';
  for (const [x, y, r] of [[-4.2, -0.6, 2], [4.2, -0.2, 1.8], [-4.4, 5.8, 1.7], [4.4, 6, 1.9], [-1.1, 9.1, 0.9], [1.1, 9.1, 0.9]]) {
    c.beginPath();
    c.arc(x, y, r, 0, TAU);
    c.fill();
  }
  // Head.
  c.fillStyle = '#1c0d10';
  c.strokeStyle = '#0c0506';
  ellipse(c, 0, -7.4, 4.6, 3.5);
  c.fill();
  c.stroke();
  c.fillStyle = '#fff';
  for (const s of [-1, 1]) {
    c.beginPath();
    c.arc(s * 2.5, -8.2, 1, 0, TAU);
    c.fill();
  }
  // Sheen.
  c.strokeStyle = 'rgba(255, 255, 255, 0.6)';
  c.lineWidth = 1.3;
  c.beginPath();
  c.arc(0, 2.2, 6.4, Math.PI * 1.08, Math.PI * 1.38);
  c.stroke();
}

/** Firefly from above: glassy wings, dark body, a lantern glowing at the tail. */
function drawFirefly(c: CanvasRenderingContext2D): void {
  c.rotate(-0.4);
  c.lineCap = 'round';
  // Lantern glow behind everything.
  const glow = c.createRadialGradient(0, 5.4, 0, 0, 5.4, 11);
  glow.addColorStop(0, 'rgba(226, 255, 96, 0.95)');
  glow.addColorStop(0.45, 'rgba(206, 255, 92, 0.4)');
  glow.addColorStop(1, 'rgba(206, 255, 92, 0)');
  c.fillStyle = glow;
  c.beginPath();
  c.arc(0, 5.4, 11, 0, TAU);
  c.fill();
  // Wings.
  c.lineWidth = 1;
  c.strokeStyle = '#36505c';
  c.fillStyle = 'rgba(238, 250, 255, 0.78)';
  ellipse(c, -6.6, -0.4, 3.1, 8.2, -0.5);
  c.fill();
  c.stroke();
  ellipse(c, 6.6, -0.4, 3.1, 8.2, 0.5);
  c.fill();
  c.stroke();
  // Antennae.
  c.strokeStyle = '#1c1812';
  c.lineWidth = 0.9;
  c.beginPath();
  c.moveTo(-1.1, -10);
  c.quadraticCurveTo(-2.6, -12.8, -4.8, -12.4);
  c.moveTo(1.1, -10);
  c.quadraticCurveTo(2.6, -12.8, 4.8, -12.4);
  c.stroke();
  // Body.
  c.lineWidth = 1.2;
  c.strokeStyle = '#1c1812';
  ellipse(c, 0, -8, 2.7, 2.3);
  c.fillStyle = '#2a251c';
  c.fill();
  c.stroke();
  ellipse(c, 0, -3.8, 3.6, 3.4);
  c.fillStyle = '#f08a4a';
  c.fill();
  c.stroke();
  ellipse(c, 0, 3.6, 3.9, 6.6);
  const g = c.createLinearGradient(0, -2, 0, 10);
  g.addColorStop(0, '#3a3524');
  g.addColorStop(0.35, '#a9c93a');
  g.addColorStop(1, '#f2ffa0');
  c.fillStyle = g;
  c.fill();
  c.stroke();
  c.fillStyle = '#ffffff';
  ellipse(c, 0, 6.8, 1.8, 2.4);
  c.fill();
}

function drawIcon(c: CanvasRenderingContext2D, kind: IconKind): void {
  c.save();
  if (kind === 'mushroom') drawMushroom(c);
  else if (kind === 'honey') drawHoney(c);
  else if (kind === 'ladybug') drawLadybug(c);
  else drawFirefly(c);
  c.restore();
}

function iconOnly(ppu: number, kind: IconKind): Sprite {
  return makeSprite(ICON_BOX, ICON_BOX, ppu, (c) => {
    c.translate(0, 0.5);
    drawIcon(c, kind);
  });
}

/** A glassy bubble with the icon floating inside. */
function bubbleSprite(ppu: number, kind: IconKind): Sprite {
  const acc = ACCENT[kind];
  return makeSprite(BUBBLE_BOX, BUBBLE_BOX, ppu, (c) => {
    // Body: frosted in the middle, tinted towards the rim.
    const g = c.createRadialGradient(-4, -5, 1, 0, 0, BUBBLE_R);
    g.addColorStop(0, 'rgba(255, 255, 255, 0.86)');
    g.addColorStop(0.6, 'rgba(218, 245, 250, 0.74)');
    g.addColorStop(1, `rgba(${acc}, 0.62)`);
    c.fillStyle = g;
    c.beginPath();
    c.arc(0, 0, BUBBLE_R, 0, TAU);
    c.fill();
    // Rim: a bright glass edge and a thin inner ring in the kind's colour.
    c.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(0, 0, BUBBLE_R, 0, TAU);
    c.stroke();
    c.strokeStyle = `rgba(${acc}, 0.95)`;
    c.lineWidth = 1.3;
    c.beginPath();
    c.arc(0, 0, BUBBLE_R - 2.2, 0, TAU);
    c.stroke();
    // Icon.
    c.save();
    c.translate(0, 0.6);
    c.scale(0.96, 0.96);
    drawIcon(c, kind);
    c.restore();
    // Glass highlights on top of the icon.
    c.lineCap = 'round';
    c.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    c.lineWidth = 2;
    c.beginPath();
    c.arc(0, 0, BUBBLE_R - 4.2, Math.PI * 1.08, Math.PI * 1.36);
    c.stroke();
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.arc(-9.3, -10.4, 1.1, 0, TAU);
    c.fill();
    c.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    c.lineWidth = 1.4;
    c.beginPath();
    c.arc(0, 0, BUBBLE_R - 3.4, Math.PI * 0.12, Math.PI * 0.3);
    c.stroke();
  });
}

/** Seconds since a pickup was taken, if the sim tracks it (it does; tests may not). */
function takenAge(k: Pickup): number {
  const t = (k as Pickup & { takenT?: number }).takenT;
  return typeof t === 'number' ? t : POP_TIME * 0.5;
}

export class PickupArt {
  private crumbs: Sprite[] = [];
  private bubbles: Sprite[] = [];
  private glint: Sprite | null = null;

  /** (Re)build sprites at the device scale (called from Renderer.resize). */
  build(ppu: number): void {
    this.crumbs = [];
    for (let i = 0; i < CRUMB_VARIANTS; i++) this.crumbs.push(crumbSprite(ppu, i));
    this.bubbles = ICON_KINDS.map((k) => bubbleSprite(ppu, k));
    for (const k of ICON_KINDS) icons[kindIndex(k)] = iconOnly(ppu, k);
    this.glint = glintSprite(ppu);
    glows = [glowFor(ppu, ACCENT.crumb), ...ICON_KINDS.map((k) => glowFor(ppu, ACCENT[k]))];
  }

  /** Pickups on the water (below the leaf). */
  draw(g: Gfx, world: World): void {
    const list = world.pickups;
    if (!list.length || !this.glint) return;
    const { ctx } = g;
    const t = g.t;
    const calm = g.reduced;
    g.world();

    // Shadows first, in one path: a crumb sits on the water, a bubble floats a little above it.
    ctx.fillStyle = 'rgba(2, 26, 36, 0.3)';
    ctx.beginPath();
    for (let i = 0; i < list.length; i++) {
      const k = list[i];
      if (k.taken || k.y < -40 || k.y > g.viewH + 40) continue;
      if (k.kind === 'crumb') {
        ctx.moveTo(k.x + 8.9, k.y + 4);
        ctx.ellipse(k.x + 1.8, k.y + 4, 7.1, 4.9, 0, 0, TAU);
      } else {
        ctx.moveTo(k.x + 17.5, k.y + 8);
        ctx.ellipse(k.x + 3.5, k.y + 8, 14, 9.5, 0, 0, TAU);
      }
    }
    ctx.fill();

    // Crumbs.
    for (let i = 0; i < list.length; i++) {
      const k = list[i];
      if (k.kind !== 'crumb' || k.y < -40 || k.y > g.viewH + 40) continue;
      // Integer pick (variant 1.0 would index one past the end).
      const vi = (k.variant * CRUMB_VARIANTS) | 0;
      const spr = this.crumbs[vi < CRUMB_VARIANTS ? vi : CRUMB_VARIANTS - 1];
      const ph = k.id * 0.77 + k.variant * 9;
      let scale = 1;
      let dy = 0;
      let alpha = 1;
      if (k.taken) {
        // Pluck: swell and fade where it was.
        const u = clamp01(takenAge(k) / POP_TIME);
        scale = 1 + 0.9 * u;
        alpha = (1 - u) * (1 - u);
      } else if (!calm) {
        const b = Math.sin(t * 2.4 + ph);
        scale = 1 + b * 0.05;
        dy = b * 0.7;
      }
      const rot = (k.variant - 0.5) * 0.9 + (calm || k.taken ? 0 : Math.sin(t * 0.9 + ph) * 0.1);
      ctx.globalAlpha = alpha;
      g.sprite(spr, k.x, k.y + dy, rot, scale);
      // A twinkle every couple of seconds, staggered so a trail glitters in a wave.
      if (!k.taken && !calm) {
        const u = frac(t * 0.42 + ph * 0.37) / 0.14;
        if (u < 1) {
          const s = Math.sin(u * Math.PI);
          ctx.globalAlpha = s;
          g.sprite(this.glint, k.x - 3.1, k.y - 3.6 + dy, u * 1.6, 0.4 + 0.75 * s);
        }
      }
    }
    ctx.globalAlpha = 1;

    // Power-ups.
    for (let i = 0; i < list.length; i++) {
      const k = list[i];
      if (k.kind === 'crumb' || k.y < -60 || k.y > g.viewH + 60) continue;
      this.powerUp(g, k as Pickup & { kind: IconKind });
    }
    ctx.globalAlpha = 1;
  }

  private powerUp(g: Gfx, k: Pickup & { kind: IconKind }): void {
    const { ctx, t } = g;
    const calm = g.reduced;
    const idx = kindIndex(k.kind);
    const ph = k.id * 0.9 + k.variant * 6.3;
    const bob = calm ? 0 : Math.sin(t * 2 + ph) * 2;
    const x = k.x;
    const y = k.y + bob;
    let fade = 1;
    let scale = 1;
    if (k.taken) {
      const u = clamp01(takenAge(k) / POP_TIME);
      scale = 1 + 0.7 * u;
      fade = (1 - u) * (1 - u);
    }
    const glow = glows[idx + 1];
    const accent = KIND_COLOR[k.kind];

    // Halo: a soft wash of the kind's colour so it catches the eye from afar.
    if (glow) {
      ctx.globalAlpha = (0.5 + (calm ? 0 : Math.sin(t * 3 + ph) * 0.1)) * fade;
      g.sprite(glow, x, y, 0, 1.05);
    }
    // Pulse: grows outwards and fades. A telegraph ring closes in, so the motion alone tells them apart.
    if (!k.taken && !calm) {
      const u = frac(t * 0.8 + ph * 0.16);
      ctx.globalAlpha = (1 - u) * (1 - u) * 0.7;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2.2 * (1 - u * 0.5);
      g.world();
      ctx.beginPath();
      ctx.arc(x, y, BUBBLE_R + 1 + u * 20, 0, TAU);
      ctx.stroke();
    }
    // Dashed ring: slowly turning, so it is never mistaken for a solid telegraph ring.
    if (!k.taken) {
      g.world();
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(2, 16, 24, 0.5)';
      ctx.lineWidth = 3.4;
      ctx.globalAlpha = 0.75;
      this.dashes(ctx, x, y, RING_R + (calm ? 0 : Math.sin(t * 3 + ph) * 0.9), calm ? 0 : t * 0.7 + ph);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.95;
      this.dashes(ctx, x, y, RING_R + (calm ? 0 : Math.sin(t * 3 + ph) * 0.9), calm ? 0 : t * 0.7 + ph);
    }
    // The bubble itself.
    const sway = calm ? 0 : Math.sin(t * 1.3 + ph) * 0.1;
    ctx.globalAlpha = fade;
    g.sprite(this.bubbles[idx], x, y, sway, scale * (1 + (calm ? 0 : Math.sin(t * 3 + ph) * 0.025)));
    // A glint now and then.
    if (!k.taken && !calm && this.glint) {
      const u = frac(t * 0.55 + ph * 0.21) / 0.2;
      if (u < 1) {
        const s = Math.sin(u * Math.PI);
        ctx.globalAlpha = s;
        g.sprite(this.glint, x - 9, y - 10, u * 1.2, 0.5 + 0.9 * s);
      }
    }
    ctx.globalAlpha = 1;
  }

  /** A ring of short dashes (no setLineDash: that would allocate an array every call). */
  private dashes(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, spin: number): void {
    ctx.beginPath();
    const step = TAU / RING_DASHES;
    const len = step * 0.5;
    for (let i = 0; i < RING_DASHES; i++) {
      const a = spin + i * step;
      ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      ctx.arc(x, y, r, a, a + len);
    }
    ctx.stroke();
  }

  /**
   * Glow pass drawn above the night overlay so pickups stay findable in the
   * dark. Scaled by world.darkness, so it costs nothing (and shows nothing) by day.
   */
  drawGlow(g: Gfx, world: World): void {
    const dark = world.darkness;
    const list = world.pickups;
    if (dark < 0.02 || !list.length || !this.glint) return;
    const { ctx, t } = g;
    const calm = g.reduced;
    const crumbGlow = glows[0];
    const lx = world.player.x;
    const ly = world.player.y;
    let anyPower = false;

    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < list.length; i++) {
      const k = list[i];
      if (k.taken || k.y < -60 || k.y > g.viewH + 60) continue;
      const ph = k.id * 0.77 + k.variant * 9;
      const pulse = calm ? 1 : 0.85 + 0.15 * Math.sin(t * 3 + ph);
      // Near the leaf the light pool already shows it: ease the glow off to a third.
      const dx = k.x - lx;
      const dy = k.y - ly;
      const lit = clamp01(1 - (Math.sqrt(dx * dx + dy * dy) - 50) / (LIGHT_R - 50));
      const ease = 1 - 0.65 * lit;
      if (k.kind === 'crumb') {
        if (!crumbGlow) continue;
        ctx.globalAlpha = dark * 0.8 * pulse * ease;
        g.sprite(crumbGlow, k.x, k.y, 0, 0.5);
        ctx.globalAlpha = dark * 0.85 * pulse * ease;
        g.sprite(this.glint, k.x, k.y, calm ? 0 : t * 0.5 + ph, 0.66 + (calm ? 0 : 0.16 * Math.sin(t * 5 + ph)));
      } else {
        anyPower = true;
        const glow = glows[kindIndex(k.kind) + 1];
        if (!glow) continue;
        ctx.globalAlpha = dark * 0.95 * pulse * (1 - 0.4 * lit);
        g.sprite(glow, k.x, k.y, 0, 1.3);
        ctx.globalAlpha = dark * 0.7 * pulse * ease;
        g.sprite(this.glint, k.x, k.y, calm ? 0 : t * 0.4 + ph, 1.4);
      }
    }
    ctx.globalCompositeOperation = 'source-over';

    // Power-ups are also redrawn, so their icon can be told apart before the light pool reaches them.
    if (!anyPower) {
      ctx.globalAlpha = 1;
      return;
    }
    for (let i = 0; i < list.length; i++) {
      const k = list[i];
      if (k.kind === 'crumb' || k.taken || k.y < -60 || k.y > g.viewH + 60) continue;
      const ph = k.id * 0.9 + k.variant * 6.3;
      ctx.globalAlpha = dark * 0.7;
      g.sprite(this.bubbles[kindIndex(k.kind)], k.x, k.y + (calm ? 0 : Math.sin(t * 2 + ph) * 2), 0, 1);
    }
    ctx.globalAlpha = 1;
  }
}
