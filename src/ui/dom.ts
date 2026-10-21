// Tiny hyperscript helper. Every piece of user data (names, scores) goes in as
// a text node, never through innerHTML; only our own static SVG markup is
// parsed as HTML (see icons.ts).

export type Child = Node | string | number | null | undefined | false | Child[];

type Listener = (e: Event) => void;
export type Attrs = Record<string, string | number | boolean | null | undefined | Listener>;

function append(parent: Node, child: Child): void {
  if (child === null || child === undefined || child === false) return;
  if (Array.isArray(child)) {
    for (const c of child) append(parent, c);
    return;
  }
  parent.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
}

/**
 * h('button', { class: 'btn', 'aria-label': 'Close', onclick: fn }, 'Text')
 * - `class` / `text` are shortcuts; `on<event>` keys add listeners;
 * - `true` sets an empty attribute, `false`/null/undefined skip it.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const key in attrs) {
      const v = attrs[key];
      if (v === null || v === undefined || v === false) continue;
      if (typeof v === 'function') {
        el.addEventListener(key.slice(2), v);
      } else if (key === 'class') {
        el.className = String(v);
      } else if (key === 'text') {
        el.textContent = String(v);
      } else {
        el.setAttribute(key, v === true ? '' : String(v));
      }
    }
  }
  for (const c of children) append(el, c);
  return el;
}

/** Replace all children (cheap: used on screen changes, not per frame). */
export function setChildren(el: Element, ...children: Child[]): void {
  el.replaceChildren();
  for (const c of children) append(el, c);
}

let uid = 0;
/** Unique DOM id for aria-labelledby wiring. */
export function uniqueId(prefix: string): string {
  uid++;
  return `${prefix}-${uid}`;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Visible, enabled, keyboard-focusable descendants in DOM order. */
export function focusables(root: ParentNode): HTMLElement[] {
  const out: HTMLElement[] = [];
  root.querySelectorAll<HTMLElement>(FOCUSABLE).forEach((el) => {
    if (el.closest('[inert], [hidden]')) return;
    if (el.getClientRects().length === 0) return;
    out.push(el);
  });
  return out;
}

/** Focus without scrolling the page (the overlay never scrolls the body). */
export function focusEl(el: HTMLElement | null | undefined): void {
  if (!el) return;
  try {
    el.focus({ preventScroll: true });
  } catch {
    el.focus();
  }
}
