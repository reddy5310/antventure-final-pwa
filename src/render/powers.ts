// Active power-up visuals on the leaf and ant, drawn right after the ant:
//   mushroom  a translucent red cap over the ant (blinks over its last 2 s)
//   honey     an amber shimmer ring of honeycomb cells, and faint pull lines to the crumbs it is drawing in
//   firefly   a few fireflies orbiting the leaf in a warm glow (they fly off one by one at the end)
// Timers come from world.powers (set by the sim in steps); only the blinking
// and orbiting run on the frame clock, which is fine for ambience.
//
// The ant must stay readable under every aura: the cap is see-through in the
// middle, the rings stay outside the body, and nothing here covers a drop
// telegraph (those are drawn later).

import { MAGNET_RANGE } from '../game/pickups';
import type { ActivePower, PowerKind, World } from '../types';
import { makeSprite, type Gfx, type Sprite } from './gfx';
import type { LeafPose } from './leaf';
import { glowSprite } from './pickups';
import { TAU, clamp01, easeOutBack, frac } from './util';

/** The cap sits just outside the ant (about 36 units long) and inside the leaf. */
const CAP_R = 25;
const CAP_BOX = 64;
/** Honey cells orbit here. */
const HONEY_R = 34;
const CELLS = 8;
/** Seconds before the end that an effect starts to warn. */
const WARN = 2;
const FLIES = 4;
const POP_TIME = 0.3;
/** The firefly sprite is drawn this much larger than its art box: small enough to be a bug, big enough to read. */
const FLY_SCALE = 1.5;
/**
 * With all three powers on, the honey cells and the fireflies sit at this share
 * of their strength: the mushroom (the one that says "you are protected") stays
 * the strongest, and the ant is not buried under three stacked auras.
 */
const CROWDED = 0.55;

function capSprite(ppu: number): Sprite {
  return makeSprite(CAP_BOX, CAP_BOX, ppu, (c) => {
    // Dome: clear in the middle so the ant shows through, solid red towards the rim.
    const g = c.createRadialGradient(0, 0, 0, 0, 0, CAP_R);
    g.addColorStop(0, 'rgba(255, 130, 120, 0.05)');
    g.addColorStop(0.55, 'rgba(255, 96, 88, 0.16)');
    g.addColorStop(0.84, 'rgba(228, 50, 66, 0.58)');
    g.addColorStop(1, 'rgba(190, 24, 50, 0.86)');
    c.fillStyle = g;
    c.beginPath();
    c.arc(0, 0, CAP_R, 0, TAU);
    c.fill();
    // Gills seen through the cap: faint spokes in the outer band.
    c.strokeStyle = 'rgba(110, 10, 34, 0.32)';
    c.lineWidth = 0.9;
    c.beginPath();
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * TAU;
      c.moveTo(Math.cos(a) * CAP_R * 0.7, Math.sin(a) * CAP_R * 0.7);
      c.lineTo(Math.cos(a) * CAP_R * 0.95, Math.sin(a) * CAP_R * 0.95);
    }
    c.stroke();
    // Rim.
    c.strokeStyle = '#8a1232';
    c.lineWidth = 2.4;
    c.beginPath();
    c.arc(0, 0, CAP_R - 0.4, 0, TAU);
    c.stroke();
    c.strokeStyle = 'rgba(255, 176, 164, 0.9)';
    c.lineWidth = 1;
    c.beginPath();
    c.arc(0, 0, CAP_R - 2.4, 0, TAU);
    c.stroke();
    // The cream spots. All sit in the outer band, clear of the ant's body.
    const spots: readonly [number, number, number][] = [
      [-0.9, 0.78, 3.4],
      [0.5, 0.82, 2.6],
      [2.2, 0.72, 3.1],
      [3.5, 0.78, 2.3],
      [4.7, 0.8, 3],
      [5.7, 0.7, 2.2],
      [1.4, 0.58, 1.7],
      [-2.2, 0.62, 1.8],
    ];
    for (const [a, rr, r] of spots) {
      const x = Math.cos(a) * CAP_R * rr;
      const y = Math.sin(a) * CAP_R * rr;
      c.fillStyle = 'rgba(120, 10, 36, 0.4)';
      c.beginPath();
      c.arc(x + 0.5, y + 0.7, r + 0.4, 0, TAU);
      c.fill();
      c.fillStyle = '#fff7ea';
      c.beginPath();
      c.arc(x, y, r, 0, TAU);
      c.fill();
    }
    // Sheen on the lit (top left) shoulder.
    c.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    c.lineWidth = 2.2;
    c.lineCap = 'round';
    c.beginPath();
    c.arc(0, 0, CAP_R - 5, Math.PI * 1.08, Math.PI * 1.34);
    c.stroke();
  });
}

