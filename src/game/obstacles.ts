// Rocks, twigs, lily pads and rock gates. Laid out along the river by
// distance (not time), from their own seeded stream, so they sit at the same
// spots on every screen and every Daily River attempt. Every obstacle leaves a
// lane at least OBSTACLE_PASS wide for the leaf, and consecutive obstacles are
// far enough apart to swap lanes between them.
//
// Zones change the layout, always decided by the zone at the obstacle's own
// river distance (a pure function of seed and distance), never by where the
// leaf happens to be:
//   Lily Marsh   rocks (and the rocks of gates) become lily pads: soft
//                bumpers that shove the leaf aside and never hurt. They are
//                packed denser than rocks, but still leave lanes.
//   Rapids       everything is denser (spacing / zone `rocks`) and twigs are
//                shorter; the lane and spacing rules use the faster water.
//   Night River  same course as the Jungle (darkness is a render concern).

import { LEAF_HIT_R, SPAWN_AHEAD } from '../config';
import type { Obstacle, ObstacleKind, World } from '../types';
import { closestOnObstacle, circleHitsObstacle, roundClearance } from './collision';
import { applyHit } from './damage';
import { createDifficulty, difficultyAt, scrollAtLevel, timeAtDistanceOnRiver } from './difficulty';
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
  TILT_MAX,
  TWIG_LEN_MAX,
  TWIG_LEN_MIN,
  TWIG_R,
} from './tuning';
import { createZoneMods, zoneModsAt } from './zones';

// --- Lily pad tuning -------------------------------------------------------------

export const PAD_R_MIN = 18;
export const PAD_R_MAX = 30;
/** Marsh spacing is divided by this on top of the zone's rock density: pads are harmless, so more of them is fine. */
export const PAD_DENSITY = 1.35;
/** Share of the river-crossing time kept between hazards: pads need less than rocks and twigs (0.6). */
const PAD_CROSS_SHARE = 0.4;
const HARD_CROSS_SHARE = 0.6;
/** Slow turn of a floating pad (rad/s, either way). */
const PAD_SPIN_MAX = 0.32;
const PAD_SPIN_MIN = 0.05;
/**
 * A pad shoves the leaf sideways at most this fast (u/s). Well under the
 * keyboard's 420, so a player can always push through one: pads nudge, they
 * never wall.
 */
export const PAD_PUSH_MAX = 150;
/** The shove eases off as the leaf clears the pad (1/s of the overlap). */
const PAD_PUSH_RATE = 9;
/** Leaf-centre offset from a pad's middle inside which "away" is a coin toss: use the roomier side. */
const PAD_DEADZONE = 0.5;
/** A bump sounds at most this often (s), and only once per pad. */
export const PAD_BUMP_COOLDOWN = 0.3;
/** Overlap (units) below which a graze shoves but stays silent. */
const PAD_BUMP_MIN_OVERLAP = 2;
/** Visual lurch of the leaf when shoved (rad at full push speed). */
const PAD_TILT = 0.22;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const edges: RiverEdges = { left: 0, right: 0 };
const layoutDiff = createDifficulty();
const zoneHere = createZoneMods();
const zoneAhead = createZoneMods();
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

