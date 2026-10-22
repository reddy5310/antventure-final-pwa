// Ant skins: cosmetic only. A skin is a palette swap for the ant drawn in
// src/render/ant.ts; it never changes hitboxes or anything the simulation reads.
// Palettes keep a dark outline and a darker-than-leaf body so every skin reads
// on the light-green leaf by luminance (the bee leans on its black stripes),
// while glow skins also work as lights on the night river.

import type { Skin, SkinId } from '../types';

export const SKINS: readonly Skin[] = [
  {
    id: 'classic',
    name: 'Classic',
    price: 0,
    unlockedBy: null,
    // Exactly the original ant (src/render/palette.ts).
    palette: { body: '#4b211a', mid: '#7e3523', dark: '#2a1613', outline: '#140a09', highlight: '#cf6643', pattern: 'none', accent: '' },
  },
  {
    id: 'leafcutter',
    name: 'Leafcutter',
    price: 150,
    unlockedBy: null,
    palette: { body: '#1d4a2c', mid: '#2f8f5a', dark: '#0f2a19', outline: '#06140c', highlight: '#a6f0c0', pattern: 'none', accent: '' },
  },
  {
    id: 'bee',
    name: 'Bee',
    price: 400,
    unlockedBy: null,
    palette: { body: '#b8800f', mid: '#ffd23a', dark: '#6b4706', outline: '#1d1404', highlight: '#fff3a8', pattern: 'stripes', accent: '#1d1404' },
  },
  {
    id: 'ember',
    name: 'Ember',
    price: 400,
    unlockedBy: null,
    palette: { body: '#8a2410', mid: '#e85a1e', dark: '#4d1208', outline: '#1f0703', highlight: '#ffa04a', pattern: 'glow', accent: '#ff7a2a' },
  },
  {
    id: 'golden',
    name: 'Golden',
    price: 900,
    unlockedBy: null,
    palette: { body: '#946409', mid: '#e8bd3c', dark: '#5a3d05', outline: '#2a1d04', highlight: '#fff3b0', pattern: 'shine', accent: '#fffbe0' },
  },
  {
    id: 'nightglow',
    name: 'Night Glow',
    price: null,
    unlockedBy: 'night-owl',
    palette: { body: '#1e2a4a', mid: '#2f4f8a', dark: '#121a30', outline: '#070b16', highlight: '#8fd4ff', pattern: 'glow', accent: '#7ff0ff' },
  },
];

export function skinById(id: string): Skin {
  return SKINS.find((s) => s.id === id) ?? SKINS[0];
}

export function isSkinId(id: string): id is SkinId {
  return SKINS.some((s) => s.id === id);
}
