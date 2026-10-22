import { describe, expect, it } from 'vitest';
import { ANT_HIT_R, LEAF_HIT_R, MAX_HEARTS, SIM_DT, SPAWN_AHEAD, UNITS_PER_METER } from '../../src/config';
import { createRng } from '../../src/engine/rng';
import {
  CRUMB_COMBO_BONUS,
  CRUMB_POINTS,
  CRUMB_SPACING,
  MAGNET_RANGE,
  MAGNET_SPEED,
  PICKUP_R,
  TAKEN_LINGER,
  TRAIL_BONUS,
  TRAIL_MAX,
  layoutPickups,
  updatePickups,
} from '../../src/game/pickups';
import { activatePower } from '../../src/game/powers';
import { reachIn } from '../../src/game/player';
import { riverEdgesAt } from '../../src/game/river';
import { multiplierFor } from '../../src/game/scoring';
import { simState } from '../../src/game/state';
import { BANK_MARGIN, COMBO_TIME } from '../../src/game/tuning';
import { createZoneSample, zoneAt } from '../../src/game/zones';
import { createWorld, setViewHeight, stepWorld, summarize } from '../../src/game/world';
import type { GameEvent, InputFrame, Obstacle, Pickup, PickupKind, World } from '../../src/types';
import { createDodgeBot, idle, median } from './helpers/sim';

const NONE: InputFrame = { steerDelta: 0, axis: 0, absoluteX: null };
const U = UNITS_PER_METER;

function newRun(seed = 11, extra: Partial<Parameters<typeof createWorld>[0]> = {}): World {
  return createWorld({ mode: 'endless', seed, dailyId: null, bestDistance: 0, viewH: 800, ...extra });
}

/** Scripted input that exercises every device path (same idea as world.test.ts). */
function scripted(i: number): InputFrame {
  const t = i * SIM_DT;
  return {
    steerDelta: i % 7 === 0 ? Math.sin(t * 1.3) * 6 : 0,
    axis: Math.sin(t * 0.8) > 0.6 ? 1 : Math.sin(t * 0.8) < -0.6 ? -1 : 0,
    absoluteX: Math.floor(t / 10) % 3 === 2 ? 200 + Math.sin(t * 2.1) * 120 : null,
  };
}

/** River distance of a pickup / obstacle at its current row. */
const distOf = (w: World, y: number) => w.distance + (w.player.y - y);

/** Steps with drops and obstacles removed (pickups are left alone) so a test controls the hazards. */
function step(world: World, steps: number, input: InputFrame = NONE): GameEvent[] {
  const out: GameEvent[] = [];
  for (let i = 0; i < steps; i++) {
    stepWorld(world, input, SIM_DT);
    world.drops.length = 0;
    world.obstacles.length = 0;
    out.push(...world.events);
    world.events.length = 0;
  }
  return out;
}

/** Puts a plain pickup so that it sits at (leaf.x + dx, leaf.y + dy) after the next step's drift. */
function put(world: World, kind: PickupKind, dx: number, dy = 0, trail = 0): Pickup {
  const p = world.player;
  const k: Pickup = {
    id: world.nextId++,
    kind,
    x: p.x + dx,
    y: p.y + dy - world.scrollSpeed * SIM_DT,
    trail,
    taken: false,
    variant: 0.5,
  };
  world.pickups.push(k);
  return k;
}

const kindsOf = (events: GameEvent[]) => events.map((e) => e.type);

/** What a run laid out, in the order pickups first appeared: [kind, x, river distance]. */
interface Seen {
  id: number;
  kind: PickupKind;
  x: number;
  d: number;
  trail: number;
}

class Watch {
  seen: Seen[] = [];
  private ids = new Set<number>();
  look(w: World): void {
    for (const k of w.pickups) {
      if (this.ids.has(k.id)) continue;
      this.ids.add(k.id);
      this.seen.push({ id: k.id, kind: k.kind, x: k.x, d: distOf(w, k.y), trail: k.trail });
    }
  }
  get powers(): Seen[] {
    return this.seen.filter((s) => s.kind !== 'crumb');
  }
  get trailStarts(): number[] {
    const first = new Map<number, number>();
    for (const s of this.seen) if (s.kind === 'crumb' && !first.has(s.trail)) first.set(s.trail, s.d);
    return [...first.values()];
  }
}

/** Runs `ctl` for `seconds` on an immortal run, recording every pickup as it appears. */
function lay(world: World, seconds: number, ctl: (i: number, w: World) => InputFrame): Watch {
  world.player.hearts = 1e9;
  const watch = new Watch();
  const n = Math.round(seconds / SIM_DT);
  for (let i = 0; i < n; i++) {
    stepWorld(world, ctl(i, world), SIM_DT);
    world.events.length = 0;
    watch.look(world);
  }
  return watch;
}

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

function pickupPrint(w: World) {
  return {
    score: r6(w.score),
    crumbs: w.crumbs,
    combo: w.combo,
    hearts: w.player.hearts,
    powers: w.powers.map((p) => [p.kind, r6(p.left)]),
    pickups: w.pickups.map((k) => [k.id, k.kind, r6(k.x), r6(k.y - w.player.y), k.trail, k.taken]),
  };
}

/** A rock at (x, river distance d) for layout tests that call layoutPickups directly. */
function injectRock(w: World, x: number, d: number, r: number): Obstacle {
  const o: Obstacle = {
    id: w.nextId++,
    kind: 'rock',
    x,
    y: w.player.y - (d - w.distance),
    r,
    len: 0,
    angle: 0,
    spin: 0,
    vx: 0,
    variant: 0,
    hit: false,
  };
  w.obstacles.push(o);
  return o;
}

