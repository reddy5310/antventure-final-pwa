// Simulation bookkeeping that the rest of the game never needs to see (spawn
// timers, scratch buffers, the obstacle RNG stream). Kept beside the World in
// a WeakMap so the shared World contract stays small.

import { createRng, type Rng } from '../engine/rng';
import type { HitSource, World } from '../types';
import { createDifficulty, type Difficulty } from './difficulty';
import type { SteerCore } from './player';
import { FIRST_OBSTACLE_D, MAX_DROPS } from './tuning';

/** Candidate drops for a spawn, checked for fairness before they become real. */
export interface DropBatch {
  n: number;
  x: Float64Array;
  /** Landing y relative to the player's row. */
  dy: Float64Array;
  r: Float64Array;
  /** Extra seconds of telegraph beyond the batch's base fall (staggered patterns). */
  delay: Float64Array;
}

export interface SimState {
  /**
   * Obstacles are laid out by river distance, which on very tall screens is
   * reached earlier in time than on short ones; a separate stream (seeded from
   * the world seed) keeps world.rng's sequence identical on every screen.
   */
  obsRng: Rng;
  diff: Difficulty;
  steer: SteerCore;
  /** Spawn budgets: count down at the current rate, spawn at <= 0. */
  dropTimer: number;
  patternTimer: number;
  /** The last drawn pattern, kept for retries when it could not be placed fairly. */
  pattern: { u: Float64Array; retries: number; retryIn: number };
  /** River distance of the next obstacle to lay out. */
  nextObstacleD: number;
  stormLeft: number;
  /** Phases completed, for duration variety. */
  stormCount: number;
  bankContact: number;
  bumpCooldown: number;
  lastMilestone: number;
  deathScroll: number;
  /** world.time when the ant died (summaries report survival time). */
  deathTime: number;
  /** world.distance when the ant died: the river drifts on during the death animation, the run doesn't. */
  deathDistance: number;
  /** What took the last heart. */
  killedBy: HitSource | null;
  /** First-run tutorial: no drops until the player has learned to steer. */
  holdDrops: boolean;
  gameOverSent: boolean;
  autopilotT: number;
  batch: DropBatch;
  /** Hazards on the player's row for the fairness sweep: [t, x0, x1, ...]. */
  ev: Float64Array;
  evOrder: Int32Array;
  /** Reachable-set double buffer: [a0, b0, a1, b1, ...]. */
  setA: Float64Array;
  setB: Float64Array;
}

const states = new WeakMap<World, SimState>();

const MAX_BATCH = 24;
const MAX_EVENTS = MAX_DROPS + 24 + 160;
const MAX_SET = 64;

/** Mixes the world seed into an independent seed for the obstacle stream. */
function obstacleSeed(seed: number): number {
  let h = Math.imul((seed ^ 0x0b5ac1e5) >>> 0, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

function createSimState(world: World): SimState {
  return {
    obsRng: createRng(obstacleSeed(world.seed)),
    diff: createDifficulty(),
    steer: { x: world.player.x, targetX: world.player.targetX, hold: 0, sign: 0 },
    dropTimer: 0,
    patternTimer: 0,
    pattern: { u: new Float64Array(8), retries: 0, retryIn: 0 },
    nextObstacleD: FIRST_OBSTACLE_D,
    stormLeft: 0,
    stormCount: 0,
    bankContact: 0,
    bumpCooldown: 0,
    lastMilestone: 0,
    deathScroll: 0,
    deathTime: 0,
    deathDistance: 0,
    killedBy: null,
    holdDrops: false,
    gameOverSent: false,
    autopilotT: 0,
    batch: {
      n: 0,
      x: new Float64Array(MAX_BATCH),
      dy: new Float64Array(MAX_BATCH),
      r: new Float64Array(MAX_BATCH),
      delay: new Float64Array(MAX_BATCH),
    },
    ev: new Float64Array(MAX_EVENTS * 3),
    evOrder: new Int32Array(MAX_EVENTS),
    setA: new Float64Array(MAX_SET * 2),
    setB: new Float64Array(MAX_SET * 2),
  };
}

export function simState(world: World): SimState {
  let st = states.get(world);
  if (!st) {
    st = createSimState(world);
    states.set(world, st);
  }
  return st;
}

export function batchPush(b: DropBatch, x: number, dy: number, r: number, delay: number): void {
  if (b.n >= b.x.length) return;
  b.x[b.n] = x;
  b.dy[b.n] = dy;
  b.r[b.n] = r;
  b.delay[b.n] = delay;
  b.n++;
}
