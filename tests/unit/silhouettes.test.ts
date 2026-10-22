// Obstacle silhouettes (src/render/silhouettes.ts): the night outline and the day
// sprite are built from the same shapes, so a rock outlined in the dark is the
// rock the player will hit.

import { describe, expect, it } from 'vitest';
import {
  PAD_R0,
  PAD_VARIANTS,
  ROCK_R0,
  ROCK_VARIANTS,
  padIndex,
  padNotch,
  padSeed,
  rockIndex,
  rockSeed,
  rockShape,
  tracePad,
  traceRock,
} from '../../src/render/silhouettes';

/** Records path calls (Path2D does not exist in the node test environment). */
function recorder() {
  const calls: string[] = [];
  const path = {
    moveTo: () => calls.push('move'),
    quadraticCurveTo: () => calls.push('curve'),
    arc: (_x: number, _y: number, r: number) => calls.push(`arc:${r}`),
    closePath: () => calls.push('close'),
  } as unknown as CanvasPath;
  return { calls, path };
}

describe('rock silhouettes', () => {
  it('are deterministic per seed and differ between variants', () => {
    const a = rockShape(rockSeed(0));
    const b = rockShape(rockSeed(0));
    expect(a.rs).toEqual(b.rs);
    expect(rockShape(rockSeed(1)).rs).not.toEqual(a.rs);
  });

  it('stay within the collision circle the sim uses (radii 0.8..1.06 of R0, mean ~0.93)', () => {
    let sum = 0;
    let n = 0;
    for (let v = 0; v < ROCK_VARIANTS; v++) {
      const { rs, verts } = rockShape(rockSeed(v));
      expect(verts).toBeGreaterThanOrEqual(7);
      expect(verts).toBeLessThanOrEqual(9);
      for (const r of rs) {
        expect(r).toBeGreaterThanOrEqual(ROCK_R0 * 0.8);
        expect(r).toBeLessThanOrEqual(ROCK_R0 * 1.06);
        sum += r / ROCK_R0;
        n++;
      }
    }
    expect(sum / n).toBeGreaterThan(0.88);
    expect(sum / n).toBeLessThan(0.98);
  });

  it('leave the generator positioned after the shape, so the sprite details keep their sequence', () => {
    const shape = rockShape(rockSeed(2));
    const again = rockShape(rockSeed(2));
    // Both continue from the same state: the next draw is identical, and not a repeat of the first radius.
    expect(shape.rand()).toBe(again.rand());
    expect(shape.rand()).not.toBe(shape.rs[0] / ROCK_R0);
  });

  it('trace one smooth closed curve through every corner', () => {
    const shape = rockShape(rockSeed(3));
    const { calls, path } = recorder();
    traceRock(path, shape, 1);
    expect(calls[0]).toBe('move');
    expect(calls.filter((c) => c === 'curve')).toHaveLength(shape.verts);
    expect(calls[calls.length - 1]).toBe('close');
  });
});

describe('lily pad silhouettes', () => {
  it('cut a stable notch wedge per variant', () => {
    for (let v = 0; v < PAD_VARIANTS; v++) {
      const n = padNotch(padSeed(v));
      expect(n).toBeGreaterThanOrEqual(0.3);
      expect(n).toBeLessThan(0.46);
      expect(padNotch(padSeed(v))).toBe(n);
    }
  });

  it('trace a disc at the requested radius with the wedge cut out', () => {
    const { calls, path } = recorder();
    tracePad(path, 0.4, PAD_R0);
    expect(calls).toEqual(['move', `arc:${PAD_R0}`, 'close']);
  });
});

describe('variant indices', () => {
  it('map an obstacle variant in [0, 1] onto a valid sprite index', () => {
    for (const v of [0, 0.0001, 0.5, 0.9999, 1]) {
      expect(rockIndex(v)).toBeGreaterThanOrEqual(0);
      expect(rockIndex(v)).toBeLessThan(ROCK_VARIANTS);
      expect(padIndex(v)).toBeGreaterThanOrEqual(0);
      expect(padIndex(v)).toBeLessThan(PAD_VARIANTS);
    }
    expect(rockIndex(0)).toBe(0);
    expect(rockIndex(1)).toBe(ROCK_VARIANTS - 1);
    expect(padIndex(1)).toBe(PAD_VARIANTS - 1);
  });
});
