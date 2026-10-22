// Leaf steering. Every device feeds one steering target; the leaf eases
// towards it with a capped speed. The keyboard path is the slowest way to
// move, so the fairness checks measure reach with exactly this code.

import { SIM_DT } from '../config';
import type { InputFrame, World } from '../types';
import { riverEdgesInto, type RiverEdges } from './river';
import type { SimState } from './state';
import {
  BANK_BUMP_COOLDOWN,
  BANK_MARGIN,
  FOLLOW_RATE,
  KEY_RAMP_START,
  KEY_RAMP_TIME,
  KEY_RELEASE_KEEP,
  KEY_SPEED,
  MAX_LEAF_SPEED,
  TILT_MAX,
  TILT_SPEED_REF,
} from './tuning';

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** The part of steering state that the reach table simulates too. */
export interface SteerCore {
  x: number;
  targetX: number;
  /** Seconds the current axis direction has been held. */
  hold: number;
  /** -1, 0 or 1: the direction being held. */
  sign: number;
}

/** Keyboard/gamepad axis → target movement, with a short acceleration ramp. */
function applyAxis(core: SteerCore, axis: number, dt: number): void {
  const a = clamp(axis, -1, 1);
  const sign = a > 0.001 ? 1 : a < -0.001 ? -1 : 0;
  if (sign === 0) {
    if (core.sign !== 0) {
      // Key released: drop most of the target's lead so the leaf settles near
      // where the player let go instead of sailing on.
      core.targetX = core.x + (core.targetX - core.x) * KEY_RELEASE_KEEP;
    }
    core.sign = 0;
    core.hold = 0;
    return;
  }
  if (sign !== core.sign) {
    core.sign = sign;
    core.hold = 0;
  }
  core.hold += dt;
  const ramp = KEY_RAMP_START + (1 - KEY_RAMP_START) * Math.min(1, core.hold / KEY_RAMP_TIME);
  core.targetX += a * KEY_SPEED * ramp * dt;
}

/** Leaf x after easing towards the target for dt, with the speed cap. */
function followX(x: number, targetX: number, dt: number): number {
  const k = dt === SIM_DT ? FOLLOW_K : 1 - Math.exp(-FOLLOW_RATE * dt);
  const max = MAX_LEAF_SPEED * dt;
  return x + clamp((targetX - x) * k, -max, max);
}

const FOLLOW_K = 1 - Math.exp(-FOLLOW_RATE * SIM_DT);

// --- Reach table ------------------------------------------------------------
// How far a leaf at rest can travel in t seconds using the keyboard (the
// slowest device). Built by running the real steering code, not a formula.

const REACH_DT = SIM_DT;
const REACH_T_MAX = 2;
const reachTable = (() => {
  const n = Math.ceil(REACH_T_MAX / REACH_DT) + 1;
  const table = new Float64Array(n);
  const core: SteerCore = { x: 0, targetX: 0, hold: 0, sign: 0 };
  for (let i = 1; i < n; i++) {
    applyAxis(core, 1, REACH_DT);
    core.x = followX(core.x, core.targetX, REACH_DT);
    table[i] = core.x;
  }
  return table;
})();

/** Distance (units) the leaf can cover from rest in `t` seconds with the keyboard. */
export function reachIn(t: number): number {
  if (t <= 0) return 0;
  const f = t / REACH_DT;
  const i = Math.floor(f);
  const last = reachTable.length - 1;
  if (i >= last) return reachTable[last] + (t - REACH_T_MAX) * KEY_SPEED;
  return reachTable[i] + (reachTable[i + 1] - reachTable[i]) * (f - i);
}

// --- Per-step steering --------------------------------------------------------

/** Leaf-centre limits at the player's row. */
const edges: RiverEdges = { left: 0, right: 0 };

export function leafLimits(world: World, out: { lo: number; hi: number }): void {
  riverEdgesInto(world.seed, world.distance, edges);
  out.lo = edges.left + BANK_MARGIN;
  out.hi = edges.right - BANK_MARGIN;
}

const limits = { lo: 0, hi: 0 };

/**
 * Steers the leaf for one step. `emitBumps` is false outside a live run.
 * Returns nothing; may push a 'bank-bump' event.
 */
export function steerPlayer(world: World, st: SimState, input: InputFrame, dt: number, emitBumps: boolean): void {
  const p = world.player;
  const core = st.steer;
  core.x = p.x;
  core.targetX = p.targetX;

  if (input.absoluteX !== null) core.targetX = input.absoluteX;
  core.targetX += input.steerDelta;
  applyAxis(core, input.axis, dt);

  leafLimits(world, limits);
  const { lo, hi } = limits;
  core.targetX = clamp(core.targetX, lo, hi);

  const prevX = p.x;
  // The bank can also sweep into a resting leaf as the river bends.
  const x = clamp(followX(p.x, core.targetX, dt), lo, hi);
  p.x = x;
  p.targetX = core.targetX;
  p.vx = (x - prevX) / dt;

  const tiltTarget = clamp((p.vx / TILT_SPEED_REF) * TILT_MAX, -TILT_MAX, TILT_MAX);
  p.tilt += (tiltTarget - p.tilt) * Math.min(1, 12 * dt);

  // Bank contact: the target is pinned to a limit and the leaf has arrived.
  // Bump only on the rising edge so holding into a bank doesn't buzz.
  const side = p.targetX <= lo + 0.5 && x <= lo + 2 ? -1 : p.targetX >= hi - 0.5 && x >= hi - 2 ? 1 : 0;
  st.bumpCooldown = Math.max(0, st.bumpCooldown - dt);
  if (side !== 0 && side !== st.bankContact && st.bumpCooldown <= 0 && emitBumps) {
    world.events.push({ type: 'bank-bump', x: x + side * 26, y: p.y, side });
    st.bumpCooldown = BANK_BUMP_COOLDOWN;
  }
  st.bankContact = side;
}

/** Menu backdrop: the leaf meanders down the middle of the river by itself. */
export function autopilot(world: World, st: SimState, dt: number): void {
  const p = world.player;
  leafLimits(world, limits);
  const mid = (limits.lo + limits.hi) / 2;
  const half = (limits.hi - limits.lo) / 2;
  st.autopilotT += dt;
  const t = st.autopilotT;
  const sway = Math.sin(t * 0.37) * 0.55 + Math.sin(t * 0.91 + 1.3) * 0.2;
  p.targetX = clamp(mid + sway * half * 0.7, limits.lo, limits.hi);
  const prevX = p.x;
  p.x = clamp(p.x + (p.targetX - p.x) * Math.min(1, 1.6 * dt), limits.lo, limits.hi);
  p.vx = (p.x - prevX) / dt;
  const tiltTarget = clamp((p.vx / 90) * TILT_MAX * 0.6, -TILT_MAX, TILT_MAX);
  p.tilt += (tiltTarget - p.tilt) * Math.min(1, 4 * dt);
}

/** After death: no input, the leaf drifts to a stop. */
export function driftPlayer(world: World, dt: number): void {
  const p = world.player;
  leafLimits(world, limits);
  p.targetX = clamp(p.targetX, limits.lo, limits.hi);
  const prevX = p.x;
  p.x = clamp(p.x + (p.targetX - p.x) * Math.min(1, 3 * dt), limits.lo, limits.hi);
  p.vx = (p.x - prevX) / dt;
  p.tilt += (0 - p.tilt) * Math.min(1, 3 * dt);
}
