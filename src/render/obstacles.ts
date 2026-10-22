// Rocks and twigs. Rock bodies are pre-rendered variants (flat-shaded, some
// mossy, all with a wet sheen); their foam ring, bow wave and wake are drawn live
// so they shimmer. Twigs are drawn live in a local rotated frame.

import type { Obstacle, World } from '../types';
import { makeSprite, type Gfx, type Sprite } from './gfx';
import { P } from './palette';
import { TAU, makeRand } from './util';

/** Reference radius the rock sprites are rendered at; scaled to each rock's r. */
const R0 = 34;
const VARIANTS = 6;

function rockSprite(ppu: number, seed: number): Sprite {
  const rand = makeRand(seed);
  const verts = 7 + Math.floor(rand() * 3);
  const rs: number[] = [];
  // Irregular but averaging ~0.93 of R0, so the drawn rock matches its collision circle.
  for (let i = 0; i < verts; i++) rs.push(R0 * (0.8 + rand() * 0.26));
  const mossy = seed % 2 === 0;
  const size = R0 * 2.3;
  return makeSprite(size, size, ppu, (c) => {
    const shape = (s: number, ox: number, oy: number) => {
      c.beginPath();
      for (let i = 0; i <= verts; i++) {
        const a0 = (i / verts) * TAU;
        const a1 = ((i + 1) / verts) * TAU;
        const p0x = ox + Math.cos(a0) * rs[i % verts] * s;
        const p0y = oy + Math.sin(a0) * rs[i % verts] * s;
        const p1x = ox + Math.cos(a1) * rs[(i + 1) % verts] * s;
        const p1y = oy + Math.sin(a1) * rs[(i + 1) % verts] * s;
        const mx = (p0x + p1x) / 2;
        const my = (p0y + p1y) / 2;
        if (i === 0) c.moveTo(mx, my);
        else c.quadraticCurveTo(p0x, p0y, mx, my);
      }
      c.closePath();
    };
    c.shadowColor = 'rgba(0, 12, 20, 0.5)';
    c.shadowBlur = 3 * ppu;
    c.fillStyle = P.rockDark;
    shape(1, 0, 0);
    c.fill();
    c.shadowColor = 'transparent';
    c.shadowBlur = 0;
    c.fillStyle = P.rock;
    shape(0.88, -R0 * 0.05, -R0 * 0.07);
    c.fill();
    c.fillStyle = P.rockLight;
    shape(0.6, -R0 * 0.14, -R0 * 0.19);
    c.fill();
    c.fillStyle = P.rockTop;
    c.globalAlpha = 0.8;
    shape(0.28, -R0 * 0.28, -R0 * 0.33);
    c.fill();
    c.globalAlpha = 1;
    // Cracks.
    c.strokeStyle = P.rockDark;
    c.lineWidth = 1.3;
    c.beginPath();
    const ca = rand() * TAU;
    c.moveTo(Math.cos(ca) * R0 * 0.15, Math.sin(ca) * R0 * 0.15);
    c.lineTo(Math.cos(ca + 0.3) * R0 * 0.5, Math.sin(ca + 0.3) * R0 * 0.5);
    c.lineTo(Math.cos(ca + 0.1) * R0 * 0.78, Math.sin(ca + 0.1) * R0 * 0.78);
    c.stroke();
    // Speckles.
    c.fillStyle = 'rgba(30, 38, 44, 0.45)';
    for (let i = 0; i < 7; i++) {
      const a = rand() * TAU;
      const d = rand() * R0 * 0.7;
      c.beginPath();
      c.arc(Math.cos(a) * d, Math.sin(a) * d, 0.8 + rand() * 0.9, 0, TAU);
      c.fill();
    }
    if (mossy) {
      // A cluster of soft moss blobs on the lit shoulder, never a single shape.
      const a = Math.PI * (1.05 + rand() * 0.5);
      const mx = Math.cos(a) * R0 * 0.42;
      const my = Math.sin(a) * R0 * 0.42;
      c.fillStyle = P.moss;
      for (let i = 0; i < 6; i++) {
        const ba = rand() * TAU;
        const bd = rand() * R0 * 0.2;
        c.beginPath();
        c.arc(mx + Math.cos(ba) * bd, my + Math.sin(ba) * bd * 0.7, R0 * (0.07 + rand() * 0.08), 0, TAU);
        c.fill();
      }
      c.fillStyle = P.mossLight;
      for (let i = 0; i < 4; i++) {
        c.beginPath();
        c.arc(mx - R0 * 0.05 + (rand() - 0.5) * R0 * 0.3, my - R0 * 0.05 + (rand() - 0.5) * R0 * 0.2, R0 * (0.03 + rand() * 0.03), 0, TAU);
        c.fill();
      }
    }
    // Wet sheen: a crisp highlight arc on the lit side.
    c.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    c.lineWidth = 2;
    c.beginPath();
    c.arc(-R0 * 0.08, -R0 * 0.1, R0 * 0.66, Math.PI * 1.08, Math.PI * 1.42);
    c.stroke();
    c.fillStyle = 'rgba(255, 255, 255, 0.75)';
    c.beginPath();
    c.arc(-R0 * 0.42, -R0 * 0.18, 1.6, 0, TAU);
    c.fill();
  });
}

