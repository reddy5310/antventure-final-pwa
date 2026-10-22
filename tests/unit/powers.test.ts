import { describe, expect, it } from 'vitest';
import { MAX_HEARTS, SIM_DT } from '../../src/config';
import {
  FIREFLY_BAND,
  LADYBUG_POINTS,
  POWER_SECONDS,
  SHIELD_INVULN,
  absorbHit,
  activatePower,
  hasPower,
  nearBandScale,
  updatePowers,
} from '../../src/game/powers';
import { multiplierFor } from '../../src/game/scoring';
import { COMBO_TIME, INVULN_TIME } from '../../src/game/tuning';
import { createWorld, stepWorld } from '../../src/game/world';
import type { Drop, GameEvent, InputFrame, Obstacle, World } from '../../src/types';

const NONE: InputFrame = { steerDelta: 0, axis: 0, absoluteX: null };

function newRun(seed = 11): World {
  return createWorld({ mode: 'endless', seed, dailyId: null, bestDistance: 0, viewH: 800 });
}

/** Steps with every hazard and pickup removed, so a test controls exactly what happens. */
function step(world: World, steps: number): GameEvent[] {
  const out: GameEvent[] = [];
  for (let i = 0; i < steps; i++) {
    stepWorld(world, NONE, SIM_DT);
    world.drops.length = 0;
    world.obstacles.length = 0;
    world.pickups.length = 0;
    out.push(...world.events);
    world.events.length = 0;
  }
  return out;
}

const seconds = (s: number) => Math.round(s / SIM_DT);
const types = (events: GameEvent[]) => events.map((e) => e.type);

/** A drop that lands on the next step at (player.x + dx, player.y). */
function landNext(world: World, dx: number, r = 18): Drop {
  const p = world.player;
  const d: Drop = {
    id: world.nextId++,
    x: p.x + dx,
    y: p.y - world.scrollSpeed * SIM_DT,
    age: 1 - SIM_DT / 2,
    fall: 1,
    r,
    aimed: true,
  };
  world.drops.push(d);
  return d;
}

/** A rock sitting on the leaf: the next step collides with it. */
function rockOnLeaf(world: World): Obstacle {
  const p = world.player;
  const o: Obstacle = {
    id: world.nextId++,
    kind: 'rock',
    x: p.x + 4,
    y: p.y - world.scrollSpeed * SIM_DT,
    r: 20,
    len: 0,
    angle: 0,
    spin: 0,
    vx: 0,
    variant: 0,
    hit: false,
  };
  world.obstacles.push(o);
  return o;
}

/** Gives the run a combo worth protecting. */
function withCombo(world: World, combo = 6): void {
  world.combo = combo;
  world.comboTimer = COMBO_TIME;
  world.multiplier = multiplierFor(combo);
}

describe('timed power-ups', () => {
  it('start with their duration and announce it', () => {
    const w = newRun();
    for (const kind of ['mushroom', 'honey', 'firefly'] as const) {
      w.events.length = 0;
      activatePower(w, kind);
      const p = w.powers.find((x) => x.kind === kind);
      expect(p).toEqual({ kind, left: POWER_SECONDS[kind], total: POWER_SECONDS[kind] });
      expect(w.events).toEqual([{ type: 'power-start', kind, duration: POWER_SECONDS[kind] }]);
    }
    expect(POWER_SECONDS).toEqual({ mushroom: 10, honey: 9, firefly: 12 });
    expect(w.powers).toHaveLength(3);
  });

  it('tick in sim steps and end exactly once', () => {
    const w = newRun();
    activatePower(w, 'honey');
    w.events.length = 0;
    const early = step(w, seconds(8.9));
    expect(hasPower(w, 'honey')).toBe(true);
    expect(types(early)).not.toContain('power-end');
    const late = step(w, seconds(0.3));
    expect(hasPower(w, 'honey')).toBe(false);
    expect(late.filter((e) => e.type === 'power-end')).toEqual([{ type: 'power-end', kind: 'honey' }]);
    expect(step(w, seconds(2))).not.toContainEqual({ type: 'power-end', kind: 'honey' });
  });

  it('refresh the timer instead of stacking', () => {
    const w = newRun();
    activatePower(w, 'firefly');
    step(w, seconds(5));
    expect(w.powers[0].left).toBeCloseTo(7, 1);
    w.events.length = 0;
    activatePower(w, 'firefly');
    expect(w.powers).toHaveLength(1);
    expect(w.powers[0].left).toBe(12);
    expect(w.powers[0].total).toBe(12);
    expect(w.events).toEqual([{ type: 'power-start', kind: 'firefly', duration: 12 }]);
  });

  it('different kinds run side by side, each with its own timer, in pickup order', () => {
    const w = newRun();
    activatePower(w, 'honey');
    step(w, seconds(1));
    activatePower(w, 'mushroom');
    expect(w.powers.map((p) => p.kind)).toEqual(['honey', 'mushroom']);
    const events = step(w, seconds(8.5));
    // Honey (9 s) is over, the mushroom (10 s, started 1 s later) still has time.
    expect(events).toContainEqual({ type: 'power-end', kind: 'honey' });
    expect(w.powers.map((p) => p.kind)).toEqual(['mushroom']);
    expect(w.powers[0].left).toBeCloseTo(10 - 8.5, 1);
  });

  it('do not tick while updatePowers is not called (paused, dying)', () => {
    const w = newRun();
    activatePower(w, 'mushroom');
    // 'dying' steps never call updatePowers: the shield does not run out behind the death screen.
    w.state = 'dying';
    for (let i = 0; i < seconds(1); i++) stepWorld(w, NONE, SIM_DT);
    expect(w.powers[0].left).toBe(10);
    updatePowers(w, 4);
    expect(w.powers[0].left).toBe(6);
  });
});

