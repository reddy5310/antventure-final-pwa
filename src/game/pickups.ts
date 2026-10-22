// Crumb trails and power-up pickups.
//
// Layout: pickups sit at fixed river distances, drawn from their own seeded
// stream (seed ^ 0x17E45), never world.rng. Like obstacles they depend only on
// (seed, distance): not on screen height, timing or anything the player does,
// so the Daily River offers the same trails to everyone. Each trail / power-up
// consumes a fixed number of values whatever it ends up placing, and they are
// laid out in ascending distance order, so the stream stays aligned.
//
// The layout uses only arithmetic and Math.sqrt (no sin/exp), whose results may
// differ in the last bit between JS engines, so it is the same on every device.
//
// To keep pickups out of rocks, a pickup is laid out only once the obstacle
// stream has passed it (SimState.nextObstacleD, minus the furthest an obstacle
// reaches back), so every obstacle that could touch it already exists. That
// makes the result the same whatever the screen height is. Obstacles are
// remembered as they were born (a twig's later drift is not predictable from
// here).
//
// Play: the leaf collects pickups it touches, crumbs score and feed the combo
// timer, the honey magnet pulls crumbs in, power-ups hand over to powers.ts.

import { LEAF_HIT_R, SPAWN_AHEAD, UNITS_PER_METER } from '../config';
import { createRng, type Rng } from '../engine/rng';
import type { Pickup, PickupKind, World } from '../types';
import { activatePower, hasPower, powerPoints } from './powers';
import { payFactor } from './scoring';
import { riverEdgesInto, type RiverEdges } from './river';
import { simState } from './state';
import { COMBO_TIME } from './tuning';
import { createZoneMods, createZoneSample, zoneAt, zoneModsAt, type ZoneMods, type ZoneSample } from './zones';

const U = UNITS_PER_METER;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// --- Tuning -------------------------------------------------------------------

export const CRUMB_POINTS = 10;
/** Perfect trail: every crumb of a trail taken. */
export const TRAIL_BONUS = 50;
/** A crumb adds this many seconds to a running combo timer (capped at COMBO_TIME). */
export const CRUMB_COMBO_BONUS = 0.4;
/**
 * Honey: crumbs this close to the leaf drift towards it... (A trail every
 * ~80 m is one every ~15 s, so a magnet has to reach a lane or two to the side
 * and last long enough to meet a trail: at 110 units / 9 s it paid ~+0.7
 * crumbs, next to nothing.)
 */
export const MAGNET_RANGE = 160;
/** ...at this speed (u/s, on top of the river's own motion). */
export const MAGNET_SPEED = 260;
/** The leaf takes a pickup whose centre is this close to the leaf centre. */
export const PICKUP_R = LEAF_HIT_R + 6;
/** Seconds a taken pickup stays in the list so the renderer can animate it out. */
export const TAKEN_LINGER = 0.25;

/** Distance between crumbs along the river (units). */
export const CRUMB_SPACING = 22;
export const TRAIL_MIN = 5;
export const TRAIL_MAX = 9;
/**
 * Trails start this far apart (metres, before the zone's crumb multiplier).
 * Tuned from the planned 40-90 m: with 40-90 a crumb-chasing bot made ~19 % of
 * its score from crumbs, the top of the 10-20 % target; 55-105 gives ~17 %.
 */
const TRAIL_GAP_M = [55, 105] as const;
/** The first trail comes early so a new player learns what crumbs are. */
const FIRST_TRAIL_M = [18, 26] as const;
/** Power-ups: 160-260 m apart (before the zone's power-up multiplier, counted along the way: see powerGapEnd)... */
const POWER_GAP_M = [160, 260] as const;
/** ...the first one after the stretch an idle player survives (median ~15 s = ~40 m). */
const FIRST_POWER_M = [64, 110] as const;

/** Crumbs keep this far inside the water's edge. */
const EDGE_MARGIN = 14;
/** Crumb centre to obstacle edge, so a crumb never sits under a rock. */
const CLEAR_OBSTACLE = 16;
/** Crumb centre to the edge of another pickup. */
const CLEAR_PICKUP = 14;
/** Crumb radius assumed when other pickups avoid it. */
const CRUMB_R = 6;
const POWER_R = 18;
/** Power-ups sit at least this far from every obstacle's edge. */
const POWER_CLEAR = 60;
const POWER_EDGE = 40;
/** Candidate rows (river distance steps) and lateral nudges tried for a power-up. */
const POWER_ROW_STEP = 35;
const POWER_ROWS = 4;
const POWER_NUDGE = [0, 55, -55, 110, -110] as const;
/**
 * Two power-ups are never laid out closer than this (units). Longer than a
 * pickup stays in the list (lookahead + the way down the screen), even on very
 * tall screens, and shorter than the planned 160 m / 1.3 spacing.
 */
