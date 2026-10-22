// Small math helpers shared by the render modules.

export const TAU = Math.PI * 2;

export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smoothstep = (t: number): number => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};
export const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
export const easeInCubic = (t: number): number => t * t * t;
/** Overshoots past 1 then settles: the "pop" of floating text. */
export const easeOutBack = (t: number): number => {
  const c = 1.9;
  const x = t - 1;
  return 1 + (c + 1) * x * x * x + c * x * x;
};
export const frac = (v: number): number => v - Math.floor(v);

/**
 * Deterministic hash of (seed, i, j) to [0, 1). Scenery is placed with this so it
 * is stable frame to frame and identical for everyone on the same seed.
 */
export function hash(seed: number, i: number, j = 0): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(i | 0, 0xc2b2ae35) ^ Math.imul(j | 0, 0x27d4eb2f);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Small seeded PRNG for sprite generation (not used in hot paths). */
export function makeRand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
