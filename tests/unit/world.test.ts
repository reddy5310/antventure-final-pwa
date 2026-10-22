import { afterEach, describe, expect, it, vi } from 'vitest';
import { ANT_HIT_R, LEAF_HIT_R, MAX_HEARTS, SIM_DT, UNITS_PER_METER } from '../../src/config';
import { COMBO_TIME, INVULN_TIME, NEAR_BAND } from '../../src/game/tuning';
import { createWorld, setDropHold, setViewHeight, stepWorld, summarize } from '../../src/game/world';
import type { Drop, GameEvent, InputFrame, World } from '../../src/types';
import { createDodgeBot, idle, median, runSim } from './helpers/sim';

const NONE: InputFrame = { steerDelta: 0, axis: 0, absoluteX: null };

function newRun(seed = 11, extra: Partial<Parameters<typeof createWorld>[0]> = {}): World {
  return createWorld({ mode: 'endless', seed, dailyId: null, bestDistance: 0, viewH: 800, ...extra });
}

/** Steps the world, returning the events. `clean` removes every hazard so tests control what happens. */
function step(world: World, steps: number, opts: { input?: InputFrame; clean?: boolean } = {}): GameEvent[] {
  const out: GameEvent[] = [];
  for (let i = 0; i < steps; i++) {
    stepWorld(world, opts.input ?? NONE, SIM_DT);
    if (opts.clean) {
      world.drops.length = 0;
      world.obstacles.length = 0;
    }
    out.push(...world.events);
    world.events.length = 0;
  }
  return out;
}

/** A drop that lands on the next step at (player.x + dx, player.y + dy). */
function landNext(world: World, dx: number, dy = 0, r = 18): Drop {
  const p = world.player;
  const d: Drop = {
    id: world.nextId++,
    x: p.x + dx,
    y: p.y + dy - world.scrollSpeed * SIM_DT,
    age: 1 - SIM_DT / 2,
    fall: 1,
    r,
    aimed: true,
  };
  world.drops.push(d);
  return d;
}

/** Scripted input that exercises every device path. */
function scripted(i: number): InputFrame {
  const t = i * SIM_DT;
  return {
    steerDelta: i % 7 === 0 ? Math.sin(t * 1.3) * 6 : 0,
    axis: Math.sin(t * 0.8) > 0.6 ? 1 : Math.sin(t * 0.8) < -0.6 ? -1 : 0,
    absoluteX: Math.floor(t / 10) % 3 === 2 ? 200 + Math.sin(t * 2.1) * 120 : null,
  };
}

