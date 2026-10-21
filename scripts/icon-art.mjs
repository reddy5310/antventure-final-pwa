// Vector art for the app icon, favicon and social card. Everything is built
// from the same geometry the game renderer uses (src/render/leaf.ts and
// src/render/ant.ts, in world units) so the icon *is* the game's hero, just
// scaled up. Colours come from src/render/palette.ts.
//
// Exports plain SVG/HTML strings; scripts/make-icons.mjs rasterises them.

export const C = {
  bg: '#0b1d26',
  bgDeep: '#061219',
  waterDeep: '#0e5467',
  waterMid: '#167686',
  waterLight: '#5fcab9',
  foam: '#eafffa',
  shadow: '#03101a',
  ringLight: '#f6fcff',
  ringDark: '#020d15',
  rain: '#cfe6ff',
  dropBody: '#d8f1ff',
  leafEdge: '#2a6528',
  leafDark: '#468f35',
  leaf: '#62b343',
  leafLight: '#93d65e',
  leafVein: '#d0f0a0',
  stem: '#6f8c34',
  antOutline: '#140a09',
  antDark: '#2a1613',
  ant: '#4b211a',
  antMid: '#7e3523',
  antHighlight: '#cf6643',
  jungleDeep: '#0a2016',
  jungleDark: '#12321f',
  jungle: '#1a4429',
  foliageDark: '#236140',
  foliage: '#2f7a49',
  foliageLight: '#4c9e57',
  gold: '#ffd166',
  amber: '#ffc24b',
  lime: '#b6e86f',
  text: '#f6f1e3',
  textDim: '#b7c8c3',
  flowerPink: '#ff7aa8',
};

const LEAF_W = 78;
const LEAF_H = 50;
const r2 = (n) => Math.round(n * 100) / 100;

/** The game's heart-shaped leaf outline (tip forward = up), centred on 0,0. */
export function leafPath(hw = LEAF_W / 2, hh = LEAF_H / 2) {
  const p = (x, y) => `${r2(x * hw)} ${r2(y * hh)}`;
  return [
    `M${p(0, -1)}`,
    `C${p(0.27, -0.88)} ${p(0.96, -0.56)} ${p(0.99, 0.08)}`,
    `C${p(1.01, 0.6)} ${p(0.77, 0.96)} ${p(0.46, 0.98)}`,
    `C${p(0.23, 1)} ${p(0.08, 0.8)} ${p(0, 0.56)}`,
    `C${p(-0.08, 0.8)} ${p(-0.23, 1)} ${p(-0.46, 0.98)}`,
    `C${p(-0.77, 0.96)} ${p(-1.01, 0.6)} ${p(-0.99, 0.08)}`,
    `C${p(-0.96, -0.56)} ${p(-0.27, -0.88)} ${p(0, -1)}Z`,
  ].join('');
}

/**
 * The leaf in world units. `detail` 'high' adds veins, monstera splits and
 * beads; 'low' keeps only shapes that survive at 16-32 px.
 */
