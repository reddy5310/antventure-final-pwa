// Game audio on the Web Audio API.
//
//   music (bgm.mp3) → lowpass → scene level → duck → music bus ┐
//   rain (rain.mp3) → lowpass (storm) → level → ambience bus ──┼→ limiter → master (mute) → out
//   synthesised SFX voices → pan ──────────────→ sfx bus ──────┤
//                            └→ send → reverb ─→ sfx bus ──────┘
//
// The context is created lazily on the first user gesture (autoplay rules).
// Nothing here may throw into the game: every entry point is guarded, and
// without Web Audio the manager is silently a no-op.

import type { AudioScene, Settings, Sfx } from '../types';
import { createCrunch, createImpulse, createNoise, rand, Voice, type Kit } from './kit';
import { MusicLoop, loadBuffer, startLoop } from './streams';
import { SFX, thunder } from './synth';

export interface PlayOptions {
  /** Current combo, for pitch-rising near-miss chimes. */
  combo?: number;
  /** -1 (left) .. 1 (right). */
  pan?: number;
  /** Extra gain multiplier, 0..1. */
  volume?: number;
}

const MUSIC_URL = 'audio/bgm.mp3';
const RAIN_URL = 'audio/rain.mp3';

/** The track is mastered hot (about -11 dBFS RMS); sit it under the effects. */
const MUSIC_TRIM = 0.34;
const SFX_TRIM = 0.9;
const AMB_TRIM = 0.85;

/** Per-scene music level, music lowpass cutoff (Hz) and ambience level. */
const SCENES: Record<AudioScene, { music: number; cutoff: number; amb: number; tc: number }> = {
  menu: { music: 0.7, cutoff: 5200, amb: 0.8, tc: 0.35 },
  run: { music: 1, cutoff: 20000, amb: 1, tc: 0.25 },
  // Pausing should feel immediate.
  paused: { music: 0.25, cutoff: 800, amb: 0.5, tc: 0.08 },
  over: { music: 0.4, cutoff: 2800, amb: 0.8, tc: 0.4 },
};

const MUSIC_FADE_IN = 2.5;
const RAIN_FADE_IN = 2;
/** Splash token bucket: about 8 per second, short bursts allowed. */
const SPLASH_RATE = 8;
const SPLASH_BURST = 3;
/** Voice budget: low-priority sounds give way first. */
const MAX_VOICES = 26;
const MAX_LOW_VOICES = 16;
/** Near-misses in the same instant are strummed rather than stacked. */
const NEAR_MISS_STRUM = 0.06;
/** Distant thunder rolls on its own once the storm is this strong. */
const RUMBLE_INTENSITY = 0.5;
const RUMBLE_GAP = 6;
const LOAD_ATTEMPTS = 2;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Slider → gain: squared, so the slider feels even across its range. */
const sliderGain = (v: number) => {
  const c = clamp01(Number.isFinite(v) ? v : 0);
  return c * c;
};
const noop = () => {};

interface Bus {
  master: GainNode;
  music: GainNode;
  musicIn: GainNode;
  musicFilter: BiquadFilterNode;
  musicScene: GainNode;
  musicDuck: GainNode;
  amb: GainNode;
  ambIn: GainNode;
  ambFilter: BiquadFilterNode;
  ambLevel: GainNode;
  sfx: GainNode;
}

type LoadState = 'idle' | 'loading' | 'ready';

interface AudioWindow {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
}

interface AudioSessionNavigator {
  audioSession?: { type: string };
  userActivation?: { hasBeenActive: boolean };
}

/** Events that count as user activation (HTML spec), i.e. that may start or resume audio. */
const ACTIVATION_EVENTS = ['pointerup', 'touchend', 'click', 'keydown'] as const;

/** False only when the browser can tell us the user has not interacted yet. */
function hasActivation(): boolean {
  const ua = (navigator as Navigator & AudioSessionNavigator).userActivation;
  return !ua || ua.hasBeenActive;
}

/** Smoothly heads a param to `v` from wherever it is now (no clicks, no jumps). */
function toward(p: AudioParam, v: number, now: number, tc: number): void {
  p.cancelScheduledValues(now);
  p.setTargetAtTime(v, now, tc);
}

