// What every screen/modal module gets from the UI shell. Keeps the screens
// decoupled from the UI class (and from each other).

import type { Device, Mode } from '../types';
import type { ToastOptions, UIContext, UIHandlers } from './ui';

export interface UIEnv {
  handlers: UIHandlers;
  ctx: UIContext;
  /** The device to show hints for (touch is inferred on coarse-pointer screens). */
  device(): Device;
  reducedMotion(): boolean;
  toast(text: string, opts?: ToastOptions): void;
  /** Polite screen-reader announcement. */
  announce(text: string): void;
  openSettings(): void;
  openLeaderboard(tab?: Mode): void;
  openHelp(): void;
  openShop(): void;
  openBadges(): void;
}

/** Element.animate that is skipped entirely under reduced motion. */
export function animate(
  env: UIEnv,
  el: Element,
  keyframes: Keyframe[],
  opts: KeyframeAnimationOptions,
): Animation | null {
  if (env.reducedMotion() || typeof el.animate !== 'function') return null;
  return el.animate(keyframes, opts);
}