function leafMarkup(id, detail) {
  const hw = LEAF_W / 2;
  const hh = LEAF_H / 2;
  const shape = leafPath(hw, hh);
  const high = detail === 'high';
  const splits = [
    [1, 0.2, 0.12],
    [1, -0.18, 0.1],
    [-1, 0.16, 0.12],
    [-1, -0.46, 0.1],
  ]
    .map(([s, ry, w]) => {
      const y = ry * hh;
      return `<path d="M${r2(s * hw * 1.06)} ${r2(y - hh * 0.3)}L${r2(s * hw * 0.62)} ${r2(y - hh * 0.12)}L${r2(s * hw * 1.06)} ${r2(y - hh * (0.3 - w * 2))}Z"/>`;
    })
    .join('');
  const ribs = [0.36, 0.02, -0.32, -0.6]
    .flatMap((ry) => {
      const y = ry * hh;
      return [-1, 1].map((s) => `M0 ${r2(y)}Q${r2(s * hw * 0.45)} ${r2(y - hh * 0.05)} ${r2(s * hw * 0.84)} ${r2(y - hh * 0.36)}`);
    })
    .concat([-1, 1].map((s) => `M0 ${r2(hh * 0.52)}Q${r2(s * hw * 0.3)} ${r2(hh * 0.62)} ${r2(s * hw * 0.62)} ${r2(hh * 0.78)}`))
    .join('');
  const beads = [
    [-hw * 0.55, -hh * 0.1, 1.6],
    [hw * 0.5, hh * 0.3, 1.3],
    [-hw * 0.2, hh * 0.68, 1.1],
    [hw * 0.18, -hh * 0.55, 1.2],
  ]
    .map(
      ([x, y, r]) =>
        `<circle cx="${r2(x + 0.4)}" cy="${r2(y + 0.5)}" r="${r}" fill="#14461e" fill-opacity=".35"/>` +
        `<circle cx="${r2(x)}" cy="${r2(y)}" r="${r}" fill="#e1faff" fill-opacity=".8"/>` +
        `<circle cx="${r2(x - r * 0.35)}" cy="${r2(y - r * 0.35)}" r="${r2(r * 0.35)}" fill="#fff"/>`,
    )
    .join('');

  return `
  <defs>
    <clipPath id="${id}-clip"><path d="${shape}"/></clipPath>
    ${high ? `<mask id="${id}-mask" maskUnits="userSpaceOnUse" x="-60" y="-50" width="120" height="100"><rect x="-60" y="-50" width="120" height="100" fill="#fff"/><g fill="#000">${splits}</g></mask>` : ''}
  </defs>
  <path d="M0 ${r2(hh * 0.5)}Q1 ${hh + 4} 3.5 ${hh + 12}" fill="none" stroke="${C.leafEdge}" stroke-width="${high ? 4.6 : 6}" stroke-linecap="round"/>
  <path d="M0 ${r2(hh * 0.5)}Q1 ${hh + 4} 3.5 ${hh + 12}" fill="none" stroke="${C.stem}" stroke-width="${high ? 2.8 : 3.6}" stroke-linecap="round"/>
  <g${high ? ` mask="url(#${id}-mask)"` : ''}>
    <path d="${shape}" fill="${C.leaf}"/>
    <g clip-path="url(#${id}-clip)">
      <rect x="${-hw - 2}" y="${-hh - 2}" width="${hw + 2}" height="${LEAF_H + 4}" fill="${C.leafLight}" fill-opacity=".7"/>
      <ellipse cx="${r2(hw * 0.7)}" cy="${r2(hh * 0.55)}" rx="${r2(hw * 0.55)}" ry="${r2(hh * 0.6)}" transform="rotate(-23 ${r2(hw * 0.7)} ${r2(hh * 0.55)})" fill="${C.leafDark}" fill-opacity=".45"/>
    </g>
    <g fill="none" stroke="${C.leafVein}" stroke-linecap="round">
      <path d="M0 ${r2(hh * 0.55)}Q.6 0 0 ${r2(-hh * 0.92)}" stroke-width="${high ? 2.1 : 3.2}" stroke-opacity=".85"/>
      ${high ? `<path d="${ribs}" stroke-width="1.05" stroke-opacity=".6"/>` : ''}
    </g>
    <path d="${shape}" fill="none" stroke="${C.leafEdge}" stroke-width="${high ? 1.5 : 2.4}"/>
  </g>
  ${high ? beads : ''}`;
}

// Leg geometry for the right side (the left mirrors it): attach, knee, foot.
const LEGS = [
  [2.3, -2.4, 7.0, -5.8, 8.2, -11.6],
  [2.9, -0.4, 8.4, -0.9, 12.3, 1.4],
  [2.5, 1.6, 7.3, 4.9, 9.6, 11.2],
];