/** A rock, or a lily pad (which also turns slowly: `uAngle` and `uSpin` only matter for pads). */
function addRound(world: World, kind: ObstacleKind, x: number, y: number, r: number, variant: number, uAngle: number, uSpin: number): void {
  const pad = kind === 'pad';
  const turn = (2 * uSpin - 1) * PAD_SPIN_MAX;
  world.obstacles.push({
    id: world.nextId++,
    kind,
    x,
    y,
    r,
    len: 0,
    angle: pad ? uAngle * Math.PI * 2 : variant * Math.PI * 2,
    spin: pad ? (Math.abs(turn) < PAD_SPIN_MIN ? (turn < 0 ? -PAD_SPIN_MIN : PAD_SPIN_MIN) : turn) : 0,
    vx: 0,
    variant,
    hit: false,
  });
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
  // first sees this spot (SPAWN_AHEAD before reaching it). The clock includes
  // the zones' own speeds, so Rapids do not run ahead of the difficulty.
  const diff = difficultyAt(timeAtDistanceOnRiver(world.seed, d - SPAWN_AHEAD), layoutDiff);
  const zone = zoneModsAt(world.seed, d, zoneHere);
  const pads = zone.pads;
  const e = riverEdgesInto(world.seed, d, edges);
  const width = e.right - e.left;
  const lo = e.left + BANK_MARGIN;
  const hi = e.right - BANK_MARGIN;
  const y = world.player.y - (d - world.distance);
  const twigRoom = maxTwigLen(width);
  // Narrower (faster) water gets shorter twigs, so they still fit; wider water keeps the full range.
  const twigScale = Math.min(1, zone.width);
  const twigMin = TWIG_LEN_MIN * twigScale;
  const roundKind: ObstacleKind = pads ? 'pad' : 'rock';

  let extent: number;
  // Pads are harmless, so a gap of pads does not need the full lane-swap time.
  let soft = false;
  if (uKind < diff.gateChance) {
    // Gate: two rocks (or pads) around a guaranteed lane.
    const rr = pads ? lerp(PAD_R_MIN, 26, uSize) : lerp(16, 24, uSize);
    const lane = lerp(lo + GATE_LANE / 2, hi - GATE_LANE / 2, uX);
    const off = GATE_LANE / 2 + LEAF_HIT_R + rr;
    const xl = lane - off;
    const xr = lane + off;
    if (xl > e.left - rr * 0.4) addRound(world, roundKind, xl - sliver(xl - rr - LEAF_HIT_R - lo), y, rr, uVariant, uAngle, uSpin);
    if (xr < e.right + rr * 0.4) addRound(world, roundKind, xr + sliver(hi - (xr + rr + LEAF_HIT_R)), y, rr, (uVariant + 0.5) % 1, (uAngle + 0.5) % 1, 1 - uSpin);
    extent = rr;
    soft = pads;
  } else if (uKind < diff.gateChance + diff.twigChance && twigRoom >= twigMin) {
    const len = Math.min(lerp(twigMin, TWIG_LEN_MAX * twigScale, uSize), twigRoom);
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
    // Pads keep their size whatever the width: they are scenery with a soft edge, and lanes are kept either way.
    const rr = pads ? lerp(PAD_R_MIN, PAD_R_MAX, uSize) : lerp(ROCK_R_MIN, ROCK_R_MAX, uSize) * clamp(width / 300, 0.8, 1.05);
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
    addRound(world, roundKind, x, y, rr, uVariant, uAngle, uSpin);
    extent = rr;
    soft = pads;
  }

  // Spacing: the difficulty gap (tighter where the zone packs obstacles),
  // but never less than it takes to cross the whole river with the keyboard
  // between two obstacles. Faster water leaves less time per unit of river,
  // so the crossing term scales with the fastest zone speed on the way to
  // the next obstacle.
  const baseGap = diff.obstacleGap * (0.8 + 0.4 * uGap);
  const mid = zoneModsAt(world.seed, d + 0.5 * baseGap, zoneAhead);
  const density = mid.rocks * (mid.pads ? PAD_DENSITY : 1);
  let fastest = Math.max(zone.scroll, mid.scroll);
  fastest = Math.max(fastest, zoneModsAt(world.seed, d + baseGap, zoneAhead).scroll);
  const scroll = scrollAtLevel(diff.level) * fastest;
  const cross = (hi - lo) / KEY_SPEED;
  const minGap = 2 * (ROCK_R_MAX + LEAF_HIT_R) + extent + scroll * cross * (soft ? PAD_CROSS_SHARE : HARD_CROSS_SHARE);
  st.nextObstacleD = d + Math.max(minGap, baseGap / density);
}

