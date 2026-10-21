// Transient, non-blocking feedback: event banners, toasts, the resume
// countdown and the first-run tutorial hints. None of these capture pointer
// events (except toast action buttons), so touch steering on the canvas below
// keeps working while they are on screen.

import type { Device, TutorialHint } from '../types';
import { h, setChildren } from './dom';
import { animate, type UIEnv } from './env';
import { icon, type IconName } from './icons';
import type { ToastOptions } from './ui';

const OUT_MS = 200;

function dismiss(el: HTMLElement): void {
  if (el.classList.contains('is-out')) return;
  el.classList.add('is-out');
  window.setTimeout(() => el.remove(), OUT_MS);
}

// ---------------------------------------------------------------------------

export type BannerKind = 'calm' | 'drizzle' | 'downpour' | 'cloudburst' | 'milestone' | 'best' | 'warn';

/** Banners in the same slot replace each other instead of stacking. */
const SLOT: Record<BannerKind, string> = {
  calm: 'storm',
  drizzle: 'storm',
  downpour: 'storm',
  cloudburst: 'storm',
  milestone: 'progress',
  best: 'best',
  warn: 'warn',
};
const MAX_BANNERS = 3;

export class Banners {
  readonly el: HTMLElement;

  constructor() {
    this.el = h('div', { class: 'banners', role: 'status', 'aria-live': 'polite', 'aria-relevant': 'additions' });
  }

  show(kind: BannerKind, text: string, iconName: IconName, ms: number, sub?: string): void {
    const slot = SLOT[kind];
    for (const old of Array.from(this.el.children) as HTMLElement[]) {
      if (old.dataset.slot === slot) old.remove();
    }
    while (this.el.children.length >= MAX_BANNERS) this.el.firstElementChild?.remove();
    const el = h(
      'div',
      { class: `banner banner-${kind}`, 'data-slot': slot },
      h('span', { class: 'banner-icon' }, icon(iconName)),
      h('span', { class: 'banner-text' }, h('span', { class: 'banner-title' }, text), sub ? h('span', { class: 'banner-sub' }, sub) : null),
    );
    this.el.appendChild(el);
    window.setTimeout(() => dismiss(el), ms);
  }

  clear(): void {
    this.el.replaceChildren();
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
          h('p', { class: 'tut-title' }, 'Dark circles show where rain lands'),
          h('p', { class: 'tut-sub' }, 'Stay out! Dodge close for combo points'),
        ),
      );
    }
  }

  /** The player switched input device mid-hint: swap the steering visual. */
  refreshDevice(device: Device): void {
    if (this.hint === 'steer' && device !== this.device) this.show('steer', device);
  }
}