/**
 * A run fast-forwarded far downstream: layoutPickups lays out everything up to
 * there in one call. The obstacle stream is declared complete (the test injects
 * whatever rocks it wants), so nothing waits for obstacles that will never come.
 */
function prepare(seed: number, distanceM: number): World {
  const w = newRun(seed);
  w.distance = distanceM * U;
  simState(w).nextObstacleD = Infinity;
  return w;
}

function bulk(seed: number, distanceM: number, rocks: (w: World) => void = () => {}): World {
  const w = prepare(seed, distanceM);
  rocks(w);
  layoutPickups(w);
  return w;
}

/** A tiny, deterministic rock field for the layout tests. */
function rockField(w: World, seed: number): { x: number; d: number; r: number }[] {
  const rng = createRng(seed * 7919);
  const out: { x: number; d: number; r: number }[] = [];
  for (let d = 800; d < w.distance + 700; d += 140 + rng.next() * 160) {
    const e = riverEdgesAt(w.seed, d);
    const r = 16 + rng.next() * 13;
    const x = e.left + 20 + rng.next() * (e.right - e.left - 40);
    out.push({ x, d, r });
    injectRock(w, x, d, r);
  }
  return out;
}

describe('layout', () => {
  it('same seed + same scripted inputs → identical pickups, crumbs and score after 120 s', () => {
    const a = newRun(424242);
    const b = newRun(424242);
    const wa = lay(a, 120, scripted);
    const wb = lay(b, 120, scripted);
    expect(pickupPrint(a)).toEqual(pickupPrint(b));
    expect(wa.seen).toEqual(wb.seen);
    expect(a.crumbs).toBeGreaterThan(0);
    expect(wa.seen.length).toBeGreaterThan(40);
    // A different river lays out a different course.
    const c = newRun(424243);
    expect(lay(c, 120, scripted).seen).not.toEqual(wa.seen);
  });

  it('is the same on short and very tall screens (layout is by river distance)', () => {
    const short = newRun(99, { viewH: 740 });
    const tall = newRun(99, { viewH: 1400 });
    const ws = lay(short, 70, scripted);
    const wt = lay(tall, 70, scripted);
    expect(ws.seen.length).toBeGreaterThan(20);
    // The tall screen looks further ahead, so it has laid out at least as much;
    // everything the short one has is identical and in the same order.
    expect(wt.seen.length).toBeGreaterThanOrEqual(ws.seen.length);
    expect(wt.seen.slice(0, ws.seen.length).map(({ kind, x, d, trail }) => [kind, x, d, trail])).toEqual(
      ws.seen.map(({ kind, x, d, trail }) => [kind, x, d, trail]),
    );
  });

  it('does not depend on what the player does (idle vs a dodging bot)', () => {
    const a = newRun(20261021);
    const b = newRun(20261021);
    const bot = createDodgeBot();
    const wa = lay(a, 100, () => NONE);
    const wb = lay(b, 100, (_i, w) => bot(w));
    const n = Math.min(wa.seen.length, wb.seen.length);
    expect(n).toBeGreaterThan(30);
    const key = (s: Seen) => [s.kind, s.x, s.d, s.trail];
    expect(wa.seen.slice(0, n).map(key)).toEqual(wb.seen.slice(0, n).map(key));
    // Collecting (or not) changes the score, never the course.
    expect(b.crumbs).not.toBe(a.crumbs);
  });

  it('never draws from world.rng', () => {
    const w = newRun(5);
    stepWorld(w, NONE, SIM_DT);
    let calls = 0;
    const base = w.rng;
    w.rng = {
      ...base,
      next: () => {
        calls++;
        return base.next();
      },
    };
    w.distance = 90000;
    simState(w).nextObstacleD = Infinity;
    layoutPickups(w);
    expect(w.pickups.length).toBeGreaterThan(50);
    expect(calls).toBe(0);
  });

  it('keeps its stream aligned whatever the obstacles are (fixed draws per trail and power-up)', () => {
    const clear = bulk(31, 600);
    const crowded = bulk(31, 600, (w) => {
      // A rock field all the way: crumbs get shoved aside or dropped, the schedule must not move.
      rockField(w, 3);
    });
    const kinds = (w: World) => w.pickups.filter((k) => k.kind !== 'crumb').map((k) => k.kind);
    expect(kinds(clear).length).toBeGreaterThanOrEqual(2);
    expect(kinds(crowded)).toEqual(kinds(clear));
    const powerD = (w: World) => w.pickups.filter((k) => k.kind !== 'crumb').map((k) => distOf(w, k.y));
    powerD(clear).forEach((d, i) => expect(Math.abs(powerD(crowded)[i] - d)).toBeLessThanOrEqual(110));
    const starts = (w: World) => {
      const first = new Map<number, number>();
      for (const k of w.pickups) if (k.kind === 'crumb' && !first.has(k.trail)) first.set(k.trail, distOf(w, k.y));
      return first;
    };
    const a = starts(clear);
    const b = starts(crowded);
    expect(a.size).toBeGreaterThan(8);
    let shared = 0;
    for (const [id, d] of b) {
      const other = a.get(id);
      if (other === undefined) continue;
      shared++;
      // Same trail id → same start (a dropped first crumb moves it by whole crumb gaps at most).
      expect(Math.abs(d - other)).toBeLessThanOrEqual(CRUMB_SPACING * (TRAIL_MAX - 1));
    }
    expect(shared).toBeGreaterThan(a.size * 0.6);
  });

  it('keeps every pickup on the water and out of rocks (rock fields, many seeds)', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const w = prepare(seed, 500);
      const rocks = rockField(w, seed);
      layoutPickups(w);
      expect(w.pickups.length).toBeGreaterThan(40);
      for (const k of w.pickups) {
        const d = distOf(w, k.y);
        const e = riverEdgesAt(seed, d);
        expect(k.x).toBeGreaterThan(e.left + 10);
        expect(k.x).toBeLessThan(e.right - 10);
        for (const o of rocks) {
          const gap = Math.hypot(k.x - o.x, d - o.d) - o.r;
          // Crumbs at least ~16 off a rock's edge, power-ups 60.
          expect(gap).toBeGreaterThanOrEqual(k.kind === 'crumb' ? 15.9 : 59.9);
        }
      }
    }
  });

  it('slides a trail that runs into a rock around it, all to one side', () => {
    const probe = bulk(8, 300);
    const trail = probe.pickups.filter((k) => k.kind === 'crumb' && k.trail === 3);
    expect(trail.length).toBeGreaterThanOrEqual(5);
    const mid = trail[Math.floor(trail.length / 2)];
    const w = bulk(8, 300, (world) => {
      injectRock(world, mid.x, distOf(probe, mid.y), 28);
    });
    const moved = w.pickups.filter((k) => k.kind === 'crumb' && k.trail === 3);
    expect(moved.length).toBeGreaterThanOrEqual(3);
    const side = Math.sign(moved.find((k) => Math.abs(k.x - mid.x) > 1)!.x - mid.x);
    for (const k of moved) {
      const gap = Math.hypot(k.x - mid.x, distOf(w, k.y) - distOf(probe, mid.y)) - 28;
      expect(gap).toBeGreaterThanOrEqual(15.9);
      if (Math.abs(distOf(w, k.y) - distOf(probe, mid.y)) < 44) expect(Math.sign(k.x - mid.x)).toBe(side);
    }
  });

  it('keeps clear of real obstacles in a live run (rocks and pads for good, twigs as they were born)', () => {
    for (const seed of [3, 2026]) {
      const w = newRun(seed);
      w.player.hearts = 1e9;
      const born = new Map<number, { x: number; d: number; reach: number; kind: string }>();
      const checked = new Set<number>();
      let powersChecked = 0;
      for (let i = 0; i < 140 / SIM_DT; i++) {
        stepWorld(w, scripted(i), SIM_DT);
        w.events.length = 0;
        for (const o of w.obstacles) {
          if (!born.has(o.id)) born.set(o.id, { x: o.x, d: distOf(w, o.y), reach: o.kind === 'twig' ? o.len + o.r : o.r, kind: o.kind });
        }
        for (const k of w.pickups) {
          if (checked.has(k.id)) continue;
          checked.add(k.id);
          const d = distOf(w, k.y);
          const e = riverEdgesAt(seed, d);
          expect(k.x).toBeGreaterThan(e.left + 10);
          expect(k.x).toBeLessThan(e.right - 10);
          for (const o of born.values()) {
            const gap = Math.hypot(k.x - o.x, d - o.d) - o.reach;
            expect(gap).toBeGreaterThanOrEqual(k.kind === 'crumb' ? 15.9 : 59.9);
          }
          if (k.kind !== 'crumb') powersChecked++;
        }
        // Rocks never move: nothing sits in one at any later time either (checked every few steps).
        if (i % 12 !== 0) continue;
        for (const o of w.obstacles) {
          if (o.kind === 'twig') continue;
          for (const k of w.pickups) {
            if (k.taken) continue;
            expect(Math.hypot(k.x - o.x, k.y - o.y)).toBeGreaterThan(o.r + 5);
          }
        }
      }
      expect(checked.size).toBeGreaterThan(40);
      expect(powersChecked).toBeGreaterThanOrEqual(2);
    }
  });

  it('lays crumbs out 22 units apart in trails of 5-9, a few trails of fewer only where rocks crowd them', () => {
    const w = bulk(14, 800);
    const trails = new Map<number, Pickup[]>();
    for (const k of w.pickups) if (k.kind === 'crumb') trails.set(k.trail, [...(trails.get(k.trail) ?? []), k]);
    expect(trails.size).toBeGreaterThan(10);
    for (const list of trails.values()) {
      expect(list.length).toBeGreaterThanOrEqual(5);
      expect(list.length).toBeLessThanOrEqual(TRAIL_MAX);
      for (let i = 1; i < list.length; i++) {
        expect(list[i - 1].y - list[i].y).toBeCloseTo(CRUMB_SPACING, 6);
      }
    }
    // Real play: the shapes come out of the same code, sizes stay in range.
    const sizes = [...trails.values()].map((t) => t.length);
    expect(Math.min(...sizes)).toBe(5);
    expect(Math.max(...sizes)).toBe(TRAIL_MAX);
  });

  it('comes in different shapes: straight lines, bows, zigzags, trails hugging a rock', () => {
    const spreads: number[] = [];
    let hugging = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const w = prepare(seed, 600);
      const rocks = rockField(w, seed + 40);
      layoutPickups(w);
      const trails = new Map<number, Pickup[]>();
      for (const k of w.pickups) if (k.kind === 'crumb') trails.set(k.trail, [...(trails.get(k.trail) ?? []), k]);
      for (const list of trails.values()) {
        const xs = list.map((k) => k.x);
        spreads.push(Math.max(...xs) - Math.min(...xs));
      }
      // A crumb just outside a rock's collision circle (rock edge + 26 + a little): "dare" and "arc" trails.
      for (const k of w.pickups) {
        if (k.kind !== 'crumb') continue;
        for (const o of rocks) {
          const gap = Math.hypot(k.x - o.x, distOf(w, k.y) - o.d) - o.r;
          if (gap >= LEAF_HIT_R && gap <= LEAF_HIT_R + 10) hugging++;
        }
      }
    }
    expect(spreads.length).toBeGreaterThan(60);
    expect(spreads.filter((s) => s < 1).length).toBeGreaterThan(5);
    expect(spreads.filter((s) => s > 80).length).toBeGreaterThan(5);
    expect(spreads.filter((s) => s >= 15 && s <= 80).length).toBeGreaterThan(5);
    expect(hugging).toBeGreaterThan(10);
  });

  it('starts trails every 55-105 m (shorter in Lily Marsh) and power-ups 160-260 m apart', () => {
    const w = newRun(2468);
    const watch = lay(w, 400, () => NONE);
    const starts = watch.trailStarts.sort((a, b) => a - b);
    expect(starts.length).toBeGreaterThan(20);
    expect(starts[0] / U).toBeGreaterThanOrEqual(18);
    expect(starts[0] / U).toBeLessThanOrEqual(26 + 0.5);
    for (let i = 1; i < starts.length; i++) {
      const gap = (starts[i] - starts[i - 1]) / U;
      // Marsh crumbs x1.6 → as short as 55/1.6; a dropped first crumb moves a start by up to 8 gaps (3.5 m).
      expect(gap).toBeGreaterThanOrEqual(55 / 1.6 - 4);
      expect(gap).toBeLessThanOrEqual(105 + 4);
    }
    const powers = watch.powers.map((p) => p.d).sort((a, b) => a - b);
    expect(powers.length).toBeGreaterThanOrEqual(4);
    expect(powers[0] / U).toBeGreaterThanOrEqual(64);
    for (let i = 1; i < powers.length; i++) {
      const gap = (powers[i] - powers[i - 1]) / U;
      // Rapids ×1.3 → 160/1.3; the placement search can move one by up to 105 units (2 m) each way.
      expect(gap).toBeGreaterThanOrEqual(160 / 1.3 - 5);
      expect(gap).toBeLessThanOrEqual(260 + 5);
    }
  });

  it('never has two power-ups alive at once', () => {
    for (const seed of [1, 2, 3, 4]) {
      const w = newRun(seed);
      w.player.hearts = 1e9;
      let most = 0;
      for (let i = 0; i < 500 / SIM_DT; i++) {
        stepWorld(w, NONE, SIM_DT);
        w.events.length = 0;
        most = Math.max(most, w.pickups.filter((k) => k.kind !== 'crumb' && !k.taken).length);
      }
      expect(most).toBe(1);
    }
  });

  it('draws every power-up kind, the ladybug least, and fireflies far more often in or just before Night', () => {
    const counts: Record<string, number> = {};
    let nightFireflies = 0;
    let nightPowers = 0;
    let dayFireflies = 0;
    let dayPowers = 0;
    const sample = createZoneSample();
    const night = (seed: number, d: number) => {
      const z = zoneAt(seed, d, sample);
      return (z.blend < 0.5 ? z.zone : z.next) === 'night';
    };
    for (let seed = 1; seed <= 120; seed++) {
      const w = bulk(seed, 900);
      for (const k of w.pickups) {
        if (k.kind === 'crumb') continue;
        counts[k.kind] = (counts[k.kind] ?? 0) + 1;
        const d = distOf(w, k.y);
        // Night here, or within the next 100 m (the odds are drawn at the row's start, which can be a few metres earlier).
        const near = night(seed, d - 105) || night(seed, d + 100 * U) || night(seed, d);
        if (near) {
          nightPowers++;
          if (k.kind === 'firefly') nightFireflies++;
        } else {
          dayPowers++;
          if (k.kind === 'firefly') dayFireflies++;
        }
      }
    }
    for (const kind of ['mushroom', 'honey', 'ladybug', 'firefly']) expect(counts[kind]).toBeGreaterThan(0);
    // Ladybug is the rare one.
    expect(counts.ladybug).toBeLessThan(counts.mushroom);
    expect(counts.ladybug).toBeLessThan(counts.honey);
    expect(nightPowers).toBeGreaterThan(60);
    expect(dayPowers).toBeGreaterThan(200);
    expect(nightFireflies / nightPowers).toBeGreaterThan((dayFireflies / dayPowers) * 1.5);
  });

  it('never lays anything out for the menu backdrop', () => {
    const w = newRun(7, { attract: true });
    for (let i = 0; i < 120 / SIM_DT; i++) stepWorld(w, NONE, SIM_DT);
    expect(w.state).toBe('attract');
    expect(w.pickups).toHaveLength(0);
    w.distance = 80000;
    layoutPickups(w);
    expect(w.pickups).toHaveLength(0);
  });

  it('puts the first trail beside the start so a leaf that never moves collects nothing early', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const w = newRun(seed);
      // No hazards: nothing knocks the leaf off its spot.
      const watch = new Watch();
      for (let i = 0; i < Math.round(24 / SIM_DT); i++) {
        step(w, 1);
        watch.look(w);
      }
      expect(watch.seen.length).toBeGreaterThanOrEqual(5);
      expect(w.crumbs).toBe(0);
    }
  });

  it('appears above the screen top on a normal screen (no pop-in)', () => {
    const w = newRun(21, { viewH: 800 });
    w.player.hearts = 1e9;
    for (let i = 0; i < 60 / SIM_DT; i++) {
      stepWorld(w, NONE, SIM_DT);
      w.events.length = 0;
      for (const k of w.pickups) if (k.y > 0 && k.y < 4) expect(k.y).toBeGreaterThan(-1);
      for (const k of w.pickups) expect(k.y).toBeLessThanOrEqual(w.viewH + 100);
    }
    const fresh = newRun(21);
    stepWorld(fresh, NONE, SIM_DT);
    layoutPickups(fresh);
    for (const k of fresh.pickups) expect(fresh.player.y - k.y).toBeGreaterThan(fresh.player.y);
    expect(SPAWN_AHEAD).toBe(950);
  });

  it('first shows above the top edge on tall phones too: pickups and obstacles never pop in on screen', () => {
    for (const viewH of [800, 870, 950, 1050, 1150]) {
      const w = newRun(21, { viewH });
      w.player.hearts = 1e9;
      const seenPickups = new Set<number>();
      const seenObstacles = new Set<number>();
      let lowestPickup = -Infinity;
      let lowestObstacle = -Infinity;
      // Fast-forward the river so many trails, power-ups and rock rows are laid out, not just the opening ones.
      for (let i = 0; i < 45 / SIM_DT; i++) {
        stepWorld(w, NONE, SIM_DT);
        w.events.length = 0;
        if (i % 20 === 0) w.distance += 60;
        for (const k of w.pickups) {
          if (seenPickups.has(k.id)) continue;
          seenPickups.add(k.id);
          lowestPickup = Math.max(lowestPickup, k.y);
        }
        for (const o of w.obstacles) {
          if (seenObstacles.has(o.id)) continue;
          seenObstacles.add(o.id);
          lowestObstacle = Math.max(lowestObstacle, o.y - o.r);
        }
      }
      expect(seenPickups.size, `pickups at viewH ${viewH}`).toBeGreaterThan(20);
      // A pickup is born above the top edge (a little slack: the opening trail sits close to it on the tallest screens).
      expect(lowestPickup, `pickup first seen at viewH ${viewH}`).toBeLessThanOrEqual(12);
      expect(lowestObstacle, `obstacle first seen at viewH ${viewH}`).toBeLessThanOrEqual(0);
    }
  });
});

