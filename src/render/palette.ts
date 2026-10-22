// One deliberate "cozy jungle storm" palette. Every named colour the renderer
// uses comes from here so the art stays coherent (only translucent shadow and
// glow tints are written inline next to the gradients that use them). Gameplay-critical elements (drop
// telegraphs, the ant) are separated from the scenery by luminance, not hue, so
// they read for colour-blind players too.

import type { ZoneId } from '../types';

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
export const COMBO_TIERS = ['#ffffff', '#fff1a6', P.gold, '#ffad5c', '#ff86c2', '#c9a2ff', '#8ff3ff'] as const;

/**
 * Combo count → tier index into COMBO_TIERS. Tiers keep climbing after the
 * multiplier caps (combo 16) so long chains still look and feel bigger.
 */
export function comboTier(combo: number): number {
  if (combo >= 40) return 6;
  if (combo >= 30) return 5;
  if (combo >= 20) return 4;
  if (combo >= 12) return 3;
  if (combo >= 6) return 2;
  if (combo >= 2) return 1;
  return 0;
}

/** Rounded, friendly display font (loaded by the UI); system fallbacks keep text legible before it arrives. */
export const FONT_FAMILY = '"Fredoka Variable", "Fredoka", ui-rounded, "Nunito", system-ui, sans-serif';

// --- Zone looks (Lily Marsh, Rapids, Night River) -----------------------------

/** A colour wash: r, g, b in 0..255 and alpha 0..1. Alpha 0 means "leave the Jungle look alone". */
export type Tint = readonly [r: number, g: number, b: number, a: number];

export const NO_TINT: Tint = [0, 0, 0, 0];

/**
 * Per-zone washes laid over the Jungle art (the Jungle is the baseline, so it
 * has none). Washes blend across a zone transition as a vertical gradient, so
 * the next zone's colours scroll into view before the leaf reaches them.
 */
export const ZONE_TINTS = {
  /** Over the water tile (before shallows, streaks and decorations). */
  water: {
    jungle: NO_TINT,
    // Brighter, greener, a touch warm: sunlit jade shallows.
    marsh: [104, 222, 158, 0.3],
    // Darker and bluer: deep, fast, cold water.
    rapids: [4, 34, 62, 0.42],
    // Deep blue-black; the darkness mask does the rest.
    night: [6, 20, 62, 0.62],
  },
  /** Over the bank floor, before the plants. */
  floor: {
    jungle: NO_TINT,
    marsh: [176, 214, 108, 0.3],
    rapids: [128, 128, 120, 0.5],
    night: [6, 14, 44, 0.5],
  },
  /**
   * Over the bank plants as well, so a moonlit bank is one blue world. Only the
   * Night needs it (the others change their plants instead), and it costs a
   * second pass over the banks.
   */
  grade: {
    jungle: NO_TINT,
    marsh: NO_TINT,
    rapids: NO_TINT,
    night: [8, 16, 52, 0.34],
  },
} as const satisfies Record<string, Record<ZoneId, Tint>>;

export const ZP = {
  // Lily Marsh plants.
  reed: '#68a33a',
  reedDark: '#3b7330',
  reedLight: '#a6d85c',
  cattail: '#6a4222',
  cattailLight: '#9a6a3a',
  duckweed: '#b8e86a',
  marshShallow: '#a8f0b4',
  marshLip: '#5a5a2c',
  gravel: '#7f8279',
  gravelLight: '#c5cbc1',
  nightBank: '#081430',
  padRim: '#c6ef8e',

  // Rapids.
  boulderDark: '#3d4642',
  boulder: '#68716b',
  boulderLight: '#9aa39b',
  boulderTop: '#c4ccc2',
  spray: '#f4fffd',

  // Night River.
  nightMask: '#02060f',
  nightFoam: '#bfe6ff',
  nightFoamGlow: '#6fb4ff',
  nightGlow: '#9fd4ff',
  moonGlint: '#dcecff',
  fireflyCore: '#f4ffb0',
  fireflyGlow: '#b6ff5c',
  glowcap: '#5ee6d0',
  glowcapDeep: '#1f8f9b',
} as const;
