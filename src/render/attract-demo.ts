// Menu backdrop demonstration, purely cosmetic: every few seconds a
// telegraphed drop lands just beside the wandering leaf and shows the
// near-miss pop, so the title teaches the core mechanic before the first tap.
// It lives in the renderer, not the simulation: the attract world itself stays
// hazard- and event-free, and nothing here can score or hurt.

import { ANT_HIT_R } from '../config';
import { insideLeaf } from '../game/collision';
import { riverEdgesAt } from '../game/river';
import { NEAR_BAND, NEAR_MISS_POINTS } from '../game/tuning';
import type { Drop, World } from '../types';
import type { Effects } from './effects';

const FIRST_IN = 2.2;
const GAP = 4;
const JITTER = 2.5;
const FALL = 1.35;
const R = 18;
/** Lands this far outside the ant's hit circle: the middle of the near-miss band. */
const CLEARANCE = 10;
const BANK_ROOM = 12;
/**
 * The telegraph keeps its offset from the wandering leaf until this long
 * before impact, then holds still: the autopilot drifts at most a few units
 * in that time, so the splash always grazes instead of hitting.
 */
const TRACK_UNTIL = 0.45;

export class AttractDemo {
  /** Live cosmetic drops (drawn with the real telegraph code). */
  readonly drops: Drop[] = [];
  /** Per drop: which side of the leaf it lands on. */
  private sides: number[] = [];
  private next = FIRST_IN;
  private id = 1;

  reset(): void {
    this.drops.length = 0;
    this.sides.length = 0;
    this.next = FIRST_IN;
  }

  update(world: World, dt: number, fx: Effects, reduced: boolean): void {
    if (world.state !== 'attract') {
      if (this.drops.length) this.reset();
      return;
    }
    const p = world.player;
    this.next -= dt;
    if (this.next <= 0) {
      this.next = GAP + Math.random() * JITTER;
      this.spawn(world);
    }
    const off = R + ANT_HIT_R + CLEARANCE;
    let w = 0;
    for (let i = 0; i < this.drops.length; i++) {
      const d = this.drops[i];
      const side = this.sides[i];
      d.age += dt;
      d.y += world.scrollSpeed * dt;
      if (d.fall - d.age > TRACK_UNTIL) d.x = p.x + side * off;
      if (d.age < d.fall) {
        this.sides[w] = side;
        this.drops[w++] = d;
        continue;
      }
      fx.onEvent({ type: 'drop-impact', x: d.x, y: d.y, r: d.r, onLeaf: insideLeaf(d.x, d.y, p.x, p.y) }, world, reduced);
      const dist = Math.hypot(d.x - p.x, d.y - p.y);
      const hitR = d.r + ANT_HIT_R;
      if (dist >= hitR && dist < hitR + NEAR_BAND) {
        fx.onEvent({ type: 'near-miss', x: d.x, y: d.y, combo: 1, points: NEAR_MISS_POINTS }, world, reduced);
      }
    }
    this.drops.length = w;
    this.sides.length = w;
  }

  /** Beside the leaf, on the side with more water. */
  private spawn(world: World): void {
    const p = world.player;
    const e = riverEdgesAt(world.seed, world.distance + world.scrollSpeed * FALL);
    const off = R + ANT_HIT_R + CLEARANCE;
    const side = e.right - p.x >= p.x - e.left ? 1 : -1;
    const x = p.x + side * off;
    if (x - R < e.left + BANK_ROOM || x + R > e.right - BANK_ROOM) return;
    this.drops.push({ id: this.id++, x, y: p.y - world.scrollSpeed * FALL, age: 0, fall: FALL, r: R, aimed: false });
    this.sides.push(side);
  }
}
