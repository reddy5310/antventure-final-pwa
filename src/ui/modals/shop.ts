// Crumb shop: a grid of ant skins, each with a live preview (the real in-game
// ant, strolling on the spot), its price or state, and one Buy / Equip button.
// Cards are built once and updated in place from a fresh MetaInfo, so focus
// stays on the button you just pressed. The preview loop runs only while the
// modal is open (destroy() is wired to its onClose).

import { SKINS } from '../../meta/skins';
import { drawSkinPreview } from '../../render/preview';
import type { MetaInfo, Skin } from '../../types';
import { h } from '../dom';
import { animate, type UIEnv } from '../env';
import { fmtInt } from '../format';
import { icon } from '../icons';
import { walletChip } from '../metaview';

export interface ShopModal {
  body: HTMLElement;
  destroy(): void;
}

/** Backing size of a preview canvas: crisp at 2x on a ~80 px card image. */
const PREVIEW_PX = 160;
const SPARKS = 9;
const BURST_MS = 600;

interface Card {
  skin: Skin;
  el: HTMLElement;
  canvas: HTMLCanvasElement;
  state: HTMLElement;
  btn: HTMLButtonElement;
  btnLabel: HTMLElement;
  /** What the button does right now; the one click handler reads it. */
  action: 'buy' | 'equip' | 'none';
}

