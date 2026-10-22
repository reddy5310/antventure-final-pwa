// River zones: a pure function of (seed, river distance), like the river's
// shape, so the Daily River has the same zones for everyone and the renderer
// can ask what zone any row of the screen is in. 0–FIRST_ZONE_M is always
// Jungle; after that, seeded segments are drawn from a shuffled bag of all
// zones with no zone repeating back to back, and the first stretch after the
// opener is a gentle one (never the Rapids: a new player is at their most
// fragile there). Each boundary blends over BLEND_M at the start of the new
// segment.

import { UNITS_PER_METER } from '../config';
import { createRng, type Rng } from '../engine/rng';
import type { World, ZoneId } from '../types';

export interface ZoneDef {
  id: ZoneId;
  name: string;
  /** River width multiplier (applied in river.ts). */
  width: number;
  /** River speed multiplier. */
  scroll: number;
  /** Rain multiplier: how fast single drops and drop patterns both spawn. */
  rain: number;
  /** Obstacle density multiplier (spacing divides by it). */
  rocks: number;
  /** Crumb-trail frequency multiplier. */
  crumbs: number;
  /** Power-up frequency multiplier. */
  powers: number;
  /**
   * Points multiplier on everything the run earns here (distance, near-misses,
   * crumbs), on top of the chain multiplier. Zones that are harder per second
   * pay more, so risk is never the worse deal.
   */
  pay: number;
  /** 0 daylight .. 1 full night. */
  darkness: number;
  /** Rocks become lily pads (soft bumpers). */
  pads: boolean;
}

export const ZONES: Readonly<Record<ZoneId, Readonly<ZoneDef>>> = {
  jungle: { id: 'jungle', name: 'Jungle', width: 1, scroll: 1, rain: 1, rocks: 1, crumbs: 1, powers: 1, pay: 1, darkness: 0, pads: false },
  marsh: { id: 'marsh', name: 'Lily Marsh', width: 1.15, scroll: 0.9, rain: 0.85, rocks: 1, crumbs: 1.6, powers: 1, pay: 1, darkness: 0, pads: true },
  rapids: { id: 'rapids', name: 'Rapids', width: 0.85, scroll: 1.3, rain: 0.9, rocks: 1.25, crumbs: 1, powers: 1.3, pay: 1.4, darkness: 0, pads: false },
  night: { id: 'night', name: 'Night River', width: 1, scroll: 1, rain: 1.1, rocks: 1, crumbs: 1, powers: 1, pay: 1, darkness: 1, pads: false },
};

const BAG: readonly ZoneId[] = ['jungle', 'marsh', 'rapids', 'night'];

/** Opening Jungle stretch (metres). */
export const FIRST_ZONE_M = 120;
export const SEG_MIN_M = 150;
export const SEG_MAX_M = 220;
/** Transition length at the start of each new segment (metres). */
export const BLEND_M = 12;

const U = UNITS_PER_METER;
/** Distances beyond this (100 km of river) read as this far: keeps a bad input from growing the timeline forever. */
const MAX_ZONE_D = 5_000_000;

/** Numeric zone effects, blended across a transition. */
export interface ZoneMods {
  width: number;
  scroll: number;
  rain: number;
  rocks: number;
  crumbs: number;
  powers: number;
  /** Points multiplier (switches at the blend midpoint, so the HUD can show one settled number). */
  pay: number;
  darkness: number;
  /** Rocks laid out here become lily pads (switches at the blend midpoint). */
  pads: boolean;
}

export interface ZoneSample {
  /** Zone of the segment being left (or the current one outside a transition). */
  zone: ZoneId;
  /** Zone being entered; equals `zone` outside a transition. */
  next: ZoneId;
  /** 0..1 progress of the transition from `zone` to `next`. */
  blend: number;
  /** Index of the segment containing the distance (0 = opening Jungle). */
  index: number;
}

interface Timeline {
  rng: Rng;
  /** Segment end distances (world units), ascending. */
  ends: number[];
  zones: ZoneId[];
  bag: ZoneId[];
}

// A handful of recent seeds (menu backdrop + current run + share card).
const timelines = new Map<number, Timeline>();
const MAX_TIMELINES = 8;

function timeline(seed: number): Timeline {
  let t = timelines.get(seed);
  if (!t) {
    t = { rng: createRng((seed ^ 0x2d0e5) >>> 0), ends: [FIRST_ZONE_M * U], zones: ['jungle'], bag: [] };
    timelines.set(seed, t);
    if (timelines.size > MAX_TIMELINES) timelines.delete(timelines.keys().next().value as number);
  }
  return t;
}

/** Zones that may follow the opening Jungle: the hard, fast one waits until the player has found their feet. */
const FIRST_DRAW: readonly ZoneId[] = ['marsh', 'night'];

