// Pause screen: resume is one key/tap away; the current run's numbers remind
// the player what is at stake before they quit.

import { UNITS_PER_METER } from '../../config';
import type { DailyInfo, World } from '../../types';
import { focusEl, h, setChildren } from '../dom';
import type { UIEnv } from '../env';
import { fmtInt, fmtMeters, fmtMult } from '../format';
import { icon } from '../icons';

export class PauseScreen {
  readonly el: HTMLElement;
  readonly resumeBtn: HTMLButtonElement;
  private hintEl: HTMLElement;

  constructor(
    world: World | null,
    daily: DailyInfo | null,
    private env: UIEnv,
  ) {
    const eyebrow = world?.mode === 'daily' && daily ? `Daily River #${daily.number}` : 'Endless river';

    const stat = (label: string, value: string) =>
      h('div', { class: 'stat' }, h('span', { class: 'stat-value' }, value), h('span', { class: 'stat-label' }, label));
    const stats = world
      ? h(
          'div',
          { class: 'stats stats-4' },
          stat('Score', fmtInt(Math.floor(world.score))),
          stat('Distance', fmtMeters(Math.floor(world.distance / UNITS_PER_METER))),
          stat('Near-misses', fmtInt(world.nearMisses)),
          stat('Multiplier', fmtMult(world.multiplier)),
        )
      : null;

    this.resumeBtn = h(
      'button',
      { class: 'btn btn-primary btn-lg', type: 'button', 'data-sfx': 'none', onclick: () => env.handlers.onResume() },
      icon('play'),
      'Resume',
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
            h('button', { class: 'btn btn-secondary', type: 'button', 'data-sfx': 'none', onclick: () => env.handlers.onRetry() }, icon('restart'), 'Restart'),
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

  refreshDevice(): void {
    const d = this.env.device();
    const k = (t: string, pad = false) => h('kbd', { class: pad ? 'kbd kbd-pad' : 'kbd' }, t);
    if (d === 'touch') {
      this.hintEl.hidden = true;
      return;
    }
    this.hintEl.hidden = false;
    if (d === 'gamepad') setChildren(this.hintEl, k('Ⓑ', true), ' / ', k('Start'), ' resume · ', k('Ⓨ', true), ' restart');
    else setChildren(this.hintEl, k('Esc'), ' / ', k('P'), ' resume · ', k('R'), ' restart · ', k('M'), ' mute');
  }
}
