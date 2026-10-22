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
  ring: '#f6fcff',
  ringDark: '#020d15',
  dropBody: '#d8f1ff',
  rainFill: '#9fe0ff',
  rainRim: '#d2f3ff',
  foam: '#eafffa',
  // Warm river stone, the same family as the canvas rocks (render/palette).
  rockDark: '#3a2f28',
  rockSide: '#55463b',
  rock: '#7c6957',
  rockLight: '#a8927a',
  rockTop: '#d8c8aa',
  moss: '#5c9a48',
  bark: '#6e4a2d',
  barkLight: '#a07448',
  barkDark: '#3f2717',
  coral: '#ff5d6c',
  coralDeep: '#b3122a',
  gold: '#ffc24b',
  cream: '#f4f1e8',
  crumb: '#ffe296',
  crumbEdge: '#5a3716',
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

/** A sugar crumb (same faceted chunk as the canvas pickup), centred on (x, y). */
function crumbMarkup(x: number, y: number, s: number): string {
  return `<g transform="translate(${x} ${y}) scale(${s})">
    <path d="M-5.5-2l3-3.6 5.4.4 3.3 3.4-1.4 4.8-4.6 2.4-4.4-1.6z" fill="${C.crumb}" stroke="${C.crumbEdge}" stroke-width="1.5" stroke-linejoin="round"/>
    <path d="M-2.5-5.2l2.4 3.8 5.7.6M-.1-1.4l-.8 5.6" stroke="#fff7d6" stroke-width=".9" stroke-linecap="round" fill="none" opacity=".85"/>
  </g>`;
}

/**
 * A rain circle like the canvas telegraph: pale water, a dashed light rim on a
 * thin dark under-stroke (a zone, never a solid thing) and a teardrop in the
 * middle, plus the closing ring. 'anim' animates the ring and the teardrop (CSS);
 * 'still' freezes the ring a little outside the rim, so both stay visible.
 */
