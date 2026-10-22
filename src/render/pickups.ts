// STUB — the pickups render agent replaces the bodies. Keep the exported signatures.
// Crumbs and power-up pickups on the water, plus their glow above the night overlay.

import type { World } from '../types';
import type { Gfx } from './gfx';

export class PickupArt {
  /** (Re)build sprites at the device scale (called from Renderer.resize). */
  build(ppu: number): void {
    void ppu;
  }

  /** Pickups on the water (below the leaf). */
  draw(g: Gfx, world: World): void {
    const { ctx } = g;
    g.world();
    for (const k of world.pickups) {
      if (k.taken) continue;
      ctx.fillStyle = k.kind === 'crumb' ? '#f3e2b3' : '#ff7a59';
      ctx.beginPath();
      ctx.arc(k.x, k.y, k.kind === 'crumb' ? 4 : 9, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Glow pass drawn above the night overlay so pickups stay findable in the dark. */
  drawGlow(g: Gfx, world: World): void {
    void g;
    void world;
  }
}
