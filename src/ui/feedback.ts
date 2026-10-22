// Transient, non-blocking feedback: event banners, toasts, the resume
// countdown and the first-run tutorial hints. None of these capture pointer
// events (except toast action buttons), so touch steering on the canvas below
// keeps working while they are on screen.

import * as storage from '../storage';
import type { Device, PickupKind, TutorialHint, World } from '../types';
import { h, setChildren } from './dom';
import { animate, type UIEnv } from './env';
import { icon, type IconName } from './icons';
import { PAD_INFO, PICKUP_INFO } from './pickupinfo';
import type { ToastOptions } from './ui';

const OUT_MS = 200;

function dismiss(el: HTMLElement): void {
  if (el.classList.contains('is-out')) return;
  el.classList.add('is-out');
  window.setTimeout(() => el.remove(), OUT_MS);
}

// ---------------------------------------------------------------------------

export type BannerKind = 'calm' | 'drizzle' | 'downpour' | 'cloudburst' | 'zone' | 'milestone' | 'best' | 'warn';

/**
 * One banner at a time, so they never stack over the river ahead of the leaf
 * (where hazards come from). A more important banner replaces the current
 * one; a less important one waits its turn and is dropped if it goes stale.
 */
const PRIORITY: Record<BannerKind, number> = {
  best: 4,
  warn: 3,
  // A new zone outranks a storm change (which only waits a beat in the queue) and a milestone.
  zone: 2.5,
  cloudburst: 2,
  downpour: 2,
  drizzle: 2,
  calm: 2,
  milestone: 1,
};
/** Kinds that replace each other in the queue: only the newest of a group still matters. */
const GROUP: Record<BannerKind, string> = {
  best: 'best',
  warn: 'warn',
  zone: 'zone',
  cloudburst: 'storm',
  downpour: 'storm',
  drizzle: 'storm',
  calm: 'storm',
  milestone: 'milestone',
};
/** In-run banners stay short: the player is reading the river, not the UI. */
const MAX_BANNER_MS = 1200;
/** A queued banner older than this is no longer news. */
const QUEUE_TTL_MS = 1600;
const GAP_MS = 120;

interface BannerSpec {
  kind: BannerKind;
  text: string;
  iconName: IconName;
  ms: number;
  sub?: string;
  /** Extra styling hook (the zone id for zone banners). */
  variant?: string;
  at: number;
}

export class Banners {
  readonly el: HTMLElement;
  private current: { spec: BannerSpec; el: HTMLElement; timer: number } | null = null;
  private queue: BannerSpec[] = [];
  private nextTimer = 0;

  constructor() {
    this.el = h('div', { class: 'banners', role: 'status', 'aria-live': 'polite', 'aria-relevant': 'additions' });
  }

  show(kind: BannerKind, text: string, iconName: IconName, ms: number, sub?: string, variant?: string): void {
    const spec: BannerSpec = { kind, text, iconName, ms: Math.min(ms, MAX_BANNER_MS), sub, variant, at: performance.now() };
    const cur = this.current;
    if (cur && PRIORITY[kind] < PRIORITY[cur.spec.kind]) {
      // Same kind queued twice (e.g. two storm changes): only the newer one matters.
      this.queue = this.queue.filter((q) => GROUP[q.kind] !== GROUP[kind]);
      this.queue.push(spec);
      return;
    }
    this.mount(spec);
  }

  clear(): void {
    if (this.current) window.clearTimeout(this.current.timer);
    window.clearTimeout(this.nextTimer);
    this.current = null;
    this.queue.length = 0;
    this.el.replaceChildren();
  }

  private mount(spec: BannerSpec): void {
    if (this.current) {
      window.clearTimeout(this.current.timer);
      dismiss(this.current.el);
    }
    window.clearTimeout(this.nextTimer);
    const el = h(
      'div',
      { class: `banner banner-${spec.kind}`, 'data-zone': spec.variant },
      h('span', { class: 'banner-icon' }, icon(spec.iconName)),
      h(
        'span',
        { class: 'banner-text' },
        h('span', { class: 'banner-title' }, spec.text),
        spec.sub ? h('span', { class: 'banner-sub' }, spec.sub) : null,
      ),
    );
    this.el.appendChild(el);
    const timer = window.setTimeout(() => this.finish(el), spec.ms);
    this.current = { spec, el, timer };
  }