const POWER_MIN_SEP = 5000;
/** Step (units) of the walk that turns a power-up gap into river distance. */
const GAP_STEP = 8 * U;
/** Fewer than this many crumbs left after sliding out of obstacles: no trail. */
const MIN_PLACED = 3;

/**
 * The furthest an obstacle laid out at distance d can reach back towards the
 * leaf: a twig's bounding circle (62 + 6) with room for a bigger pad.
 */
const OBSTACLE_REACH = 80;
/** River distance a full trail spans, and what a power-up's search rows span. */
const TRAIL_SPAN = (TRAIL_MAX - 1) * CRUMB_SPACING;
const POWER_SPAN = (POWER_ROWS - 1) * POWER_ROW_STEP;
/** Disc records further behind the leaf than this are forgotten. */
const KEEP_BEHIND = 150;
/** Pickups this far below the view are removed. */
const REMOVE_BELOW = 80;

type Shape = 'line' | 'arc' | 'zigzag' | 'dare';
const POWER_KINDS = ['mushroom', 'honey', 'ladybug', 'firefly'] as const;
type PowerPickup = (typeof POWER_KINDS)[number];
/** Base odds. Ladybug is rarer (a full-heart ladybug is only points). */
const POWER_WEIGHT: Readonly<Record<PowerPickup, number>> = { mushroom: 3, honey: 1.8, ladybug: 1.3, firefly: 1.4 };
/** Fireflies get this much likelier when Night is here or coming within NIGHT_LOOKAHEAD_M. */
const FIREFLY_NIGHT_BOOST = 3.5;
const NIGHT_LOOKAHEAD_M = 100;

// --- State --------------------------------------------------------------------

/** A circle on the river plane: (river distance, x) with a radius. */
interface Disc {
  d: number;
  x: number;
  r: number;
  /** Rocks and pads: static, safe to hug. Twigs drift, so they are only avoided. */
  solid: boolean;
}

/** Bookkeeping for the Perfect-trail bonus and the pitch streak. */
interface Trail {
  id: number;
  size: number;
  taken: number;
  /** Consecutive crumbs taken in trail order, ending at `last`. */
  streak: number;
  last: number;
  /** Items of this trail still in world.pickups. */
  alive: number;
}

/** A pickup plus the sim-only fields behind the public contract. */
interface Item extends Pickup {
  /** Seconds since taken (the renderer may animate with it). */
  takenT: number;
  /** Order within its trail (0 = first to reach the leaf); -1 for power-ups. */
  idx: number;
}

interface PickupState {
  rng: Rng;
  nextTrailD: number;
  nextPowerD: number;
  lastPowerD: number;
  trailSeq: number;
  /** Obstacles as they were born. */
  obstacles: Disc[];
  /** Laid-out pickups, so later ones keep clear of earlier ones. */
  placed: Disc[];
  trails: Trail[];
  lastObsId: number;
  /** Player y at the last sync (a resize moves the player's row). */
  playerY: number;
  // Scratch for one trail.
  xs: Float64Array;
  ds: Float64Array;
  lo: Float64Array;
  hi: Float64Array;
  ok: Uint8Array;
  edges: RiverEdges;
  mods: ZoneMods;
  sample: ZoneSample;
}

const states = new WeakMap<World, PickupState>();

