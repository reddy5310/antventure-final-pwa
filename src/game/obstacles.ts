// Rocks, twigs and rock gates. Laid out along the river by distance (not
// time), from their own seeded stream, so they sit at the same spots on every
// screen and every Daily River attempt. Every obstacle leaves a lane at
// least OBSTACLE_PASS wide for the leaf, and consecutive obstacles are far
// enough apart to swap lanes between them.

import { LEAF_HIT_R, SPAWN_AHEAD } from '../config';
import type { World } from '../types';
import { closestOnObstacle, circleHitsObstacle } from './collision';
import { applyHit } from './damage';
import { createDifficulty, difficultyAt, scrollAtLevel, timeAtDistance } from './difficulty';
import { riverEdgesInto, type RiverEdges } from './river';
import type { SimState } from './state';
import {
  BANK_MARGIN,
  DESPAWN_BELOW,
  GATE_LANE,
  KEY_SPEED,
  KNOCKBACK,
  OBSTACLE_PASS,
  ROCK_R_MAX,
  ROCK_R_MIN,
  TWIG_LEN_MAX,
  TWIG_LEN_MIN,
  TWIG_R,
} from './tuning';

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const edges: RiverEdges = { left: 0, right: 0 };
const layoutDiff = createDifficulty();
const contact = { x: 0, y: 0 };

/** Longest twig half-length that still leaves a lane even when it lies across the middle. */
export function maxTwigLen(riverWidth: number): number {
  const leafRange = riverWidth - 2 * BANK_MARGIN;
  return (leafRange - 2 * LEAF_HIT_R - 2 * OBSTACLE_PASS) / 2 - TWIG_R;
}

/** How far to slide a rock towards the bank to close a lane of width `lane` that is too narrow to use. */
function sliver(lane: number): number {
  return lane > 0 && lane < OBSTACLE_PASS ? lane + 2 : 0;
}

function addRock(world: World, x: number, y: number, r: number, variant: number): void {
  world.obstacles.push({ id: world.nextId++, kind: 'rock', x, y, r, len: 0, angle: variant * Math.PI * 2, spin: 0, vx: 0, variant, hit: false });
}

/** Lays out one obstacle (or gate) at river distance d and schedules the next. */
function layoutAt(world: World, st: SimState, d: number): void {
  const rng = st.obsRng;
  // Fixed draws per layout, whatever is placed.
  const uKind = rng.next();
  const uX = rng.next();
  const uSize = rng.next();
  const uAngle = rng.next();
  const uSpin = rng.next();
  const uVx = rng.next();
  const uVariant = rng.next();
  const uGap = rng.next();

  // Density follows the time curve, evaluated at the moment a living run
  // first sees this spot (SPAWN_AHEAD before reaching it).
  const diff = difficultyAt(timeAtDistance(d - SPAWN_AHEAD), layoutDiff);
  const e = riverEdgesInto(world.seed, d, edges);
  const width = e.right - e.left;
  const lo = e.left + BANK_MARGIN;
  const hi = e.right - BANK_MARGIN;
  const y = world.player.y - (d - world.distance);
  const twigRoom = maxTwigLen(width);

  let extent: number;
  if (uKind < diff.gateChance) {
    // Gate: two rocks around a guaranteed lane.
    const rr = lerp(16, 24, uSize);
    const lane = lerp(lo + GATE_LANE / 2, hi - GATE_LANE / 2, uX);
    const off = GATE_LANE / 2 + LEAF_HIT_R + rr;
    const xl = lane - off;
    const xr = lane + off;
    if (xl > e.left - rr * 0.4) addRock(world, xl - sliver(xl - rr - LEAF_HIT_R - lo), y, rr, uVariant);
    if (xr < e.right + rr * 0.4) addRock(world, xr + sliver(hi - (xr + rr + LEAF_HIT_R)), y, rr, (uVariant + 0.5) % 1);
    extent = rr;
  } else if (uKind < diff.gateChance + diff.twigChance && twigRoom >= TWIG_LEN_MIN) {
    const len = Math.min(lerp(TWIG_LEN_MIN, TWIG_LEN_MAX, uSize), twigRoom);
    const ext = len + TWIG_R;
    const spin = (2 * uSpin - 1) * 1.1;
    world.obstacles.push({
      id: world.nextId++,
      kind: 'twig',
      x: lerp(e.left + ext, e.right - ext, uX),
      y,
      r: TWIG_R,
      len,
      angle: uAngle * Math.PI,
      spin: Math.abs(spin) < 0.2 ? (spin < 0 ? -0.2 : 0.2) : spin,
      vx: (2 * uVx - 1) * lerp(12, 42, Math.min(diff.level, 1)),
      variant: uVariant,
      hit: false,
    });
    extent = ext;
  } else {
    const rr = lerp(ROCK_R_MIN, ROCK_R_MAX, uSize) * clamp(width / 300, 0.8, 1.05);
    let x = lerp(e.left + rr * 0.5, e.right - rr * 0.5, uX);
    // Make sure one side keeps a lane: slide away from the middle if needed.
    const leftLane = x - rr - LEAF_HIT_R - lo;
    const rightLane = hi - (x + rr + LEAF_HIT_R);
    if (Math.max(leftLane, rightLane) < OBSTACLE_PASS) {
      if (leftLane >= rightLane) x = lo + OBSTACLE_PASS + LEAF_HIT_R + rr;
      else x = hi - OBSTACLE_PASS - LEAF_HIT_R - rr;
    }
    // A lane that only looks passable is a trap: close it against the bank.
    x -= sliver(x - rr - LEAF_HIT_R - lo);
    x += sliver(hi - (x + rr + LEAF_HIT_R));
    addRock(world, x, y, rr, uVariant);
    extent = rr;
  }

  // Spacing: the difficulty gap, but never less than it takes to cross the
  // whole river with the keyboard between two obstacles.
  const scroll = scrollAtLevel(diff.level);
  const cross = (hi - lo) / KEY_SPEED;
  const minGap = 2 * (ROCK_R_MAX + LEAF_HIT_R) + extent + scroll * cross * 0.6;
  st.nextObstacleD = d + Math.max(minGap, diff.obstacleGap * (0.8 + 0.4 * uGap));
}

