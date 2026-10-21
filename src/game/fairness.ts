// Escapability check. Before any drop or pattern becomes real we ask: with
// everything already telegraphed plus this spawn, is there still a way
// through? "A way" is a trajectory of the leaf, starting where it is now,
// that only starts moving after a human reaction time and never moves faster
// than the keyboard (the slowest device) allows.
//
// We sweep forward in time through every known hazard on the player's row
// (drop impacts, and rocks/twigs sampled while they cross the row), keeping
// the set of x positions the leaf could be at. Between hazards the set grows
// by the distance the leaf can travel; each hazard cuts its interval out. If
// the set ever becomes empty, the spawn is refused.

import { ANT_HIT_R, LEAF_HIT_R } from '../config';
import type { Obstacle, World } from '../types';
import { reachIn } from './player';
import { riverEdgesInto, type RiverEdges } from './river';
import type { DropBatch, SimState } from './state';
import { BANK_MARGIN, HIT_PAD, KEY_SPEED, MIN_SAFE_WIDTH, REACH_SAFETY, REACTION } from './tuning';

const edges: RiverEdges = { left: 0, right: 0 };

/** Seconds before the leaf can respond to something new (reaction + steering lag). */
export const RESPONSE_LAG = REACTION + 0.08;
/** Sustained dodge speed assumed for a human on the keyboard (u/s). */
export const FAIR_SPEED = KEY_SPEED * REACH_SAFETY;
/** A moving leaf is assumed to carry on for up to this long before the player reacts (s). */
const CARRY_TIME = 0.15;
const CARRY_MIN_SPEED = 40;
/** Obstacles are sampled this often while crossing the row (s). */
const OBSTACLE_SAMPLE = 0.05;

/** Usable dodge distance within `t` seconds of seeing a telegraph. */
export function fairReach(t: number): number {
  return reachIn(t - REACTION) * REACH_SAFETY;
}

/** Half-width of the row a splash forbids, or 0 if it lands too far off the row. */
export function dropHalfWidth(dy: number, r: number): number {
  const R = r + ANT_HIT_R + HIT_PAD;
  if (dy <= -R || dy >= R) return 0;
  return Math.sqrt(R * R - dy * dy);
}

/** Vertical reach of an obstacle against the leaf circle. */
function obstacleRy(o: Obstacle): number {
  return o.kind === 'rock' ? o.r + LEAF_HIT_R : o.len + o.r + LEAF_HIT_R;
}

/** Horizontal half-width it blocks for the leaf centre at `t` seconds from now (conservative for twigs). */
function obstacleRx(o: Obstacle, t: number): number {
  const base = o.kind === 'rock' ? o.r + LEAF_HIT_R : o.len + o.r + LEAF_HIT_R + Math.abs(o.vx) * Math.max(0, t);
  return base + HIT_PAD;
}

// --- Event list ------------------------------------------------------------------
// st.ev holds (time, x0, x1) triples; st.evOrder sorts them by time.

function pushEvent(st: SimState, n: number, t: number, x0: number, x1: number): number {
  if (n < 0 || n >= st.evOrder.length) return -1;
  st.ev[3 * n] = t;
  st.ev[3 * n + 1] = x0;
  st.ev[3 * n + 2] = x1;
  return n + 1;
}

function collectEvents(world: World, st: SimState, batch: DropBatch, fall: number, tEnd: number): number {
  const p = world.player;
  const v = world.scrollSpeed;
  let n = 0;

  for (let i = 0; i < world.drops.length; i++) {
    const d = world.drops[i];
    const tau = d.fall - d.age;
    if (tau < 0 || tau > tEnd) continue;
    const h = dropHalfWidth(d.y + v * tau - p.y, d.r);
    if (h > 0) n = pushEvent(st, n, tau, d.x - h, d.x + h);
  }

  for (let i = 0; i < batch.n; i++) {
    const h = dropHalfWidth(batch.dy[i], batch.r[i]);
    if (h > 0) n = pushEvent(st, n, fall + batch.delay[i], batch.x[i] - h, batch.x[i] + h);
  }

  const vv = Math.max(1, v);
  for (let i = 0; i < world.obstacles.length; i++) {
    const o = world.obstacles[i];
    if (o.hit) continue;
    const ry = obstacleRy(o);
    const ta = Math.max(0, (p.y - ry - o.y) / vv);
    const tb = Math.min(tEnd, (p.y + ry - o.y) / vv);
    if (tb < ta) continue;
    const steps = Math.ceil((tb - ta) / OBSTACLE_SAMPLE);
    for (let k = 0; k <= steps; k++) {
      const t = steps === 0 ? ta : ta + ((tb - ta) * k) / steps;
      const rx = obstacleRx(o, t);
      n = pushEvent(st, n, t, o.x - rx, o.x + rx);
    }
  }
  return n;
}