export function buildShop(env: UIEnv): ShopModal {
  const walletSlot = h('div', { class: 'shop-wallet' });
  const grid = h('ul', { class: 'shop-grid' });
  const cards: Card[] = [];
  let meta = env.ctx.getMeta();
  /** Badge names for "Unlock: <badge>" (price-less skins). */
  const badgeName = new Map(env.ctx.getAchievements().map((a) => [a.id, a.name]));
  let raf = 0;
  let closed = false;

  const owns = (s: Skin, m: MetaInfo) => s.price === 0 || m.owned.includes(s.id);

  const sync = () => {
    setWallet();
    for (const c of cards) update(c);
  };

  const setWallet = () => {
    walletSlot.replaceChildren(h('span', { class: 'shop-wallet-label' }, 'Your crumbs'), walletChip(meta.wallet));
  };

  const update = (c: Card) => {
    const s = c.skin;
    const owned = owns(s, meta);
    const equipped = meta.equipped === s.id;
    c.el.classList.toggle('is-equipped', equipped);
    c.el.classList.toggle('is-owned', owned);
    c.el.classList.toggle('is-locked', !owned && s.price === null);

    let stateNode: Node | string;
    let label: string;
    let aria: string;
    let disabled = false;
    let ariaDisabled = false;
    let lead: SVGSVGElement | null = null;
    if (equipped) {
      c.action = 'none';
      stateNode = 'Equipped';
      label = 'Equipped';
      lead = icon('check');
      ariaDisabled = true;
      aria = `${s.name} is equipped`;
    } else if (owned) {
      c.action = 'equip';
      stateNode = 'Owned';
      label = 'Equip';
      aria = `Equip ${s.name}`;
    } else if (s.price === null) {
      c.action = 'none';
      const badge = badgeName.get(s.unlockedBy ?? '') ?? 'a badge';
      stateNode = `Unlock: ${badge}`;
      label = 'Locked';
      lead = icon('lock');
      disabled = true;
      aria = `${s.name} is locked. Earn the ${badge} badge to unlock it`;
    } else {
      const price = s.price;
      const short = price - meta.wallet;
      c.action = 'buy';
      stateNode = h('span', { class: 'shop-price' }, icon('crumb', 'icon shop-price-icon'), fmtInt(price));
      if (short > 0) {
        disabled = true;
        label = `Need ${fmtInt(short)} more`;
        aria = `${s.name} costs ${fmtInt(price)} crumbs. Need ${fmtInt(short)} more`;
      } else {
        label = 'Buy';
        aria = `Buy ${s.name} for ${fmtInt(price)} crumbs`;
      }
    }
    c.state.replaceChildren(stateNode);
    c.btnLabel.textContent = label;
    c.btn.replaceChildren(...(lead ? [lead] : []), c.btnLabel);
    c.btn.disabled = disabled;
    if (ariaDisabled) c.btn.setAttribute('aria-disabled', 'true');
    else c.btn.removeAttribute('aria-disabled');
    c.btn.setAttribute('aria-label', aria);
    const primary = c.action === 'buy' && !disabled;
    c.btn.classList.toggle('btn-primary', primary);
    c.btn.classList.toggle('btn-secondary', !primary);
  };

  /** A purchase pops the card and throws a few sparks from the ant. */
  const burst = (c: Card) => {
    animate(env, c.el, [{ transform: 'scale(0.96)' }, { transform: 'scale(1.04)', offset: 0.45 }, { transform: 'scale(1)' }], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
    if (env.reducedMotion()) return;
    const wrap = c.canvas.parentElement;
    if (!wrap) return;
    for (let i = 0; i < SPARKS; i++) {
      const a = (i / SPARKS) * Math.PI * 2 + 0.3;
      const d = 34 + (i % 3) * 8;
      const spark = h('i', { class: 'shop-spark', 'aria-hidden': 'true' });
      wrap.appendChild(spark);
      const anim = animate(
        env,
        spark,
        [
          { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
          { transform: `translate(calc(-50% + ${(Math.cos(a) * d).toFixed(1)}px), calc(-50% + ${(Math.sin(a) * d).toFixed(1)}px)) scale(0.2)`, opacity: 0 },
        ],
        { duration: BURST_MS, easing: 'cubic-bezier(.2,.8,.2,1)' },
      );
      if (anim) anim.onfinish = () => spark.remove();
      else spark.remove();
    }
  };

  const onPress = (c: Card) => {
    if (c.action === 'buy') {
      if (!env.handlers.onBuySkin(c.skin.id)) {
        // The balance changed under us (another tab): show the truth.
        meta = env.ctx.getMeta();
        sync();
        return;
      }
      meta = env.ctx.getMeta();
      sync();
      burst(c);
      env.announce(`Bought ${c.skin.name}. ${fmtInt(meta.wallet)} crumbs left. Press Equip to wear it.`);
    } else if (c.action === 'equip') {
      if (!env.handlers.onEquipSkin(c.skin.id)) return;
      // Buttons here opt out of the shell's tap sound (a purchase has its own), so equip taps itself.
      env.handlers.onSfx('tap');
      meta = env.ctx.getMeta();
      sync();
      env.announce(`${c.skin.name} equipped`);
    }
  };

  for (const skin of SKINS) {
    const canvas = h('canvas', { class: 'shop-canvas', width: PREVIEW_PX, height: PREVIEW_PX, 'aria-hidden': 'true' });
    const state = h('p', { class: 'shop-state' });
    const btnLabel = h('span', { class: 'shop-btn-label' });
    const btn = h('button', { class: 'btn btn-secondary btn-sm shop-btn', type: 'button', 'data-sfx': 'none' });
    const el = h('li', { class: 'shop-card' }, h('div', { class: 'shop-preview' }, canvas), h('h3', { class: 'shop-name' }, skin.name), state, btn);
    const card: Card = { skin, el, canvas, state, btn, btnLabel, action: 'none' };
    btn.addEventListener('click', () => onPress(card));
    cards.push(card);
    grid.appendChild(el);
  }
  sync();

  // One loop for every card: six tiny canvases, and nothing runs once the modal closes.
  const t0 = performance.now();
  const frame = (now: number) => {
    if (closed) return;
    const t = (now - t0) / 1000;
    for (const c of cards) drawSkinPreview(c.canvas, c.skin, t);
    raf = requestAnimationFrame(frame);
  };
  if (env.reducedMotion()) for (const c of cards) drawSkinPreview(c.canvas, c.skin, 0);
  else raf = requestAnimationFrame(frame);

  const body = h(
    'div',
    { class: 'shop' },
    walletSlot,
    h('p', { class: 'shop-note' }, 'Skins are only for looks: they never change how the game plays.'),
    grid,
  );
  return {
    body,
    destroy() {
      closed = true;
      cancelAnimationFrame(raf);
    },
  };
}