export class AudioManager {
  private ctx: AudioContext | null = null;
  private bus: Bus | null = null;
  private kit: Kit | null = null;
  private unsupported = false;
  private hidden = false;
  private scene: AudioScene = 'menu';
  private intensity = 0.15;
  private appliedIntensity = -1;

  private musicState: LoadState = 'idle';
  private rainState: LoadState = 'idle';
  private musicAttempts = 0;
  private rainAttempts = 0;
  private music: MusicLoop | null = null;

  private splashTokens = SPLASH_BURST;
  private splashAt = 0;
  private lastNearMiss = -1;
  private lastThunder = -RUMBLE_GAP;
  private nextRumble = 0;
  /** End times of the voices still sounding. */
  private voiceEnds: number[] = [];

  constructor(private settings: Settings) {
    // Belt and braces: any genuine activation (a tap on the canvas mid-run included)
    // retries a context the browser refused or iOS interrupted.
    const onGesture = () => {
      if (!this.ctx || this.ctx.state !== 'running') this.unlock();
    };
    try {
      for (const type of ACTIVATION_EVENTS) window.addEventListener(type, onGesture, { capture: true, passive: true });
    } catch {
      // No window (tests).
    }
  }

  /** Call from a user gesture. Safe to call repeatedly. */
  unlock(): void {
    if (this.unsupported) return;
    try {
      // Before any interaction the context could only start suspended (and Chrome warns); wait for a real gesture.
      if (!this.ctx && !hasActivation()) return;
      if (!this.ctx && !this.init()) return;
      const ctx = this.ctx;
      if (!ctx) return;
      if (ctx.state !== 'running' && !this.hidden) this.resumeContext();
      this.ensureStreams();
    } catch {
      // Audio is optional.
    }
  }

  applySettings(settings: Settings): void {
    this.settings = settings;
    const ctx = this.ctx;
    const bus = this.bus;
    if (!ctx || !bus) return;
    try {
      const now = ctx.currentTime;
      toward(bus.master.gain, settings.muted ? 0 : 1, now, 0.03);
      toward(bus.music.gain, sliderGain(settings.music) * MUSIC_TRIM, now, 0.05);
      toward(bus.sfx.gain, sliderGain(settings.sfx) * SFX_TRIM, now, 0.05);
      toward(bus.amb.gain, sliderGain(settings.sfx) * AMB_TRIM, now, 0.05);
      this.ensureStreams();
    } catch {
      // Ignore.
    }
  }

  setScene(scene: AudioScene): void {
    if (scene === 'run' && this.scene !== 'run') this.nextRumble = 0;
    this.scene = scene;
    this.applyScene();
  }

  /** 0..1 storm intensity: rain ambience level, music filter, etc. */
  setIntensity(v: number): void {
    this.intensity = clamp01(Number.isFinite(v) ? v : 0);
    const ctx = this.ctx;
    if (!ctx || !this.bus) return;
    try {
      if (Math.abs(this.intensity - this.appliedIntensity) > 0.01) this.applyIntensity(ctx.currentTime);
      this.maybeRumble(ctx);
    } catch {
      // Ignore.
    }
  }

  play(sfx: Sfx, opts?: PlayOptions): void {
    const ctx = this.ctx;
    const kit = this.kit;
    if (!ctx || !kit || this.hidden || ctx.state !== 'running') return;
    if (this.settings.muted || !(this.settings.sfx > 0)) return;
    try {
      const spec = SFX[sfx];
      if (!spec) return;
      const now = ctx.currentTime;
      if (sfx === 'splash' && !this.takeSplash(now)) return;
      if (!this.reserveVoice(now, spec.low === true)) return;

      let t = now + 0.005;
      if (sfx === 'near-miss') {
        if (t < this.lastNearMiss + NEAR_MISS_STRUM) t = this.lastNearMiss + NEAR_MISS_STRUM;
        this.lastNearMiss = t;
      }
      if (sfx === 'thunder') this.lastThunder = now;

      const volume = Math.max(0, Math.min(1.5, opts?.volume ?? 1)) * spec.level;
      const voice = new Voice(kit, t, volume, opts?.pan ?? 0, spec.send);
      spec.build(voice, opts?.combo ?? 1);
      this.commitVoice(voice);

      if (sfx === 'hit') this.duck(0.45, 0.2, 0.5);
      else if (sfx === 'death') this.duck(0.3, 0.6, 1.2);
      else if (sfx === 'new-best') this.duck(0.6, 0.6, 0.6);
    } catch {
      // A missing node type on an old browser costs one sound, never the game.
    }
  }