/** The ant in world units, at rest, looking ahead. `bold` thickens limbs for tiny sizes. */
function antMarkup(bold) {
  const legW = bold ? 2.7 : 1.75;
  const antW = bold ? 2.1 : 1.25;
  const legs = [-1, 1]
    .flatMap((s) => LEGS.map((L) => `M${r2(L[0] * s)} ${L[1]}L${r2(L[2] * s)} ${L[3]}L${r2(L[4] * s)} ${L[5]}`))
    .join('');
  const antennae = [-1, 1]
    .map((s) => `M${1.9 * s} -12.2L${5 * s} -15.6Q${r2(5 * s)} -18.6 ${r2(3.4 * s)} -21.6`)
    .join('');
  const ell = (cx, cy, rx, ry, extra = '') => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"${extra}/>`;
  const blob = (cx, cy, rx, ry) => ell(cx, cy, rx, ry, ` transform="rotate(-20 ${cx} ${cy})"`);
  // Big pupils for small sizes: the eyes are what makes it read as a character.
  const pupil = bold ? 1.45 : 1.2;
  const eyeR = bold ? [2.35, 2.55] : [2.05, 2.25];
  return `
  <ellipse cx="1.4" cy="2.4" rx="8.5" ry="14.5" fill="#103412" fill-opacity=".32"/>
  <g fill="none" stroke="${C.antOutline}" stroke-linecap="round" stroke-linejoin="round">
    <path d="${legs}" stroke-width="${legW}"/>
    <path d="${antennae}" stroke-width="${antW}"/>
  </g>
  <g fill="${C.antOutline}">
    <circle cx="-3.4" cy="-21.6" r="${bold ? 1.6 : 1.15}"/><circle cx="3.4" cy="-21.6" r="${bold ? 1.6 : 1.15}"/>
  </g>
  <g fill="${C.ant}" stroke="${C.antOutline}" stroke-width="${bold ? 1.4 : 1.1}">
    ${ell(0, 8.6, 6.3, 7.5)}${ell(0, 3.3, 1.6, 1.6)}${ell(0, -0.5, 3.4, 4.1)}${ell(0, -8.6, 5.6, 5.1)}
  </g>
  ${
    bold
      ? ''
      : `<g fill="none" stroke="${C.antDark}" stroke-width=".9">
    <path d="M5.72 7.17A5.9 2.3 0 0 1 -5.72 7.17"/><path d="M4.57 10.92A4.8 2 0 0 1 -4.57 10.92"/>
  </g>`
  }
  <g fill="${C.antMid}">${blob(-1.6, 6.6, 3.2, 4)}${blob(-1, -1.4, 1.6, 2.2)}${blob(-1.6, -10.2, 2.8, 2.2)}</g>
  <g fill="${C.antHighlight}" fill-opacity=".65">${blob(-2.4, 5.4, 1.3, 1.9)}${blob(-2.5, -11.1, 1.2, 0.9)}</g>
  <g fill="#fff" fill-opacity=".45">${blob(-2.8, 4.6, 0.7, 1.1)}${blob(-1.1, -2.6, 0.5, 0.8)}</g>
  <path d="M1.3 -13.1Q2.6 -14.9 .5 -15.6M-1.3 -13.1Q-2.6 -14.9 -.5 -15.6" fill="none" stroke="${C.antOutline}" stroke-width="1.1" stroke-linecap="round"/>
  <g fill="#fff">
    ${ell(-2.7, -10, eyeR[0], eyeR[1], ' transform="rotate(-11.5 -2.7 -10)"')}${ell(2.7, -10, eyeR[0], eyeR[1], ' transform="rotate(11.5 2.7 -10)"')}
  </g>
  <g fill="${C.antOutline}"><circle cx="-2.7" cy="-10.75" r="${pupil}"/><circle cx="2.7" cy="-10.75" r="${pupil}"/></g>
  <g fill="#fff"><circle cx="-3.15" cy="-11.3" r=".5"/><circle cx="2.25" cy="-11.3" r=".5"/></g>`;
}

/**
 * Leaf + ant + wake + bow foam, in world units, centred on the leaf.
 * `antScale` enlarges the ant relative to the leaf for a bolder silhouette.
 */
function heroMarkup(id, { detail = 'high', antScale = 1.25, wake = true } = {}) {
  const hh = LEAF_H / 2;
  const high = detail === 'high';
  // Short foam chevrons trailing behind the stern: they read as motion without
  // turning into long "sticks" at icon scale.
  const chevrons = [
    [20, 30, 3.2, 0.6],
    [27, 47, 2.6, 0.38],
    [34, 63, 2, 0.22],
  ]
    .map(
      ([x, y, w, o]) =>
        `<path d="M${-x} ${y}q-6 7 -15 11M${x} ${y}q6 7 15 11" stroke-width="${w}" stroke-opacity="${o}"/>`,
    )
    .join('');
  const wakeLines = wake ? `<g fill="none" stroke="${C.foam}" stroke-linecap="round">${chevrons}</g>` : '';
  const bow = `<path d="M-15 ${-hh + 2}Q0 ${-hh - 8} 15 ${-hh + 2}" fill="none" stroke="${C.foam}" stroke-width="${high ? 2.4 : 3.2}" stroke-linecap="round" stroke-opacity=".7"/>`;
  return `
  ${wakeLines}
  <path d="${leafPath()}" transform="translate(3.5 5.5)" fill="${C.shadow}" fill-opacity=".42"/>
  ${bow}
  ${leafMarkup(id, detail)}
  <g transform="translate(-.5 -1.5) scale(${antScale})">${antMarkup(!high)}</g>`;
}

