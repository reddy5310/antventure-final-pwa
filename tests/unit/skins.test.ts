// Skins are cosmetic: whichever one is equipped, the same seed and inputs must
// give the identical game, the hitboxes stay put, and every catalogue colour is
// valid so the renderer never gets a bad fillStyle.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANT_HIT_R, LEAF_HIT_R, SIM_DT } from '../../src/config';
import { createWorld, stepWorld } from '../../src/game/world';
import { SKINS, isSkinId, skinById } from '../../src/meta/skins';
import type { InputFrame, World } from '../../src/types';

const HEX = /^#[0-9a-f]{6}$/i;

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

/** A fixed weaving input, so the run covers steering, drops and obstacles without any randomness. */
function weave(world: World): InputFrame {
  return { steerDelta: 0, axis: Math.sin(world.time * 1.7) > 0.2 ? 1 : Math.sin(world.time * 1.7) < -0.2 ? -1 : 0, absoluteX: null };
}

function simulate(): string {
  const world = createWorld({ mode: 'endless', seed: 4242, dailyId: null, bestDistance: 0, viewH: 800 });
  const kinds: string[] = [];
  for (let i = 0; i < 900; i++) {
    stepWorld(world, weave(world), SIM_DT);
    for (const e of world.events) kinds.push(e.type);
    world.events.length = 0;
  }
  return JSON.stringify({ world, kinds });
}

describe('skins do not touch the simulation', () => {
  it('the same seed and inputs give an identical world whichever skin is equipped', async () => {
    vi.resetModules();
    const storage = await import('../../src/storage');
    const runs = new Map<string, string>();
    for (const skin of SKINS) {
      // Own every skin and wear this one, exactly what the shop does.
      storage.updateMeta((m) => {
        if (!m.owned.includes(skin.id)) m.owned.push(skin.id);
      });
      expect(storage.equipSkin(skin.id)).toBe(true);
      expect(storage.getMeta().equipped).toBe(skin.id);
      runs.set(skin.id, simulate());
    }
    const [first, ...rest] = [...runs.values()];
    expect(first.length).toBeGreaterThan(1000);
    for (const r of rest) expect(r).toBe(first);
    expect(ANT_HIT_R).toBe(10);
    expect(LEAF_HIT_R).toBe(26);
  });

  it('src/game never imports the skins, the renderer or the save', () => {
    const files = import.meta.glob('../../src/game/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    expect(Object.keys(files).length).toBeGreaterThan(5);
    for (const [path, text] of Object.entries(files)) {
      expect(text, path).not.toMatch(/from\s+'\.\.\/(meta|render|storage)/);
    }
  });
});

describe('skin catalogue', () => {
  it('has unique ids, valid hex colours and a colour for every pattern that needs one', () => {
    expect(new Set(SKINS.map((s) => s.id)).size).toBe(SKINS.length);
    expect(skinById('nope').id).toBe('classic');
    for (const s of SKINS) {
      expect(isSkinId(s.id)).toBe(true);
      const p = s.palette;
      for (const c of [p.body, p.mid, p.dark, p.outline, p.highlight]) expect(c, `${s.id} ${c}`).toMatch(HEX);
      if (p.pattern === 'none') expect(p.accent).toBe('');
      else expect(p.accent, `${s.id} accent`).toMatch(HEX);
    }
  });

  it('classic keeps the original ant colours', () => {
    expect(skinById('classic').palette).toMatchObject({ body: '#4b211a', mid: '#7e3523', dark: '#2a1613', outline: '#140a09', highlight: '#cf6643', pattern: 'none' });
  });
});
