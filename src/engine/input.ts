// Unified input. Four devices feed one InputFrame per animation frame plus
// discrete Actions:
//   touch / pen  relative drag anywhere (the thumb never has to cover the ant)
//   mouse        the leaf follows the cursor's x
//   keyboard     arrows / A-D (Q for AZERTY) + hotkeys
//   gamepad      left stick / d-pad, edge-detected buttons, menu focus navigation
// Steering is only reported while `steeringEnabled`; device tracking and
// actions keep working in menus.

import type { Action, Device, InputFrame } from '../types';
import { toWorldX, type Viewport } from './viewport';

// --- Tuning ------------------------------------------------------------------

/** Touch drag: leaf travel per unit of finger travel at sensitivity 1. A bit over 1:1 so one thumb sweep crosses the river. */
const DRAG_GAIN = 1.1;
/**
 * CSS px the mouse must travel before it takes steering back from keys/pad.
 * Chrome fires zero-distance mousemoves when the layout changes under a
 * resting cursor; without this the leaf would snap to an idle mouse.
 */
const MOUSE_WAKE_PX = 6;
const STICK_DEADZONE = 0.18;
/** Most sticks never quite reach 1.0; treat this as full deflection. */
const STICK_OUTER = 0.95;
/** Share of the response that is linear; the rest is quadratic for fine control near centre. */
const STICK_LINEAR = 0.4;
/** Stick deflection that counts as a menu navigation press. */
const NAV_THRESHOLD = 0.55;
const NAV_REPEAT_DELAY = 0.38;
const NAV_REPEAT_INTERVAL = 0.12;

// Standard gamepad mapping (https://w3c.github.io/gamepad/#remapping).
const BTN_A = 0;
const BTN_B = 1;
const BTN_Y = 3;
const BTN_SELECT = 8;
const BTN_START = 9;
const DPAD_UP = 12;
const DPAD_DOWN = 13;
const DPAD_LEFT = 14;
const DPAD_RIGHT = 15;
const PAD_BUTTONS = 17;

const PAD_ACTIONS: ReadonlyArray<readonly [number, Action]> = [
  [BTN_A, 'confirm'],
  [BTN_B, 'back'],
  [BTN_Y, 'retry'],
  [BTN_START, 'pause'],
  [BTN_SELECT, 'mute'],
];

// --- Pure helpers (unit-tested) -----------------------------------------------

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** Stick axis → steering: deadzone, outer zone, then a soft curve. Sign-preserving, -1..1. */
export function stickResponse(v: number): number {
  const m = Math.abs(v);
  if (!(m > STICK_DEADZONE)) return 0;
  const s = clamp((m - STICK_DEADZONE) / (STICK_OUTER - STICK_DEADZONE), 0, 1);
  const curved = s * (STICK_LINEAR + (1 - STICK_LINEAR) * s);
  return v < 0 ? -curved : curved;
}

/** Steering direction of a key, by physical position (code) or by label (key, for AZERTY). */
export function keyDirection(code: string, key: string): -1 | 0 | 1 {
  if (code === 'ArrowLeft' || code === 'KeyA') return -1;
  if (code === 'ArrowRight' || code === 'KeyD') return 1;
  const k = key.length === 1 ? key.toLowerCase() : key;
  if (k === 'ArrowLeft' || k === 'a' || k === 'q') return -1;
  if (k === 'ArrowRight' || k === 'd') return 1;
  return 0;
}

/** The Latin letter a key types, if any (so hotkeys follow the printed label on any Latin layout). */
const latinLetter = (key: string) => (key.length === 1 && /^[a-z]$/i.test(key) ? key.toLowerCase() : null);

/**
 * Hotkey for a key, if any. Letters go by label; the physical position is only
 * a fallback for non-Latin layouts (e.g. Cyrillic), where no label matches.
 */