function pickupState(world: World): PickupState {
  let st = states.get(world);
  if (!st) {
    const rng = createRng((world.seed ^ 0x17e45) >>> 0);
    const uTrail = rng.next();
    const uPower = rng.next();
    st = {
      rng,
      nextTrailD: lerp(FIRST_TRAIL_M[0], FIRST_TRAIL_M[1], uTrail) * U,
      nextPowerD: lerp(FIRST_POWER_M[0], FIRST_POWER_M[1], uPower) * U,
      lastPowerD: -Infinity,
      trailSeq: 0,
      obstacles: [],
      placed: [],
      trails: [],
      lastObsId: 0,
      playerY: NaN,
      xs: new Float64Array(TRAIL_MAX),
      ds: new Float64Array(TRAIL_MAX),
      lo: new Float64Array(TRAIL_MAX),
      hi: new Float64Array(TRAIL_MAX),
      ok: new Uint8Array(TRAIL_MAX),
      edges: { left: 0, right: 0 },
      mods: createZoneMods(),
      sample: createZoneSample(),
    };
    states.set(world, st);
  }
  return st;
}

/** Integer hash -> [0, 1): a stable per-pickup value without touching the RNG stream. */
function hashUnit(a: number, b: number): number {
  let h = (Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Items carry sim-only fields; objects pushed in from outside (tests) get defaults. */
function asItem(k: Pickup): Item {
  const it = k as Item;
  if (typeof it.takenT !== 'number') {
    it.takenT = 0;
    it.idx = -1;
  }
  return it;
}

/** A resize moves the player's row; pickups follow so they keep their place relative to it. */
function sync(world: World, st: PickupState): void {
  const y = world.player.y;
  if (st.playerY !== st.playerY) {
    st.playerY = y;
    return;
  }
  const dy = y - st.playerY;
  if (dy === 0) return;
  st.playerY = y;
  for (const k of world.pickups) k.y += dy;
}

/**
 * Re-anchors pickups right away when the leaf's row moves (a resize or a
 * rotation). Obstacles and drops are shifted by setViewHeight itself; without
 * this the pickups would wait for the next sim step, and while the game is
 * paused or counting down they would sit off from the rocks they belong to.
 */
export function syncPickups(world: World): void {
  sync(world, pickupState(world));
}

function findTrail(st: PickupState, id: number): Trail | null {
  if (id <= 0) return null;
  for (let i = 0; i < st.trails.length; i++) if (st.trails[i].id === id) return st.trails[i];
  return null;
}

/** An item has left the list: forget its trail once nothing of it remains. */
function releaseFromTrail(st: PickupState, id: number): void {
  const tr = findTrail(st, id);
  if (!tr) return;
  tr.alive--;
  if (tr.alive <= 0) {
    const i = st.trails.indexOf(tr);
    st.trails[i] = st.trails[st.trails.length - 1];
    st.trails.pop();
  }
}

// --- Layout -------------------------------------------------------------------

/** Records obstacles the first time they are seen: still exactly as they were born. */
function scanObstacles(world: World, st: PickupState): void {
  const p = world.player;
  const list = world.obstacles;
  let maxId = st.lastObsId;
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    if (o.id <= st.lastObsId) continue;
    if (o.id > maxId) maxId = o.id;
    st.obstacles.push({
      d: world.distance + (p.y - o.y),
      x: o.x,
      // A twig turns as it drifts: its bounding circle covers every angle.
      r: o.kind === 'twig' ? o.len + o.r : o.r,
      solid: o.kind !== 'twig',
    });
  }
  st.lastObsId = maxId;
}

function forget(discs: Disc[], minD: number): void {
  let w = 0;
  for (let i = 0; i < discs.length; i++) if (discs[i].d >= minD) discs[w++] = discs[i];
  discs.length = w;
}

/** Half the width of the chord of a circle of radius R at offset dd from its centre (0 if outside). */
function chord(R: number, dd: number): number {
  const a = Math.abs(dd);
  return a >= R ? 0 : Math.sqrt(R * R - a * a);
}

const EPS = 1e-6;

/**
 * Slides crumbs out of discs. Per disc, every crumb inside it goes to the same
 * side (the side most of them were already on), so a trail that meets a rock
 * parts around it instead of crossing it. A crumb with no room on either side
 * is dropped.
 */
function separate(st: PickupState, n: number, discs: Disc[], pad: number, awayFrom = NaN): void {
  const first = st.ds[0];
  const last = st.ds[n - 1];
  for (const s of discs) {
    const R = s.r + pad;
    if (s.d + R < first || s.d - R > last) continue;
    let sum = 0;
    let hits = 0;
    for (let i = 0; i < n; i++) {
      if (!st.ok[i]) continue;
      const need = chord(R, st.ds[i] - s.d);
      if (need > EPS && Math.abs(st.xs[i] - s.x) < need - EPS) {
        sum += st.xs[i] - s.x;
        hits++;
      }
    }
    if (hits === 0) continue;
    let side: 1 | -1;
    if (awayFrom === awayFrom) side = s.x >= awayFrom ? 1 : -1; // the opening trail passes on the far side
    else if (sum !== 0) side = sum > 0 ? 1 : -1;
    else side = s.x < (st.lo[0] + st.hi[0]) / 2 ? 1 : -1; // dead centre: towards the roomier side
    for (let i = 0; i < n; i++) {
      if (!st.ok[i]) continue;
      const need = chord(R, st.ds[i] - s.d);
      if (!(need > EPS && Math.abs(st.xs[i] - s.x) < need - EPS)) continue;
      let nx = s.x + side * need;
      if (nx < st.lo[i] || nx > st.hi[i]) {
        nx = s.x - side * need;
        if (nx < st.lo[i] || nx > st.hi[i]) {
          st.ok[i] = 0;
          continue;
        }
      }
      st.xs[i] = nx;
    }
  }
}

/** Does crumb i still overlap any disc? */
function overlaps(st: PickupState, i: number, discs: Disc[], pad: number): boolean {
  for (const s of discs) {
    const R = s.r + pad;
    const need = chord(R, st.ds[i] - s.d);
    if (need > EPS && Math.abs(st.xs[i] - s.x) < need - 2 * EPS) return true;
  }
  return false;
}

/** The solid (or any) obstacle nearest to river distance dMid within reach, else null. */
function nearestDisc(st: PickupState, dMid: number, reach: number, solidOnly: boolean): Disc | null {
  let best: Disc | null = null;
  let bestGap = Infinity;
  for (const s of st.obstacles) {
    if (solidOnly && !s.solid) continue;
    const gap = Math.abs(s.d - dMid);
    if (gap <= reach && gap < bestGap) {
      best = s;
      bestGap = gap;
    }
  }
  return best;
}

const roomEdges: RiverEdges = { left: 0, right: 0 };

/** Which side of an obstacle has the room to pass (ties go to the seeded coin). */
function roomySide(seed: number, s: Disc, uSide: number): 1 | -1 {
  const edges = riverEdgesInto(seed, s.d, roomEdges);
  const left = s.x - s.r - edges.left;
  const right = edges.right - (s.x + s.r);
  if (Math.abs(left - right) < 30) return uSide < 0.5 ? -1 : 1;
  return right > left ? 1 : -1;
}

/** Triangle wave of period 1: 0 at 0, +1 at 1/4, 0 at 1/2, -1 at 3/4. Plain arithmetic, so it is bit-exact on every engine. */
function triangle(phase: number): number {
  const f = phase - Math.floor(phase);
  return f < 0.25 ? 4 * f : f < 0.75 ? 2 - 4 * f : 4 * f - 4;
}

function pickShape(u: number): Shape {
  if (u < 0.3) return 'line';
  if (u < 0.58) return 'arc';
  if (u < 0.82) return 'zigzag';
  return 'dare';
}

function pushItem(world: World, kind: PickupKind, x: number, d: number, trail: number, idx: number, variant: number): void {
  const item: Item = {
    id: world.nextId++,
    kind,
    x,
    y: world.player.y - (d - world.distance),
    trail,
    taken: false,
    variant,
    takenT: 0,
    idx,
  };
  world.pickups.push(item);
}

/** Lays out one crumb trail starting at river distance d0 and schedules the next. */
function layoutTrail(world: World, st: PickupState, d0: number): void {
  const rng = st.rng;
  // Fixed draws per trail, whatever is placed.
  const uGap = rng.next();
  const uCount = rng.next();
  const uShape = rng.next();
  const uCx = rng.next();
  const uAmp = rng.next();
  const uSide = rng.next();
  rng.next(); // spare: room for a new knob without shifting every later trail
  rng.next();

  const seed = world.seed;
  const mods = zoneModsAt(seed, d0, st.mods);
  st.nextTrailD = d0 + (lerp(TRAIL_GAP_M[0], TRAIL_GAP_M[1], uGap) * U) / Math.max(0.25, mods.crumbs);

  const n = TRAIL_MIN + Math.floor(uCount * (TRAIL_MAX - TRAIL_MIN + 1));
  const trailId = ++st.trailSeq;
  // Onboarding: the very first trail is a plain line, to one side of the start
  // so that it has to be steered to (an idle leaf collects nothing).
  const shape: Shape = trailId === 1 ? 'line' : pickShape(uShape);

  const e = st.edges;
  for (let i = 0; i < n; i++) {
    st.ds[i] = d0 + i * CRUMB_SPACING;
    riverEdgesInto(seed, st.ds[i], e);
    st.lo[i] = e.left + EDGE_MARGIN;
    st.hi[i] = e.right - EDGE_MARGIN;
    st.ok[i] = 1;
  }
  const dMid = d0 + ((n - 1) * CRUMB_SPACING) / 2;
  riverEdgesInto(seed, dMid, e);
  const mid = (e.left + e.right) / 2;
  const cxLo = e.left + 40;
  const cxHi = e.right - 40;
  const sgn = uSide < 0.5 ? -1 : 1;
  let cx = trailId === 1 ? mid + sgn * lerp(55, 70, uCx) : lerp(cxLo, cxHi, uCx);
  const reach = ((n - 1) * CRUMB_SPACING) / 2 + 60;

  const ref = shape === 'arc' || shape === 'dare' ? nearestDisc(st, dMid, reach, true) : null;
  if (shape === 'zigzag') {
    // Peak of the wave; the crumbs sample it at 0, 2/3, 2/3, 0, -2/3, -2/3 of the peak, so ~43-55 off centre.
    const amp = lerp(65, 83, uAmp);
    cx = clamp(cx, e.left + EDGE_MARGIN + amp, e.right - EDGE_MARGIN - amp);
    for (let i = 0; i < n; i++) st.xs[i] = cx + sgn * amp * triangle(i / 6);
  } else if (shape === 'arc' && ref) {
    // Hugs the rock at the point where the leaf passes it, flares out either side.
    const s = roomySide(seed, ref, uSide);
    for (let i = 0; i < n; i++) {
      const u = Math.min(1, Math.abs(st.ds[i] - ref.d) / 110);
      st.xs[i] = ref.x + s * (ref.r + LEAF_HIT_R + 4 + 52 * u * u);
    }
  } else if (shape === 'arc') {
    // No rock to bend around: a gentle bow across the lane.
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      st.xs[i] = cx - sgn * 22 + sgn * 44 * 4 * t * (1 - t);
    }
  } else if (shape === 'dare' && ref) {
    // Hugging the rock: the crumbs sit just outside its collision circle, on the passing side.
    const s = roomySide(seed, ref, uSide);
    for (let i = 0; i < n; i++) st.xs[i] = ref.x + s * (ref.r + LEAF_HIT_R + 8);
  } else {
    for (let i = 0; i < n; i++) st.xs[i] = cx;
  }
  for (let i = 0; i < n; i++) st.xs[i] = clamp(st.xs[i], st.lo[i], st.hi[i]);

  // The opening trail must not be carried across the start lane by a rock
  // (a leaf that never moves collects nothing): it passes rocks on the far side.
  let startX = NaN;
  if (trailId === 1) {
    riverEdgesInto(seed, 0, e);
    startX = (e.left + e.right) / 2;
  }
  // Slide out of obstacles and earlier pickups; a few rounds settle chained pushes.
  for (let pass = 0; pass < 3; pass++) {
    separate(st, n, st.obstacles, CLEAR_OBSTACLE, startX);
    separate(st, n, st.placed, CLEAR_PICKUP);
  }
  if (trailId === 1) {
    for (let i = 0; i < n; i++) if (Math.abs(st.xs[i] - startX) < PICKUP_R + 6) st.ok[i] = 0;
  }
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (st.ok[i] && (overlaps(st, i, st.obstacles, CLEAR_OBSTACLE) || overlaps(st, i, st.placed, CLEAR_PICKUP))) st.ok[i] = 0;
    count += st.ok[i];
  }
  if (count < MIN_PLACED) return;

  st.trails.push({ id: trailId, size: count, taken: 0, streak: 0, last: -1, alive: count });
  let idx = 0;
  for (let i = 0; i < n; i++) {
    if (!st.ok[i]) continue;
    pushItem(world, 'crumb', st.xs[i], st.ds[i], trailId, idx, hashUnit(trailId, i));
    st.placed.push({ d: st.ds[i], x: st.xs[i], r: CRUMB_R, solid: false });
    idx++;
  }
}

