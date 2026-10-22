// Shop preview: the real in-game ant (drawAnt, same palette and patterns) strolling
// on the spot over a small lily-pad disc, animated by `t` seconds. Called every
// frame per card, so it reuses one look object and allocates nothing besides the
// 2D context the canvas already owns.

import type { Skin } from '../types';
import { drawAnt, glowFor, newAntLook } from './ant';
import { P } from './palette';
import { TAU } from './util';

const look = newAntLook();
/** Disc radius in ant units; the ant is ~38 units long, so it fits with a margin. */
const DISC_R = 25;
/** Half-height of the framed scene, in units: the disc plus room for a glow halo. */
const HALF = 31;

export function drawSkinPreview(canvas: HTMLCanvasElement, skin: Skin, t: number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const k = Math.min(w, h) / (HALF * 2);
  ctx.setTransform(k, 0, 0, k, w / 2, h / 2);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Lily-pad disc with a notch, a soft shadow on the water and a few veins.
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(5, 32, 43, 0.35)';
  ctx.beginPath();
  ctx.ellipse(1.5, 3, DISC_R, DISC_R * 0.97, 0, 0, TAU);
  ctx.fill();
  const notch = 0.2;
  const a0 = -Math.PI / 2 + notch;
  const a1 = -Math.PI / 2 - notch + TAU;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, DISC_R, a0, a1);
  ctx.closePath();
  ctx.fillStyle = P.leaf;
  ctx.fill();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = P.leafEdge;
  ctx.stroke();
  ctx.fillStyle = P.leafLight;
  ctx.globalAlpha = 0.35;
  ctx.beginPath();
  ctx.arc(-4, -3, DISC_R * 0.62, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = P.leafVein;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = a0 + 0.35 + (i * (a1 - a0 - 0.7)) / 5;
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * DISC_R * 0.88, Math.sin(a) * DISC_R * 0.88);
  }
  ctx.stroke();

  // The ant: tripod walk in place, a gentle sway, eyes wandering.
  look.t = t;
  look.walk = t * 7;
  look.amp = 0.3;
  look.lookX = Math.sin(t * 0.9) * 0.7;
  look.lookY = -0.6;
  look.alpha = 1;
  ctx.translate(0, 2.5);
  ctx.rotate(Math.sin(t * 1.1) * 0.07);
  drawAnt(ctx, skin.palette, glowFor(skin.palette), look);
  ctx.globalAlpha = 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
