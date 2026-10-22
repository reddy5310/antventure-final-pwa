// Title screen: wordmark, PLAY (endless) with the best to beat, the Daily
// River card, the player name chip and the utility icons. Laid out so the live
// river and the hero leaf stay visible behind it (see .title-leaf-gap in CSS).

import { NAME_MAX } from '../../storage';
import type { Settings, TitleInfo } from '../../types';
import { brandMark } from '../art';
import { focusEl, h, setChildren } from '../dom';
import type { UIEnv } from '../env';
import { fmtDistance, fmtInt, fmtMeters, plural } from '../format';
import { icon } from '../icons';

/**
 * The input limit is in UTF-16 units; storage trims to NAME_MAX graphemes. A
 * looser input limit keeps names in scripts with combining marks (e.g.
 * Telugu, Devanagari) from being cut short mid-syllable while typing.
 */
const NAME_INPUT_MAX = NAME_MAX * 3;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A little calendar page with today's date (the river number is in the title). */
function dailyBadge(id: string): HTMLElement {
  const [, m, d] = id.split('-').map(Number);
  return h(
    'span',
    { class: 'daily-badge', 'aria-hidden': 'true' },
    h('span', { class: 'daily-month' }, MONTHS[(m - 1 + 12) % 12] ?? ''),
    h('span', { class: 'daily-day' }, String(d || '')),
  );
}

export class TitleScreen {
  readonly el: HTMLElement;
  readonly playBtn: HTMLButtonElement;
  editing = false;

  private soundBtn: HTMLButtonElement;
  private installBtn: HTMLButtonElement;
  private hintEl: HTMLElement;
  private nameSlot: HTMLElement;
  private onInstall: () => void = () => {};

  constructor(
    private info: TitleInfo,
    private env: UIEnv,
    install: { available: boolean; onInstall: () => void },
  ) {
    const s = env.ctx.getSettings();
    this.soundBtn = h(
      'button',
      {
        class: 'btn-icon',
        type: 'button',
        'aria-label': 'Sound',
        title: 'Sound on/off (M)',
        'aria-pressed': String(!s.muted),
        onclick: () => env.handlers.onToggleMute(),
      },
      icon(s.muted ? 'soundOff' : 'soundOn'),
    );
    this.installBtn = h(
      'button',
      {
        class: 'btn-icon btn-install',
        type: 'button',
        'aria-label': 'Install app',
        title: 'Install Antventure',
        hidden: true,
        onclick: () => this.onInstall(),
      },
      icon('install'),
    );
    this.setInstall(install.available, install.onInstall);

    const top = h(
      'div',
      { class: 'title-top' },
      h('div', { class: 'title-top-group' }, this.soundBtn, this.installBtn),
      h(
        'div',
        { class: 'title-top-group' },
        h('button', { class: 'btn-icon', type: 'button', 'aria-label': 'Leaderboard', title: 'Leaderboard', onclick: () => env.openLeaderboard() }, icon('trophy')),
        h('button', { class: 'btn-icon', type: 'button', 'aria-label': 'How to play', title: 'How to play', onclick: () => env.openHelp() }, icon('help')),
        h('button', { class: 'btn-icon', type: 'button', 'aria-label': 'Settings', title: 'Settings', onclick: () => env.openSettings() }, icon('settings')),
      ),
    );

    const wordmark = h(
      'header',
      { class: 'wordmark' },
      brandMark(),
      h('h1', { class: 'wordmark-title' }, h('span', { class: 'wm-ant' }, 'ANT'), h('span', { class: 'wm-venture' }, 'VENTURE')),
      h('p', { class: 'wordmark-sub' }, 'Leaf of Fate'),
    );

    this.nameSlot = h('div', { class: 'name-slot' });
    this.renderNameChip();

    const best = info.endlessBest;
    this.playBtn = h(
      'button',
      { class: 'btn btn-primary btn-play', type: 'button', 'data-sfx': 'none', onclick: () => env.handlers.onPlay('endless') },
      h('span', { class: 'btn-play-icon' }, icon('play')),
      h(
        'span',
        { class: 'btn-play-text' },
        h('span', { class: 'btn-play-label' }, 'Play'),
        h('span', { class: 'btn-play-sub' }, best ? `Best ${fmtInt(best.score)} · ${fmtMeters(best.distanceM)}` : 'Endless river'),
      ),
    );

    const daily = info.daily;
    const dailyTitle = `Daily River #${daily.number}`;
    const dailySide = daily.attempts
      ? h(
          'span',
          { class: 'daily-side' },
          h('span', { class: 'daily-best' }, daily.best ? fmtInt(daily.best.score) : '—'),
          h('span', { class: 'daily-tries' }, plural(daily.attempts, 'attempt')),
        )
      : h('span', { class: 'daily-side' }, h('span', { class: 'daily-new' }, 'New'));
    const dailyBtn = h(
      'button',
      { class: 'daily-card', type: 'button', 'data-sfx': 'none', onclick: () => env.handlers.onPlay('daily') },
      dailyBadge(daily.id),
      h(
        'span',
        { class: 'daily-main' },
        h('span', { class: 'daily-title' }, dailyTitle),
        h('span', { class: 'daily-sub' }, 'Same river for everyone today'),
      ),
      dailySide,
    );

    this.hintEl = h('p', { class: 'title-hint' });
    this.refreshDevice();

    const st = info.stats;
    const statsLine = st.runs
      ? `${plural(st.runs, 'run')} · ${fmtDistance(st.totalDistanceM)} · ${plural(st.totalNearMisses, 'near-miss', 'near-misses')}`
      : 'Dodge the rain. Chain near-misses. Beat your best.';

    this.el = h(
      'section',
      { class: 'screen screen-home', 'aria-label': 'Antventure: Leaf of Fate' },
      top,
      h(
        'div',
        { class: 'title-upper' },
        h('div', { class: 'title-head' }, wordmark, this.nameSlot),
        h('div', { class: 'title-actions' }, this.playBtn, dailyBtn),
      ),
      h('div', { class: 'title-leaf-gap', 'aria-hidden': 'true' }),
      h('footer', { class: 'title-foot' }, this.hintEl, h('p', { class: 'title-stats' }, statsLine)),
    );
  }