export function keyAction(code: string, key: string): Action | null {
  if (key === ' ' || code === 'Space' || key === 'Enter' || code === 'NumpadEnter') return 'confirm';
  // Esc is 'back' (pause in a run, menu from game over); P / Start is 'pause'.
  if (key === 'Escape') return 'back';
  const printableAscii = key.length === 1 && key.charCodeAt(0) < 128;
  const letter = latinLetter(key) ?? (printableAscii ? null : code.startsWith('Key') ? code.slice(3).toLowerCase() : null);
  if (letter === 'p') return 'pause';
  if (letter === 'r') return 'retry';
  if (letter === 'm') return 'mute';
  return null;
}

/** Held steering keys where the most recently pressed one wins, falling back on release. */
export class HeldDirections {
  private stack: { code: string; dir: -1 | 1 }[] = [];

  press(code: string, dir: -1 | 1): void {
    this.release(code);
    this.stack.push({ code, dir });
  }

  release(code: string): void {
    const i = this.stack.findIndex((h) => h.code === code);
    if (i >= 0) this.stack.splice(i, 1);
  }

  clear(): void {
    this.stack.length = 0;
  }

  get axis(): -1 | 0 | 1 {
    const top = this.stack[this.stack.length - 1];
    return top ? top.dir : 0;
  }
}

export type NavDir = 'up' | 'down' | 'left' | 'right';

export interface NavRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Gap between [a0,a1] and [b0,b1]; 0 when they overlap. */
const gap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, b0 - a1, a0 - b1);

/**
 * Spatial navigation: index of the best candidate in `dir` from `from`, or -1.
 * Prefers candidates aligned with the current one (orthogonal gap weighs
 * double). With `wrap`, falls off the end onto the far side of the same column/row.
 */
export function pickSpatial(from: NavRect, cands: readonly NavRect[], dir: NavDir, wrap = false): number {
  const vertical = dir === 'up' || dir === 'down';
  const sign = dir === 'down' || dir === 'right' ? 1 : -1;
  const fc = vertical ? from.y + from.h / 2 : from.x + from.w / 2;
  let best = -1;
  let bestScore = Infinity;
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i];
    const cc = vertical ? c.y + c.h / 2 : c.x + c.w / 2;
    const along = (cc - fc) * sign;
    if (along <= 2) continue;
    const ortho = vertical ? gap(from.x, from.x + from.w, c.x, c.x + c.w) : gap(from.y, from.y + from.h, c.y, c.y + c.h);
    const score = along + ortho * 2;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  if (best >= 0 || !wrap) return best;
  // Wrap: the candidate furthest the other way, but only within the same column/row.
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i];
    const ortho = vertical ? gap(from.x, from.x + from.w, c.x, c.x + c.w) : gap(from.y, from.y + from.h, c.y, c.y + c.h);
    if (ortho > 0) continue;
    const cc = vertical ? c.y + c.h / 2 : c.x + c.w / 2;
    const score = cc * sign;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

// --- DOM classification ---------------------------------------------------------

const NON_TEXT_INPUTS = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image']);

/** Typing targets: every hotkey belongs to them. */
function isTextEntry(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(el.type);
  return el instanceof HTMLElement && el.isContentEditable;
}

/** Space/Enter activate these natively; a global 'confirm' on top would double-fire. */
const ACTIVATABLE =
  'button, a[href], summary, label, [role="button"], [role="link"], [role="menuitem"], [role="tab"], ' +
  '[role="checkbox"], [role="switch"], [role="option"], [role="radio"], input';

/** Widgets that use the arrow keys themselves. */
const OWNS_ARROWS =
  'input[type="range"], input[type="radio"], [role="slider"], [role="radiogroup"], [role="listbox"], ' +
  '[role="tablist"], [role="menu"], [role="spinbutton"], [data-own-arrows]';

/** A touch that starts on one of these is a tap on the UI, not a drag. */
const INTERACTIVE = `${ACTIVATABLE}, select, textarea, [contenteditable], [role="slider"], [data-no-steer]`;

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), ' +
  'textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

const asElement = (t: EventTarget | null): Element | null => (t instanceof Element ? t : null);

interface VisibilityCheck {
  checkVisibility?: (o: Record<string, boolean>) => boolean;
}