  /** Page hidden. */
  suspend(): void {
    this.hidden = true;
    try {
      this.ctx?.suspend().catch(noop);
    } catch {
      // Ignore.
    }
  }

  /** Page visible again. */
  resume(): void {
    this.hidden = false;
    if (this.ctx) this.resumeContext();
  }

  // --- Setup ---

  private init(): boolean {
    const w = window as unknown as AudioWindow;
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) {
      this.unsupported = true;
      return false;
    }
    // iOS: mix with the player's own audio and respect the silent switch, like a game should.
    try {
      const session = (navigator as Navigator & AudioSessionNavigator).audioSession;
      if (session) session.type = 'ambient';
    } catch {
      // Not supported.
    }
    let ctx: AudioContext;
    try {
      ctx = new Ctor({ latencyHint: 'interactive' });
    } catch {
      this.unsupported = true;
      return false;
    }
    this.ctx = ctx;

    // Older iOS only unlocks after a buffer is played inside the gesture.
    try {
      const blip = ctx.createBufferSource();
      blip.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      blip.connect(ctx.destination);
      blip.start(0);
      blip.onended = () => blip.disconnect();
    } catch {
      // Ignore.
    }

    const s = this.settings;
    const gain = (value: number, dest: AudioNode) => {
      const g = ctx.createGain();
      g.gain.value = value;
      g.connect(dest);
      return g;
    };
    const lowpass = (freq: number, dest: AudioNode) => {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = freq;
      f.Q.value = 0.5;
      f.connect(dest);
      return f;
    };

    const master = gain(s.muted ? 0 : 1, ctx.destination);
    // A gentle limiter: catches pile-ups (thunder + hit + chimes) without pumping the mix.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 8;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    limiter.connect(master);

    const scene = SCENES[this.scene];
    const music = gain(sliderGain(s.music) * MUSIC_TRIM, limiter);
    const musicDuck = gain(1, music);
    const musicScene = gain(scene.music, musicDuck);
    const musicFilter = lowpass(scene.cutoff, musicScene);
    const musicIn = gain(0, musicFilter);

    const amb = gain(sliderGain(s.sfx) * AMB_TRIM, limiter);
    const ambLevel = gain(0, amb);
    const ambFilter = lowpass(600, ambLevel);
    const ambIn = gain(0, ambFilter);

    const sfx = gain(sliderGain(s.sfx) * SFX_TRIM, limiter);
    let wet: AudioNode | null = null;
    try {
      const conv = ctx.createConvolver();
      conv.buffer = createImpulse(ctx);
      conv.connect(sfx);
      wet = gain(1, conv);
    } catch {
      wet = null;
    }

