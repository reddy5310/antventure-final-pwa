// One icon family for the whole UI: 24×24 grid, 2px round strokes in
// currentColor, the occasional solid fill. Drawn here (no icon fonts or files)
// so icons inherit text colour and stay crisp at any size.

function cogPath(): string {
  const teeth = 8;
  const rIn = 7.3;
  const rOut = 9.7;
  const twIn = 0.24;
  const twOut = 0.15;
  const pt = (r: number, a: number) => `${(12 + r * Math.cos(a)).toFixed(2)} ${(12 + r * Math.sin(a)).toFixed(2)}`;
  let d = '';
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2 - Math.PI / 2;
    d += `${i === 0 ? 'M' : 'L'}${pt(rIn, a - twIn)}L${pt(rOut, a - twOut)}L${pt(rOut, a + twOut)}L${pt(rIn, a + twIn)}`;
  }
  return `${d}Z`;
}

const CLOUD = '<path d="M7.5 14h9a3.5 3.5 0 0 0 .4-6.98A5 5 0 0 0 7.3 7.6 3.2 3.2 0 0 0 7.5 14z"/>';
const SPEAKER = '<path d="M4 9.5h3l4.5-4v13l-4.5-4H4z" fill="currentColor"/>';

const PATHS = {
  play: '<path d="M8.5 5.8v12.4c0 .8.9 1.3 1.6.8l9.3-6.2a1 1 0 0 0 0-1.6L10.1 5c-.7-.5-1.6 0-1.6.8z" fill="currentColor" stroke="none"/>',
  pause:
    '<rect x="6.5" y="5" width="3.6" height="14" rx="1.3" fill="currentColor" stroke="none"/>' +
    '<rect x="13.9" y="5" width="3.6" height="14" rx="1.3" fill="currentColor" stroke="none"/>',
  settings: `<path d="${cogPath()}"/><circle cx="12" cy="12" r="3"/>`,
  trophy:
    '<path d="M7.5 4h9v5a4.5 4.5 0 0 1-9 0z"/>' +
    '<path d="M7.5 6H5v1.2a3.6 3.6 0 0 0 3 3.5M16.5 6H19v1.2a3.6 3.6 0 0 1-3 3.5"/>' +
    '<path d="M12 13.5v3.5M8.5 20h7M9.5 17h5"/>',
  help:
    '<circle cx="12" cy="12" r="9.2"/>' +
    '<path d="M9.4 9.4a2.7 2.7 0 0 1 5.2.9c0 1.8-2.6 2.2-2.6 3.7"/>' +
    '<circle cx="12" cy="17.1" r="1.15" fill="currentColor" stroke="none"/>',
  soundOn: `${SPEAKER}<path d="M15 9.2a4 4 0 0 1 0 5.6M17.6 6.6a7.6 7.6 0 0 1 0 10.8"/>`,
  soundOff: `${SPEAKER}<path d="M15.5 9.5l5 5M20.5 9.5l-5 5"/>`,
  install: '<path d="M12 4v10M8 10.5l4 4 4-4"/><path d="M5 15.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2.5"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  edit: '<path d="M15.6 5.4l3 3L9 18l-4 1 1-4z"/><path d="M13.6 7.4l3 3"/>',
  share:
    '<path d="M12 14.5V4M8.2 7.6L12 3.8l3.8 3.8"/>' +
    '<path d="M8.5 10.5H7a2 2 0 0 0-2 2V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5.5a2 2 0 0 0-2-2h-1.5"/>',
  home: '<path d="M4.5 11L12 4.5l7.5 6.5"/><path d="M6.5 9.5V19a1 1 0 0 0 1 1H10v-5h4v5h2.5a1 1 0 0 0 1-1V9.5"/>',
  restart: '<path d="M4.5 12a7.5 7.5 0 1 0 1-3.75"/><path d="M5.5 4.3v3.95h3.95"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="14.5" rx="2.5"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
  flag: '<path d="M6 21V4"/><path d="M6 4.5h11l-2.2 3.7L17 12H6" fill="currentColor" fill-opacity=".25"/>',
  calm:
    '<circle cx="12" cy="12" r="3.8"/>' +
    '<path d="M12 3.5v1.8M12 18.7v1.8M3.5 12h1.8M18.7 12h1.8M6 6l1.3 1.3M16.7 16.7L18 18M6 18l1.3-1.3M16.7 7.3L18 6"/>',
  drizzle: `${CLOUD}<path d="M9 17.2l-.5 1.4M12.5 17.2l-.5 1.4M16 17.2l-.5 1.4"/>`,
  downpour: `${CLOUD}<path d="M8.6 16.6l-1.2 3.6M12.3 16.6l-1.2 3.6M16 16.6l-1.2 3.6"/>`,
  cloudburst: `${CLOUD}<path d="M13 14.5l-2.4 3.6h3.1l-2.4 3.6" stroke-width="2.2"/>`,
  heart:
    '<path d="M12 20c-.4 0-.8-.15-1.1-.4C6.3 15.9 3.5 13 3.5 9.4A4.6 4.6 0 0 1 8.1 4.8c1.6 0 3 .8 3.9 2.1.9-1.3 2.3-2.1 3.9-2.1a4.6 4.6 0 0 1 4.6 4.6c0 3.6-2.8 6.5-7.4 10.2-.3.25-.7.4-1.1.4z"/>',
  gamepad:
    '<path d="M7.6 7.5h8.8a4.5 4.5 0 0 1 4.4 3.6l.9 4.7a2.4 2.4 0 0 1-4.1 2.1L15.8 16H8.2l-1.8 1.9a2.4 2.4 0 0 1-4.1-2.1l.9-4.7a4.5 4.5 0 0 1 4.4-3.6z"/>' +
    '<path d="M7.6 10.4v3.2M6 12h3.2"/>' +
    '<circle cx="15.6" cy="11" r="1" fill="currentColor" stroke="none"/>' +
    '<circle cx="17.6" cy="13" r="1" fill="currentColor" stroke="none"/>',
  keyboard:
    '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/>' +
    '<path d="M6.5 9.8h0M9.8 9.8h0M13.1 9.8h0M16.4 9.8h0M8 14.2h8" stroke-width="2.2"/>',
  mouse: '<rect x="7" y="3.5" width="10" height="17" rx="5"/><path d="M12 7v3"/>',
  touch:
    '<path d="M9.6 12.5V5.2a1.6 1.6 0 0 1 3.2 0v5.6l3.7.7a2.2 2.2 0 0 1 1.8 2.6l-.8 4.2A2.6 2.6 0 0 1 15 20.5h-3.4a3 3 0 0 1-2.3-1.1l-3.1-3.8a1.5 1.5 0 0 1 2.2-2l1.2 1.1"/>',
  drop: '<path d="M12 3.5c3 3.9 6 7.3 6 10.6a6 6 0 0 1-12 0c0-3.3 3-6.7 6-10.6z"/>',
  clock: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.5V12l3 2"/>',
  sparkle: '<path d="M12 3c.6 4.2 2.2 6.6 7 9-4.8 2.4-6.4 4.8-7 9-.6-4.2-2.2-6.6-7-9 4.8-2.4 6.4-4.8 7-9z"/>',
  crown: '<path d="M4 8.5l4.2 3.8L12 6l3.8 6.3L20 8.5 18.6 18H5.4z"/><path d="M5.4 21h13.2"/>',
  up: '<path d="M12 20V5M6.5 10.5L12 5l5.5 5.5"/>',
  bolt: '<path d="M13.2 3L5.5 13.4h5.8l-1 7.6 7.7-10.4h-5.8z"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  steer: '<path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4"/>',
  leaf: '<path d="M5 19C5 10 10 5 19 5c0 9-5 14-14 14z"/><path d="M5 19l8.5-8.5"/>',
  rock: '<path d="M3.8 18l2.6-6.4 4.4-3.8 5.2 1.1 3.6 4.4 1 4.7z"/><path d="M10.8 7.8l1.4 4.2"/>',
  arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
} as const;

export type IconName = keyof typeof PATHS;

const cache = new Map<IconName, SVGSVGElement>();

/** A fresh <svg> for the icon. Parsed once per name, then cloned. */
export function icon(name: IconName, cls = 'icon'): SVGSVGElement {
  let tpl = cache.get(name);
  if (!tpl) {
    const t = document.createElement('template');
    t.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`;
    tpl = t.content.firstElementChild as SVGSVGElement;
    cache.set(name, tpl);
  }
  const svg = tpl.cloneNode(true) as SVGSVGElement;
  svg.setAttribute('class', cls);
  return svg;
}

/** Parse trusted static SVG markup (illustrations) into an element. */
export function svgFrom(markup: string, cls?: string): SVGSVGElement {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  const svg = t.content.firstElementChild as SVGSVGElement;
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  if (cls) svg.setAttribute('class', cls);
  return svg;
}