describe('collecting', () => {
  it('takes a crumb within the leaf radius + 6, and only then', () => {
    const w = newRun();
    const near = put(w, 'crumb', PICKUP_R - 1);
    const far = put(w, 'crumb', PICKUP_R + 3, 0);
    expect(PICKUP_R).toBe(LEAF_HIT_R + 6);
    step(w, 1);
    expect(near.taken).toBe(true);
    expect(far.taken).toBe(false);
    expect(w.crumbs).toBe(1);
  });

  it('pays 10 x multiplier, rounded, and counts the crumb', () => {
    const w = newRun();
    w.combo = 8;
    w.multiplier = multiplierFor(8); // x3
    w.comboTimer = 1e9; // keep the chain alive for the arithmetic
    put(w, 'crumb', 0);
    const events = step(w, 1);
    const pick = events.find((e) => e.type === 'pickup');
    expect(pick).toMatchObject({ type: 'pickup', kind: 'crumb', points: 30, streak: 1 });
    expect(w.crumbs).toBe(1);
    expect(w.score - (3 * w.distance) / U).toBeCloseTo(30, 6);

    const odd = newRun();
    odd.combo = 3;
    odd.multiplier = multiplierFor(3); // x1.75 → 17.5 → 18
    odd.comboTimer = 1e9;
    put(odd, 'crumb', 0);
    expect(step(odd, 1).find((e) => e.type === 'pickup')).toMatchObject({ points: 18 });
    expect(CRUMB_POINTS).toBe(10);
  });

  it('does not touch the score of a plain x1 run beyond +10', () => {
    const w = newRun();
    put(w, 'crumb', 0);
    step(w, 1);
    expect(w.score - w.distance / U).toBeCloseTo(10, 6);
    expect(w.multiplier).toBe(1);
    expect(w.combo).toBe(0);
  });

  it('adds 0.4 s to a running combo timer, capped at the full timer, and never starts one', () => {
    expect(CRUMB_COMBO_BONUS).toBe(0.4);
    const w = newRun();
    w.combo = 3;
    w.multiplier = multiplierFor(3);
    w.comboTimer = 1.5;
    put(w, 'crumb', 0);
    step(w, 1);
    expect(w.comboTimer).toBeCloseTo(1.5 + 0.4 - SIM_DT, 5);

    const capped = newRun();
    capped.combo = 3;
    capped.multiplier = multiplierFor(3);
    capped.comboTimer = COMBO_TIME - 0.1;
    put(capped, 'crumb', 0);
    step(capped, 1);
    expect(capped.comboTimer).toBeCloseTo(COMBO_TIME, 6);
    expect(capped.comboTimer).toBeLessThanOrEqual(COMBO_TIME);

    const none = newRun();
    put(none, 'crumb', 0);
    step(none, 1);
    expect(none.combo).toBe(0);
    expect(none.comboTimer).toBe(0);
  });

  it('keeps a chain alive that would otherwise have just run out', () => {
    const w = newRun();
    w.combo = 4;
    w.multiplier = multiplierFor(4);
    w.comboTimer = 0.2;
    put(w, 'crumb', 0, 12);
    step(w, 1);
    // The 0.4 s from the crumb outlives the 0.2 s that were left.
    step(w, Math.round(0.3 / SIM_DT));
    expect(w.combo).toBe(4);
  });

  it('collects only in a live, running world', () => {
    const w = newRun();
    const k = put(w, 'crumb', 0);
    updatePickups(w, SIM_DT, false);
    expect(k.taken).toBe(false);
    w.state = 'dying';
    updatePickups(w, SIM_DT, true);
    expect(k.taken).toBe(false);
    expect(w.crumbs).toBe(0);
  });

  it('keeps a taken pickup for a moment, then removes it', () => {
    const w = newRun();
    const k = put(w, 'crumb', 0);
    step(w, 1);
    expect(k.taken).toBe(true);
    step(w, Math.round((TAKEN_LINGER - 0.05) / SIM_DT));
    expect(w.pickups).toContain(k);
    step(w, Math.round(0.1 / SIM_DT));
    expect(w.pickups).not.toContain(k);
    expect(TAKEN_LINGER).toBeCloseTo(0.25, 5);
  });

  it('scrolls with the river and removes what has drifted below the view', () => {
    const w = newRun();
    const k = put(w, 'crumb', 150, 0);
    const y0 = k.y;
    step(w, 100);
    expect(k.y).toBeGreaterThan(y0);
    expect(k.y - y0).toBeCloseTo(w.scrollSpeed * 100 * SIM_DT, 0);
    w.player.hearts = 1e9;
    let guard = 0;
    while (w.pickups.includes(k) && guard++ < 20 * 120) step(w, 1);
    expect(w.pickups).not.toContain(k);
    expect(k.y).toBeGreaterThan(w.viewH);
    expect(w.crumbs).toBe(0);
  });

  it('numbers a swept trail 1..n, and a Perfect trail pays 50 x multiplier', () => {
    const w = newRun(5);
    w.combo = 4;
    w.multiplier = multiplierFor(4); // x2
    w.comboTimer = 1e9;
    let guard = 0;
    while (!w.pickups.some((k) => k.kind === 'crumb') && guard++ < 30 * 120) step(w, 1);
    const crumbs = w.pickups.filter((k) => k.kind === 'crumb');
    const n = crumbs.length;
    expect(n).toBeGreaterThanOrEqual(5);
    const events = sweep(w, crumbs, []);
    const picks = events.filter((e) => e.type === 'pickup');
    expect(picks.map((e) => (e.type === 'pickup' ? e.streak : 0))).toEqual(Array.from({ length: n }, (_, i) => i + 1));
    const done = events.filter((e) => e.type === 'trail-complete');
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ points: 100 });
    expect(TRAIL_BONUS).toBe(50);
    expect(w.crumbs).toBe(n);
    expect(w.score - (2 * w.distance) / U).toBeCloseTo(n * 20 + 100, 5);
    // 'pickup' for the last crumb comes before the bonus.
    const order = kindsOf(events).filter((t) => t === 'pickup' || t === 'trail-complete');
    expect(order[order.length - 1]).toBe('trail-complete');
  });

  it('gives no bonus for a trail with crumbs missed, and restarts the streak after the gap', () => {
    const w = newRun(5);
    let guard = 0;
    while (!w.pickups.some((k) => k.kind === 'crumb') && guard++ < 30 * 120) step(w, 1);
    const crumbs = w.pickups.filter((k) => k.kind === 'crumb');
    // Crumbs are 22 apart and the pickup radius is 32, so missing one means leaving the line for a few.
    const events = sweep(w, crumbs, [2, 3, 4]);
    const streaks = events.filter((e) => e.type === 'pickup').map((e) => (e.type === 'pickup' ? e.streak : 0));
    expect(streaks.slice(0, 2)).toEqual([1, 2]);
    expect(streaks.slice(2).includes(1)).toBe(true);
    expect(Math.max(...streaks)).toBeLessThan(crumbs.length);
    expect(events.some((e) => e.type === 'trail-complete')).toBe(false);
    expect(w.crumbs).toBeLessThan(crumbs.length);
    expect(w.crumbs).toBeGreaterThanOrEqual(crumbs.length - 4);
  });

  it('applies the honey magnet: crumbs within 110 units drift in at 260 u/s, others do not', () => {
    expect(MAGNET_RANGE).toBe(110);
    expect(MAGNET_SPEED).toBe(260);
    const w = newRun();
    activatePower(w, 'honey');
    const inside = put(w, 'crumb', 100, -40);
    const outside = put(w, 'crumb', 140, -40);
    const power = put(w, 'mushroom', 60, -40);
    const x0 = inside.x;
    const outsideX0 = outside.x;
    const powerX0 = power.x;
    const dist = () => Math.hypot(inside.x - w.player.x, inside.y - w.player.y);
    const d0 = dist();
    step(w, 6);
    // Closing on the leaf by about the pull per step (the river carries it too).
    expect(inside.x).toBeLessThan(x0);
    expect(dist()).toBeLessThan(d0 - 6 * MAGNET_SPEED * SIM_DT * 0.8);
    expect(outside.x).toBe(outsideX0);
    // Power-ups are not pulled.
    expect(power.x).toBe(powerX0);
    // And it ends up in the pack.
    step(w, 120);
    expect(inside.taken).toBe(true);
    expect(w.crumbs).toBeGreaterThanOrEqual(1);
  });

  it('does not pull crumbs without honey, or once it has run out', () => {
    const w = newRun();
    const k = put(w, 'crumb', 100, -40);
    const x0 = k.x;
    step(w, 10);
    expect(k.x).toBe(x0);
    activatePower(w, 'honey');
    step(w, Math.round(9.1 / SIM_DT));
    const late = put(w, 'crumb', 100, -40);
    const lx = late.x;
    step(w, 10);
    expect(late.x).toBe(lx);
  });

  it('hands power-ups over: mushroom, honey and firefly start timers, 0 points', () => {
    for (const kind of ['mushroom', 'honey', 'firefly'] as const) {
      const w = newRun();
      put(w, kind, 0);
      const events = step(w, 1);
      expect(events.find((e) => e.type === 'pickup')).toMatchObject({ kind, points: 0 });
      expect(events).toContainEqual({ type: 'power-start', kind, duration: kind === 'mushroom' ? 10 : kind === 'honey' ? 9 : 12 });
      expect(w.powers.map((p) => p.kind)).toEqual([kind]);
      expect(w.crumbs).toBe(0);
    }
  });

  it('picking up the same kind again refreshes it', () => {
    const w = newRun();
    put(w, 'honey', 0);
    step(w, 1);
    step(w, Math.round(4 / SIM_DT));
    expect(w.powers[0].left).toBeLessThan(5.1);
    put(w, 'honey', 0);
    step(w, 1);
    expect(w.powers).toHaveLength(1);
    expect(w.powers[0].left).toBeGreaterThan(8.9);
  });

  it('ladybug: +1 heart below the maximum, otherwise 100 x multiplier points', () => {
    const hurt = newRun();
    hurt.player.hearts = 2;
    put(hurt, 'ladybug', 0);
    const events = step(hurt, 1);
    expect(hurt.player.hearts).toBe(MAX_HEARTS);
    expect(events).toContainEqual({ type: 'heal', hearts: MAX_HEARTS });
    expect(events.find((e) => e.type === 'pickup')).toMatchObject({ kind: 'ladybug', points: 0 });

    const full = newRun();
    full.combo = 4;
    full.multiplier = multiplierFor(4); // x2
    full.comboTimer = 1e9;
    put(full, 'ladybug', 0);
    const ev = step(full, 1);
    expect(full.player.hearts).toBe(MAX_HEARTS);
    expect(ev.find((e) => e.type === 'pickup')).toMatchObject({ kind: 'ladybug', points: 200 });
    expect(ev.some((e) => e.type === 'heal')).toBe(false);
    expect(full.score - (2 * full.distance) / U).toBeCloseTo(200, 6);
  });

  it('keeps pickups in place relative to the leaf when the view is resized', () => {
    const w = newRun();
    const k = put(w, 'crumb', 80, -200);
    step(w, 5);
    const rel = k.y - w.player.y;
    setViewHeight(w, 1000);
    step(w, 1);
    expect(k.y - w.player.y).toBeCloseTo(rel + w.scrollSpeed * SIM_DT, 3);
    setViewHeight(w, 700);
    step(w, 1);
    expect(k.y - w.player.y).toBeCloseTo(rel + 2 * w.scrollSpeed * SIM_DT, 3);
  });

  it('puts crumbs and zones in the run summary', () => {
    const w = newRun();
    put(w, 'crumb', 0);
    step(w, 1);
    const s = summarize(w);
    expect(s.crumbs).toBe(1);
    expect(s.zonesReached).toBe(1);
  });
});

