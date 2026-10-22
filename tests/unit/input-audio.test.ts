// Pure audio helpers (the platform agent's area alongside input).

import { describe, expect, it } from 'vitest';
import { midiToHz, pentatonicHz } from '../../src/audio/kit';
import { findLoopPoints } from '../../src/audio/loop-points';

const RATE = 8000;

/** A tone at `db` dBFS for `seconds`, with optional silent padding and a closing linear fade. */
function track(opts: { seconds: number; lead?: number; trail?: number; fade?: number }): Float32Array {
  const lead = Math.round((opts.lead ?? 0) * RATE);
  const body = Math.round(opts.seconds * RATE);
  const trail = Math.round((opts.trail ?? 0) * RATE);
  const fade = Math.round((opts.fade ?? 0) * RATE);
  const out = new Float32Array(lead + body + trail);
  for (let i = 0; i < body; i++) {
    const k = fade && i >= body - fade ? (body - i) / fade : 1;
    out[lead + i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / RATE) * k * k;
  }
  return out;
}

describe('findLoopPoints', () => {
  it('handles empty and silent input', () => {
    expect(findLoopPoints([], RATE)).toEqual({ start: 0, end: 0, segue: 0 });
    const silent = findLoopPoints([new Float32Array(RATE)], RATE);
    expect(silent.start).toBe(0);
    expect(silent.end).toBeCloseTo(1, 5);
  });

  it('trims leading and trailing silence; a seamless loop segues at its end', () => {
    const lp = findLoopPoints([track({ seconds: 10, lead: 0.4, trail: 0.2 })], RATE);
    expect(lp.start).toBeGreaterThan(0.39);
    expect(lp.start).toBeLessThan(0.41);
    expect(lp.end).toBeGreaterThan(10.39);
    expect(lp.end).toBeLessThan(10.41);
    expect(lp.segue).toBe(lp.end);
  });

  it('finds where a closing fade begins', () => {
    const lp = findLoopPoints([track({ seconds: 30, lead: 0.3, fade: 3 })], RATE);
    // The body ends at 27.3 s; the segue lands inside the first part of the fade.
    expect(lp.segue).toBeGreaterThan(27.2);
    expect(lp.segue).toBeLessThan(29);
    expect(lp.segue).toBeLessThan(lp.end);
  });

  it('uses the loudest channel and caps very long tails', () => {
    const quiet = new Float32Array(RATE * 40);
    const loud = track({ seconds: 40, fade: 20 });
    const lp = findLoopPoints([quiet, loud], RATE);
    expect(lp.end - lp.segue).toBeLessThanOrEqual(8.01);
  });
});

describe('pentatonicHz', () => {
  it('climbs the A major pentatonic from the root', () => {
    expect(pentatonicHz(69, 0)).toBeCloseTo(440, 6);
    expect(pentatonicHz(69, 1)).toBeCloseTo(midiToHz(71), 6);
    expect(pentatonicHz(69, 4)).toBeCloseTo(midiToHz(78), 6);
    expect(pentatonicHz(69, 5)).toBeCloseTo(880, 6);
    expect(pentatonicHz(69, -3)).toBeCloseTo(440, 6);
  });

  it('is strictly rising', () => {
    for (let i = 1; i < 20; i++) expect(pentatonicHz(69, i)).toBeGreaterThan(pentatonicHz(69, i - 1));
  });
});
