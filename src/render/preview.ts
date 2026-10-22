// STUB — the skins agent replaces the body. Keep the exported signature.
// Draws a skin's ant (gently animated by `t`, seconds) into a small canvas for
// the shop. Must not allocate per call beyond what a 2D context needs.

import type { Skin } from '../types';

export function drawSkinPreview(canvas: HTMLCanvasElement, skin: Skin, t: number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  void t;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = skin.palette.body;
  ctx.beginPath();
  ctx.arc(canvas.width / 2, canvas.height / 2, Math.min(canvas.width, canvas.height) * 0.3, 0, Math.PI * 2);
  ctx.fill();
}