/** A drop telegraph: dark splash disc, faint rim and the closing ring (t = 0..1 towards impact). */
function telegraph(x, y, r, t, { stroke = 1 } = {}) {
  const rr = r * (1 + 1.25 * (1 - t) ** 1.35);
  return `
  <circle cx="${x}" cy="${y}" r="${r}" fill="${C.shadow}" fill-opacity="${r2(0.16 + 0.42 * t * t)}"/>
  <circle cx="${x}" cy="${y}" r="${r2(r * (0.22 + 0.5 * t))}" fill="${C.shadow}" fill-opacity="${r2(0.12 + 0.34 * t)}"/>
  <circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${C.ringLight}" stroke-opacity="${r2(0.16 + 0.34 * t)}" stroke-width="${r2(1.2 * stroke)}"/>
  <circle cx="${x}" cy="${y}" r="${r2(rr)}" fill="none" stroke="${C.ringDark}" stroke-opacity=".55" stroke-width="${r2(4.6 * stroke)}"/>
  <circle cx="${x}" cy="${y}" r="${r2(rr)}" fill="none" stroke="${C.ringLight}" stroke-opacity="${r2(0.55 + 0.45 * t)}" stroke-width="${r2(2.2 * stroke)}"/>`;
}

/** A raindrop falling toward its telegraph (seen slightly from the side, like the game's streak). */
function dropShape(x, y, s) {
  return `<g transform="translate(${x} ${y}) scale(${s})">
    <path d="M0 -14L0 -40" stroke="${C.rain}" stroke-opacity=".45" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M0 -12C3.2 -6.4 5.4 -3 5.4 .6A5.4 5.4 0 0 1 -5.4 .6C-5.4 -3 -3.2 -6.4 0 -12Z" fill="${C.dropBody}" stroke="${C.waterDeep}" stroke-width="1.2"/>
    <ellipse cx="-1.7" cy="0" rx="1.2" ry="2" fill="#fff" fill-opacity=".8"/>
  </g>`;
}

function rainStreaks(list, width) {
  return `<g stroke="${C.rain}" stroke-linecap="round" stroke-width="${width}">${list
    .map(([x, y, len, o]) => `<path d="M${x} ${y}l${r2(-len * 0.26)} ${len}" stroke-opacity="${o}"/>`)
    .join('')}</g>`;
}

function flowStreaks(list, width, opacity = 0.16) {
  return `<g stroke="${C.waterLight}" stroke-linecap="round" stroke-width="${width}" stroke-opacity="${opacity}" fill="none">${list
    .map(([x, y, len]) => `<path d="M${x} ${y}q4 ${len / 2} 0 ${len}"/>`)
    .join('')}</g>`;
}

/**
 * Flat water: stepped ripple discs spreading behind the leaf (each one a
 * little further downstream, like the wake widening). Flat tones instead of a
 * gradient keep the art crisp and the PNGs tiny (Chromium dithers gradients).
 */
function ripples(cx, cy, scale, { step = 16 } = {}) {
  const rings = [
    [1.0, '#0c2732'],
    [0.79, '#0e303c'],
    [0.6, '#103a47'],
    [0.43, '#124553'],
  ];
  return rings
    .map(([k, fill], i) => {
      const r = r2(330 * k * scale);
      const y = r2(cy + (rings.length - 1 - i) * step * scale);
      return `<circle cx="${cx}" cy="${y}" r="${r}" fill="${fill}"/><circle cx="${cx}" cy="${y}" r="${r}" fill="none" stroke="${C.waterLight}" stroke-opacity=".1" stroke-width="${r2(3 * scale)}"/>`;
    })
    .join('');
}

/**
 * Square app icon (512 viewBox).
 *  - 'any':      rounded square with transparent corners (desktop / launchers).
 *  - 'maskable': full-bleed water; the hero sits inside the 80% safe circle.
 *  - 'apple':    full-bleed (iOS rounds it; transparency would turn black).
 *  - 'favicon':  rounded square, simplified for 16-32 px.
 */
