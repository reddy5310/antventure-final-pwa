// Daily missions and the per-run trackers they (and the badges) read.
// Three missions a day (easy 30, medium 60, hard 100 crumbs) are picked from the
// local date id with hashString, so every player gets the same three and they
// change at local midnight. Not part of the simulation: it only listens to its
// events, so it may be as dumb as it likes about frames.

import { UNITS_PER_METER } from '../config';
import { hashString } from '../engine/rng';
import { ZONES } from '../game/zones';
import type { GameEvent, MissionTier, MissionView, Mode, RunSummary, World, ZoneId } from '../types';

export const ZONE_BIT: Record<ZoneId, number> = { jungle: 1, marsh: 2, rapids: 4, night: 8 };
export const ALL_ZONES = 15;

/** Everything one run contributes. A single reused object: events update it with no allocation. */
export interface RunStats {
  mode: Mode;
  crumbs: number;
  near: number;
  combo: number;
  /** Whole metres. */
  dist: number;
  score: number;
  time: number;
  /** Zone kinds seen this run (bit mask, the opening Jungle included). */
  zoneMask: number;
  /** Times the river turned to night. */
  nightZones: number;
  trails: number;
  powers: number;
  shield: number;
  /** Run time of the last hit, and the longest hit-free span before it. */
  lastHitT: number;
  bestClean: number;
}

export const run: RunStats = {
  mode: 'endless',
  crumbs: 0,
  near: 0,
  combo: 0,
  dist: 0,
  score: 0,
  time: 0,
  zoneMask: ZONE_BIT.jungle,
  nightZones: 0,
  trails: 0,
  powers: 0,
  shield: 0,
  lastHitT: 0,
  bestClean: 0,
};

export function resetRun(mode: Mode): void {
  run.mode = mode;
  run.crumbs = run.near = run.combo = run.dist = run.score = run.time = 0;
  run.zoneMask = ZONE_BIT.jungle;
  run.nightZones = run.trails = run.powers = run.shield = 0;
  run.lastHitT = run.bestClean = 0;
}

/** Folds one live event into the trackers. */
export function trackEvent(e: GameEvent, w: World): void {
  switch (e.type) {
    case 'zone':
      run.zoneMask |= ZONE_BIT[e.zone];
      if (e.zone === 'night') run.nightZones++;
      break;
    case 'trail-complete':
      run.trails++;
      break;
    case 'power-start':
      run.powers++;
      break;
    case 'shield-block':
      run.shield++;
      break;
    case 'hit':
      run.bestClean = Math.max(run.bestClean, w.time - run.lastHitT);
      run.lastHitT = w.time;
      break;
  }
}

export function readWorld(w: World): void {
  run.crumbs = w.crumbs;
  run.near = w.nearMisses;
  run.combo = w.maxCombo;
  run.dist = Math.floor(w.distance / UNITS_PER_METER);
  run.score = Math.floor(w.score);
  run.time = w.time;
}

/** The recorded summary is the authority for the numbers it carries. */
export function readSummary(s: RunSummary): void {
  run.mode = s.mode;
  run.crumbs = s.crumbs;
  run.near = s.nearMisses;
  run.combo = s.maxCombo;
  run.dist = s.distanceM;
  run.score = s.score;
  run.time = s.timeS;
}

export function zoneKinds(mask: number): number {
  return ((mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1) + ((mask >> 3) & 1));
}

export type Stat =
  | 'crumbs' | 'near' | 'combo' | 'dist' | 'kinds' | 'marsh' | 'rapids' | 'night'
  | 'trails' | 'powers' | 'shield' | 'clean' | 'daily' | 'runs' | 'score';

/** What the current run adds to a stat. */
export function statValue(stat: Stat, r: RunStats): number {
  switch (stat) {
    case 'crumbs': return r.crumbs;
    case 'near': return r.near;
    case 'combo': return r.combo;
    case 'dist': return r.dist;
    case 'kinds': return zoneKinds(r.zoneMask);
    case 'marsh': return r.zoneMask & ZONE_BIT.marsh ? 1 : 0;
    case 'rapids': return r.zoneMask & ZONE_BIT.rapids ? 1 : 0;
    case 'night': return r.zoneMask & ZONE_BIT.night ? 1 : 0;
    case 'trails': return r.trails;
    case 'powers': return r.powers;
    case 'shield': return r.shield;
    case 'clean': return Math.floor(Math.max(r.bestClean, r.time - r.lastHitT));
    case 'daily': return r.mode === 'daily' ? 1 : 0;
    case 'runs': return 1;
    case 'score': return r.score;
  }
}

export interface MissionDef {
  /** Template id; unique among a day's three, so progress can be keyed by it. */
  id: string;
  tier: MissionTier;
  text: string;
  target: number;
  reward: number;
  stat: Stat;
  /** true = running total across today's runs; false = best single run today. */
  today: boolean;
  /** Only known when the run ends (game-over based), so no in-run pill. */
  finishOnly: boolean;
}

