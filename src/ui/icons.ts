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
  // --- Phase 2: pickups. Silhouettes match the canvas bubbles (render/pickups.ts):
  // dome and stem, hexagon and drop, round body with head, long body with wings.
  crumb:
    '<path d="M4.8 11.2l2.6-5.4 6.2-1.8 5 3.4 1.6 6-3.6 4.6-6.4 1.2-4.2-3.2z"/>' +
    '<path d="M7.4 5.8l3.6 4.4 7.6-2.8M11 10.2l-.8 7.2"/>',
  mushroom:
    '<path d="M3.5 12.5a8.5 8 0 0 1 17 0z"/>' +
    '<path d="M9.4 12.8v4.9a2.6 2.6 0 0 0 5.2 0v-4.9"/>' +
    '<circle cx="8.4" cy="9.4" r="1.25" fill="currentColor" stroke="none"/>' +
    '<circle cx="14.2" cy="8.2" r="1.5" fill="currentColor" stroke="none"/>' +
    '<circle cx="17" cy="10.8" r=".9" fill="currentColor" stroke="none"/>',
  honey:
    '<path d="M12 3l7.4 4.25v8.5L12 20l-7.4-4.25v-8.5z"/>' +
    '<path d="M12 8.2c1.8 2.2 2.9 3.5 2.9 4.9a2.9 2.9 0 0 1-5.8 0c0-1.4 1.1-2.7 2.9-4.9z" fill="currentColor" fill-opacity=".3"/>',
  ladybug:
    '<path d="M8.4 8.2A3.7 3.1 0 0 1 12 5.1a3.7 3.1 0 0 1 3.6 3.1"/>' +
    '<path d="M12 8v12.2M6.2 10.2A6.6 6.6 0 0 0 5.6 13c0 3.9 2.9 7.2 6.4 7.2s6.4-3.3 6.4-7.2c0-1-.2-1.9-.6-2.8"/>' +
    '<path d="M6.2 10.2c1.7-1.5 3.6-2.2 5.8-2.2s4.1.7 5.8 2.2M9.4 5L8 3M14.6 5L16 3"/>' +
    '<circle cx="8.8" cy="13" r="1.15" fill="currentColor" stroke="none"/>' +
    '<circle cx="15.2" cy="13" r="1.15" fill="currentColor" stroke="none"/>' +
    '<circle cx="9.4" cy="17" r=".9" fill="currentColor" stroke="none"/>' +
    '<circle cx="14.6" cy="17" r=".9" fill="currentColor" stroke="none"/>',
  firefly:
    '<circle cx="12" cy="6.4" r="1.6"/>' +
    '<path d="M12 8v3.4"/>' +
    '<ellipse cx="12" cy="15.2" rx="2.7" ry="3.5" fill="currentColor" fill-opacity=".35"/>' +
    '<path d="M10.4 10.2C7.6 10.2 5 8.8 3.8 5.8c3.2-.4 5.6.8 6.6 3.4M13.6 10.2c2.8 0 5.4-1.4 6.6-4.4-3.2-.4-5.6.8-6.6 3.4"/>' +
    '<path d="M12 20.4v1.6M7.6 18.8l-1.5 1M16.4 18.8l1.5 1" stroke-width="1.8"/>',
  // --- Phase 2: zones.
  zoneJungle:
    '<path d="M12.2 20.5c0-4.2.2-7.2.6-9.5"/>' +
    '<path d="M12.8 11C10.5 7.6 7.3 7 4 8.4c2-2.5 5.6-3.3 8.8-2.1"/>' +
    '<path d="M12.8 11c2-3.4 5.2-4.4 8.2-3.4-1.5-2.4-4.9-3.2-8.2-1.6"/>' +
    '<path d="M12.7 12.5c-2.6-.3-5 .8-6.6 3M12.9 12.5c2.6-.3 5 .8 6.6 3"/>',
  zoneMarsh:
    '<path d="M11.6 13.4l8-1.6A7.9 7.9 0 1 1 17.9 8.2z"/>' +
    '<path d="M11.6 13.4l-4.4 3.2M11.6 13.4l-4.9-2.7"/>',
  zoneRapids:
    '<path d="M2.8 8c1.9 0 1.9-1.9 3.8-1.9S8.5 8 10.4 8s1.9-1.9 3.8-1.9S16.1 8 18 8s1.6-1.2 3.2-1.8"/>' +
    '<path d="M2.8 13c1.9 0 1.9-1.9 3.8-1.9S8.5 13 10.4 13s1.9-1.9 3.8-1.9S16.1 13 18 13s1.6-1.2 3.2-1.8"/>' +
    '<path d="M2.8 18c1.9 0 1.9-1.9 3.8-1.9S8.5 18 10.4 18s1.9-1.9 3.8-1.9S16.1 18 18 18s1.6-1.2 3.2-1.8"/>',
  zoneNight:
    '<path d="M19.6 14.6A8.2 8.2 0 1 1 9.4 4.4a6.6 6.6 0 0 0 10.2 10.2z"/>' +
    '<path d="M17.4 3.2v3.2M15.8 4.8H19" stroke-width="1.7"/>',
  // --- Phase 3: meta. Flame (streak), bag (shop), medal (badges), padlock (locked).
  flame:
    '<path d="M12 3c.5 3.2 3.4 4.8 4.7 7.6A6 6 0 0 1 12 21a6.2 6.2 0 0 1-6.2-6.4c0-2.2 1.1-3.9 2.6-5.2.2 1.5.9 2.4 1.8 2.8C9.9 8.9 10.6 5.4 12 3z"/>' +
    '<path d="M12 20.6c-1.6 0-2.8-1.2-2.8-2.8 0-1.4 1.1-2.4 2.8-4 1.7 1.6 2.8 2.6 2.8 4 0 1.6-1.2 2.8-2.8 2.8z" fill="currentColor" fill-opacity=".35"/>',
  shop: '<path d="M5.5 8h13l-1 11.2a1.6 1.6 0 0 1-1.6 1.4H8.1a1.6 1.6 0 0 1-1.6-1.4z"/><path d="M9 10.5V7a3 3 0 0 1 6 0v3.5"/>',
  medal:
    '<circle cx="12" cy="9" r="5.6"/>' +
    '<path d="M12 6.4l.95 1.95 2.1.3-1.5 1.5.35 2.1L12 11.2l-1.9 1 .35-2.1-1.5-1.5 2.1-.3z" fill="currentColor" fill-opacity=".3" stroke-width="1.4"/>' +
    '<path d="M8.6 13.6L7 20.5l5-2.3 5 2.3-1.6-6.9"/>',
  lock: '<rect x="5.5" y="10.5" width="13" height="9.5" rx="2.4"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
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
