// Every sound effect, synthesised. One palette for the whole game: soft
// mallet chimes in A major pentatonic, filtered-noise water, woody knocks.
// Recipes write into `v.out`; the Voice handles level, pan and reverb send.

import type { Sfx } from '../types';
import { glide, midiToHz, pentatonicHz, perc, rand, swell, type Voice } from './kit';

export interface SfxSpec {
  /** Output gain before the caller's volume. */
  level: number;
  /** Reverb send, 0..1. */
  send: number;
  /** Dropped first when many voices are playing. */
  low?: boolean;
  build(v: Voice, combo: number): void;
}

/** Near-miss chimes climb from A4 up the A major pentatonic... */
const CHIME_ROOT = 69;
/** ...for this many steps (A4 → C#7), then stay at the top. */
const CHIME_TOP_STEP = 12;

// Glockenspiel-like bar: inharmonic modes that die faster the higher they are.
const BAR_RATIO = [1, 2.756, 5.404];
const BAR_AMP = [1, 0.3, 0.1];
const BAR_DECAY = [1, 0.36, 0.13];

/** A soft mallet chime with a tiny noise "tick" on the strike. */
function bell(v: Voice, t: number, f: number, peak: number, decay: number, dest: AudioNode = v.out): void {
  for (let i = 0; i < BAR_RATIO.length; i++) {
    const fi = f * BAR_RATIO[i];
    // Keep partials well under Nyquist and out of the shrill zone.
    if (fi > 15000) break;
    const g = v.gain(dest);
    const end = perc(g.gain, t, 0.002, peak * BAR_AMP[i], decay * BAR_DECAY[i]);
    v.osc('sine', fi, t, end, g);
  }
  const tick = v.gain(dest);
  const hp = v.filter('highpass', 4500, 0.7, tick);
  v.noise(t, perc(tick.gain, t, 0.001, peak * 0.18, 0.016), hp);
}

/** A warm two-oscillator note (slightly detuned triangles). */
function softNote(
  v: Voice,
  t: number,
  f: number,
  peak: number,
  attack: number,
  hold: number,
  release: number,
  dest: AudioNode,
  bendTo = 0,
): void {
  for (const cents of [-6, 6]) {
    const g = v.gain(dest);
    const end = swell(g.gain, t, attack, peak / 2, hold, release);
    const o = v.osc('triangle', f, t, end, g);
    o.detune.value = cents;
    if (bendTo > 0) glide(o.frequency, t + attack + hold * 0.5, f, bendTo, hold * 0.5 + release);
  }
}

/** Rising band-passed noise: the "swish" of something going past. */
function whoosh(v: Voice, t: number, from: number, to: number, time: number, peak: number): void {
  const g = v.gain(v.out);
  const bp = v.filter('bandpass', from, 1.4, g);
  glide(bp.frequency, t, from, to, time);
  v.noise(t, perc(g.gain, t, time * 0.45, peak, time * 0.9), bp);
}

function splash(v: Voice, t: number, size: number): void {
  // Body: broadband water crash.
  const body = v.gain(v.out);
  const bp = v.filter('bandpass', rand(1300, 2300) / Math.sqrt(size), 0.75, body);
  v.noise(t, perc(body.gain, t, 0.002, 0.6, rand(0.12, 0.19) * size), bp, rand(0.85, 1.15));
  // Fizz: the spray.
  const fizz = v.gain(v.out);
  const hp = v.filter('highpass', 5200, 0.7, fizz);
  v.noise(t, perc(fizz.gain, t, 0.001, 0.2, 0.05 * size), hp);
  // Plop: the drop punching the surface.
  const plop = v.gain(v.out);
  const o = v.osc('sine', 600, t, perc(plop.gain, t, 0.003, 0.3, 0.08 * size), plop);
  glide(o.frequency, t, rand(520, 760) / size, rand(150, 210) / size, 0.07 * size);
  // Now and then a droplet lands just after.
  if (Math.random() < 0.35) {
    const dt = t + rand(0.05, 0.11);
    const dg = v.gain(v.out);
    const d = v.osc('sine', 2000, dt, perc(dg.gain, dt, 0.002, 0.08, 0.04), dg);
    glide(d.frequency, dt, rand(1700, 2500), rand(1100, 1500), 0.035);
  }
}

