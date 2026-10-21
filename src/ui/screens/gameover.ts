// Game over: the run's result first (animated count-up, best/rank badge),
// then the board, then instant RETRY. Nothing here blocks input — the
// count-up is decoration and the buttons work from the first frame.

import * as storage from '../../storage';
import type { GameOverInfo } from '../../types';
import { focusEl, h, setChildren } from '../dom';
import { animate, type UIEnv } from '../env';
import { fmtInt, fmtMeters, fmtTime } from '../format';
import { icon, type IconName } from '../icons';
import { buildShareText, shareText } from '../share';

const COUNT_MS = 950;
const BOARD_ROWS = 5;
const GAP = -1;
const UNPLACED = -2;
const STAMP: Keyframe[] = [
  { transform: 'scale(2.2) rotate(-8deg)', opacity: 0 },
  { transform: 'scale(0.9) rotate(2deg)', opacity: 1, offset: 0.6 },
  { transform: 'scale(1) rotate(0)', opacity: 1 },
];

export class GameOverScreen {
  readonly el: HTMLElement;
  readonly retryBtn: HTMLButtonElement;

  private scoreText = document.createTextNode('0');
  private badgeEl: HTMLElement;
  private hintEl: HTMLElement;
  private raf = 0;
  private counting = false;

  constructor(
    private info: GameOverInfo,
    private env: UIEnv,
  ) {
    const s = info.summary;
    const daily = info.daily;

    const eyebrow = daily
      ? `Daily River #${daily.number} · attempt ${Math.max(1, storage.getDailyAttempts(daily.id))}`
      : `Endless river · run #${fmtInt(storage.getStats().runs)}`;

    this.badgeEl = this.buildBadge();
    const scoreBlock = h(
      'div',
      { class: 'over-score', title: 'Tap to skip' },
      h('span', { class: 'over-score-num', 'aria-hidden': 'true' }, this.scoreText),
      h('span', { class: 'over-score-unit', 'aria-hidden': 'true' }, 'pts'),
    );
    scoreBlock.addEventListener('pointerdown', () => this.skip());

    const stat = (iconName: IconName, label: string, value: string) =>
      h(
        'div',
        { class: 'stat' },
        icon(iconName, 'icon stat-icon'),
        h('span', { class: 'stat-value' }, value),
        h('span', { class: 'stat-label' }, label),
      );
    const stats = h(
      'div',
      { class: 'stats stats-4' },
      stat('up', 'Distance', fmtMeters(s.distanceM)),
      stat('sparkle', 'Near-misses', fmtInt(s.nearMisses)),
      stat('bolt', 'Best combo', fmtInt(s.maxCombo)),
      stat('clock', 'Time', fmtTime(s.timeS)),
    );

    this.hintEl = h('span', { class: 'btn-hint', 'aria-hidden': 'true' });
    this.retryBtn = h(
      'button',
      {
        class: 'btn btn-primary btn-lg btn-retry',
        type: 'button',
        'data-sfx': 'none',
        'aria-keyshortcuts': 'R Space',
        onclick: () => env.handlers.onRetry(),
      },
      h('span', { class: 'btn-retry-main' }, icon('restart'), 'Retry'),
      this.hintEl,
    );
    this.refreshDevice();

    const actions = h(
      'div',
      { class: 'over-actions' },
      h('button', { class: 'btn btn-square', type: 'button', onclick: () => void this.share() }, icon('share'), h('span', null, 'Share')),
      this.retryBtn,
      h('button', { class: 'btn btn-square', type: 'button', onclick: () => env.handlers.onMenu() }, icon('home'), h('span', null, 'Menu')),
    );

    this.el = h(
      'section',
      { class: 'screen screen-over scrim', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'over-title' },
      h(
        'div',
        { class: `panel screen-panel over-panel${info.isBest ? ' is-best' : ''}${daily ? ' is-daily' : ''}` },
        h('p', { class: 'eyebrow' }, daily ? icon('calendar', 'icon eyebrow-icon') : null, eyebrow),
        h('h2', { class: 'screen-title over-title', id: 'over-title' }, 'Soaked!'),
        scoreBlock,
        h('div', { class: 'over-badges' }, this.badgeEl, this.buildDelta()),
        stats,
        this.buildBoard(),
        actions,
      ),
    );

    env.announce(this.announcement());
    this.startCountUp();
  }

  focusPrimary(): void {
    focusEl(this.retryBtn);
  }

  /** Any key or tap on the score finishes the count-up immediately. */
  skip(): void {
    if (!this.counting) return;
    cancelAnimationFrame(this.raf);
    this.finishCount();
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.counting = false;
  }

  refreshDevice(): void {
    const d = this.env.device();
    if (d === 'touch') {
      this.hintEl.hidden = true;
      return;
    }
    this.hintEl.hidden = false;
    setChildren(this.hintEl, d === 'gamepad' ? 'Ⓐ · Ⓨ' : 'R · Space · Ⓐ');
  }