  private finish(el: HTMLElement): void {
    if (this.current?.el !== el) return;
    dismiss(el);
    this.current = null;
    const now = performance.now();
    this.queue = this.queue.filter((q) => now - q.at < QUEUE_TTL_MS);
    if (!this.queue.length) return;
    let best = 0;
    for (let i = 1; i < this.queue.length; i++) {
      if (PRIORITY[this.queue[i].kind] > PRIORITY[this.queue[best].kind]) best = i;
    }
    const [next] = this.queue.splice(best, 1);
    // A beat between banners so two messages never read as one.
    this.nextTimer = window.setTimeout(() => {
      if (!this.current) this.mount(next);
    }, GAP_MS);
  }
}

// ---------------------------------------------------------------------------

export type PillKind = 'trail' | 'block' | 'mission';

const MAX_PILLS = 2;
const PILL_MS = 1000;

/**
 * Small, quick confirmations ("Perfect trail!", "Blocked!") that sit under the
 * banner slot. They are not part of the banner queue: a banner is news about the
 * river, a pill is the answer to something the player just did, so it must not
 * wait behind a storm warning or push one out.
 */
export class Pills {
  readonly el: HTMLElement;

  constructor() {
    this.el = h('div', { class: 'pills', role: 'status', 'aria-live': 'polite', 'aria-relevant': 'additions' });
  }

  /** `silent`: the caller announces it itself (with more detail), so screen readers skip the pill. */
  show(kind: PillKind, text: string, iconName: IconName, detail?: string, silent = false): void {
    while (this.el.children.length >= MAX_PILLS) this.el.firstElementChild?.remove();
    const el = h(
      'div',
      { class: `pill pill-${kind}`, 'aria-hidden': silent ? 'true' : null },
      icon(iconName, 'icon pill-icon'),
      h('span', { class: 'pill-text' }, text),
      detail ? h('span', { class: 'pill-detail' }, detail) : null,
    );
    this.el.appendChild(el);
    window.setTimeout(() => dismiss(el), PILL_MS);
  }

  clear(): void {
    this.el.replaceChildren();
  }
}

// ---------------------------------------------------------------------------

/**
 * The first time a power-up (or a lily pad) is ever on screen, say what it
 * does (once, then never again). The pads need it most: they look like solid
 * obstacles, and a player who steers around every one never finds out they
 * are harmless.
 */
const HINT_S = 2.6;
/** Visible = inside the top edge of the view (world units). */
const HINT_TOP = 6;
/** ...and not already past the leaf. */
const HINT_BOTTOM = 120;

type HintKind = Exclude<PickupKind, 'crumb'> | 'pad';
const HINT_KINDS: readonly HintKind[] = ['mushroom', 'honey', 'ladybug', 'firefly', 'pad'];
const kindBit = (k: PickupKind): number => (k === 'mushroom' ? 1 : k === 'honey' ? 2 : k === 'ladybug' ? 4 : k === 'firefly' ? 8 : 0);
const PAD_BIT = 16;
const flagOf = (k: HintKind): string => `seen:${k}`;

export class PickupHint {
  readonly el: HTMLElement;
  /** Bit per kind not yet introduced; 0 once all are known (scan is then a single compare). */
  private unseen = 0;
  /** Sim time (world.time) when the hint starts to fade, and when it is gone. Sim time, not a timer, so a paused game keeps the hint on hold. */
  private fadeAt = 0;
  private goneAt = 0;
  private fading = false;

  constructor() {
    this.el = h('div', { class: 'pk-hint', hidden: true, role: 'status', 'aria-live': 'polite' });
    for (const k of HINT_KINDS) if (!storage.getFlag(flagOf(k))) this.unseen |= k === 'pad' ? PAD_BIT : kindBit(k);
  }

