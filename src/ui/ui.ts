// The DOM overlay above the game canvas: title, HUD, pause, game over,
// modals, banners, toasts, countdown and tutorial hints. main.ts drives it
// through the methods below; it reports back only through UIHandlers.
//
// Layers inside #ui (bottom → top): HUD, banners, pills, countdown, screen, dock
// (toasts + tutorial + first-time pickup hint), modals, a screen-reader live region. #ui itself never
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
  SkinId,
  MetaInfo,
  AchievementView,
  MissionView,
  TitleInfo,
  TutorialHint,
  World,
} from '../types';
import { focusEl, focusables, h } from './dom';
import type { UIEnv } from './env';
import { Banners, Countdown, PickupHint, Pills, Toasts, Tutorial } from './feedback';
import { fmtInt, fmtMeters } from './format';
import { Hud } from './hud';
import { Modals } from './modal';
import { buildBadges } from './modals/badges';
import { buildHelp } from './modals/help';
import { buildLeaderboard } from './modals/leaderboard';
import { buildSettings, type SettingsModal } from './modals/settings';
import { buildShop } from './modals/shop';
import { ZONE_INFO } from './pickupinfo';
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
  /** Phase 3 shop: returns true if bought / equipped. */
  onBuySkin(id: SkinId): boolean;
  onEquipSkin(id: SkinId): boolean;
}

export interface UIContext {
  getSettings(): Settings;
  getDevice(): Device;
  /** Fresh Phase 3 snapshot (wallet, streak, missions, skins). */
  getMeta(): MetaInfo;
  /** Every achievement for the badges screen. */
  getAchievements(): AchievementView[];
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
/** Side gutters at least this wide (CSS px) hold the HUD instead of the top of the river. */
const WIDE_GUTTER_PX = 250;

export class UI {
  private env: UIEnv;
  private hud: Hud;
  private banners = new Banners();
  private pills = new Pills();
  private pickupHint = new PickupHint();
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
      openShop: () => this.openShop(),
      openBadges: () => this.openBadges(),
    };

    this.hud = new Hud(this.env);
    this.countdown = new Countdown(this.env);
    this.modals = new Modals(
      () => this.updateInert(),
      () => handlers.onSfx('back'),
    );
    this.screenLayer = h('div', { class: 'screens' });
    this.liveEl = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
    const dock = h('div', { class: 'dock' }, this.toasts.el, this.pickupHint.el, this.tutorial.el);

