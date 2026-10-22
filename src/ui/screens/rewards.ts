// Game over: what this run earned beyond its score. One total line (crumbs from
// the run plus bonuses), then a row per finished mission, unlocked badge and
// the streak. It only reveals itself after the score count-up (CSS delay), and
// never takes input: Retry stays the first thing you can press.

import { skinById } from '../../meta/skins';
import type { MetaRewards } from '../../types';
import { h } from '../dom';
import { fmtInt, plural } from '../format';
import { icon, type IconName } from '../icons';

const row = (i: number, iconName: IconName, cls: string, title: string, note: string | null, reward: number) =>
  h(
    'li',
    { class: `rw-row ${cls}`, style: `--i:${i}` },
    icon(iconName, 'icon rw-icon'),
    h('span', { class: 'rw-text' }, h('b', null, title), note ? h('span', { class: 'rw-note' }, note) : null),
    reward > 0 ? h('span', { class: 'rw-reward' }, `+${fmtInt(reward)}`, icon('crumb', 'icon rw-reward-icon'), h('span', { class: 'sr-only' }, ' crumbs')) : null,
  );

export function buildRewards(m: MetaRewards): HTMLElement {
  const rows: HTMLElement[] = [];
  for (const d of m.missionsDone) rows.push(row(rows.length, 'check', 'is-mission', 'Mission complete', d.text, d.reward));
  for (const b of m.badgesUnlocked) {
    const skin = b.skin ? `${skinById(b.skin).name} ant unlocked` : null;
    rows.push(row(rows.length, 'medal', 'is-badge', `Badge: ${b.name}`, skin ?? b.desc, b.reward));
  }
  const s = m.streak;
  const note = s.milestoneBonus > 0 ? 'Streak milestone!' : s.extended ? (s.count <= 1 ? 'Streak started' : 'Streak extended') : 'Streak kept';
  rows.push(row(rows.length, 'flame', 'is-streak', `Day ${fmtInt(s.count)}`, note, s.milestoneBonus));

  const total = m.runCrumbs + m.bonus;
  return h(
    'section',
    { class: 'over-rewards', 'aria-label': 'Rewards' },
    h(
      'p',
      { class: 'rw-total' },
      icon('crumb', 'icon rw-total-icon'),
      h('b', { class: 'rw-total-num' }, `+${fmtInt(total)}`),
      h('span', { class: 'rw-total-unit' }, total === 1 ? 'crumb' : 'crumbs'),
      h('span', { class: 'rw-wallet' }, `Wallet ${fmtInt(m.wallet)}`),
    ),
    h('ul', { class: 'rw-list' }, rows),
  );
}

/** For screen readers: the same news in one sentence. */
export function rewardsAnnouncement(m: MetaRewards): string {
  let text = ` ${plural(m.runCrumbs + m.bonus, 'crumb')} earned.`;
  for (const d of m.missionsDone) text += ` Mission complete: ${d.text}.`;
  for (const b of m.badgesUnlocked) text += ` Badge unlocked: ${b.name}.`;
  text += ` Streak: day ${m.streak.count}.`;
  return text;
}
