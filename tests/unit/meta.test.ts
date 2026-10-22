// Phase 3 progression rules: daily missions, streak, achievements, skin
// purchases and the single credit path. Uses an in-memory localStorage like
// storage.test.ts; each test gets a fresh copy of the modules.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dailyInfo } from '../../src/engine/rng';
import type { GameEvent, MissionView, RunSummary, World } from '../../src/types';

class MemoryStorage {
  map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

const g = globalThis as unknown as { localStorage?: MemoryStorage; window?: unknown };

beforeEach(() => {
  g.localStorage = new MemoryStorage();
  g.window = { addEventListener: () => {} };
});

afterEach(() => {
  delete g.localStorage;
  delete g.window;
});

async function open() {
  vi.resetModules();
  const storage = await import('../../src/storage');
  const meta = await import('../../src/meta');
  const missions = await import('../../src/meta/missions');
  return { storage, meta, missions };
}

/** A short, harmless run: completes no mission and earns no badge beyond First Splash. */
function tiny(extra: Partial<RunSummary> = {}): RunSummary {
  return {
    mode: 'endless', dailyId: null, seed: 1, score: 10, distanceM: 20, timeS: 5, nearMisses: 0,
    maxCombo: 0, hitsTaken: 3, killedBy: 'drop', crumbs: 0, zonesReached: 1, ...extra,
  };
}

/** A run that beats every single-run target. */
const huge = (extra: Partial<RunSummary> = {}): RunSummary =>
  tiny({ score: 99999, distanceM: 9999, timeS: 500, nearMisses: 99, maxCombo: 99, crumbs: 999, ...extra });

const day = (n: number): Date => new Date(2026, 0, 10 + n, 12);
const bigWorld = { crumbs: 999, nearMisses: 99, maxCombo: 99, distance: 9999 * 50, score: 99999, time: 500 } as unknown as World;
const ev = {
  zone: (zone: 'marsh' | 'rapids' | 'night'): GameEvent => ({ type: 'zone', zone }),
  trail: { type: 'trail-complete', x: 0, y: 0, points: 0 } as GameEvent,
  power: { type: 'power-start', kind: 'honey', duration: 5 } as GameEvent,
  shield: { type: 'shield-block', x: 0, y: 0, source: 'rock' } as GameEvent,
  tick: { type: 'milestone', meters: 100 } as GameEvent,
};

describe('daily missions', () => {
  it('are the same for a given date, differ across dates, and have 30/60/100 rewards', async () => {
    const { missions } = await open();
    const ids = (d: Date) => missions.missionsFor(dailyInfo(d).id).map((m) => m.id).join();
    expect(ids(new Date(2026, 3, 1, 1))).toBe(ids(new Date(2026, 3, 1, 23)));
    expect(new Set(Array.from({ length: 14 }, (_, i) => ids(new Date(2026, 3, 1 + i)))).size).toBeGreaterThan(8);
    for (let i = 0; i < 60; i++) {
      const defs = missions.missionsFor(dailyInfo(new Date(2026, 3, 1 + i)).id);
      expect(defs.map((d) => d.tier)).toEqual(['easy', 'medium', 'hard']);
      expect(defs.map((d) => d.reward)).toEqual([30, 60, 100]);
      expect(new Set(defs.map((d) => d.id)).size).toBe(3);
    }
  });

  it('announce once during the run and pay once across runs', async () => {
    const { meta, storage, missions } = await open();
    const now = day(0);
    const defs = missions.missionsFor(dailyInfo(now).id);
    // "Finish N runs" can't be beaten by one run; every other mission can.
    const doable = defs.filter((d) => d.stat !== 'runs').map((d) => d.id);

    meta.beginRun('daily', dailyInfo(now).id, now);
    const pills = [ev.zone('marsh'), ev.zone('rapids'), ev.zone('night'), ...Array(6).fill(ev.trail), ...Array(6).fill(ev.power), ev.shield, ev.tick, ev.tick, ev.tick]
      .map((e) => meta.onEvent(e, bigWorld))
      .filter((m): m is MissionView => m !== null)
      .map((m) => m.id);
    expect(pills.filter((id) => !doable.includes(id))).toEqual([]);
    expect(new Set(pills).size).toBe(pills.length);

    const before = storage.getWallet();
    const r1 = meta.finishRun(huge({ mode: 'daily', dailyId: dailyInfo(now).id }), now);
    expect(r1.missionsDone.map((m) => m.id).sort()).toEqual([...doable].sort());
    expect(r1.missionsDone.reduce((s, m) => s + m.reward, 0)).toBeLessThanOrEqual(190);
    expect(storage.getWallet() - before).toBe(r1.bonus);
    expect(r1.wallet).toBe(storage.getWallet());

    // Second run the same day: nothing new to announce or pay.
    meta.beginRun('daily', dailyInfo(now).id, now);
    expect(meta.onEvent(ev.tick, bigWorld)).toBeNull();
    const r2 = meta.finishRun(huge({ mode: 'daily' }), now);
    expect(r2.missionsDone).toEqual([]);
    expect(r2.bonus).toBe(0);
    expect(storage.getWallet()).toBe(r1.wallet);
  });

  it('show no progress on a new day', async () => {
    const { meta } = await open();
    meta.finishRun(huge(), day(0));
    expect(meta.metaInfo(day(0)).missions.some((m) => m.progress > 0)).toBe(true);
    expect(meta.metaInfo(day(1)).missions.every((m) => m.progress === 0 && !m.done)).toBe(true);
  });
});

describe('streak', () => {
  it('stays put on the same day, grows the next day, resets after a gap', async () => {
    const { meta } = await open();
    expect(meta.finishRun(tiny(), day(0)).streak).toMatchObject({ count: 1, extended: true, playedToday: true });
    expect(meta.finishRun(tiny(), day(0)).streak).toMatchObject({ count: 1, extended: false });
    expect(meta.finishRun(tiny(), day(1)).streak).toMatchObject({ count: 2, extended: true });
    // Missed day 2: the title shows 0 until the next run, which restarts at 1 and keeps the best.
    expect(meta.metaInfo(day(2)).streak).toEqual({ count: 2, best: 2, playedToday: false });
    expect(meta.metaInfo(day(3)).streak.count).toBe(0);
    expect(meta.finishRun(tiny(), day(4)).streak).toMatchObject({ count: 1, best: 2, extended: true });
  });

  it('pays the 3-day milestone exactly once, through the wallet', async () => {
    const { meta, storage } = await open();
    const bonuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const before = storage.getWallet();
      const r = meta.finishRun(tiny(), day(i));
      expect(storage.getWallet() - before).toBe(r.bonus);
      bonuses.push(r.streak.milestoneBonus);
    }
    expect(bonuses).toEqual([0, 0, 25, 0, 0]);
  });
});

