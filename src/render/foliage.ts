// Jungle scenery sprites, drawn once per resize into offscreen canvases at the
// device's resolution. Top-down flat-vector style: two-tone leaves (lit half /
// shaded half), a soft centred halo instead of directional shadows (sprites are
// rotated freely, so a baked offset shadow would point the wrong way).

import { makeSprite, type Sprite } from './gfx';
import { P } from './palette';
import { TAU, makeRand } from './util';

type Ctx = CanvasRenderingContext2D;

export interface FoliageSprites {
  fern: Sprite[];
  grass: Sprite[];
  broadleaf: Sprite[];
  flowers: Sprite[];
  monstera: Sprite[];
  palm: Sprite[];
  pebbles: Sprite[];
  mushrooms: Sprite[];
  canopy: Sprite[];
  lily: Sprite[];
  petal: Sprite[];
}

/** A seamless square tile; `scale` = device px per world unit actually used. */
export interface Tile {
  img: HTMLCanvasElement;
  size: number;
  scale: number;
}

/** Soft halo under everything drawn while it is active (pre-render only). */
function halo(c: Ctx, ppu: number, blur: number, alpha = 0.45): void {
  c.shadowColor = `rgba(2, 14, 8, ${alpha})`;
  c.shadowBlur = blur * ppu;
  c.shadowOffsetX = 0;
  c.shadowOffsetY = 0;
}

function noHalo(c: Ctx): void {
  c.shadowColor = 'transparent';
  c.shadowBlur = 0;
}

function leafPath(c: Ctx, len: number, wid: number): void {
  c.beginPath();
  c.moveTo(0, 0);
  c.bezierCurveTo(len * 0.22, -wid, len * 0.72, -wid * 0.95, len, 0);
  c.bezierCurveTo(len * 0.72, wid * 0.95, len * 0.22, wid, 0, 0);
  c.closePath();
}

/**
 * A two-tone leaf from (x, y) pointing along `ang`. The halo (if enabled) is
 * cast only by the silhouette, never by the lit half, so midribs stay crisp.
 */
function leaf2(
  c: Ctx,
  x: number,
  y: number,
  ang: number,
  len: number,
  wid: number,
  base: string,
  light: string,
  vein: string | null,
): void {
  c.save();
  c.translate(x, y);
  c.rotate(ang);
  c.fillStyle = base;
  leafPath(c, len, wid);
  c.fill();
  const sc = c.shadowColor;
  const sb = c.shadowBlur;
  noHalo(c);
  c.fillStyle = light;
  c.beginPath();
  c.moveTo(0, 0);
  c.bezierCurveTo(len * 0.22, -wid, len * 0.72, -wid * 0.95, len, 0);
  c.closePath();
  c.fill();
  if (vein) {
    c.strokeStyle = vein;
    c.lineWidth = Math.max(0.5, wid * 0.13);
    c.beginPath();
    c.moveTo(len * 0.04, 0);
    c.quadraticCurveTo(len * 0.5, wid * 0.08, len * 0.9, 0);
    c.stroke();
  }
  c.shadowColor = sc;
  c.shadowBlur = sb;
  c.restore();
}

function fern(ppu: number, seed: number, size: number): Sprite {
  const rand = makeRand(seed);
  return makeSprite(size, size, ppu, (c) => {
    const fronds = 5 + Math.floor(rand() * 3);
    const r = size * 0.44;
    for (let pass = 0; pass < 2; pass++) {
      if (pass === 0) halo(c, ppu, 3, 0.5);
      else noHalo(c);
      const rr = makeRand(seed + 17);
      for (let f = 0; f < fronds; f++) {
        const ang = (f / fronds) * TAU + rr() * 0.6;
        const len = r * (0.72 + rr() * 0.28);
        const bend = (rr() - 0.5) * 0.7;
        const dark = f % 2 === 0;
        c.save();
        c.rotate(ang);
        const leaflets = 9;
        for (let i = 1; i <= leaflets; i++) {
          const t = i / (leaflets + 1);
          const px = len * t;
          const py = Math.sin(t * Math.PI * 0.5) * bend * len * 0.3;
          const ll = len * 0.26 * (1 - t * 0.72);
          const lw = ll * 0.32;
          const a = 0.95 - t * 0.35;
          if (pass === 0) {
            c.fillStyle = P.fernDark;
            for (const s of [-1, 1]) {
              c.save();
              c.translate(px, py);
              c.rotate(-s * a);
              leafPath(c, ll, lw);
              c.fill();
              c.restore();
            }
          } else {
            leaf2(c, px, py, -a, ll, lw, dark ? P.fernDark : P.fern, dark ? P.fern : P.fernLight, null);
            leaf2(c, px, py, a, ll, lw, dark ? P.fernDark : P.fern, dark ? P.fernDark : P.fern, null);
          }
        }
        if (pass === 1) {
          c.strokeStyle = P.fernLight;
          c.lineWidth = 0.8;
          c.beginPath();
          c.moveTo(0, 0);
          c.quadraticCurveTo(len * 0.5, bend * len * 0.25, len, bend * len * 0.3);
          c.stroke();
        }
        c.restore();
      }
    }
  });
}

