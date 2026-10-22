// Raindrops: telegraphed splashes that land on the player's row.
//
// Every drop is defined by where and when it lands. It spawns above its
// landing point and scrolls down with the river while its shadow grows, so
// the telegraph slides onto the row the leaf rides on. Because the leaf only
// moves sideways, what matters is which stretches of that row are splashed at
// each moment, and every spawn is checked (fairness.ts) to leave a reachable
// gap.
//
// Determinism: each spawn event draws a fixed number of values from
// world.rng whatever branch it takes, so the Daily River's sequence of
// timings and random positions is identical for everyone. Aimed drops and
// pattern placement may use the player's position, never extra RNG.

import { ANT_HIT_R } from '../config';
import type { World } from '../types';
import { applyHit } from './damage';
import { PHASE_MODS } from './difficulty';
import { batchIsEscapable, fairReach } from './fairness';
import { insideLeaf } from './collision';
import { riverEdgesInto, type RiverEdges } from './river';
import { registerNearMiss } from './scoring';
import { batchPush, type DropBatch, type SimState } from './state';
import {
  AIM_LEAD,
  AIM_LEAD_MAX,
  AIM_SPREAD,
  BANK_MARGIN,
  DROP_R_MAX,
  DROP_R_MIN,
  MAX_DROPS,
  NEAR_BAND,
  PATTERN_EXTRA_FALL,
  PATTERN_MAX_FALL,
  WET_PER_SPLASH,
} from './tuning';

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const frac = (v: number) => v - Math.floor(v);
/** Golden-ratio step: successive candidates spread evenly over [0, 1). */
const PHI = 0.6180339887498949;