/**
 * Teleports the leaf onto each crumb of the trail as it arrives (a perfect
 * player), keeping well clear of the crumbs numbered in `skip`. Returns the events.
 */
function sweep(w: World, crumbs: Pickup[], skip: readonly number[]): GameEvent[] {
  const ids = crumbs.map((c) => c.id);
  const out: GameEvent[] = [];
  const p = w.player;
  for (let i = 0; i < 12 * 120; i++) {
    let best: Pickup | null = null;
    let bestD = 60;
    for (const k of w.pickups) {
      if (k.taken || !ids.includes(k.id)) continue;
      const dy = Math.abs(k.y - p.y);
      if (dy < bestD) {
        best = k;
        bestD = dy;
      }
    }
    if (best) {
      const idx = ids.indexOf(best.id);
      let x = best.x;
      if (skip.includes(idx)) {
        const e = riverEdgesAt(w.seed, distOf(w, p.y));
        const away = best.x - 90 > e.left + BANK_MARGIN ? best.x - 90 : best.x + 90;
        x = Math.min(e.right - BANK_MARGIN, Math.max(e.left + BANK_MARGIN, away));
      }
      p.x = p.targetX = x;
    }
    out.push(...step(w, 1));
    if (w.pickups.every((k) => !ids.includes(k.id))) break;
  }
  return out;
}

