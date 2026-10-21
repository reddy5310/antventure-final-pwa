// The DOM overlay above the game canvas: title, HUD, pause, game over,
// modals, banners, toasts, countdown and tutorial hints. main.ts drives it
// through the methods below; it reports back only through UIHandlers.
//
// Layers inside #ui (bottom → top): HUD, banners, countdown, screen, dock
// (toasts + tutorial), modals, a screen-reader live region. #ui itself never
// takes pointer events, so touch steering on the canvas works everywhere
// except on real controls and menu panels.

import '@fontsource-variable/fredoka';
import './styles.css';

import { MIN_VIEW_H, WORLD_W } from '../config';
import { dailyInfo } from '../engine/rng';
import type {
  DailyInfo,
  Device,
  GameEvent,
  GameOverInfo,
  Mode,
  Settings,
  Sfx,
  TitleInfo,
  TutorialHint,
  World,
} from '../types';
import { focusEl, focusables, h } from './dom';
import type { UIEnv } from './env';
import { Banners, Countdown, Toasts, Tutorial } from './feedback';
import { fmtMeters } from './format';
import { Hud } from './hud';
import { Modals } from './modal';
import { buildHelp } from './modals/help';
import { buildLeaderboard } from './modals/leaderboard';
import { buildSettings, type SettingsModal } from './modals/settings';
import { GameOverScreen } from './screens/gameover';
import { PauseScreen } from './screens/pause';
import { TitleScreen } from './screens/title';

export interface UIHandlers {
  onPlay(mode: Mode): void;
  onPause(): void;
  onResume(): void;
  /** Restart the current mode (from pause or game over). */
  onRetry(): void;
  onMenu(): void;
  onSettings(settings: Settings): void;
  /** Returns the sanitised name that was stored. */
  onName(name: string): string;
  onToggleMute(): void;
  /** Any pointer/keyboard interaction inside the UI (unlocks audio). */
  onUserGesture(): void;
  /** UI sound effects (tap, back…). */
  onSfx(sfx: Sfx): void;
}

export interface UIContext {
  getSettings(): Settings;
  getDevice(): Device;
}

export interface ToastOptions {
  actionLabel?: string;
  onAction?: () => void;
  ms?: number;
}

type ScreenKind = 'title' | 'pause' | 'over' | null;

/** How often to re-check the input device for hints (gamepads have no events). */
const DEVICE_POLL_MS = 500;
/** Main may also route the same Esc press to handleBack(); ignore the echo. */
const BACK_ECHO_MS = 80;

export class UI {
  private env: UIEnv;
  private hud: Hud;
  private banners = new Banners();
  private toasts = new Toasts();
  private countdown: Countdown;
  private tutorial = new Tutorial();
  private modals: Modals;
  private screenLayer: HTMLElement;
  private liveEl: HTMLElement;

  private screenKind: ScreenKind = null;
  private title: TitleScreen | null = null;
  private pauseScreen: PauseScreen | null = null;
  private over: GameOverScreen | null = null;
  private settingsModal: SettingsModal | null = null;

  private lastWorld: World | null = null;
  private install = { available: false, onInstall: () => {} };
  private reduced = false;
  private showFps = false;
  private lastDevice: Device;
  private lastBackAt = -Infinity;
  private coarse: MediaQueryList | null = null;
  private motionQuery: MediaQueryList | null = null;

