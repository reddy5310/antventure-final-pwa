// STUB — the platform agent replaces the bodies. Keep the exported signatures.

import type { AudioScene, Settings, Sfx } from '../types';

export interface PlayOptions {
  /** Current combo, for pitch-rising near-miss chimes. */
  combo?: number;
  /** -1 (left) .. 1 (right). */
  pan?: number;
  /** Extra gain multiplier, 0..1. */
  volume?: number;
}

export class AudioManager {
  constructor(private settings: Settings) {}

  /** Call from a user gesture. Safe to call repeatedly. */
  unlock(): void {}

  applySettings(settings: Settings): void {
    this.settings = settings;
  }

  setScene(_scene: AudioScene): void {}

  /** 0..1 storm intensity: rain ambience level, music filter, etc. */
  setIntensity(_v: number): void {}

  play(_sfx: Sfx, _opts?: PlayOptions): void {
    void this.settings;
  }

  /** Page hidden. */
  suspend(): void {}

  /** Page visible again. */
  resume(): void {}
}
