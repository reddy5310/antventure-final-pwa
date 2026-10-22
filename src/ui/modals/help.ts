// How to play: one illustrated card per rule, steering shown for the device
// in use (with the others listed), plus the hotkeys.

import { CRUMB_COMBO_BONUS, CRUMB_POINTS, TRAIL_BONUS } from '../../game/pickups';
import { COMBO_CAP, COMBO_STEP, COMBO_TIME } from '../../game/tuning';
import type { Device } from '../../types';
import { illustration, type Illustration } from '../art';
import { h } from '../dom';
import type { UIEnv } from '../env';
import { icon, type IconName } from '../icons';
import { PICKUP_INFO, POWER_ORDER, ZONE_INFO, ZONE_ORDER } from '../pickupinfo';

const DEVICES: { device: Device; iconName: IconName; label: string; how: string }[] = [
  { device: 'touch', iconName: 'touch', label: 'Touch', how: 'Drag anywhere — your thumb never covers the ant' },
  { device: 'mouse', iconName: 'mouse', label: 'Mouse', how: 'The leaf follows your cursor left and right' },
  { device: 'keyboard', iconName: 'keyboard', label: 'Keyboard', how: '← → or A / D' },
  { device: 'gamepad', iconName: 'gamepad', label: 'Gamepad', how: 'Left stick or d-pad' },
];

/** Highest multiplier, straight from the scoring tuning so the help text can't drift from it. */
const MAX_MULT = 1 + COMBO_STEP * COMBO_CAP;

const RULES: { ill: Illustration; title: string; text: string }[] = [
  {
    ill: 'shadows',
    title: 'Shadows mark the rain',
    text: 'A shadow marks where a drop will land. When the ring closes onto it: splash! Only your ant counts — splashes on the leaf are free. A gold ring means you are inside it: move!',
  },
  {
    ill: 'near-miss',
    title: 'Near-misses build your chain',
    text: `Let a splash land close to the ant for bonus points. Each one grows your chain and multiplier (up to ×${MAX_MULT}); graze again within ${COMBO_TIME} s to keep it going.`,
  },
  {
    ill: 'obstacles',
    title: 'Rocks and twigs hurt',
    text: 'These hit the whole leaf: bumping one costs a heart. Twigs drift, rocks don’t. Banks are soft: bump them freely.',
  },
  {
    ill: 'hearts',
    title: 'Three hearts',
    text: 'After a hit you blink for a moment and can’t be hurt. Lose all three and you’re soaked.',
  },
];

const CRUMB_RULE: { ill: Illustration; title: string; text: string } = {
  ill: 'crumbs',
  title: 'Follow the crumb trails',
  text: `Each crumb pays +${CRUMB_POINTS} (times your multiplier) and adds ${CRUMB_COMBO_BONUS} s to a running chain. Take a whole trail for a +${TRAIL_BONUS} Perfect trail bonus. Optional, but trails love to lead you somewhere risky.`,
};

const DAILY_RULE: { ill: Illustration; title: string; text: string } = {
  ill: 'daily',
  title: 'Daily River',
  text: 'Everyone gets the same river today. Retry as often as you like, then share your best.',
};

const HOTKEYS: [string[], string][] = [
  [['Space', 'Enter'], 'Play / retry'],
  [['Esc'], 'Pause / back'],
  [['P'], 'Pause / resume'],
  [['R'], 'Restart (twice once a run is going)'],
  [['M'], 'Mute'],
];

const PAD_BUTTONS: [string[], string][] = [
  [['Ⓐ'], 'Play / select'],
  [['Ⓑ'], 'Back'],
  [['Start'], 'Pause / play'],
  [['Ⓨ'], 'Restart run'],
  [['Select'], 'Mute'],
];

export function buildHelp(env: UIEnv, close: () => void): { body: HTMLElement; footer: HTMLElement } {
  const current = env.device();
  const steer = h(
    'section',
    { class: 'help-card help-steer' },
    h('h3', { class: 'help-title' }, icon('steer', 'icon help-title-icon'), 'Steer the leaf'),
    h(
      'ul',
      { class: 'device-list' },
      DEVICES.map((d) =>
        h(
          'li',
          { class: `device${d.device === current ? ' is-current' : ''}` },
          h('span', { class: 'device-icon' }, icon(d.iconName)),
          h('span', { class: 'device-text' }, h('span', { class: 'device-label' }, d.label, d.device === current ? h('span', { class: 'device-you' }, 'you') : null), h('span', { class: 'device-how' }, d.how)),
        ),
      ),
    ),
  );

  const ruleCard = (r: { ill: Illustration; title: string; text: string }) =>
    h(
      'section',
      { class: 'help-card help-rule' },
      illustration(r.ill),
      h('div', { class: 'help-rule-text' }, h('h3', { class: 'help-title' }, r.title), h('p', { class: 'help-text' }, r.text)),
    );

  // Power-ups and zones are short lists: an icon badge, a name and one line each.
  const powerups = h(
    'section',
    { class: 'help-card help-list-card' },
    h('h3', { class: 'help-title' }, icon('sparkle', 'icon help-title-icon'), 'Power-up bubbles'),
    h('p', { class: 'help-text' }, 'Rare bubbles drift down the river. Touch one to use it; none are ever required.'),
    h(
      'ul',
      { class: 'help-list' },
      POWER_ORDER.map((k) =>
        h(
          'li',
          { class: 'help-item' },
          h('span', { class: 'help-badge', 'data-kind': k }, icon(PICKUP_INFO[k].icon)),
          h('span', { class: 'help-item-text' }, h('span', { class: 'help-item-name' }, PICKUP_INFO[k].name), h('span', { class: 'help-item-how' }, PICKUP_INFO[k].help)),
        ),
      ),
    ),
  );

  const zones = h(
    'section',
    { class: 'help-card help-list-card' },
    h('h3', { class: 'help-title' }, icon('zoneRapids', 'icon help-title-icon'), 'River zones'),
    h('p', { class: 'help-text' }, 'The river changes as you go: expect a new zone roughly every minute.'),
    h(
      'ul',
      { class: 'help-list' },
      ZONE_ORDER.map((z) =>
        h(
          'li',
          { class: 'help-item' },
          h('span', { class: 'help-badge', 'data-zone': z }, icon(ZONE_INFO[z].icon)),
          h('span', { class: 'help-item-text' }, h('span', { class: 'help-item-name' }, ZONE_INFO[z].name), h('span', { class: 'help-item-how' }, ZONE_INFO[z].rule)),
        ),
      ),
    ),
  );

  const rules = [...RULES.map(ruleCard), ruleCard(CRUMB_RULE), powerups, zones, ruleCard(DAILY_RULE)];

  const keys =
    current === 'touch'
      ? null
      : h(
          'section',
          { class: 'help-card help-keys' },
          h('h3', { class: 'help-title' }, icon(current === 'gamepad' ? 'gamepad' : 'keyboard', 'icon help-title-icon'), current === 'gamepad' ? 'Buttons' : 'Hotkeys'),
          h(
            'dl',
            { class: 'hotkeys' },
            (current === 'gamepad' ? PAD_BUTTONS : HOTKEYS).map(([ks, what]) => [
              h('dt', null, ks.map((k, i) => [i ? ' / ' : '', h('kbd', { class: 'kbd' }, k)])),
              h('dd', null, what),
            ]),
          ),
        );

  const footer = h(
    'button',
    { class: 'btn btn-primary btn-block', type: 'button', 'data-sfx': 'none', onclick: close },
    icon('check'),
    'Got it',
  );

  return { body: h('div', { class: 'help' }, steer, rules, keys), footer };
}