function flySprite(ppu: number): Sprite {
  // Top view, head up: glassy wings, dark body, a bright lantern.
  return makeSprite(14, 14, ppu, (c) => {
    c.lineCap = 'round';
    c.fillStyle = 'rgba(235, 250, 255, 0.8)';
    c.strokeStyle = 'rgba(60, 80, 90, 0.6)';
    c.lineWidth = 0.4;
    for (const s of [-1, 1]) {
      c.beginPath();
      c.ellipse(s * 2.9, -0.2, 1.4, 3.6, s * 0.5, 0, TAU);
      c.fill();
      c.stroke();
    }
    c.fillStyle = '#2a251c';
    c.beginPath();
    c.ellipse(0, -2.6, 1, 0.9, 0, 0, TAU);
    c.fill();
    c.fillStyle = '#3a3524';
    c.beginPath();
    c.ellipse(0, 0.2, 1.3, 2.2, 0, 0, TAU);
    c.fill();
    c.fillStyle = '#f4ffb0';
    c.beginPath();
    c.ellipse(0, 2.4, 1.2, 1.5, 0, 0, TAU);
    c.fill();
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.arc(0, 2.6, 0.6, 0, TAU);
    c.fill();
  });
}

function warmGlow(ppu: number): Sprite {
  return makeSprite(96, 96, Math.min(ppu, 1), (c) => {
    const g = c.createRadialGradient(0, 0, 0, 0, 0, 48);
    g.addColorStop(0, 'rgba(255, 244, 160, 0.85)');
    g.addColorStop(0.3, 'rgba(236, 255, 120, 0.36)');
    g.addColorStop(1, 'rgba(206, 255, 92, 0)');
    c.fillStyle = g;
    c.fillRect(-48, -48, 96, 96);
  });
}

const kindIdx = (k: PowerKind): number => (k === 'mushroom' ? 0 : k === 'honey' ? 1 : 2);

export class PowerArt {
  // Per kind: was it on last frame, its timer then, and did it just get refreshed (a swell, not a re-pop).
  private on = [false, false, false];
  private prevLeft = [0, 0, 0];
  private swell = [false, false, false];
  private cap: Sprite | null = null;
  private fly: Sprite | null = null;
  private warm: Sprite | null = null;
  private fx = 0;
  private fy = 0;
  private fa = 0;

  build(ppu: number): void {
    this.cap = capSprite(ppu);
    this.fly = flySprite(ppu);
    this.warm = warmGlow(ppu);
  }

  /** Drawn right after the ant, in leaf space via `pose`. */
  draw(g: Gfx, world: World, pose: LeafPose): void {
    const list = world.powers;
    if (!list.length) {
      this.on[0] = this.on[1] = this.on[2] = false;
      return;
    }
    // A power picked up again while running gets a quick swell; one that appears fresh pops in from nothing.
    for (let i = 0; i < list.length; i++) {
      const pw = list[i];
      const k = kindIdx(pw.kind);
      if (!this.on[k]) this.swell[k] = false;
      else if (pw.left > this.prevLeft[k] + 0.05) this.swell[k] = true;
      this.prevLeft[k] = pw.left;
    }
    this.on[0] = this.on[1] = this.on[2] = false;
    for (let i = 0; i < list.length; i++) this.on[kindIdx(list[i].kind)] = true;

    if (world.state === 'dying' || world.state === 'over' || pose.alpha < 0.05) return;
    const calmer = list.length >= 3 ? CROWDED : 1;
    for (let i = 0; i < list.length; i++) {
      const pw = list[i];
      if (pw.left <= 0) continue;
      if (pw.kind === 'mushroom') this.mushroom(g, pw, pose);
      else if (pw.kind === 'honey') this.honey(g, world, pw, pose, calmer);
      else this.firefly(g, pw, pose, calmer);
    }
    g.ctx.globalAlpha = 1;
  }