export function iconSvg(variant = 'any') {
  const id = `i-${variant}`;
  const tiny = variant === 'favicon';
  const rounded = variant === 'any' || variant === 'favicon';
  // Scale of the hero group: world units -> icon px.
  const scale = { any: 4.7, apple: 4.85, maskable: 4.25, favicon: 5.7 }[variant];
  const cx = 256;
  const cy = { any: 278, apple: 276, maskable: 266, favicon: 268 }[variant];
  const rot = tiny ? -10 : -12;
  const radius = tiny ? 104 : 112;

  // Background details are positioned in icon px; the maskable variant pulls
  // them in so the telegraph survives circular masks.
  const k = variant === 'maskable' ? 0.78 : 1;
  const at = (x, y) => [r2(256 + (x - 256) * k), r2(256 + (y - 256) * k)];
  const [tx, ty] = at(398, 120);
  const ringR = 40 * k;

  const water = tiny
    ? `<rect width="512" height="512" fill="#103a47"/>${ripples(cx, cy + 10, 0.62, { step: 10 })}`
    : `<rect width="512" height="512" fill="${C.bg}"/>${ripples(cx, cy - 6, variant === 'maskable' ? 0.9 : 1)}`;

  const details = tiny
    ? ''
    : `
    ${flowStreaks(
      [
        [...at(70, 150), 70],
        [...at(452, 300), 80],
        [...at(96, 360), 60],
        [...at(420, 420), 50],
        [...at(180, 54), 44],
      ],
      7,
    )}
    ${rainStreaks(
      [
        [...at(90, 48), 34, 0.55],
        [...at(150, 100), 26, 0.4],
        [...at(60, 250), 30, 0.45],
        [...at(470, 210), 26, 0.4],
        [...at(300, 40), 22, 0.35],
        [...at(455, 360), 30, 0.4],
      ],
      5,
    )}
    <g>${telegraph(tx, ty, r2(ringR), 0.55, { stroke: 3.4 * k })}</g>
    ${dropShape(tx, r2(ty - 6 * k), r2(2.2 * k))}`;

  const art = `${water}${details}
  <g transform="translate(${cx} ${cy}) rotate(${rot}) scale(${scale})">
    ${heroMarkup(id, { detail: tiny ? 'low' : 'high', antScale: tiny ? 1.38 : 1.25, wake: !tiny })}
  </g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  ${rounded ? `<defs><clipPath id="${id}-tile"><rect width="512" height="512" rx="${radius}"/></clipPath></defs><g clip-path="url(#${id}-tile)">${art}</g>` : art}
</svg>`;
}

/** A big jungle leaf silhouette for framing the social card. */
function jungleLeaf(x, y, rot, s, fill, vein) {
  return `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})">
    <path d="M0 0C30 -40 90 -60 150 -40C120 0 70 30 0 0Z" fill="${fill}"/>
    <path d="M6 -2C50 -22 95 -36 140 -38" fill="none" stroke="${vein}" stroke-width="3" stroke-linecap="round" stroke-opacity=".5"/>
  </g>`;
}

/**
 * The 1200x630 social card as a standalone HTML page. `fontUrl` is the
 * Fredoka variable woff2 (a data: URL, so it loads from about:blank) so the
 * title matches the in-game wordmark.
 */