function isShown(el: Element): boolean {
  if (el.getClientRects().length === 0) return false;
  if (el.closest('[inert], [aria-hidden="true"]')) return false;
  const check = (el as Element & VisibilityCheck).checkVisibility;
  if (check) {
    return check.call(el, {
      checkOpacity: true,
      checkVisibilityCSS: true,
      opacityProperty: true,
      visibilityProperty: true,
    });
  }
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.opacity !== '0';
}

function toNavRect(el: Element): NavRect {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

// --- Input -----------------------------------------------------------------------

interface PadState {
  prev: number;
  /** The stick has been seen centred, so its readings can be trusted (phantom/drifting pads stay ignored). */
  calibrated: boolean;
}

export class Input {
  lastDevice: Device = detectInitialDevice();

  private steering = false;
  private actionCbs = new Set<(a: Action) => void>();
  private deviceCbs = new Set<(d: Device) => void>();
  private abort = new AbortController();
  /** Reused every frame: callers must copy it if they keep it. */
  private out: InputFrame = { steerDelta: 0, axis: 0, absoluteX: null };

  // Touch / pen.
  private touches = new Map<number, number>();
  private dragId: number | null = null;
  private dragAcc = 0;

  // Mouse.
  private mouseClientX: number | null = null;
  private mouseLastX = 0;
  private mouseLastY = 0;
  private mouseWake = 0;

  // Keyboard.
  private held = new HeldDirections();

  // Gamepad.
  private padsConnected = 0;
  private pads = new Map<number, PadState>();
  private activePad = -1;
  private padAxis = 0;
  private navDir: NavDir | null = null;
  private navNext = 0;
  private padFocus: HTMLElement | null = null;

  constructor(
    private surface: HTMLElement,
    private viewport: Viewport,
    private getSensitivity: () => number,
  ) {
    const signal = this.abort.signal;
    const passive = { signal, passive: true, capture: true } as const;

    const s = surface.style;
    s.touchAction = 'none';
    s.userSelect = 'none';
    s.setProperty('-webkit-user-select', 'none');
    s.setProperty('-webkit-touch-callout', 'none');
    s.setProperty('-webkit-tap-highlight-color', 'transparent');

    // Window-level (capture) so drags and the mouse keep working over the HUD.
    window.addEventListener('pointerdown', this.onPointerDown, passive);
    window.addEventListener('pointermove', this.onPointerMove, passive);
    window.addEventListener('pointerup', this.onPointerEnd, passive);
    window.addEventListener('pointercancel', this.onPointerEnd, passive);
    surface.addEventListener('lostpointercapture', this.onLostCapture, { signal, passive: true });

    // Belt and braces for browsers that ignore touch-action: no scroll, rubber-band or pinch on the game.
    surface.addEventListener('touchmove', preventDefault, { signal, passive: false });
    surface.addEventListener('contextmenu', preventDefault, { signal });
    document.addEventListener('gesturestart', preventDefault, { signal, passive: false });
    document.addEventListener('gesturechange', preventDefault, { signal, passive: false });

    window.addEventListener('keydown', this.onKeyDown, { signal });
    window.addEventListener('keyup', this.onKeyUp, { signal });
    window.addEventListener('blur', this.releaseAll, { signal });
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden) this.releaseAll();
      },
      { signal },
    );

    window.addEventListener('gamepadconnected', this.onPadConnected, { signal });
    window.addEventListener('gamepaddisconnected', this.onPadDisconnected, { signal });
    this.padsConnected = countPads();

    document.documentElement.dataset.input = this.lastDevice;
  }

  /** When false (menus), steering is ignored; actions still fire. */
  get steeringEnabled(): boolean {
    return this.steering;
  }

  set steeringEnabled(on: boolean) {
    if (on === this.steering) return;
    this.steering = on;
    // Drag made in a menu must not leak into the first frame of a run.
    this.dragAcc = 0;
  }

  /** Consume steering accumulated since the previous call; polls gamepads. Call once per frame. */
  frame(): InputFrame {
    this.pollPads(performance.now() / 1000);
    const out = this.out;
    if (!this.steering) {
      this.dragAcc = 0;
      out.steerDelta = 0;
      out.axis = 0;
      out.absoluteX = null;
      return out;
    }
    out.steerDelta = this.dragAcc;
    this.dragAcc = 0;
    out.axis = clamp(this.held.axis + this.padAxis, -1, 1);
    // Mapped at frame time so a resize between move and frame cannot skew it.
    out.absoluteX =
      this.lastDevice === 'mouse' && this.mouseClientX !== null ? toWorldX(this.viewport, this.mouseClientX) : null;
    return out;
  }

  onAction(cb: (a: Action) => void): () => void {
    this.actionCbs.add(cb);
    return () => this.actionCbs.delete(cb);
  }

  onDeviceChange(cb: (d: Device) => void): () => void {
    this.deviceCbs.add(cb);
    return () => this.deviceCbs.delete(cb);
  }

  dispose(): void {
    this.abort.abort();
    this.releaseAll();
    this.actionCbs.clear();
    this.deviceCbs.clear();
  }

  // --- Devices ---

  private setDevice(d: Device): void {
    if (d === this.lastDevice) return;
    this.lastDevice = d;
    this.mouseWake = 0;
    document.documentElement.dataset.input = d;
    for (const cb of this.deviceCbs) cb(d);
  }

  private emit(a: Action): void {
    for (const cb of this.actionCbs) cb(a);
  }

  private releaseAll = (): void => {
    this.held.clear();
    this.touches.clear();
    this.dragId = null;
    this.dragAcc = 0;
    this.navDir = null;
  };

  // --- Pointer ---

  private onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') {
      this.trackMouse(e);
      this.setDevice('mouse');
      return;
    }
    // Touch and pen.
    this.setDevice('touch');
    const target = asElement(e.target);
    if (target !== this.surface && target?.closest(INTERACTIVE)) return;
    this.touches.set(e.pointerId, e.clientX);
    if (this.dragId === null) this.dragId = e.pointerId;
    if (target === this.surface) {
      try {
        this.surface.setPointerCapture(e.pointerId);
      } catch {
        // Pointer already gone.
      }
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') {
      this.trackMouse(e);
      return;
    }
    const last = this.touches.get(e.pointerId);
    if (last === undefined) return;
    this.touches.set(e.pointerId, e.clientX);
    if (e.pointerId !== this.dragId || !this.steering) return;
    const dx = e.clientX - last;
    if (dx === 0) return;
    const sens = clamp(this.getSensitivity() || 1, 0.25, 3);
    this.dragAcc += (dx / this.viewport.scale) * sens * DRAG_GAIN;
  };

  private onPointerEnd = (e: PointerEvent): void => {
    if (!this.touches.delete(e.pointerId)) return;
    if (e.pointerId !== this.dragId) return;
    // Hand the drag to another finger still down; its baseline is its current position, so no jump.
    this.dragId = null;
    for (const id of this.touches.keys()) {
      this.dragId = id;
      break;
    }
  };

  private onLostCapture = (e: PointerEvent): void => {
    // Capture also ends normally after pointerup; only a lost capture with no contact means the drag is over.
    if (e.buttons === 0) this.onPointerEnd(e);
  };

  private trackMouse(e: PointerEvent): void {
    if (this.lastDevice !== 'mouse' && this.mouseClientX !== null) {
      this.mouseWake += Math.abs(e.clientX - this.mouseLastX) + Math.abs(e.clientY - this.mouseLastY);
      if (this.mouseWake >= MOUSE_WAKE_PX) this.setDevice('mouse');
    }
    this.mouseClientX = e.clientX;
    this.mouseLastX = e.clientX;
    this.mouseLastY = e.clientY;
  }

  // --- Keyboard ---

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
    const target = asElement(e.target);
    if (isTextEntry(target)) return;
    if (e.key === 'Shift' || e.key === 'CapsLock') return;
    this.setDevice('keyboard');

    const dir = keyDirection(e.code, e.key);
    if (dir !== 0) {
      // Steering ignores defaultPrevented on purpose: a page-level "no scrolling" handler must never block it.
      if (target?.closest(OWNS_ARROWS)) return;
      e.preventDefault();
      this.held.press(e.code || e.key, dir);
      return;
    }

    const action = keyAction(e.code, e.key);
    // A widget that already handled the key (preventDefault) owns it: no double back/mute.
    if (!action || e.defaultPrevented) return;
    if (action === 'confirm') {
      // The focused button's own click handles it; Space must keep its default there.
      if (target?.closest(ACTIVATABLE)) return;
      e.preventDefault();
    }
    if (!e.repeat) this.emit(action);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.held.release(e.code || e.key);
  };

  // --- Gamepad ---

  private onPadConnected = (): void => {
    this.padsConnected = Math.max(this.padsConnected + 1, countPads());
  };

  private onPadDisconnected = (e: GamepadEvent): void => {
    const index = e.gamepad?.index ?? -1;
    this.pads.delete(index);
    if (this.activePad === index) this.activePad = -1;
    this.padsConnected = countPads();
    this.padAxis = 0;
  };

  private pollPads(now: number): void {
    this.padAxis = 0;
    if (this.padsConnected <= 0) return;
    let list: ArrayLike<Gamepad | null>;
    try {
      list = navigator.getGamepads?.() ?? [];
    } catch {
      return;
    }

    let firstConnected: Gamepad | null = null;
    let active: Gamepad | null = null;
    for (let i = 0; i < list.length; i++) {
      const pad = list[i];
      if (!pad || !pad.connected) continue;
      firstConnected ??= pad;
      let st = this.pads.get(pad.index);
      if (!st) {
        st = { prev: 0, calibrated: false };
        this.pads.set(pad.index, st);
      }
      const x = pad.axes[0] ?? 0;
      const y = pad.axes[1] ?? 0;
      const centred = Math.abs(x) < STICK_DEADZONE && Math.abs(y) < STICK_DEADZONE;
      if (centred) st.calibrated = true;

      const mask = buttonMask(pad);
      const edges = mask & ~st.prev;
      st.prev = mask;
      if (edges || (st.calibrated && !centred)) {
        this.activePad = pad.index;
        this.setDevice('gamepad');
      }
      if (pad.index === this.activePad) active = pad;
      if (edges) this.padActions(edges);
    }
    active ??= firstConnected;
    if (!active) return;

    const st = this.pads.get(active.index);
    const mask = st?.prev ?? 0;
    const x = st?.calibrated ? active.axes[0] ?? 0 : 0;
    const y = st?.calibrated ? active.axes[1] ?? 0 : 0;
    const dpadX = (mask & (1 << DPAD_RIGHT) ? 1 : 0) - (mask & (1 << DPAD_LEFT) ? 1 : 0);

    if (this.steering) {
      this.navDir = null;
      this.padAxis = dpadX !== 0 ? dpadX : stickResponse(x);
      return;
    }
    this.padNavigate(mask, x, y, now);
  }

  private padActions(edges: number): void {
    for (const [btn, action] of PAD_ACTIONS) {
      if (!(edges & (1 << btn))) continue;
      if (action === 'confirm' && this.activatePadFocus()) continue;
      this.emit(action);
    }
  }

  /** Menu navigation with the d-pad or stick, with key-style auto-repeat. */
  private padNavigate(mask: number, x: number, y: number, now: number): void {
    let dir: NavDir | null = null;
    if (mask & (1 << DPAD_UP)) dir = 'up';
    else if (mask & (1 << DPAD_DOWN)) dir = 'down';
    else if (mask & (1 << DPAD_LEFT)) dir = 'left';
    else if (mask & (1 << DPAD_RIGHT)) dir = 'right';
    else if (Math.max(Math.abs(x), Math.abs(y)) > NAV_THRESHOLD) {
      dir = Math.abs(y) >= Math.abs(x) ? (y < 0 ? 'up' : 'down') : x < 0 ? 'left' : 'right';
    }
    if (dir === null) {
      this.navDir = null;
      return;
    }
    if (dir !== this.navDir) {
      this.navDir = dir;
      this.navNext = now + NAV_REPEAT_DELAY;
      this.navigate(dir);
    } else if (now >= this.navNext) {
      this.navNext = now + NAV_REPEAT_INTERVAL;
      this.navigate(dir);
    }
  }

  /** Moves DOM focus spatially among visible controls (inside the top-most modal if one is open). */
  private navigate(dir: NavDir): void {
    try {
      const scope = topModal() ?? document;
      const els: HTMLElement[] = [];
      for (const el of scope.querySelectorAll<HTMLElement>(FOCUSABLE)) if (isShown(el)) els.push(el);
      if (els.length === 0) return;
      const cur = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const curIdx = cur ? els.indexOf(cur) : -1;
      if (!cur || curIdx < 0) {
        this.focusFromPad(els.find((el) => el.matches('[autofocus], [data-autofocus]')) ?? els[0]);
        return;
      }
      if ((dir === 'left' || dir === 'right') && cur instanceof HTMLInputElement && cur.type === 'range') {
        if (dir === 'left') cur.stepDown();
        else cur.stepUp();
        cur.dispatchEvent(new Event('input', { bubbles: true }));
        cur.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
      const others = els.filter((el) => el !== cur);
      const idx = pickSpatial(toNavRect(cur), others.map(toNavRect), dir, dir === 'up' || dir === 'down');
      if (idx >= 0) this.focusFromPad(others[idx]);
    } catch {
      // Navigation is a convenience; never let a DOM quirk break the frame.
    }
  }

  private focusFromPad(el: HTMLElement): void {
    this.padFocus = el;
    // focusVisible asks for a focus ring even though no key was pressed (ignored where unsupported).
    // preventScroll: the UI overlay is fixed and must never be scrolled by focus; real scroll boxes are handled below.
    el.focus({ preventScroll: true, focusVisible: true } as FocusOptions);
    revealInScrollers(el);
  }

  /** Gamepad A on a control the pad focused clicks it instead of the global confirm. */
  private activatePadFocus(): boolean {
    const el = this.padFocus;
    if (!el || !el.isConnected || document.activeElement !== el || !isShown(el)) {
      this.padFocus = null;
      return false;
    }
    el.click();
    return true;
  }
}

