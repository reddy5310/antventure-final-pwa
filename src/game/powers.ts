// STUB — the pickups agent replaces the bodies. Keep the exported signatures.
// Timed power-up effects (mushroom shield, honey magnet, firefly) and the
// instant ladybug heal.

import type { HitSource, PickupKind, World } from '../types';

/** Applies a collected power-up pickup (starts/refreshes a timer or heals). */
export function activatePower(world: World, kind: Exclude<PickupKind, 'crumb'>): void {
  void world;
  void kind;
}

/** Ticks power timers and emits 'power-end'. Call every running step. */
export function updatePowers(world: World, dt: number): void {
  void world;
  void dt;
}

/** Multiplier for the near-miss band (firefly makes chains easier). */
export function nearBandScale(world: World): number {
  void world;
  return 1;
}

/**
 * Called by damage before a hit lands. Returns true if the mushroom cap
 * absorbed it (no heart lost, combo kept).
 */
export function absorbHit(world: World, x: number, y: number, source: HitSource): boolean {
  void world;
  void x;
  void y;
  void source;
  return false;
}
