// STUB — the zones render agent replaces the bodies. Keep the exported signatures.
// Night River darkness: everything but a pool of light around the leaf goes
// dark. Drawn above the leaf/ant and BELOW drop telegraphs, so telegraphs are
// always visible (a fairness rule).

import type { World } from '../types';
import type { Gfx } from './gfx';

export class NightArt {
  build(ppu: number): void {
    void ppu;
  }

  draw(g: Gfx, world: World): void {
    void g;
    void world;
  }
}
