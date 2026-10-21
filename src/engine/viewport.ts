// Maps the window onto world units. The playfield is always WORLD_W units wide
// and at least MIN_VIEW_H tall, centred horizontally; wider screens see
// decorative jungle either side, taller screens see more river above.

import { MIN_VIEW_H, WORLD_W } from '../config';

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Viewport {
  /** Canvas size in CSS px. */
  cssW: number;
  cssH: number;
  /** Device pixel ratio actually used for the backing store (capped). */
  dpr: number;
  /** CSS px per world unit. */
  scale: number;
  /** World units visible across the whole canvas (>= WORLD_W). */
  viewW: number;
  /** World units visible down the whole canvas. */
  viewH: number;
  /** CSS px x of world x = 0. */
  originX: number;
  /** Safe-area insets in CSS px (notches, home indicator). */
  safe: Insets;
}

const MAX_DPR = 2.5;

function readSafeInsets(probe: HTMLElement): Insets {
  const cs = getComputedStyle(probe);
  const px = (v: string) => parseFloat(v) || 0;
  return {
    top: px(cs.paddingTop),
    right: px(cs.paddingRight),
    bottom: px(cs.paddingBottom),
    left: px(cs.paddingLeft),
  };
}

/** `onChange` fires on later resizes, not during creation. */
export function createViewport(canvas: HTMLCanvasElement, onChange: (v: Viewport) => void): Viewport {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;inset:0;visibility:hidden;pointer-events:none;' +
    'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);';
  document.body.appendChild(probe);

  const v: Viewport = {
    cssW: 0,
    cssH: 0,
    dpr: 1,
    scale: 1,
    viewW: WORLD_W,
    viewH: MIN_VIEW_H,
    originX: 0,
    safe: { top: 0, right: 0, bottom: 0, left: 0 },
  };

  const measure = () => {
    const cssW = Math.max(1, window.innerWidth);
    const cssH = Math.max(1, window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const scale = Math.min(cssW / WORLD_W, cssH / MIN_VIEW_H);
    v.cssW = cssW;
    v.cssH = cssH;
    v.dpr = dpr;
    v.scale = scale;
    v.viewW = cssW / scale;
    v.viewH = cssH / scale;
    v.originX = (cssW - WORLD_W * scale) / 2;
    v.safe = readSafeInsets(probe);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
  };

  let pending = 0;
  const schedule = () => {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => {
      measure();
      onChange(v);
    });
  };
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  window.visualViewport?.addEventListener('resize', schedule);

  measure();
  return v;
}

/** World x → CSS px. */
export const toScreenX = (v: Viewport, x: number) => v.originX + x * v.scale;
/** World y → CSS px. */
export const toScreenY = (v: Viewport, y: number) => y * v.scale;
/** CSS px x → world x. */
export const toWorldX = (v: Viewport, px: number) => (px - v.originX) / v.scale;