  /** Called every frame while running: cheap, allocation-free. */
  scan(w: World): void {
    if (!this.el.hidden) {
      this.age(w.time);
      return;
    }
    // One hint at a time: a second kind in view waits for the first to finish rather than replacing it.
    if (this.unseen === 0 || w.state !== 'running') return;
    const list = w.pickups;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (p.taken || p.kind === 'crumb') continue;
      const bit = kindBit(p.kind);
      if (!(this.unseen & bit)) continue;
      if (p.y < HINT_TOP || p.y > w.viewH - HINT_BOTTOM) continue;
      this.unseen &= ~bit;
      storage.setFlag(flagOf(p.kind));
      this.show(w.time, p.kind);
      return;
    }
    if (!(this.unseen & PAD_BIT)) return;
    const obs = w.obstacles;
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      if (o.kind !== 'pad' || o.y < HINT_TOP || o.y > w.viewH - HINT_BOTTOM) continue;
      this.unseen &= ~PAD_BIT;
      storage.setFlag(flagOf('pad'));
      this.show(w.time, 'pad');
      return;
    }
  }

  hide(): void {
    this.fading = false;
    this.el.hidden = true;
    this.el.classList.remove('is-out');
  }

  private age(now: number): void {
    if (!this.fading) {
      if (now < this.fadeAt) return;
      this.fading = true;
      this.goneAt = now + OUT_MS / 1000;
      this.el.classList.add('is-out');
    } else if (now >= this.goneAt) {
      this.hide();
    }
  }

  private show(now: number, kind: HintKind): void {
    const info = kind === 'pad' ? PAD_INFO : PICKUP_INFO[kind];
    this.hide();
    setChildren(
      this.el,
      h('span', { class: 'pk-hint-icon', 'data-kind': kind }, icon(info.icon, 'icon')),
      h('span', { class: 'pk-hint-text' }, h('strong', null, info.name), ` \u2014 ${info.effect}`),
    );
    this.fadeAt = now + HINT_S;
    this.el.hidden = false;
  }
}

// ---------------------------------------------------------------------------

const MAX_TOASTS = 3;

export class Toasts {
  readonly el: HTMLElement;

  constructor() {
    this.el = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
  }

  show(text: string, opts: ToastOptions = {}): void {
    // The same message twice in a row (e.g. mashing the mute key) refreshes instead of stacking.
    const last = this.el.lastElementChild as HTMLElement | null;
    if (last && last.dataset.text === text && !opts.actionLabel) last.remove();
    while (this.el.children.length >= MAX_TOASTS) this.el.firstElementChild?.remove();

    const el = h('div', { class: 'toast', 'data-text': text }, h('span', { class: 'toast-text' }, text));
    if (opts.actionLabel) {
      el.classList.add('has-action');
      el.appendChild(
        h(
          'button',
          {
            class: 'toast-action',
            type: 'button',
            onclick: () => {
              opts.onAction?.();
              dismiss(el);
            },
          },
          opts.actionLabel,
        ),
      );
    }
    this.el.appendChild(el);
    const ms = opts.ms ?? (opts.actionLabel ? 8000 : 2400);
    window.setTimeout(() => dismiss(el), ms);
  }

  /** Remove toasts with buttons (a run is starting: nothing tappable may sit in the steering zone). */
  clearActions(): void {
    for (const el of Array.from(this.el.querySelectorAll<HTMLElement>('.toast.has-action'))) el.remove();
  }
}

// ---------------------------------------------------------------------------

