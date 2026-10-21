// The two recorded streams: background music and rain ambience. Both are
// decoded into AudioBuffers (gapless, works from the service-worker cache).

import { findLoopPoints, type LoopPoints } from './loop-points';

export async function loadBuffer(ctx: BaseAudioContext, url: string): Promise<AudioBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const data = await res.arrayBuffer();
  return new Promise<AudioBuffer>((resolve, reject) => {
    // Callback form too: older Safari never resolves the promise form.
    const p = ctx.decodeAudioData(data, resolve, reject) as Promise<AudioBuffer> | undefined;
    p?.then(resolve, reject);
  });
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
