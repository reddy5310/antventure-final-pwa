// In-run heads-up display. update() runs every frame, so it compares against
// cached values and only writes to the DOM when something visible changed:
// text goes through pre-made Text nodes (no innerHTML), the combo timer
// through a transform (compositor only), and animations through WAAPI (no
// forced reflow to restart CSS animations).
//
// The bar's four groups (hearts, chips, centre, controls) are direct grid
// children, so CSS can lay them out across the top on phones or into the side
// gutters on wide screens without touching this code.

import { MAX_HEARTS, UNITS_PER_METER } from '../config';
// Shared with the canvas near-miss text so both heat up at the same chain lengths.
import { comboTier } from '../render/palette';
import type { GameEvent, World } from '../types';
import { heartSvg } from './art';
import { h } from './dom';
import { animate, type UIEnv } from './env';
import { fmtInt, fmtMeters, fmtMult } from './format';
import { icon } from './icons';

/** Combo timer bar resolution: 200 steps is smoother than the eye needs. */
const BAR_STEPS = 200;
const SCALE_X: string[] = Array.from({ length: BAR_STEPS + 1 }, (_, i) => `scaleX(${i / BAR_STEPS})`);
/** The best chip turns urgent inside this many points (or this share of the best). */
const CLOSE_TO_BEST_PTS = 150;
const CLOSE_TO_BEST_SHARE = 0.15;
/** How long a broken chain stays on the meter. */
const LOST_MS = 1100;

const SHAKE: Keyframe[] = [
  { transform: 'translateX(0)' },
  { transform: 'translateX(-7px) rotate(-3deg)' },
  { transform: 'translateX(6px) rotate(2deg)' },
  { transform: 'translateX(-4px)' },
  { transform: 'translateX(2px)' },
  { transform: 'translateX(0)' },
];
const HEART_BREAK: Keyframe[] = [
  { transform: 'scale(1.5) rotate(-12deg)', filter: 'brightness(2)' },
  { transform: 'scale(0.8) rotate(8deg)', offset: 0.55 },
  { transform: 'scale(1) rotate(0)', filter: 'none' },
];
const PULSE: Keyframe[] = [
  { transform: 'scale(1)' },
  { transform: 'scale(1.16)', offset: 0.3 },
  { transform: 'scale(1)' },
];
const POP: Keyframe[] = [
  { transform: 'scale(0.6)', opacity: 0.4 },
  { transform: 'scale(1.25)', offset: 0.5 },
  { transform: 'scale(1)', opacity: 1 },
];
const SHAKE_OPTS: KeyframeAnimationOptions = { duration: 380, easing: 'ease-out' };
const BREAK_OPTS: KeyframeAnimationOptions = { duration: 520, easing: 'cubic-bezier(.2,.8,.2,1)' };
const PULSE_OPTS: KeyframeAnimationOptions = { duration: 220, easing: 'ease-out' };
const POP_OPTS: KeyframeAnimationOptions = { duration: 260, easing: 'cubic-bezier(.34,1.56,.64,1)' };

type BestState = 'none' | 'chase' | 'close' | 'beat';

export class Hud {
  readonly el: HTMLElement;
  readonly pauseBtn: HTMLButtonElement;

  private heartsEl: HTMLElement;
  private heartEls: HTMLElement[] = [];
  private scoreEl: HTMLElement;
  private scoreText = document.createTextNode('0');
  private comboEl: HTMLElement;
  private multEl: HTMLElement;
  private multText = document.createTextNode('×1');
  private chainText = document.createTextNode('');
  private comboFill: HTMLElement;
  private distText = document.createTextNode('0 m');
  private bestEl: HTMLElement;
  private bestText = document.createTextNode('');
  private fpsEl: HTMLElement;
  private fpsText = document.createTextNode('');
  private lostTimer = 0;
  private lost = false;

  // Last values written to the DOM.
  private hearts = -1;
  private score = -1;
  private scoreLen = -1;
  private mult = -1;
  private combo = -1;
  private tier = -1;
  private comboStep = -1;
  private comboMax = 1;
  private meters = -1;
  private best: BestState | '' = '';
  private bestNum = -1;
  private fps = -1;
  private showFps: boolean | null = null;
  private canPause: boolean | null = null;

