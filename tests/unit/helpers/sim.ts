// Headless run helpers for the gameplay tests: a runner, an idle player and
// a dodging bot that only uses keyboard-style input (the slowest device).

import { ANT_HIT_R, LEAF_HIT_R, SIM_DT } from '../../../src/config';
import { reachIn } from '../../../src/game/player';
import { riverEdgesAt } from '../../../src/game/river';
import { BANK_MARGIN } from '../../../src/game/tuning';
import { createWorld, stepWorld } from '../../../src/game/world';
import type { GameEvent, InputFrame, World } from '../../../src/types';

export type Controller = (world: World) => InputFrame;

export const idle: Controller = () => ({ steerDelta: 0, axis: 0, absoluteX: null });

export interface RunResult {
  world: World;
  /** Survival time (s), or the cap if the run was still alive. */
  time: number;
  died: boolean;
  events: GameEvent[];
}

export interface RunOptions {
  seed: number;
  maxTime: number;
  viewH?: number;
  bestDistance?: number;
  /** Keep every event (memory heavy on long runs); otherwise only non-impact events. */
  keepAllEvents?: boolean;
}

export function runSim(controller: Controller, opts: RunOptions): RunResult {
  const world = createWorld({
    mode: 'endless',
    seed: opts.seed,
    dailyId: null,
    bestDistance: opts.bestDistance ?? 0,
    viewH: opts.viewH ?? 800,
  });
  const events: GameEvent[] = [];
  const maxSteps = Math.round(opts.maxTime / SIM_DT);
  let steps = 0;
  let deathTime = -1;
  while (steps < maxSteps) {
    stepWorld(world, controller(world), SIM_DT);
    steps++;
    for (const e of world.events) {
      if (opts.keepAllEvents || e.type !== 'drop-impact') events.push(e);
      if (e.type === 'death') deathTime = world.time;
    }
    world.events.length = 0;
    if (world.state === 'over') break;
  }
  return { world, time: deathTime >= 0 ? deathTime : world.time, died: deathTime >= 0, events };
}

interface Hazard {
  x0: number;
  x1: number;
  t0: number;
  t1: number;
}

export interface BotOptions {
  /** Drops are ignored until their shadow has been visible this long (s). */
  reaction?: number;
  /** Extra clearance the bot keeps from splashes and obstacles (units). */
  margin?: number;
  /** Seconds between re-plans. */
  decisionDt?: number;
}

/**
 * A straightforward planner: every decision it tries candidate positions
 * across the river, simulates sliding there at keyboard speed, and picks the
 * cheapest path that is not splashed or blocked when hazards arrive (urgent
 * ones weigh most). Then it steers with the keyboard axis.
 */
export function createDodgeBot(options: BotOptions = {}): Controller {
  const reaction = options.reaction ?? 0.2;
  const margin = options.margin ?? 4;
  const decisionDt = options.decisionDt ?? 1 / 30;
  const hazards: Hazard[] = [];
  let target = NaN;
  let sinceDecision = Infinity;

  const plan = (world: World): number => {
    const p = world.player;
    const v = Math.max(1, world.scrollSpeed);
    hazards.length = 0;
    for (const d of world.drops) {
      if (d.age < reaction) continue;
      const tau = d.fall - d.age;
      const dy = d.y + v * tau - p.y;
      const R = d.r + ANT_HIT_R + margin;
      if (Math.abs(dy) >= R) continue;
      const h = Math.sqrt(R * R - dy * dy);
      hazards.push({ x0: d.x - h, x1: d.x + h, t0: tau - 0.03, t1: tau + 0.03 });
    }
    for (const o of world.obstacles) {
      if (o.hit || o.y < -40) continue;
      const ry = o.kind === 'rock' ? o.r + LEAF_HIT_R : o.len + o.r + LEAF_HIT_R;
      const t0 = (p.y - ry - o.y) / v;
      const t1 = (p.y + ry - o.y) / v;
      if (t1 < 0 || t0 > 2.5) continue;
      const rx =
        (o.kind === 'rock' ? o.r + LEAF_HIT_R : o.len + o.r + LEAF_HIT_R + Math.abs(o.vx) * Math.max(0, t1)) + margin * 2;
      hazards.push({ x0: o.x - rx, x1: o.x + rx, t0: Math.max(0, t0), t1 });
    }

    const e = riverEdgesAt(world.seed, world.distance);
    const lo = e.left + BANK_MARGIN;
    const hi = e.right - BANK_MARGIN;
    let best = p.x;
    let bestCost = Infinity;
    const steps = 64;
    for (let k = 0; k <= steps + 1; k++) {
      const c = k === steps + 1 ? Math.min(hi, Math.max(lo, p.x)) : lo + ((hi - lo) * k) / steps;
      const dist = Math.abs(c - p.x);
      const dir = c >= p.x ? 1 : -1;
      const pos = (t: number) => p.x + dir * Math.min(dist, reachIn(Math.max(0, t)));
      let risk = 0;
      let crowd = 0;
      for (const h of hazards) {
        const w = 1 / (Math.max(0, h.t0) + 0.15);
        let bad = false;
        if (h.t1 - h.t0 < 0.1) {
          const x = pos((h.t0 + h.t1) / 2);
          bad = x > h.x0 && x < h.x1;
        } else {
          for (let s = 0; s <= 4 && !bad; s++) {
            const x = pos(h.t0 + ((h.t1 - h.t0) * s) / 4);
            bad = x > h.x0 && x < h.x1;
          }
        }
        if (bad) risk += w;
        // Prefer open water: hazards near the destination a bit later.
        if (c > h.x0 - 30 && c < h.x1 + 30) crowd += 0.15 * w;
      }
      const cost = risk * 1000 + crowd + dist * 0.02 + Math.abs(c - (lo + hi) / 2) * 0.004;
      if (cost < bestCost) {
        bestCost = cost;
        best = c;
      }
    }
    return best;
  };

  return (world: World): InputFrame => {
    if (world.state !== 'running') return { steerDelta: 0, axis: 0, absoluteX: null };
    sinceDecision += SIM_DT;
    if (sinceDecision >= decisionDt || target !== target) {
      sinceDecision = 0;
      target = plan(world);
    }
    const p = world.player;
    // Aim the keyboard at the target, braking early for the leaf's lag.
    const err = target - (p.x + p.vx * 0.05);
    const axis = Math.abs(err) < 2 ? 0 : Math.max(-1, Math.min(1, err / 14));
    return { steerDelta: 0, axis, absoluteX: null };
  };
}

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
