// Modal dialog stack (settings, leaderboard, how to play). Only the top-most
// modal is interactive: lower ones are made inert, and the UI shell makes the
// screens/HUD underneath inert too, which gives a focus trap without manual
// Tab juggling. Focus returns to whatever opened the modal.

import { focusEl, focusables, h, uniqueId } from './dom';
import { icon } from './icons';

export interface ModalSpec {
  id: string;
  title: string;
  body: Node;
  /** Pinned below the scrolling body (primary action). */
  footer?: Node;
  /** Focused on open; defaults to the first control in the body, then the close button. */
  initialFocus?: HTMLElement | null;
  className?: string;
  onClose?: () => void;
}

interface OpenModal {
  id: string;
  el: HTMLElement;
  panel: HTMLElement;
  restore: HTMLElement | null;
  onClose?: () => void;
}

const OUT_MS = 180;

export class Modals {
  readonly el: HTMLElement;
  private stack: OpenModal[] = [];

  constructor(
    private onChange: () => void,
    private onCloseSfx: () => void,
  ) {
    this.el = h('div', { class: 'modals' });
  }

  get isOpen(): boolean {
    return this.stack.length > 0;
  }

  has(id: string): boolean {
    return this.stack.some((m) => m.id === id);
  }

  /** The top-most dialog panel (keyboard navigation scope). */
  topPanel(): HTMLElement | null {
    return this.stack[this.stack.length - 1]?.panel ?? null;
  }

  open(spec: ModalSpec): void {
    if (this.has(spec.id)) return;
    const titleId = uniqueId('modal-title');
    const closeBtn = h(
      'button',
      {
        class: 'btn-icon btn-close',
        type: 'button',
        'aria-label': 'Close',
        title: 'Close (Esc)',
        'data-sfx': 'none',
        onclick: () => this.closeTop(),
      },
      icon('close'),
    );
    const body = h('div', { class: 'modal-body' }, spec.body);
    const panel = h(
      'div',
      {
        class: `modal-panel panel ${spec.className ?? ''}`,
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': titleId,
        tabindex: '-1',
      },
      h('header', { class: 'modal-head' }, h('h2', { class: 'modal-title', id: titleId }, spec.title), closeBtn),
      body,
      spec.footer ? h('footer', { class: 'modal-foot' }, spec.footer) : null,
    );
    const backdrop = h('div', { class: 'modal-backdrop', 'aria-hidden': 'true', onclick: () => this.closeTop() });
    const el = h('div', { class: 'modal', 'data-id': spec.id }, backdrop, panel);

    const active = document.activeElement;
    const restore = active instanceof HTMLElement && active !== document.body ? active : null;
    for (const m of this.stack) m.el.inert = true;
    this.stack.push({ id: spec.id, el, panel, restore, onClose: spec.onClose });
    this.el.appendChild(el);
    this.onChange();

    const target = spec.initialFocus ?? focusables(body)[0] ?? closeBtn;
    focusEl(target);
  }

  /** Close the top-most modal. Returns false when none is open. */
  closeTop(sfx = true): boolean {
    const m = this.stack.pop();
    if (!m) return false;
    if (sfx) this.onCloseSfx();
    this.dispose(m);
    const below = this.stack[this.stack.length - 1];
    if (below) below.el.inert = false;
    // Un-inert the layers underneath first: focus() on an inert element is ignored.
    this.onChange();
    if (m.restore?.isConnected) focusEl(m.restore);
    return true;
  }

  /** Close everything without sounds or focus restoration (screen changes). */
  closeAll(): void {
    if (!this.stack.length) return;
    while (this.stack.length) this.dispose(this.stack.pop()!);
    this.onChange();
  }

  private dispose(m: OpenModal): void {
    m.el.inert = true;
    m.el.classList.add('is-out');
    window.setTimeout(() => m.el.remove(), OUT_MS);
    m.onClose?.();
  }
}
