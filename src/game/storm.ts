// Storm phases give a run its rhythm: lulls to breathe, then build-ups.
//   calm → drizzle → downpour → (cloudburst, after CLOUDBURST_UNLOCK) → calm …
// Durations come from world.rng at each phase change (time-based, so the
// sequence is identical for every Daily River attempt).

import type { StormPhase, World } from '../types';
import { PHASE_MODS } from './difficulty';
import type { SimState } from './state';

/** Cloudbursts join the cycle from here on (s): skilled runs reach real pressure within the first minute. */
export const CLOUDBURST_UNLOCK = 60;
/** How quickly world.intensity glides to its target (1/s). */
const INTENSITY_RATE = 0.7;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function nextPhase(world: World): StormPhase {
  switch (world.storm) {
    case 'calm':
      return 'drizzle';
    case 'drizzle':
      return 'downpour';
    case 'downpour':
      return world.time >= CLOUDBURST_UNLOCK ? 'cloudburst' : 'calm';
    case 'cloudburst':
      return 'calm';
  }
}

function phaseDuration(phase: StormPhase, level: number, first: boolean, u: number): number {
  const l1 = Math.min(level, 1);
  const over = Math.max(0, level - 1);
  switch (phase) {
    case 'calm':
      // The opening calm covers the grace period and the tutorial hints.
      return first ? 10 + 2 * u : lerp(9, 5, l1) - 1.5 * over + 2 * u;
    case 'drizzle':
      return lerp(16, 11, l1) + 4 * u;
    case 'downpour':
      return lerp(12, 16, l1) + 4 * u;
    case 'cloudburst':
      return 7 + 3 * u + 3 * over;
  }
}

export function initStorm(world: World, st: SimState): void {
  world.storm = 'calm';
  st.stormCount = 0;
  st.stormLeft = phaseDuration('calm', 0, true, world.rng.next());
  world.intensity = PHASE_MODS.calm.intensity;
}

function intensityTarget(world: World, level: number): number {
  const v = PHASE_MODS[world.storm].intensity + 0.14 * Math.min(level, 1) + 0.06 * Math.max(0, level - 1);
  return v > 1 ? 1 : v;
}

/** Advances the phase clock (live runs only) and glides the intensity. */
export function updateStorm(world: World, st: SimState, dt: number, live: boolean): void {
  const level = st.diff.level;
  if (live) {
    st.stormLeft -= dt;
    if (st.stormLeft <= 0) {
      world.storm = nextPhase(world);
      st.stormCount++;
      st.stormLeft += phaseDuration(world.storm, level, false, world.rng.next());
      world.events.push({ type: 'storm', phase: world.storm });
    }
  }
  const target = world.state === 'attract' ? 0.22 + 0.08 * Math.sin(world.time * 0.21) : intensityTarget(world, level);
  world.intensity += (target - world.intensity) * Math.min(1, INTENSITY_RATE * dt);
}
