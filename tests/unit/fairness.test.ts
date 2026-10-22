import { describe, expect, it } from 'vitest';
import { ANT_HIT_R, LEAF_HIT_R, SIM_DT } from '../../src/config';
import { batchIsEscapable, dropHalfWidth, fairReach } from '../../src/game/fairness';
import { maxTwigLen } from '../../src/game/obstacles';
import { leafLimits } from '../../src/game/player';
import { riverEdgesAt } from '../../src/game/river';
import { batchPush, simState } from '../../src/game/state';
import { HIT_PAD, OBSTACLE_PASS } from '../../src/game/tuning';
import { createWorld, stepWorld } from '../../src/game/world';
import type { InputFrame, World } from '../../src/types';
import { createDodgeBot } from './helpers/sim';

const NONE: InputFrame = { steerDelta: 0, axis: 0, absoluteX: null };

/** A run a few seconds in, with no hazards, the leaf resting at `x`. */
function calmWorld(x = 200): World {
  const w = createWorld({ mode: 'endless', seed: 1234, dailyId: null, bestDistance: 0, viewH: 800 });
  for (let i = 0; i < 120; i++) {
    stepWorld(w, { ...NONE, absoluteX: x }, SIM_DT);
    w.drops.length = 0;
    w.obstacles.length = 0;
    w.events.length = 0;
  }
  w.player.vx = 0;
  return w;
}

/** A row of splashes on the player's row at `fall`, spaced so only `gap` (if any) is open. */
function wall(world: World, gapCentre: number | null) {
  const st = simState(world);
  const b = st.batch;
  b.n = 0;
  const r = 18;
  for (let x = 0; x <= 400; x += 40) {
    if (gapCentre !== null && Math.abs(x - gapCentre) < 45) continue;
    batchPush(b, x, 0, r, 0);
  }
  return { st, b };
}

describe('escapability check', () => {
  it('rejects a row covered from bank to bank', () => {
    const w = calmWorld();
    const { st, b } = wall(w, null);
    expect(batchIsEscapable(w, st, b, 0.8, w.player.x)).toBe(false);
  });

  it('accepts a gap within reach and rejects one beyond it', () => {
    const w = calmWorld(120);
    const near = wall(w, 160);
    expect(batchIsEscapable(w, near.st, near.b, 0.8, w.player.x)).toBe(true);
    const far = wall(w, 320);
    // The far gap's nearest safe spot for the leaf centre: just right of the
    // splash at x = 240 (splash radius + ant radius + padding).
    const nearestSafe = 240 + 18 + ANT_HIT_R + HIT_PAD;
    const short = 0.6;
    expect(nearestSafe - 120).toBeGreaterThan(fairReach(short));
    expect(batchIsEscapable(w, far.st, far.b, short, w.player.x)).toBe(false);
    // With a long telegraph the far gap becomes fair.
    expect(nearestSafe - 120).toBeLessThan(fairReach(1.6));
    expect(batchIsEscapable(w, far.st, far.b, 1.6, w.player.x)).toBe(true);
  });

  it('counts splashes already telegraphed', () => {
    const w = calmWorld(200);
    const st = simState(w);
    // Pending splashes cover everything right of the leaf when the new one lands.
    for (let x = 230; x <= 400; x += 40) {
      w.drops.push({ id: w.nextId++, x, y: w.player.y - w.scrollSpeed * 0.8, age: 0, fall: 0.8, r: 18, aimed: false });
    }
    const b = st.batch;
    b.n = 0;
    batchPush(b, 160, 0, 22, 0); // and a new one to the left of the leaf
    expect(batchIsEscapable(w, st, b, 0.8, w.player.x)).toBe(true);
    b.n = 0;
    for (let x = 0; x <= 200; x += 40) batchPush(b, x, 0, 22, 0);
    expect(batchIsEscapable(w, st, b, 0.8, w.player.x)).toBe(false);
  });

  it('treats a rock crossing the row as a wall the leaf cannot pass through', () => {
    // The leaf sits near the left bank; an aimed splash lands on it. The only
    // room is to the right, beyond a rock that floats across the row first.
    const w = calmWorld(10);
    const lim = { lo: 0, hi: 0 };
    leafLimits(w, lim);
    const x0 = w.player.x;
    expect(x0).toBeCloseTo(lim.lo, 0);
    const st = simState(w);
    const b = st.batch;
    b.n = 0;
    batchPush(b, x0 + 4, 0, 20, 0);
    expect(batchIsEscapable(w, st, b, 0.9, x0)).toBe(true);
    // It reaches the row as the splash lands, too soon to slip past it first.
    w.obstacles.push({ id: 1, kind: 'rock', x: x0 + 90, y: w.player.y - w.scrollSpeed * 0.9, r: 26, len: 0, angle: 0, spin: 0, vx: 0, variant: 0, hit: false });
    expect(batchIsEscapable(w, st, b, 0.9, x0)).toBe(false);
  });

  it('splash half-widths follow the hit circle', () => {
    expect(dropHalfWidth(0, 18)).toBeGreaterThan(18 + ANT_HIT_R);
    expect(dropHalfWidth(40, 18)).toBe(0);
  });
});

