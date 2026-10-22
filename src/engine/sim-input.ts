// Bridges once-per-frame input to the fixed simulation steps.
//
// Relative drag (touch / pen) is a distance, so every bit of it must reach the
// simulation exactly once. On screens faster than SIM_DT (120+ Hz) some frames
// run no step at all; their drag stays pending for the next step instead of
// being overwritten by the next frame's input. Held axes and the mouse target
// are states, so the latest value simply wins.

import type { InputFrame } from '../types';

export class SimInput {
  /** Reused for every step (no per-step allocation). */
  private readonly out: InputFrame = { steerDelta: 0, axis: 0, absoluteX: null };
  private pending = 0;

  /** Once per animation frame, with that frame's input. */
  feed(frame: InputFrame): void {
    this.pending += frame.steerDelta;
    this.out.axis = frame.axis;
    this.out.absoluteX = frame.absoluteX;
  }

  /** Input for one simulation step; the pending drag is handed over once. */
  take(): InputFrame {
    this.out.steerDelta = this.pending;
    this.pending = 0;
    return this.out;
  }

  /** Forget pending drag (paused, counting down, menus): it must not leak into the run later. */
  discard(): void {
    this.pending = 0;
    this.out.steerDelta = 0;
  }

  /** Drag received but not yet consumed by a step (tests / debugging). */
  get pendingDrag(): number {
    return this.pending;
  }
}