  private startCountUp(): void {
    const target = this.info.summary.score;
    if (this.env.reducedMotion() || target <= 0) {
      this.finishCount();
      return;
    }
    this.counting = true;
    this.badgeEl.style.opacity = '0';
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / COUNT_MS);
      const e = 1 - (1 - t) ** 3;
      this.scoreText.data = fmtInt(Math.round(target * e));
      if (t < 1) this.raf = requestAnimationFrame(tick);
      else this.finishCount();
    };
    this.raf = requestAnimationFrame(tick);
  }

  private finishCount(): void {
    const wasCounting = this.counting;
    this.counting = false;
    this.scoreText.data = fmtInt(this.info.summary.score);
    this.badgeEl.style.opacity = '';
    if (wasCounting) animate(this.env, this.badgeEl, STAMP, { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }

  private buildBadge(): HTMLElement {
    const { isBest, rank, prevBest } = this.info;
    if (isBest) return h('span', { class: 'badge badge-best' }, icon('crown'), 'New best!');
    if (rank) return h('span', { class: 'badge badge-rank' }, icon('trophy'), `#${rank} on your board`);
    return h('span', { class: 'badge badge-plain' }, prevBest ? `Best ${fmtInt(prevBest.score)}` : 'Keep going!');
  }

  private buildDelta(): HTMLElement | null {
    const { isBest, prevBest, summary, daily } = this.info;
    if (isBest) {
      if (!prevBest) return h('p', { class: 'over-delta' }, daily ? 'First mark on today’s river' : 'Your first best — now beat it');
      return h('p', { class: 'over-delta is-up' }, `+${fmtInt(summary.score - prevBest.score)} over your old best`);
    }
    if (!prevBest) return null;
    const gap = prevBest.score - summary.score;
    if (gap <= 0) return null;
    const close = gap <= Math.max(25, prevBest.score * 0.1);
    return h('p', { class: `over-delta${close ? ' is-close' : ''}` }, close ? `So close! ${fmtInt(gap)} pts from your best` : `${fmtInt(gap)} pts short of your best`);
  }

  private buildBoard(): HTMLElement {
    const { board, rank, daily, summary } = this.info;
    const mine = rank ? rank - 1 : -1;
    const unplaced = !rank && board.length > 0;
    // Board indices to show; GAP is a "···" row, UNPLACED this run off the board.
    const shown: number[] = [];
    if (mine >= BOARD_ROWS || unplaced) {
      // Keep this run visible: the top few, a gap, then this run.
      for (let i = 0; i < BOARD_ROWS - 2 && i < board.length; i++) shown.push(i);
      shown.push(GAP, unplaced ? UNPLACED : mine);
    } else {
      for (let i = 0; i < Math.min(BOARD_ROWS, board.length); i++) shown.push(i);
    }
    const row = (rankText: string, name: string, distanceM: number, score: number, cls: string, me: boolean) =>
      h(
        'li',
        { class: `mini-row${cls}`, 'aria-current': me ? 'true' : null },
        h('span', { class: 'mini-rank' }, rankText),
        h('span', { class: 'mini-name' }, h('span', { class: 'mini-name-text' }, name), me ? h('span', { class: 'mini-you' }, 'this run') : null),
        h('span', { class: 'mini-dist' }, fmtMeters(distanceM)),
        h('span', { class: 'mini-score' }, fmtInt(score)),
      );
    const list = h(
      'ol',
      { class: 'mini-board' },
      shown.map((i) => {
        if (i === GAP) return h('li', { class: 'mini-row is-gap', 'aria-hidden': 'true' }, '···');
        if (i === UNPLACED) {
          return row('–', storage.getName() || 'You', summary.distanceM, summary.score, ' is-me is-unplaced', true);
        }
        const e = board[i];
        const me = i === mine;
        return row(String(i + 1), e.name, e.distanceM, e.score, `${me ? ' is-me' : ''}${i < 3 ? ` is-top${i + 1}` : ''}`, me);
      }),
    );
    return h(
      'div',
      { class: 'mini-board-wrap' },
      h('h3', { class: 'mini-board-title' }, daily ? 'Today\u2019s board' : 'Your top runs'),
      board.length ? list : h('p', { class: 'empty-note' }, 'No runs on the board yet.'),
    );
  }

  private announcement(): string {
    const { summary, isBest, rank } = this.info;
    let text = `Soaked! Final score ${fmtInt(summary.score)} points, ${fmtMeters(summary.distanceM)}.`;
    if (isBest) text += ' New best!';
    else if (rank) text += ` Number ${rank} on your board.`;
    return text;
  }

  private async share(): Promise<void> {
    const text = buildShareText(this.info.summary, this.info.daily);
    const result = await shareText(text);
    if (result === 'copied') this.env.toast('Copied!', { ms: 1600 });
    else if (result === 'failed') this.env.toast('Couldn’t share — try a screenshot', { ms: 2200 });
  }
}
