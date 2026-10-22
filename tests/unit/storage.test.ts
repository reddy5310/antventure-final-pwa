// Local persistence: damaged saves, two tabs sharing one save, names in any
// script, and what counts as a new best.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunSummary } from '../../src/types';

const KEY = 'antventure.v2';

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

type Storage = typeof import('../../src/storage');
const g = globalThis as unknown as { localStorage?: MemoryStorage; window?: unknown };
let mem: MemoryStorage;

/** A fresh copy of the module, like a separate browser tab sharing localStorage. */
async function openTab(): Promise<Storage> {
  vi.resetModules();
  return import('../../src/storage');
}

function run(score: number, extra: Partial<RunSummary> = {}): RunSummary {
  return {
    mode: 'endless',
    dailyId: null,
    seed: 1,
    crumbs: 0,
    zonesReached: 1,
    score,
    distanceM: Math.floor(score / 2),
    timeS: 30,
    nearMisses: 3,
    maxCombo: 2,
    hitsTaken: 3,
    killedBy: 'drop',
    ...extra,
  };
}

beforeEach(() => {
  mem = new MemoryStorage();
  g.localStorage = mem;
  g.window = { addEventListener: () => {} };
});

afterEach(() => {
  delete g.localStorage;
  delete g.window;
});

describe('storage', () => {
  it('a save with wrong field types boots with defaults instead of crashing', async () => {
    mem.setItem(KEY, JSON.stringify({ boards: null, flags: 3, settings: { music: 'loud', sensitivity: 99, muted: 'yes' }, stats: { runs: -4 }, dailyAttempts: [1] }));
    const s = await openTab();
    expect(s.getBest('endless', null)).toBeNull();
    expect(s.getBoard('endless', null)).toEqual([]);
    const settings = s.loadSettings();
    expect(settings.music).toBe(0.6);
    expect(settings.sensitivity).toBe(2);
    expect(settings.muted).toBe(false);
    expect(s.getStats().runs).toBe(0);
    expect(s.getFlag('tutorialSeen')).toBe(false);
  });

  it('drops malformed board entries and keeps the good ones', async () => {
    mem.setItem(KEY, JSON.stringify({ boards: { endless: [{ score: 'x' }, null, { score: 120, distanceM: 60, name: 42 }] } }));
    const s = await openTab();
    const board = s.getBoard('endless', null);
    expect(board).toHaveLength(1);
    expect(board[0]).toMatchObject({ score: 120, distanceM: 60, name: 'You' });
  });

  it('two tabs recording runs keep both (read-modify-write)', async () => {
    const a = await openTab();
    const b = await openTab();
    a.recordRun(run(100));
    b.recordRun(run(200));
    a.setName('Ant');
    const saved = JSON.parse(mem.getItem(KEY) ?? '{}') as { boards: Record<string, unknown[]>; name: string; stats: { runs: number } };
    expect(saved.boards.endless).toHaveLength(2);
    expect(saved.stats.runs).toBe(2);
    expect(saved.name).toBe('Ant');
  });

  it('a tie with the best is not a new best; beating it is', async () => {
    const s = await openTab();
    expect(s.recordRun(run(500)).isBest).toBe(true);
    expect(s.recordRun(run(500, { distanceM: 999 })).isBest).toBe(false);
    expect(s.recordRun(run(501)).isBest).toBe(true);
    expect(s.getFarthest('endless', null)).toBe(999);
  });

  it('remembers the first Daily attempt score', async () => {
    const s = await openTab();
    const id = '2026-10-21';
    expect(s.getDailyFirst(id)).toBeNull();
    s.recordRun(run(300, { mode: 'daily', dailyId: id }));
    s.recordRun(run(900, { mode: 'daily', dailyId: id }));
    expect(s.getDailyFirst(id)).toBe(300);
    expect(s.getDailyAttempts(id)).toBe(2);
  });

  it('keeps combining marks and never splits a character when trimming names', async () => {
    const s = await openTab();
    expect(s.cleanName('రెడ్డి')).toBe('రెడ్డి');
    expect(s.cleanName('मनोज')).toBe('मनोज');
    expect(s.cleanName('José')).toBe('José');
    expect(s.cleanName('  <b>Ant</b>!! ')).toBe('bAntb');
    const astral = s.cleanName('𝒜'.repeat(20));
    expect(Array.from(astral)).toHaveLength(s.NAME_MAX);
    expect(astral).toBe('𝒜'.repeat(s.NAME_MAX));
    expect(s.cleanName('ABCDEFGHIJKLMNOP')).toBe('ABCDEFGHIJKL');
  });

  it('keeps working in memory when storage refuses writes', async () => {
    const s = await openTab();
    mem.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    s.recordRun(run(100));
    s.recordRun(run(200));
    expect(s.getBoard('endless', null).map((e) => e.score)).toEqual([200, 100]);
  });
});

describe('crumbs', () => {
  it('adds each run to the lifetime total and to the wallet, ignoring nonsense counts', async () => {
    const tab = await openTab();
    expect(tab.getStats().totalCrumbs).toBe(0);
    expect(tab.getWallet()).toBe(0);
    tab.recordRun(run(100, { crumbs: 12 }));
    tab.recordRun(run(90, { crumbs: 7.9 }));
    tab.recordRun(run(80, { crumbs: -5 }));
    tab.recordRun(run(70, { crumbs: Number.NaN }));
    expect(tab.getStats().totalCrumbs).toBe(19);
    expect(tab.getWallet()).toBe(19);
    expect(tab.getStats().runs).toBe(4);
  });

  it('survives a reload, and a save from before crumbs existed starts at zero', async () => {
    const tab = await openTab();
    tab.recordRun(run(50, { crumbs: 5 }));
    const again = await openTab();
    expect(again.getStats().totalCrumbs).toBe(5);
    expect(again.getWallet()).toBe(5);

    // A Phase 1 save: stats without totalCrumbs, no wallet.
    mem.setItem(KEY, JSON.stringify({ stats: { runs: 3, totalDistanceM: 100, totalNearMisses: 4, bestCombo: 2 } }));
    const old = await openTab();
    expect(old.getStats()).toEqual({ runs: 3, totalDistanceM: 100, totalNearMisses: 4, bestCombo: 2, totalCrumbs: 0 });
    expect(old.getWallet()).toBe(0);
    old.recordRun(run(60, { crumbs: 2 }));
    expect(old.getStats().runs).toBe(4);
    expect(old.getWallet()).toBe(2);
  });

  it('degrades a damaged wallet or total to zero instead of breaking boot', async () => {
    mem.setItem(KEY, JSON.stringify({ wallet: 'lots', stats: { totalCrumbs: -3 } }));
    const tab = await openTab();
    expect(tab.getWallet()).toBe(0);
    expect(tab.getStats().totalCrumbs).toBe(0);
    mem.setItem(KEY, JSON.stringify({ wallet: Infinity, stats: { totalCrumbs: 'x' } }));
    const other = await openTab();
    expect(other.getWallet()).toBe(0);
    expect(other.getStats().totalCrumbs).toBe(0);
  });

  it('adds up across two tabs sharing one save', async () => {
    const a = await openTab();
    const b = await openTab();
    a.recordRun(run(40, { crumbs: 4 }));
    b.recordRun(run(30, { crumbs: 6 }));
    expect(b.getStats().totalCrumbs).toBe(10);
    expect(b.getWallet()).toBe(10);
    a.recordRun(run(20, { crumbs: 1 }));
    expect(a.getWallet()).toBe(11);
  });
});
