// Game over: the run's result first (animated count-up, best/rank badge),
// then the board, then instant RETRY. Nothing here blocks input — the
// count-up is decoration and the buttons work from the first frame.

import { COMBO_TIME } from '../../game/tuning';
import * as storage from '../../storage';
import type { GameOverInfo, HitSource, RunSummary } from '../../types';
import { focusEl, h, setChildren } from '../dom';
import { animate, type UIEnv } from '../env';
import { fmtInt, fmtMeters, fmtTime, plural } from '../format';
import { icon, type IconName } from '../icons';
import { canShareFiles, prepareShareCard, shareRun, type ShareContext } from '../share';

const COUNT_MS = 950;
/** Draw the share card once the count-up is over, so it never costs a dropped frame there. */
const CARD_DELAY_MS = 1200;
const BOARD_ROWS = 5;
/** Local boards keep this many runs; a rank only means something once it is full (or podium). */
const BOARD_SIZE = 10;

const TITLES: Record<HitSource, string> = {
  drop: 'Soaked!',
  rock: 'Bonked by a rock!',
  twig: 'Snagged by a twig!',
};

/** A trail pays off from this many crumbs: below it the run barely touched them. */
const FEW_CRUMBS = 8;
/** Runs shorter than this have not seen a trail often enough to judge their crumb habits. */
const CRUMB_TIP_AFTER_S = 25;

/** One line that teaches something, keyed to how this run went. */
export function tipFor(s: RunSummary): string {
  // A long run that never touched a crumb is leaving easy points (and chain time) on the water.
  if (s.crumbs === 0 && s.timeS >= CRUMB_TIP_AFTER_S) {
    return 'Crumb trails pay +10 each and add time to your chain. Steer through them!';
  }
  // What ended the run is the most useful thing to learn from...
  if (s.killedBy === 'rock') return 'Rocks never move: line up a gap early and slide through.';
  if (s.killedBy === 'twig') return 'Twigs drift and spin: give them a leaf’s width of room.';
  // ...then how the rain is read, then how it is scored.
  if (s.timeS < 20 && s.nearMisses < 3) return 'Watch the shadows: when the ring closes on one, it splashes. Be outside it.';
  if (s.nearMisses >= 6 && s.maxCombo < 6) {
    return `Chain near-misses within ${COMBO_TIME} s of each other to stack the multiplier up to ×5.`;
  }
  // Pickups: bubbles are worth a detour when they are on the way.
  if (s.crumbs > 0 && s.crumbs < FEW_CRUMBS && s.timeS >= CRUMB_TIP_AFTER_S) {
    return 'Take every crumb in a trail for a Perfect trail bonus. Mushroom bubbles block a hit.';
  }
  return s.nearMisses < 5
    ? 'Only the ant counts. A gold ring means you are inside the splash: move!'
    : 'Graze splashes on purpose: each near-miss pays more at a higher multiplier.';
}
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
  private card: File | null = null;
  private cardTimer = 0;

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
      stat('bolt', 'Best chain', fmtInt(s.maxCombo)),
      stat('clock', 'Time', fmtTime(s.timeS)),
    );

    // Phase 2: what the run collected and how far down the river it got.
    const lifetime = storage.getStats().totalCrumbs;
    const extra = (iconName: IconName, cls: string, value: string, label: string) =>
      h(
        'div',
        { class: `over-extra ${cls}` },
        icon(iconName, 'icon over-extra-icon'),
        h('span', { class: 'over-extra-text' }, h('span', { class: 'over-extra-value' }, value), h('span', { class: 'over-extra-label' }, label)),
      );
    const extras = h(
      'div',
      { class: 'over-extras' },
      extra('crumb', 'is-crumbs', plural(s.crumbs, 'crumb'), lifetime > s.crumbs ? `${fmtInt(lifetime)} all-time` : 'collected'),
      extra('zoneRapids', 'is-zones', plural(Math.max(1, s.zonesReached), 'zone'), 'reached'),
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
        h('h2', { class: `screen-title over-title${this.title().length > 10 ? ' is-long' : ''}`, id: 'over-title' }, this.title()),
        scoreBlock,
        h('div', { class: 'over-badges' }, this.badgeEl, this.buildDelta()),
        stats,
        extras,
        h('p', { class: 'over-tip' }, icon('sparkle', 'icon over-tip-icon'), h('span', null, tipFor(s))),
        this.buildBoard(),
        actions,
      ),
    );

    env.announce(this.announcement());
    this.startCountUp();
    if (canShareFiles()) {
      this.cardTimer = window.setTimeout(() => {
        void prepareShareCard(info.summary, info.daily, this.shareContext()).then((f) => (this.card = f));
      }, CARD_DELAY_MS);
    }
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
    window.clearTimeout(this.cardTimer);
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

  private title(): string {
    const by = this.info.summary.killedBy;
    return by ? TITLES[by] : 'Run over';
  }

  private buildBadge(): HTMLElement {
    const { isBest, rank, prevBest, board } = this.info;
    if (isBest) return h('span', { class: 'badge badge-best' }, icon('crown'), 'New best!');
    // "#2 on your board" for a tiny run on a two-run board says nothing.
    if (rank && (rank <= 3 || board.length >= BOARD_SIZE)) {
      return h('span', { class: 'badge badge-rank' }, icon('trophy'), `#${rank} on your board`);
    }
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
    const pts = plural(gap, 'pt');
    return h('p', { class: `over-delta${close ? ' is-close' : ''}` }, close ? `So close! ${pts} from your best` : `${pts} short of your best`);
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
        h(
          'span',
          { class: 'mini-name' },
          // A dot plus the row highlight marks this run, so a 12-letter name still fits at 360 px.
          me ? h('span', { class: 'mini-you', title: 'This run' }, h('span', { class: 'sr-only' }, 'This run: ')) : null,
          h('span', { class: 'mini-name-text' }, name),
        ),
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
    let text = `${this.title()} Final score ${fmtInt(summary.score)} points, ${fmtMeters(summary.distanceM)}.`;
    if (isBest) text += ' New best!';
    else if (rank) text += ` Number ${rank} on your board.`;
    return text;
  }

  private shareContext(): ShareContext {
    const { daily, isBest } = this.info;
    return {
      attempts: daily ? storage.getDailyAttempts(daily.id) : 0,
      firstTry: daily ? storage.getDailyFirst(daily.id) : null,
      isBest,
      name: storage.getName(),
    };
  }

  private async share(): Promise<void> {
    const { summary, daily } = this.info;
    const result = await shareRun(summary, daily, this.shareContext(), this.card);
    if (result === 'copied') this.env.toast('Copied! Paste it to challenge a friend', { ms: 2000 });
    else if (result === 'failed') this.env.toast('Couldn’t share — try a screenshot', { ms: 2200 });
  }
}