export class ObstacleArt {
  private rocks: Sprite[] = [];

  build(ppu: number): void {
    this.rocks = [];
    for (let i = 0; i < VARIANTS; i++) this.rocks.push(rockSprite(ppu, 300 + i));
  }

  draw(g: Gfx, world: World): void {
    const list = world.obstacles;
    if (!list.length) return;
    // Water effects for all rocks first, so a neighbour's foam never paints over a rock body.
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (o.kind === 'rock' && this.visible(g, o)) this.rockWater(g, o);
    }
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (!this.visible(g, o)) continue;
      g.ctx.globalAlpha = o.hit ? 0.42 : 1;
      if (o.kind === 'rock') this.rockBody(g, o);
      else this.twig(g, o);
    }
    g.ctx.globalAlpha = 1;
  }

  private visible(g: Gfx, o: Obstacle): boolean {
    const ext = Math.max(o.r, o.len) * 2.6 + 20;
    return o.y > -ext && o.y < g.viewH + ext;
  }

  private rockWater(g: Gfx, o: Obstacle): void {
    const { ctx, t } = g;
    const { x, y, r } = o;
    const ph = o.id * 1.7;
    g.world();
    ctx.globalAlpha = o.hit ? 0.3 : 1;
    // Darker eddy around the rock.
    ctx.fillStyle = 'rgba(4, 26, 36, 0.32)';
    ctx.beginPath();
    ctx.ellipse(x + 2.5, y + 3.5, r * 1.32, r * 1.26, 0, 0, TAU);
    ctx.fill();
    // Wake streaming downstream (up the screen).
    ctx.strokeStyle = P.foam;
    ctx.lineCap = 'round';
    ctx.lineWidth = 2;
    ctx.globalAlpha = (o.hit ? 0.3 : 1) * 0.22;
    // Ripple arcs on the downstream (upper) side: water closing in behind the rock.
    ctx.beginPath();
    const wob = Math.sin(t * 3 + ph) * 0.06;
    const r1 = r * 1.42;
    const r2 = r * 1.75;
    ctx.arc(x, y, r1, -Math.PI * 0.86 + wob, -Math.PI * 0.6 + wob);
    ctx.moveTo(x + Math.cos(-Math.PI * 0.4 - wob) * r1, y + Math.sin(-Math.PI * 0.4 - wob) * r1);
    ctx.arc(x, y, r1, -Math.PI * 0.4 - wob, -Math.PI * 0.14 - wob);
    ctx.moveTo(x + Math.cos(-Math.PI * 0.7) * r2, y + Math.sin(-Math.PI * 0.7) * r2);
    ctx.arc(x, y, r2, -Math.PI * 0.7, -Math.PI * 0.3);
    ctx.stroke();
    // Foam ring and the brighter bow wave on the upstream (lower) side.
    ctx.globalAlpha = (o.hit ? 0.3 : 1) * (0.38 + Math.sin(t * 4 + ph) * 0.1);
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.16 + Math.sin(t * 3.3 + ph) * 0.8, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = (o.hit ? 0.3 : 1) * 0.7;
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.08 + 1.2 + Math.sin(t * 5 + ph) * 1.2, Math.PI * 0.12, Math.PI * 0.88);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private rockBody(g: Gfx, o: Obstacle): void {
    const s = this.rocks[Math.min(VARIANTS - 1, Math.floor(o.variant * VARIANTS))];
    if (!s) return;
    g.sprite(s, o.x, o.y, o.angle, o.r / R0);
  }

  private twig(g: Gfx, o: Obstacle): void {
    const { ctx, t } = g;
    const { len, r } = o;
    const half = r;
    const cosA = Math.cos(o.angle);
    const sinA = Math.sin(o.angle);
    // World-space offsets expressed in the twig's local frame.
    const shX = 2.5 * cosA + 3.5 * sinA;
    const shY = -2.5 * sinA + 3.5 * cosA;
    // Which local side faces the light (top-left in world space).
    const lit = -0.6 * -sinA + -0.8 * cosA < 0 ? -1 : 1;
    const baseAlpha = ctx.globalAlpha;

    g.local(o.x, o.y, o.angle);
    ctx.lineCap = 'round';

    // Water: shadow and the foam pushed up at both ends.
    ctx.globalAlpha = baseAlpha * 0.32;
    ctx.strokeStyle = P.waterShade;
    ctx.lineWidth = half * 2 + 2;
    ctx.beginPath();
    ctx.moveTo(-len + shX, shY);
    ctx.lineTo(len + shX, shY);
    ctx.stroke();
    if (!o.hit) {
      ctx.globalAlpha = baseAlpha * (0.45 + Math.sin(t * 4 + o.id) * 0.12);
      ctx.strokeStyle = P.foam;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(-len, 0, half + 3, Math.PI * 0.6, Math.PI * 1.4);
      ctx.moveTo(len + Math.cos(-Math.PI * 0.4) * (half + 3), Math.sin(-Math.PI * 0.4) * (half + 3));
      ctx.arc(len, 0, half + 3, -Math.PI * 0.4, Math.PI * 0.4);
      ctx.stroke();
    }
    ctx.globalAlpha = baseAlpha;

    // Side branch with two little leaves (drawn first so the trunk overlaps it).
    const bx = (o.variant - 0.5) * len * 1.1;
    const bs = o.variant > 0.5 ? 1 : -1;
    ctx.strokeStyle = P.barkDark;
    ctx.lineWidth = half * 0.9 + 1.2;
    ctx.beginPath();
    ctx.moveTo(bx, 0);
    ctx.lineTo(bx + len * 0.28, bs * half * 2.6);
    ctx.stroke();
    ctx.strokeStyle = P.bark;
    ctx.lineWidth = half * 0.9;
    ctx.stroke();
    twigLeaf(ctx, bx + len * 0.28, bs * half * 2.6, bs * 0.9, half * 2.4);
    twigLeaf(ctx, bx + len * 0.16, bs * half * 1.6, bs * 2.2 + Math.PI, half * 1.9);

    // Trunk: outline, body, lit edge.
    ctx.strokeStyle = P.barkDark;
    ctx.lineWidth = half * 2 + 1.8;
    ctx.beginPath();
    ctx.moveTo(-len, 0);
    ctx.lineTo(len, 0);
    ctx.stroke();
    ctx.strokeStyle = P.bark;
    ctx.lineWidth = half * 2;
    ctx.stroke();
    ctx.strokeStyle = P.barkLight;
    ctx.lineWidth = half * 0.55;
    ctx.beginPath();
    ctx.moveTo(-len + half * 0.4, lit * half * 0.45);
    ctx.lineTo(len - half * 0.4, lit * half * 0.45);
    ctx.stroke();
    // Bark grain.
    ctx.strokeStyle = P.barkDark;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const gx = -len * 0.8 + (i / 4) * len * 1.6 + (o.variant * 37 * (i + 1)) % 5;
      ctx.moveTo(gx, -half * 0.35);
      ctx.lineTo(gx + len * 0.12, -half * 0.15);
    }
    ctx.stroke();
    // Knots.
    for (let i = 0; i < 2; i++) {
      const kx = (i === 0 ? -0.45 : 0.38) * len + o.variant * 4;
      ctx.fillStyle = P.barkDark;
      ctx.beginPath();
      ctx.ellipse(kx, 0, half * 0.55, half * 0.42, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = P.barkLight;
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }
    // Snapped ends show pale wood.
    ctx.fillStyle = P.barkLight;
    ctx.beginPath();
    ctx.ellipse(len, 0, half * 0.45, half * 0.75, 0, 0, TAU);
    ctx.fill();
  }
}

function twigLeaf(ctx: CanvasRenderingContext2D, x: number, y: number, ang: number, len: number): void {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const w = len * 0.42;
  const tx = x + c * len;
  const ty = y + s * len;
  ctx.fillStyle = P.foliage;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x + c * len * 0.5 - s * w, y + s * len * 0.5 + c * w, tx, ty);
  ctx.quadraticCurveTo(x + c * len * 0.5 + s * w, y + s * len * 0.5 - c * w, x, y);
  ctx.fill();
  ctx.fillStyle = P.foliageLight;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x + c * len * 0.5 + s * w, y + s * len * 0.5 - c * w, tx, ty);
  ctx.closePath();
  ctx.fill();
}