function fingerprint(world: World) {
  const r = (v: number) => Math.round(v * 1e6) / 1e6;
  return {
    state: world.state,
    score: r(world.score),
    distance: r(world.distance),
    hearts: world.player.hearts,
    x: r(world.player.x),
    storm: world.storm,
    nearMisses: world.nearMisses,
    drops: world.drops.map((d) => [d.id, r(d.x), r(d.y - world.player.y), r(d.age), d.fall, d.r]),
    obstacles: world.obstacles.map((o) => [o.id, o.kind, r(o.x), r(o.y - world.player.y), r(o.angle), o.hit]),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('determinism', () => {
  it('same seed + same inputs → identical run after 90 s', () => {
    const a = newRun(424242);
    const b = newRun(424242);
    // Immortal so both runs see the full 90 s of spawning.
    a.player.hearts = b.player.hearts = 1e9;
    for (let i = 0; i < 90 / SIM_DT; i++) {
      stepWorld(a, scripted(i), SIM_DT);
      stepWorld(b, scripted(i), SIM_DT);
      a.events.length = b.events.length = 0;
    }
    expect(fingerprint(a)).toEqual(fingerprint(b));
    expect(a.drops.length + a.obstacles.length).toBeGreaterThan(0);
    expect(fingerprint(newRun(424243))).not.toEqual(fingerprint(newRun(424242)));
  });

  it('never uses Math.random', () => {
    vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random used in gameplay');
    });
    const w = newRun(5);
    w.player.hearts = 1e9;
    expect(() => step(w, 60 / SIM_DT, { input: { ...NONE, axis: 0.3 } })).not.toThrow();
  });

  it('daily stream stays aligned whatever the player does', () => {
    // Different play must not shift world.rng: same spawn timings, same random
    // positions and the same obstacle course for everyone on the Daily River.
    const a = newRun(20261021);
    const b = newRun(20261021);
    a.player.hearts = b.player.hearts = 1e9;
    const bot = createDodgeBot();
    for (let i = 0; i < 120 / SIM_DT; i++) {
      stepWorld(a, NONE, SIM_DT);
      stepWorld(b, bot(b), SIM_DT);
      a.events.length = b.events.length = 0;
    }
    expect(a.rng.next()).toBe(b.rng.next());
    expect(a.storm).toBe(b.storm);
    const rocks = (w: World) => w.obstacles.filter((o) => o.kind === 'rock').map((o) => [o.x, o.y]);
    expect(rocks(a)).toEqual(rocks(b));
  });

  it('obstacle course and drops are the same on short and very tall screens', () => {
    const short = newRun(99, { viewH: 740 });
    const tall = newRun(99, { viewH: 1400 });
    short.player.hearts = tall.player.hearts = 1e9;
    for (let i = 0; i < 60 / SIM_DT; i++) {
      stepWorld(short, scripted(i), SIM_DT);
      stepWorld(tall, scripted(i), SIM_DT);
      short.events.length = tall.events.length = 0;
    }
    const rel = (w: World) => ({
      drops: w.drops.map((d) => [Math.round(d.x * 1e6), Math.round((d.y - w.player.y) * 1e6)]),
      // Compare what is ahead of (or level with) the leaf; the tall screen
      // also still shows obstacles further behind it.
      ahead: w.obstacles
        .filter((o) => o.y - w.player.y < 200 && w.player.y - o.y < 950)
        .map((o) => [o.kind, Math.round(o.x * 1e6), Math.round((o.y - w.player.y) * 1e6), Math.round(o.angle * 1e6)]),
      score: Math.round(w.score * 1e6),
    });
    expect(rel(tall)).toEqual(rel(short));
  });
});

describe('hearts and invulnerability', () => {
  it('a splash on the ant costs a heart, then grants invulnerability', () => {
    const w = newRun();
    step(w, 10);
    landNext(w, 0);
    const ev = step(w, 1);
    expect(ev).toContainEqual(expect.objectContaining({ type: 'hit', source: 'drop', heartsLeft: MAX_HEARTS - 1 }));
    expect(w.player.hearts).toBe(MAX_HEARTS - 1);
    expect(w.player.invuln).toBeCloseTo(INVULN_TIME, 5);
    expect(w.player.hurt).toBeGreaterThan(0);
    expect(w.player.wet).toBeGreaterThan(0.3);
    expect(w.hitsTaken).toBe(1);

    // While invulnerable: no damage and no near-miss farming.
    landNext(w, 0);
    landNext(w, ANT_HIT_R + 18 + NEAR_BAND / 2);
    const during = step(w, 1);
    expect(during.filter((e) => e.type === 'hit' || e.type === 'near-miss')).toHaveLength(0);
    expect(w.player.hearts).toBe(MAX_HEARTS - 1);

    step(w, Math.ceil(INVULN_TIME / SIM_DT), { clean: true });
    landNext(w, 0);
    expect(step(w, 1)).toContainEqual(expect.objectContaining({ type: 'hit', heartsLeft: MAX_HEARTS - 2 }));
  });

  it('rocks hit once, knock the leaf aside and are marked', () => {
    const w = newRun();
    step(w, 10);
    const p = w.player;
    w.obstacles.push({ id: 999, kind: 'rock', x: p.x - 20, y: p.y - 30, r: 20, len: 0, angle: 0, spin: 0, vx: 0, variant: 0, hit: false });
    const x0 = p.x;
    const ev = step(w, 1);
    expect(ev).toContainEqual(expect.objectContaining({ type: 'hit', source: 'rock' }));
    // By id: the layout looks far ahead, so other obstacles may already be in the list.
    expect(w.obstacles.find((o) => o.id === 999)?.hit).toBe(true);
    expect(p.targetX).toBeGreaterThan(x0 + 10);
    // Still overlapping on later steps (and after invulnerability): no second hit.
    p.invuln = 0;
    expect(step(w, 5).filter((e) => e.type === 'hit')).toHaveLength(0);
  });

  it('twig capsules collide along their length', () => {
    const w = newRun();
    step(w, 10);
    const p = w.player;
    // Horizontal twig whose centre is far from the leaf but whose tip reaches it.
    w.obstacles.push({ id: 998, kind: 'twig', x: p.x + 60, y: p.y, r: 6, len: 50, angle: 0, spin: 0, vx: 0, variant: 0, hit: false });
    expect(step(w, 1)).toContainEqual(expect.objectContaining({ type: 'hit', source: 'twig' }));
    const v = newRun();
    step(v, 10);
    v.obstacles.push({ id: 997, kind: 'twig', x: v.player.x + LEAF_HIT_R + 60, y: v.player.y, r: 6, len: 50, angle: Math.PI / 2, spin: 0, vx: 0, variant: 0, hit: false });
    expect(step(v, 1).filter((e) => e.type === 'hit')).toHaveLength(0);
  });
});