function sortEvents(st: SimState, n: number): void {
  const ord = st.evOrder;
  const ev = st.ev;
  for (let i = 0; i < n; i++) ord[i] = i;
  for (let i = 1; i < n; i++) {
    const k = ord[i];
    const t = ev[3 * k];
    let j = i - 1;
    while (j >= 0 && ev[3 * ord[j]] > t) {
      ord[j + 1] = ord[j];
      j--;
    }
    ord[j + 1] = k;
  }
}

// --- Reachable set -----------------------------------------------------------------
// A sorted list of disjoint intervals, double-buffered in st.setA / st.setB.

/**
 * Moves every interval by `shift`, grows it by `grow` on both sides, clamps
 * to [lo, hi] and merges overlaps. Returns the new count.
 */
function advance(src: Float64Array, n: number, dst: Float64Array, shift: number, grow: number, lo: number, hi: number): number {
  let k = 0;
  for (let i = 0; i < n; i++) {
    let a = src[2 * i] + shift - grow;
    let b = src[2 * i + 1] + shift + grow;
    if (a < lo) a = lo;
    if (b > hi) b = hi;
    if (b < a) continue;
    if (k > 0 && a <= dst[2 * k - 1]) {
      if (b > dst[2 * k - 1]) dst[2 * k - 1] = b;
    } else {
      dst[2 * k] = a;
      dst[2 * k + 1] = b;
      k++;
    }
  }
  return k;
}

/** Removes [f0, f1]; pieces left too narrow to stand in are dropped. Returns the new count. */
function cut(src: Float64Array, n: number, dst: Float64Array, f0: number, f1: number): number {
  let k = 0;
  const cap = dst.length >> 1;
  for (let i = 0; i < n; i++) {
    const a = src[2 * i];
    const b = src[2 * i + 1];
    if (b <= f0 || a >= f1) {
      if (k >= cap) return k;
      dst[2 * k] = a;
      dst[2 * k + 1] = b;
      k++;
      continue;
    }
    if (f0 - a >= MIN_SAFE_WIDTH && k < cap) {
      dst[2 * k] = a;
      dst[2 * k + 1] = f0;
      k++;
    }
    if (b - f1 >= MIN_SAFE_WIDTH && k < cap) {
      dst[2 * k] = f1;
      dst[2 * k + 1] = b;
      k++;
    }
  }
  return k;
}

/**
 * Sweeps the sorted events from x0. Until the player reacts, the leaf keeps
 * its current motion (`carryV`, for at most CARRY_TIME); afterwards it can
 * go anywhere at FAIR_SPEED. Returns false if no position survives.
 */
function sweep(world: World, st: SimState, n: number, x0: number, carryV: number): boolean {
  let cur = st.setA;
  let tmp = st.setB;
  cur[0] = x0;
  cur[1] = x0;
  let count = 1;
  let tPrev = 0;
  const ev = st.ev;
  const ord = st.evOrder;
  const baseD = world.distance;
  const v = world.scrollSpeed;

  for (let i = 0; i < n; i++) {
    const k = ord[i];
    const t = ev[3 * k];
    const grow = FAIR_SPEED * (Math.max(t, RESPONSE_LAG) - Math.max(tPrev, RESPONSE_LAG));
    const shift = carryV * (Math.min(t, CARRY_TIME) - Math.min(tPrev, CARRY_TIME));
    if (grow > 0 || shift !== 0 || i === 0) {
      riverEdgesInto(world.seed, baseD + v * t, edges);
      count = advance(cur, count, tmp, shift, grow, edges.left + BANK_MARGIN, edges.right - BANK_MARGIN);
      const swap = cur;
      cur = tmp;
      tmp = swap;
    }
    count = cut(cur, count, tmp, ev[3 * k + 1], ev[3 * k + 2]);
    const swap = cur;
    cur = tmp;
    tmp = swap;
    if (count === 0) return false;
    tPrev = t;
  }
  return true;
}

/**
 * Can the ant (now at x0) survive everything currently telegraphed plus
 * `batch`, landing `fall` seconds from now (plus each drop's delay)? A leaf
 * in motion must be able to escape both if the player stops and if they
 * finish the move they were making.
 */
export function batchIsEscapable(world: World, st: SimState, batch: DropBatch, fall: number, x0: number): boolean {
  let maxDelay = 0;
  for (let i = 0; i < batch.n; i++) if (batch.delay[i] > maxDelay) maxDelay = batch.delay[i];
  const tEnd = fall + maxDelay;
  const n = collectEvents(world, st, batch, fall, tEnd);
  if (n < 0) return false;
  sortEvents(st, n);
  if (!sweep(world, st, n, x0, 0)) return false;
  const vx = world.player.vx;
  return Math.abs(vx) < CARRY_MIN_SPEED || sweep(world, st, n, x0, vx);
}
