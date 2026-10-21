// STUB — the UI agent replaces the bodies. Keep the exported signatures.

import type {
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

export class UI {
  private el: HTMLElement;

  constructor(
    private root: HTMLElement,
    private handlers: UIHandlers,
    private ctx: UIContext,
  ) {
    this.el = document.createElement('div');
    this.el.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;color:#fff;font:20px system-ui;pointer-events:none';
    this.root.appendChild(this.el);
    void this.ctx;
  }

  showTitle(info: TitleInfo): void {
    this.el.innerHTML = `<button style="pointer-events:auto;font-size:24px;padding:12px 32px">Play (best ${info.endlessBest?.score ?? 0})</button>`;
    this.el.querySelector('button')!.onclick = () => {
      this.handlers.onUserGesture();
      this.handlers.onPlay('endless');
    };
  }

  /** In-run: HUD visible, menus hidden. */
  showRun(): void {
    this.el.innerHTML = '<div id="hud" style="position:fixed;top:12px;left:0;right:0;text-align:center"></div>';
  }

  /** Called every frame during a run; must only touch the DOM when values change. */
  updateHUD(world: World, _fps: number): void {
    const hud = this.el.querySelector('#hud');
    if (hud) hud.textContent = `${'♥'.repeat(world.player.hearts)}  ${Math.floor(world.score)}`;
  }

  showPause(): void {}

  /** 3, 2, 1 → 0 shows "GO!" briefly → null hides. */
  showCountdown(_n: number | null): void {}

  showGameOver(info: GameOverInfo): void {
    this.el.innerHTML = `<button style="pointer-events:auto;font-size:24px;padding:12px 32px">Score ${info.summary.score} — Retry</button>`;
    this.el.querySelector('button')!.onclick = () => this.handlers.onRetry();
  }

  showTutorial(_hint: TutorialHint): void {}

  /** Banners, toasts and HUD pulses for game events. */
  onEvent(_e: GameEvent, _world: World): void {}

  toast(_text: string, _opts?: ToastOptions): void {}

  setInstallAvailable(_available: boolean, _onInstall: () => void): void {}

  /** Settings changed outside the UI (e.g. the mute hotkey). */
  syncSettings(_settings: Settings): void {}

  /** True while a modal (settings, leaderboard, help…) is open. */
  isModalOpen(): boolean {
    return false;
  }

  /** Close the top-most modal. Returns true if something was closed. */
  handleBack(): boolean {
    return false;
  }
}