/** Night here, or the zone the river is about to blend into at river distance d. */
function nightAt(seed: number, d: number, sample: ZoneSample): boolean {
  const s = zoneAt(seed, d, sample);
  return (s.blend < 0.5 ? s.zone : s.next) === 'night';
}

function pickPowerKind(seed: number, d: number, u: number, sample: ZoneSample): PowerPickup {
  const night = nightAt(seed, d, sample) || nightAt(seed, d + NIGHT_LOOKAHEAD_M * U, sample);
  let total = 0;
  for (const k of POWER_KINDS) total += k === 'firefly' && night ? POWER_WEIGHT[k] * FIREFLY_NIGHT_BOOST : POWER_WEIGHT[k];
  let t = u * total;
  for (const k of POWER_KINDS) {
    t -= k === 'firefly' && night ? POWER_WEIGHT[k] * FIREFLY_NIGHT_BOOST : POWER_WEIGHT[k];
    if (t < 0) return k;
  }
  return 'mushroom';
}

/** Is (x, dist) far enough from every obstacle and earlier pickup to hold a power-up? */
function powerSpotFree(st: PickupState, x: number, dist: number): boolean {
  for (const s of st.obstacles) {
    const dx = x - s.x;
    const dd = dist - s.d;
    const reachR = s.r + POWER_CLEAR;
    if (dx * dx + dd * dd < reachR * reachR) return false;
  }
  for (const s of st.placed) {
    const dx = x - s.x;
    const dd = dist - s.d;
    const reachR = s.r + POWER_R + CLEAR_PICKUP;
    if (dx * dx + dd * dd < reachR * reachR) return false;
  }
  return true;
}

