// Pause screen: resume is one key/tap away; the current run's numbers remind
// the player what is at stake before they quit. Restarting a run that has
// real progress asks for a second press, so one mis-tap (Restart sits right
// under Resume on phones) or a stray R never throws a long run away.

import { UNITS_PER_METER } from '../../config';
import type { DailyInfo, World } from '../../types';
import { focusEl, h, setChildren } from '../dom';
import type { UIEnv } from '../env';
import { fmtInt, fmtMeters, fmtMult } from '../format';
import { icon } from '../icons';
import { ZONE_INFO } from '../pickupinfo';

/** Runs shorter than this (s) restart at once: nothing much to lose. */
export const RESTART_CONFIRM_AFTER = 15;
/** How long the armed "press again" state lasts (ms). */
const ARM_MS = 3000;

export class PauseScreen {
  readonly el: HTMLElement;
  readonly resumeBtn: HTMLButtonElement;
  private restartBtn: HTMLButtonElement;
  private restartLabel = document.createTextNode('Restart');
  private hintEl: HTMLElement;
  private needsConfirm: boolean;
  private armed = false;
  private armTimer = 0;

  constructor(
    world: World | null,
    daily: DailyInfo | null,
    private env: UIEnv,
  ) {
    const eyebrow = world?.mode === 'daily' && daily ? `Daily River #${daily.number}` : 'Endless river';
    this.needsConfirm = !!world && world.state === 'running' && world.time >= RESTART_CONFIRM_AFTER;

    const stat = (label: string, value: string) =>
      h('div', { class: 'stat' }, h('span', { class: 'stat-value' }, value), h('span', { class: 'stat-label' }, label));
    const stats = world
      ? h(
          'div',
          { class: 'stats stats-6' },
          stat('Score', fmtInt(Math.floor(world.score))),
          stat('Distance', fmtMeters(Math.floor(world.distance / UNITS_PER_METER))),
          stat('Crumbs', fmtInt(world.crumbs)),
          stat('Near-misses', fmtInt(world.nearMisses)),
          stat('Multiplier', fmtMult(world.multiplier)),
          stat('Zone', ZONE_INFO[world.zone].name),
        )
      : null;

    this.resumeBtn = h(
      'button',
      { class: 'btn btn-primary btn-lg', type: 'button', 'data-sfx': 'none', onclick: () => env.handlers.onResume() },
      icon('play'),
      'Resume',
    );

    this.restartBtn = h(
      'button',
      {
        class: 'btn btn-secondary btn-restart',
        type: 'button',
        'data-sfx': 'none',
        onclick: () => {
          if (this.requestRestart()) env.handlers.onRetry();
        },
      },
      icon('restart'),
      h('span', null, this.restartLabel),
    );

    this.hintEl = h('p', { class: 'key-hints' });
    this.refreshDevice();

    this.el = h(
      'section',
      { class: 'screen screen-pause scrim', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pause-title' },
      h(
        'div',
        { class: 'panel screen-panel' },
        h('p', { class: 'eyebrow' }, eyebrow),
        h('h2', { class: 'screen-title', id: 'pause-title' }, 'Paused'),
        stats,
        h(
          'div',
          { class: 'btn-stack' },
          this.resumeBtn,
          h(
            'div',
            { class: 'btn-row' },
            this.restartBtn,
            h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => env.openSettings() }, icon('settings'), 'Settings'),
          ),
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => env.handlers.onMenu() }, icon('home'), 'Quit to menu'),
        ),
        this.hintEl,
      ),
    );
  }

  focusPrimary(): void {
    focusEl(this.resumeBtn);
  }

  /**
   * True when the restart should happen now. A run with progress needs two
   * presses within ARM_MS: the first only arms the button (and says so).
   */
  requestRestart(): boolean {
    if (!this.needsConfirm || this.armed) {
      this.disarm();
      return true;
    }
    this.armed = true;
    this.restartBtn.classList.add('is-armed');
    const d = this.env.device();
    this.restartLabel.data = d === 'touch' ? 'Tap again' : d === 'gamepad' ? 'Ⓨ again' : 'Again to restart';
    this.env.handlers.onSfx('back');
    this.env.announce('Press restart again to lose this run and start over.');
    window.clearTimeout(this.armTimer);
    this.armTimer = window.setTimeout(() => this.disarm(), ARM_MS);
    return false;
  }

  refreshDevice(): void {
    const d = this.env.device();
    const k = (t: string, pad = false) => h('kbd', { class: pad ? 'kbd kbd-pad' : 'kbd' }, t);
    if (d === 'touch') {
      this.hintEl.hidden = true;
      return;
    }
    this.hintEl.hidden = false;
    const twice = this.needsConfirm ? ' ×2' : '';
    if (d === 'gamepad') setChildren(this.hintEl, k('Ⓑ', true), ' / ', k('Start'), ' resume · ', k('Ⓨ', true), `${twice} restart`);
    else setChildren(this.hintEl, k('Esc'), ' / ', k('P'), ' resume · ', k('R'), `${twice} restart · `, k('M'), ' mute');
  }

  private disarm(): void {
    window.clearTimeout(this.armTimer);
    this.armed = false;
    this.restartBtn.classList.remove('is-armed');
    this.restartLabel.data = 'Restart';
  }
}
