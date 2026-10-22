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
  /**
   * Lowers (or lifts) an extra cap on the backing-store density, e.g. from the
   * adaptive quality governor. Re-measures and notifies like a resize.
   */
  setDprCap(cap: number): void;
}

/**
 * Backing-store density cap. Phones report 2.6-3.5, but the flat art looks the
 * same at 2 and the renderer has several full-screen passes (water, caustics,
 * storm veil, scrims): 2 instead of 3 is ~55% fewer pixels to fill per pass,
 * which is what keeps mid-range phones at 60 fps. The DOM UI stays native-sharp.
 */
const MAX_DPR = 2;
/**
 * Backing-store pixel budget. Cost scales with pixels, and a large desktop or
 * tablet screen at 2x would be 5-13 MP for every full-screen pass while most of
 * it is decorative jungle. ~2.7 phone screens' worth keeps every device sharp
 * enough for this flat art.
 */
const PIXEL_BUDGET = 3.5e6;

/** Density for a CSS size: device ratio, capped by MAX_DPR, the pixel budget and `cap`, never below 1. */
export function pickDpr(cssW: number, cssH: number, deviceRatio: number, cap = Infinity): number {
  const budget = Math.sqrt(PIXEL_BUDGET / Math.max(1, cssW * cssH));
  return Math.max(1, Math.min(deviceRatio || 1, MAX_DPR, budget, cap));
}

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

  let dprCap = Infinity;
  const v: Viewport = {
    cssW: 0,
    cssH: 0,
    dpr: 1,
    scale: 1,
    viewW: WORLD_W,
    viewH: MIN_VIEW_H,
    originX: 0,
    safe: { top: 0, right: 0, bottom: 0, left: 0 },
    setDprCap(cap: number) {
      dprCap = cap > 0 ? cap : Infinity;
      schedule();
    },
  };

  const measure = () => {
    const cssW = Math.max(1, window.innerWidth);
    const cssH = Math.max(1, window.innerHeight);
    const dpr = pickDpr(cssW, cssH, window.devicePixelRatio || 1, dprCap);
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
  watchPixelRatio(schedule);

  measure();
  return v;
}

/**
 * Moving a window to a screen with another pixel ratio fires no resize event;
 * a resolution media query for the current ratio does change. Re-armed for
 * each new ratio.
 */
function watchPixelRatio(onChange: () => void): void {
  let mq: MediaQueryList;
  try {
    mq = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
  } catch {
    return;
  }
  mq.addEventListener?.(
    'change',
    () => {
      onChange();
      watchPixelRatio(onChange);
    },
    { once: true },
  );
}

/** World x → CSS px. */
export const toScreenX = (v: Viewport, x: number) => v.originX + x * v.scale;
/** World y → CSS px. */
export const toScreenY = (v: Viewport, y: number) => y * v.scale;
/** CSS px x → world x. */
export const toWorldX = (v: Viewport, px: number) => (px - v.originX) / v.scale;