/**
 * River distance `gapM` metres of power-up "weather" after d0: every metre
 * counts as the zone's power-up multiplier, so the Rapids (x1.3) really do
 * hand out more. Reading the multiplier at d0 alone would charge the gap after
 * the last power-up of a zone at that zone's rate, and a Rapids stretch of
 * 150-220 m (shorter than a gap) would barely see its bonus. A pure function
 * of the seed and distance, like every other layout decision.
 */
function powerGapEnd(seed: number, d0: number, gapM: number, mods: ZoneMods): number {
  let need = gapM * U;
  let d = d0;
  while (need > 0) {
    const density = Math.max(0.25, zoneModsAt(seed, d + GAP_STEP / 2, mods).powers);
    const budget = density * GAP_STEP;
    if (need <= budget) return d + need / density;
    need -= budget;
    d += GAP_STEP;
  }
  return d;
}

/** Lays out one power-up near river distance d0 and schedules the next. */
function layoutPower(world: World, st: PickupState, d0: number): void {
  const rng = st.rng;
  const uGap = rng.next();
  const uKind = rng.next();
  const uX = rng.next();
  const uVar = rng.next();

  const seed = world.seed;
  st.nextPowerD = powerGapEnd(seed, d0, lerp(POWER_GAP_M[0], POWER_GAP_M[1], uGap), st.mods);
  const kind = pickPowerKind(seed, d0, uKind, st.sample);

  // Never two power-ups alive at once. Judged by distance, not by what is in
  // world.pickups, so that the layout cannot depend on what the player collected.
  if (d0 - st.lastPowerD < POWER_MIN_SEP) return;

  const e = st.edges;
  for (let row = 0; row < POWER_ROWS; row++) {
    const dist = d0 + row * POWER_ROW_STEP;
    riverEdgesInto(seed, dist, e);
    const lo = e.left + POWER_EDGE;
    const hi = e.right - POWER_EDGE;
    const half = (e.right - e.left) / 2;
    const base = (e.left + e.right) / 2 + (2 * uX - 1) * 0.3 * half;
    for (const nudge of POWER_NUDGE) {
      const x = clamp(base + nudge, lo, hi);
      if (!powerSpotFree(st, x, dist)) continue;
      pushItem(world, kind, x, dist, 0, -1, uVar);
      st.placed.push({ d: dist, x, r: POWER_R, solid: false });
      st.lastPowerD = d0;
      return;
    }
  }
}

