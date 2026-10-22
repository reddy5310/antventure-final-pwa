// Competitive markers drawn in the world: the farthest-run flag (a pennant on
// the bank plus a dashed line across the water where your farthest run on
// this board ended) and a little signpost every 100 m. "Best" is reserved for
// score, so the flag is labelled as the distance record it is.

import { UNITS_PER_METER, WORLD_W } from '../config';
import type { World } from '../types';
import { makeSprite, type Gfx, type Sprite } from './gfx';
import { FONT_FAMILY, P } from './palette';
import { TAU } from './util';

const MARKER_EVERY_M = 100;
const BEST_DASH = [9, 7];
const NO_DASH: number[] = [];
const LABEL_FONT = `700 10px ${FONT_FAMILY}`;
const SMALL_FONT = `600 9px ${FONT_FAMILY}`;
const SIGN_FONT = `700 8.5px ${FONT_FAMILY}`;
const FLAG_LABEL = 'FARTHEST';

export class FlagArt {
  private glow: Sprite | null = null;
  private bestText = '';
  private bestFor = -1;
  private markerText: string[] = [];

  build(ppu: number): void {
    this.glow = makeSprite(120, 120, Math.min(ppu, 1.2), (c) => {
      const g = c.createRadialGradient(0, 0, 0, 0, 0, 60);
      g.addColorStop(0, 'rgba(255, 220, 120, 0.85)');
      g.addColorStop(0.4, 'rgba(255, 200, 90, 0.35)');
      g.addColorStop(1, 'rgba(255, 200, 90, 0)');
      c.fillStyle = g;
      c.fillRect(-60, -60, 120, 120);
    });
  }

  drawBest(g: Gfx, world: World): void {
    if (world.state === 'attract' || world.bestDistance <= 0) return;
    const y = g.yOfD(world.bestDistance);
    if (y < -90 || y > g.viewH + 50) return;
    const { ctx, t } = g;
    const passed = world.passedBest || world.distance >= world.bestDistance;
    if (this.bestFor !== world.bestDistance) {
      this.bestFor = world.bestDistance;
      this.bestText = `${Math.floor(world.bestDistance / UNITS_PER_METER)}m`;
    }
    const l = g.leftAt(y);
    const r = g.rightAt(y);
    const pole = Math.min(g.rightDrawnAt(y) + 7, WORLD_W - 5);
    g.world();

    if (passed && this.glow) {
      ctx.globalAlpha = 0.65 + 0.25 * Math.sin(t * 5);
      g.sprite(this.glow, pole - 20, y - 30, 0, 1.1);
      g.world();
    }

    // The line across the water: dark under-stroke so it reads on light shallows.
    ctx.lineCap = 'butt';
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = P.ringDark;
    ctx.lineWidth = 4.2;
    ctx.beginPath();
    ctx.moveTo(l + 3, y);
    ctx.lineTo(r - 3, y);
    ctx.stroke();
    ctx.globalAlpha = passed ? 1 : 0.9;
    ctx.strokeStyle = passed ? P.goldLight : P.gold;
    ctx.lineWidth = 2.2;
    if (!passed) {
      ctx.setLineDash(BEST_DASH);
      ctx.lineDashOffset = -t * 18;
    }
    ctx.stroke();
    ctx.setLineDash(NO_DASH);
    ctx.globalAlpha = 1;

    // What the line means, on the water by the left bank.
    ctx.font = SMALL_FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 3;
    ctx.strokeText(FLAG_LABEL, l + 8, y - 4);
    ctx.fillStyle = P.goldLight;
    ctx.fillText(FLAG_LABEL, l + 8, y - 4);

    // Pole.
    ctx.lineCap = 'round';
    ctx.strokeStyle = P.signWoodDark;
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    ctx.moveTo(pole, y + 3);
    ctx.lineTo(pole, y - 44);
    ctx.stroke();
    // Pennant, waving out over the water, swallow-tailed.
    const wave = (k: number) => Math.sin(t * (passed ? 9 : 5) + k) * 2.2;
    const top = y - 43;
    const w1 = wave(0);
    const w2 = wave(1.3);
    ctx.fillStyle = passed ? P.goldLight : P.gold;
    ctx.strokeStyle = P.goldDeep;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(pole, top);
    ctx.quadraticCurveTo(pole - 22, top + w1, pole - 46, top + w2);
    ctx.lineTo(pole - 39, top + 8.5 + w2 * 0.8);
    ctx.lineTo(pole - 46, top + 17 + w2);
    ctx.quadraticCurveTo(pole - 22, top + 17 + w1, pole, top + 17);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = P.ink;
    ctx.font = LABEL_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.bestText, pole - 22, top + 9 + w1 * 0.6);
    ctx.fillStyle = P.gold;
    ctx.beginPath();
    ctx.arc(pole, top - 2, 2.4, 0, TAU);
    ctx.fill();
  }

  /** A small signpost on the left bank every 100 m. */
  drawMarkers(g: Gfx, world: World): void {
    if (world.state === 'attract') return;
    const every = MARKER_EVERY_M * UNITS_PER_METER;
    const dBot = g.dist + g.py - g.viewH - 30;
    const dTop = g.dist + g.py + 30;
    const m0 = Math.max(1, Math.ceil(dBot / every));
    const m1 = Math.floor(dTop / every);
    if (m1 < m0) return;
    const { ctx } = g;
    g.world();
    ctx.font = SIGN_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let m = m0; m <= m1; m++) {
      const y = g.yOfD(m * every);
      const edge = g.leftDrawnAt(y);
      const x = Math.max(17, edge - 12);
      // Ticks across the waterline so the marker reads even when the sign is half off-screen.
      ctx.strokeStyle = P.foam;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(g.leftAt(y) + 3, y);
      ctx.lineTo(g.leftAt(y) + 14, y);
      ctx.moveTo(g.rightAt(y) - 3, y);
      ctx.lineTo(g.rightAt(y) - 14, y);
      ctx.stroke();
      ctx.globalAlpha = 1;
      // Post + plank.
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      roundRect(ctx, x - 14 + 1.5, y - 7 + 2, 28, 13, 3);
      ctx.fill();
      ctx.fillStyle = P.signWoodDark;
      ctx.fillRect(x - 1.2, y + 4, 2.4, 6);
      ctx.fillStyle = P.signWood;
      roundRect(ctx, x - 14, y - 7, 28, 13, 3);
      ctx.fill();
      ctx.strokeStyle = P.signWoodDark;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#fff3dd';
      ctx.fillText(this.marker(m), x, y - 0.3);
    }
  }

  private marker(m: number): string {
    let s = this.markerText[m];
    if (!s) {
      s = `${m * MARKER_EVERY_M}m`;
      this.markerText[m] = s;
    }
    return s;
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
