// The renderer's view of the zones (src/render/zonelook.ts): per-frame zone
// weights must agree with the sim's zoneAt() everywhere on screen, whatever part
// of a transition the view happens to cover, so the next zone's scenery scrolls
// in exactly where the sim will put the zone.

import { describe, expect, it } from 'vitest';
import { UNITS_PER_METER } from '../../src/config';
import { BLEND_M, createZoneSample, zoneAt } from '../../src/game/zones';
import type { Gfx } from '../../src/render/gfx';
import { EdgeWeights, frameLook, ZoneLook } from '../../src/render/zonelook';
import type { ZoneId } from '../../src/types';

const U = UNITS_PER_METER;
const BLEND_U = BLEND_M * U;
const ZONE_IDS: ZoneId[] = ['jungle', 'marsh', 'rapids', 'night'];
const SEEDS = [1, 2026, 777, 31337, 4242, 99];
const PY = 650;

/** The few Gfx fields ZoneLook reads, for a view `viewH` tall with the leaf at river distance `dist`. */
function fakeGfx(seed: number, dist: number, viewH = 800): Gfx {
  return {
    seed,
    dist,
    py: PY,
    viewH,
    yOfD: (d: number) => PY - (d - dist),
  } as unknown as Gfx;
}

const sample = createZoneSample();

/** What the sim says the mix of `zone` is at river distance `d`. */
function expectedWeight(seed: number, d: number, zone: ZoneId): number {
  const s = zoneAt(seed, d, sample);
  if (s.blend === 0) return s.zone === zone ? 1 : 0;
  return (s.zone === zone ? 1 - s.blend : 0) + (s.next === zone ? s.blend : 0);
}

/** Leaf distances at which a view covers every part of the first transitions: before, across and after. */
function windowsAround(seed: number): number[] {
  const out: number[] = [];
  let prev = zoneAt(seed, 0, sample).index;
  for (let d = 0; d < 60_000; d += 10) {
    const i = zoneAt(seed, d, sample).index;
    if (i === prev) continue;
    prev = i;
    // The boundary is at about d; slide the leaf from well before it to well after the blend ends.
    for (let off = -1400; off <= BLEND_U + 1400; off += 137) out.push(d + off);
    if (out.length > 120) break;
  }
  return out;
}

describe('ZoneLook', () => {
  it('weights agree with the sim zones across the whole view, over transitions', () => {
    for (const seed of SEEDS) {
      const look = new ZoneLook();
      for (const dist of windowsAround(seed)) {
        const g = fakeGfx(seed, dist);
        look.update(g);
        const dTop = dist + PY;
        const dBot = dist + PY - g.viewH;
        for (let d = dBot; d <= dTop; d += 23) {
          let total = 0;
          for (const z of ZONE_IDS) {
            const w = look.weightAt(z, d);
            total += w;
            expect(Math.abs(w - expectedWeight(seed, Math.max(0, d), z)), `seed ${seed} dist ${dist} d ${d} ${z}`).toBeLessThan(0.01);
          }
          if (d >= 0) expect(total).toBeCloseTo(1, 5);
        }
      }
    }
  });

  it('is flat inside a zone and reports a transition across a boundary', () => {
    const seed = 2026;
    // Mid-Jungle: the opening 120 m.
    const look = new ZoneLook();
    look.update(fakeGfx(seed, 2000));
    expect(look.flat).toBe(true);
    expect(look.a).toBe('jungle');
    expect(look.involves('jungle')).toBe(true);
    expect(look.involves('night')).toBe(false);
    // Find the first boundary and put it mid-screen.
    let boundary = 0;
    for (let d = 0; d < 20_000; d += 5) {
      if (zoneAt(seed, d, sample).index === 1) {
        boundary = d;
        break;
      }
    }
    look.update(fakeGfx(seed, boundary - PY + 400));
    expect(look.flat).toBe(false);
    expect(look.a).toBe('jungle');
    expect(look.b).toBe(zoneAt(seed, boundary + BLEND_U + 10, sample).zone);
    expect(Math.abs(look.start - boundary)).toBeLessThan(6);
    // The transition's screen span is BLEND_U tall, blend 0 below blend 1.
    expect(look.yFrom - look.yTo).toBeCloseTo(BLEND_U, 3);
  });

  it('dithers scenery slots by the blend and settles on the old/new zone either side', () => {
    const seed = 777;
    const look = new ZoneLook();
    let boundary = 0;
    for (let d = 0; d < 20_000; d += 5) {
      if (zoneAt(seed, d, sample).index === 1) {
        boundary = d;
        break;
      }
    }
    look.update(fakeGfx(seed, boundary - PY + 500));
    expect(look.flat).toBe(false);
    expect(look.pickAt(look.start - 300, 0.5)).toBe(look.a);
    expect(look.pickAt(look.start + BLEND_U + 300, 0.5)).toBe(look.b);
    // Halfway through, a low hash takes the new zone and a high one keeps the old.
    const mid = look.start + BLEND_U / 2;
    expect(look.pickAt(mid, 0.1)).toBe(look.b);
    expect(look.pickAt(mid, 0.9)).toBe(look.a);
  });

  it('recomputes only when the river window moves (frameLook memoises per window)', () => {
    const g = fakeGfx(5, 1000);
    const a = frameLook(g);
    const again = frameLook(g);
    expect(again).toBe(a);
    const moved = frameLook(fakeGfx(5, 20_000));
    expect(moved).toBe(a);
  });
});

describe('EdgeWeights', () => {
  it('is empty when the zone is not in view and fills one weight per sample otherwise', () => {
    const seed = 4242;
    const look = new ZoneLook();
    const ew = new EdgeWeights();
    // A fake Gfx with the samples EdgeWeights reads.
    const g = { ...fakeGfx(seed, 2000), n: 40, k0: Math.floor((2000 - 400) / 12) } as unknown as Gfx;
    look.update(g);
    ew.fill(g, look, 'night');
    expect(ew.any).toBe(false);
    ew.fill(g, look, 'jungle');
    expect(ew.any).toBe(true);
    for (let i = 0; i < 40; i++) expect(ew.w[i]).toBe(1);
  });
});
