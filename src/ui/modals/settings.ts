// Settings dialog. Every change is applied immediately through
// handlers.onSettings (live volume preview, no "save" step); sync() mirrors
// changes made elsewhere (the M mute hotkey) while the dialog is open.

import * as storage from '../../storage';
import type { Settings } from '../../types';
import { h, uniqueId } from '../dom';
import type { UIEnv } from '../env';
import { icon, type IconName } from '../icons';

type RangeKey = 'music' | 'sfx' | 'sensitivity';
type ToggleKey = 'muted' | 'haptics' | 'reducedMotion' | 'showFps';

interface RangeSpec {
  key: RangeKey;
  label: string;
  iconName: IconName;
  min: number;
  max: number;
  step: number;
  /** Slider units ↔ settings value. */
  toValue(v: number): number;
  fromValue(v: number): number;
  format(v: number): string;
}

const RANGES: RangeSpec[] = [
  {
    key: 'music',
    label: 'Music',
    iconName: 'soundOn',
    min: 0,
    max: 100,
    step: 1,
    toValue: (v) => v / 100,
    fromValue: (v) => Math.round(v * 100),
    format: (v) => `${Math.round(v * 100)}%`,
  },
  {
    key: 'sfx',
    label: 'Sound effects',
    iconName: 'drop',
    min: 0,
    max: 100,
    step: 1,
    toValue: (v) => v / 100,
    fromValue: (v) => Math.round(v * 100),
    format: (v) => `${Math.round(v * 100)}%`,
  },
  {
    key: 'sensitivity',
    label: 'Touch sensitivity',
    iconName: 'touch',
    min: 50,
    max: 200,
    step: 5,
    toValue: (v) => v / 100,
    fromValue: (v) => Math.round(v * 100),
    format: (v) => `${v.toFixed(2)}×`,
  },
];

const TOGGLES: { key: ToggleKey; label: string; sub?: string }[] = [
  { key: 'muted', label: 'Mute all sound', sub: 'Hotkey: M' },
  { key: 'haptics', label: 'Vibration', sub: 'Buzz on hits and near-misses' },
  { key: 'reducedMotion', label: 'Reduced motion', sub: 'Calmer effects and menus' },
  { key: 'showFps', label: 'Show FPS', sub: 'Frame-rate counter in the HUD' },
];

export interface SettingsModal {
  body: HTMLElement;
  sync(s: Settings): void;
}

export function buildSettings(env: UIEnv): SettingsModal {
  const s0 = env.ctx.getSettings();
  const ranges = new Map<RangeKey, { input: HTMLInputElement; out: HTMLOutputElement; spec: RangeSpec }>();
  const toggles = new Map<ToggleKey, HTMLInputElement>();

  const apply = (patch: Partial<Settings>) => env.handlers.onSettings({ ...env.ctx.getSettings(), ...patch });

  const paintRange = (input: HTMLInputElement, spec: RangeSpec) => {
    const pct = ((Number(input.value) - spec.min) / (spec.max - spec.min)) * 100;
    input.style.setProperty('--fill', `${pct}%`);
  };

  const rangeField = (spec: RangeSpec) => {
    const id = uniqueId(`set-${spec.key}`);
    const value = s0[spec.key];
    const input = h('input', {
      id,
      class: 'range',
      type: 'range',
      min: spec.min,
      max: spec.max,
      step: spec.step,
      value: spec.fromValue(value),
      'aria-valuetext': spec.format(value),
    });
    const out = h('output', { class: 'field-value', for: id }, spec.format(value));
    input.addEventListener('input', () => {
      const v = spec.toValue(Number(input.value));
      out.textContent = spec.format(v);
      input.setAttribute('aria-valuetext', spec.format(v));
      paintRange(input, spec);
      apply({ [spec.key]: v } as Partial<Settings>);
    });
    // Let the player hear the new effects level when they let go.
    if (spec.key === 'sfx') input.addEventListener('change', () => env.handlers.onSfx('near-miss'));
    paintRange(input, spec);
    ranges.set(spec.key, { input, out, spec });
    return h(
      'div',
      { class: 'field field-range' },
      h('label', { class: 'field-label', for: id }, icon(spec.iconName, 'icon field-icon'), spec.label),
      out,
      input,
    );
  };

  const toggleField = (t: (typeof TOGGLES)[number]) => {
    const id = uniqueId(`set-${t.key}`);
    const input = h('input', { id, class: 'switch', type: 'checkbox', role: 'switch' });
    input.checked = s0[t.key];
    input.addEventListener('change', () => {
      env.handlers.onSfx('tap');
      apply({ [t.key]: input.checked } as Partial<Settings>);
    });
    toggles.set(t.key, input);
    const canVibrate = t.key !== 'haptics' || typeof navigator.vibrate === 'function';
    if (!canVibrate) input.disabled = true;
    return h(
      'label',
      { class: `field field-switch${canVibrate ? '' : ' is-disabled'}`, for: id },
      h(
        'span',
        { class: 'field-text' },
        h('span', { class: 'field-label' }, t.label),
        h('span', { class: 'field-sub' }, canVibrate ? (t.sub ?? '') : 'Not supported on this device'),
      ),
      input,
    );
  };

  const replay = h(
    'button',
    {
      class: 'btn btn-secondary btn-block',
      type: 'button',
      onclick: () => {
        storage.setFlag('tutorialSeen', false);
        replay.disabled = true;
        replay.lastChild!.textContent = 'Tutorial will play next run';
        env.toast('The tutorial will play on your next run', { ms: 2000 });
      },
    },
    icon('help'),
    h('span', null, 'Replay tutorial'),
  );

  const body = h(
    'div',
    { class: 'settings' },
    h('h3', { class: 'section-title' }, 'Audio'),
    rangeField(RANGES[0]),
    rangeField(RANGES[1]),
    toggleField(TOGGLES[0]),
    h('h3', { class: 'section-title' }, 'Controls & feel'),
    rangeField(RANGES[2]),
    toggleField(TOGGLES[1]),
    toggleField(TOGGLES[2]),
    toggleField(TOGGLES[3]),
    h('h3', { class: 'section-title' }, 'Help'),
    replay,
  );

  return {
    body,
    sync(s: Settings) {
      for (const [key, r] of ranges) {
        const v = String(r.spec.fromValue(s[key]));
        if (r.input.value !== v) {
          r.input.value = v;
          r.out.textContent = r.spec.format(s[key]);
          r.input.setAttribute('aria-valuetext', r.spec.format(s[key]));
          paintRange(r.input, r.spec);
        }
      }
      for (const [key, input] of toggles) {
        if (input.checked !== s[key]) input.checked = s[key];
      }
    },
  };
}