function grass(ppu: number, seed: number, size: number): Sprite {
  const rand = makeRand(seed);
  return makeSprite(size, size, ppu, (c) => {
    halo(c, ppu, 2, 0.4);
    const blades = 11 + Math.floor(rand() * 5);
    for (let i = 0; i < blades; i++) {
      const ang = rand() * TAU;
      const len = size * (0.26 + rand() * 0.22);
      const w = 1.1 + rand() * 0.9;
      const bend = (rand() - 0.5) * 0.9;
      c.save();
      c.rotate(ang);
      c.fillStyle = i % 3 === 0 ? P.foliageLime : i % 3 === 1 ? P.foliageLight : P.foliage;
      c.beginPath();
      c.moveTo(0, -w);
      c.quadraticCurveTo(len * 0.6, bend * len * 0.3 - w * 0.5, len, bend * len * 0.45);
      c.quadraticCurveTo(len * 0.6, bend * len * 0.3 + w * 0.5, 0, w);
      c.closePath();
      c.fill();
      c.restore();
    }
  });
}

function broadleaf(ppu: number, seed: number, size: number, flowers: string | null): Sprite {
  const rand = makeRand(seed);
  return makeSprite(size, size, ppu, (c) => {
    halo(c, ppu, 3.5, 0.5);
    const n = flowers ? 5 : 6 + Math.floor(rand() * 2);
    const r = size * 0.44;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * TAU + rand() * 0.5;
      const len = r * (0.72 + rand() * 0.28);
      const wid = len * (0.36 + rand() * 0.08);
      const tone = i % 3;
      const base = tone === 0 ? P.foliageDark : tone === 1 ? P.foliage : P.foliageDeep;
      const light = tone === 0 ? P.foliage : tone === 1 ? P.foliageLight : P.foliageDark;
      leaf2(c, 0, 0, ang, len, wid, base, light, tone === 1 ? P.foliageLime : P.foliageLight);
    }
    // A second, smaller inner layer gives the clump volume.
    for (let i = 0; i < 3; i++) {
      const ang = rand() * TAU;
      const len = r * 0.52;
      leaf2(c, 0, 0, ang, len, len * 0.4, P.foliage, P.foliageLime, P.foliageLime);
    }
    if (flowers) {
      noHalo(c);
      const count = 3 + Math.floor(rand() * 3);
      for (let i = 0; i < count; i++) {
        const a = rand() * TAU;
        const d = r * (0.2 + rand() * 0.5);
        flower(c, Math.cos(a) * d, Math.sin(a) * d, 2.8 + rand() * 1.2, flowers, rand() * TAU);
      }
    }
  });
}

function flower(c: Ctx, x: number, y: number, r: number, color: string, rot: number): void {
  c.save();
  c.translate(x, y);
  c.rotate(rot);
  c.fillStyle = 'rgba(10, 30, 15, 0.35)';
  c.beginPath();
  c.arc(0.6, 0.8, r * 1.35, 0, TAU);
  c.fill();
  c.fillStyle = color;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    c.beginPath();
    c.ellipse(Math.cos(a) * r * 0.7, Math.sin(a) * r * 0.7, r * 0.72, r * 0.48, a, 0, TAU);
    c.fill();
  }
  c.fillStyle = 'rgba(255,255,255,0.35)';
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    c.beginPath();
    c.ellipse(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62, r * 0.32, r * 0.2, a, 0, TAU);
    c.fill();
  }
  c.fillStyle = P.flowerYellow;
  c.beginPath();
  c.arc(0, 0, r * 0.38, 0, TAU);
  c.fill();
  c.fillStyle = P.mud;
  c.beginPath();
  c.arc(0, 0, r * 0.16, 0, TAU);
  c.fill();
  c.restore();
}

