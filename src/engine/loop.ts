// Fixed-timestep loop: the simulation always advances in SIM_DT steps, so speed
// and score are identical on 60 Hz, 120 Hz and throttled screens.

import { MAX_STEPS_PER_FRAME, SIM_DT } from '../config';

export interface LoopCallbacks {
  /** Once per animation frame, before any simulation steps. */
  update(frameDt: number): void;
  /** Zero or more times per frame, always with dt = SIM_DT. */
  step(dt: number): void;
  /** Once per animation frame, after the steps. */
  render(frameDt: number): void;
}

/**
 * One animation frame's worth of work for a frame timestamp (ms). Separate
 * from requestAnimationFrame so tests can drive exact frame patterns
 * (144 Hz, jitter, stalls) through the real stepping logic.
 */
export function createFrameStepper(cb: LoopCallbacks, startMs: number): (nowMs: number) => void {
  let last = startMs;
  let acc = 0;
  return (now: number) => {
    // Clamp long gaps (tab switches, debugger) so we never fast-forward.
    const frameDt = Math.min(0.25, Math.max(0, (now - last) / 1000));
    last = now;
    cb.update(frameDt);
    acc += frameDt;
    let steps = 0;
    while (acc >= SIM_DT && steps < MAX_STEPS_PER_FRAME) {
      cb.step(SIM_DT);
      acc -= SIM_DT;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) acc = 0;
    cb.render(frameDt);
  };
}

export function startLoop(cb: LoopCallbacks): { stop(): void } {
  const frame = createFrameStepper(cb, performance.now());
  let raf = 0;
  let running = true;

  const tick = (now: number) => {
    if (!running) return;
    frame(now);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return {
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
  };
}
