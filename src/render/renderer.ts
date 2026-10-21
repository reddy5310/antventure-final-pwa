// STUB — the render agent replaces the bodies. Keep the exported signatures.

import { ANT_HIT_R, LEAF_H, LEAF_W, WORLD_W } from '../config';
import type { Viewport } from '../engine/viewport';
import { riverEdgesAtY } from '../game/river';
import type { GameEvent, Settings, World } from '../types';

export class Renderer {
  private ctx: CanvasRenderingContext2D;

  constructor(
    private canvas: HTMLCanvasElement,
    private viewport: Viewport,
    private getSettings: () => Settings,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D not supported');
    this.ctx = ctx;
  }

  /** Viewport changed (size / dpr). */
  resize(): void {}

  /** Spawn transient effects (splashes, floating text, shake…) for a game event. */
  onEvent(_e: GameEvent, _world: World): void {
    void this.getSettings;
  }

  /** Clear transient effects (new run / back to menu). */
  reset(): void {}

  render(world: World, _frameDt: number): void {
    const { ctx, viewport: v } = this;
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    ctx.fillStyle = '#123';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(v.dpr * v.scale, 0, 0, v.dpr * v.scale, v.dpr * v.originX, 0);
    for (let y = 0; y < world.viewH; y += 20) {
      const e = riverEdgesAtY(world, y);
      ctx.fillStyle = '#2b7bb9';
      ctx.fillRect(e.left, y, e.right - e.left, 21);
    }
    ctx.strokeStyle = '#fff3';
    ctx.strokeRect(0, 0, WORLD_W, world.viewH);
    for (const d of world.drops) {
      ctx.fillStyle = '#0006';
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r * (d.age / d.fall), 0, Math.PI * 2);
      ctx.fill();
    }
    const p = world.player;
    ctx.fillStyle = '#5c5';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, LEAF_W / 2, LEAF_H / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#a40';
    ctx.beginPath();
    ctx.arc(p.x, p.y, ANT_HIT_R, 0, Math.PI * 2);
    ctx.fill();
  }
}
