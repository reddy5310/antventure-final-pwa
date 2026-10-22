// Canvas density: the pixel budget and the adaptive quality governor.

import { describe, expect, it } from 'vitest';
import { QUALITY_STEPS, QualityGovernor } from '../../src/engine/quality';
import { pickDpr } from '../../src/engine/viewport';

describe('pickDpr', () => {
  it('keeps phones at 2x and never goes below 1x', () => {
    expect(pickDpr(390, 844, 3)).toBe(2);
    expect(pickDpr(1280, 800, 1)).toBe(1);
    expect(pickDpr(2560, 1440, 2)).toBe(1);
  });

  it('caps large high-density screens by total pixels', () => {
    const dpr = pickDpr(1512, 982, 2);
    expect(dpr).toBeLessThan(2);
    expect(1512 * 982 * dpr * dpr).toBeLessThanOrEqual(3.5e6 + 1);
  });

  it('honours an extra cap (the quality governor)', () => {
    expect(pickDpr(390, 844, 3, 1.5)).toBe(1.5);
  });
});

/** Feeds `seconds` of frames whose intervals come from `dt(i)`. */
function feed(gov: QualityGovernor, seconds: number, dt: (i: number) => number, active = true): void {
  let t = 0;
  for (let i = 0; t < seconds; i++) {
    const d = dt(i);
    gov.sample(d, active);
    t += d;
  }
}

describe('QualityGovernor', () => {
  it('leaves a 60 fps device alone', () => {
    const steps: number[] = [];
    const gov = new QualityGovernor((c) => steps.push(c));
    feed(gov, 30, () => 1 / 60);
    expect(steps).toEqual([]);
    expect(gov.cap).toBe(QUALITY_STEPS[0]);
  });

  it('does not mistake a steady 30 fps cap (low power mode) for a slow device', () => {
    const steps: number[] = [];
    const gov = new QualityGovernor((c) => steps.push(c));
    feed(gov, 30, (i) => 1 / 30 + (i % 2 ? 0.0004 : -0.0004));
    expect(steps).toEqual([]);
  });

  it('steps down one notch after sustained uneven slow frames, and only while active', () => {
    const steps: number[] = [];
    const gov = new QualityGovernor((c) => steps.push(c));
    const uneven = (i: number) => (i % 3 === 0 ? 0.04 : 0.018);
    feed(gov, 10, uneven, false);
    expect(steps).toEqual([]);
    feed(gov, 3.5, uneven);
    expect(steps).toEqual([QUALITY_STEPS[1]]);
    feed(gov, 3.5, uneven);
    expect(steps).toEqual([QUALITY_STEPS[1], QUALITY_STEPS[2]]);
    // Never below the last step, never back up.
    feed(gov, 20, uneven);
    expect(steps).toHaveLength(2);
  });
});
