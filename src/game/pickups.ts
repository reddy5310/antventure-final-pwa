// STUB — the pickups agent replaces the bodies. Keep the exported signatures.
// Crumb trails and power-up pickups: laid out by river distance from their
// own seeded stream (never world.rng), collected by the leaf.

import type { World } from '../types';

/** Lays out crumb trails and power-ups that have come within lookahead (live runs only). Call after layoutObstacles. */
export function layoutPickups(world: World): void {
  void world;
}

/**
 * Moves pickups with the river, applies the honey magnet, collects what the
 * leaf touches (`live` only) and removes what has left the view.
 */
export function updatePickups(world: World, dt: number, live: boolean): void {
  void world;
  void dt;
  void live;
}
