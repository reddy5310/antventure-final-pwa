// What happens when the ant gets hit, and the switch into the death sequence.

import type { HitSource, World } from '../types';
import { breakCombo } from './scoring';
import type { SimState } from './state';
import { HURT_TIME, INVULN_TIME, WET_PER_HIT } from './tuning';

export function applyHit(world: World, st: SimState, source: HitSource, x: number, y: number): void {
  const p = world.player;
  p.hearts = Math.max(0, p.hearts - 1);
  p.invuln = INVULN_TIME;
  p.hurt = HURT_TIME;
  p.wet = Math.min(1, p.wet + WET_PER_HIT);
  world.hitsTaken++;
  breakCombo(world);
  world.events.push({ type: 'hit', x, y, source, heartsLeft: p.hearts });
  if (p.hearts <= 0) startDying(world, st);
}

function startDying(world: World, st: SimState): void {
  world.state = 'dying';
  world.deathTimer = 0;
  st.deathScroll = world.scrollSpeed;
  st.deathTime = world.time;
  world.events.push({ type: 'death', x: world.player.x, y: world.player.y });
}
