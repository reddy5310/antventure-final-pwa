import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../../src/config';
import {
  difficultyAt,
  GENTLE_TIME,
  GRACE_TIME,
  LEVEL_MAX,
  levelAt,
  RAMP_TIME,
  timeAtDistance,
} from '../../src/game/difficulty';

describe('difficulty curve', () => {
  it('starts at 0, reaches 1 at the end of the ramp and keeps creeping up', () => {
    expect(levelAt(0)).toBe(0);
    expect(levelAt(RAMP_TIME)).toBeCloseTo(1, 6);
    expect(levelAt(RAMP_TIME + 60)).toBeGreaterThan(1);
    expect(levelAt(10_000)).toBe(LEVEL_MAX);
  });

  it('is monotonic', () => {
    let prev = -1;
    for (let t = 0; t <= 900; t += 0.5) {
      const l = levelAt(t);
      expect(l).toBeGreaterThanOrEqual(prev);
      prev = l;
    }
  });

  it('is gentle early and ramps scroll speed from ~110 to ~250', () => {
    expect(levelAt(15)).toBeLessThan(0.06);
    expect(difficultyAt(0).scroll).toBeCloseTo(110, 0);
    expect(difficultyAt(RAMP_TIME).scroll).toBeCloseTo(250, 0);
    expect(difficultyAt(600).scroll).toBeLessThan(290);
  });

  it('shortens the telegraph from ~1.05 s to a 0.6 s floor', () => {
    expect(difficultyAt(0).fall).toBeCloseTo(1.05, 2);
    expect(difficultyAt(RAMP_TIME).fall).toBeCloseTo(0.6, 2);
    expect(difficultyAt(900).fall).toBeGreaterThanOrEqual(0.6);
  });

  it('has a no-drop grace period and full rates after the gentle phase', () => {
    expect(difficultyAt(0).grace).toBe(0);
    expect(difficultyAt(GRACE_TIME - 0.01).grace).toBe(0);
    expect(difficultyAt(GRACE_TIME + 0.01).grace).toBeGreaterThan(0);
    expect(difficultyAt(GENTLE_TIME).grace).toBe(1);
  });

  it('keeps patterns locked at the start and unlocks them later', () => {
    expect(difficultyAt(5).patternInterval).toBe(Infinity);
    expect(Number.isFinite(difficultyAt(90).patternInterval)).toBe(true);
    expect(difficultyAt(300).patternInterval).toBeLessThan(difficultyAt(90).patternInterval);
  });

  it('can fill a caller-owned object without allocating', () => {
    const out = difficultyAt(0);
    const same = difficultyAt(42, out);
    expect(same).toBe(out);
    expect(out.level).toBeCloseTo(levelAt(42), 9);
  });

  it('inverts distance to time consistently with the per-step integration', () => {
    let d = 0;
    let t = 0;
    const checkpoints = [10, 60, 200, 400];
    for (const target of checkpoints) {
      while (t < target - 1e-9) {
        t += SIM_DT;
        d += difficultyAt(t).scroll * SIM_DT;
      }
      expect(Math.abs(timeAtDistance(d) - t)).toBeLessThan(0.05);
    }
  });
});
