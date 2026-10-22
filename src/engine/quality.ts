// Adaptive resolution. If play keeps running slow, the canvas density steps
// down one notch (2 → 1.5 → 1): fill cost falls with the square of it, and
// the flat art survives the softening far better than the game survives a
// low frame rate. It only ever steps down during a session, so it cannot
// oscillate, and a device holding 60 fps never triggers it.
//
// Not every low frame rate is a slow device: iOS Low Power Mode and some
// browsers cap rAF at a steady 30 fps. A capped frame rate is regular, an
// overloaded one is not, so a window only counts as slow if its frames are
// both long and uneven (or very long).

const WINDOW_S = 1;
/** Mean frame time above this (s) is slow... */
const SLOW_MEAN = 0.022;
/** ...if the frames are also this uneven (s, standard deviation)... */
const UNEVEN_SD = 0.003;
/** ...or the mean is simply this bad. */
const VERY_SLOW_MEAN = 0.036;
/** Consecutive slow windows before stepping down. */
const SLOW_WINDOWS = 3;
/** Ignore frame gaps longer than this (tab switch, GC, debugger). */
const MAX_SAMPLE = 0.12;

export const QUALITY_STEPS: readonly number[] = [2, 1.5, 1];

export class QualityGovernor {
  private level = 0;
  private n = 0;
  private sum = 0;
  private sumSq = 0;
  private time = 0;
  private slow = 0;

  constructor(private onStep: (dprCap: number) => void) {}

  /** The current density cap. */
  get cap(): number {
    return QUALITY_STEPS[this.level];
  }

  /** One frame. `active` only during live play (not menus, pause or countdown). */
  sample(frameDt: number, active: boolean): void {
    if (!active || frameDt <= 0 || frameDt > MAX_SAMPLE) return;
    this.n++;
    this.sum += frameDt;
    this.sumSq += frameDt * frameDt;
    this.time += frameDt;
    if (this.time < WINDOW_S) return;
    const mean = this.sum / this.n;
    const sd = Math.sqrt(Math.max(0, this.sumSq / this.n - mean * mean));
    this.n = 0;
    this.sum = 0;
    this.sumSq = 0;
    this.time = 0;
    const slow = mean > VERY_SLOW_MEAN || (mean > SLOW_MEAN && sd > UNEVEN_SD);
    this.slow = slow ? this.slow + 1 : 0;
    if (this.slow < SLOW_WINDOWS || this.level >= QUALITY_STEPS.length - 1) return;
    this.slow = 0;
    this.level++;
    this.onStep(QUALITY_STEPS[this.level]);
  }
}