export function ogHtml(fontUrl) {
  const id = 'og';
  // Art panel: the river scene on the left.
  // The river runs down the left of the card; its right bank frames the copy.
  const bankEdge = 'M640 0C590 120 630 230 580 330C535 420 590 530 550 630';
  const river = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <defs><clipPath id="og-river"><path d="M0 0H640C590 120 630 230 580 330C535 420 590 530 550 630H0Z"/></clipPath></defs>
  <rect width="1200" height="630" fill="${C.bg}"/>
  <g clip-path="url(#og-river)">
    <rect width="1200" height="630" fill="#0c2732"/>
    ${ripples(310, 330, 1.1, { step: 22 })}
    ${flowStreaks(
      [
        [120, 40, 90],
        [430, 30, 90],
        [150, 330, 100],
        [500, 430, 90],
        [300, 540, 80],
        [540, 230, 110],
      ],
      8,
      0.15,
    )}
    <g>${telegraph(470, 140, 46, 0.8, { stroke: 3.2 })}</g>
    ${dropShape(470, 132, 2.4)}
    <g>${telegraph(190, 480, 36, 0.35, { stroke: 2.8 })}</g>
    <g>${telegraph(470, 540, 28, 0.12, { stroke: 2.4 })}</g>
    ${rainStreaks(
      [
        [170, 60, 40, 0.5],
        [340, 30, 34, 0.4],
        [560, 60, 36, 0.4],
        [250, 250, 30, 0.35],
        [520, 300, 40, 0.45],
        [150, 300, 34, 0.4],
        [420, 570, 30, 0.35],
      ],
      5,
    )}
    <g transform="translate(312 335) rotate(-12) scale(5.1)">
      ${heroMarkup(id, { detail: 'high', antScale: 1.22, wake: true })}
    </g>
  </g>
  <path d="M0 0H70C96 120 50 220 84 330C112 430 60 520 88 630H0Z" fill="${C.jungleDark}"/>
  <path d="M0 0H40C62 120 22 220 52 330C80 430 32 520 56 630H0Z" fill="${C.jungleDeep}"/>
  <path d="M70 0C96 120 50 220 84 330C112 430 60 520 88 630" fill="none" stroke="${C.waterLight}" stroke-opacity=".3" stroke-width="5"/>
  <path d="${bankEdge}L580 630C620 530 565 420 610 330C660 230 620 120 670 0Z" fill="${C.jungleDark}"/>
  <path d="${bankEdge}" fill="none" stroke="${C.waterLight}" stroke-opacity=".3" stroke-width="5"/>
  ${jungleLeaf(-20, 120, -18, 1.2, C.foliageDark, C.foliageLight)}
  ${jungleLeaf(-30, 400, 12, 1.35, C.foliage, C.foliageLight)}
  ${jungleLeaf(10, 560, -30, 1.05, C.jungle, C.foliageLight)}
  ${jungleLeaf(700, 30, 160, 1.0, C.foliageDark, C.foliageLight)}
  ${jungleLeaf(640, 615, 200, 1.15, C.foliage, C.foliageLight)}
  ${jungleLeaf(1210, 640, 215, 1.3, C.jungle, C.foliageLight)}
  ${jungleLeaf(1215, -10, 150, 1.0, C.jungle, C.foliageLight)}
</svg>`;

  return `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  @font-face { font-family: 'Fredoka OG'; src: url('${fontUrl}') format('woff2'); font-weight: 300 700; }
  html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; background: ${C.bg}; }
  .card { position: relative; width: 1200px; height: 630px; font-family: 'Fredoka OG', sans-serif; color: ${C.text}; }
  .art { position: absolute; inset: 0; }
  .copy { position: absolute; left: 690px; right: 50px; top: 0; bottom: 0; display: flex; flex-direction: column; justify-content: center; }
  .title { margin: 0; font-size: 110px; font-weight: 700; line-height: .95; letter-spacing: .01em; white-space: nowrap;
    text-shadow: 0 3px 0 #1c5233, 0 6px 0 #12321f, 0 9px 0 #0a2016, 0 18px 30px rgba(0,0,0,.55); }
  .ant { color: ${C.lime}; }
  .sub { display: flex; align-items: center; gap: 14px; margin-top: 26px; font-size: 30px; font-weight: 600;
    letter-spacing: .26em; text-transform: uppercase; color: ${C.amber}; text-shadow: 0 2px 8px rgba(0,0,0,.6); }
  .sub::before, .sub::after { content: ''; width: 34px; height: 3px; border-radius: 3px; background: currentColor; opacity: .6; }
  .sub::after { display: none; }
  .tag { margin: 28px 0 0; font-size: 29px; font-weight: 500; line-height: 1.3; color: ${C.textDim}; }
  .chips { display: flex; gap: 10px; margin-top: 34px; flex-wrap: wrap; }
  .chip { padding: 8px 17px; border-radius: 999px; font-size: 21px; font-weight: 600; letter-spacing: .02em;
    background: rgba(255,255,255,.08); border: 2px solid rgba(255,255,255,.14); color: ${C.text}; }
  .chip.hot { background: ${C.amber}; border-color: ${C.amber}; color: #3a2300; }
</style></head>
<body><div class="card">
  <div class="art">${river}</div>
  <div class="copy">
    <h1 class="title"><span class="ant">ANT</span>VENTURE</h1>
    <div class="sub">Leaf of Fate</div>
    <p class="tag">Ride a leaf down a stormy jungle river. Read the rain, dodge by a hair, chain near-misses.</p>
    <div class="chips"><span class="chip hot">Daily River</span><span class="chip">Endless</span><span class="chip">Plays offline</span></div>
  </div>
</div>
<script>
  // Fit the wordmark to the copy column once the real font is in.
  window.fit = () => {
    const t = document.querySelector('.title');
    let size = 110;
    while (t.scrollWidth > t.clientWidth && size > 40) t.style.fontSize = (size -= 2) + 'px';
  };
</script></body></html>`;
}