/**
 * Lays out crumb trails and power-ups that have come within lookahead (live
 * runs only). Call after layoutObstacles: the obstacles they must avoid exist.
 */
export function layoutPickups(world: World): void {
  if (world.state !== 'running') return;
  const st = pickupState(world);
  sync(world, st);
  scanObstacles(world, st);
  // Lay out what has come within the same lookahead as obstacles, provided the
  // obstacle stream has passed everything it must avoid.
  const reach = world.distance + Math.max(SPAWN_AHEAD, world.player.y + 60);
  const known = simState(world).nextObstacleD - OBSTACLE_REACH;
  for (;;) {
    const trailNext = st.nextTrailD <= st.nextPowerD;
    const d0 = trailNext ? st.nextTrailD : st.nextPowerD;
    if (d0 > reach) break;
    if (d0 + (trailNext ? TRAIL_SPAN + CLEAR_OBSTACLE : POWER_SPAN + POWER_CLEAR) > known) break;
    if (trailNext) layoutTrail(world, st, d0);
    else layoutPower(world, st, d0);
  }
  const behind = world.distance - KEEP_BEHIND;
  forget(st.obstacles, behind);
  forget(st.placed, behind);
}

// --- Play ---------------------------------------------------------------------

function collectCrumb(world: World, st: PickupState, k: Item): void {
  k.taken = true;
  k.takenT = 0;
  const points = Math.round(CRUMB_POINTS * payFactor(world));
  world.score += points;
  world.crumbs++;
  // Routing through crumbs keeps a chain alive (never starts one).
  if (world.combo > 0) world.comboTimer = Math.min(COMBO_TIME, world.comboTimer + CRUMB_COMBO_BONUS);

  const tr = findTrail(st, k.trail);
  let streak = 1;
  if (tr) {
    streak = k.idx === tr.last + 1 ? tr.streak + 1 : 1;
    tr.streak = streak;
    tr.last = k.idx;
    tr.taken++;
  }
  world.events.push({ type: 'pickup', kind: 'crumb', x: k.x, y: k.y, points, streak });
  if (tr && tr.taken >= tr.size) {
    const bonus = Math.round(TRAIL_BONUS * payFactor(world));
    world.score += bonus;
    world.events.push({ type: 'trail-complete', x: k.x, y: k.y, points: bonus });
  }
}

