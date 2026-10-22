// Score, near-miss combos and progress events.
//   score = metres × multiplier + near-miss bonuses × multiplier
//   multiplier = 1 + COMBO_STEP × min(combo, COMBO_CAP)   (x1 … x5)

import { UNITS_PER_METER } from '../config';
import type { World } from '../types';
import type { SimState } from './state';
import { COMBO_CAP, COMBO_STEP, COMBO_TIME, MILESTONE_M, NEAR_MISS_POINTS } from './tuning';

export function multiplierFor(combo: number): number {
  return 1 + COMBO_STEP * Math.min(combo, COMBO_CAP);
}

/** Distance points: 1 per metre, multiplied. Kept fractional; summaries floor it. */
export function addDistanceScore(world: World, units: number): void {
  world.score += (units / UNITS_PER_METER) * world.multiplier;
}

export function registerNearMiss(world: World, x: number, y: number): void {
  // Paid at the multiplier the player had earned so far, then the combo grows.
  const points = Math.round(NEAR_MISS_POINTS * world.multiplier);
  world.score += points;
  world.combo++;
  world.comboTimer = COMBO_TIME;
  world.multiplier = multiplierFor(world.combo);
  world.nearMisses++;
  if (world.combo > world.maxCombo) world.maxCombo = world.combo;
  world.events.push({ type: 'near-miss', x, y, combo: world.combo, points });
}

export function breakCombo(world: World): void {
  if (world.combo >= 2) world.events.push({ type: 'combo-lost', combo: world.combo });
  world.combo = 0;
  world.comboTimer = 0;
  world.multiplier = 1;
}

export function updateCombo(world: World, dt: number): void {
  if (world.combo <= 0) return;
  world.comboTimer -= dt;
  if (world.comboTimer <= 0) breakCombo(world);
}

/**
 * Milestones every MILESTONE_M metres, the one-off personal-best moment and
 * the farthest-distance flag. "Best" always means score, the metric the boards
 * rank by; score never decreases within a run, so the live crossing is exact
 * and agrees with the game-over verdict. The distance flag is only a marker.
 */
export function checkProgress(world: World, st: SimState): void {
  const m = Math.floor(world.distance / (MILESTONE_M * UNITS_PER_METER));
  if (m > st.lastMilestone) {
    st.lastMilestone = m;
    world.events.push({ type: 'milestone', meters: m * MILESTONE_M });
  }
  if (!world.beatBest && world.bestScore > 0 && Math.floor(world.score) > world.bestScore) {
    world.beatBest = true;
    world.events.push({ type: 'new-best' });
  }
  if (!world.passedBest && world.bestDistance > 0 && world.distance > world.bestDistance) {
    world.passedBest = true;
  }
}
