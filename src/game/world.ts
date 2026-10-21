// STUB — the gameplay agent replaces the bodies. Keep the exported signatures.

import { MAX_HEARTS, PLAYER_FROM_BOTTOM, UNITS_PER_METER, WORLD_W } from '../config';
import { createRng } from '../engine/rng';
import type { InputFrame, Mode, RunSummary, World } from '../types';

export interface CreateWorldOptions {
  mode: Mode;
  seed: number;
  dailyId: string | null;
  /** Personal best distance in world units (0 if none) — drawn as a flag. */
  bestDistance: number;
  viewH: number;
  /** Menu backdrop: river scrolls, no hazards, no damage. */
  attract?: boolean;
}

export function createWorld(opts: CreateWorldOptions): World {
  const y = opts.viewH - PLAYER_FROM_BOTTOM;
  return {
    mode: opts.mode,
    seed: opts.seed,
    dailyId: opts.dailyId,
    rng: createRng(opts.seed),
    state: opts.attract ? 'attract' : 'running',
    time: 0,
    distance: 0,
    scrollSpeed: 90,
    viewH: opts.viewH,
    player: { x: WORLD_W / 2, y, targetX: WORLD_W / 2, vx: 0, hearts: MAX_HEARTS, invuln: 0, hurt: 0, wet: 0, tilt: 0 },
    drops: [],
    obstacles: [],
    score: 0,
    combo: 0,
    comboTimer: 0,
    multiplier: 1,
    maxCombo: 0,
    nearMisses: 0,
    hitsTaken: 0,
    storm: 'calm',
    intensity: 0,
    bestDistance: opts.bestDistance,
    passedBest: false,
    deathTimer: 0,
    nextId: 1,
    events: opts.attract ? [] : [{ type: 'start' }],
  };
}

/** Advance the world by dt seconds. Appends to world.events (main drains them). */
export function stepWorld(world: World, input: InputFrame, dt: number): void {
  world.time += dt;
  world.distance += world.scrollSpeed * dt;
  const p = world.player;
  if (input.absoluteX !== null) p.targetX = input.absoluteX;
  p.targetX += input.steerDelta + input.axis * 260 * dt;
  p.targetX = Math.min(WORLD_W - 40, Math.max(40, p.targetX));
  const prev = p.x;
  p.x += (p.targetX - p.x) * (1 - Math.exp(-16 * dt));
  p.vx = (p.x - prev) / dt;
}

/** The view height changed (resize). Re-anchor the player. */
export function setViewHeight(world: World, viewH: number): void {
  const dy = viewH - PLAYER_FROM_BOTTOM - world.player.y;
  world.viewH = viewH;
  world.player.y += dy;
  for (const d of world.drops) d.y += dy;
  for (const o of world.obstacles) o.y += dy;
}

export function summarize(world: World): RunSummary {
  return {
    mode: world.mode,
    dailyId: world.dailyId,
    seed: world.seed,
    score: Math.floor(world.score),
    distanceM: Math.floor(world.distance / UNITS_PER_METER),
    timeS: world.time,
    nearMisses: world.nearMisses,
    maxCombo: world.maxCombo,
    hitsTaken: world.hitsTaken,
  };
}