function collectPower(world: World, k: Item): void {
  k.taken = true;
  k.takenT = 0;
  if (k.kind === 'crumb') return;
  const points = powerPoints(world, k.kind);
  world.events.push({ type: 'pickup', kind: k.kind, x: k.x, y: k.y, points, streak: 0 });
  activatePower(world, k.kind);
}

/**
 * Moves pickups with the river, applies the honey magnet, collects what the
 * leaf touches (`live` only) and removes what has left the view.
 */
export function updatePickups(world: World, dt: number, live: boolean): void {
  const list = world.pickups;
  if (list.length === 0) return;
  const st = pickupState(world);
  sync(world, st);
  const p = world.player;
  const drift = world.scrollSpeed * dt;
  const limit = world.viewH + REMOVE_BELOW;
  const collecting = live && world.state === 'running';
  const magnet = collecting && hasPower(world, 'honey');
  const pull = MAGNET_SPEED * dt;
  const r2 = PICKUP_R * PICKUP_R;
  const range2 = MAGNET_RANGE * MAGNET_RANGE;
  let w = 0;
  for (let i = 0; i < list.length; i++) {
    const k = asItem(list[i]);
    k.y += drift;
    if (k.taken) {
      k.takenT += dt;
      if (k.takenT >= TAKEN_LINGER) {
        releaseFromTrail(st, k.trail);
        continue;
      }
      list[w++] = k;
      continue;
    }
    let dx = p.x - k.x;
    let dy = p.y - k.y;
    let d2 = dx * dx + dy * dy;
    if (magnet && k.kind === 'crumb' && d2 < range2 && d2 > EPS) {
      const dist = Math.sqrt(d2);
      const step = Math.min(dist, pull);
      k.x += (dx / dist) * step;
      k.y += (dy / dist) * step;
      dx = p.x - k.x;
      dy = p.y - k.y;
      d2 = dx * dx + dy * dy;
    }
    if (collecting && d2 <= r2) {
      if (k.kind === 'crumb') collectCrumb(world, st, k);
      else collectPower(world, k);
    } else if (k.y > limit) {
      releaseFromTrail(st, k.trail);
      continue;
    }
    list[w++] = k;
  }
  list.length = w;
}
