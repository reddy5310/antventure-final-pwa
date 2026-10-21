// The player's leaf: a broad heart-shaped leaf seen from above (tip forward,
// monstera-style splits), its soft shadow, bow foam, the V wake trailing down
// the screen, the combo aura, and the spin-and-sink death.

import { LEAF_H, LEAF_W } from '../config';
import { DEATH_DURATION } from '../game/tuning';
import type { World } from '../types';
import { makeSprite, type Gfx, type Sprite } from './gfx';
import { P } from './palette';
import { TAU, clamp01 } from './util';

/** Seconds the leaf takes to sink after death (tied to the sim's death length). */
const SINK_TIME = DEATH_DURATION * 0.95;

const WAKE_N = 48;
const WAKE_EVERY = 1 / 40;
const WAKE_LIFE = 0.75;

/** Where the leaf was drawn this frame; the ant rides on it. */
export interface LeafPose {
  x: number;
  y: number;
  rot: number;
  scale: number;
  alpha: number;
  /** 0..1 sink progress while dying. */
  sink: number;
}

function leafShape(c: CanvasRenderingContext2D): void {
  const hw = LEAF_W / 2;
  const hh = LEAF_H / 2;
  c.beginPath();
  c.moveTo(0, -hh);
  c.bezierCurveTo(hw * 0.27, -hh * 0.88, hw * 0.96, -hh * 0.56, hw * 0.99, hh * 0.08);
  c.bezierCurveTo(hw * 1.01, hh * 0.6, hw * 0.77, hh * 0.96, hw * 0.46, hh * 0.98);
  c.bezierCurveTo(hw * 0.23, hh * 1.0, hw * 0.08, hh * 0.8, 0, hh * 0.56);
  c.bezierCurveTo(-hw * 0.08, hh * 0.8, -hw * 0.23, hh * 1.0, -hw * 0.46, hh * 0.98);
  c.bezierCurveTo(-hw * 0.77, hh * 0.96, -hw * 1.01, hh * 0.6, -hw * 0.99, hh * 0.08);
  c.bezierCurveTo(-hw * 0.96, -hh * 0.56, -hw * 0.27, -hh * 0.88, 0, -hh);
  c.closePath();
}

function buildLeaf(ppu: number): Sprite {
  const hw = LEAF_W / 2;
  const hh = LEAF_H / 2;
  return makeSprite(LEAF_W + 8, LEAF_H + 30, ppu, (c) => {
    // Stem first, so the blade covers its base.
    c.strokeStyle = P.leafEdge;
    c.lineWidth = 4.6;
    c.beginPath();
    c.moveTo(0, hh * 0.5);
    c.quadraticCurveTo(1, hh + 4, 3.5, hh + 12);
    c.stroke();
    c.strokeStyle = P.stem;
    c.lineWidth = 2.8;
    c.stroke();

    c.fillStyle = P.leaf;
    leafShape(c);
    c.fill();
    // Lit (left) half and a soft inner glow toward the tip.
    c.save();
    leafShape(c);
    c.clip();
    c.fillStyle = P.leafLight;
    c.globalAlpha = 0.7;
    c.fillRect(-hw - 2, -hh - 2, hw + 2, LEAF_H + 4);
    c.globalAlpha = 1;
    c.fillStyle = P.leafDark;
    c.globalAlpha = 0.45;
    c.beginPath();
    c.ellipse(hw * 0.7, hh * 0.55, hw * 0.55, hh * 0.6, -0.4, 0, TAU);
    c.fill();
    c.globalAlpha = 1;
    c.restore();

    // Veins.
    c.strokeStyle = P.leafVein;
    c.lineCap = 'round';
    c.globalAlpha = 0.85;
    c.lineWidth = 2.1;
    c.beginPath();
    c.moveTo(0, hh * 0.55);
    c.quadraticCurveTo(0.6, 0, 0, -hh * 0.92);
    c.stroke();
    c.lineWidth = 1.05;
    c.globalAlpha = 0.6;
    c.beginPath();
    const ribs = [0.36, 0.02, -0.32, -0.6];
    for (const ry of ribs) {
      const y = ry * hh;
      for (const s of [-1, 1]) {
        c.moveTo(0, y);
        c.quadraticCurveTo(s * hw * 0.45, y - hh * 0.05, s * hw * 0.84, y - hh * 0.36);
      }
    }
    for (const s of [-1, 1]) {
      c.moveTo(0, hh * 0.52);
      c.quadraticCurveTo(s * hw * 0.3, hh * 0.62, s * hw * 0.62, hh * 0.78);
    }
    c.stroke();
    c.globalAlpha = 1;

    // Monstera splits between the ribs, cut clean through to the water.
    c.globalCompositeOperation = 'destination-out';
    const splits: [number, number, number][] = [
      [1, 0.2, 0.12],
      [1, -0.18, 0.1],
      [-1, 0.16, 0.12],
      [-1, -0.46, 0.1],
    ];
    for (const [s, ry, w] of splits) {
      const y = ry * hh;
      c.beginPath();
      c.moveTo(s * hw * 1.06, y - hh * 0.3);
      c.lineTo(s * hw * 0.62, y - hh * 0.12);
      c.lineTo(s * hw * 1.06, y - hh * (0.3 - w * 2));
      c.closePath();
      c.fill();
    }
    c.globalCompositeOperation = 'source-over';

    // Edge.
    c.strokeStyle = P.leafEdge;
    c.lineWidth = 1.5;
    leafShape(c);
    c.stroke();

    // A few beads of rain resting on the blade.
    const beads: [number, number, number][] = [
      [-hw * 0.55, -hh * 0.1, 1.6],
      [hw * 0.5, hh * 0.3, 1.3],
      [-hw * 0.2, hh * 0.68, 1.1],
      [hw * 0.18, -hh * 0.55, 1.2],
    ];
    for (const [x, y, r] of beads) {
      c.fillStyle = 'rgba(20, 70, 30, 0.35)';
      c.beginPath();
      c.arc(x + 0.4, y + 0.5, r, 0, TAU);
      c.fill();
      c.fillStyle = 'rgba(225, 250, 255, 0.75)';
      c.beginPath();
      c.arc(x, y, r, 0, TAU);
      c.fill();
      c.fillStyle = '#ffffff';
      c.beginPath();
      c.arc(x - r * 0.35, y - r * 0.35, r * 0.35, 0, TAU);
      c.fill();
    }
  });
}

