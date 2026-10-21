// Small geometry helpers. All allocation-free.

import { LEAF_H, LEAF_W } from '../config';
import type { Obstacle } from '../types';

/** Squared distance from point (px, py) to segment (ax, ay)–(bx, by). */
function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = ax + dx * t - px;
  const ey = ay + dy * t - py;
  return ex * ex + ey * ey;
}

/** Closest point on an obstacle's core (rock centre or twig segment) to (px, py), written to `out`. */
export function closestOnObstacle(o: Obstacle, px: number, py: number, out: { x: number; y: number }): void {
  if (o.kind === 'rock' || o.len <= 0) {
    out.x = o.x;
    out.y = o.y;
    return;
  }
  const c = Math.cos(o.angle) * o.len;
  const s = Math.sin(o.angle) * o.len;
  const ax = o.x - c;
  const ay = o.y - s;
  const dx = 2 * c;
  const dy = 2 * s;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  out.x = ax + dx * t;
  out.y = ay + dy * t;
}

/** Does a circle of radius `rad` at (px, py) overlap the obstacle? */
export function circleHitsObstacle(o: Obstacle, px: number, py: number, rad: number): boolean {
  const reach = o.r + rad;
  if (o.kind === 'rock' || o.len <= 0) {
    const dx = px - o.x;
    const dy = py - o.y;
    return dx * dx + dy * dy < reach * reach;
  }
  // Cheap reject before the trig.
  const far = o.len + reach;
  if (Math.abs(px - o.x) > far || Math.abs(py - o.y) > far) return false;
  const c = Math.cos(o.angle) * o.len;
  const s = Math.sin(o.angle) * o.len;
  return segDist2(px, py, o.x - c, o.y - s, o.x + c, o.y + s) < reach * reach;
}

/** Is (x, y) inside the (untilted) leaf ellipse centred at (cx, cy)? */
export function insideLeaf(x: number, y: number, cx: number, cy: number): boolean {
  const nx = (x - cx) / (LEAF_W / 2);
  const ny = (y - cy) / (LEAF_H / 2);
  return nx * nx + ny * ny <= 1;
}
