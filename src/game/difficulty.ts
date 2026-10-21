// The difficulty curve: a pure function of run time, so every run (and every
// Daily River attempt) ramps identically. Rises smoothly over the first ~3
// minutes, then keeps creeping up so even expert runs eventually end.

import type { StormPhase } from '../types';

export interface Difficulty {
  /** 0..1 across the first RAMP_TIME seconds, then slow growth up to LEVEL_MAX. */
  level: number;
  /** River speed (u/s). */
  scroll: number;
  /** Telegraph length of single drops (s). */
  fall: number;
  /** Single drops per second, before storm phase and grace multipliers. */
  dropRate: number;
  /** Share of single drops aimed at the player. */
  aimedShare: number;
  /** Seconds between drop patterns (Infinity until patterns unlock). */
  patternInterval: number;
  /** River units between obstacles. */
  obstacleGap: number;
  twigChance: number;
  gateChance: number;
  /** 0..1 early-run softener: no drops for the first GRACE_TIME, full rate by GENTLE_TIME. */
  grace: number;
}

export const RAMP_TIME = 180;
export const LEVEL_MAX = 1.6;
/** Seconds after RAMP_TIME to go from level 1 to LEVEL_MAX. */
const OVERTIME_SPAN = 300;
export const GRACE_TIME = 2.5;
export const GENTLE_TIME = 15;
const PATTERN_UNLOCK = 0.1;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Difficulty level for a run time (s). Monotonic. */
export function levelAt(timeS: number): number {
  const t = Math.max(0, timeS);
  if (t >= RAMP_TIME) return Math.min(LEVEL_MAX, 1 + ((LEVEL_MAX - 1) * (t - RAMP_TIME)) / OVERTIME_SPAN);
  const b = t / RAMP_TIME;
  // Linear + smoothstep blend: a gentle start that still moves noticeably
  // inside the first minute, the steepest part around the 90 s mark.
  return 0.4 * b + 0.6 * b * b * (3 - 2 * b);
}

/** Scroll speed is a pure function of time; exported so distance can be inverted. */
export function scrollAtLevel(level: number): number {
  return 110 + 140 * Math.min(level, 1) + 30 * Math.max(0, level - 1);
}

export function createDifficulty(): Difficulty {
  return {
    level: 0,
    scroll: 110,
    fall: 1.05,
    dropRate: 0,
    aimedShare: 0,
    patternInterval: Infinity,
    obstacleGap: 560,
    twigChance: 0,
    gateChance: 0,
    grace: 0,
  };
}

/** Fills `out` (or a new object) with the difficulty at `timeS`. Allocation-free when `out` is given. */
export function difficultyAt(timeS: number, out: Difficulty = createDifficulty()): Difficulty {
  const level = levelAt(timeS);
  const l1 = Math.min(level, 1);
  const over = Math.max(0, level - 1);
  out.level = level;
  out.scroll = scrollAtLevel(level);
  out.fall = lerp(1.05, 0.6, l1);
  out.dropRate = lerp(1.1, 2.2, l1) + 1.6 * over;
  out.aimedShare = Math.min(0.75, lerp(0.22, 0.45, l1) + 0.2 * over);
  out.patternInterval =
    level < PATTERN_UNLOCK ? Infinity : lerp(10, 4.2, clamp01((level - PATTERN_UNLOCK) / (1 - PATTERN_UNLOCK))) * (1 - 0.4 * over);
  out.obstacleGap = lerp(560, 270, l1) - 40 * over;
  out.twigChance = lerp(0.2, 0.45, l1);
  out.gateChance = level < 0.3 ? 0 : lerp(0.08, 0.22, clamp01((level - 0.3) / 0.7));
  const g = clamp01((timeS - GRACE_TIME) / (GENTLE_TIME - GRACE_TIME));
  out.grace = timeS < GRACE_TIME ? 0 : 0.6 + 0.4 * g * g * (3 - 2 * g);
  return out;
}

// --- Storm phase modifiers --------------------------------------------------

export interface PhaseMods {
  /** Multiplies the single-drop rate. */
  rate: number;
  /** Multiplies the pattern interval (Infinity = no patterns). */
  patternInterval: number;
  /** Added to the aimed share. */
  aimed: number;
  /** Base storm intensity before the difficulty contribution. */
  intensity: number;
}

export const PHASE_MODS: Readonly<Record<StormPhase, Readonly<PhaseMods>>> = {
  calm: { rate: 0.55, patternInterval: Infinity, aimed: -0.05, intensity: 0.1 },
  drizzle: { rate: 0.8, patternInterval: 1.4, aimed: 0, intensity: 0.34 },
  downpour: { rate: 1.12, patternInterval: 1, aimed: 0.05, intensity: 0.6 },
  cloudburst: { rate: 1.45, patternInterval: 0.65, aimed: 0.1, intensity: 0.86 },
};

// --- Distance <-> time --------------------------------------------------------
// Obstacles are laid out along the river (so they sit in the same place on
// every screen size), but their density should follow the time-based curve.
// While a run is alive distance(t) is input-independent, so we can tabulate it.

const TABLE_DT = 0.25;
const TABLE_T_MAX = 1200;
const distTable = (() => {
  const n = Math.ceil(TABLE_T_MAX / TABLE_DT) + 1;
  const table = new Float64Array(n);
  let d = 0;
  for (let i = 1; i < n; i++) {
    // Trapezoid over each slice; scroll is smooth so this is plenty accurate.
    const a = scrollAtLevel(levelAt((i - 1) * TABLE_DT));
    const b = scrollAtLevel(levelAt(i * TABLE_DT));
    d += ((a + b) / 2) * TABLE_DT;
    table[i] = d;
  }
  return table;
})();

/** Run time at which a living run has travelled `distance` units. */
export function timeAtDistance(distance: number): number {
  if (distance <= 0) return 0;
  const last = distTable.length - 1;
  if (distance >= distTable[last]) {
    return TABLE_T_MAX + (distance - distTable[last]) / scrollAtLevel(LEVEL_MAX);
  }
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (distTable[mid] <= distance) lo = mid;
    else hi = mid;
  }
  const f = (distance - distTable[lo]) / (distTable[hi] - distTable[lo]);
  return (lo + f) * TABLE_DT;
}