/** Thunder from close (far = 0: sharp crack, quick) to far away (1: dark, slow rumble). */
export function thunder(v: Voice, far: number): void {
  // Sound travels slower than light: let the flash land first.
  const t = v.t + (1 - far) * rand(0.12, 0.3);
  const dur = rand(2.8, 4) + far * 1.6;
  const g = v.gain(v.out);
  const lp2 = v.filter('lowpass', 560 - far * 300, 0.5, g);
  const lp = v.filter('lowpass', 1200, 0.8, lp2);
  glide(lp.frequency, t, rand(900, 1500) * (1 - far * 0.55), rand(150, 230), 0.9);

  // Envelope: fast attack, decaying body with a few random rolling swells.
  const n = 128;
  const curve = new Float32Array(n);
  const attack = 0.02 + far * 0.12;
  const swells = 2 + Math.floor(Math.random() * 3);
  const centres: number[] = [];
  for (let i = 0; i < swells; i++) centres.push(rand(0.06, 0.55));
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    const rise = x < attack ? x / attack : 1;
    let roll = 0.5;
    for (const c of centres) roll += 0.5 * Math.exp(-((x - c) * (x - c)) / 0.004);
    curve[i] = rise * Math.exp(-x * 3.4) * Math.min(1, roll) * (1 - x);
  }
  curve[0] = 0;
  curve[n - 1] = 0;
  g.gain.setValueCurveAtTime(curve, t, dur);
  v.noise(t, t + dur, lp, rand(0.45, 0.65), true);

  if (far < 0.5) {
    const crack = v.gain(v.out);
    const hp = v.filter('highpass', 900, 0.6, crack);
    const sh = v.shaper(hp);
    v.noise(t, perc(crack.gain, t, 0.003, 0.5 * (1 - far * 2), rand(0.25, 0.4)), sh, rand(0.7, 1));
  }
}