describe('run flow', () => {
  it('dies on the last heart, slows to a stop and emits game-over exactly once', () => {
    const w = newRun();
    step(w, 10);
    w.player.hearts = 1;
    landNext(w, 0);
    const ev = step(w, 1);
    expect(ev.map((e) => e.type)).toEqual(expect.arrayContaining(['hit', 'death']));
    expect(w.state).toBe('dying');
    const deathTime = w.time;
    const deathDistance = w.distance;
    const scrollAtDeath = w.scrollSpeed;
    // Retrying during the death animation must record the same run as waiting for game over.
    const atDeath = summarize(w);

    const rest = step(w, Math.round(3 / SIM_DT), { input: { ...NONE, axis: 1 } });
    expect(rest.filter((e) => e.type === 'game-over')).toHaveLength(1);
    expect(rest.filter((e) => e.type === 'death')).toHaveLength(0);
    expect(rest.filter((e) => ['hit', 'near-miss', 'bank-bump', 'storm', 'milestone'].includes(e.type))).toHaveLength(0);
    expect(w.state).toBe('over');
    expect(w.scrollSpeed).toBe(0);
    expect(scrollAtDeath).toBeGreaterThan(0);
    const overAt = rest.findIndex((e) => e.type === 'game-over');
    expect(overAt).toBeGreaterThanOrEqual(0);
    expect(w.deathTimer).toBeGreaterThan(1);

    const s = summarize(w);
    expect(s.timeS).toBeCloseTo(deathTime, 6);
    expect(s.hitsTaken).toBe(1);
    expect(s.killedBy).toBe('drop');
    // The river drifts on under the fallen leaf, but the run's distance stops at death.
    expect(w.distance).toBeGreaterThan(deathDistance);
    expect(s.distanceM).toBe(Math.floor(deathDistance / UNITS_PER_METER));
    expect(s).toEqual(atDeath);
  });

  it('the first-run tutorial hold keeps the rain back until the player has steered', () => {
    const w = newRun(5);
    setDropHold(w, true);
    let seen = 0;
    for (let i = 0; i < Math.round(8 / SIM_DT); i++) {
      step(w, 1);
      seen = Math.max(seen, w.drops.length);
    }
    expect(seen).toBe(0);
    setDropHold(w, false);
    // Released: a slow, unaimed demo drop appears at once beside the leaf...
    expect(w.drops).toHaveLength(1);
    const demo = w.drops[0];
    expect(demo.aimed).toBe(false);
    expect(Math.abs(demo.x - w.player.x)).toBeGreaterThan(demo.r + ANT_HIT_R);
    // ...and standing still, it lands as a near-miss (rocks cleared: they could knock the leaf aside).
    const ev: GameEvent[] = [];
    for (let i = 0; i < Math.round((demo.fall + 0.1) / SIM_DT); i++) {
      w.obstacles.length = 0;
      ev.push(...step(w, 1));
    }
    const impactAt = ev.findIndex((e) => e.type === 'drop-impact');
    expect(impactAt).toBeGreaterThanOrEqual(0);
    expect(ev[impactAt + 1]).toMatchObject({ type: 'near-miss', combo: 1 });
  });

  it('a live run has no cause of death', () => {
    const w = newRun();
    step(w, 100, { clean: true });
    expect(summarize(w).killedBy).toBeNull();
  });

  it('does not spawn after death and settles leftovers', () => {
    const w = newRun(77);
    step(w, Math.round(40 / SIM_DT));
    w.player.hearts = 1;
    w.player.invuln = 0;
    landNext(w, 0);
    step(w, 1);
    const ids = new Set([...w.drops, ...w.obstacles].map((e) => e.id));
    step(w, Math.round(4 / SIM_DT));
    for (const e of [...w.drops, ...w.obstacles]) expect(ids.has(e.id)).toBe(true);
    expect(w.drops).toHaveLength(0);
  });

  it('emits start once and storm events as phases change', () => {
    const w = newRun(8);
    expect(w.events).toEqual([{ type: 'start' }]);
    w.events.length = 0;
    w.player.hearts = 1e9;
    const ev = step(w, Math.round(200 / SIM_DT));
    const storms = ev.filter((e): e is Extract<GameEvent, { type: 'storm' }> => e.type === 'storm').map((e) => e.phase);
    expect(storms.length).toBeGreaterThanOrEqual(6);
    expect(storms.slice(0, 3)).toEqual(['drizzle', 'downpour', 'calm']);
    expect(storms).toContain('cloudburst');
    expect(ev.filter((e) => e.type === 'start')).toHaveLength(0);
  });
});