// --- Module helpers -----------------------------------------------------------

function preventDefault(e: Event): void {
  if (e.cancelable) e.preventDefault();
}

function detectInitialDevice(): Device {
  try {
    if (window.matchMedia('(hover: none) and (pointer: coarse)').matches) return 'touch';
  } catch {
    // Old browsers: assume a mouse until proven otherwise.
  }
  return 'mouse';
}

function countPads(): number {
  try {
    const list = navigator.getGamepads?.();
    if (!list) return 0;
    let n = 0;
    for (let i = 0; i < list.length; i++) if (list[i]?.connected) n++;
    return n;
  } catch {
    return 0;
  }
}

function buttonMask(pad: Gamepad): number {
  let mask = 0;
  const n = Math.min(pad.buttons.length, PAD_BUTTONS);
  for (let i = 0; i < n; i++) {
    const b = pad.buttons[i];
    if (b && (b.pressed || b.value > 0.5)) mask |= 1 << i;
  }
  return mask;
}

/** Scrolls only genuinely scrollable ancestors (lists in modals) so `el` is in view. */
function revealInScrollers(el: HTMLElement): void {
  const r = el.getBoundingClientRect();
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy !== 'auto' && oy !== 'scroll') || p.scrollHeight <= p.clientHeight) continue;
    const pr = p.getBoundingClientRect();
    if (r.top < pr.top) p.scrollTop -= pr.top - r.top + 8;
    else if (r.bottom > pr.bottom) p.scrollTop += r.bottom - pr.bottom + 8;
    return;
  }
}

function topModal(): Element | null {
  const modals = document.querySelectorAll('dialog[open], [aria-modal="true"]');
  for (let i = modals.length - 1; i >= 0; i--) if (isShown(modals[i])) return modals[i];
  return null;
}