// --- Balance -----------------------------------------------------------------------

/**
 * The Phase 1 dodging bot plus a small reward for ending its slide on crumbs
 * that are about to pass. Hazards still dominate every decision (risk x1000),
 * so it only chooses crumbs among equally safe spots.
 */
function createCrumbBot(crumbWeight = 25) {
  interface Hazard {
    x0: number;
    x1: number;
    t0: number;
    t1: number;
  }
  const hazards: Hazard[] = [];
  const crumbs: { x: number; t: number }[] = [];
  let target = NaN;
  let since = Infinity;
  const plan = (world: World): number => {
    const p = world.player;
    const v = Math.max(1, world.scrollSpeed);
    hazards.length = 0;
    for (const d of world.drops) {
      if (d.age < 0.2) continue;
      const tau = d.fall - d.age;
      const dy = d.y + v * tau - p.y;
      const R = d.r + ANT_HIT_R + 4;
      if (Math.abs(dy) >= R) continue;
      const h = Math.sqrt(R * R - dy * dy);
      hazards.push({ x0: d.x - h, x1: d.x + h, t0: tau - 0.03, t1: tau + 0.03 });
    }
    for (const o of world.obstacles) {
      if (o.hit || o.y < -40 || o.kind === 'pad') continue;
      const ry = o.kind === 'rock' ? o.r + LEAF_HIT_R : o.len + o.r + LEAF_HIT_R;
      const t0 = (p.y - ry - o.y) / v;
      const t1 = (p.y + ry - o.y) / v;
      if (t1 < 0 || t0 > 2.5) continue;
      const rx = (o.kind === 'rock' ? o.r + LEAF_HIT_R : o.len + o.r + LEAF_HIT_R + Math.abs(o.vx) * Math.max(0, t1)) + 8;
      hazards.push({ x0: o.x - rx, x1: o.x + rx, t0: Math.max(0, t0), t1 });
    }
    crumbs.length = 0;
    for (const k of world.pickups) {
      if (k.taken || k.kind !== 'crumb') continue;
      const t = (p.y - k.y) / v;
      if (t > -0.05 && t < 1.1) crumbs.push({ x: k.x, t });
    }
    const e = riverEdgesAt(world.seed, world.distance);
    const lo = e.left + BANK_MARGIN;
    const hi = e.right - BANK_MARGIN;
    let best = p.x;
    let bestCost = Infinity;
    const steps = 64;
    for (let k = 0; k <= steps + 1; k++) {
      const c = k === steps + 1 ? Math.min(hi, Math.max(lo, p.x)) : lo + ((hi - lo) * k) / steps;
      const dist = Math.abs(c - p.x);
      const dir = c >= p.x ? 1 : -1;
      const pos = (t: number) => p.x + dir * Math.min(dist, reachIn(Math.max(0, t)));
      let risk = 0;
      let crowd = 0;
      for (const h of hazards) {
        const w = 1 / (Math.max(0, h.t0) + 0.15);
        let bad = false;
        if (h.t1 - h.t0 < 0.1) {
          const x = pos((h.t0 + h.t1) / 2);
          bad = x > h.x0 && x < h.x1;
        } else {
          for (let s = 0; s <= 4 && !bad; s++) {
            const x = pos(h.t0 + ((h.t1 - h.t0) * s) / 4);
            bad = x > h.x0 && x < h.x1;
          }
        }
        if (bad) risk += w;
        if (c > h.x0 - 30 && c < h.x1 + 30) crowd += 0.15 * w;
      }
      let reward = 0;
      for (const cr of crumbs) if (Math.abs(pos(cr.t) - cr.x) < 26) reward++;
      const cost = risk * 1000 + crowd + dist * 0.02 + Math.abs(c - (lo + hi) / 2) * 0.004 - reward * crumbWeight * 0.05;
      if (cost < bestCost) {
        bestCost = cost;
        best = c;
      }
    }
    return best;
  };
  return (world: World): InputFrame => {
    if (world.state !== 'running') return NONE;
    since += SIM_DT;
    if (since >= 1 / 30 || target !== target) {
      since = 0;
      target = plan(world);
    }
    const p = world.player;
    const err = target - (p.x + p.vx * 0.05);
    const axis = Math.abs(err) < 2 ? 0 : Math.max(-1, Math.min(1, err / 14));
    return { steerDelta: 0, axis, absoluteX: null };
  };
}

