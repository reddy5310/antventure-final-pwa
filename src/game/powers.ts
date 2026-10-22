// Timed power-up effects and the instant ladybug heal.
//   mushroom  shield: absorbs exactly one hit (rain or obstacle), 10 s
//   honey     magnet: crumbs drift to the leaf (applied in pickups.ts), 9 s
//   firefly   wider near-miss band (and, in the renderer, a wider light), 12 s
//   ladybug   +1 heart, or points when the hearts are already full
// Timers tick in sim steps (dt), never per frame. Picking up a kind that is
// already active refreshes its timer instead of stacking.

import { MAX_HEARTS } from '../config';
import type { ActivePower, HitSource, PickupKind, PowerKind, World } from '../types';

/** Seconds each timed power-up lasts. */
export const POWER_SECONDS: Readonly<Record<PowerKind, number>> = {
  mushroom: 10,
  honey: 9,
  firefly: 12,
};

/** Invulnerability after the mushroom takes a hit: long enough to clear the thing that hit you. */
export const SHIELD_INVULN = 0.5;
/** Near-miss band multiplier while a firefly is active. */
export const FIREFLY_BAND = 1.5;
/** A ladybug at full hearts pays this many points x multiplier. */
export const LADYBUG_POINTS = 100;

/** Is this timed power-up running right now? */
export function hasPower(world: World, kind: PowerKind): boolean {
  const list = world.powers;
  for (let i = 0; i < list.length; i++) if (list[i].kind === kind) return true;
  return false;
}

/** Points a pickup of this kind pays on collection right now (only a ladybug at full hearts pays). */
export function powerPoints(world: World, kind: Exclude<PickupKind, 'crumb'>): number {
  if (kind !== 'ladybug' || world.player.hearts < MAX_HEARTS) return 0;
  return Math.round(LADYBUG_POINTS * world.multiplier);
}

/** Applies a collected power-up pickup (starts/refreshes a timer or heals). */
export function activatePower(world: World, kind: Exclude<PickupKind, 'crumb'>): void {
  if (kind === 'ladybug') {
    const p = world.player;
    if (p.hearts < MAX_HEARTS) {
      p.hearts++;
      world.events.push({ type: 'heal', hearts: p.hearts });
    } else {
      // Nothing to heal: the bug is worth points instead.
      world.score += powerPoints(world, kind);
    }
    return;
  }
  const duration = POWER_SECONDS[kind];
  const list = world.powers;
  let active: ActivePower | null = null;
  for (let i = 0; i < list.length; i++) {
    if (list[i].kind === kind) {
      active = list[i];
      break;
    }
  }
  if (active) {
    active.left = duration;
    active.total = duration;
  } else {
    list.push({ kind, left: duration, total: duration });
  }
  world.events.push({ type: 'power-start', kind, duration });
}

/** Ticks power timers and emits 'power-end'. Call every running step. */
export function updatePowers(world: World, dt: number): void {
  const list = world.powers;
  let w = 0;
  for (let i = 0; i < list.length; i++) {
    const pw = list[i];
    pw.left -= dt;
    if (pw.left > 0) {
      list[w++] = pw;
    } else {
      world.events.push({ type: 'power-end', kind: pw.kind });
    }
  }
  list.length = w;
}

/** Multiplier for the near-miss band (firefly makes chains easier). */
export function nearBandScale(world: World): number {
  return hasPower(world, 'firefly') ? FIREFLY_BAND : 1;
}

/**
 * Called by damage before a hit lands. Returns true if the mushroom cap
 * absorbed it (no heart lost, combo kept).
 */
export function absorbHit(world: World, x: number, y: number, source: HitSource): boolean {
  const p = world.player;
  // Already invulnerable: the hit is free anyway, so keep the cap for a real one.
  if (p.invuln > 0) return false;
  const list = world.powers;
  let at = -1;
  for (let i = 0; i < list.length; i++) {
    if (list[i].kind === 'mushroom') {
      at = i;
      break;
    }
  }
  if (at < 0) return false;
  // Order-preserving removal without allocating (the HUD keeps its icon order).
  for (let i = at + 1; i < list.length; i++) list[i - 1] = list[i];
  list.length--;
  p.invuln = Math.max(p.invuln, SHIELD_INVULN);
  world.events.push({ type: 'shield-block', x, y, source });
  world.events.push({ type: 'power-end', kind: 'mushroom' });
  return true;
}