describe('mushroom shield', () => {
  it('absorbs exactly one raindrop: no heart lost, combo kept, 0.5 s of invulnerability', () => {
    const w = newRun();
    activatePower(w, 'mushroom');
    withCombo(w, 6);
    const multiplier = w.multiplier;
    w.events.length = 0;
    landNext(w, 0);
    stepWorld(w, NONE, SIM_DT);
    const events = [...w.events];
    w.events.length = 0;

    expect(events.find((e) => e.type === 'shield-block')).toMatchObject({ type: 'shield-block', source: 'drop' });
    expect(events).toContainEqual({ type: 'power-end', kind: 'mushroom' });
    expect(types(events)).not.toContain('hit');
    expect(types(events)).not.toContain('combo-lost');
    expect(w.player.hearts).toBe(MAX_HEARTS);
    expect(w.hitsTaken).toBe(0);
    expect(w.combo).toBe(6);
    expect(w.multiplier).toBe(multiplier);
    expect(w.player.invuln).toBeCloseTo(SHIELD_INVULN, 5);
    expect(SHIELD_INVULN).toBeLessThan(INVULN_TIME);
    expect(hasPower(w, 'mushroom')).toBe(false);
  });

  it('is spent on that one hit: the next real hit costs a heart', () => {
    const w = newRun();
    activatePower(w, 'mushroom');
    withCombo(w, 4);
    landNext(w, 0);
    step(w, 1);
    // Wait out the shield's grace, then get hit again.
    step(w, seconds(SHIELD_INVULN) + 3);
    expect(w.player.invuln).toBe(0);
    landNext(w, 0);
    const events = step(w, 1);
    expect(types(events)).toContain('hit');
    expect(w.player.hearts).toBe(MAX_HEARTS - 1);
    expect(w.combo).toBe(0);
  });

  it('absorbs a rock too, and the rock does not hit twice', () => {
    const w = newRun();
    activatePower(w, 'mushroom');
    withCombo(w, 5);
    const rock = rockOnLeaf(w);
    stepWorld(w, NONE, SIM_DT);
    const events = [...w.events];
    w.events.length = 0;
    expect(events.find((e) => e.type === 'shield-block')).toMatchObject({ source: 'rock' });
    expect(w.player.hearts).toBe(MAX_HEARTS);
    expect(w.combo).toBe(5);
    expect(rock.hit).toBe(true);
    // Keep the rock on the leaf well past the grace time: it has been "hit" once and stays harmless.
    for (let i = 0; i < seconds(1); i++) {
      stepWorld(w, NONE, SIM_DT);
      w.drops.length = 0;
      rock.y = w.player.y;
      rock.x = w.player.x;
    }
    expect(w.hitsTaken).toBe(0);
    expect(w.player.hearts).toBe(MAX_HEARTS);
  });

  it('is not wasted while the leaf is already invulnerable', () => {
    const w = newRun();
    activatePower(w, 'mushroom');
    w.player.invuln = 1;
    w.events.length = 0;
    expect(absorbHit(w, 0, 0, 'drop')).toBe(false);
    expect(hasPower(w, 'mushroom')).toBe(true);
    expect(w.events).toEqual([]);
  });

  it('only a mushroom absorbs: other powers and the plain leaf take the hit', () => {
    const w = newRun();
    expect(absorbHit(w, 0, 0, 'rock')).toBe(false);
    activatePower(w, 'honey');
    activatePower(w, 'firefly');
    expect(absorbHit(w, 0, 0, 'twig')).toBe(false);
    expect(w.powers).toHaveLength(2);
    landNext(w, 0);
    step(w, 1);
    expect(w.player.hearts).toBe(MAX_HEARTS - 1);
    expect(w.player.invuln).toBeGreaterThan(SHIELD_INVULN);
  });

  it('keeps the order of the remaining icons when it breaks', () => {
    const w = newRun();
    activatePower(w, 'honey');
    activatePower(w, 'mushroom');
    activatePower(w, 'firefly');
    expect(absorbHit(w, 1, 2, 'drop')).toBe(true);
    expect(w.powers.map((p) => p.kind)).toEqual(['honey', 'firefly']);
  });
});