/** Lays out every obstacle that has come within lookahead (live runs only). */
export function layoutObstacles(world: World, st: SimState): void {
  // On very tall screens look further ahead so nothing pops in on screen.
  const lookahead = Math.max(SPAWN_AHEAD, world.player.y + 60);
  while (st.nextObstacleD <= world.distance + lookahead) layoutAt(world, st, st.nextObstacleD);
}

// --- Lily pads: soft bumpers -------------------------------------------------------

interface PadState {
  /** Seconds until the next bump may sound. */
  cooldown: number;
  /** The pad that last bumped, so one slow crossing is one bump. */
  lastId: number;
}
const padStates = new WeakMap<World, PadState>();

/**
 * A pad under the leaf shoves it sideways, out along the contact normal. The
 * leaf only moves in x, so "out" is the sideways clearance the pad's circle
 * asks for at this height: it grows as the pad floats onto the row, which is
 * what makes the shove ease in. Never a teleport, never damage: the push is
 * capped well below the steering speed, and moves the steering target with
 * the leaf so the two do not fight.
 */
function padContact(world: World, o: Obstacle, dt: number): void {
  const p = world.player;
  const half = roundClearance(o, p.y - o.y, LEAF_HIT_R);
  if (half <= 0) return;
  const dx = p.x - o.x;
  const need = half - Math.abs(dx);
  if (need <= 0) return;

  riverEdgesInto(world.seed, world.distance, edges);
  const lo = edges.left + BANK_MARGIN;
  const hi = edges.right - BANK_MARGIN;
  // Away from the pad's middle; dead centre goes the roomier way.
  const dir = dx > PAD_DEADZONE ? 1 : dx < -PAD_DEADZONE ? -1 : hi - o.x >= o.x - lo ? 1 : -1;
  const speed = Math.min(PAD_PUSH_MAX, need * PAD_PUSH_RATE);
  const x = clamp(p.x + dir * speed * dt, lo, hi);
  const moved = x - p.x;
  p.x = x;
  p.targetX = clamp(p.targetX + moved, lo, hi);
  p.tilt = clamp(p.tilt + dir * PAD_TILT * (speed / PAD_PUSH_MAX) * Math.min(1, 12 * dt), -TILT_MAX, TILT_MAX);

  let ps = padStates.get(world);
  if (!ps) {
    ps = { cooldown: 0, lastId: 0 };
    padStates.set(world, ps);
  }
  if (ps.cooldown <= 0 && ps.lastId !== o.id && need >= PAD_BUMP_MIN_OVERLAP) {
    ps.cooldown = PAD_BUMP_COOLDOWN;
    ps.lastId = o.id;
    world.events.push({ type: 'pad-bump', x: (p.x + o.x) / 2, y: (p.y + o.y) / 2 });
  }
}

/**
 * Moves obstacles with the river, drifts and spins twigs, turns pads, resolves
 * leaf collisions (`live` only) and removes what has left the view.
 */
export function updateObstacles(world: World, st: SimState, dt: number, live: boolean): void {
  const p = world.player;
  const v = world.scrollSpeed;
  const obs = world.obstacles;
  const limit = world.viewH + DESPAWN_BELOW;
  const ps = padStates.get(world);
  if (ps) ps.cooldown = Math.max(0, ps.cooldown - dt);
  let w = 0;
  for (let i = 0; i < obs.length; i++) {
    const o = obs[i];
    // Twigs only start drifting once within SPAWN_AHEAD of the leaf (measured
    // before this step's move, i.e. from the step after a normal screen would
    // lay them out): on tall screens they exist earlier, and this keeps their
    // path screen-independent. Pads turn on the same rule.
    const near = p.y - o.y <= SPAWN_AHEAD;
    o.y += v * dt;
    if (o.kind === 'pad') {
      if (near) o.angle += o.spin * dt * (live ? 1 : 0.35);
      if (live && world.state === 'running') padContact(world, o, dt);
    } else {
      if (o.kind === 'twig' && near) {
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
    }
    if (o.y - (o.len + o.r) > limit) continue;
    obs[w++] = o;
  }
  obs.length = w;
}