const GO_MS = 600;
const TICK_IN: Keyframe[] = [
  { transform: 'scale(1.9)', opacity: 0 },
  { transform: 'scale(0.92)', opacity: 1, offset: 0.55 },
  { transform: 'scale(1)', opacity: 1 },
];
const TICK_OPTS: KeyframeAnimationOptions = { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' };
const RING: Keyframe[] = [
  { transform: 'scale(0.6)', opacity: 0.9 },
  { transform: 'scale(1.5)', opacity: 0 },
];
const RING_OPTS: KeyframeAnimationOptions = { duration: 480, easing: 'ease-out' };

export class Countdown {
  readonly el: HTMLElement;
  private textNode = document.createTextNode('');
  private numEl: HTMLElement;
  private ringEl: HTMLElement;
  private hideTimer = 0;

  constructor(private env: UIEnv) {
    this.numEl = h('span', { class: 'countdown-num' }, this.textNode);
    this.ringEl = h('span', { class: 'countdown-ring' });
    this.el = h('div', { class: 'countdown', hidden: true, 'aria-hidden': 'true' }, this.ringEl, this.numEl);
  }

  show(n: number | null): void {
    window.clearTimeout(this.hideTimer);
    if (n === null) {
      this.el.hidden = true;
      this.el.classList.remove('is-out');
      return;
    }
    this.el.hidden = false;
    this.el.classList.remove('is-out');
    const go = n <= 0;
    this.el.classList.toggle('is-go', go);
    this.textNode.data = go ? 'GO!' : String(n);
    animate(this.env, this.numEl, TICK_IN, TICK_OPTS);
    animate(this.env, this.ringEl, RING, RING_OPTS);
    if (go) {
      this.hideTimer = window.setTimeout(() => {
        this.el.classList.add('is-out');
        this.hideTimer = window.setTimeout(() => {
          this.el.hidden = true;
          this.el.classList.remove('is-out');
        }, OUT_MS);
      }, GO_MS - OUT_MS);
    }
  }
}

// ---------------------------------------------------------------------------

const STEER_TEXT: Record<Device, { title: string; sub?: string }> = {
  touch: { title: 'Drag anywhere to steer', sub: 'Your thumb never covers the ant' },
  mouse: { title: 'Move the mouse to steer' },
  keyboard: { title: '← → or A / D to steer' },
  gamepad: { title: 'Left stick to steer' },
};

function steerVisual(device: Device): HTMLElement {
  switch (device) {
    case 'keyboard':
      return h(
        'div',
        { class: 'tut-visual tut-keys' },
        h('span', { class: 'tut-key tut-key-l' }, icon('arrowLeft')),
        h('span', { class: 'tut-key tut-key-r' }, icon('arrowRight')),
      );
    case 'gamepad':
      return h('div', { class: 'tut-visual tut-stick' }, h('span', { class: 'tut-stick-knob' }));
    case 'mouse':
      return h('div', { class: 'tut-visual tut-drag' }, h('span', { class: 'tut-track' }), h('span', { class: 'tut-mover' }, icon('mouse')));
    case 'touch':
      return h('div', { class: 'tut-visual tut-drag' }, h('span', { class: 'tut-track' }), h('span', { class: 'tut-mover' }, icon('touch')));
  }
}

export class Tutorial {
  readonly el: HTMLElement;
  private hint: TutorialHint = null;
  private device: Device | null = null;

  constructor() {
    this.el = h('div', { class: 'tutorial', hidden: true, role: 'status', 'aria-live': 'polite' });
  }

  show(hint: TutorialHint, device: Device): void {
    if (hint === this.hint && (hint !== 'steer' || device === this.device)) return;
    this.hint = hint;
    this.device = device;
    if (!hint) {
      if (!this.el.hidden) {
        this.el.classList.add('is-out');
        window.setTimeout(() => {
          if (this.hint) return;
          this.el.hidden = true;
          this.el.classList.remove('is-out');
        }, OUT_MS);
      }
      return;
    }
    this.el.classList.remove('is-out');
    this.el.hidden = false;
    if (hint === 'steer') {
      const t = STEER_TEXT[device];
      setChildren(
        this.el,
        steerVisual(device),
        h('div', { class: 'tut-copy' }, h('p', { class: 'tut-title' }, t.title), t.sub ? h('p', { class: 'tut-sub' }, t.sub) : null),
      );
    } else {
      setChildren(
        this.el,
        h('div', { class: 'tut-visual tut-shadow' }, h('span', { class: 'tut-shadow-fill' }), h('span', { class: 'tut-shadow-ring' })),
        h(
          'div',
          { class: 'tut-copy' },
          h('p', { class: 'tut-title' }, 'Shadows show where rain will land'),
          h('p', { class: 'tut-sub' }, 'Only the ant counts. Gold ring? Move! Graze close for points'),
        ),
      );
    }
  }

  /** The player switched input device mid-hint: swap the steering visual. */
  refreshDevice(device: Device): void {
    if (this.hint === 'steer' && device !== this.device) this.show('steer', device);
  }
}
