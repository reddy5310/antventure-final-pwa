// Badges: every achievement as a card. Locked ones are greyed out and show
// their description as the hint for earning them; unlocked ones show the crumb
// reward and, when there is one, the ant skin they unlocked.

import { skinById } from '../../meta/skins';
import type { AchievementView } from '../../types';
import { h } from '../dom';
import type { UIEnv } from '../env';
import { fmtInt } from '../format';
import { icon } from '../icons';

function card(a: AchievementView): HTMLElement {
  const skin = a.skin ? skinById(a.skin).name : null;
  return h(
    'li',
    { class: `badge-card${a.unlocked ? ' is-unlocked' : ' is-locked'}` },
    h('span', { class: 'badge-medal', 'aria-hidden': 'true' }, icon(a.unlocked ? 'medal' : 'lock')),
    h(
      'span',
      { class: 'badge-card-text' },
      h('span', { class: 'badge-card-name' }, a.name, h('span', { class: 'sr-only' }, a.unlocked ? ' (unlocked)' : ' (locked)')),
      h('span', { class: 'badge-card-desc' }, a.desc),
      a.unlocked
        ? h(
            'span',
            { class: 'badge-card-reward' },
            `+${fmtInt(a.reward)}`,
            icon('crumb', 'icon badge-card-reward-icon'),
            h('span', { class: 'sr-only' }, ' crumbs'),
            skin ? h('span', { class: 'badge-card-skin' }, `${skin} ant unlocked`) : null,
          )
        : h('span', { class: 'badge-card-reward is-hint' }, `Reward +${fmtInt(a.reward)}`, icon('crumb', 'icon badge-card-reward-icon'), h('span', { class: 'sr-only' }, ' crumbs')),
    ),
  );
}

export function buildBadges(env: UIEnv): HTMLElement {
  const list = env.ctx.getAchievements();
  const got = list.filter((a) => a.unlocked).length;
  return h(
    'div',
    { class: 'badges' },
    h('p', { class: 'badges-summary' }, h('b', null, `${got}/${list.length}`), ' badges earned'),
    h('ul', { class: 'badges-grid' }, list.map(card)),
  );
}
