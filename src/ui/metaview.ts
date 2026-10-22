// Phase 3 building blocks shared by the title, the shop and game over: the
// wallet and streak chips and one mission row. Pure DOM builders (no state), so
// a screen simply rebuilds them when the numbers change.

import type { MissionView, StreakInfo } from '../types';
import { h } from './dom';
import { fmtInt, plural } from './format';
import { icon } from './icons';

/** Crumb icon + wallet balance. The unit is for screen readers only: the icon says it visually. */
export function walletChip(n: number): HTMLElement {
  return h(
    'span',
    { class: 'meta-chip is-wallet', title: 'Your crumbs' },
    icon('crumb', 'icon meta-chip-icon'),
    h('b', { class: 'meta-chip-num' }, fmtInt(n)),
    h('span', { class: 'sr-only' }, n === 1 ? ' crumb' : ' crumbs'),
  );
}

/** Flame + day count; dim until a run has been finished today (the streak is still alive, just not yet kept). */
export function streakChip(s: StreakInfo): HTMLElement {
  const idle = !s.playedToday;
  const note = s.count <= 0 ? 'Finish a run to start a streak' : idle ? `${plural(s.count, 'day')} streak. Finish a run today to keep it` : `${plural(s.count, 'day')} streak`;
  return h(
    'span',
    { class: `meta-chip is-streak${idle ? ' is-idle' : ''}`, title: note },
    icon('flame', 'icon meta-chip-icon'),
    h('b', { class: 'meta-chip-num' }, fmtInt(s.count)),
    h('span', { class: 'sr-only' }, ` ${note}`),
  );
}

/**
 * One mission: the row itself is the progress bar (a fill behind the text), so
 * three of them stay three lines tall. A done row gets a tick instead of the
 * count and a full bar.
 */
export function missionRow(m: MissionView): HTMLElement {
  const pct = m.target > 0 ? Math.min(100, Math.round((Math.min(m.progress, m.target) / m.target) * 100)) : 0;
  const shown = Math.min(m.progress, m.target);
  return h(
    'li',
    { class: `mission mission-${m.tier}${m.done ? ' is-done' : ''}` },
    h('span', { class: 'mission-fill', 'aria-hidden': 'true', style: `width:${m.done ? 100 : pct}%` }),
    h('span', { class: 'mission-check', 'aria-hidden': 'true' }, m.done ? icon('check', 'icon mission-check-icon') : null),
    h('span', { class: 'mission-text' }, m.done ? h('span', { class: 'sr-only' }, 'Done: ') : null, m.text),
    m.done
      ? null
      : [
          h('span', { class: 'mission-count', 'aria-hidden': 'true' }, `${fmtInt(shown)}/${fmtInt(m.target)}`),
          h('span', { class: 'sr-only' }, `, ${fmtInt(shown)} of ${fmtInt(m.target)}`),
        ],
    h('span', { class: 'mission-reward' }, `+${fmtInt(m.reward)}`, icon('crumb', 'icon mission-reward-icon'), h('span', { class: 'sr-only' }, ' crumbs')),
  );
}
