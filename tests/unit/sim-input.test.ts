// The frame → fixed-step bridge: relative drag must reach the simulation
// exactly once whatever the display's refresh rate (120+ Hz screens run
// frames with no simulation step at all).

import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../../src/config';
import { createFrameStepper } from '../../src/engine/loop';
import { SimInput } from '../../src/engine/sim-input';
import { createWorld, stepWorld } from '../../src/game/world';
import type { InputFrame } from '../../src/types';

/** Frame timestamps (ms) at `hz` for `seconds`, with optional deterministic jitter. */
function frames(hz: number, seconds: number, jitterMs = 0): number[] {
  const out: number[] = [];
  const n = Math.round(hz * seconds);
  for (let i = 1; i <= n; i++) {
    const j = jitterMs ? Math.sin(i * 12.9898) * jitterMs : 0;
    out.push((i * 1000) / hz + j);
  }
  return out;
}

/** Feeds `perFrame` units of drag every frame through the real loop stepper; returns what the steps received. */
function drive(times: number[], perFrame: number): { fed: number; consumed: number; pending: number; zeroStepFrames: number } {
  const sim = new SimInput();
  const frame: InputFrame = { steerDelta: 0, axis: 0, absoluteX: null };
  let fed = 0;
  let consumed = 0;
  let stepsThisFrame = 0;
  let zeroStepFrames = 0;
  const tick = createFrameStepper(
    {
      update() {
        frame.steerDelta = perFrame;
        fed += perFrame;
        sim.feed(frame);
        stepsThisFrame = 0;
      },
      step() {
        consumed += sim.take().steerDelta;
        stepsThisFrame++;
      },
      render() {
        if (stepsThisFrame === 0) zeroStepFrames++;
      },
    },
    0,
  );
  for (const t of times) tick(t);
  return { fed, consumed, pending: sim.pendingDrag, zeroStepFrames };
}

describe('SimInput: drag across refresh rates', () => {
  const cases: [string, number, number][] = [
    ['60 Hz', 60, 0],
    ['120 Hz ±0.5 ms jitter', 120, 0.5],
    ['144 Hz', 144, 0],
    ['165 Hz', 165, 0],
    ['240 Hz', 240, 0],
  ];

  for (const [name, hz, jitter] of cases) {
    it(`${name}: every unit of drag reaches a step exactly once`, () => {
      const r = drive(frames(hz, 2, jitter), 1);
      expect(r.consumed + r.pending).toBeCloseTo(r.fed, 9);
      // Only the frames since the last step can still be waiting for one.
      expect(r.pending).toBeLessThanOrEqual(Math.ceil(hz * SIM_DT) + 1e-9);
    });
  }

  it('144 Hz really has frames without a step (the case that used to lose drag)', () => {
    expect(drive(frames(144, 1), 1).zeroStepFrames).toBeGreaterThan(20);
  });

  it('moves the leaf target by the full drag at 144 Hz', () => {
    const world = createWorld({ mode: 'endless', seed: 7, dailyId: null, bestDistance: 0, viewH: 800 });
    const x0 = world.player.targetX;
    const sim = new SimInput();
    const frame: InputFrame = { steerDelta: 0, axis: 0, absoluteX: null };
    let fed = 0;
    const tick = createFrameStepper(
      {
        update() {
          frame.steerDelta = 0.25;
          fed += 0.25;
          sim.feed(frame);
        },
        step(dt) {
          stepWorld(world, sim.take(), dt);
          world.events.length = 0;
        },
        render() {},
      },
      0,
    );
    for (const t of frames(144, 1)) tick(t);
    expect(fed).toBeGreaterThan(30);
    expect(world.player.targetX - x0).toBeCloseTo(fed - sim.pendingDrag, 6);
    expect(SIM_DT).toBeCloseTo(1 / 120, 9);
  });

  it('discard() drops drag made while frozen (pause, countdown)', () => {
    const sim = new SimInput();
    sim.feed({ steerDelta: 40, axis: 0, absoluteX: null });
    sim.discard();
    expect(sim.take().steerDelta).toBe(0);
  });

  it('axis and mouse target are states: the latest frame wins', () => {
    const sim = new SimInput();
    sim.feed({ steerDelta: 0, axis: 1, absoluteX: 120 });
    sim.feed({ steerDelta: 0, axis: -0.5, absoluteX: null });
    const f = sim.take();
    expect(f.axis).toBe(-0.5);
    expect(f.absoluteX).toBeNull();
  });
});