function buildShadow(ppu: number): Sprite {
  const w = LEAF_W + 30;
  const h = LEAF_H + 30;
  return makeSprite(w, h, Math.min(ppu, 1.5), (c) => {
    // Only the blurred shadow lands on the canvas: the shape itself is drawn far off to the side.
    const scale = c.getTransform().a;
    c.shadowColor = 'rgba(2, 18, 26, 0.55)';
    c.shadowBlur = 6 * scale;
    c.shadowOffsetX = 1000 * scale;
    c.translate(-1000, 0);
    c.fillStyle = '#000';
    leafShape(c);
    c.fill();
  });
}

function buildGlow(ppu: number, color: string): Sprite {
  return makeSprite(130, 130, Math.min(ppu, 1.2), (c) => {
    const g = c.createRadialGradient(0, 0, 0, 0, 0, 65);
    g.addColorStop(0, color);
    g.addColorStop(0.45, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.globalAlpha = 0.55;
    c.fillStyle = g;
    c.beginPath();
    c.arc(0, 0, 65, 0, TAU);
    c.fill();
  });
}

export class LeafArt {
  private leaf: Sprite | null = null;
  private shadow: Sprite | null = null;
  private auras: Sprite[] = [];

  private wx = new Float32Array(WAKE_N);
  private wd = new Float64Array(WAKE_N);
  private wa = new Float32Array(WAKE_N);
  private head = 0;
  private count = 0;
  private acc = 0;

  readonly pose: LeafPose = { x: 0, y: 0, rot: 0, scale: 1, alpha: 1, sink: 0 };

  build(ppu: number): void {
    this.leaf = buildLeaf(ppu);
    this.shadow = buildShadow(ppu);
    this.auras = [buildGlow(ppu, 'rgba(255, 241, 166, 0.9)'), buildGlow(ppu, 'rgba(255, 209, 102, 0.9)'), buildGlow(ppu, 'rgba(255, 173, 92, 0.9)'), buildGlow(ppu, 'rgba(255, 134, 194, 0.9)')];
  }

  reset(): void {
    this.count = 0;
    this.head = 0;
    this.acc = 0;
  }

  /** Records wake samples; call once per frame before drawing. */
  update(g: Gfx, world: World): void {
    for (let i = 0; i < WAKE_N; i++) this.wa[i] += g.edt;
    const p = world.player;
    const floating = world.state === 'running' || world.state === 'attract';
    this.acc += g.edt;
    if (floating && this.acc >= WAKE_EVERY) {
      this.acc = 0;
      this.head = (this.head + 1) % WAKE_N;
      this.wx[this.head] = p.x;
      // Start the wake just behind the stern.
      this.wd[this.head] = world.distance - LEAF_H * 0.36;
      this.wa[this.head] = 0;
      this.count = Math.min(WAKE_N, this.count + 1);
    }
  }

  drawWake(g: Gfx): void {
    if (this.count < 2) return;
    const { ctx } = g;
    g.world();
    ctx.lineCap = 'round';
    ctx.strokeStyle = P.foam;
    // Three alpha buckets: one stroke each for both arms.
    for (let b = 0; b < 3; b++) {
      ctx.lineWidth = 2.6 - b * 0.5;
      ctx.globalAlpha = 0.42 - b * 0.13;
      ctx.beginPath();
      for (let n = 0; n < this.count - 1; n++) {
        const i = (this.head - n + WAKE_N) % WAKE_N;
        const j = (i - 1 + WAKE_N) % WAKE_N;
        const a0 = this.wa[i];
        if (a0 > WAKE_LIFE) break;
        const life = a0 / WAKE_LIFE;
        const bucket = life < 0.33 ? 0 : life < 0.66 ? 1 : 2;
        if (bucket !== b) continue;
        const a1 = this.wa[j];
        const y0 = g.yOfD(this.wd[i]);
        const y1 = g.yOfD(this.wd[j]);
        // Arms spread with age and ripple slightly, like water rather than string.
        const w0 = Math.sin(this.wd[i] * 0.09 + g.t * 4) * a0 * 5;
        const w1 = Math.sin(this.wd[j] * 0.09 + g.t * 4) * a1 * 5;
        const s0 = 15 + a0 * 56 + w0;
        const s1 = 15 + a1 * 56 + w1;
        ctx.moveTo(this.wx[i] - s0, y0);
        ctx.lineTo(this.wx[j] - s1, y1);
        ctx.moveTo(this.wx[i] + s0, y0);
        ctx.lineTo(this.wx[j] + s1, y1);
      }
      ctx.stroke();
    }
    // Churned water straight behind the stem.
    ctx.fillStyle = P.foam;
    ctx.beginPath();
    let drawn = 0;
    for (let n = 1; n < this.count && drawn < 10; n += 2) {
      const i = (this.head - n + WAKE_N) % WAKE_N;
      const a = this.wa[i];
      if (a > WAKE_LIFE * 0.7) break;
      const y = g.yOfD(this.wd[i]) + 6;
      const x = this.wx[i] + Math.sin(i * 2.3 + g.t * 3) * 3;
      const r = 1.6 - a * 1.2;
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, TAU);
      drawn++;
    }
    ctx.globalAlpha = 0.4;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  /** Draws the leaf and fills `pose` so the ant can ride it. */
  draw(g: Gfx, world: World): LeafPose {
    const p = world.player;
    const pose = this.pose;
    const dying = world.state === 'dying' || world.state === 'over';
    // Fully sunk just before the game-over screen arrives.
    const sink = dying ? (world.state === 'over' ? 1 : clamp01(world.deathTimer / SINK_TIME)) : 0;
    const bob = g.reduced ? 0 : Math.sin(g.t * 2.6) * 0.9;
    let x = p.x;
    if (p.hurt > 0 && !g.reduced) x += Math.sin(g.t * 70) * Math.min(1, p.hurt * 3) * 2.6;
    pose.x = x;
    pose.y = p.y + bob;
    pose.rot = p.tilt + (g.reduced ? 0 : Math.sin(g.t * 1.7) * 0.025) + sink * sink * 7;
    pose.scale = (1 + (g.reduced ? 0 : Math.sin(g.t * 2.6 + 1) * 0.012)) * (1 - 0.42 * sink);
    pose.alpha = 1 - sink * sink;
    pose.sink = sink;
    if (pose.alpha <= 0.01 || !this.leaf || !this.shadow) return pose;

    const { ctx } = g;
    // Combo aura: warm glow under the leaf that grows hotter with the combo.
    if (!dying && world.combo >= 2) {
      const tier = world.combo >= 20 ? 3 : world.combo >= 12 ? 2 : world.combo >= 6 ? 1 : 0;
      ctx.globalAlpha = (0.5 + 0.15 * Math.sin(g.t * 6)) * Math.min(1, world.comboTimer * 2 + 0.3);
      g.sprite(this.auras[tier], pose.x, pose.y, 0, 0.85 + tier * 0.08);
    }

    ctx.globalAlpha = 0.85 * pose.alpha;
    g.sprite(this.shadow, pose.x + 3.5, pose.y + 6, pose.rot, pose.scale);
    ctx.globalAlpha = pose.alpha;

    // Bow foam where the tip pushes water.
    if (!dying) {
      g.local(pose.x, pose.y, pose.rot, pose.scale);
      ctx.strokeStyle = P.foam;
      ctx.lineCap = 'round';
      ctx.lineWidth = 2.2;
      ctx.globalAlpha = 0.5 + Math.sin(g.t * 7) * 0.12;
      ctx.beginPath();
      ctx.arc(0, 5, LEAF_H / 2 + 6 + Math.sin(g.t * 5) * 0.8, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5);
      ctx.stroke();
      ctx.lineWidth = 1.4;
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.arc(0, 8, LEAF_H / 2 + 12, -Math.PI / 2 - 0.35, -Math.PI / 2 + 0.35);
      ctx.stroke();
      ctx.globalAlpha = pose.alpha;
    }
    g.sprite(this.leaf, pose.x, pose.y, pose.rot, pose.scale);
    ctx.globalAlpha = 1;
    return pose;
  }
}