describe('firefly', () => {
  it('widens the near-miss band 1.5x while it lasts', () => {
    const w = newRun();
    expect(nearBandScale(w)).toBe(1);
    activatePower(w, 'firefly');
    expect(nearBandScale(w)).toBe(FIREFLY_BAND);
    expect(FIREFLY_BAND).toBe(1.5);
    step(w, seconds(12.1));
    expect(nearBandScale(w)).toBe(1);
  });

  it('turns a splash just outside the normal band into a near-miss', () => {
    // r 18 + ant 10 = 28 to hit; the normal band reaches 20 further (48), the firefly's 30 (58).
    const plain = newRun();
    landNext(plain, 28 + 24);
    stepWorld(plain, NONE, SIM_DT);
    expect(types(plain.events)).not.toContain('near-miss');
    expect(plain.nearMisses).toBe(0);

    const lit = newRun();
    activatePower(lit, 'firefly');
    lit.events.length = 0;
    landNext(lit, 28 + 24);
    stepWorld(lit, NONE, SIM_DT);
    expect(lit.nearMisses).toBe(1);
    expect(lit.combo).toBe(1);
    expect(lit.events.some((e) => e.type === 'near-miss')).toBe(true);
    expect(lit.player.hearts).toBe(MAX_HEARTS);
  });

  it('does not make a direct hit any softer', () => {
    const w = newRun();
    activatePower(w, 'firefly');
    landNext(w, 0);
    step(w, 1);
    expect(w.player.hearts).toBe(MAX_HEARTS - 1);
  });
});

describe('ladybug', () => {
  it('heals one heart and says so', () => {
    const w = newRun();
    w.player.hearts = 1;
    w.events.length = 0;
    activatePower(w, 'ladybug');
    expect(w.player.hearts).toBe(2);
    expect(w.events).toEqual([{ type: 'heal', hearts: 2 }]);
    activatePower(w, 'ladybug');
    expect(w.player.hearts).toBe(MAX_HEARTS);
    expect(w.powers).toHaveLength(0);
  });

  it('never goes above the maximum: full hearts pay 100 x multiplier instead', () => {
    const w = newRun();
    w.events.length = 0;
    const before = w.score;
    activatePower(w, 'ladybug');
    expect(w.player.hearts).toBe(MAX_HEARTS);
    expect(w.score - before).toBe(LADYBUG_POINTS);
    expect(w.events).toEqual([]);

    withCombo(w, 8); // x3
    const before3 = w.score;
    activatePower(w, 'ladybug');
    expect(w.score - before3).toBe(300);
    expect(w.player.hearts).toBe(MAX_HEARTS);
  });

  it('is instant: it never shows up as a timed power', () => {
    const w = newRun();
    w.player.hearts = 2;
    activatePower(w, 'ladybug');
    expect(w.powers).toHaveLength(0);
    expect(w.events.some((e) => e.type === 'power-start')).toBe(false);
  });
});