interface Template {
  id: string;
  stat: Stat;
  today: boolean;
  /** Targets by tier; a tier that is missing never gets this template. */
  targets: Partial<Record<MissionTier, number>>;
  text: (n: number) => string;
  finishOnly?: boolean;
}

const three = (easy: number, medium: number, hard: number) => ({ easy, medium, hard });
const fmt = (n: number): string => String(n).replace(/\B(?=(\d{3})+$)/g, ',');
const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

const TEMPLATES: readonly Template[] = [
  { id: 'crumbs-run', stat: 'crumbs', today: false, targets: three(15, 30, 50), text: (n) => `Collect ${n} crumbs in one run` },
  { id: 'near-run', stat: 'near', today: false, targets: three(10, 25, 40), text: (n) => `Make ${n} near-misses in one run` },
  { id: 'chain-run', stat: 'combo', today: false, targets: three(4, 8, 12), text: (n) => `Reach a ×${n} chain` },
  { id: 'dist-run', stat: 'dist', today: false, targets: three(300, 600, 1000), text: (n) => `Travel ${fmt(n)} m in one run` },
  { id: 'zones-run', stat: 'kinds', today: false, targets: three(2, 3, 4), text: (n) => `Reach ${n} different zones in one run` },
  { id: 'zone-marsh', stat: 'marsh', today: false, targets: { easy: 1 }, text: () => `Enter the ${ZONES.marsh.name}` },
  { id: 'zone-rapids', stat: 'rapids', today: false, targets: { medium: 1 }, text: () => `Enter the ${ZONES.rapids.name}` },
  { id: 'zone-night', stat: 'night', today: false, targets: { hard: 1 }, text: () => `Enter the ${ZONES.night.name}` },
  { id: 'trails-day', stat: 'trails', today: true, targets: three(1, 3, 5), text: (n) => `Finish ${n} Perfect crumb ${plural(n, 'trail', 'trails')} today` },
  { id: 'power-day', stat: 'powers', today: true, targets: three(2, 4, 6), text: (n) => `Use ${n} power-ups today` },
  { id: 'shield-run', stat: 'shield', today: false, targets: { medium: 1 }, text: () => 'Block a hit with the mushroom cap' },
  { id: 'clean-run', stat: 'clean', today: false, targets: three(30, 60, 90), text: (n) => `Survive ${n} s without a hit` },
  { id: 'daily-play', stat: 'daily', today: true, targets: { easy: 1 }, text: () => "Play today's Daily River", finishOnly: true },
  { id: 'runs-day', stat: 'runs', today: true, targets: three(3, 5, 8), text: (n) => `Finish ${n} runs today`, finishOnly: true },
  { id: 'score-run', stat: 'score', today: false, targets: three(500, 1500, 3000), text: (n) => `Score ${fmt(n)} in one run` },
  { id: 'crumbs-day', stat: 'crumbs', today: true, targets: three(40, 80, 150), text: (n) => `Collect ${n} crumbs today` },
];

const TIERS: readonly MissionTier[] = ['easy', 'medium', 'hard'];
const REWARD: Record<MissionTier, number> = { easy: 30, medium: 60, hard: 100 };
const POOLS: Record<MissionTier, readonly Template[]> = {
  easy: TEMPLATES.filter((t) => t.targets.easy !== undefined),
  medium: TEMPLATES.filter((t) => t.targets.medium !== undefined),
  hard: TEMPLATES.filter((t) => t.targets.hard !== undefined),
};

function mix(h: number, i: number): number {
  let x = Math.imul(h ^ Math.imul(i + 1, 0x9e3779b1), 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return x >>> 0;
}

let cachedDay = '';
let cachedDefs: readonly MissionDef[] = [];

/** The day's three missions (easy, medium, hard): a pure function of the date id. */
export function missionsFor(dayId: string): readonly MissionDef[] {
  if (dayId === cachedDay) return cachedDefs;
  const h = hashString('missions-' + dayId);
  const used: string[] = [];
  const defs = TIERS.map((tier, i): MissionDef => {
    const pool = POOLS[tier];
    let k = mix(h, i);
    while (used.includes(pool[k % pool.length].id)) k++;
    const t = pool[k % pool.length];
    used.push(t.id);
    const target = t.targets[tier] as number;
    return { id: t.id, tier, text: t.text(target), target, reward: REWARD[tier], stat: t.stat, today: t.today, finishOnly: !!t.finishOnly };
  });
  cachedDay = dayId;
  cachedDefs = defs;
  return defs;
}

export function missionView(d: MissionDef, progress: number, done: boolean): MissionView {
  return { id: d.id, tier: d.tier, text: d.text, target: d.target, progress: done ? d.target : Math.min(progress, d.target), done, reward: d.reward };
}