function rainMarkup(cx: number, cy: number, r: number, mode: 'anim' | 'still'): string {
  const ty = cy - r * 0.42;
  const close = mode === 'anim' ? ' class="ill-close"' : '';
  const rr = mode === 'anim' ? r : r + 3.5;
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${C.rainFill}" fill-opacity=".38"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${C.ringDark}" stroke-opacity=".4" stroke-width="3.4"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${C.rainRim}" stroke-width="1.8" stroke-dasharray="4.2 3.2" stroke-linecap="round"/>
    <circle${close} cx="${cx}" cy="${cy}" r="${rr}" fill="none" stroke="${C.ringDark}" stroke-opacity=".5" stroke-width="4.4"/>
    <circle${close} cx="${cx}" cy="${cy}" r="${rr}" fill="none" stroke="${C.ring}" stroke-width="2.4"/>
    <g${mode === 'anim' ? ' class="ill-grow"' : ''}>
      <path d="M${cx} ${ty}c3 3.8 5.2 6.2 5.2 9a5.2 5.2 0 0 1-10.4 0c0-2.8 2.2-5.2 5.2-9z" fill="${C.dropBody}" stroke="${C.ringDark}" stroke-opacity=".75" stroke-width="1.2" stroke-linejoin="round"/>
      <path d="M${cx - 2.4} ${ty + 10}a3 3 0 0 1 .8-2.6" fill="none" stroke="#fff" stroke-width="1.2" stroke-linecap="round"/>
    </g>`;
}

/**
 * A warm river stone, drawn at (dx, dy): a cast shadow to the lower right, a
 * darker side face under the top face (so it stands up out of the water), a
 * lit facet, moss and a crack, and the V of foam that streams away from its
 * shoulders. Spans roughly x 10..48, y 10..62.
 */
function rockMarkup(dx: number, dy: number): string {
  const body = 'M13 46L17 36L26 30L37 31L44 38L46 48L39 55L26 57L16 53Z';
  return `<g transform="translate(${dx} ${dy})">
    <ellipse cx="37" cy="61" rx="17" ry="4.4" fill="${C.ringDark}" opacity=".3"/>
    <g stroke="${C.foam}" stroke-linecap="round" fill="none">
      <path d="M23 33Q18 25 13 18M37 33Q42 25 45 18" stroke-width="2.2" opacity=".9"/>
      <path d="M13 18Q11 15 10.5 12M45 18Q46.5 15 47.5 12" stroke-width="1.6" opacity=".45"/>
    </g>
    <path d="${body}" transform="translate(0 4.5)" fill="${C.rockSide}" stroke="${C.rockDark}" stroke-width="2" stroke-linejoin="round"/>
    <path d="${body}" fill="${C.rock}" stroke="${C.rockDark}" stroke-width="2" stroke-linejoin="round"/>
    <path d="M16 53L26 57L39 55L46 48L40 46L28 50Z" fill="${C.rockDark}" opacity=".28"/>
    <path d="M19 38L26 33L36 34L41 40L30 42Z" fill="${C.rockLight}" opacity=".9"/>
    <path d="M19.5 37.6L26 33.2L33 33.6" stroke="${C.rockTop}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity=".9"/>
    <path d="M18 49c3 3 8 4 12 3-3 3-9 3-12-3z" fill="${C.moss}"/>
    <path d="M35 43l3 4-2 4" stroke="${C.rockDark}" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity=".65"/>
  </g>`;
}

export type Illustration = 'rain-vs-rock' | 'shadows' | 'near-miss' | 'obstacles' | 'hearts' | 'crumbs' | 'daily';

const SCENES: Record<Illustration, string> = {
  // Rain on the left, rock on the right: the two things players mixed up, side by side.
  'rain-vs-rock': `${WATER_BG}
    ${rainMarkup(26, 38, 15, 'still')}
    <path d="M48 12v48" stroke="#fff" stroke-opacity=".3" stroke-width="1.4" stroke-dasharray="2 3.2" stroke-linecap="round"/>
    ${rockMarkup(44, -4)}`,
  shadows: `${WATER_BG}
    ${rainMarkup(38, 44, 17, 'anim')}
    ${leafMarkup(76, 48, 0.36, -8)}
    ${antMarkup(75, 47, 0.42)}`,
  'near-miss': `${WATER_BG}
    <circle cx="34" cy="42" r="17" fill="none" stroke="${C.foam}" stroke-width="3" opacity=".9"/>
    <circle cx="34" cy="42" r="9" fill="none" stroke="${C.foam}" stroke-width="2" opacity=".55"/>
    ${leafMarkup(70, 46, 0.42, 10)}
    ${antMarkup(69, 45, 0.5)}
    <path d="M56 17c.4 3 1.6 4.8 5 6.5-3.4 1.7-4.6 3.5-5 6.5-.4-3-1.6-4.8-5-6.5 3.4-1.7 4.6-3.5 5-6.5z" fill="${C.gold}"/>
    <text x="64" y="21" fill="${C.gold}" font-size="13" font-weight="700" stroke="#3a2300" stroke-width="3" paint-order="stroke">+25</text>`,
  obstacles: `${WATER_BG}
    ${rockMarkup(-2, -3)}
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
  crumbs: `${WATER_BG}
    ${crumbMarkup(14, 14, 1)}${crumbMarkup(26, 25, 1)}${crumbMarkup(36, 38, 1)}${crumbMarkup(48, 50, 1)}${crumbMarkup(62, 58, 1)}
    ${leafMarkup(78, 48, 0.36, 8)}
    ${antMarkup(77, 47, 0.42)}
    <path d="M52 15c.4 3 1.6 4.8 5 6.5-3.4 1.7-4.6 3.5-5 6.5-.4-3-1.6-4.8-5-6.5 3.4-1.7 4.6-3.5 5-6.5z" fill="${C.gold}"/>
    <text x="60" y="26" fill="${C.gold}" font-size="13" font-weight="700" stroke="#3a2300" stroke-width="3" paint-order="stroke">+10</text>`,
  daily: `${WATER_BG}
    <rect x="26" y="12" width="44" height="48" rx="8" fill="${C.cream}" stroke="#0b1d26" stroke-width="2"/>
    <path d="M26 20a8 8 0 0 1 8-8h28a8 8 0 0 1 8 8v4H26z" fill="${C.gold}" stroke="#0b1d26" stroke-width="2"/>
    <path d="M36 8v8M60 8v8" stroke="#0b1d26" stroke-width="3" stroke-linecap="round"/>
    <path d="M42 30c10 4-6 10 4 14s-4 8 4 10" stroke="${C.water}" stroke-width="5" fill="none" stroke-linecap="round"/>`,
};

export function illustration(name: Illustration): SVGSVGElement {
  return svgFrom(`<svg viewBox="0 0 96 72">${SCENES[name]}</svg>`, `ill ill-${name}`);
}
