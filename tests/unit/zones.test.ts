// River zones: the timeline, what each zone does to the course (lily pads,
// Rapids density, speed, width), and that none of it costs the Daily River its
// determinism or the hazards their fairness.

import { describe, expect, it } from 'vitest';
import { LEAF_HIT_R, SIM_DT, SPAWN_AHEAD, UNITS_PER_METER, WORLD_W } from '../../src/config';
import { timeAtDistance, timeAtDistanceOnRiver, difficultyAt, levelAt, scrollAtLevel } from '../../src/game/difficulty';
import { expectedTravel } from '../../src/game/fairness';
import { layoutObstacles, maxTwigLen, PAD_BUMP_COOLDOWN, PAD_DENSITY, PAD_PUSH_MAX, PAD_R_MAX, PAD_R_MIN } from '../../src/game/obstacles';
import { riverEdgesAt } from '../../src/game/river';
import { simState } from '../../src/game/state';
import { BANK_MARGIN, KEY_SPEED, OBSTACLE_PASS, TWIG_LEN_MAX } from '../../src/game/tuning';
import { createWorld, stepWorld, summarize } from '../../src/game/world';
import {
  BLEND_M,
  createZoneMods,
  createZoneSample,
  FIRST_ZONE_M,
  modsFor,
  SEG_MAX_M,
  SEG_MIN_M,
  ZONES,
  zoneAt,
  zoneModsAt,
  type ZoneMods,
} from '../../src/game/zones';
import type { GameEvent, InputFrame, Obstacle, World, ZoneId } from '../../src/types';
import { createDodgeBot, median } from './helpers/sim';

const U = UNITS_PER_METER;
const NONE: InputFrame = { steerDelta: 0, axis: 0, absoluteX: null };
const SEEDS = [1, 2026, 777, 31337, 99, 4242, 8, 12345];
const sample = createZoneSample();
const ZONE_IDS = Object.keys(ZONES) as ZoneId[];

// --- Helpers -------------------------------------------------------------------