  constructor(private env: UIEnv) {
    for (let i = 0; i < MAX_HEARTS; i++) {
      this.heartEls.push(h('span', { class: 'heart is-full' }, heartSvg()));
    }
    this.heartsEl = h('div', { class: 'hearts', role: 'img', 'aria-label': 'Hearts' }, this.heartEls);

    this.bestEl = h(
      'div',
      { class: 'hud-chip hud-best', 'data-state': 'none', title: 'Your best score on this board' },
      icon('crown', 'icon hud-chip-icon'),
      h('span', null, this.bestText),
    );
    const chips = h(
      'div',
      { class: 'hud-chips' },
      h('div', { class: 'hud-chip hud-dist' }, icon('up', 'icon hud-chip-icon'), h('span', null, this.distText)),
      this.bestEl,
    );

    this.scoreEl = h('div', { class: 'hud-score' }, this.scoreText);
    this.multEl = h('span', { class: 'hud-mult' }, this.multText);
    this.comboFill = h('span', { class: 'combo-fill' });
    this.comboEl = h(
      'div',
      { class: 'hud-combo', 'data-tier': '0' },
      this.multEl,
      h('span', { class: 'combo-track' }, this.comboFill),
      h('span', { class: 'hud-chain' }, this.chainText),
    );
    const center = h('div', { class: 'hud-center' }, h('span', { class: 'hud-score-label' }, 'Score'), this.scoreEl, this.comboEl);

    this.pauseBtn = h(
      'button',
      {
        class: 'btn-icon hud-pause',
        type: 'button',
        'aria-label': 'Pause',
        title: 'Pause (Esc / P)',
        onclick: () => this.env.handlers.onPause(),
      },
      icon('pause'),
    );
    this.fpsEl = h('div', { class: 'hud-fps', hidden: true }, this.fpsText);
    const right = h('div', { class: 'hud-right' }, this.pauseBtn, this.fpsEl);

    this.el = h('div', { class: 'hud', hidden: true }, h('div', { class: 'hud-bar' }, this.heartsEl, chips, center, right));
  }

  /** Forget cached values so the next update rewrites everything (new run). */
  reset(): void {
    this.hearts = -1;
    this.score = -1;
    this.scoreLen = -1;
    this.mult = -1;
    this.combo = -1;
    this.tier = -1;
    this.comboStep = -1;
    this.comboMax = 1;
    this.meters = -1;
    this.best = '';
    this.bestNum = -1;
    this.fps = -1;
    this.showFps = null;
    this.canPause = null;
    this.endLost();
  }

  update(w: World, fps: number, showFps: boolean): void {
    const hearts = w.player.hearts;
    if (hearts !== this.hearts) this.setHearts(hearts);

    const score = Math.floor(w.score);
    if (score !== this.score) {
      this.score = score;
      const s = fmtInt(score);
      this.scoreText.data = s;
      if (s.length !== this.scoreLen) {
        // Long scores step the font down so the HUD never collides on 360px.
        this.scoreLen = s.length;
        this.scoreEl.dataset.len = s.length > 9 ? 'xl' : s.length > 6 ? 'l' : 's';
      }
    }

    const combo = w.combo;
    if (combo !== this.combo) {
      // The timer refills whenever the combo grows: remember that length as 100%.
      if (combo > this.combo) this.comboMax = Math.max(w.comboTimer, 0.001);
      this.combo = combo;
      if (combo > 0) {
        // A fresh graze ends the "lost" flash at once.
        if (this.lost) this.endLost();
        this.chainText.data = `${fmtInt(combo)} chain`;
      }
      this.comboEl.classList.toggle('is-on', combo > 0 || this.lost);
      const tier = comboTier(combo);
      if (tier !== this.tier && !this.lost) {
        this.tier = tier;
        this.comboEl.dataset.tier = String(tier);
      }
    }
    if (combo > 0) {
      const r = w.comboTimer / this.comboMax;
      const step = r <= 0 ? 0 : r >= 1 ? BAR_STEPS : Math.round(r * BAR_STEPS);
      if (step !== this.comboStep) {
        this.comboStep = step;
        this.comboFill.style.transform = SCALE_X[step];
      }
    }

    // While the broken chain is on show the pill says so; the real multiplier returns after.
    if (!this.lost && w.multiplier !== this.mult) {
      this.mult = w.multiplier;
      this.multText.data = fmtMult(w.multiplier);
    }

    const meters = Math.floor(w.distance / UNITS_PER_METER);
    if (meters !== this.meters) {
      this.meters = meters;
      this.distText.data = fmtMeters(meters);
    }
    this.updateBest(w, score);

    const canPause = w.state === 'running';
    if (canPause !== this.canPause) {
      // Nothing to pause once the ant is down: the game-over screen is a second away.
      this.canPause = canPause;
      this.pauseBtn.disabled = !canPause;
    }

    if (showFps !== this.showFps) {
      this.showFps = showFps;
      this.fpsEl.hidden = !showFps;
    }
    if (showFps && fps !== this.fps) {
      this.fps = fps;
      this.fpsText.data = `${fps} fps`;
      this.fpsEl.classList.toggle('is-low', fps < 50);
    }
  }