  constructor(
    private root: HTMLElement,
    private handlers: UIHandlers,
    private ctx: UIContext,
  ) {
    try {
      this.coarse = matchMedia('(hover: none) and (pointer: coarse)');
      this.motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
    } catch {
      // Very old engines: assume a fine pointer and full motion.
    }

    this.env = {
      handlers,
      ctx,
      device: () => this.device(),
      reducedMotion: () => this.reduced,
      toast: (text, opts) => this.toast(text, opts),
      announce: (text) => this.announce(text),
      openSettings: () => this.openSettings(),
      openLeaderboard: (tab) => this.openLeaderboard(tab),
      openHelp: () => this.openHelp(),
    };

    this.hud = new Hud(this.env);
    this.countdown = new Countdown(this.env);
    this.modals = new Modals(
      () => this.updateInert(),
      () => handlers.onSfx('back'),
    );
    this.screenLayer = h('div', { class: 'screens' });
    this.liveEl = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
    const dock = h('div', { class: 'dock' }, this.toasts.el, this.tutorial.el);

    root.classList.add('ui-root');
    root.replaceChildren(this.hud.el, this.banners.el, this.countdown.el, this.screenLayer, dock, this.modals.el, this.liveEl);

    this.lastDevice = this.device();
    root.dataset.device = this.lastDevice;
    this.syncSettings(ctx.getSettings());
    this.bindEvents();
  }

  // --- Screens -------------------------------------------------------------

  showTitle(info: TitleInfo): void {
    this.resetTransient();
    this.hud.el.hidden = true;
    const title = new TitleScreen(info, this.env, this.install);
    this.mount('title', title.el);
    this.title = title;
    title.focusPrimary();
  }

  /** In-run: HUD visible, menus hidden. */
  showRun(): void {
    this.modals.closeAll();
    this.unmount();
    this.hud.el.hidden = false;
    // A focused (now removed) menu button must not swallow Space/arrow keys mid-run.
    const active = document.activeElement;
    if (active instanceof HTMLElement && this.root.contains(active)) active.blur();
    this.updateInert();
  }

  /** Called every frame during a run; must only touch the DOM when values change. */
  updateHUD(world: World, fps: number): void {
    this.lastWorld = world;
    this.hud.update(world, fps, this.showFps);
  }

  showPause(): void {
    this.modals.closeAll();
    const pause = new PauseScreen(this.lastWorld, this.runDaily(), this.env);
    this.mount('pause', pause.el);
    this.pauseScreen = pause;
    pause.focusPrimary();
  }

  /** 3, 2, 1 → 0 shows "GO!" briefly → null hides. */
  showCountdown(n: number | null): void {
    this.countdown.show(n);
  }

  showGameOver(info: GameOverInfo): void {
    this.resetTransient();
    this.hud.el.hidden = true;
    const over = new GameOverScreen(info, this.env);
    this.mount('over', over.el);
    this.over = over;
    over.focusPrimary();
  }

  showTutorial(hint: TutorialHint): void {
    this.tutorial.show(hint, this.device());
  }

  // --- Events ---------------------------------------------------------------

  /** Banners, toasts and HUD pulses for game events. */
  onEvent(e: GameEvent, world: World): void {
    this.lastWorld = world;
    this.hud.onEvent(e);
    switch (e.type) {
      case 'start':
        this.banners.clear();
        break;
      case 'storm':
        this.stormBanner(e.phase);
        break;
      case 'milestone':
        this.banners.show('milestone', fmtMeters(e.meters), 'flag', 1500);
        break;
      case 'new-best':
        this.banners.show('best', 'NEW BEST!', 'crown', 2400, 'Every metre now raises the bar');
        break;
      case 'hit':
        if (e.heartsLeft === 1) this.banners.show('warn', 'Last heart!', 'heart', 1600);
        break;
      default:
        break;
    }
  }

  toast(text: string, opts?: ToastOptions): void {
    this.toasts.show(text, opts);
  }

  setInstallAvailable(available: boolean, onInstall: () => void): void {
    this.install = { available, onInstall };
    this.title?.setInstall(available, onInstall);
  }

  /** Settings changed outside the UI (e.g. the mute hotkey). */
  syncSettings(settings: Settings): void {
    this.showFps = settings.showFps;
    this.reduced = settings.reducedMotion || !!this.motionQuery?.matches;
    this.root.classList.toggle('reduced-motion', this.reduced);
    this.title?.syncSettings(settings);
    this.settingsModal?.sync(settings);
  }

  /** True while a modal (settings, leaderboard, help…) is open. */
  isModalOpen(): boolean {
    return this.modals.isOpen || !!this.title?.editing;
  }

