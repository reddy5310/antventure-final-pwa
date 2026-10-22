import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../../src/config';
import { leafLimits, reachIn } from '../../src/game/player';
import { KEY_SPEED, MAX_LEAF_SPEED } from '../../src/game/tuning';
import { createWorld, stepWorld } from '../../src/game/world';
import type { GameEvent, InputFrame, World } from '../../src/types';

const NONE: InputFrame = { steerDelta: 0, axis: 0, absoluteX: null };

function run(world: World, input: InputFrame | ((i: number) => InputFrame), steps: number): GameEvent[] {
  const out: GameEvent[] = [];
  for (let i = 0; i < steps; i++) {
    stepWorld(world, typeof input === 'function' ? input(i) : input, SIM_DT);
    out.push(...world.events);
    world.events.length = 0;
  }
  return out;
}

const newRun = (seed = 7) => createWorld({ mode: 'endless', seed, dailyId: null, bestDistance: 0, viewH: 800 });

describe('steering', () => {
  it('reach table grows with time and approaches keyboard speed', () => {
    expect(reachIn(0)).toBe(0);
    expect(reachIn(0.1)).toBeGreaterThan(0);
    expect(reachIn(0.5)).toBeGreaterThan(reachIn(0.25));
    const slope = (reachIn(1.5) - reachIn(1)) / 0.5;
    expect(slope).toBeCloseTo(KEY_SPEED, 0);
  });

  it('a short key tap nudges much less than a held key', () => {
    const tap = newRun();
    const x0 = tap.player.x;
    run(tap, (i) => (i < 4 ? { ...NONE, axis: 1 } : NONE), 60);
    const hold = newRun();
    run(hold, { ...NONE, axis: 1 }, 60);
    const tapMove = tap.player.x - x0;
    expect(tapMove).toBeGreaterThan(1);
    expect(tapMove).toBeLessThan(12);
    expect(hold.player.x - x0).toBeGreaterThan(tapMove * 8);
  });

  it('never exceeds the leaf speed cap, even when the mouse jumps', () => {
    const w = newRun();
    let maxV = 0;
    for (let i = 0; i < 240; i++) {
      stepWorld(w, { ...NONE, absoluteX: i % 60 < 30 ? 20 : 380 }, SIM_DT);
      w.events.length = 0;
      maxV = Math.max(maxV, Math.abs(w.player.vx));
    }
    expect(maxV).toBeLessThanOrEqual(MAX_LEAF_SPEED + 1e-6);
    expect(maxV).toBeGreaterThan(MAX_LEAF_SPEED * 0.9);
  });

  it('touch drag moves the target by the delta', () => {
    const w = newRun();
    const x0 = w.player.targetX;
    stepWorld(w, { ...NONE, steerDelta: 30 }, SIM_DT);
    expect(w.player.targetX).toBeCloseTo(x0 + 30, 6);
    run(w, NONE, 60);
    expect(w.player.x).toBeCloseTo(x0 + 30, 0);
  });

  it('keeps the leaf inside the banks and bumps once per contact', () => {
    const w = newRun();
    const events = run(w, { ...NONE, axis: -1 }, 240);
    const lim = { lo: 0, hi: 0 };
    leafLimits(w, lim);
    expect(w.player.x).toBeGreaterThanOrEqual(lim.lo - 1e-6);
    expect(w.player.x).toBeLessThan(lim.lo + 3);
    const bumps = events.filter((e) => e.type === 'bank-bump');
    expect(bumps).toHaveLength(1);
    expect(bumps[0]).toMatchObject({ side: -1 });
    // Let go and push again: a new contact bumps again.
    run(w, { ...NONE, axis: 1 }, 30);
    const again = run(w, { ...NONE, axis: -1 }, 120).filter((e) => e.type === 'bank-bump');
    expect(again).toHaveLength(1);
  });

  it('tilts with horizontal speed', () => {
    const w = newRun();
    run(w, { ...NONE, axis: 1 }, 30);
    expect(w.player.tilt).toBeGreaterThan(0.1);
    run(w, NONE, 240);
    expect(Math.abs(w.player.tilt)).toBeLessThan(0.02);
  });
});

describe('attract mode', () => {
  it('scrolls, meanders by itself and never spawns hazards or events', () => {
    const w = createWorld({ mode: 'endless', seed: 3, dailyId: null, bestDistance: 0, viewH: 800, attract: true });
    expect(w.state).toBe('attract');
    expect(w.events).toHaveLength(0);
    const xs: number[] = [];
    const events = run(
      w,
      (i) => {
        if (i % 60 === 0) xs.push(w.player.x);
        return { steerDelta: 50, axis: 1, absoluteX: 0 };
      },
      120 * 60,
    );
    expect(events).toHaveLength(0);
    expect(w.drops).toHaveLength(0);
    expect(w.obstacles).toHaveLength(0);
    expect(w.distance).toBeCloseTo(70 * 60, -1);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(40);
    const lim = { lo: 0, hi: 0 };
    leafLimits(w, lim);
    expect(w.player.x).toBeGreaterThanOrEqual(lim.lo);
    expect(w.player.x).toBeLessThanOrEqual(lim.hi);
  });
});
