// How to play: one illustrated card per rule, steering shown for the device
// in use (with the others listed), plus the hotkeys.

import { COMBO_CAP, COMBO_STEP } from '../../game/tuning';
import type { Device } from '../../types';
import { illustration, type Illustration } from '../art';
import { h } from '../dom';
import type { UIEnv } from '../env';
import { icon, type IconName } from '../icons';

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
    text: 'A dark circle appears where a drop will land and grows until it hits. Be outside it at impact.',
  },
  {
    ill: 'near-miss',
    title: 'Near-misses build combos',
    text: `Dodge by a hair for bonus points. Each one grows your combo and multiplier (up to ×${MAX_MULT}) — keep chaining before it fades.`,
  },
  {
    ill: 'obstacles',
    title: 'Rocks and twigs hurt',
    text: 'Hitting a rock or twig costs a heart. Banks are soft: bump them freely.',
  },
  {
    ill: 'hearts',
    title: 'Three hearts',
    text: 'After a hit you blink for a moment and can’t be hurt. Lose all three and you’re soaked.',
  },
  {
    ill: 'daily',
    title: 'Daily River',
    text: 'Everyone gets the same river today. Retry as often as you like, then share your best.',
  },
];

const HOTKEYS: [string[], string][] = [
  [['Space', 'Enter'], 'Play / retry'],
  [['Esc'], 'Pause / back'],
  [['P'], 'Pause / resume'],
  [['R'], 'Restart run'],
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

  const rules = RULES.map((r) =>
    h(
      'section',
      { class: 'help-card help-rule' },
      illustration(r.ill),
      h('div', { class: 'help-rule-text' }, h('h3', { class: 'help-title' }, r.title), h('p', { class: 'help-text' }, r.text)),
    ),
  );

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