describe('achievements', () => {
  it('unlock once; Night Owl grants the Night Glow skin', async () => {
    const { meta, storage } = await open();
    expect(meta.achievements()).toHaveLength(12);
    const day0 = day(0);

    meta.beginRun('endless', null, day0);
    for (let i = 0; i < 5; i++) meta.onEvent(ev.zone('night'), bigWorld);
    const before = storage.getWallet();
    const r1 = meta.finishRun(tiny(), day0);
    expect(r1.badgesUnlocked.map((b) => b.id)).toEqual(expect.arrayContaining(['first-splash', 'night-owl']));
    expect(r1.badgesUnlocked.find((b) => b.id === 'night-owl')?.skin).toBe('nightglow');
    expect(storage.getMeta().owned).toContain('nightglow');
    expect(meta.metaInfo(day0).owned).toContain('nightglow');
    expect(storage.getWallet() - before).toBe(r1.bonus);

    const r2 = meta.finishRun(tiny(), day0);
    expect(r2.badgesUnlocked).toEqual([]);
    expect(r2.bonus).toBe(0);
    expect(meta.achievements().filter((a) => a.unlocked).map((a) => a.id)).toEqual(expect.arrayContaining(['first-splash', 'night-owl']));
    expect(meta.metaInfo(day0).badges).toEqual({ unlocked: r1.badgesUnlocked.length, total: 12 });
  });

  it('World Tour needs all four zone kinds in one run', async () => {
    const { meta } = await open();
    meta.beginRun('endless', null, day(0));
    meta.onEvent(ev.zone('marsh'), bigWorld);
    meta.onEvent(ev.zone('rapids'), bigWorld);
    expect(meta.finishRun(tiny(), day(0)).badgesUnlocked.map((b) => b.id)).not.toContain('world-tour');
    meta.beginRun('endless', null, day(0));
    for (const z of ['marsh', 'rapids', 'night'] as const) meta.onEvent(ev.zone(z), bigWorld);
    expect(meta.finishRun(tiny(), day(0)).badgesUnlocked.map((b) => b.id)).toContain('world-tour');
  });
});

describe('wallet', () => {
  it('buySkin never drives the wallet negative or sells what cannot be bought', async () => {
    const { meta, storage } = await open();
    expect(meta.buySkin('golden')).toBe(false);
    expect(storage.getWallet()).toBe(0);
    storage.updateMeta(() => 200);
    expect(meta.buySkin('leafcutter')).toBe(true);
    expect(storage.getWallet()).toBe(50);
    expect(meta.buySkin('leafcutter')).toBe(false);
    expect(meta.buySkin('bee')).toBe(false);
    expect(meta.buySkin('nightglow')).toBe(false);
    expect(storage.getWallet()).toBe(50);
    expect(meta.equipSkin('bee')).toBe(false);
    expect(meta.equipSkin('leafcutter')).toBe(true);
    expect(meta.equippedSkin().id).toBe('leafcutter');
  });

  it('updateMeta credits what its callback returns exactly once, never a negative', async () => {
    const { storage } = await open();
    const r = storage.updateMeta((m) => {
      m.counters.probe = 1;
      return 40;
    });
    expect(r.wallet).toBe(40);
    expect(storage.getWallet()).toBe(40);
    storage.updateMeta(() => {});
    storage.updateMeta(() => -500);
    expect(storage.getWallet()).toBe(40);
    expect(storage.getMeta().counters.probe).toBe(1);
  });
});
