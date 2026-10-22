// The two recorded streams: background music and rain ambience. Both are
// decoded into AudioBuffers (gapless, works from the service-worker cache).
//
// Decoded audio is 32-bit float per sample: the 3.5-minute music track at the
// device's 44.1/48 kHz is ~75-80 MB. decodeAudioData resamples to the rate of
// the context that decodes, so decoding through an OfflineAudioContext at a
// lower rate shrinks the buffer, and any context can still play it (the
// source node resamples on the fly). The rain is always heard through a
// lowpass at or below 7 kHz, so 16 kHz loses nothing; the music keeps 12 kHz
// of bandwidth at 24 kHz.

import { findLoopPoints, type LoopPoints } from './loop-points';

/** Decode rates (Hz) for the two streams. */
export const MUSIC_RATE = 24000;
export const RAIN_RATE = 16000;

type OfflineCtor = new (channels: number, length: number, sampleRate: number) => BaseAudioContext;

/** A throwaway decoder at `rate`, or null where the browser refuses that rate. */
function decoderAt(rate: number): BaseAudioContext | null {
  const w = window as unknown as { OfflineAudioContext?: OfflineCtor; webkitOfflineAudioContext?: OfflineCtor };
  const Ctor = w.OfflineAudioContext ?? w.webkitOfflineAudioContext;
  if (!Ctor) return null;
  try {
    return new Ctor(1, 1, rate);
  } catch {
    return null;
  }
}

function decode(ctx: BaseAudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise<AudioBuffer>((resolve, reject) => {
    // Callback form too: older Safari never resolves the promise form.
    const p = ctx.decodeAudioData(data, resolve, reject) as Promise<AudioBuffer> | undefined;
    p?.then(resolve, reject);
  });
}

/** Fetches and decodes `url`, at `rate` Hz when given and supported (else at the context's rate). */
export async function loadBuffer(ctx: BaseAudioContext, url: string, rate?: number): Promise<AudioBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const data = await res.arrayBuffer();
  const small = rate && rate < ctx.sampleRate ? decoderAt(rate) : null;
  if (small) {
    try {
      // decodeAudioData detaches its input: keep the original for the fallback.
      return await decode(small, data.slice(0));
    } catch {
      // Some engines only decode at their own rates: fall through.
    }
  }
  return decode(ctx, data);
}

export function analyseLoop(buf: AudioBuffer): LoopPoints {
  const channels: Float32Array[] = [];
  for (let c = 0; c < buf.numberOfChannels; c++) channels.push(buf.getChannelData(c));
  return findLoopPoints(channels, buf.sampleRate);
}

/** Seamless loop (rain): one looping source between the audible bounds. */
export function startLoop(ctx: BaseAudioContext, buf: AudioBuffer, dest: AudioNode, at: number): AudioBufferSourceNode {
  const lp = analyseLoop(buf);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  if (lp.end - lp.start > 1) {
    src.loopStart = lp.start;
    src.loopEnd = lp.end;
  }
  src.connect(dest);
  // Start somewhere random so the menu never opens on the same raindrop.
  src.start(at, lp.start + Math.random() * Math.max(0, lp.end - lp.start - 1));
  return src;
}

/**
 * Music that ends in a fade: each pass is a fresh source started at the
 * previous pass's fade, so the tail overlaps the new beginning like a DJ segue.
 * Scheduling is in context time, so a suspended context simply waits.
 */
export class MusicLoop {
  private readonly lp: LoopPoints;
  private next = 0;
  private timer = 0;
  private stopped = false;
  private live = new Set<AudioBufferSourceNode>();

  constructor(
    private ctx: BaseAudioContext,
    private buf: AudioBuffer,
    private dest: AudioNode,
  ) {
    this.lp = analyseLoop(buf);
  }

  start(at: number): void {
    this.pass(at);
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    for (const s of this.live) {
      try {
        s.stop();
        s.disconnect();
      } catch {
        // Already stopped.
      }
    }
    this.live.clear();
  }

  private pass(at: number): void {
    if (this.stopped) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buf;
    src.connect(this.dest);
    src.start(at, this.lp.start);
    src.onended = () => {
      src.disconnect();
      this.live.delete(src);
    };
    this.live.add(src);
    this.next = at + Math.max(1, this.lp.segue - this.lp.start);
    this.arm();
  }

  private arm(): void {
    clearTimeout(this.timer);
    const lead = this.next - this.ctx.currentTime;
    // Wake ~2 s early; timers are throttled in background tabs, so re-check rather than trust them.
    this.timer = window.setTimeout(() => this.tick(), Math.max(250, (lead - 2) * 1000));
  }

  private tick(): void {
    if (this.stopped) return;
    const lead = this.next - this.ctx.currentTime;
    if (lead > 3) {
      this.arm();
      return;
    }
    this.pass(Math.max(this.next, this.ctx.currentTime + 0.05));
  }
}
