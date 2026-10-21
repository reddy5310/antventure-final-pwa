// STUB — the platform agent replaces the bodies. Keep the exported signatures.

import type { Action, Device, InputFrame } from '../types';
import { toWorldX, type Viewport } from './viewport';

export class Input {
  lastDevice: Device = 'mouse';
  /** When false (menus), steering is ignored; actions still fire. */
  steeringEnabled = false;

  private actionCbs = new Set<(a: Action) => void>();
  private deviceCbs = new Set<(d: Device) => void>();
  private absX: number | null = null;
  private keys = new Set<string>();

  constructor(
    private surface: HTMLElement,
    private viewport: Viewport,
    private getSensitivity: () => number,
  ) {
    this.surface.addEventListener('pointermove', (e) => {
      this.absX = toWorldX(this.viewport, e.clientX);
    });
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.key);
      if (e.key === ' ' || e.key === 'Enter') this.emit('confirm');
      if (e.key === 'Escape' || e.key === 'p') this.emit('pause');
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key));
    void this.getSensitivity;
  }

  /** Consume steering accumulated since the previous call; polls gamepads. Call once per frame. */
  frame(): InputFrame {
    const axis = (this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('ArrowLeft') ? 1 : 0);
    if (!this.steeringEnabled) return { steerDelta: 0, axis: 0, absoluteX: null };
    return { steerDelta: 0, axis, absoluteX: this.absX };
  }

  onAction(cb: (a: Action) => void): () => void {
    this.actionCbs.add(cb);
    return () => this.actionCbs.delete(cb);
  }

  onDeviceChange(cb: (d: Device) => void): () => void {
    this.deviceCbs.add(cb);
    return () => this.deviceCbs.delete(cb);
  }

  private emit(a: Action): void {
    for (const cb of this.actionCbs) cb(a);
  }
}