function monstera(ppu: number, seed: number, size: number): Sprite {
  const rand = makeRand(seed);
  return makeSprite(size, size, ppu, (c) => {
    const L = size * 0.46;
    const W = size * 0.4;
    const shape = () => {
      c.beginPath();
      c.moveTo(0, -L);
      c.bezierCurveTo(W * 0.9, -L * 0.9, W * 1.05, L * 0.35, W * 0.25, L * 0.85);
      c.quadraticCurveTo(0, L * 0.7, 0, L * 0.55);
      c.quadraticCurveTo(0, L * 0.7, -W * 0.25, L * 0.85);
      c.bezierCurveTo(-W * 1.05, L * 0.35, -W * 0.9, -L * 0.9, 0, -L);
      c.closePath();
    };
    halo(c, ppu, 4, 0.5);
    c.fillStyle = P.foliageDark;
    shape();
    c.fill();
    noHalo(c);
    // Lit half.
    c.save();
    shape();
    c.clip();
    c.fillStyle = P.foliage;
    c.fillRect(-size, -size, size, size * 2);
    c.restore();
    // Veins.
    c.strokeStyle = P.foliageLight;
    c.lineWidth = 1.1;
    c.beginPath();
    c.moveTo(0, L * 0.5);
    c.lineTo(0, -L * 0.92);
    for (let i = 0; i < 5; i++) {
      const y = L * 0.35 - i * L * 0.27;
      for (const s of [-1, 1]) {
        c.moveTo(0, y);
        c.quadraticCurveTo(s * W * 0.45, y - L * 0.08, s * W * 0.82, y - L * 0.24);
      }
    }
    c.stroke();
    // Fenestrations: the splits that make it read as monstera.
    c.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 4; i++) {
      const y = L * 0.28 - i * L * 0.27 + L * 0.13;
      for (const s of [-1, 1]) {
        if (rand() < 0.25) continue;
        c.save();
        c.translate(s * W * 0.95, y - L * 0.2);
        c.rotate(s * (0.5 + rand() * 0.2) + Math.PI / 2);
        c.beginPath();
        c.ellipse(0, 0, W * 0.32, W * 0.045 + rand() * 0.6, 0, 0, TAU);
        c.fill();
        c.restore();
      }
    }
    for (let i = 0; i < 3; i++) {
      c.beginPath();
      c.ellipse((rand() - 0.5) * W * 0.9, (rand() - 0.5) * L, 1.6, 1, rand() * TAU, 0, TAU);
      c.fill();
    }
    c.globalCompositeOperation = 'source-over';
  });
}

/** A long frond pointing +x; anchored at its centre, base at -len/2. */
function palm(ppu: number, seed: number, len: number): Sprite {
  const rand = makeRand(seed);
  const h = len * 0.5;
  return makeSprite(len, h, ppu, (c) => {
    c.translate(-len * 0.48, 0);
    const bend = (rand() - 0.5) * 0.3;
    const pt = (t: number) => [len * 0.95 * t, Math.sin(t * Math.PI * 0.8) * bend * len * 0.3] as const;
    for (let pass = 0; pass < 2; pass++) {
      if (pass === 0) halo(c, ppu, 3, 0.5);
      else noHalo(c);
      const count = 16;
      for (let i = 1; i <= count; i++) {
        const t = i / (count + 1);
        const [px, py] = pt(t);
        const ll = len * 0.24 * (1 - t * 0.55);
        const lw = ll * 0.16;
        for (const s of [-1, 1]) {
          const a = s * (0.85 - t * 0.25);
          if (pass === 0) {
            c.save();
            c.translate(px, py);
            c.rotate(a);
            c.fillStyle = P.foliageDeep;
            leafPath(c, ll, lw);
            c.fill();
            c.restore();
          } else {
            leaf2(c, px, py, a, ll, lw, s < 0 ? P.foliage : P.foliageDark, s < 0 ? P.foliageLight : P.foliage, null);
          }
        }
      }
    }
    c.strokeStyle = P.foliageLime;
    c.lineWidth = 1.2;
    c.beginPath();
    c.moveTo(0, 0);
    for (let i = 1; i <= 10; i++) {
      const [px, py] = pt(i / 10);
      c.lineTo(px, py);
    }
    c.stroke();
  });
}

