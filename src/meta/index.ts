// Phase 3 progression facade: streak, daily missions, achievements and skins.
// Cosmetic/meta only: it listens to game events and run summaries but never
// changes the simulation. Rules live in streak.ts, missions.ts and
// achievements.ts; persistence in src/storage.ts. Not part of src/game/, so it
// may read the clock.

import { dailyInfo } from '../engine/rng';
import * as storage from '../storage';
import type { AchievementView, GameEvent, MetaInfo, MetaRewards, MissionView, Mode, RunSummary, Skin, SkinId, World } from '../types';
import { ACHIEVEMENTS, achievementView, skinFor } from './achievements';
import { missionsFor, missionView, readSummary, readWorld, resetRun, run, statValue, trackEvent, type MissionDef } from './missions';
import { isSkinId, skinById } from './skins';
import { advanceStreak, liveCount } from './streak';

/** Today's missions as the live run sees them (set by beginRun, read per event). */
const live = {
  active: false,
  defs: [] as readonly MissionDef[],
  /** Saved progress at the start of the run, for the "today" running totals. */
  base: [0, 0, 0],
  /** Done earlier today, or already announced this run: never announce twice. */
  skip: [false, false, false],
};

/** Snapshot for the title screen (wallet, streak, today's missions, skins, badge count). */
export function metaInfo(now: Date = new Date()): MetaInfo {
  const today = dailyInfo(now).id;
  const m = storage.getMeta();
  const fresh = m.missions.day === today;
  return {
    wallet: storage.getWallet(),
    streak: { count: liveCount(m.streak, today), best: m.streak.best, playedToday: m.streak.last === today },
    missions: missionsFor(today).map((d) => missionView(d, fresh ? (m.missions.progress[d.id] ?? 0) : 0, fresh && m.missions.done.includes(d.id))),
    owned: m.owned.filter(isSkinId),
    equipped: isSkinId(m.equipped) ? m.equipped : 'classic',
    badges: { unlocked: ACHIEVEMENTS.filter((a) => m.badges[a.id]).length, total: ACHIEVEMENTS.length },
  };
}

/** A run starts: reset the per-run trackers (mode matters for "play the Daily" missions). */
export function beginRun(mode: Mode, dailyId: string | null, now: Date = new Date()): void {
  void dailyId;
  const today = dailyInfo(now).id;
  const ms = storage.getMeta().missions;
  const fresh = ms.day === today;
  live.defs = missionsFor(today);
  live.defs.forEach((d, i) => {
    live.base[i] = fresh ? (ms.progress[d.id] ?? 0) : 0;
    live.skip[i] = fresh && ms.done.includes(d.id);
  });
  resetRun(mode);
  live.active = true;
}

/**
 * Every live-run game event. Returns a mission that has just been completed
 * (for an in-run pill), else null. Must be cheap: called per event.
 */
export function onEvent(e: GameEvent, world: World): MissionView | null {
  if (!live.active) return null;
  trackEvent(e, world);
  readWorld(world);
  for (let i = 0; i < live.defs.length; i++) {
    const d = live.defs[i];
    if (live.skip[i] || d.finishOnly) continue;
    if (statValue(d.stat, run) + (d.today ? live.base[i] : 0) >= d.target) {
      live.skip[i] = true;
      return missionView(d, d.target, true);
    }
  }
  return null;
}

/**
 * The run has ended and was recorded (storage.recordRun already added its
 * crumbs to the wallet). Updates streak, missions and achievements and credits
 * their bonuses in ONE storage.updateMeta call. Called exactly once per run.
 */
export function finishRun(summary: RunSummary, now: Date = new Date()): MetaRewards {
  const today = dailyInfo(now).id;
  readSummary(summary);
  const defs = missionsFor(today);
  const missionsDone: MissionView[] = [];
  const badgesUnlocked: AchievementView[] = [];
  let bonus = 0;
  let extended = false;
  let milestoneBonus = 0;

  const res = storage.updateMeta((meta) => {
    // Missions: a new day starts from nothing; progress then only ever grows.
    if (meta.missions.day !== today) meta.missions = { day: today, progress: {}, done: [] };
    const ms = meta.missions;
    for (const d of defs) {
      const v = statValue(d.stat, run);
      const prev = ms.progress[d.id] ?? 0;
      const next = d.today ? prev + v : Math.max(prev, v);
      ms.progress[d.id] = next;
      // `done` is the pay-once gate: a mission finished in an earlier run today is never paid again.
      if (next >= d.target && !ms.done.includes(d.id)) {
        ms.done.push(d.id);
        bonus += d.reward;
        missionsDone.push(missionView(d, d.target, true));
      }
    }

    const s = advanceStreak(meta.streak, today);
    extended = s.extended;
    milestoneBonus = s.milestoneBonus;
    bonus += milestoneBonus;

    const c = meta.counters;
    c.nightZones = (c.nightZones ?? 0) + run.nightZones;
    c.perfectTrails = (c.perfectTrails ?? 0) + run.trails;
    c.shieldBlocks = (c.shieldBlocks ?? 0) + run.shield;

    const ctx = { run, stats: storage.getStats(), counters: c, streak: meta.streak };
    for (const a of ACHIEVEMENTS) {
      if (meta.badges[a.id] || !a.test(ctx)) continue;
      meta.badges[a.id] = now.toISOString();
      bonus += a.reward;
      badgesUnlocked.push(achievementView(a, true));
    }
    // Skin rewards follow the badge (also repairs a badge whose skin never landed).
    for (const a of ACHIEVEMENTS) {
      const skin = skinFor(a.id);
      if (skin && meta.badges[a.id] && !meta.owned.includes(skin)) meta.owned.push(skin);
    }
    return bonus;
  });

  live.active = false;
  resetRun(summary.mode);
  return {
    runCrumbs: summary.crumbs,
    bonus,
    missionsDone,
    badgesUnlocked,
    streak: { count: res.meta.streak.count, best: res.meta.streak.best, playedToday: true, extended, milestoneBonus },
    wallet: res.wallet,
  };
}

/** Every achievement, locked or not, for the badges screen. */
export function achievements(): AchievementView[] {
  const badges = storage.getMeta().badges;
  return ACHIEVEMENTS.map((a) => achievementView(a, !!badges[a.id]));
}

export function buySkin(id: SkinId): boolean {
  const skin = skinById(id);
  if (skin.id !== id || skin.price === null) return false;
  return storage.buySkin(id, skin.price);
}

export function equipSkin(id: SkinId): boolean {
  return storage.equipSkin(id);
}

export function equippedSkin(): Skin {
  return skinById(storage.getMeta().equipped);
}