  private mushroom(g: Gfx, pw: ActivePower, pose: LeafPose): void {
    const { ctx, t } = g;
    if (!this.cap) return;
    const calm = g.reduced;
    const grow = this.grow(pw);
    let alpha = 1;
    if (pw.left < WARN) {
      // Blink faster as it runs out; reduced motion gets a steady dim instead of a flash.
      alpha = calm ? 0.55 : Math.floor(t * (6 + (WARN - pw.left) * 5)) % 2 === 0 ? 1 : 0.3;
    }
    const pulse = calm ? 1 : 1 + Math.sin(t * 3.1) * 0.022;
    ctx.globalAlpha = alpha * pose.alpha;
    g.sprite(this.cap, pose.x, pose.y - 0.5, pose.rot * 0.6, pose.scale * grow * pulse);
    // A slow glint sweeping the rim.
    if (!calm) {
      g.local(pose.x, pose.y - 0.5, 0, pose.scale * grow * pulse);
      ctx.strokeStyle = '#ffffff';
      ctx.lineCap = 'round';
      ctx.lineWidth = 1.6;
      ctx.globalAlpha = 0.5 * alpha * pose.alpha;
      const a = t * 1.4;
      ctx.beginPath();
      ctx.arc(0, 0, CAP_R - 1.2, a, a + 0.42);
      ctx.stroke();
    }
  }

  private honey(g: Gfx, world: World, pw: ActivePower, pose: LeafPose, strength: number): void {
    const { ctx, t } = g;
    const calm = g.reduced;
    const grow = this.grow(pw);
    // Running out: the whole aura flickers gently and shrinks a little.
    const fade = pw.left < WARN ? (calm ? 0.55 : 0.55 + 0.45 * Math.abs(Math.sin(t * 7))) : 1;
    const base = fade * pose.alpha * strength;
    const glow = glowSprite('honey');

    // Pull lines first (under the ring): faint streaks and dots flowing from each nearby crumb to the leaf.
    const pk = world.pickups;
    const r2 = MAGNET_RANGE * MAGNET_RANGE;
    g.world();
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#ffc43d';
    ctx.lineWidth = 1.3;
    ctx.globalAlpha = 0.2 * base * grow;
    ctx.beginPath();
    let any = false;
    for (let i = 0; i < pk.length; i++) {
      const k = pk[i];
      if (k.kind !== 'crumb' || k.taken) continue;
      const dx = pose.x - k.x;
      const dy = pose.y - k.y;
      if (dx * dx + dy * dy > r2) continue;
      ctx.moveTo(k.x, k.y);
      ctx.lineTo(pose.x - dx * 0.2, pose.y - dy * 0.2);
      any = true;
    }
    if (any) ctx.stroke();
    if (any && !calm) {
      ctx.fillStyle = '#ffe9a0';
      ctx.globalAlpha = 0.85 * base * grow;
      ctx.beginPath();
      for (let i = 0; i < pk.length; i++) {
        const k = pk[i];
        if (k.kind !== 'crumb' || k.taken) continue;
        const dx = pose.x - k.x;
        const dy = pose.y - k.y;
        if (dx * dx + dy * dy > r2) continue;
        for (let j = 0; j < 3; j++) {
          const u = frac(t * 1.3 + j / 3 + k.id * 0.37) * 0.8;
          ctx.moveTo(k.x + dx * u + 1.5, k.y + dy * u);
          ctx.arc(k.x + dx * u, k.y + dy * u, 1.5, 0, TAU);
        }
      }
      ctx.fill();
    }

    // Warm wash and the ring of honeycomb cells.
    if (glow) {
      ctx.globalAlpha = (0.42 + (calm ? 0 : Math.sin(t * 2.4) * 0.08)) * base * grow;
      g.sprite(glow, pose.x, pose.y, 0, 0.95 * grow);
    }
    g.world();
    const r = HONEY_R * (0.55 + 0.45 * grow) + (calm ? 0 : Math.sin(t * 2.2) * 1.2);
    ctx.strokeStyle = '#ffc43d';
    ctx.lineWidth = 1.2;
    ctx.globalAlpha = 0.28 * base;
    ctx.beginPath();
    ctx.arc(pose.x, pose.y, r, 0, TAU);
    ctx.stroke();
    const spin = calm ? 0 : t * 0.7;
    ctx.lineWidth = 1.8;
    ctx.fillStyle = 'rgba(255, 214, 90, 0.42)';
    for (let i = 0; i < CELLS; i++) {
      const a = spin + (i / CELLS) * TAU;
      const shimmer = calm ? 0.85 : 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 3.2 + i * 1.9));
      ctx.globalAlpha = shimmer * base;
      const cx = pose.x + Math.cos(a) * r;
      const cy = pose.y + Math.sin(a) * r;
      ctx.beginPath();
      for (let s = 0; s < 6; s++) {
        const ha = a + (s / 6) * TAU;
        const hx = cx + Math.cos(ha) * 4.4;
        const hy = cy + Math.sin(ha) * 4.4;
        if (s === 0) ctx.moveTo(hx, hy);
        else ctx.lineTo(hx, hy);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  private firefly(g: Gfx, pw: ActivePower, pose: LeafPose, strength: number): void {
    const { ctx, t } = g;
    const calm = g.reduced;
    const grow = this.grow(pw);
    // Fireflies leave one at a time over the last WARN seconds: an ending with no flashing.
    const show = pw.left < WARN ? (pw.left / WARN) * FLIES : FLIES;
    const warm = this.warm;
    const fly = this.fly;
    if (!warm || !fly) return;
    const alpha = pose.alpha * strength;

    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = (0.3 + (calm ? 0 : Math.sin(t * 2.1) * 0.06)) * clamp01(show / 2) * alpha * grow;
    g.sprite(warm, pose.x, pose.y, 0, 1.15);
    for (let i = 0; i < FLIES; i++) {
      const vis = clamp01(show - i);
      if (vis <= 0) continue;
      this.place(i, t, calm, grow, pose);
      const blink = calm ? 0.8 : 0.55 + 0.45 * Math.sin(t * (3.2 + i * 0.7) + i * 2.3);
      ctx.globalAlpha = (0.5 + 0.5 * blink) * vis * alpha;
      g.sprite(warm, this.fx, this.fy, 0, 0.3 + 0.2 * blink);
    }
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < FLIES; i++) {
      const vis = clamp01(show - i);
      if (vis <= 0) continue;
      this.place(i, t, calm, grow, pose);
      // Face along the orbit; the wings flutter by squeezing the sprite sideways.
      g.local(this.fx, this.fy, this.fa, 1);
      ctx.scale((calm ? 1 : 0.7 + 0.3 * Math.abs(Math.sin(t * 38 + i))) * FLY_SCALE, FLY_SCALE);
      ctx.globalAlpha = vis * alpha;
      ctx.drawImage(fly.img, -fly.w / 2, -fly.h / 2, fly.w, fly.h);
    }
  }

