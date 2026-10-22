// The twelve badges. Checked once, at the end of a run, from the run's numbers,
// the lifetime stats, the streak and a few lifetime counters: nothing is tracked
// frame by frame. Each pays 50-200 crumbs; Night Owl also unlocks the Night Glow
// skin (the skin catalogue names the achievement that unlocks it).

import type { AchievementView, LifetimeStats, SkinId } from '../types';
import { SKINS } from './skins';
import { ALL_ZONES, type RunStats } from './missions';
import type { StreakSave } from './streak';

export interface AchCtx {
  run: RunStats;
  /** Lifetime stats including the run that just ended. */
  stats: LifetimeStats;
  /** Lifetime counters including the run that just ended (nightZones, perfectTrails, shieldBlocks). */
  counters: Record<string, number>;
  /** The streak after today's update. */
  streak: StreakSave;
}

interface AchDef {
  id: string;
  name: string;
  desc: string;
  reward: number;
  test: (c: AchCtx) => boolean;
}

export const ACHIEVEMENTS: readonly AchDef[] = [
  { id: 'first-splash', name: 'First Splash', desc: 'Finish a run', reward: 50, test: () => true },
  { id: 'river-runner', name: 'River Runner', desc: 'Travel 1,000 m in one run', reward: 75, test: (c) => c.run.dist >= 1000 },
  { id: 'long-haul', name: 'Long Haul', desc: 'Travel 2,000 m in one run', reward: 125, test: (c) => c.run.dist >= 2000 },
  { id: 'chain-reaction', name: 'Chain Reaction', desc: 'Reach a ×8 chain', reward: 100, test: (c) => c.run.combo >= 8 },
  { id: 'untouchable', name: 'Untouchable', desc: 'Make 25 near-misses in one run', reward: 100, test: (c) => c.run.near >= 25 },
  // Distinct zone kinds from zone events: segments can repeat a kind.
  { id: 'world-tour', name: 'World Tour', desc: 'Visit all four river zones in one run', reward: 200, test: (c) => c.run.zoneMask === ALL_ZONES },
  { id: 'night-owl', name: 'Night Owl', desc: 'Survive 5 Night River zones. Unlocks the Night Glow ant', reward: 150, test: (c) => (c.counters.nightZones ?? 0) >= 5 },
  { id: 'sweet-tooth', name: 'Sweet Tooth', desc: 'Collect 1,000 crumbs in total', reward: 75, test: (c) => c.stats.totalCrumbs >= 1000 },
  { id: 'perfectionist', name: 'Perfectionist', desc: 'Finish 10 Perfect crumb trails', reward: 100, test: (c) => (c.counters.perfectTrails ?? 0) >= 10 },
  { id: 'shielded', name: 'Shielded', desc: 'Block 10 hits with the mushroom cap', reward: 100, test: (c) => (c.counters.shieldBlocks ?? 0) >= 10 },
  { id: 'devotee', name: 'Devotee', desc: 'Keep a 7-day streak', reward: 150, test: (c) => c.streak.count >= 7 },
  { id: 'centurion', name: 'Centurion', desc: 'Finish 100 runs', reward: 200, test: (c) => c.stats.runs >= 100 },
];

/** The skin a badge unlocks, if any. */
export function skinFor(achievementId: string): SkinId | null {
  return SKINS.find((s) => s.unlockedBy === achievementId)?.id ?? null;
}

export function achievementView(a: AchDef, unlocked: boolean): AchievementView {
  return { id: a.id, name: a.name, desc: a.desc, unlocked, reward: a.reward, skin: skinFor(a.id) };
}
