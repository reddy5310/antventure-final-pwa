// The gameplay simulation: one fixed step at a time, deterministic for a seed
// and an input sequence. State flow:
//   attract (menu backdrop)    running → dying → over

import { MAX_HEARTS, PLAYER_FROM_BOTTOM, UNITS_PER_METER } from '../config';
import { createRng } from '../engine/rng';
import type { InputFrame, Mode, RunSummary, World } from '../types';
import { difficultyAt } from './difficulty';
import { spawnDemoDrop, spawnDrops, updateDrops } from './drops';
import { layoutObstacles, updateObstacles } from './obstacles';
import { autopilot, driftPlayer, steerPlayer } from './player';
import { riverEdgesAt } from './river';
import { addDistanceScore, checkProgress, updateCombo } from './scoring';
import { simState, type SimState } from './state';
import { initStorm, updateStorm } from './storm';
import { ATTRACT_SCROLL, DEATH_DURATION, DEATH_STOP_TIME, DRY_RATE, WET_FLOOR_PER_INTENSITY } from './tuning';
import { layoutPickups, updatePickups } from './pickups';
import { updatePowers } from './powers';
import { currentZoneMods, trackZone } from './zones';

export { difficultyAt, levelAt, type Difficulty } from './difficulty';

export interface CreateWorldOptions {
  mode: Mode;
  seed: number;
  dailyId: string | null;
  /** Farthest distance on this board in world units (0 if none) — drawn as a flag. */
  bestDistance: number;
  /** Best score on this board (0 if none): beating it is the run's 'new-best'. */
  bestScore?: number;
  viewH: number;
  /** Menu backdrop: river scrolls, no hazards, no damage. */
  attract?: boolean;
}

export function createWorld(opts: CreateWorldOptions): World {
  const y = opts.viewH - PLAYER_FROM_BOTTOM;
  const start = riverEdgesAt(opts.seed, 0);
  const x = (start.left + start.right) / 2;
  const world: World = {
    mode: opts.mode,
    seed: opts.seed,
    dailyId: opts.dailyId,
    rng: createRng(opts.seed),
    state: opts.attract ? 'attract' : 'running',
    time: 0,
    distance: 0,
    scrollSpeed: opts.attract ? ATTRACT_SCROLL : difficultyAt(0).scroll,
    viewH: opts.viewH,
    player: { x, y, targetX: x, vx: 0, hearts: MAX_HEARTS, invuln: 0, hurt: 0, wet: 0, tilt: 0 },
    drops: [],
    obstacles: [],
    score: 0,
    combo: 0,
    comboTimer: 0,
    multiplier: 1,
    maxCombo: 0,
    nearMisses: 0,
    hitsTaken: 0,
    storm: 'calm',
    intensity: 0,
    bestScore: Math.max(0, Math.floor(opts.bestScore ?? 0)),
    beatBest: false,
    bestDistance: opts.bestDistance,
    passedBest: false,
    deathTimer: 0,
    nextId: 1,
    events: opts.attract ? [] : [{ type: 'start' }],
    zone: 'jungle',
    nextZone: 'jungle',
    zoneBlend: 0,
    zonesReached: 1,
    pickups: [],
    crumbs: 0,
    powers: [],
    darkness: 0,
  };
  trackZone(world);
  const st = simState(world);
  if (opts.attract) {
    world.intensity = 0.22;
  } else {
    initStorm(world, st);
    // The grace period is in the difficulty curve (rate 0); start ready to spawn.
    st.dropTimer = 0.2;
  }
  return world;
}

function tickPlayerTimers(world: World, dt: number): void {
  const p = world.player;
  p.invuln = Math.max(0, p.invuln - dt);
  p.hurt = Math.max(0, p.hurt - dt);
  // Dries off slowly, but heavy rain keeps the ant a little damp.
  const floor = world.intensity * WET_FLOOR_PER_INTENSITY;
  if (p.wet > floor) p.wet = Math.max(floor, p.wet - DRY_RATE * dt);
  else p.wet += (floor - p.wet) * Math.min(1, 0.25 * dt);
}