function nextFromBag(t: Timeline): ZoneId {
  if (t.bag.length === 0) {
    const bag = BAG.slice();
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(t.rng.next() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    // The bag is drawn from the end. The first draw after the opener comes from
    // FIRST_DRAW (this also rules out a Jungle repeat); no RNG is used, so the
    // shuffle, and every later segment length, is the same as without the rule.
    if (t.zones.length === 1) {
      let k = bag.length - 1;
      while (k > 0 && !FIRST_DRAW.includes(bag[k])) k--;
      [bag[bag.length - 1], bag[k]] = [bag[k], bag[bag.length - 1]];
    }
    // No back-to-back repeat across bag boundaries.
    const prev = t.zones[t.zones.length - 1];
    if (bag[bag.length - 1] === prev) [bag[bag.length - 1], bag[0]] = [bag[0], bag[bag.length - 1]];
    t.bag = bag;
  }
  return t.bag.pop() as ZoneId;
}

function extendTo(t: Timeline, d: number): void {
  while (t.ends[t.ends.length - 1] <= d) {
    const len = (SEG_MIN_M + (SEG_MAX_M - SEG_MIN_M) * t.rng.next()) * U;
    t.ends.push(t.ends[t.ends.length - 1] + len);
    t.zones.push(nextFromBag(t));
  }
}

function segmentIndex(t: Timeline, d: number): number {
  extendTo(t, d);
  // Binary search: first segment whose end is beyond d.
  let lo = 0;
  let hi = t.ends.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (t.ends[mid] > d) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Zone at river distance `d` (units). Allocation-free: writes into `out`. */
export function zoneAt(seed: number, d: number, out: ZoneSample): ZoneSample {
  const t = timeline(seed);
  // `d > 0` also turns NaN into 0.
  const dd = d > 0 ? Math.min(d, MAX_ZONE_D) : 0;
  const i = segmentIndex(t, dd);
  const start = i === 0 ? 0 : t.ends[i - 1];
  const into = dd - start;
  if (i > 0 && into < BLEND_M * U) {
    out.zone = t.zones[i - 1];
    out.next = t.zones[i];
    out.blend = into / (BLEND_M * U);
  } else {
    out.zone = t.zones[i];
    out.next = t.zones[i];
    out.blend = 0;
  }
  out.index = i;
  return out;
}

export function createZoneSample(): ZoneSample {
  return { zone: 'jungle', next: 'jungle', blend: 0, index: 0 };
}

export function createZoneMods(): ZoneMods {
  return { width: 1, scroll: 1, rain: 1, rocks: 1, crumbs: 1, powers: 1, pay: 1, darkness: 0, pads: false };
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** Blended zone effects for a sample. Allocation-free. */
export function modsFor(s: ZoneSample, out: ZoneMods): ZoneMods {
  const a = ZONES[s.zone];
  const b = ZONES[s.next];
  const k = s.blend;
  out.width = lerp(a.width, b.width, k);
  out.scroll = lerp(a.scroll, b.scroll, k);
  out.rain = lerp(a.rain, b.rain, k);
  out.rocks = lerp(a.rocks, b.rocks, k);
  out.crumbs = lerp(a.crumbs, b.crumbs, k);
  out.powers = lerp(a.powers, b.powers, k);
  out.pay = k < 0.5 ? a.pay : b.pay;
  out.darkness = lerp(a.darkness, b.darkness, k);
  out.pads = k < 0.5 ? a.pads : b.pads;
  return out;
}

const scratch = createZoneSample();

/** Blended zone effects at river distance `d`. Allocation-free. */
export function zoneModsAt(seed: number, d: number, out: ZoneMods): ZoneMods {
  return modsFor(zoneAt(seed, d, scratch), out);
}

interface Tracker {
  index: number;
  /** Bit per zone entered alive (ZONE_BIT); the opening Jungle counts from the start. */
  seen: number;
  mods: ZoneMods;
  sample: ZoneSample;
}
const ZONE_BIT: Readonly<Record<ZoneId, number>> = { jungle: 1, marsh: 2, rapids: 4, night: 8 };
const trackers = new WeakMap<World, Tracker>();

function tracker(world: World): Tracker {
  let t = trackers.get(world);
  if (!t) {
    t = { index: 0, seen: ZONE_BIT.jungle, mods: createZoneMods(), sample: createZoneSample() };
    trackers.set(world, t);
  }
  return t;
}

/** Zone effects at the leaf, as of the last trackZone() (identity before the first). */
export function currentZoneMods(world: World): Readonly<ZoneMods> {
  return tracker(world).mods;
}

function popcount4(v: number): number {
  return (v & 1) + ((v >> 1) & 1) + ((v >> 2) & 1) + ((v >> 3) & 1);
}

/**
 * Updates world.zone / nextZone / zoneBlend / darkness for the leaf's river
 * distance and, when a new segment begins, emits 'zone' and counts the zone
 * (live runs only — the menu backdrop stays silent, and the river drifting on
 * under a fallen leaf reaches nothing). zonesReached counts different zones,
 * so a long run that meets the Jungle twice does not report five of four.
 */
export function trackZone(world: World): void {
  const t = tracker(world);
  const s = zoneAt(world.seed, world.distance, t.sample);
  modsFor(s, t.mods);
  world.zone = s.zone;
  world.nextZone = s.next;
  world.zoneBlend = s.blend;
  world.darkness = t.mods.darkness;
  if (s.index > t.index) {
    t.index = s.index;
    if (world.state === 'running') {
      t.seen |= ZONE_BIT[s.next];
      world.zonesReached = popcount4(t.seen);
      world.events.push({ type: 'zone', zone: s.next });
    }
  }
}