export const SFX: Record<Sfx, SfxSpec> = {
  splash: {
    level: 0.6,
    send: 0.06,
    low: true,
    build(v) {
      splash(v, v.t, 1);
    },
  },

  'near-miss': {
    level: 0.95,
    send: 0.32,
    build(v, combo) {
      const t = v.t;
      const step = Math.min(Math.max(1, combo) - 1, CHIME_TOP_STEP);
      whoosh(v, t, rand(500, 700), rand(3200, 4300), 0.17, 0.3);
      // "swish-ding": the chime lands as the whoosh peaks.
      const tc = t + 0.035;
      const f = pentatonicHz(CHIME_ROOT, step);
      bell(v, tc, f, 0.42, 0.75 + 0.25 * (step / CHIME_TOP_STEP));
      // Bigger chains earn a richer reward: a harmony note, then an octave sparkle.
      if (combo >= 4) bell(v, tc + 0.065, pentatonicHz(CHIME_ROOT, step + 2), 0.2, 0.55);
      if (combo >= 8) bell(v, tc + 0.13, f * 2, 0.13, 0.5);
    },
  },

  hit: {
    level: 0.85,
    send: 0.12,
    build(v) {
      const t = v.t;
      // Low thud.
      const th = v.gain(v.out);
      const o = v.osc('sine', 160, t, perc(th.gain, t, 0.002, 0.8, 0.32), th);
      glide(o.frequency, t, 170, 46, 0.22);
      // Crunch: grainy noise through a soft clipper.
      const cg = v.gain(v.out);
      const bp = v.filter('bandpass', 1100, 0.6, cg);
      const sh = v.shaper(bp);
      const drive = v.gain(sh, 2.5);
      v.noise(t, perc(cg.gain, t, 0.002, 0.32, 0.17), drive, 0.35);
      // Sad pitch drop.
      const t2 = t + 0.015;
      const bg = v.gain(v.out);
      const lp = v.filter('lowpass', 1600, 0.7, bg);
      const tri = v.osc('triangle', 440, t2, perc(bg.gain, t2, 0.01, 0.32, 0.36), lp);
      glide(tri.frequency, t2, 460, 92, 0.34);
    },
  },

  bump: {
    level: 0.75,
    send: 0.08,
    low: true,
    build(v) {
      const t = v.t;
      const f = rand(180, 215);
      // Two wooden body modes plus a knock transient.
      const g1 = v.gain(v.out);
      const o1 = v.osc('sine', f, t, perc(g1.gain, t, 0.002, 0.55, 0.12), g1);
      glide(o1.frequency, t, f * 1.18, f, 0.025);
      const g2 = v.gain(v.out);
      v.osc('sine', f * 2.71, t, perc(g2.gain, t, 0.001, 0.2, 0.05), g2);
      const g3 = v.gain(v.out);
      const bp = v.filter('bandpass', rand(1500, 2100), 2.5, g3);
      v.noise(t, perc(g3.gain, t, 0.001, 0.4, 0.028), bp);
    },
  },

  'combo-lost': {
    level: 0.7,
    send: 0.2,
    build(v) {
      const t = v.t;
      const lp = v.filter('lowpass', 2200, 0.5, v.out);
      softNote(v, t, midiToHz(76), 0.32, 0.012, 0.06, 0.12, lp);
      // The second note sags a semitone: a gentle "aww", not a punishment.
      softNote(v, t + 0.14, midiToHz(71), 0.3, 0.012, 0.1, 0.3, lp, midiToHz(70));
    },
  },

  milestone: {
    level: 0.8,
    send: 0.35,
    build(v) {
      const t = v.t;
      bell(v, t, midiToHz(81), 0.34, 0.8);
      bell(v, t + 0.12, midiToHz(88), 0.38, 1.1);
    },
  },

  'new-best': {
    level: 0.85,
    send: 0.4,
    build(v) {
      const t = v.t;
      const notes = [69, 73, 76, 81, 85, 88];
      const step = 0.075;
      notes.forEach((m, i) => {
        const last = i === notes.length - 1;
        bell(v, t + i * step, midiToHz(m), last ? 0.34 : 0.26, last ? 1.4 : 0.55);
      });
      // A warm chord blooms under the top of the arpeggio.
      const tp = t + 3 * step;
      const lp = v.filter('lowpass', 1800, 0.5, v.out);
      for (const m of [69, 73, 76]) softNote(v, tp, midiToHz(m), 0.12, 0.08, 0.35, 0.9, lp);
      whoosh(v, t, 400, 5000, 0.4, 0.12);
    },
  },

  thunder: {
    level: 1.3,
    send: 0.25,
    build(v) {
      thunder(v, rand(0, 0.45));
    },
  },

  death: {
    level: 0.75,
    send: 0.25,
    build(v) {
      const t = v.t;
      // Descending wobble.
      const g = v.gain(v.out);
      const lp = v.filter('lowpass', 2400, 0.6, g);
      const end = swell(g.gain, t, 0.02, 0.34, 0.3, 0.8);
      const o1 = v.osc('triangle', 560, t, end, lp);
      const o2 = v.osc('sine', 280, t, end, lp);
      glide(o1.frequency, t, 560, 105, 1.05);
      glide(o2.frequency, t, 280, 52, 1.05);
      const depth = v.gain(o1.detune, 70);
      depth.connect(o2.detune);
      v.osc('sine', 7.5, t, end, depth);
      // Big splash and a heavy thud as the leaf goes under.
      splash(v, t + 0.03, 1.8);
      const th = v.gain(v.out);
      const o3 = v.osc('sine', 120, t, perc(th.gain, t, 0.003, 0.7, 0.45), th);
      glide(o3.frequency, t, 130, 38, 0.35);
    },
  },

  countdown: {
    level: 0.9,
    send: 0.12,
    build(v) {
      const t = v.t;
      const g = v.gain(v.out);
      v.osc('triangle', midiToHz(81), t, perc(g.gain, t, 0.004, 0.42, 0.14), g);
      const g2 = v.gain(v.out);
      v.osc('sine', midiToHz(93), t, perc(g2.gain, t, 0.002, 0.1, 0.06), g2);
    },
  },

  go: {
    level: 0.8,
    send: 0.2,
    build(v) {
      const t = v.t;
      const g = v.gain(v.out);
      const end = swell(g.gain, t, 0.005, 0.36, 0.12, 0.28);
      v.osc('triangle', midiToHz(93), t, end, g);
      const g2 = v.gain(v.out);
      v.osc('sine', midiToHz(81), t, swell(g2.gain, t, 0.005, 0.22, 0.12, 0.3), g2);
      whoosh(v, t, 600, 4500, 0.22, 0.12);
    },
  },

  tap: {
    level: 0.6,
    send: 0,
    low: true,
    build(v) {
      const t = v.t;
      const g = v.gain(v.out);
      const o = v.osc('sine', 1400, t, perc(g.gain, t, 0.002, 0.32, 0.045), g);
      glide(o.frequency, t, 1550, 980, 0.04);
    },
  },

  back: {
    level: 0.6,
    send: 0,
    low: true,
    build(v) {
      const t = v.t;
      const g = v.gain(v.out);
      const o = v.osc('sine', 800, t, perc(g.gain, t, 0.002, 0.34, 0.06), g);
      glide(o.frequency, t, 900, 520, 0.055);
    },
  },

  pause: {
    level: 0.55,
    send: 0.1,
    build(v) {
      const t = v.t;
      const g = v.gain(v.out);
      v.osc('sine', midiToHz(81), t, perc(g.gain, t, 0.003, 0.3, 0.07), g);
      const g2 = v.gain(v.out);
      v.osc('sine', midiToHz(76), t + 0.07, perc(g2.gain, t + 0.07, 0.003, 0.3, 0.11), g2);
    },
  },

  start: {
    level: 0.8,
    send: 0.25,
    build(v) {
      const t = v.t;
      whoosh(v, t, 300, 3000, 0.26, 0.22);
      bell(v, t + 0.12, midiToHz(81), 0.3, 0.5);
      bell(v, t + 0.2, midiToHz(88), 0.34, 0.9);
    },
  },
};