describe('scoring', () => {
  it('earns one point per metre at x1', () => {
    const w = newRun();
    step(w, Math.round(10 / SIM_DT), { clean: true });
    expect(w.score).toBeCloseTo(w.distance / UNITS_PER_METER, 6);
    expect(summarize(w).score).toBe(Math.floor(w.score));
    expect(summarize(w).distanceM).toBe(Math.floor(w.distance / UNITS_PER_METER));
  });

  it('near-misses pay 25 × multiplier and build the combo, which decays', () => {
    const w = newRun();
    step(w, 10, { clean: true });
    const graze = 18 + ANT_HIT_R + NEAR_BAND / 2;
    landNext(w, graze);
    let ev = step(w, 1);
    expect(ev).toContainEqual(expect.objectContaining({ type: 'near-miss', combo: 1, points: 25 }));
    expect(w.multiplier).toBeCloseTo(1.25, 9);
    expect(w.comboTimer).toBeCloseTo(COMBO_TIME, 1);

    landNext(w, -graze);
    ev = step(w, 1);
    expect(ev).toContainEqual(expect.objectContaining({ type: 'near-miss', combo: 2, points: 31 }));
    expect(w.multiplier).toBeCloseTo(1.5, 9);

    // Distance points are multiplied.
    const s0 = w.score;
    const d0 = w.distance;
    step(w, 60, { clean: true });
    expect(w.score - s0).toBeCloseTo(((w.distance - d0) / UNITS_PER_METER) * 1.5, 6);

    ev = step(w, Math.round(COMBO_TIME / SIM_DT), { clean: true });
    expect(ev).toContainEqual({ type: 'combo-lost', combo: 2 });
    expect(w.combo).toBe(0);
    expect(w.multiplier).toBe(1);
    expect(w.maxCombo).toBe(2);
    expect(w.nearMisses).toBe(2);
  });

  it('misses beyond the band score nothing', () => {
    const w = newRun();
    step(w, 10, { clean: true });
    landNext(w, 18 + ANT_HIT_R + NEAR_BAND + 2);
    const ev = step(w, 1);
    expect(ev.filter((e) => e.type === 'near-miss' || e.type === 'hit')).toHaveLength(0);
    expect(ev).toContainEqual(expect.objectContaining({ type: 'drop-impact' }));
  });

  it('caps the multiplier at x5 and a hit resets the combo', () => {
    const w = newRun();
    step(w, 10, { clean: true });
    for (let i = 0; i < 20; i++) {
      landNext(w, (i % 2 ? 1 : -1) * (18 + ANT_HIT_R + 8));
      step(w, 1);
    }
    expect(w.combo).toBe(20);
    expect(w.multiplier).toBe(5);
    landNext(w, 0);
    const ev = step(w, 1);
    expect(ev).toContainEqual({ type: 'combo-lost', combo: 20 });
    expect(w.multiplier).toBe(1);
    expect(w.maxCombo).toBe(20);
  });

  it('a splash on the leaf that misses the ant only dampens it', () => {
    const w = newRun();
    step(w, 10, { clean: true });
    const wet0 = w.player.wet;
    landNext(w, ANT_HIT_R + 15 + 4, 0, 15);
    const ev = step(w, 1);
    expect(ev).toContainEqual(expect.objectContaining({ type: 'drop-impact', onLeaf: true }));
    expect(w.player.hearts).toBe(MAX_HEARTS);
    expect(w.player.wet).toBeGreaterThan(wet0);
  });

  it('marks every 100 m and fires new-best once, when the score (not the distance) beats the best', () => {
    // A farthest flag at 150 m and a best score of 180: at x1 the score is the
    // metre count, so the flag is passed first and must not count as a best.
    const w = newRun(3, { bestDistance: 150 * UNITS_PER_METER, bestScore: 180 });
    const ev: GameEvent[] = [];
    let flagAt = -1;
    let bestAt = -1;
    for (let i = 0; i < Math.round(110 / SIM_DT); i++) {
      for (const e of step(w, 1, { clean: true })) {
        ev.push(e);
        if (e.type === 'new-best') bestAt = Math.floor(w.score);
      }
      if (w.passedBest && flagAt < 0) flagAt = Math.floor(w.distance / UNITS_PER_METER);
    }
    const ms = ev.filter((e): e is Extract<GameEvent, { type: 'milestone' }> => e.type === 'milestone').map((e) => e.meters);
    expect(ms.slice(0, 2)).toEqual([100, 200]);
    expect(flagAt).toBe(150);
    expect(ev.filter((e) => e.type === 'new-best')).toHaveLength(1);
    expect(bestAt).toBe(181);
    expect(w.beatBest).toBe(true);

    // Passing the farthest flag alone is not a new best.
    const farOnly = newRun(3, { bestDistance: 50 * UNITS_PER_METER, bestScore: 1e9 });
    expect(step(farOnly, Math.round(30 / SIM_DT), { clean: true }).filter((e) => e.type === 'new-best')).toHaveLength(0);
    expect(farOnly.passedBest).toBe(true);
    // No board yet: nothing to beat.
    const fresh = newRun(3);
    expect(step(fresh, Math.round(110 / SIM_DT), { clean: true }).filter((e) => e.type === 'new-best')).toHaveLength(0);
  });
});

