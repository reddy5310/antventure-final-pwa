// Building blocks for the synthesised sound effects: shared buffers (noise,
// reverb impulse, distortion curve), envelopes and a Voice that owns the nodes
// of one sound and disconnects them when it has finished.

/** Shared per-context resources, created once. */
export interface Kit {
  ctx: BaseAudioContext;
  /** Dry destination for voices (the SFX bus). */
  dry: AudioNode;
  /** Reverb send input, or null when reverb is unavailable. */
  wet: AudioNode | null;
  /** 2 s of white noise; voices read it from random offsets. */
  noise: AudioBuffer;
  /** Soft-clip curve for crunchy hits. */
  crunch: Float32Array<ArrayBuffer>;
}

export const NOISE_SECONDS = 2;

export function createNoise(ctx: BaseAudioContext): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * NOISE_SECONDS);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/** tanh-style soft clip: adds grit without the fizz of hard clipping. */
export function createCrunch(drive = 3.2, n = 1024): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * drive) / norm;
  }
  return curve;
}

/**
 * A small damp "jungle clearing" reverb: decaying stereo noise whose highs die
 * faster than its lows, so tails sound soft rather than metallic.
 */
export function createImpulse(ctx: BaseAudioContext, seconds = 1.3, decay = 3.2): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // One-pole lowpass whose cutoff falls over the tail.
      const k = 0.9 - 0.75 * t;
      lp += k * (Math.random() * 2 - 1 - lp);
      // Short pre-delay ramp avoids a hard transient at the very start.
      const fadeIn = Math.min(1, i / (rate * 0.006));
      d[i] = lp * Math.pow(1 - t, decay) * fadeIn;
    }
  }
  return buf;
}

export const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** A major pentatonic, so any run of combo notes sounds consonant. */
const PENTATONIC = [0, 2, 4, 7, 9];

/** Note of the i-th step (0-based) up a major pentatonic from `root` (MIDI). */
export function pentatonicHz(root: number, step: number): number {
  const s = Math.max(0, Math.floor(step));
  const octave = Math.floor(s / PENTATONIC.length);
  return midiToHz(root + octave * 12 + PENTATONIC[s % PENTATONIC.length]);
}

const SILENT = 0.0001;

/**
 * Percussive envelope on a gain param: 0 → peak (linear) → silence
 * (exponential). Returns the end time.
 */
export function perc(p: AudioParam, t: number, attack: number, peak: number, decay: number): number {
  const end = t + attack + decay;
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(Math.max(SILENT * 2, peak), t + attack);
  p.exponentialRampToValueAtTime(SILENT, end);
  p.setValueAtTime(0, end);
  return end;
}

/** Attack, hold at peak, exponential release. Returns the end time. */
export function swell(p: AudioParam, t: number, attack: number, peak: number, hold: number, release: number): number {
  const end = t + attack + hold + release;
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(Math.max(SILENT * 2, peak), t + attack);
  p.setValueAtTime(Math.max(SILENT * 2, peak), t + attack + hold);
  p.exponentialRampToValueAtTime(SILENT, end);
  p.setValueAtTime(0, end);
  return end;
}

/** Exponential glide of a frequency-like param. */
export function glide(p: AudioParam, t: number, from: number, to: number, time: number): void {
  p.setValueAtTime(from, t);
  p.exponentialRampToValueAtTime(Math.max(1, to), t + Math.max(0.001, time));
}

export const rand = (a: number, b: number) => a + Math.random() * (b - a);

/**
 * One sound: a level/pan stage plus every node it creates. When its last
 * source ends, everything is disconnected so the graph never grows.
 */
export class Voice {
  readonly ctx: BaseAudioContext;
  /** Connect the sound's final stage here. */
  readonly out: GainNode;
  /** Absolute end time of the latest-ending source. */
  end = 0;
  private nodes: AudioNode[] = [];
  private last: AudioScheduledSourceNode | null = null;

  constructor(
    readonly kit: Kit,
    /** Start time (context seconds). */
    readonly t: number,
    volume: number,
    pan: number,
    send: number,
  ) {
    const ctx = kit.ctx;
    this.ctx = ctx;
    this.out = this.track(ctx.createGain());
    this.out.gain.value = volume;
    let stage: AudioNode = this.out;
    if (pan !== 0 && typeof ctx.createStereoPanner === 'function') {
      const p = this.track(ctx.createStereoPanner());
      p.pan.value = Math.max(-1, Math.min(1, pan));
      stage.connect(p);
      stage = p;
    }
    stage.connect(kit.dry);
    if (send > 0 && kit.wet) {
      const s = this.track(ctx.createGain());
      s.gain.value = send;
      stage.connect(s);
      s.connect(kit.wet);
    }
  }

  /** A gain stage; `dest` may be a param (e.g. an LFO depth into detune). */
  gain(dest: AudioNode | AudioParam, value = 0): GainNode {
    const g = this.track(this.ctx.createGain());
    g.gain.value = value;
    if (dest instanceof AudioNode) g.connect(dest);
    else g.connect(dest);
    return g;
  }

  filter(type: BiquadFilterType, freq: number, q: number, dest: AudioNode): BiquadFilterNode {
    const f = this.track(this.ctx.createBiquadFilter());
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    f.connect(dest);
    return f;
  }

  shaper(dest: AudioNode): WaveShaperNode {
    const w = this.track(this.ctx.createWaveShaper());
    w.curve = this.kit.crunch;
    w.oversample = '2x';
    w.connect(dest);
    return w;
  }

  osc(type: OscillatorType, freq: number, start: number, stop: number, dest: AudioNode): OscillatorNode {
    const o = this.track(this.ctx.createOscillator());
    o.type = type;
    o.frequency.value = freq;
    o.connect(dest);
    this.schedule(o, start, stop);
    return o;
  }

  /** White noise from a random offset; `rate` < 1 darkens it. */
  noise(start: number, stop: number, dest: AudioNode, rate = 1, loop = false): AudioBufferSourceNode {
    const src = this.track(this.ctx.createBufferSource());
    src.buffer = this.kit.noise;
    src.playbackRate.value = rate;
    src.loop = loop;
    src.connect(dest);
    const span = NOISE_SECONDS - (stop - start) * rate;
    const offset = loop ? Math.random() * NOISE_SECONDS : Math.random() * Math.max(0, span);
    src.start(start, offset);
    src.stop(stop + 0.02);
    this.noteEnd(src, stop + 0.02);
    return src;
  }

  /** Call once every node is created; frees the voice when its last source ends. */
  finish(onDone?: () => void): void {
    const last = this.last;
    const release = () => {
      for (const n of this.nodes) {
        try {
          n.disconnect();
        } catch {
          // Already disconnected.
        }
      }
      this.nodes.length = 0;
      onDone?.();
    };
    if (last) last.onended = release;
    else release();
  }

  private schedule(src: AudioScheduledSourceNode, start: number, stop: number): void {
    src.start(start);
    src.stop(stop + 0.02);
    this.noteEnd(src, stop + 0.02);
  }

  private noteEnd(src: AudioScheduledSourceNode, end: number): void {
    if (end >= this.end) {
      this.end = end;
      this.last = src;
    }
  }

  private track<T extends AudioNode>(n: T): T {
    this.nodes.push(n);
    return n;
  }
}
