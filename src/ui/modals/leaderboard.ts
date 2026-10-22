// Local leaderboards: Endless and today's Daily River, as tabs. Rows are a
// two-line list rather than a 6-column table so they fit a 360px phone.

import { dailyInfo } from '../../engine/rng';
import * as storage from '../../storage';
import type { Mode, ScoreEntry } from '../../types';
import { illustration } from '../art';
import { focusEl, h, setChildren, uniqueId } from '../dom';
import type { UIEnv } from '../env';
import { fmtInt, fmtMeters, fmtRelDate, plural } from '../format';
import { icon } from '../icons';

export interface LeaderboardModal {
  body: HTMLElement;
  initialFocus: HTMLElement;
}

function row(e: ScoreEntry, i: number): HTMLElement {
  const meta = [fmtMeters(e.distanceM)];
  // "chain", not "×N combo": × is the score multiplier everywhere else (max ×5).
  if (e.maxCombo > 1) meta.push(`${fmtInt(e.maxCombo)} chain`);
  // Only older runs need a date; it is what overflowed on 360 px phones.
  const when = fmtRelDate(e.date);
  if (when && when !== 'Today') meta.push(when);
  return h(
    'li',
    { class: `lb-row${i < 3 ? ` is-top${i + 1}` : ''}` },
    h('span', { class: 'lb-rank', 'aria-label': `Rank ${i + 1}` }, String(i + 1)),
    h('span', { class: 'lb-main' }, h('span', { class: 'lb-name' }, e.name), h('span', { class: 'lb-meta' }, meta.join(' · '))),
    h('span', { class: 'lb-score' }, fmtInt(e.score), h('span', { class: 'lb-unit' }, ' pts')),
  );
}

/**
 * @param onPlay present when a run can be started from here (title screen):
 *   empty boards then offer a "play" call to action.
 */
export function buildLeaderboard(env: UIEnv, initial: Mode, onPlay: ((mode: Mode) => void) | null): LeaderboardModal {
  const daily = dailyInfo();
  const tabs: Record<Mode, HTMLButtonElement> = {} as Record<Mode, HTMLButtonElement>;
  const panelId = uniqueId('lb-panel');
  const panel = h('div', { class: 'lb-panel', role: 'tabpanel', id: panelId, tabindex: '0' });
  let current: Mode = initial;

  const render = () => {
    const board = storage.getBoard(current, current === 'daily' ? daily.id : null);
    const header =
      current === 'daily'
        ? h(
            'p',
            { class: 'lb-sub' },
            icon('calendar', 'icon lb-sub-icon'),
            `Daily River #${daily.number} · ${plural(storage.getDailyAttempts(daily.id), 'attempt')} · resets at midnight`,
          )
        : h('p', { class: 'lb-sub' }, icon('trophy', 'icon lb-sub-icon'), 'Your 10 best endless runs on this device');
    if (!board.length) {
      const cta = onPlay
        ? h(
            'button',
            { class: 'btn btn-primary', type: 'button', 'data-sfx': 'none', onclick: () => onPlay(current) },
            icon('play'),
            current === 'daily' ? 'Play today’s river' : 'Play endless',
          )
        : null;
      setChildren(
        panel,
        header,
        h(
          'div',
          { class: 'empty' },
          illustration(current === 'daily' ? 'daily' : 'near-miss'),
          h('p', { class: 'empty-title' }, current === 'daily' ? 'No attempts today' : 'No runs yet'),
          h('p', { class: 'empty-note' }, current === 'daily' ? 'Everyone gets the same river today. Set the mark to beat.' : 'Your best runs land here. Go set one!'),
          cta,
        ),
      );
      return;
    }
    setChildren(panel, header, h('ol', { class: 'lb-list' }, board.map(row)));
  };

  const select = (mode: Mode, focus: boolean) => {
    current = mode;
    for (const m of ['endless', 'daily'] as Mode[]) {
      const on = m === mode;
      tabs[m].setAttribute('aria-selected', String(on));
      tabs[m].tabIndex = on ? 0 : -1;
    }
    render();
    if (focus) focusEl(tabs[mode]);
  };

  const tab = (mode: Mode, label: string) =>
    (tabs[mode] = h(
      'button',
      { class: 'tab', type: 'button', role: 'tab', 'aria-controls': panelId, onclick: () => select(mode, false) },
      label,
    ));

  const list = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Leaderboards' }, tab('endless', 'Endless'), tab('daily', 'Today’s Daily'));
  list.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    e.stopPropagation();
    const next: Mode = e.key === 'Home' ? 'endless' : e.key === 'End' ? 'daily' : current === 'endless' ? 'daily' : 'endless';
    env.handlers.onSfx('tap');
    select(next, true);
  });

  select(initial, false);
  return { body: h('div', { class: 'leaderboard' }, list, panel), initialFocus: tabs[initial] };
}
