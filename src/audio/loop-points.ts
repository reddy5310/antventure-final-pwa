// Finds where a decoded track really starts and ends, and where its closing
// fade begins. The background music fades out over its last seconds instead
// of looping seamlessly, so the next pass is started at the fade ("segue") and
// overlaps the tail. A seamless loop (the rain) simply gets segue === end.

export interface LoopPoints {
  /** First audible sample (s): skips encoder padding and leading silence. */
  start: number;
  /** Just after the last audible sample (s). */
  end: number;
  /** Where the closing fade begins (s); start the next pass here. */
  segue: number;
}

/** -60 dBFS: quieter than this counts as silence. */
const SILENCE = 0.001;
const WINDOW_S = 0.05;
/** A window this far below the track's typical level is part of a fade. */
const FADE_DB = 10;
/** Never overlap more than this, even if the analysis finds a very long tail. */
const MAX_TAIL_S = 8;
/** Keep a few ms before the first audible sample so the attack is intact. */
const LEAD_S = 0.002;
/** Sparse windows sampled across the track to estimate its typical level. */
const LEVEL_SAMPLES = 240;

function windowDb(channels: readonly Float32Array[], from: number, to: number): number {
  let sum = 0;
  let n = 0;
  // Every 4th sample is plenty for a level estimate (this runs on the main thread).
  for (const d of channels) {
    for (let i = from; i < to; i += 4) {
      sum += d[i] * d[i];
      n++;
    }
  }
  return n ? 10 * Math.log10(sum / n + 1e-12) : -120;
}

export function findLoopPoints(channels: readonly Float32Array[], sampleRate: number): LoopPoints {
  const len = channels.reduce((m, d) => Math.max(m, d.length), 0);
  if (len === 0 || sampleRate <= 0) return { start: 0, end: 0, segue: 0 };

  let first = -1;
  for (let i = 0; i < len && first < 0; i++) {
    for (const d of channels) {
      if (Math.abs(d[i] ?? 0) > SILENCE) {
        first = i;
        break;
      }
    }
  }
  if (first < 0) {
    const dur = len / sampleRate;
    return { start: 0, end: dur, segue: dur };
  }
  let last = first;
  for (let i = len - 1; i > first; i--) {
    let loud = false;
    for (const d of channels) {
      if (Math.abs(d[i] ?? 0) > SILENCE) {
        loud = true;
        break;
      }
    }
    if (loud) {
      last = i;
      break;
    }
  }

  const startIdx = Math.max(0, first - Math.round(LEAD_S * sampleRate));
  const endIdx = Math.min(len, last + 1);
  const start = startIdx / sampleRate;
  const end = endIdx / sampleRate;
  const win = Math.max(1, Math.round(WINDOW_S * sampleRate));
  if (endIdx - startIdx < win * 20) return { start, end, segue: end };

  // Typical level: median of windows spread across the whole track.
  const span = endIdx - startIdx - win;
  const count = Math.min(LEVEL_SAMPLES, Math.floor(span / win));
  const levels = new Float64Array(count);
  for (let k = 0; k < count; k++) {
    const from = startIdx + Math.floor((span * k) / count);
    levels[k] = windowDb(channels, from, from + win);
  }
  levels.sort();
  const typical = levels[Math.floor(count / 2)];
  const threshold = typical - FADE_DB;

  // Walk back from the end to the last window that still sounds like the body of the track.
  const minIdx = Math.max(startIdx, endIdx - Math.round(MAX_TAIL_S * sampleRate));
  let segueIdx = minIdx;
  for (let to = endIdx; to - win >= minIdx; to -= win) {
    if (windowDb(channels, to - win, to) >= threshold) {
      segueIdx = to;
      break;
    }
  }
  // A tail shorter than a couple of windows is just the loop seam, not a fade.
  if (endIdx - segueIdx <= win * 2) segueIdx = endIdx;
  return { start, end, segue: segueIdx / sampleRate };
}