  /** Close the top-most modal. Returns true if something was closed. */
  handleBack(): boolean {
    this.lastBackAt = performance.now();
    if (this.modals.closeTop()) return true;
    if (this.title?.cancelEdit()) {
      this.handlers.onSfx('back');
      return true;
    }
    return false;
  }

  // --- Modals ---------------------------------------------------------------

  private openSettings(): void {
    const m = buildSettings(this.env);
    this.settingsModal = m;
    this.modals.open({
      id: 'settings',
      title: 'Settings',
      body: m.body,
      className: 'modal-settings',
      onClose: () => {
        if (this.settingsModal === m) this.settingsModal = null;
      },
    });
  }

  private openLeaderboard(tab: Mode = 'endless'): void {
    const canPlay = this.screenKind === 'title';
    const m = buildLeaderboard(
      this.env,
      tab,
      canPlay
        ? (mode) => {
            this.modals.closeAll();
            this.handlers.onPlay(mode);
          }
        : null,
    );
    this.modals.open({ id: 'leaderboard', title: 'Leaderboard', body: m.body, initialFocus: m.initialFocus, className: 'modal-board' });
  }

  private openHelp(): void {
    const m = buildHelp(this.env, () => this.modals.closeTop());
    this.modals.open({ id: 'help', title: 'How to play', body: m.body, footer: m.footer, className: 'modal-help' });
  }

  // --- Internals ------------------------------------------------------------

  private mount(kind: Exclude<ScreenKind, null>, el: HTMLElement): void {
    this.unmount();
    this.screenKind = kind;
    this.root.dataset.screen = kind;
    this.screenLayer.appendChild(el);
    this.updateInert();
  }

  private unmount(): void {
    this.over?.destroy();
    this.title = null;
    this.pauseScreen = null;
    this.over = null;
    this.screenKind = null;
    this.root.dataset.screen = 'run';
    this.screenLayer.replaceChildren();
  }

  /** Clear everything that belongs to the previous run/screen. */
  private resetTransient(): void {
    this.modals.closeAll();
    this.countdown.show(null);
    this.banners.clear();
  }

  /** Only the top-most layer is interactive (and reachable with Tab). */
  private updateInert(): void {
    const modal = this.modals.isOpen;
    const blocking = this.screenKind === 'pause' || this.screenKind === 'over';
    this.hud.el.inert = modal || blocking;
    this.screenLayer.inert = modal;
    this.root.classList.toggle('has-modal', modal);
  }

  private stormBanner(phase: World['storm']): void {
    switch (phase) {
      case 'calm':
        this.banners.show('calm', 'Calm waters', 'calm', 1800, 'Catch your breath');
        break;
      case 'drizzle':
        this.banners.show('drizzle', 'Drizzle', 'drizzle', 1800);
        break;
      case 'downpour':
        this.banners.show('downpour', 'Downpour!', 'downpour', 2000);
        break;
      case 'cloudburst':
        this.banners.show('cloudburst', 'CLOUDBURST!', 'cloudburst', 2400, 'Hold on tight');
        break;
    }
  }

  private runDaily(): DailyInfo | null {
    const id = this.lastWorld?.mode === 'daily' ? this.lastWorld.dailyId : null;
    if (!id) return null;
    const [y, m, d] = id.split('-').map(Number);
    return dailyInfo(new Date(y, m - 1, d));
  }

  private announce(text: string): void {
    // Clearing first makes repeated identical messages announce again.
    this.liveEl.textContent = '';
    window.setTimeout(() => (this.liveEl.textContent = text), 60);
  }

  private device(): Device {
    const d = this.ctx.getDevice();
    // Until the first touch, a phone still reports the default 'mouse'.
    if (d === 'mouse' && this.coarse?.matches) return 'touch';
    return d;
  }

  private refreshDevice(): void {
    const d = this.device();
    if (d === this.lastDevice) return;
    this.lastDevice = d;
    this.root.dataset.device = d;
    this.title?.refreshDevice();
    this.pauseScreen?.refreshDevice();
    this.over?.refreshDevice();
    this.tutorial.refreshDevice(d);
  }