/** Integer hash → [0, 1). Gives patterns many stable sub-values from one RNG draw. */
function hashUnit(u: number, i: number): number {
  let h = (Math.floor(u * 4294967296) ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const edges: RiverEdges = { left: 0, right: 0 };

/**
 * Water edges where a drop landing `dy` off the player's row, `fall` seconds
 * from now, will hit the river. The drop scrolls with the river, so that spot
 * is fixed in river distance.
 */
function edgesAtLanding(world: World, fall: number, dy = 0): RiverEdges {
  return riverEdgesInto(world.seed, world.distance + world.scrollSpeed * fall - dy, edges);
}

/** Keeps a landing point on the water. */
function onWater(world: World, x: number, dy: number, fall: number): number {
  const e = edgesAtLanding(world, fall, dy);
  return clamp(x, e.left + 2, e.right - 2);
}

function commitBatch(world: World, batch: DropBatch, fall: number, aimed: boolean): void {
  const p = world.player;
  const v = world.scrollSpeed;
  for (let i = 0; i < batch.n; i++) {
    const f = fall + batch.delay[i];
    world.drops.push({
      id: world.nextId++,
      x: batch.x[i],
      // Starts upstream so that, scrolling with the river, it lands on the row.
      y: p.y + batch.dy[i] - v * f,
      age: 0,
      fall: f,
      r: batch.r[i],
      aimed,
    });
  }
}

// --- Singles ---------------------------------------------------------------------

function spawnSingle(world: World, st: SimState): void {
  const rng = world.rng;
  const uKind = rng.next();
  const uX = rng.next();
  const uDy = rng.next();
  const uR = rng.next();
  const uFall = rng.next();
  const uGap = rng.next();
  // Jittered spacing keeps the rain from feeling metronomic.
  st.dropTimer += 0.55 + 0.9 * uGap;

  if (world.drops.length >= MAX_DROPS) return;
  const diff = st.diff;
  const mods = PHASE_MODS[world.storm];
  const p = world.player;
  const fall = diff.fall * (0.94 + 0.12 * uFall);
  const r = lerp(DROP_R_MIN, DROP_R_MAX, uR);
  const aimed = uKind < diff.aimedShare + mods.aimed;

  let x: number;
  let dy: number;
  if (aimed) {
    const lead = clamp(p.vx * AIM_LEAD * Math.min(diff.level, 1), -AIM_LEAD_MAX, AIM_LEAD_MAX);
    x = p.x + lead + (2 * uX - 1) * AIM_SPREAD;
    dy = (2 * uDy - 1) * 6;
  } else {
    // Mostly on the row, some just off it: grazing splashes for near-misses.
    dy = lerp(-38, 26, uDy);
    const e = edgesAtLanding(world, fall, dy);
    x = lerp(e.left + 8, e.right - 8, uX);
  }
  x = onWater(world, x, dy, fall);

  const b = st.batch;
  b.n = 0;
  batchPush(b, x, dy, r, 0);
  if (batchIsEscapable(world, st, b, fall, p.x)) commitBatch(world, b, fall, aimed);
}

// --- Patterns ----------------------------------------------------------------------

type PatternKind = 'wall' | 'cage' | 'cluster';

/** Values drawn per pattern, whatever kind it turns out to be (the last one times the next pattern). */
const PATTERN_DRAWS = 8;
/** A pattern with no fair placement is retried this often (s)... */
const PATTERN_RETRY = 0.5;
/** ...this many times before it is dropped. */
const PATTERN_RETRIES = 3;
/** Share of an interval that passes before the first pattern once unlocked. */
const PATTERN_LEAD_IN = 0.35;

function pickPattern(level: number, u: number): PatternKind {
  const wCluster = 1;
  const wCage = level >= 0.15 ? 1 : 0;
  const wWall = level >= 0.3 ? 1.2 : 0;
  const t = u * (wCluster + wCage + wWall);
  if (t < wCluster) return 'cluster';
  if (t < wCluster + wCage) return 'cage';
  return 'wall';
}

/**
 * A full-width row of splashes with one gap. The gap is placed within the
 * keyboard's fair reach of the leaf; threading it grazes both neighbours.
 */
function buildWall(world: World, st: SimState, fall: number, u1: number, uR: number): boolean {
  const p = world.player;
  const b = st.batch;
  const r = 17 + 2 * uR;
  const R = r + ANT_HIT_R;
  /** Half-width of the safe zone inside the gap (leaf centre). */
  const safeHalf = 14;
  const gapHalf = R + safeHalf;
  // Adjacent splashes overlap on the row, so only the gap is passable.
  const spacing = 2 * R - 8;
  const e = edgesAtLanding(world, fall);
  const lo = e.left + BANK_MARGIN;
  const hi = e.right - BANK_MARGIN;
  const waterLo = e.left + 2;
  const waterHi = e.right - 2;
  // The gap may need a dash, but never the full theoretical reach.
  const maxOff = Math.max(0, fairReach(fall) * WALL_REACH_SHARE + safeHalf - 6);

  for (let k = 0; k < 4; k++) {
    const off = k === 3 ? 0 : (2 * frac(u1 + k * PHI) - 1) * maxOff;
    const gx = clamp(p.x + off, lo, hi);
    b.n = 0;
    for (let x = gx - gapHalf; x + R > lo; x -= spacing) {
      const xx = Math.max(x, waterLo);
      batchPush(b, xx, 0, r, 0);
      if (xx - R <= lo) break;
    }
    for (let x = gx + gapHalf; x - R < hi; x += spacing) {
      const xx = Math.min(x, waterHi);
      batchPush(b, xx, 0, r, 0);
      if (xx + R >= hi) break;
    }
    if (world.drops.length + b.n <= MAX_DROPS && batchIsEscapable(world, st, b, fall, p.x)) {
      commitBatch(world, b, fall, true);
      return true;
    }
  }
  return false;
}

/** Share of the fair reach a wall's gap may be away from the leaf. */
const WALL_REACH_SHARE = 0.6;

/** Unit vectors for the eight cage slots, 45° apart, starting at "right". */
const SLOT_COS = [1, Math.SQRT1_2, 0, -Math.SQRT1_2, -1, -Math.SQRT1_2, 0, Math.SQRT1_2];
const SLOT_SIN = [0, Math.SQRT1_2, 1, Math.SQRT1_2, 0, -Math.SQRT1_2, -1, -Math.SQRT1_2];

/**
 * A ring of shadows closing on the leaf with a splash in the middle and one
 * open door to the left or right. Slipping out through the door grazes the
 * frame on both sides.
 */
function buildCage(world: World, st: SimState, fall: number, u1: number, u2: number, uR: number): boolean {
  const p = world.player;
  const b = st.batch;
  const r = 16 + 2 * uR;
  const R = r + ANT_HIT_R;
  const ring = 2 * R - 8;
  const c = p.x + (2 * u1 - 1) * 6;
  const first = u2 < 0.5 ? -1 : 1;
  for (let k = 0; k < 2; k++) {
    const door = k === 0 ? first : -first;
    const doorSlot = door > 0 ? 0 : 4;
    b.n = 0;
    batchPush(b, onWater(world, c, 0, fall), 0, r, 0);
    for (let s = 0; s < 8; s++) {
      if (s === doorSlot) continue;
      const x = c + SLOT_COS[s] * ring;
      const dy = SLOT_SIN[s] * ring;
      // Slots over the bank are left out: the bank already walls that side.
      if (onWater(world, x, dy, fall) !== x) continue;
      batchPush(b, x, dy, r, 0);
    }
    if (world.drops.length + b.n <= MAX_DROPS && batchIsEscapable(world, st, b, fall, p.x)) {
      commitBatch(world, b, fall, true);
      return true;
    }
  }
  return false;
}

/** A quick burst of small splashes beside the leaf, landing one after another. */
function buildCluster(
  world: World,
  st: SimState,
  fall: number,
  u1: number,
  u2: number,
  u3: number,
  u4: number,
  uBeat: number,
): boolean {
  const p = world.player;
  const b = st.batch;
  const count = 4 + Math.floor(u1 * 3);
  const dist = lerp(14, 52, u3);
  // Splashes land one after another, a quick drum roll.
  const beat = lerp(0.06, 0.09, uBeat);
  const first = u2 < 0.5 ? -1 : 1;
  for (let k = 0; k < 2; k++) {
    const side = k === 0 ? first : -first;
    const cx = p.x + side * dist;
    b.n = 0;
    for (let i = 0; i < count; i++) {
      const dy = (2 * hashUnit(u4, i + 16) - 1) * 24;
      const x = onWater(world, cx + (2 * hashUnit(u4, i) - 1) * 36, dy, fall + i * beat);
      const r = 14 + 3 * hashUnit(u4, i + 32);
      batchPush(b, x, dy, r, i * beat);
    }
    if (world.drops.length + b.n <= MAX_DROPS && batchIsEscapable(world, st, b, fall, p.x)) {
      commitBatch(world, b, fall, true);
      return true;
    }
  }
  return false;
}

/** Tries to place the pattern held in st.pattern; true once placed. */
function placePattern(world: World, st: SimState): boolean {
  const u = st.pattern.u;
  const fall = Math.min(PATTERN_MAX_FALL, st.diff.fall + PATTERN_EXTRA_FALL);
  switch (pickPattern(st.diff.level, u[0])) {
    case 'wall':
      return buildWall(world, st, fall, u[1], u[5]);
    case 'cage':
      return buildCage(world, st, fall, u[1], u[2], u[5]);
    case 'cluster':
      return buildCluster(world, st, fall, u[1], u[2], u[3], u[4], u[6]);
  }
}

/**
 * Draws a pattern and tries to place it. If no fair placement exists right
 * now it is kept and retried shortly with the same values, without touching
 * the RNG or the pattern clock: the clock and the stream must not depend on
 * where the player happens to be.
 */
function spawnPattern(world: World, st: SimState): void {
  const u = st.pattern.u;
  for (let i = 0; i < PATTERN_DRAWS; i++) u[i] = world.rng.next();
  st.patternTimer += 0.75 + 0.5 * u[PATTERN_DRAWS - 1];
  st.pattern.retries = PATTERN_RETRIES;
  st.pattern.retryIn = 0;
  if (placePattern(world, st)) st.pattern.retries = 0;
  else st.pattern.retryIn = PATTERN_RETRY;
}

function retryPattern(world: World, st: SimState, dt: number): void {
  const pat = st.pattern;
  if (pat.retries <= 0) return;
  pat.retryIn -= dt;
  if (pat.retryIn > 0) return;
  pat.retries--;
  pat.retryIn = PATTERN_RETRY;
  if (placePattern(world, st)) pat.retries = 0;
}

// --- Tutorial ----------------------------------------------------------------------

/** The demo drop lands this far outside the ant's hit circle: inside the near-miss band. */
const DEMO_CLEARANCE = 8;
const DEMO_R = 18;
/** Extra telegraph time so a first-timer can watch the ring close. */
const DEMO_EXTRA_FALL = 0.4;

/**
 * First-run tutorial: one slow, unaimed drop beside the leaf, on the side
 * with more water. Standing still, the ring closes and the splash lands just
 * clear of the ant: a free near-miss that shows the whole mechanic at once.
 * Endless only (the caller guarantees it), and it draws nothing from world.rng.
 */
export function spawnDemoDrop(world: World, st: SimState): void {
  const p = world.player;
  const centreX = p.x;
  const fall = Math.min(PATTERN_MAX_FALL + DEMO_EXTRA_FALL, st.diff.fall + DEMO_EXTRA_FALL);
  const e = edgesAtLanding(world, fall);
  const off = DEMO_R + ANT_HIT_R + DEMO_CLEARANCE;
  const first = e.right - centreX >= centreX - e.left ? 1 : -1;
  const b = st.batch;
  for (const side of [first, -first]) {
    const want = centreX + side * off;
    const x = onWater(world, want, 0, fall);
    // Clamped by the bank: it would land closer to the ant than intended.
    if (Math.abs(x - want) > 1) continue;
    b.n = 0;
    batchPush(b, x, 0, DEMO_R, 0);
    if (batchIsEscapable(world, st, b, fall, p.x)) {
      commitBatch(world, b, fall, false);
      return;
    }
  }
}

// --- Per-step -------------------------------------------------------------------------

/** Spawns singles and patterns on their timers (live runs only). */
export function spawnDrops(world: World, st: SimState, dt: number): void {
  // Tutorial hold: timers stay put, so the first drop comes right after release.
  if (st.holdDrops) return;
  const diff = st.diff;
  const mods = PHASE_MODS[world.storm];

  // Timers count in spawns, drained at the current rate, so a change of
  // storm phase or difficulty takes effect at once rather than after the
  // previously scheduled gap.
  const rate = diff.dropRate * mods.rate * diff.grace;
  st.dropTimer -= dt * rate;
  if (st.dropTimer <= 0) spawnSingle(world, st);

  const interval = diff.patternInterval * mods.patternInterval;
  if (interval === Infinity) {
    // Locked (early run or a calm phase): the first pattern after it comes
    // a beat later rather than the moment the storm picks up.
    if (st.patternTimer < PATTERN_LEAD_IN) st.patternTimer = PATTERN_LEAD_IN;
  } else {
    st.patternTimer -= dt / interval;
    if (st.patternTimer <= 0) spawnPattern(world, st);
  }
  retryPattern(world, st, dt);
}

/**
 * Moves drops with the river and resolves impacts. `live` = a running run:
 * splashes can hit or graze the ant. Otherwise impacts are cosmetic.
 */
export function updateDrops(world: World, st: SimState, dt: number, live: boolean): void {
  const p = world.player;
  const v = world.scrollSpeed;
  const drops = world.drops;
  let w = 0;
  for (let i = 0; i < drops.length; i++) {
    const d = drops[i];
    d.age += dt;
    d.y += v * dt;
    if (d.age < d.fall) {
      drops[w++] = d;
      continue;
    }
    const onLeaf = insideLeaf(d.x, d.y, p.x, p.y);
    world.events.push({ type: 'drop-impact', x: d.x, y: d.y, r: d.r, onLeaf });
    if (!live || world.state !== 'running') continue;
    const dx = d.x - p.x;
    const dy = d.y - p.y;
    const dist2 = dx * dx + dy * dy;
    const hitR = d.r + ANT_HIT_R;
    if (dist2 < hitR * hitR) {
      if (p.invuln <= 0) applyHit(world, st, 'drop', p.x, p.y);
    } else {
      const nearR = hitR + NEAR_BAND;
      if (dist2 < nearR * nearR && p.invuln <= 0) registerNearMiss(world, d.x, d.y);
      if (onLeaf) p.wet = Math.min(1, p.wet + WET_PER_SPLASH);
    }
  }
  drops.length = w;
}