function pebbles(ppu: number, seed: number, size: number): Sprite {
  const rand = makeRand(seed);
  return makeSprite(size, size, ppu, (c) => {
    const n = 3 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) {
      const a = rand() * TAU;
      const d = rand() * size * 0.24;
      const x = Math.cos(a) * d;
      const y = Math.sin(a) * d;
      const rx = 2.6 + rand() * 3.2;
      const ry = rx * (0.65 + rand() * 0.25);
      const rot = rand() * Math.PI;
      halo(c, ppu, 1.5, 0.5);
      c.fillStyle = P.rockDark;
      c.beginPath();
      c.ellipse(x, y, rx, ry, rot, 0, TAU);
      c.fill();
      noHalo(c);
      c.fillStyle = P.pebble;
      c.beginPath();
      c.ellipse(x - rx * 0.12, y - ry * 0.14, rx * 0.84, ry * 0.8, rot, 0, TAU);
      c.fill();
      c.fillStyle = P.pebbleLight;
      c.beginPath();
      c.ellipse(x - rx * 0.32, y - ry * 0.34, rx * 0.36, ry * 0.3, rot, 0, TAU);
      c.fill();
    }
    if (rand() < 0.6) {
      c.fillStyle = P.moss;
      c.beginPath();
      c.ellipse(size * 0.1, -size * 0.12, 2.4, 1.6, 0.4, 0, TAU);
      c.fill();
    }
  });
}

function mushrooms(ppu: number, seed: number, size: number): Sprite {
  const rand = makeRand(seed);
  return makeSprite(size, size, ppu, (c) => {
    const n = 3 + Math.floor(rand() * 2);
    for (let i = 0; i < n; i++) {
      const a = rand() * TAU;
      const d = rand() * size * 0.22;
      const x = Math.cos(a) * d;
      const y = Math.sin(a) * d;
      const r = 2.4 + rand() * 2.2;
      halo(c, ppu, 1.5, 0.6);
      c.fillStyle = '#b24f22';
      c.beginPath();
      c.arc(x, y, r, 0, TAU);
      c.fill();
      noHalo(c);
      c.fillStyle = P.mushroom;
      c.beginPath();
      c.arc(x - r * 0.1, y - r * 0.12, r * 0.85, 0, TAU);
      c.fill();
      c.fillStyle = P.mushroomDots;
      for (let k = 0; k < 3; k++) {
        const b = rand() * TAU;
        c.beginPath();
        c.arc(x + Math.cos(b) * r * 0.45, y + Math.sin(b) * r * 0.45, r * 0.16, 0, TAU);
        c.fill();
      }
    }
  });
}

function canopy(ppu: number, seed: number, size: number): Sprite {
  const rand = makeRand(seed);
  return makeSprite(size, size, ppu, (c) => {
    halo(c, ppu, 7, 0.6);
    const r = size * 0.45;
    const n = 10 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * TAU + rand() * 0.4;
      const len = r * (0.78 + rand() * 0.22);
      leaf2(c, 0, 0, ang, len, len * 0.34, P.canopyDark, P.canopy, null);
    }
    halo(c, ppu, 3, 0.4);
    for (let i = 0; i < 7; i++) {
      const ang = rand() * TAU;
      const len = r * (0.5 + rand() * 0.2);
      leaf2(c, 0, 0, ang, len, len * 0.38, P.canopy, P.canopyLight, P.foliage);
    }
    noHalo(c);
    for (let i = 0; i < 4; i++) {
      const ang = rand() * TAU;
      const len = r * 0.3;
      leaf2(c, 0, 0, ang, len, len * 0.42, P.canopyLight, P.foliage, null);
    }
  });
}