  private bindEvents(): void {
    const root = this.root;
    root.addEventListener('pointerdown', () => this.handlers.onUserGesture(), { capture: true, passive: true });
    root.addEventListener('keydown', (e) => this.onKeyDown(e));
    root.addEventListener('click', (e) => {
      const btn = (e.target as Element | null)?.closest('button');
      if (!btn || btn.disabled) return;
      const sfx = btn.dataset.sfx;
      if (sfx === 'none') return;
      this.handlers.onSfx(sfx === 'back' ? 'back' : 'tap');
    });

    // Arrow keys reach menus even when nothing inside the overlay has focus yet
    // (e.g. after clicking the backdrop): they land on the primary action.
    window.addEventListener('keydown', (e) => {
      if (this.over && e.key !== 'Tab') this.over.skip();
      if (!e.key.startsWith('Arrow') || root.contains(document.activeElement)) return;
      if (!this.screenKind && !this.modals.isOpen) return;
      const scope = this.modals.topPanel();
      const target = scope ? focusables(scope)[0] : this.primaryButton();
      if (target) {
        e.preventDefault();
        focusEl(target);
      }
    });

    const refresh = () => requestAnimationFrame(() => this.refreshDevice());
    window.addEventListener('pointerdown', refresh, { capture: true, passive: true });
    window.addEventListener('keydown', refresh, { capture: true, passive: true });
    window.addEventListener('gamepadconnected', refresh);
    window.setInterval(() => this.refreshDevice(), DEVICE_POLL_MS);

    this.motionQuery?.addEventListener?.('change', () => this.syncSettings(this.ctx.getSettings()));

    // CSS gets the world scale so layouts can line up with the river and the leaf.
    const setScale = () => {
      const u = Math.min(window.innerWidth / WORLD_W, window.innerHeight / MIN_VIEW_H);
      root.style.setProperty('--u', `${u.toFixed(4)}px`);
    };
    setScale();
    window.addEventListener('resize', setScale, { passive: true });
    window.visualViewport?.addEventListener('resize', setScale, { passive: true });
  }

  private primaryButton(): HTMLElement | null {
    return this.title?.playBtn ?? this.pauseScreen?.resumeBtn ?? this.over?.retryBtn ?? null;
  }

  private navScope(): HTMLElement | null {
    return this.modals.topPanel() ?? (this.screenKind ? (this.screenLayer.firstElementChild as HTMLElement | null) : null);
  }

  private onKeyDown(e: KeyboardEvent): void {
    this.handlers.onUserGesture();
    const t = e.target as HTMLElement;

    // Typing a name: every key belongs to the text field (no P = pause, M = mute…).
    if (t instanceof HTMLInputElement && t.type === 'text') {
      e.stopPropagation();
      return;
    }

    if (e.key === 'Escape') {
      if (this.isModalOpen() && performance.now() - this.lastBackAt > BACK_ECHO_MS) {
        e.preventDefault();
        e.stopPropagation();
        this.handleBack();
      }
      return;
    }

    // Enter/Space on a focused control activates that control only; without
    // this the global "confirm" action would also fire (e.g. Daily focused
    // but Space starting an endless run).
    if ((e.key === 'Enter' || e.key === ' ') && t !== this.root && t.closest('button, input, select, a, [role="tab"]')) {
      e.stopPropagation();
      return;
    }

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      this.arrowNav(e, t);
    }
  }

  /** Arrow keys move between controls in menus (gamer-friendly, no Tab needed). */
  private arrowNav(e: KeyboardEvent, t: HTMLElement): void {
    if (t instanceof HTMLInputElement && t.type === 'range') return;
    if (t.closest('[role="tablist"]')) return;
    if (!this.screenKind && !this.modals.isOpen) return;
    const scope = this.navScope();
    if (!scope) return;
    const items = focusables(scope);
    if (!items.length) return;
    const dir = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1;
    const i = items.indexOf(t);
    const next = i < 0 ? items[0] : items[(i + dir + items.length) % items.length];
    e.preventDefault();
    focusEl(next);
  }
}