    root.classList.add('ui-root');
    root.replaceChildren(this.hud.el, this.banners.el, this.pills.el, this.countdown.el, this.screenLayer, dock, this.modals.el, this.liveEl);

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
    // Re-read the "seen" flags (and settle the rain hint for first-run players) every time the river starts or resumes.
    this.pickupHint.arm();
    // A focused (now removed) menu button must not swallow Space/arrow keys mid-run.
    const active = document.activeElement;
    if (active instanceof HTMLElement && this.root.contains(active)) active.blur();
    this.updateInert();
  }

  /** Called every frame during a run; must only touch the DOM when values change. */
  updateHUD(world: World, fps: number): void {
    this.lastWorld = world;
    this.hud.update(world, fps, this.showFps);
    this.pickupHint.scan(world, !this.tutorial.el.hidden);
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

  /** A mission finished mid-run: a small pill (non-blocking) and a screen-reader announcement. */
  missionComplete(mission: MissionView): void {
    this.pills.show('mission', 'Mission complete', 'check', `· +${fmtInt(mission.reward)}`, true);
    this.announce(`Mission complete: ${mission.text}. Plus ${mission.reward} crumbs.`);
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
        this.pills.clear();
        this.pickupHint.hide();
        break;
      case 'zone': {
        const z = ZONE_INFO[e.zone];
        this.banners.show('zone', `Entering ${z.name}`, z.icon, 1200, z.sub, e.zone);
        break;
      }
      case 'trail-complete':
        // The canvas already floats the bonus at the leaf: the pill only confirms (and is what screen readers get).
        this.pills.show('trail', 'Perfect trail!', 'sparkle');
        break;
      case 'shield-block':
        this.pills.show('block', 'Blocked!', 'mushroom');
        break;
      case 'storm':
        this.stormBanner(e.phase);
        break;
      case 'milestone':
        this.banners.show('milestone', fmtMeters(e.meters), 'flag', 1100);
        break;
      case 'new-best':
        this.banners.show('best', 'NEW BEST!', 'crown', 1200, 'Every point now raises the bar');
        break;
      case 'hit':
        if (e.heartsLeft === 1) this.banners.show('warn', 'Last heart!', 'heart', 1200);
        break;
      default:
        break;
    }
  }

  toast(text: string, opts?: ToastOptions): void {
    this.toasts.show(text, opts);
  }

  /** A run is starting: no tappable toast may sit in the steering zone. */
  clearActionToasts(): void {
    this.toasts.clearActions();
  }

  /**
   * Restart requested from the pause screen (button, R, gamepad Y). Returns
   * true when the run should restart now; false when the pause screen asked
   * for a second press first (a long run must not vanish on one mis-tap).
   */
  requestRestart(): boolean {
    return this.pauseScreen ? this.pauseScreen.requestRestart() : true;
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

  private openShop(): void {
    const m = buildShop(this.env);
    this.modals.open({
      id: 'shop',
      title: 'Crumb shop',
      body: m.body,
      className: 'modal-shop',
      onClose: () => {
        m.destroy();
        // Spending changed the wallet: bring the title chips up to date.
        this.title?.setMeta(this.ctx.getMeta());
      },
    });
  }

  private openBadges(): void {
    this.modals.open({ id: 'badges', title: 'Badges', body: buildBadges(this.env), className: 'modal-badges' });
  }

  // --- Internals ------------------------------------------------------------

  private mount(kind: Exclude<ScreenKind, null>, el: HTMLElement): void {
    this.unmount();
    this.screenKind = kind;
    this.root.dataset.screen = kind;
    document.documentElement.dataset.screen = kind;
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
    document.documentElement.dataset.screen = 'run';
    this.screenLayer.replaceChildren();
  }

  /** Clear everything that belongs to the previous run/screen. */
  private resetTransient(): void {
    this.modals.closeAll();
    this.countdown.show(null);
    this.banners.clear();
    this.pills.clear();
    this.pickupHint.hide();
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
        this.banners.show('calm', 'Calm waters', 'calm', 1100, 'Catch your breath');
        break;
      case 'drizzle':
        this.banners.show('drizzle', 'Drizzle', 'drizzle', 1000);
        break;
      case 'downpour':
        this.banners.show('downpour', 'Downpour!', 'downpour', 1100);
        break;
      case 'cloudburst':
        this.banners.show('cloudburst', 'CLOUDBURST!', 'cloudburst', 1200, 'Hold on tight');
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
      // Autofill and some IMEs dispatch keydown without a key.
      if (typeof e.key !== 'string') return;
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

    // CSS gets the world scale so layouts can line up with the river and the
    // leaf, plus the width of the jungle gutters beside it. Wide screens with
    // room to spare move the HUD into the gutters (arcade side panels) so it
    // can be big without covering the river.
    const setScale = () => {
      const w = window.innerWidth;
      const u = Math.min(w / WORLD_W, window.innerHeight / MIN_VIEW_H);
      const gutter = Math.max(0, (w - WORLD_W * u) / 2);
      root.style.setProperty('--u', `${u.toFixed(4)}px`);
      root.style.setProperty('--hs', Math.min(1.45, Math.max(1, u)).toFixed(3));
      root.style.setProperty('--gw', `${Math.floor(gutter)}px`);
      root.dataset.layout = gutter >= WIDE_GUTTER_PX ? 'wide' : 'narrow';
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