  onEvent(e: GameEvent): void {
    switch (e.type) {
      case 'start':
        this.reset();
        break;
      case 'hit':
        animate(this.env, this.heartsEl, SHAKE, SHAKE_OPTS);
        break;
      case 'near-miss':
        animate(this.env, this.scoreEl, PULSE, PULSE_OPTS);
        animate(this.env, this.multEl, POP, POP_OPTS);
        break;
      case 'combo-lost':
        this.showLost(e.combo);
        break;
      default:
        break;
    }
  }

  /** The chain just broke: the meter itself says so (no extra pill over the river). */
  private showLost(chain: number): void {
    window.clearTimeout(this.lostTimer);
    this.lost = true;
    this.multText.data = 'Lost';
    this.chainText.data = `${fmtInt(chain)} chain`;
    this.comboFill.style.transform = SCALE_X[0];
    this.comboStep = 0;
    this.comboEl.classList.add('is-on', 'is-lost');
    animate(this.env, this.comboEl, POP, POP_OPTS);
    this.lostTimer = window.setTimeout(() => {
      this.endLost();
      this.comboEl.classList.toggle('is-on', this.combo > 0);
    }, LOST_MS);
  }

  private endLost(): void {
    window.clearTimeout(this.lostTimer);
    this.lost = false;
    this.comboEl.classList.remove('is-lost');
    // Force the next update to rewrite the multiplier and tier.
    this.mult = -1;
    this.tier = -1;
  }

  private setHearts(hearts: number): void {
    const prev = this.hearts;
    this.hearts = hearts;
    for (let i = 0; i < this.heartEls.length; i++) {
      const full = i < hearts;
      const el = this.heartEls[i];
      el.classList.toggle('is-full', full);
      el.classList.toggle('is-lost', !full);
      // Animate only the heart(s) just lost, not the initial fill.
      if (!full && prev > i) animate(this.env, el, HEART_BREAK, BREAK_OPTS);
    }
    this.heartsEl.classList.toggle('is-last', hearts === 1);
    this.heartsEl.setAttribute('aria-label', `${hearts} of ${MAX_HEARTS} hearts`);
  }

  /** Score pace against the board's best score: the same metric the boards rank by. */
  private updateBest(w: World, score: number): void {
    let state: BestState;
    let num = 0;
    if (w.bestScore <= 0) state = 'none';
    else if (w.beatBest) state = 'beat';
    else {
      // Points still needed to strictly beat the best.
      num = Math.max(1, w.bestScore - score + 1);
      state = num <= Math.max(CLOSE_TO_BEST_PTS, w.bestScore * CLOSE_TO_BEST_SHARE) ? 'close' : 'chase';
    }
    if (state === this.best && num === this.bestNum) return;
    const stateChanged = state !== this.best;
    this.best = state;
    this.bestNum = num;
    if (stateChanged) {
      this.bestEl.dataset.state = state;
      if (state === 'beat') animate(this.env, this.bestEl, POP, POP_OPTS);
    }
    switch (state) {
      case 'chase':
      case 'close':
        this.bestText.data = `${fmtInt(num)} to beat`;
        break;
      case 'beat':
        this.bestText.data = 'NEW BEST';
        break;
      case 'none':
        this.bestText.data = '';
        break;
    }
  }
}