  /** Pop-in over the first POP_TIME seconds of a fresh power; a small swell when an active one is refreshed. */
  private grow(pw: ActivePower): number {
    const elapsed = pw.total - pw.left;
    if (elapsed >= POP_TIME) return 1;
    if (this.swell[kindIdx(pw.kind)]) return 1 + 0.12 * Math.sin((elapsed / POP_TIME) * Math.PI);
    return Math.max(0.01, easeOutBack(clamp01(elapsed / POP_TIME)));
  }

  /** Where firefly `i` is on its lazy ellipse around the leaf (written to fx, fy, fa: no allocation). */
  private place(i: number, t: number, calm: boolean, grow: number, pose: LeafPose): void {
    const dir = i & 1 ? -1 : 1;
    const sp = (calm ? 0.35 : 1) * (0.75 + 0.14 * i) * dir;
    const a = t * sp + i * 1.62;
    const rx = (35 + 7 * Math.sin(t * 0.8 + i * 2.1)) * grow;
    const ry = (28 + 6 * Math.cos(t * 0.6 + i * 1.3)) * grow;
    this.fx = pose.x + Math.cos(a) * rx;
    this.fy = pose.y + Math.sin(a) * ry + (calm ? 0 : Math.sin(t * 2.3 + i) * 2);
    // The sprite's head points up (-y); turn it to the direction of travel.
    this.fa = Math.atan2(-Math.sin(a) * rx * dir, -Math.cos(a) * ry * dir);
  }
}