describe('spawned hazards are fair by construction', () => {
  const SEEDS = [1, 2026, 777, 31337];

  it('drops land on water and obstacles always leave a usable lane', () => {
    for (const seed of SEEDS) {
      const w = createWorld({ mode: 'endless', seed, dailyId: null, bestDistance: 0, viewH: 800 });
      w.player.hearts = 1e9;
      const bot = createDodgeBot();
      const seenDrops = new Set<number>();
      const seenObs = new Set<number>();
      for (let i = 0; i < 300 / SIM_DT; i++) {
        stepWorld(w, bot(w), SIM_DT);
        w.events.length = 0;
        for (const d of w.drops) {
          if (seenDrops.has(d.id)) continue;
          seenDrops.add(d.id);
          // Drops float with the river, so their river distance is fixed.
          const e = riverEdgesAt(w.seed, w.distance + (w.player.y - d.y));
          expect(d.x).toBeGreaterThanOrEqual(e.left);
          expect(d.x).toBeLessThanOrEqual(e.right);
          expect(d.fall).toBeGreaterThanOrEqual(0.55);
        }
        const fresh = w.obstacles.filter((o) => !seenObs.has(o.id));
        if (!fresh.length) continue;
        for (const o of fresh) seenObs.add(o.id);
        // Free leaf-centre stretch on the row of each new obstacle (twigs at their widest).
        for (const o of fresh) {
          const e = riverEdgesAt(w.seed, w.distance + (w.player.y - o.y));
          const lo = e.left + LEAF_HIT_R + 4;
          const hi = e.right - LEAF_HIT_R - 4;
          const blocks = w.obstacles
            .filter((q) => Math.abs(q.y - o.y) < 1)
            .map((q) => {
              const rx = q.kind === 'rock' ? q.r + LEAF_HIT_R : q.len + q.r + LEAF_HIT_R;
              return [q.x - rx, q.x + rx];
            })
            .sort((a, b) => a[0] - b[0]);
          let cursor = lo;
          let widest = 0;
          for (const [a, b] of blocks) {
            widest = Math.max(widest, Math.min(a, hi) - cursor);
            cursor = Math.max(cursor, b);
          }
          widest = Math.max(widest, hi - cursor);
          expect(widest).toBeGreaterThanOrEqual(OBSTACLE_PASS - 0.5);
        }
      }
      expect(seenDrops.size).toBeGreaterThan(200);
      expect(seenObs.size).toBeGreaterThan(20);
    }
  });

  it('twigs shrink as the river narrows, so a lane remains even across the middle', () => {
    expect(maxTwigLen(356)).toBeGreaterThan(maxTwigLen(240));
    const width = 240;
    const leafRange = width - 2 * (LEAF_HIT_R + 4);
    const blocked = 2 * (maxTwigLen(width) + 6 + LEAF_HIT_R);
    expect((leafRange - blocked) / 2).toBeCloseTo(OBSTACLE_PASS, 6);
  });
});
