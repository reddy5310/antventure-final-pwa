// STUB — the meta agent replaces the bodies. Keep the exported signatures.
// Phase 3 progression facade: streak, daily missions, achievements and skins.
// Cosmetic/meta only: it listens to game events and run summaries but never
// changes the simulation. Rules here; persistence in src/storage.ts.

import * as storage from '../storage';
import type { AchievementView, GameEvent, MetaInfo, MetaRewards, MissionView, Mode, RunSummary, Skin, SkinId, World } from '../types';
import { isSkinId, skinById } from './skins';

/** Snapshot for the title screen (wallet, streak, today's missions, skins, badge count). */
export function metaInfo(now: Date = new Date()): MetaInfo {
  void now;
  const m = storage.getMeta();
  return {
    wallet: storage.getWallet(),
    streak: { count: m.streak.count, best: m.streak.best, playedToday: false },
    missions: [],
    owned: m.owned.filter(isSkinId),
    equipped: isSkinId(m.equipped) ? m.equipped : 'classic',
    badges: { unlocked: Object.keys(m.badges).length, total: 0 },
  };
}

/** A run starts: reset the per-run trackers (mode matters for "play the Daily" missions). */
export function beginRun(mode: Mode, dailyId: string | null): void {
  void mode;
  void dailyId;
}

/**
 * Every live-run game event. Returns a mission that has just been completed
 * (for an in-run pill), else null. Must be cheap: called per event.
 */
export function onEvent(e: GameEvent, world: World): MissionView | null {
  void e;
  void world;
  return null;
}

/**
 * The run has ended and was recorded (storage.recordRun already added its
 * crumbs to the wallet). Updates streak, missions and achievements and credits
 * their bonuses in ONE storage.updateMeta call. Called exactly once per run.
 */
export function finishRun(summary: RunSummary, now: Date = new Date()): MetaRewards {
  void now;
  const m = storage.getMeta();
  return {
    runCrumbs: summary.crumbs,
    bonus: 0,
    missionsDone: [],
    badgesUnlocked: [],
    streak: { count: m.streak.count, best: m.streak.best, playedToday: true, extended: false, milestoneBonus: 0 },
    wallet: storage.getWallet(),
  };
}

/** Every achievement, locked or not, for the badges screen. */
export function achievements(): AchievementView[] {
  return [];
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
