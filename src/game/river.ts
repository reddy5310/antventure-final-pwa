// River shape, shared by gameplay (bank collisions, spawn bounds) and the
// renderer (banks, foam). A pure function of (seed, river distance), so the
// same seed always produces the same river.

import { RIVER_NARROW_DIST, WORLD_W } from '../config';
import { noise1 } from '../engine/rng';
import { createZoneMods, zoneModsAt } from './zones';
import type { World } from '../types';

export interface RiverEdges {
  left: number;
  right: number;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const widthMods = createZoneMods();

/** Water edges at river distance `d` (units downstream from the start). */
export function riverEdgesAt(seed: number, d: number): RiverEdges {
  return riverEdgesInto(seed, d, { left: 0, right: 0 });
}

/** Allocation-free riverEdgesAt for hot loops: writes into and returns `out`. */
export function riverEdgesInto(seed: number, d: number, out: RiverEdges): RiverEdges {
  const p = clamp(d / RIVER_NARROW_DIST, 0, 1);
  const ease = p * p * (3 - 2 * p);
  // Lily Marsh widens the river, Rapids narrows it (blended across zone
  // transitions). The bank clamps below keep it continuous and inside the view:
  // the Marsh gets as wide as the view allows (a bank may rest against the
  // 6-unit margin for a while, so early on it is about +9 % rather than +15 %),
  // and the narrowest Rapids stay above 175 units, so a leaf and a lane fit.
  const zoneWidth = zoneModsAt(seed, d, widthMods).width;
  const halfWidth = (lerp(178, 128, ease) + noise1(seed ^ 0x51ed, d * 0.0021) * lerp(8, 22, ease)) * zoneWidth;
  const sway = noise1(seed ^ 0xa11ce, d * 0.0011) * lerp(6, 46, ease);
  const centre = WORLD_W / 2 + sway;
  out.left = clamp(centre - halfWidth, 6, WORLD_W / 2 - 80);
  out.right = clamp(centre + halfWidth, WORLD_W / 2 + 80, WORLD_W - 6);
  return out;
}

/** River distance at view-space y (things higher up are further downstream-to-come). */
export function riverDistanceAtY(world: World, y: number): number {
  return world.distance + (world.player.y - y);
}

export function riverEdgesAtY(world: World, y: number): RiverEdges {
  return riverEdgesAt(world.seed, riverDistanceAtY(world, y));
}