interface BotRun {
  time: number;
  died: boolean;
  score: number;
  crumbPoints: number;
  powersSeen: number;
}

function botRun(seed: number, ctl: (w: World) => InputFrame, maxTime: number, strip = false): BotRun {
  const w = newRun(seed);
  const seen = new Set<number>();
  let crumbPoints = 0;
  let deathAt = -1;
  while (w.time < maxTime && w.state !== 'over') {
    stepWorld(w, ctl(w), SIM_DT);
    for (const e of w.events) {
      if (e.type === 'pickup' && e.kind === 'crumb') crumbPoints += e.points;
      if (e.type === 'trail-complete') crumbPoints += e.points;
      if (e.type === 'death' && deathAt < 0) deathAt = w.time;
    }
    w.events.length = 0;
    for (const k of w.pickups) if (k.kind !== 'crumb') seen.add(k.id);
    if (strip) w.pickups.length = 0;
  }
  return { time: deathAt >= 0 ? deathAt : w.time, died: deathAt >= 0, score: w.score, crumbPoints, powersSeen: seen.size };
}

describe('balance (pickups must not make the game easier, and crumbs are a bonus, not the game)', () => {
  const SEEDS = 20;
  let plainRuns: BotRun[] | null = null;
  /** Two minutes of the Phase 1 dodging bot (which ignores crumbs) on a fixed set of seeds. */
  const dodgeRuns = () => (plainRuns ??= Array.from({ length: SEEDS }, (_, i) => botRun(i + 1, createDodgeBot(), 120)));

  it('an idle player does not last longer because of pickups', () => {
    const withPickups: number[] = [];
    const without: number[] = [];
    for (let seed = 1; seed <= 30; seed++) {
      withPickups.push(botRun(seed, idle, 200).time);
      without.push(botRun(seed, idle, 200, true).time);
    }
    expect(median(withPickups)).toBeLessThanOrEqual(median(without) + 0.5);
    // Nor on average.
    const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    expect(mean(withPickups)).toBeLessThanOrEqual(mean(without) + 1);
    // Phase 1's 15-25 s idle survival is intact.
    expect(median(withPickups)).toBeGreaterThan(8);
    expect(median(withPickups)).toBeLessThan(30);
  });

  it('a dodging bot survives as long with pickups as without', () => {
    const withPickups: number[] = [];
    const without: number[] = [];
    for (let seed = 1; seed <= 10; seed++) {
      withPickups.push(botRun(seed, createDodgeBot(), 240).time);
      without.push(botRun(seed, createDodgeBot(), 240, true).time);
    }
    // Shields and ladybugs help a little; they must not turn a mortal bot immortal.
    expect(median(withPickups)).toBeLessThanOrEqual(median(without) + 15);
    expect(median(withPickups)).toBeGreaterThan(60);
    expect(median(withPickups)).toBeLessThan(200);
  });

  it('crumbs add roughly 10-20 % to the score of a bot that routes for them', () => {
    let crumb = 0;
    let total = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const r = botRun(seed, createCrumbBot(), 120);
      crumb += r.crumbPoints;
      total += r.score;
    }
    const share = crumb / total;
    expect(share).toBeGreaterThanOrEqual(0.1);
    expect(share).toBeLessThanOrEqual(0.2);
    // A bot that ignores crumbs picks up only what happens to lie on its path.
    const plain = dodgeRuns();
    const plainShare = plain.reduce((s, r) => s + r.crumbPoints, 0) / plain.reduce((s, r) => s + r.score, 0);
    expect(plainShare).toBeLessThan(share);
    expect(plainShare).toBeLessThan(0.12);
  });

  it('shows 2-3 power-ups in a two-minute run', () => {
    const runs = dodgeRuns();
    const perRun = runs.reduce((s, r) => s + r.powersSeen, 0) / runs.length;
    expect(perRun).toBeGreaterThanOrEqual(1.8);
    expect(perRun).toBeLessThanOrEqual(3);
  });
});