describe('view resize', () => {
  it('re-anchors the player and shifts entities with it', () => {
    const w = newRun(4);
    w.player.hearts = 1e9;
    step(w, Math.round(30 / SIM_DT));
    const rel = (x: World) => [...x.drops, ...x.obstacles].map((e) => e.y - x.player.y);
    const before = rel(w);
    setViewHeight(w, 1000);
    expect(w.player.y).toBe(1000 - 190);
    expect(w.viewH).toBe(1000);
    rel(w).forEach((v, i) => expect(v).toBeCloseTo(before[i], 9));
  });
});

describe('balance', () => {
  const SEEDS = Array.from({ length: 16 }, (_, i) => 1009 + i * 7919);

  it('idle survives the grace period but dies within a minute on most seeds', () => {
    const times = SEEDS.map((seed) => runSim(idle, { seed, maxTime: 120 }).time);
    for (const t of times) expect(t).toBeGreaterThan(5);
    expect(times.filter((t) => t < 60).length).toBeGreaterThanOrEqual(Math.ceil(SEEDS.length * 0.85));
    const m = median(times);
    expect(m).toBeGreaterThan(12);
    expect(m).toBeLessThan(35);
  });

  it('a dodging bot (keyboard speed, 0.2 s reaction) lasts far longer, but not forever', () => {
    const bot: number[] = [];
    const idleT: number[] = [];
    for (const seed of SEEDS.slice(0, 10)) {
      idleT.push(runSim(idle, { seed, maxTime: 120 }).time);
      bot.push(runSim(createDodgeBot(), { seed, maxTime: 600 }).time);
    }
    bot.forEach((t, i) => expect(t).toBeGreaterThan(idleT[i] * 2));
    expect(bot.filter((t) => t >= 60).length).toBeGreaterThanOrEqual(9);
    expect(median(bot)).toBeGreaterThan(90);
    // Difficulty keeps rising: even this tireless bot does not survive 10 minutes.
    expect(Math.max(...bot)).toBeLessThan(600);
  });
});