function lily(ppu: number, seed: number, kind: 0 | 1 | 2): Sprite {
  const rand = makeRand(seed);
  const size = kind === 2 ? 40 : 30;
  return makeSprite(size, size, ppu, (c) => {
    const pad = (x: number, y: number, r: number, rot: number) => {
      const notch = 0.42;
      c.save();
      c.translate(x, y);
      c.rotate(rot);
      halo(c, ppu, 2, 0.45);
      c.fillStyle = P.lilyDark;
      c.beginPath();
      c.moveTo(0, 0);
      c.arc(0, 0, r, notch / 2, TAU - notch / 2);
      c.closePath();
      c.fill();
      noHalo(c);
      c.fillStyle = P.lily;
      c.beginPath();
      c.moveTo(0, 0);
      c.arc(-r * 0.04, -r * 0.05, r * 0.9, notch / 2 + 0.05, TAU - notch / 2 - 0.05);
      c.closePath();
      c.fill();
      c.fillStyle = P.lilyLight;
      c.beginPath();
      c.moveTo(0, 0);
      c.arc(-r * 0.06, -r * 0.08, r * 0.82, Math.PI * 0.95, Math.PI * 1.6);
      c.closePath();
      c.globalAlpha = 0.55;
      c.fill();
      c.globalAlpha = 1;
      c.strokeStyle = P.lilyDark;
      c.lineWidth = 0.55;
      c.beginPath();
      for (let i = 0; i < 7; i++) {
        const a = notch / 2 + 0.3 + (i / 6) * (TAU - notch - 0.6);
        c.moveTo(0, 0);
        c.lineTo(Math.cos(a) * r * 0.82, Math.sin(a) * r * 0.82);
      }
      c.stroke();
      c.restore();
    };
    if (kind === 2) {
      pad(-6, 4, 9.5, rand() * TAU);
      pad(8, -5, 7.5, rand() * TAU);
      pad(4, 11, 5.5, rand() * TAU);
    } else {
      pad(0, 0, 11.5, rand() * TAU);
    }
    if (kind === 1) {
      // Lotus bloom, seen from above.
      c.save();
      c.translate(2, -2);
      halo(c, ppu, 1.5, 0.4);
      c.fillStyle = '#f39abb';
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        c.beginPath();
        c.ellipse(Math.cos(a) * 3.6, Math.sin(a) * 3.6, 3.4, 1.9, a, 0, TAU);
        c.fill();
      }
      noHalo(c);
      c.fillStyle = '#ffd0e0';
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + 0.3;
        c.beginPath();
        c.ellipse(Math.cos(a) * 2, Math.sin(a) * 2, 2.3, 1.3, a, 0, TAU);
        c.fill();
      }
      c.fillStyle = P.flowerYellow;
      c.beginPath();
      c.arc(0, 0, 1.4, 0, TAU);
      c.fill();
      c.restore();
    }
  });
}

function petal(ppu: number, color: string): Sprite {
  return makeSprite(7, 7, ppu, (c) => {
    c.fillStyle = 'rgba(3, 20, 28, 0.25)';
    c.beginPath();
    c.ellipse(0.5, 0.7, 2.6, 1.5, 0.3, 0, TAU);
    c.fill();
    c.fillStyle = color;
    c.beginPath();
    c.ellipse(0, 0, 2.6, 1.5, 0.3, 0, TAU);
    c.fill();
    c.fillStyle = 'rgba(255,255,255,0.45)';
    c.beginPath();
    c.ellipse(-0.6, -0.3, 1.1, 0.6, 0.3, 0, TAU);
    c.fill();
  });
}

export function buildFoliage(ppu: number): FoliageSprites {
  const flowerColors = [P.flowerPink, P.flowerCoral, P.flowerViolet, P.flowerWhite, P.flowerYellow];
  return {
    fern: [fern(ppu, 11, 46), fern(ppu, 12, 40), fern(ppu, 13, 52)],
    grass: [grass(ppu, 21, 30), grass(ppu, 22, 26)],
    broadleaf: [broadleaf(ppu, 31, 46, null), broadleaf(ppu, 32, 54, null), broadleaf(ppu, 33, 40, null)],
    flowers: flowerColors.map((col, i) => broadleaf(ppu, 41 + i, 38, col)),
    monstera: [monstera(ppu, 51, 58), monstera(ppu, 52, 50)],
    palm: [palm(ppu, 61, 86), palm(ppu, 62, 74)],
    pebbles: [pebbles(ppu, 71, 26), pebbles(ppu, 72, 22)],
    mushrooms: [mushrooms(ppu, 91, 22), mushrooms(ppu, 92, 18)],
    canopy: [canopy(ppu, 101, 120), canopy(ppu, 102, 100), canopy(ppu, 103, 136)],
    lily: [lily(ppu, 111, 0), lily(ppu, 112, 1), lily(ppu, 113, 2), lily(ppu, 114, 0)],
    petal: [petal(ppu, '#ff9cc0'), petal(ppu, P.flowerWhite), petal(ppu, '#ffc27a')],
  };
}