  focusPrimary(): void {
    focusEl(this.playBtn);
  }

  refreshDevice(): void {
    const d = this.env.device();
    if (d === 'touch') {
      setChildren(this.hintEl);
      this.hintEl.hidden = true;
      return;
    }
    this.hintEl.hidden = false;
    if (d === 'gamepad') setChildren(this.hintEl, 'Press ', h('kbd', { class: 'kbd kbd-pad' }, 'Ⓐ'), ' to play');
    else setChildren(this.hintEl, 'Press ', h('kbd', { class: 'kbd' }, 'Space'), ' to play');
  }

  syncSettings(s: Settings): void {
    this.soundBtn.setAttribute('aria-pressed', String(!s.muted));
    this.soundBtn.replaceChildren(icon(s.muted ? 'soundOff' : 'soundOn'));
  }

  setInstall(available: boolean, onInstall: () => void): void {
    this.onInstall = onInstall;
    this.installBtn.hidden = !available;
  }

  /** Esc while renaming: discard the edit. */
  cancelEdit(): boolean {
    if (!this.editing) return false;
    this.editing = false;
    this.renderNameChip(true);
    return true;
  }

  private renderNameChip(focus = false): void {
    const name = this.info.name;
    const chip = h(
      'button',
      {
        class: 'name-chip',
        type: 'button',
        'aria-label': name ? `Player name: ${name}. Edit` : 'Set your player name',
        onclick: () => this.startEdit(),
      },
      name ? ['Playing as ', h('b', null, name)] : 'Set your name',
      icon('edit', 'icon name-chip-icon'),
    );
    setChildren(this.nameSlot, chip);
    if (focus) focusEl(chip);
  }

  private startEdit(): void {
    this.editing = true;
    const input = h('input', {
      class: 'name-input',
      type: 'text',
      value: this.info.name,
      maxlength: NAME_INPUT_MAX,
      placeholder: 'Your name',
      'aria-label': 'Player name',
      autocomplete: 'nickname',
      autocapitalize: 'words',
      spellcheck: 'false',
      enterkeyhint: 'done',
    });
    const save = h('button', { class: 'btn-icon btn-save', type: 'submit', 'aria-label': 'Save name' }, icon('check'));
    const form = h('form', { class: 'name-form' }, input, save);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.commit(input.value);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.cancelEdit();
      }
    });
    // Tapping elsewhere saves (mobile keyboards have no obvious "save").
    form.addEventListener('focusout', (e) => {
      if (form.contains(e.relatedTarget as Node | null)) return;
      if (this.editing) this.commit(input.value, false);
    });
    setChildren(this.nameSlot, form);
    focusEl(input);
    input.select();
  }

  private commit(value: string, focus = true): void {
    if (!this.editing) return;
    this.editing = false;
    const prev = this.info.name;
    const saved = this.env.handlers.onName(value);
    this.info = { ...this.info, name: saved };
    this.renderNameChip(focus);
    if (saved !== prev) this.env.toast(saved ? `Playing as ${saved}` : 'Name cleared', { ms: 1600 });
  }
}
