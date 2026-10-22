// Scenery sprites that belong to one zone: Lily Marsh reeds with cattails, and
// the stony bank boulders of the Rapids. Pre-rendered once per resize like the
// Jungle foliage, in the same flat top-down style (two-tone shapes, a soft
// centred halo instead of directional shadows, since sprites rotate freely).
//
// Bank boulders are deliberately warm grey and mossy with no foam ring, so they
// never read as the blue-grey river rocks that are hazards.

import { makeSprite, type Sprite } from './gfx';
import { P, ZP } from './palette';
import { TAU, makeRand } from './util';

type Ctx = CanvasRenderingContext2D;

function halo(c: Ctx, ppu: number, blur: number, alpha: number): void {
  c.shadowColor = `rgba(2, 14, 8, ${alpha})`;
  c.shadowBlur = blur * ppu;
  c.shadowOffsetX = 0;
  c.shadowOffsetY = 0;
}

function noHalo(c: Ctx): void {
  c.shadowColor = 'transparent';
  c.shadowBlur = 0;
}

/** A clump of reeds seen from above: long curved blades fanning out, a few cattail heads. */
function reed(ppu: number, seed: number, size: number): Sprite {
  const rand = makeRand(seed);
  return makeSprite(size, size, ppu, (c) => {
    const blades = 12 + Math.floor(rand() * 4);
    halo(c, ppu, 2.5, 0.45);
    const tones = [ZP.reed, ZP.reedLight, ZP.reedDark];
    for (let i = 0; i < blades; i++) {
      const ang = (i / blades) * TAU + rand() * 0.5;
      const len = size * (0.3 + rand() * 0.18);
      const w = 0.9 + rand() * 0.9;
      const bend = (rand() - 0.5) * 1.1;
      c.save();
      c.rotate(ang);
      c.fillStyle = tones[i % 3];
      c.beginPath();
      c.moveTo(0, -w);
      c.quadraticCurveTo(len * 0.55, bend * len * 0.3 - w * 0.6, len, bend * len * 0.5);
      c.quadraticCurveTo(len * 0.55, bend * len * 0.3 + w * 0.6, 0, w);
      c.closePath();
      c.fill();
      noHalo(c);
      // A lighter midrib makes each blade read as a leaf rather than a line.
      c.strokeStyle = ZP.reedLight;
      c.globalAlpha = 0.55;
      c.lineWidth = 0.5;
      c.beginPath();
      c.moveTo(len * 0.1, 0);
      c.quadraticCurveTo(len * 0.55, bend * len * 0.3, len * 0.92, bend * len * 0.46);
      c.stroke();
      c.globalAlpha = 1;
      halo(c, ppu, 2.5, 0.45);
      c.restore();
    }
    noHalo(c);
    // Cattail heads: a brown capsule on a thin stalk, lying along the stalk.
    const heads = 2 + Math.floor(rand() * 2);
    for (let i = 0; i < heads; i++) {
      const ang = rand() * TAU;
      const d = size * (0.12 + rand() * 0.1);
      c.save();
      c.rotate(ang);
      c.strokeStyle = ZP.reedDark;
      c.lineWidth = 0.8;
      c.beginPath();
      c.moveTo(0, 0);
      c.lineTo(d + 2, 0);
      c.stroke();
      c.fillStyle = ZP.cattail;
      c.beginPath();
      c.ellipse(d + 4.2, 0, 4.4, 1.9, 0, 0, TAU);
      c.fill();
      c.fillStyle = ZP.cattailLight;
      c.beginPath();
      c.ellipse(d + 3.6, -0.6, 2.8, 0.7, 0, 0, TAU);
      c.fill();
      c.strokeStyle = ZP.reedLight;
      c.lineWidth = 0.7;
      c.beginPath();
      c.moveTo(d + 8.4, 0);
      c.lineTo(d + 10.4, 0);
      c.stroke();
      c.restore();
    }
  });
}

/** Flat-shaded irregular stone: dark base, mid body, lit shoulder, optional moss. */
function stone(c: Ctx, ppu: number, x: number, y: number, r: number, rand: () => number, mossy: boolean): void {
  const verts = 6 + Math.floor(rand() * 3);
  const rs: number[] = [];
  for (let i = 0; i < verts; i++) rs.push(r * (0.78 + rand() * 0.3));
  const shape = (s: number, ox: number, oy: number) => {
    c.beginPath();
    for (let i = 0; i <= verts; i++) {
      const a0 = (i / verts) * TAU;
      const a1 = ((i + 1) / verts) * TAU;
      const p0x = x + ox + Math.cos(a0) * rs[i % verts] * s;
      const p0y = y + oy + Math.sin(a0) * rs[i % verts] * s;
      const p1x = x + ox + Math.cos(a1) * rs[(i + 1) % verts] * s;
      const p1y = y + oy + Math.sin(a1) * rs[(i + 1) % verts] * s;
      const mx = (p0x + p1x) / 2;
      const my = (p0y + p1y) / 2;
      if (i === 0) c.moveTo(mx, my);
      else c.quadraticCurveTo(p0x, p0y, mx, my);
    }
    c.closePath();
  };
  halo(c, ppu, 2.5, 0.55);
  c.fillStyle = ZP.boulderDark;
  shape(1, 0, 0);
  c.fill();
  noHalo(c);
  c.fillStyle = ZP.boulder;
  shape(0.86, -r * 0.05, -r * 0.07);
  c.fill();
  c.fillStyle = ZP.boulderLight;
  shape(0.55, -r * 0.14, -r * 0.18);
  c.fill();
  c.fillStyle = ZP.boulderTop;
  c.globalAlpha = 0.65;
  shape(0.24, -r * 0.26, -r * 0.3);
  c.fill();
  c.globalAlpha = 1;
  if (mossy) {
    c.fillStyle = P.moss;
    for (let i = 0; i < 4; i++) {
      const a = Math.PI * (1.1 + rand() * 0.5);
      c.beginPath();
      c.arc(x + Math.cos(a) * r * 0.4 + (rand() - 0.5) * r * 0.2, y + Math.sin(a) * r * 0.4, r * (0.07 + rand() * 0.07), 0, TAU);
      c.fill();
    }
  }
}

/** A cluster of bank stones: one big, one or two small. */
function boulders(ppu: number, seed: number, size: number): Sprite {
  const rand = makeRand(seed);
  return makeSprite(size, size, ppu, (c) => {
    const big = size * (0.24 + rand() * 0.06);
    stone(c, ppu, -size * 0.06, -size * 0.04, big, rand, rand() < 0.55);
    stone(c, ppu, size * 0.2, size * 0.14, big * 0.5, rand, false);
    if (rand() < 0.7) stone(c, ppu, -size * 0.2, size * 0.2, big * 0.36, rand, false);
  });
}

export interface ZoneFoliage {
  reed: Sprite[];
  boulder: Sprite[];
}

export function buildZoneFoliage(ppu: number): ZoneFoliage {
  return {
    reed: [reed(ppu, 201, 34), reed(ppu, 202, 40), reed(ppu, 203, 30)],
    boulder: [boulders(ppu, 211, 34), boulders(ppu, 212, 30), boulders(ppu, 213, 38)],
  };
}