/** Distance (units) where segment `index` begins; zones are monotone in distance, so bisect. */
function segmentStart(seed: number, index: number): number {
  let lo = 0;
  let hi = 4_000_000;
  for (let k = 0; k < 64; k++) {
    const mid = (lo + hi) / 2;
    if (zoneAt(seed, mid, sample).index >= index) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** The zone a segment settles into once its blend is over. */
function segmentZone(seed: number, index: number): ZoneId {
  return zoneAt(seed, segmentStart(seed, index) + BLEND_M * U + 1, sample).zone;
}

/** The first segment of `zone` after the opening Jungle: where it starts and ends, and a point well inside it. */
function firstSegmentOf(seed: number, zone: ZoneId): { start: number; mid: number; end: number } {
  for (let i = 1; i < 12; i++) {
    if (segmentZone(seed, i) !== zone) continue;
    const start = segmentStart(seed, i);
    const end = segmentStart(seed, i + 1);
    return { start, mid: (start + BLEND_M * U + end) / 2, end };
  }
  throw new Error(`no ${zone} segment for seed ${seed}`);
}

/** Zone name for a layout decision: the blend's first half still belongs to the zone being left. */
function zoneOfLayout(seed: number, d: number): ZoneId {
  zoneAt(seed, d, sample);
  return sample.blend < 0.5 ? sample.zone : sample.next;
}

function newRun(seed: number, extra: Partial<Parameters<typeof createWorld>[0]> = {}): World {
  return createWorld({ mode: 'endless', seed, dailyId: null, bestDistance: 0, viewH: 800, ...extra });
}

/** A run whose leaf is already at river distance `d` (units), hazards cleared, ready for a controlled scene. */
function placeAt(seed: number, d: number): World {
  const w = newRun(seed);
  w.player.hearts = 1e9;
  w.distance = d;
  w.time = 60;
  stepWorld(w, NONE, SIM_DT);
  w.drops.length = 0;
  w.obstacles.length = 0;
  w.events.length = 0;
  return w;
}

function pad(w: World, x: number, y: number, r = 24): Obstacle {
  const o: Obstacle = { id: w.nextId++, kind: 'pad', x, y, r, len: 0, angle: 0, spin: 0.1, vx: 0, variant: 0.5, hit: false };
  w.obstacles.push(o);
  return o;
}

/** Steps `steps`, keeping the scene free of drops; returns events and the leaf's x after every step. */
function runScene(w: World, steps: number, input: InputFrame | ((i: number) => InputFrame) = NONE): { events: GameEvent[]; xs: number[]; times: number[] } {
  const events: GameEvent[] = [];
  const xs: number[] = [];
  const times: number[] = [];
  for (let i = 0; i < steps; i++) {
    w.drops.length = 0;
    stepWorld(w, typeof input === 'function' ? input(i) : input, SIM_DT);
    for (const e of w.events) {
      events.push(e);
      if (e.type === 'pad-bump') times.push(w.time);
    }
    w.events.length = 0;
    xs.push(w.player.x);
  }
  return { events, xs, times };
}

/** Scripted input that weaves the leaf about and uses every device path now and then. */
function scripted(i: number): InputFrame {
  const t = i * SIM_DT;
  return {
    steerDelta: i % 7 === 0 ? Math.sin(t * 1.3) * 6 : 0,
    axis: Math.sin(t * 0.8) > 0.6 ? 1 : Math.sin(t * 0.8) < -0.6 ? -1 : 0,
    absoluteX: Math.floor(t / 10) % 3 === 2 ? 200 + Math.sin(t * 2.1) * 120 : null,
  };
}

// --- Timeline --------------------------------------------------------------------

describe('zone timeline', () => {
  it('is a pure function of the seed, whatever order it is asked in', () => {
    const probe = [0, 5_999, 6_000, 6_001, 20_000, 123_456, 480_000, 3_000];
    const read = (seed: number, order: number[]) => {
      // Fresh timeline each time: churn through more seeds than the cache holds first.
      for (let s = 100; s < 125; s++) zoneAt(s, 1_000, createZoneSample());
      const out = new Map<number, (string | number)[]>();
      for (const i of order) {
        const s = zoneAt(seed, probe[i], createZoneSample());
        out.set(i, [s.zone, s.next, Math.round(s.blend * 1e9), s.index]);
      }
      return probe.map((_, i) => out.get(i));
    };
    const forward = read(2026, [0, 1, 2, 3, 4, 5, 6, 7]);
    const backward = read(2026, [7, 6, 5, 4, 3, 2, 1, 0]);
    expect(backward).toEqual(forward);
    // Far end first, in one jump.
    expect(read(2026, [6, 0, 3, 1, 5, 2, 4, 7])).toEqual(forward);
    expect(forward[6]?.[3]).toBeGreaterThan(30);
    expect(read(2027, [0, 1, 2, 3, 4, 5, 6, 7])).not.toEqual(forward);
  });

  it('starts every river with FIRST_ZONE_M of plain Jungle', () => {
    for (const seed of [...SEEDS, 5, 6, 7, 20261021]) {
      for (let d = 0; d < FIRST_ZONE_M * U; d += 25) {
        zoneAt(seed, d, sample);
        expect([sample.zone, sample.next, sample.blend, sample.index]).toEqual(['jungle', 'jungle', 0, 0]);
      }
      expect(zoneAt(seed, FIRST_ZONE_M * U + 1, sample).index).toBe(1);
    }
  });

  it('draws 150–220 m segments that never repeat a zone back to back (50 segments, several seeds)', () => {
    for (const seed of SEEDS) {
      let prev = 'jungle' as ZoneId;
      let start = segmentStart(seed, 1);
      expect(start).toBeCloseTo(FIRST_ZONE_M * U, 6);
      for (let i = 1; i <= 50; i++) {
        const zone = segmentZone(seed, i);
        expect(zone, `seed ${seed} segment ${i}`).not.toBe(prev);
        const end = segmentStart(seed, i + 1);
        expect((end - start) / U, `seed ${seed} segment ${i} length`).toBeGreaterThanOrEqual(SEG_MIN_M - 1e-6);
        expect((end - start) / U).toBeLessThanOrEqual(SEG_MAX_M + 1e-6);
        prev = zone;
        start = end;
      }
    }
  });

  it('shows all four zones within the first five segments (one full bag after the opening Jungle)', () => {
    for (const seed of [...SEEDS, 1, 2, 3, 4, 5, 6, 7, 20261021]) {
      const seen = new Set<ZoneId>();
      for (let i = 1; i <= 4; i++) seen.add(segmentZone(seed, i));
      expect([...seen].sort()).toEqual([...ZONE_IDS].sort());
    }
  });
});

describe('zone blends', () => {
  const fields: (keyof ZoneMods)[] = ['width', 'scroll', 'rain', 'rocks', 'crumbs', 'powers', 'darkness'];

  it('every effect moves continuously across a boundary, at most the full jump spread over BLEND_M', () => {
    const mods = createZoneMods();
    const prev = createZoneMods();
    const blendLen = BLEND_M * U;
    const step = 0.5;
    let worst = 0;
    let checked = 0;
    for (const seed of SEEDS.slice(0, 4)) {
      for (let i = 1; i <= 6; i++) {
        const b = segmentStart(seed, i);
        const from = ZONES[segmentZone(seed, i - 1)];
        const to = ZONES[segmentZone(seed, i)];
        // The start of the boundary equals the zone being left; the end of the blend equals the one entered.
        zoneModsAt(seed, b, mods);
        for (const f of fields) expect(mods[f] as number, `${f} at start`).toBeCloseTo(from[f] as number, 6);
        zoneModsAt(seed, b + blendLen, mods);
        for (const f of fields) expect(mods[f] as number, `${f} at end`).toBeCloseTo(to[f] as number, 6);
        // And never a step bigger than the straight ramp allows (or any step at all outside the blend).
        zoneModsAt(seed, b - 5, prev);
        for (let d = b - 5 + step; d <= b + blendLen + 5; d += step) {
          zoneModsAt(seed, d, mods);
          for (const f of fields) {
            const spread = Math.abs((from[f] as number) - (to[f] as number));
            const over = Math.abs((mods[f] as number) - (prev[f] as number)) - ((spread / blendLen) * step * 1.0001 + 1e-9);
            if (over > worst) worst = over;
            prev[f] = mods[f] as never;
          }
          checked++;
        }
      }
    }
    expect(worst).toBe(0);
    expect(checked).toBeGreaterThan(20_000);
  });

  it('the pad switch happens once, at the blend midpoint', () => {
    const seed = 2026;
    const marsh = firstSegmentOf(seed, 'marsh');
    const mods = createZoneMods();
    const prevZone = zoneAt(seed, marsh.start - 1, sample).zone;
    expect(ZONES[prevZone].pads).toBe(false);
    expect(zoneModsAt(seed, marsh.start + 0.49 * BLEND_M * U, mods).pads).toBe(false);
    expect(zoneModsAt(seed, marsh.start + 0.51 * BLEND_M * U, mods).pads).toBe(true);
    expect(zoneModsAt(seed, marsh.mid, mods).pads).toBe(true);
    // modsFor agrees with zoneModsAt for a hand-made sample.
    sample.zone = 'jungle';
    sample.next = 'rapids';
    sample.blend = 0.5;
    expect(modsFor(sample, mods).rocks).toBeCloseTo((1 + ZONES.rapids.rocks) / 2, 9);
  });

  it('Night plays the Jungle layout: same width, speed, density and obstacle kinds', () => {
    for (const f of ['width', 'scroll', 'rocks', 'pads'] as const) expect(ZONES.night[f]).toBe(ZONES.jungle[f]);
    expect(ZONES.night.darkness).toBe(1);
    expect(ZONES.marsh.pads).toBe(true);
    expect(ZONES.rapids.rocks).toBeGreaterThan(1);
  });

  it('ignores nonsense distances instead of hanging', () => {
    expect(zoneAt(1, NaN, sample).index).toBe(0);
    expect(zoneAt(1, -5, sample).index).toBe(0);
    expect(zoneAt(1, Infinity, sample).index).toBeGreaterThan(100);
  });
});

describe('river width across zones', () => {
  it('edges stay continuous and the river keeps a usable width through every transition', () => {
    let widest = 0;
    let narrowest = Infinity;
    let biggestStep = 0;
    let outside = 0;
    for (const seed of SEEDS.slice(0, 4)) {
      let prev = riverEdgesAt(seed, 0);
      for (let d = 1; d <= 90_000; d += 1) {
        const e = riverEdgesAt(seed, d);
        // No jump bigger than the bendiest part of Phase 1's river.
        biggestStep = Math.max(biggestStep, Math.abs(e.left - prev.left), Math.abs(e.right - prev.right));
        if (e.left < 6 || e.right > WORLD_W - 6) outside++;
        const width = e.right - e.left;
        widest = Math.max(widest, width);
        narrowest = Math.min(narrowest, width);
        prev = e;
      }
    }
    expect(biggestStep).toBeLessThan(0.5);
    expect(outside).toBe(0);
    // Rapids at their tightest still leave room for the leaf plus a lane (the layout rules need 2 x BANK_MARGIN + leaf + lane).
    expect(narrowest).toBeGreaterThan(175);
    expect(narrowest).toBeGreaterThan(2 * BANK_MARGIN + 2 * LEAF_HIT_R + OBSTACLE_PASS);
    expect(widest).toBeLessThanOrEqual(WORLD_W - 12);
  });

  it('Marsh is wider and Rapids narrower than Jungle at the same stretch of river', () => {
    const mean: Record<ZoneId, number[]> = { jungle: [], marsh: [], rapids: [], night: [] };
    for (let seed = 1; seed <= 60; seed++) {
      for (let d = 22_000; d < 40_000; d += 400) {
        zoneAt(seed, d, sample);
        if (sample.blend !== 0) continue;
        const e = riverEdgesAt(seed, d);
        mean[sample.zone].push(e.right - e.left);
      }
    }
    const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    expect(avg(mean.marsh) / avg(mean.jungle)).toBeGreaterThan(1.08);
    expect(avg(mean.rapids) / avg(mean.jungle)).toBeLessThan(0.92);
    expect(avg(mean.night) / avg(mean.jungle)).toBeGreaterThan(0.93);
    expect(avg(mean.night) / avg(mean.jungle)).toBeLessThan(1.07);
  });
});

// --- Course layout -----------------------------------------------------------------

interface Placed {
  o: Obstacle;
  /** River distance of the obstacle (units). */
  d: number;
  zone: ZoneId;
}

/** Lays out `lengthM` of river for a seed in one go (no stepping) and lists what was placed. */
function layCourse(seed: number, lengthM: number): { world: World; placed: Placed[] } {
  const w = newRun(seed);
  const st = simState(w);
  const placed: Placed[] = [];
  const seen = new Set<number>();
  for (let dist = 0; dist <= lengthM * U; dist += 300) {
    w.distance = dist;
    layoutObstacles(w, st);
    for (const o of w.obstacles) {
      if (seen.has(o.id)) continue;
      seen.add(o.id);
      const d = w.distance + (w.player.y - o.y);
      placed.push({ o, d, zone: zoneOfLayout(seed, d) });
    }
  }
  return { world: w, placed };
}

describe('obstacle layout per zone', () => {
  const courses = SEEDS.map((seed) => ({ seed, ...layCourse(seed, 2200) }));

  it('the opening 120 m is plain Jungle: rocks and twigs only', () => {
    let early = 0;
    for (const { placed } of courses) {
      for (const { o, d, zone } of placed) {
        if (d >= FIRST_ZONE_M * U) continue;
        early++;
        expect(zone).toBe('jungle');
        expect(o.kind).not.toBe('pad');
      }
    }
    expect(early).toBeGreaterThan(60);
  });

  it('lily pads replace rocks in Lily Marsh and only there; gates become pad gates', () => {
    let pads = 0;
    let rocks = 0;
    for (const { placed } of courses) {
      for (const { o, zone } of placed) {
        if (o.kind === 'pad') {
          pads++;
          expect(zone).toBe('marsh');
          expect(o.len).toBe(0);
          expect(o.r).toBeGreaterThanOrEqual(PAD_R_MIN);
          expect(o.r).toBeLessThanOrEqual(PAD_R_MAX);
        } else if (o.kind === 'rock') {
          rocks++;
          expect(zone).not.toBe('marsh');
        }
      }
    }
    expect(pads).toBeGreaterThan(100);
    expect(rocks).toBeGreaterThan(100);
  });

  it('every obstacle leaves a lane the leaf can use, in every zone, at the river width of its own distance', () => {
    const perZone: Record<ZoneId, number> = { jungle: 0, marsh: 0, rapids: 0, night: 0 };
    for (const { seed, placed } of courses) {
      // Group by row (gates put two on one row).
      const rows = new Map<number, Placed[]>();
      for (const p of placed) {
        const key = Math.round(p.d);
        const row = rows.get(key);
        if (row) row.push(p);
        else rows.set(key, [p]);
      }
      for (const row of rows.values()) {
        const d = row[0].d;
        const e = riverEdgesAt(seed, d);
        const lo = e.left + BANK_MARGIN;
        const hi = e.right - BANK_MARGIN;
        const blocks = row
          .map(({ o }) => {
            const rx = o.len + o.r + LEAF_HIT_R;
            return [o.x - rx, o.x + rx];
          })
          .sort((a, b) => a[0] - b[0]);
        let cursor = lo;
        let widest = 0;
        for (const [a, b] of blocks) {
          widest = Math.max(widest, Math.min(a, hi) - cursor);
          cursor = Math.max(cursor, b);
        }
        widest = Math.max(widest, hi - cursor);
        expect(widest, `seed ${seed} d ${d.toFixed(0)} ${row[0].zone}`).toBeGreaterThanOrEqual(OBSTACLE_PASS - 0.5);
        perZone[row[0].zone]++;
      }
    }
    for (const z of ZONE_IDS) expect(perZone[z], z).toBeGreaterThan(40);
  });

  it('keeps hazards a river-crossing apart at the zone speed: Rapids water is faster, so the gap grows with it', () => {
    let checked = 0;
    for (const { seed, placed } of courses) {
      const hard = placed.filter((p) => p.o.kind !== 'pad');
      // One entry per row.
      const rows: Placed[] = [];
      for (const p of hard) if (!rows.length || Math.abs(p.d - rows[rows.length - 1].d) > 1) rows.push(p);
      for (let i = 0; i + 1 < rows.length; i++) {
        const a = rows[i];
        const b = rows[i + 1];
        const e = riverEdgesAt(seed, a.d);
        const cross = (e.right - e.left - 2 * BANK_MARGIN) / KEY_SPEED;
        // Speed the leaf will have between the two (difficulty at the time it gets there, zone at the fastest point).
        const level = levelAt(timeAtDistanceOnRiver(seed, a.d));
        const zs = Math.max(zoneModsAt(seed, a.d, createZoneMods()).scroll, zoneModsAt(seed, b.d, createZoneMods()).scroll);
        const seconds = (b.d - a.d) / (scrollAtLevel(level) * zs);
        // The layout keeps 0.6 of the crossing time (measured at the level the run first sees the spot, a few seconds earlier).
        expect(seconds, `seed ${seed} d ${a.d.toFixed(0)} ${a.zone}`).toBeGreaterThanOrEqual(cross * 0.55);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(400);
  });

  it('Rapids pack obstacles tighter than the Jungle, Marsh packs pads tightest of all, Night matches the Jungle', () => {
    const gaps: Record<ZoneId, number[]> = { jungle: [], marsh: [], rapids: [], night: [] };
    for (const { seed, placed } of courses) {
      const ds = [...new Set(placed.map((p) => Math.round(p.d)))].sort((x, y) => x - y);
      for (let i = 0; i + 1 < ds.length; i++) {
        const z = zoneAt(seed, ds[i], sample).blend === 0 ? sample.zone : null;
        if (!z || zoneAt(seed, ds[i + 1], sample).blend !== 0 || sample.zone !== z) continue;
        // Normalised by the difficulty curve's own gap, so early and late river compare.
        const gap = difficultyAt(timeAtDistanceOnRiver(seed, ds[i] - SPAWN_AHEAD)).obstacleGap;
        gaps[z].push((ds[i + 1] - ds[i]) / gap);
      }
    }
    const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    for (const z of ZONE_IDS) expect(gaps[z].length, z).toBeGreaterThan(100);
    const jungle = avg(gaps.jungle);
    expect(jungle).toBeGreaterThan(0.9);
    expect(avg(gaps.night)).toBeGreaterThan(jungle * 0.93);
    expect(avg(gaps.night)).toBeLessThan(jungle * 1.07);
    // Spacing divides by the zone's density; the river-crossing floor keeps it from reaching the full ratio late in the run.
    expect(avg(gaps.rapids)).toBeLessThan(jungle / 1.25);
    expect(avg(gaps.rapids)).toBeGreaterThan(jungle / ZONES.rapids.rocks - 0.05);
    expect(avg(gaps.marsh)).toBeLessThan(jungle / (PAD_DENSITY * 0.9));
  });

  it('twigs get shorter where the river narrows (and never longer than the lane rule allows)', () => {
    let checked = 0;
    for (const { seed, placed } of courses) {
      for (const { o, d, zone } of placed) {
        if (o.kind !== 'twig') continue;
        const e = riverEdgesAt(seed, d);
        expect(o.len).toBeLessThanOrEqual(maxTwigLen(e.right - e.left) + 1e-9);
        // Shorter in proportion to how narrow the water is at that spot (blended across the transition).
        expect(o.len).toBeLessThanOrEqual(TWIG_LEN_MAX * Math.min(1, zoneModsAt(seed, d, createZoneMods()).width) + 1e-9);
        zoneAt(seed, d, sample);
        if (zone === 'rapids' && sample.blend === 0) {
          expect(o.len).toBeLessThanOrEqual(TWIG_LEN_MAX * ZONES.rapids.width + 1e-9);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('the course depends on the seed and distance only: identical for an idle leaf, a weaving one and a tall screen', () => {
    const seed = 20261021;
    const runs = [
      { input: () => NONE, viewH: 800 },
      { input: scripted, viewH: 800 },
      { input: scripted, viewH: 1400 },
    ].map(({ input, viewH }) => {
      const w = newRun(seed, { viewH, mode: 'daily', dailyId: '2026-10-21' });
      w.player.hearts = 1e9;
      // What lies 100-600 units ahead of the leaf at regular moments: seen by every screen height.
      const seen = new Set<string>();
      for (let i = 0; i < 260 / SIM_DT; i++) {
        stepWorld(w, input(i), SIM_DT);
        w.events.length = 0;
        if (i % 30 !== 0) continue;
        for (const o of w.obstacles) {
          const ahead = w.player.y - o.y;
          if (ahead < 100 || ahead > 600) continue;
          seen.add([o.kind, Math.round(o.x * 1e3), Math.round(w.distance + ahead), Math.round(o.r * 1e3)].join(':'));
        }
      }
      return seen;
    });
    expect(runs[0].size).toBeGreaterThan(200);
    expect([...runs[1]].sort()).toEqual([...runs[0]].sort());
    expect([...runs[2]].sort()).toEqual([...runs[0]].sort());
    const kinds = new Set([...runs[0]].map((v) => v.split(':')[0]));
    expect(kinds).toEqual(new Set(['rock', 'twig', 'pad']));
  });
});

// --- Lily pads -----------------------------------------------------------------------

describe('lily pads', () => {
  const seed = 2026;
  const marsh = firstSegmentOf(seed, 'marsh');

  it('shove the leaf aside smoothly, never hurt it, and bump once', () => {
    const w = placeAt(seed, marsh.mid);
    const p = w.player;
    const x0 = p.x;
    const hearts = p.hearts;
    const o = pad(w, x0 + 6, p.y - 160);
    const { events, xs } = runScene(w, 3 * 120);
    expect(events.filter((e) => e.type === 'hit')).toEqual([]);
    expect(p.hearts).toBe(hearts);
    expect(p.invuln).toBe(0);
    expect(events.filter((e) => e.type === 'pad-bump')).toHaveLength(1);
    // The pad sat 6 units right of the leaf's line, so the leaf is shoved left, well clear of it.
    expect(o.x - p.x).toBeGreaterThan(30);
    // Smooth: no step is larger than the capped shove, and the leaf never jumps.
    const deltas = xs.map((x, i) => Math.abs(x - (i ? xs[i - 1] : x0)));
    expect(Math.max(...deltas)).toBeLessThanOrEqual((PAD_PUSH_MAX * SIM_DT) + 1e-9);
    // The steering target went with the leaf, so it does not snap back.
    expect(Math.abs(p.targetX - p.x)).toBeLessThan(2);
    expect(o.hit).toBe(false);
  });

  it('shove away from the pad, whichever side the leaf is on; dead centre goes towards the roomier bank', () => {
    // Pad just right of the leaf: leaf goes left. Pad just left: leaf goes right.
    const a = placeAt(seed, marsh.mid);
    const xa = a.player.x;
    pad(a, xa + 12, a.player.y - 160);
    runScene(a, 3 * 120);
    expect(a.player.x).toBeLessThan(xa - 20);
    const b = placeAt(seed, marsh.mid);
    const xb = b.player.x;
    pad(b, xb - 12, b.player.y - 160);
    runScene(b, 3 * 120);
    expect(b.player.x).toBeGreaterThan(xb + 20);

    // Exactly on the leaf's line: whichever bank is further from the pad's middle.
    for (const offset of [-60, 60]) {
      const c = placeAt(seed, marsh.mid);
      const e = riverEdgesAt(seed, c.distance);
      const o = pad(c, c.player.x + offset, c.player.y - 160);
      c.player.x = c.player.targetX = o.x;
      const roomRight = e.right - BANK_MARGIN - o.x;
      const roomLeft = o.x - (e.left + BANK_MARGIN);
      runScene(c, 3 * 120);
      expect(Math.sign(c.player.x - o.x), `offset ${offset}`).toBe(roomRight >= roomLeft ? 1 : -1);
    }
  });

  it('never wall the way: steering through one still gets across, only slower', () => {
    const w = placeAt(seed, marsh.mid);
    const p = w.player;
    const o = pad(w, p.x + 40, p.y - 160);
    const crossing = (i: number): InputFrame => ({ steerDelta: 0, axis: 0, absoluteX: o.x + 90 + i * 0 });
    const { events } = runScene(w, 3 * 120, crossing);
    expect(events.filter((e) => e.type === 'hit')).toEqual([]);
    expect(p.x).toBeGreaterThan(o.x + 50);
  });

  it('stay inside the river when they shove, even against a bank', () => {
    const w = placeAt(seed, marsh.mid);
    const e = riverEdgesAt(seed, w.distance);
    const lo = e.left + BANK_MARGIN;
    w.player.x = w.player.targetX = lo + 3;
    pad(w, w.player.x + 4, w.player.y - 160);
    const { xs } = runScene(w, 3 * 120);
    for (const x of xs) {
      const edges = riverEdgesAt(seed, w.distance);
      expect(x).toBeGreaterThanOrEqual(edges.left + BANK_MARGIN - 1e-6);
      expect(x).toBeLessThanOrEqual(edges.right - BANK_MARGIN + 1e-6);
    }
  });

  it('bump at most once per cooldown however many pads the leaf rides over', () => {
    const w = placeAt(seed, marsh.mid);
    const p = w.player;
    // A dense raft of pads, each overlapping the leaf's path.
    for (let i = 0; i < 6; i++) pad(w, p.x + (i % 2 ? 10 : -10), p.y - 150 - i * 45, 22);
    const { events, times } = runScene(w, 6 * 120);
    expect(events.filter((e) => e.type === 'hit')).toEqual([]);
    expect(times.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(PAD_BUMP_COOLDOWN - SIM_DT);
  });

  it('do nothing in a finished run, and rocks still hurt as before', () => {
    const w = placeAt(seed, marsh.mid);
    const p = w.player;
    w.state = 'over';
    pad(w, p.x, p.y);
    const x0 = p.x;
    for (let i = 0; i < 60; i++) stepWorld(w, NONE, SIM_DT);
    expect(w.events.filter((e) => e.type === 'pad-bump')).toEqual([]);
    expect(Math.abs(p.x - x0)).toBeLessThan(5);

    const hurt = placeAt(seed, marsh.mid);
    hurt.player.hearts = 3;
    hurt.obstacles.push({ id: hurt.nextId++, kind: 'rock', x: hurt.player.x, y: hurt.player.y - 100, r: 22, len: 0, angle: 0, spin: 0, vx: 0, variant: 0, hit: false });
    const { events } = runScene(hurt, 2 * 120);
    expect(events.some((e) => e.type === 'hit' && e.source === 'rock')).toBe(true);
    expect(hurt.player.hearts).toBe(2);
  });

  it('never cost a heart across a whole Marsh, even for a leaf that ignores them (and it does get bumped)', () => {
    // The dodging bot with the pads hidden from it: it rides over them like a person who stopped caring.
    const w = placeAt(seed, marsh.start + BLEND_M * U);
    w.player.hearts = 3;
    const bot = createDodgeBot();
    const until = marsh.end - 2 * U;
    let bumps = 0;
    let hits = 0;
    const hitSources: string[] = [];
    while (w.distance < until && w.state === 'running') {
      const view = { ...w, obstacles: w.obstacles.filter((o) => o.kind !== 'pad') } as World;
      w.drops.length = 0;
      stepWorld(w, bot(view), SIM_DT);
      for (const e of w.events) {
        if (e.type === 'pad-bump') bumps++;
        if (e.type === 'hit') {
          hits++;
          hitSources.push(e.source);
        }
      }
      w.events.length = 0;
    }
    expect(w.distance).toBeGreaterThanOrEqual(until);
    // The only things that can hurt in the Marsh proper are twigs; the pads themselves cost nothing.
    expect(hitSources.filter((s) => s !== 'twig')).toEqual([]);
    expect(w.player.hearts).toBe(3 - hits);
    expect(bumps).toBeGreaterThan(0);
  });
});

// --- World integration -----------------------------------------------------------------

describe('zones in a running world', () => {
  it('emits exactly one zone event per new segment, in order, as the leaf reaches it', () => {
    const seed = 777;
    const w = newRun(seed);
    w.player.hearts = 1e9;
    const zoneEvents: { zone: ZoneId; distance: number }[] = [];
    for (let i = 0; i < 330 / SIM_DT; i++) {
      stepWorld(w, scripted(i), SIM_DT);
      for (const e of w.events) if (e.type === 'zone') zoneEvents.push({ zone: e.zone, distance: w.distance });
      w.events.length = 0;
    }
    const last = zoneAt(seed, w.distance, sample).index;
    expect(last).toBeGreaterThanOrEqual(4);
    expect(zoneEvents).toHaveLength(last);
    expect(w.zonesReached).toBe(1 + last);
    zoneEvents.forEach((ev, k) => {
      expect(ev.zone).toBe(segmentZone(seed, k + 1));
      // Fired on the step the leaf crossed the boundary (one step is a few units of river).
      const start = segmentStart(seed, k + 1);
      expect(ev.distance).toBeGreaterThanOrEqual(start);
      expect(ev.distance - start).toBeLessThan(5);
    });
    expect(summarize(w).zonesReached).toBe(w.zonesReached);
  });

  it('stays silent on the menu backdrop even though the river scrolls through zones', () => {
    const w = newRun(777, { attract: true });
    const zoneEvents: GameEvent[] = [];
    for (let i = 0; i < 700 / SIM_DT; i++) {
      stepWorld(w, NONE, SIM_DT);
      for (const e of w.events) if (e.type === 'zone') zoneEvents.push(e);
      w.events.length = 0;
    }
    expect(w.state).toBe('attract');
    expect(w.distance).toBeGreaterThan((FIRST_ZONE_M + SEG_MAX_M * 2) * U);
    expect(zoneEvents).toEqual([]);
    expect(w.obstacles).toEqual([]);
  });

  it('the river is faster in the Rapids and slower in the Marsh at the same moment of the run', () => {
    const seed = 2026;
    const speedIn = (zone: ZoneId): { speed: number; base: number } => {
      const { mid } = firstSegmentOf(seed, zone);
      const w = newRun(seed);
      w.player.hearts = 1e9;
      w.distance = mid;
      w.time = 75;
      stepWorld(w, NONE, SIM_DT);
      return { speed: w.scrollSpeed, base: difficultyAt(w.time).scroll };
    };
    const jungle = speedIn('jungle');
    expect(jungle.speed).toBeCloseTo(jungle.base, 6);
    const night = speedIn('night');
    expect(night.speed).toBeCloseTo(night.base, 6);
    const rapids = speedIn('rapids');
    expect(rapids.speed).toBeGreaterThan(jungle.speed * 1.25);
    expect(rapids.speed).toBeCloseTo(rapids.base * ZONES.rapids.scroll, 6);
    const marsh = speedIn('marsh');
    expect(marsh.speed).toBeCloseTo(marsh.base * ZONES.marsh.scroll, 6);
    expect(marsh.speed).toBeLessThan(jungle.speed);
  });

  it('through a whole run the speed is difficulty times the zone it is in, and rapids really go faster', () => {
    const w = newRun(31337);
    w.player.hearts = 1e9;
    const seenSpeed: Record<ZoneId, number> = { jungle: 0, marsh: 0, rapids: 0, night: 0 };
    for (let i = 0; i < 280 / SIM_DT; i++) {
      stepWorld(w, scripted(i), SIM_DT);
      w.events.length = 0;
      if (w.zoneBlend !== 0) continue;
      const ratio = w.scrollSpeed / difficultyAt(w.time).scroll;
      expect(ratio).toBeCloseTo(ZONES[w.zone].scroll, 3);
      seenSpeed[w.zone] = w.scrollSpeed;
    }
    expect(seenSpeed.rapids).toBeGreaterThan(0);
    expect(seenSpeed.marsh).toBeGreaterThan(0);
  });

  it('travel prediction matches what the sim does at a zone transition', () => {
    const seed = 2026;
    const rapids = firstSegmentOf(seed, 'rapids');
    for (const lead of [800, 300, 0, -250]) {
      const w = placeAt(seed, rapids.start - lead);
      const predicted = expectedTravel(w, 1.5);
      const d0 = w.distance;
      for (let i = 0; i < 1.5 / SIM_DT; i++) {
        w.drops.length = 0;
        stepWorld(w, NONE, SIM_DT);
        w.events.length = 0;
      }
      const actual = w.distance - d0;
      expect(Math.abs(predicted - actual) / actual, `lead ${lead}`).toBeLessThan(0.02);
    }
    // And a plain stretch is exactly speed times time.
    const calm = placeAt(seed, firstSegmentOf(seed, 'night').mid);
    expect(expectedTravel(calm, 2)).toBeCloseTo(calm.scrollSpeed * 2, 6);
    expect(expectedTravel(calm, 0)).toBe(0);
  });

  it('the density clock follows the zones: it knows Rapids are quicker', () => {
    const seed = 2026;
    const w = newRun(seed);
    w.player.hearts = 1e9;
    const marks = [8_000, 20_000, 40_000, 60_000];
    const at: number[] = [];
    let k = 0;
    let prev = 0;
    for (let i = 0; i < 400 / SIM_DT && k < marks.length; i++) {
      stepWorld(w, scripted(i), SIM_DT);
      w.events.length = 0;
      while (k < marks.length && w.distance >= marks[k]) {
        // Linear interpolation inside the step.
        const f = (marks[k] - prev) / (w.distance - prev);
        at.push(w.time - SIM_DT * (1 - f));
        k++;
      }
      prev = w.distance;
    }
    expect(at).toHaveLength(marks.length);
    marks.forEach((d, i) => expect(Math.abs(timeAtDistanceOnRiver(seed, d) - at[i]), `${d}`).toBeLessThan(0.15));
    // Before the first change the zone-aware clock is the plain one.
    expect(Math.abs(timeAtDistanceOnRiver(seed, 5_900) - timeAtDistance(5_900))).toBeLessThan(0.05);
    // It differs once Marsh/Rapids have been crossed.
    expect(Math.abs(timeAtDistanceOnRiver(seed, 60_000) - timeAtDistance(60_000))).toBeGreaterThan(0.3);
    expect(timeAtDistanceOnRiver(seed, 0)).toBe(0);
    expect(timeAtDistanceOnRiver(seed, 5e8)).toBeGreaterThan(timeAtDistanceOnRiver(seed, 4e5));
  });
});

describe('rain across a change of river speed', () => {
  /** A boundary between Marsh and Rapids (the biggest speed step, x0.9 against x1.3) on some seed. */
  function speedStep(): { seed: number; start: number } {
    for (let seed = 1; seed < 80; seed++) {
      for (let i = 1; i < 10; i++) {
        const a = segmentZone(seed, i - 1);
        const b = segmentZone(seed, i);
        if ((a === 'marsh' && b === 'rapids') || (a === 'rapids' && b === 'marsh')) return { seed, start: segmentStart(seed, i) };
      }
    }
    throw new Error('no Marsh/Rapids boundary in the first 80 seeds');
  }

  it('aimed drops land on the leaf row they were placed for, even when the river speeds up or slows down under them', () => {
    // Aimed drops are meant to land within a few units of the leaf's row. A spawn that assumed today's speed
    // for its whole fall would land metres off if the speed changed on the way.
    const { seed, start } = speedStep();
    const w = placeAt(seed, start - 6 * U);
    const row = new Map<number, number>();
    let aimed = 0;
    for (let i = 0; i < 14 / SIM_DT; i++) {
      stepWorld(w, NONE, SIM_DT);
      w.player.invuln = 60;
      for (const d of w.drops) if (d.aimed) row.set(d.id, d.y - w.player.y);
      w.events.length = 0;
    }
    for (const v of row.values()) {
      aimed++;
      // +-6 is the aim spread; the rest is one step of drift and rounding.
      expect(Math.abs(v)).toBeLessThan(9.5);
    }
    expect(aimed).toBeGreaterThan(4);
    expect(zoneAt(seed, w.distance, sample).index).toBeGreaterThan(zoneAt(seed, start - 6 * U, sample).index);
  });
});

describe('determinism with zones', () => {
  const fingerprint = (w: World) => {
    const r = (v: number) => Math.round(v * 1e6) / 1e6;
    return {
      state: w.state,
      zone: [w.zone, w.nextZone, r(w.zoneBlend), w.zonesReached],
      score: r(w.score),
      distance: r(w.distance),
      x: r(w.player.x),
      hearts: w.player.hearts,
      darkness: r(w.darkness),
      obstacles: w.obstacles.map((o) => [o.id, o.kind, r(o.x), r(o.y - w.player.y), r(o.angle), o.r, o.hit]),
      drops: w.drops.map((d) => [d.id, r(d.x), r(d.y - w.player.y), r(d.age), d.fall, d.r]),
    };
  };

  it('Daily River: same seed + same inputs → identical obstacles, zones, leaf and score after 300 s', () => {
    const make = () => newRun(20261021, { mode: 'daily', dailyId: '2026-10-21' });
    const a = make();
    const b = make();
    a.player.hearts = b.player.hearts = 1e9;
    const zones: ZoneId[] = [];
    for (let i = 0; i < 300 / SIM_DT; i++) {
      stepWorld(a, scripted(i), SIM_DT);
      stepWorld(b, scripted(i), SIM_DT);
      if (i % 600 === 0) zones.push(a.zone);
      a.events.length = b.events.length = 0;
    }
    expect(fingerprint(a)).toEqual(fingerprint(b));
    expect(a.rng.next()).toBe(b.rng.next());
    // The run really crossed zones (and pads exist in the Marsh part).
    expect(a.zonesReached).toBeGreaterThanOrEqual(4);
    expect(new Set(zones).size).toBeGreaterThanOrEqual(3);
    const other = newRun(20261022, { mode: 'daily', dailyId: '2026-10-22' });
    other.player.hearts = 1e9;
    for (let i = 0; i < 300 / SIM_DT; i++) {
      stepWorld(other, scripted(i), SIM_DT);
      other.events.length = 0;
    }
    expect(fingerprint(other)).not.toEqual(fingerprint(a));
  });

  it('a different player cannot shift the course or the drop stream, pads or not', () => {
    const idle = newRun(4242);
    const bot = newRun(4242);
    idle.player.hearts = bot.player.hearts = 1e9;
    const botCtl = createDodgeBot();
    for (let i = 0; i < 260 / SIM_DT; i++) {
      stepWorld(idle, NONE, SIM_DT);
      stepWorld(bot, botCtl(bot), SIM_DT);
      idle.events.length = bot.events.length = 0;
    }
    expect(idle.rng.next()).toBe(bot.rng.next());
    expect(idle.distance).toBe(bot.distance);
    // Ids are shared with drops (whose fair placement depends on the player), so compare what the obstacles are and where.
    const course = (w: World) => w.obstacles.map((o) => [o.kind, o.x, o.y, o.r, o.angle]);
    expect(course(idle)).toEqual(course(bot));
  });

  it('tall and short screens see the same river, pads included', () => {
    const short = newRun(2026, { viewH: 740 });
    const tall = newRun(2026, { viewH: 1400 });
    short.player.hearts = tall.player.hearts = 1e9;
    let pads = 0;
    for (let i = 0; i < 240 / SIM_DT; i++) {
      stepWorld(short, scripted(i), SIM_DT);
      stepWorld(tall, scripted(i), SIM_DT);
      if (i % 120 === 0) pads += short.obstacles.filter((o) => o.kind === 'pad').length;
      short.events.length = tall.events.length = 0;
    }
    const rel = (w: World) => ({
      x: Math.round(w.player.x * 1e6),
      zone: [w.zone, w.nextZone, w.zonesReached],
      ahead: w.obstacles
        .filter((o) => o.y - w.player.y < 200 && w.player.y - o.y < 950)
        .map((o) => [o.kind, Math.round(o.x * 1e6), Math.round((o.y - w.player.y) * 1e6), Math.round(o.angle * 1e6)]),
      score: Math.round(w.score * 1e6),
    });
    expect(rel(tall)).toEqual(rel(short));
    expect(pads).toBeGreaterThan(0);
  });
});

// --- Balance (reported, with generous bounds) --------------------------------------------

describe('a dodging bot through the zones', () => {
  it('survives about as long as in Phase 1 and sees several zones, including every kind', () => {
    const seeds = Array.from({ length: 10 }, (_, i) => 1009 + i * 7919);
    const times: number[] = [];
    const zonesReached: number[] = [];
    const kinds = new Set<ZoneId>();
    for (const seed of seeds) {
      const w = newRun(seed);
      const bot = createDodgeBot();
      let diedAt = -1;
      while (w.state !== 'over' && w.time < 600) {
        stepWorld(w, bot(w), SIM_DT);
        kinds.add(w.zone);
        kinds.add(w.nextZone);
        for (const e of w.events) if (e.type === 'death') diedAt = w.time;
        w.events.length = 0;
      }
      times.push(diedAt >= 0 ? diedAt : w.time);
      zonesReached.push(w.zonesReached);
    }
    expect(median(times)).toBeGreaterThan(90);
    expect(median(times)).toBeLessThan(200);
    expect(median(zonesReached)).toBeGreaterThanOrEqual(3);
    expect([...kinds].sort()).toEqual([...ZONE_IDS].sort());
  });
});