function stepRunning(world: World, st: SimState, input: InputFrame, dt: number): void {
  world.time += dt;
  const diff = difficultyAt(world.time, st.diff);
  trackZone(world);
  // Rapids run faster, Lily Marsh slower (blended across transitions).
  world.scrollSpeed = diff.scroll * currentZoneMods(world).scroll;
  const travelled = world.scrollSpeed * dt;
  world.distance += travelled;
  addDistanceScore(world, travelled);

  updateStorm(world, st, dt, true);
  steerPlayer(world, st, input, dt, true);
  tickPlayerTimers(world, dt);
  updateCombo(world, dt);

  updateDrops(world, st, dt, true);
  updateObstacles(world, st, dt, true);
  updatePickups(world, dt, true);
  if (world.state === 'running') updatePowers(world, dt);
  if (world.state === 'running') {
    layoutObstacles(world, st);
    layoutPickups(world);
    spawnDrops(world, st, dt);
    checkProgress(world, st);
  }
}

function stepDying(world: World, st: SimState, dt: number): void {
  world.time += dt;
  world.deathTimer += dt;
  // The river eases to a stop under the fallen leaf.
  const k = Math.max(0, 1 - world.deathTimer / DEATH_STOP_TIME);
  world.scrollSpeed = st.deathScroll * k * k;
  world.distance += world.scrollSpeed * dt;
  updateStorm(world, st, dt, false);
  driftPlayer(world, dt);
  tickPlayerTimers(world, dt);
  updateDrops(world, st, dt, false);
  updateObstacles(world, st, dt, false);
  updatePickups(world, dt, false);
  trackZone(world);
  if (world.deathTimer >= DEATH_DURATION) {
    world.state = 'over';
    if (!st.gameOverSent) {
      st.gameOverSent = true;
      world.events.push({ type: 'game-over' });
    }
  }
}

/** Behind the game-over screen: no spawns, leftovers settle. */
function stepOver(world: World, st: SimState, dt: number): void {
  world.time += dt;
  world.deathTimer += dt;
  world.scrollSpeed = 0;
  updateStorm(world, st, dt, false);
  driftPlayer(world, dt);
  tickPlayerTimers(world, dt);
  updateDrops(world, st, dt, false);
  updateObstacles(world, st, dt, false);
  updatePickups(world, dt, false);
}

function stepAttract(world: World, st: SimState, dt: number): void {
  world.time += dt;
  world.scrollSpeed = ATTRACT_SCROLL;
  world.distance += ATTRACT_SCROLL * dt;
  trackZone(world);
  updateStorm(world, st, dt, false);
  autopilot(world, st, dt);
}

/** Advance the world by dt seconds. Appends to world.events (main drains them). */
export function stepWorld(world: World, input: InputFrame, dt: number): void {
  const st = simState(world);
  switch (world.state) {
    case 'running':
      stepRunning(world, st, input, dt);
      break;
    case 'dying':
      stepDying(world, st, dt);
      break;
    case 'over':
      stepOver(world, st, dt);
      break;
    case 'attract':
      stepAttract(world, st, dt);
      break;
  }
}

/** The view height changed (resize). Re-anchor the player; the river keeps its place relative to it. */
export function setViewHeight(world: World, viewH: number): void {
  const dy = viewH - PLAYER_FROM_BOTTOM - world.player.y;
  world.viewH = viewH;
  if (dy === 0) return;
  world.player.y += dy;
  for (const d of world.drops) d.y += dy;
  for (const o of world.obstacles) o.y += dy;
}

/**
 * First-run tutorial: hold back raindrops (true) until the player has steered.
 * Patterns are still locked that early, so only the single-drop clock waits.
 */
export function setDropHold(world: World, hold: boolean): void {
  const st = simState(world);
  const release = st.holdDrops && !hold;
  st.holdDrops = hold;
  // The first drop after the hold is a slow demo beside the leaf, so the hint
  // that appears now explains something the player can watch.
  if (release && world.state === 'running') spawnDemoDrop(world, st);
}

export function summarize(world: World): RunSummary {
  const st = simState(world);
  // Frozen at the moment of death, so retrying during the death animation
  // records exactly what waiting for the game-over screen would.
  const ended = world.state === 'dying' || world.state === 'over';
  return {
    mode: world.mode,
    dailyId: world.dailyId,
    seed: world.seed,
    score: Math.floor(world.score),
    distanceM: Math.floor((ended ? st.deathDistance : world.distance) / UNITS_PER_METER),
    timeS: ended ? st.deathTime : world.time,
    nearMisses: world.nearMisses,
    maxCombo: world.maxCombo,
    hitsTaken: world.hitsTaken,
    killedBy: ended ? st.killedBy : null,
    crumbs: world.crumbs,
    zonesReached: world.zonesReached,
  };
}
