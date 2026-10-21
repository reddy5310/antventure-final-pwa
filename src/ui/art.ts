// Illustrations for the UI (brand mark, hearts, how-to-play scenes). Same flat
// "cozy jungle storm" language and colours as the canvas art (render/palette),
// so menus and the river feel like one game.

import { svgFrom } from './icons';

const C = {
  leaf: '#62b343',
  leafLight: '#93d65e',
  leafEdge: '#2a6528',
  vein: '#d0f0a0',
  stem: '#6f8c34',
  ant: '#4b211a',
  antOutline: '#140a09',
  antHi: '#cf6643',
  water: '#167686',
  waterLight: '#5fcab9',
  waterDeep: '#0e5467',
  shadow: '#03101a',
  ring: '#f6fcff',
  dropBody: '#d8f1ff',
  foam: '#eafffa',
  rockDark: '#38434c',
  rock: '#5f6c76',
  rockLight: '#8e9ca6',
  moss: '#5c9a48',
  bark: '#6e4a2d',
  barkLight: '#a07448',
  barkDark: '#3f2717',
  coral: '#ff5d6c',
  coralDeep: '#b3122a',
  gold: '#ffc24b',
  cream: '#f4f1e8',
} as const;

const HEART_D =
  'M12 20c-.4 0-.8-.15-1.1-.4C6.3 15.9 3.5 13 3.5 9.4A4.6 4.6 0 0 1 8.1 4.8c1.6 0 3 .8 3.9 2.1.9-1.3 2.3-2.1 3.9-2.1a4.6 4.6 0 0 1 4.6 4.6c0 3.6-2.8 6.5-7.4 10.2-.3.25-.7.4-1.1.4z';

/** A small ant drawn facing up, centred on (cx, cy), `s` = scale. */
function antMarkup(cx: number, cy: number, s: number): string {
  const o = C.antOutline;
  return `<g transform="translate(${cx} ${cy}) scale(${s})">
    <g stroke="${o}" stroke-width="1.6" stroke-linecap="round" fill="none">
      <path d="M-2 -1l-7 -5M-2 1l-8 1M-2 3l-6 6M2 -1l7 -5M2 1l8 1M2 3l6 6"/>
      <path d="M-1.6 -10.5q-3 -4 -6 -5M1.6 -10.5q3 -4 6 -5"/>
    </g>
    <g stroke="${o}" stroke-width="1.4" fill="${C.ant}">
      <ellipse cx="0" cy="8" rx="5.2" ry="6.2"/>
      <ellipse cx="0" cy="0" rx="3.1" ry="3.5"/>
      <circle cx="0" cy="-7.4" r="4"/>
    </g>
    <ellipse cx="-1.8" cy="6" rx="1.6" ry="2.4" fill="${C.antHi}" opacity=".8"/>
    <circle cx="-1.5" cy="-8" r="1.1" fill="#fff"/><circle cx="1.5" cy="-8" r="1.1" fill="#fff"/>
  </g>`;
}

/** A leaf pointing up-right, the player's raft. */
function leafMarkup(x: number, y: number, s: number, rot = 0): string {
  return `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})">
    <path d="M-22 18c-2-22 14-38 44-40 2 28-16 46-44 40z" fill="${C.leaf}" stroke="${C.leafEdge}" stroke-width="2.4" stroke-linejoin="round"/>
    <path d="M-22 18c-2-22 14-38 44-40-14 14-28 26-44 40z" fill="${C.leafLight}" opacity=".7"/>
    <path d="M-20 16L20 -20" stroke="${C.vein}" stroke-width="1.6" stroke-linecap="round" opacity=".9"/>
    <path d="M-22 18l-6 6" stroke="${C.stem}" stroke-width="3" stroke-linecap="round"/>
  </g>`;
}

/** Brand mark: the ant on its leaf. */
export function brandMark(cls = 'brand-mark'): SVGSVGElement {
  return svgFrom(
    `<svg viewBox="0 0 64 64">
      <ellipse cx="32" cy="56" rx="20" ry="4" fill="#03101a" opacity=".35"/>
      ${leafMarkup(32, 32, 1)}
      ${antMarkup(31, 31, 1)}
    </svg>`,
    cls,
  );
}

/** HUD / illustration heart. The fill class lets CSS switch full ↔ lost. */
export function heartSvg(cls = 'heart-svg'): SVGSVGElement {
  return svgFrom(
    `<svg viewBox="0 0 24 24">
      <path class="heart-fill" d="${HEART_D}"/>
      <path class="heart-shine" d="M7.3 8.6a2.3 2.3 0 0 1 2.3-1.7" fill="none" stroke-linecap="round"/>
    </svg>`,
    cls,
  );
}