/**
 * Seamless jungle-floor tile used as a pattern for every bank: leaf litter and
 * low plants, darker and calmer than the edge clumps so the river stays the focus.
 */
export function buildJungleTile(ppu: number): Tile {
  const T = 240;
  const img = document.createElement('canvas');
  const px = Math.max(16, Math.round(T * ppu));
  img.width = px;
  img.height = px;
  const c = img.getContext('2d');
  const scale = px / T;
  if (!c) return { img, size: T, scale };
  c.setTransform(scale, 0, 0, scale, 0, 0);
  c.lineCap = 'round';
  c.fillStyle = P.jungleDark;
  c.fillRect(0, 0, T, T);
  const rand = makeRand(4242);
  const wrap = (x: number, y: number, r: number, draw: (x: number, y: number) => void) => {
    for (let dx = -T; dx <= T; dx += T) {
      for (let dy = -T; dy <= T; dy += T) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx + r < 0 || xx - r > T || yy + r < 0 || yy - r > T) continue;
        draw(xx, yy);
      }
    }
  };
  // Soft darker/lighter patches break up the flat base.
  for (let i = 0; i < 14; i++) {
    const x = rand() * T;
    const y = rand() * T;
    const r = 18 + rand() * 30;
    const col = i % 2 ? 'rgba(4, 18, 10, 0.35)' : 'rgba(40, 90, 50, 0.22)';
    const rot = rand() * TAU;
    wrap(x, y, r, (xx, yy) => {
      c.fillStyle = col;
      c.beginPath();
      c.ellipse(xx, yy, r, r * 0.8, rot, 0, TAU);
      c.fill();
    });
  }
  halo(c, scale, 2.5, 0.55);
  const tones: [string, string][] = [
    [P.jungleDeep, P.jungle],
    [P.jungle, P.foliageDeep],
    [P.foliageDeep, P.foliageDark],
    [P.jungleDeep, P.jungleDark],
  ];
  for (let i = 0; i < 150; i++) {
    const x = rand() * T;
    const y = rand() * T;
    const len = 7 + rand() * 14;
    const ang = rand() * TAU;
    const [b, l] = tones[Math.floor(rand() * tones.length)];
    wrap(x, y, len, (xx, yy) => leaf2(c, xx, yy, ang, len, len * 0.36, b, l, null));
  }
  // Low fern-like rosettes.
  for (let i = 0; i < 12; i++) {
    const x = rand() * T;
    const y = rand() * T;
    const n = 5 + Math.floor(rand() * 3);
    const len = 10 + rand() * 8;
    const a0 = rand() * TAU;
    wrap(x, y, len, (xx, yy) => {
      for (let k = 0; k < n; k++) {
        leaf2(c, xx, yy, a0 + (k / n) * TAU, len, len * 0.3, P.foliageDeep, P.foliageDark, P.foliage);
      }
    });
  }
  noHalo(c);
  // Tiny flowers and seeds: warm specks that make the floor feel alive.
  const specks = [P.flowerPink, P.flowerYellow, P.flowerWhite, P.flowerCoral];
  for (let i = 0; i < 26; i++) {
    const x = rand() * T;
    const y = rand() * T;
    const r = 0.9 + rand() * 1.1;
    const col = specks[Math.floor(rand() * specks.length)];
    wrap(x, y, r, (xx, yy) => {
      c.globalAlpha = 0.75;
      c.fillStyle = col;
      c.beginPath();
      c.arc(xx, yy, r, 0, TAU);
      c.fill();
      c.globalAlpha = 1;
    });
  }
  return { img, size: T, scale };
}