/** Lays out every obstacle that has come within lookahead (live runs only). */
export function layoutObstacles(world: World, st: SimState): void {
  // On very tall screens look further ahead so nothing pops in on screen.
  const lookahead = Math.max(SPAWN_AHEAD, world.player.y + 60);
  while (st.nextObstacleD <= world.distance + lookahead) layoutAt(world, st, st.nextObstacleD);
}

/**
 * Moves obstacles with the river, drifts and spins twigs, resolves leaf
 * collisions (`live` only) and removes what has left the view.
 */
export function updateObstacles(world: World, st: SimState, dt: number, live: boolean): void {
  const p = world.player;
  const v = world.scrollSpeed;
  const obs = world.obstacles;
  const limit = world.viewH + DESPAWN_BELOW;
  let w = 0;
  for (let i = 0; i < obs.length; i++) {
    const o = obs[i];
    // Twigs only start drifting once within SPAWN_AHEAD of the leaf (measured
    // before this step's move, i.e. from the step after a normal screen would
    // lay them out): on tall screens they exist earlier, and this keeps their
    // path screen-independent.
    const drifting = o.kind === 'twig' && p.y - o.y <= SPAWN_AHEAD;
    o.y += v * dt;
    if (drifting) {
      // After the run ends they keep turning, just lazily.
      const k = live ? 1 : 0.35;
      o.angle += o.spin * dt * k;
      o.x += o.vx * dt * k;
      riverEdgesInto(world.seed, world.distance + (p.y - o.y), edges);
      const ext = o.len + o.r;
      if (o.x - ext < edges.left && o.vx < 0) o.vx = -o.vx;
      else if (o.x + ext > edges.right && o.vx > 0) o.vx = -o.vx;
    }
    if (live && !o.hit && world.state === 'running' && circleHitsObstacle(o, p.x, p.y, LEAF_HIT_R)) {
      o.hit = true;
      // Brushing past while still invulnerable is free.
      if (p.invuln <= 0) {
        closestOnObstacle(o, p.x, p.y, contact);
        const side = p.x >= contact.x ? 1 : -1;
        p.targetX += side * KNOCKBACK;
        p.x += side * 6;
        applyHit(world, st, o.kind, (p.x + contact.x) / 2, (p.y + contact.y) / 2);
      }
    }
    if (o.y - (o.len + o.r) > limit) continue;
    obs[w++] = o;
  }
  obs.length = w;
}