const WATER_BG = `<rect x="1" y="1" width="94" height="70" rx="14" fill="${C.water}"/>
  <path d="M10 18c5 0 5-3 10-3s5 3 10 3M60 58c5 0 5-3 10-3s5 3 10 3" stroke="${C.waterLight}" stroke-opacity=".4" stroke-width="2" fill="none" stroke-linecap="round"/>`;

export type Illustration = 'shadows' | 'near-miss' | 'obstacles' | 'hearts' | 'daily';

const SCENES: Record<Illustration, string> = {
  shadows: `${WATER_BG}
    <circle cx="48" cy="44" r="19" fill="${C.shadow}" opacity=".42"/>
    <circle cx="48" cy="44" r="19" fill="none" stroke="${C.ring}" stroke-opacity=".85" stroke-width="2"/>
    <circle class="ill-grow" cx="48" cy="44" r="19" fill="${C.shadow}" opacity=".45"/>
    <path class="ill-fall" d="M48 6c3 4 5 6.6 5 9.4a5 5 0 0 1-10 0c0-2.8 2-5.4 5-9.4z" fill="${C.dropBody}" stroke="${C.waterDeep}" stroke-width="1.2"/>`,
  'near-miss': `${WATER_BG}
    <circle cx="34" cy="42" r="17" fill="none" stroke="${C.foam}" stroke-width="3" opacity=".9"/>
    <circle cx="34" cy="42" r="9" fill="none" stroke="${C.foam}" stroke-width="2" opacity=".55"/>
    ${leafMarkup(70, 46, 0.42, 10)}
    ${antMarkup(69, 45, 0.5)}
    <path d="M56 17c.4 3 1.6 4.8 5 6.5-3.4 1.7-4.6 3.5-5 6.5-.4-3-1.6-4.8-5-6.5 3.4-1.7 4.6-3.5 5-6.5z" fill="${C.gold}"/>
    <text x="64" y="21" fill="${C.gold}" font-size="13" font-weight="700" stroke="#3a2300" stroke-width="3" paint-order="stroke">+25</text>`,
  obstacles: `${WATER_BG}
    <path d="M14 50l5-13 10-7 11 2 7 9 1 9z" fill="${C.rock}" stroke="${C.rockDark}" stroke-width="2" stroke-linejoin="round"/>
    <path d="M20 38l9-6 10 2 4 5c-8-2-16-2-23-1z" fill="${C.rockLight}"/>
    <path d="M24 33c3-3 8-3 11-1-4 1-8 1-11 1z" fill="${C.moss}"/>
    <g transform="rotate(-24 68 40)">
      <rect x="48" y="35" width="42" height="10" rx="5" fill="${C.bark}" stroke="${C.barkDark}" stroke-width="2"/>
      <path d="M54 38.5h26" stroke="${C.barkLight}" stroke-width="2" stroke-linecap="round"/>
      <path d="M74 35l5-7" stroke="${C.barkDark}" stroke-width="3" stroke-linecap="round"/>
    </g>
    <g transform="translate(70 4) scale(.8)"><path d="${HEART_D}" fill="${C.coral}" stroke="${C.coralDeep}" stroke-width="1.5"/></g>
    <text x="58" y="16" fill="#fff" font-size="11" font-weight="700" stroke="${C.coralDeep}" stroke-width="3" paint-order="stroke">-1</text>`,
  hearts: `${WATER_BG}
    <g transform="translate(8 22) scale(1.15)"><path d="${HEART_D}" fill="${C.coral}" stroke="${C.coralDeep}" stroke-width="1.4"/></g>
    <g transform="translate(34 22) scale(1.15)"><path d="${HEART_D}" fill="${C.coral}" stroke="${C.coralDeep}" stroke-width="1.4"/></g>
    <g transform="translate(60 22) scale(1.15)"><path d="${HEART_D}" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.6" stroke-dasharray="3 2.5"/></g>`,
  daily: `${WATER_BG}
    <rect x="26" y="12" width="44" height="48" rx="8" fill="${C.cream}" stroke="#0b1d26" stroke-width="2"/>
    <path d="M26 20a8 8 0 0 1 8-8h28a8 8 0 0 1 8 8v4H26z" fill="${C.gold}" stroke="#0b1d26" stroke-width="2"/>
    <path d="M36 8v8M60 8v8" stroke="#0b1d26" stroke-width="3" stroke-linecap="round"/>
    <path d="M42 30c10 4-6 10 4 14s-4 8 4 10" stroke="${C.water}" stroke-width="5" fill="none" stroke-linecap="round"/>`,
};

export function illustration(name: Illustration): SVGSVGElement {
  return svgFrom(`<svg viewBox="0 0 96 72">${SCENES[name]}</svg>`, `ill ill-${name}`);
}
