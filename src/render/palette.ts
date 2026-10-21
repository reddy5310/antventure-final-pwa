// One deliberate "cozy jungle storm" palette. Every named colour the renderer
// uses comes from here so the art stays coherent (only translucent shadow and
// glow tints are written inline next to the gradients that use them). Gameplay-critical elements (drop
// telegraphs, the ant) are separated from the scenery by luminance, not hue, so
// they read for colour-blind players too.

export const P = {
  // Jungle floor and foliage, darkest to lightest.
  jungleDeep: '#0a2016',
  jungleDark: '#12321f',
  jungle: '#1a4429',
  foliageDeep: '#1c5233',
  foliageDark: '#236140',
  foliage: '#2f7a49',
  foliageLight: '#4c9e57',
  foliageLime: '#8acb5f',
  fernDark: '#1d5a3f',
  fern: '#368a5d',
  fernLight: '#68bd78',
  canopyDark: '#143d2b',
  canopy: '#1f5a3a',
  canopyLight: '#2f7848',

  // Banks.
  mud: '#3e2c20',
  mudWet: '#291c14',
  root: '#5c3f29',
  rootLight: '#86603f',
  pebble: '#7d8a8c',
  pebbleLight: '#b3bfbf',

  // Flowers and other warm accents that make the jungle feel cosy.
  flowerPink: '#ff7aa8',
  flowerCoral: '#ff9a68',
  flowerYellow: '#ffd76a',
  flowerViolet: '#b893ff',
  flowerWhite: '#fff6ea',
  mushroom: '#ee7a3f',
  mushroomDots: '#fff1dc',

  // Water.
  waterDeep: '#0e5467',
  waterMid: '#167686',
  waterShallow: '#2a9d98',
  waterLight: '#5fcab9',
  waterShade: '#05202b',
  foam: '#eafffa',
  lily: '#3e8d4a',
  lilyDark: '#2a6a3a',
  lilyLight: '#6cb862',

  // Rocks.
  rockDark: '#38434c',
  rock: '#5f6c76',
  rockLight: '#8e9ca6',
  rockTop: '#bccad1',
  moss: '#5c9a48',
  mossLight: '#86c066',

  // Twigs.
  barkDark: '#3f2717',
  bark: '#6e4a2d',
  barkLight: '#a07448',

  // The player's leaf.
  leafEdge: '#2a6528',
  leafDark: '#468f35',
  leaf: '#62b343',
  leafLight: '#93d65e',
  leafVein: '#d0f0a0',
  stem: '#6f8c34',

  // The ant: dark body so it pops against the light leaf by luminance.
  antOutline: '#140a09',
  antDark: '#2a1613',
  ant: '#4b211a',
  antMid: '#7e3523',
  antHighlight: '#cf6643',

  // Drop telegraphs.
  shadow: '#03101a',
  ringLight: '#f6fcff',
  ringDark: '#020d15',
  dropBody: '#d8f1ff',

  // Effects and accents.
  gold: '#ffd166',
  goldDeep: '#f2a12a',
  goldLight: '#fff1b8',
  danger: '#ff4d5e',
  dangerDeep: '#b3122a',
  rain: '#cfe6ff',
  signWood: '#8a5e37',
  signWoodDark: '#4d321d',
  ink: '#1b120d',
  white: '#ffffff',
} as const;

/** Confetti colours (bright, varied luminance so it sparkles on any background). */
export const CONFETTI = [P.gold, P.flowerPink, P.waterLight, P.flowerViolet, P.white, P.flowerCoral] as const;

/** Near-miss text colours by combo tier: all light, so the dark outline always reads. */
export const COMBO_TIERS = ['#ffffff', '#fff1a6', P.gold, '#ffad5c', '#ff86c2'] as const;

/** Combo count → tier index into COMBO_TIERS. */
export function comboTier(combo: number): number {
  if (combo >= 20) return 4;
  if (combo >= 12) return 3;
  if (combo >= 6) return 2;
  if (combo >= 2) return 1;
  return 0;
}

/** Rounded, friendly display font (loaded by the UI); system fallbacks keep text legible before it arrives. */
export const FONT_FAMILY = '"Fredoka Variable", "Fredoka", ui-rounded, "Nunito", system-ui, sans-serif';
