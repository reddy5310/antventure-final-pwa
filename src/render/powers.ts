// STUB — the pickups render agent replaces the bodies. Keep the exported signatures.
// Active power-up visuals on the leaf/ant: mushroom cap, honey aura, firefly glow.

import type { World } from '../types';
import type { Gfx } from './gfx';
import type { LeafPose } from './leaf';

export class PowerArt {
  build(ppu: number): void {
    void ppu;
  }

  /** Drawn right after the ant, in leaf space via `pose`. */
  draw(g: Gfx, world: World, pose: LeafPose): void {
    void g;
    void world;
    void pose;
  }
}
