// Daily streak: a day counts when at least one run is finished, using the local
// date id (YYYY-MM-DD) that the Daily River also uses. Pure functions over the
// saved streak; src/meta/index.ts decides when to call them.

import { dailyInfo } from '../engine/rng';

export interface StreakSave {
  last: string;
  count: number;
  best: number;
}

/** Streak length -> crumbs, paid once when the streak reaches it. */
export const STREAK_MILESTONES: readonly { days: number; bonus: number }[] = [
  { days: 3, bonus: 25 },
  { days: 7, bonus: 75 },
  { days: 14, bonus: 150 },
  { days: 30, bonus: 300 },
];

/** The local date id of the day before `id`. Built from date parts so DST can't skip a day. */
export function previousDay(id: string): string {
  const [y, m, d] = id.split('-').map(Number);
  return dailyInfo(new Date(y, m - 1, d - 1)).id;
}

/** The streak as the player should see it today: a missed day shows 0 until the next run. */
export function liveCount(s: StreakSave, today: string): number {
  return s.last >= today || s.last === previousDay(today) ? s.count : 0;
}

/**
 * Registers a finished run on `today`, editing `s` in place. Same day: nothing
 * changes. Yesterday: +1. Anything older: back to 1. Returns whether this run
 * moved the streak and the milestone bonus it reached (0 if none).
 */
export function advanceStreak(s: StreakSave, today: string): { extended: boolean; milestoneBonus: number } {
  // last > today means the clock went backwards (travel, manual change): never punish that.
  if (s.last >= today) return { extended: false, milestoneBonus: 0 };
  s.count = s.last === previousDay(today) ? s.count + 1 : 1;
  s.last = today;
  s.best = Math.max(s.best, s.count);
  const hit = STREAK_MILESTONES.find((m) => m.days === s.count);
  return { extended: true, milestoneBonus: hit ? hit.bonus : 0 };
}