    this.bus = { master, music, musicIn, musicFilter, musicScene, musicDuck, amb, ambIn, ambFilter, ambLevel, sfx };
    this.kit = { ctx, dry: sfx, wet, noise: createNoise(ctx), crunch: createCrunch() };
    this.applyIntensity(ctx.currentTime, true);
    return true;
  }

  private resumeContext(): void {
    try {
      const p = this.ctx?.resume() as Promise<void> | undefined;
      p?.catch(noop);
    } catch {
      // Ignore.
    }
  }

  /** Streams load lazily, only once they can be heard; rain first (small and always on). */
  private ensureStreams(): void {
    const ctx = this.ctx;
    const bus = this.bus;
    if (!ctx || !bus) return;
    const s = this.settings;
    const base = import.meta.env.BASE_URL;

    if (this.rainState === 'idle' && !s.muted && s.sfx > 0 && this.rainAttempts < LOAD_ATTEMPTS) {
      this.rainState = 'loading';
      this.rainAttempts++;
      loadBuffer(ctx, base + RAIN_URL)
        .then((buf) => {
          const at = ctx.currentTime + 0.05;
          startLoop(ctx, buf, bus.ambIn, at);
          bus.ambIn.gain.setValueAtTime(0, at);
          bus.ambIn.gain.linearRampToValueAtTime(1, at + RAIN_FADE_IN);
          this.rainState = 'ready';
        })
        .catch(() => {
          this.rainState = 'idle';
        })
        .finally(() => this.ensureStreams());
      return;
    }
    if (this.rainState === 'loading') return;

    if (this.musicState === 'idle' && !s.muted && s.music > 0 && this.musicAttempts < LOAD_ATTEMPTS) {
      this.musicState = 'loading';
      this.musicAttempts++;
      loadBuffer(ctx, base + MUSIC_URL)
        .then((buf) => {
          const at = ctx.currentTime + 0.1;
          this.music = new MusicLoop(ctx, buf, bus.musicIn);
          this.music.start(at);
          bus.musicIn.gain.setValueAtTime(0, at);
          bus.musicIn.gain.linearRampToValueAtTime(1, at + MUSIC_FADE_IN);
          this.musicState = 'ready';
        })
        .catch(() => {
          this.musicState = 'idle';
        });
    }
  }

  // --- Mix ---

  private applyScene(): void {
    const ctx = this.ctx;
    const bus = this.bus;
    if (!ctx || !bus) return;
    try {
      const now = ctx.currentTime;
      const sc = SCENES[this.scene];
      toward(bus.musicScene.gain, sc.music, now, sc.tc);
      toward(bus.musicFilter.frequency, sc.cutoff, now, sc.tc);
      this.applyIntensity(now);
    } catch {
      // Ignore.
    }
  }

  private applyIntensity(now: number, immediate = false): void {
    const bus = this.bus;
    if (!bus) return;
    const v = this.intensity;
    this.appliedIntensity = v;
    const sc = SCENES[this.scene];
    // Calm: soft, distant hiss. Cloudburst: a full, bright roar.
    const level = sc.amb * (0.3 + 0.7 * v);
    const cutoff = 500 * Math.pow(14, v);
    if (immediate) {
      bus.ambLevel.gain.value = level;
      bus.ambFilter.frequency.value = cutoff;
      return;
    }
    toward(bus.ambLevel.gain, level, now, 0.5);
    toward(bus.ambFilter.frequency, cutoff, now, 0.5);
  }

  /** Briefly pulls the music down so a big moment punches through. */
  private duck(depth: number, hold: number, release: number): void {
    const ctx = this.ctx;
    const bus = this.bus;
    if (!ctx || !bus) return;
    const now = ctx.currentTime;
    const p = bus.musicDuck.gain;
    p.cancelScheduledValues(now);
    p.setTargetAtTime(depth, now, 0.02);
    p.setTargetAtTime(1, now + hold, release / 3);
  }

  /** Distant thunder that rolls by itself in heavy weather (no flash; it's far away). */
  private maybeRumble(ctx: AudioContext): void {
    if (this.scene !== 'run' || this.intensity < RUMBLE_INTENSITY || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (this.nextRumble === 0) {
      this.nextRumble = now + rand(6, 14);
      return;
    }
    if (now < this.nextRumble) return;
    const heavy = (this.intensity - RUMBLE_INTENSITY) / (1 - RUMBLE_INTENSITY);
    this.nextRumble = now + (26 - 14 * heavy) * rand(0.75, 1.3);
    if (now - this.lastThunder < RUMBLE_GAP) return;
    if (this.settings.muted || !(this.settings.sfx > 0) || !this.kit) return;
    if (!this.reserveVoice(now, true)) return;
    this.lastThunder = now;
    const voice = new Voice(this.kit, now + 0.005, rand(0.45, 0.7), rand(-0.6, 0.6), 0.3);
    thunder(voice, rand(0.65, 1));
    this.commitVoice(voice);
  }

  // --- Voices ---

  private takeSplash(now: number): boolean {
    this.splashTokens = Math.min(SPLASH_BURST, this.splashTokens + (now - this.splashAt) * SPLASH_RATE);
    this.splashAt = now;
    if (this.splashTokens < 1) return false;
    this.splashTokens -= 1;
    return true;
  }

  private reserveVoice(now: number, low: boolean): boolean {
    const ends = this.voiceEnds;
    let w = 0;
    for (let i = 0; i < ends.length; i++) if (ends[i] > now) ends[w++] = ends[i];
    ends.length = w;
    return w < (low ? MAX_LOW_VOICES : MAX_VOICES);
  }

  private commitVoice(voice: Voice): void {
    this.voiceEnds.push(voice.end);
    voice.finish();
  }
}
