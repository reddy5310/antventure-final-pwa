// Ant skins: cosmetic only. A skin is a palette swap for the ant drawn in
// src/render/ant.ts; it never changes hitboxes or anything the simulation reads.

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
    palette: { body: '#2f5a1f', mid: '#4f8a2e', dark: '#1c3913', outline: '#0d1a09', highlight: '#9fd468', pattern: 'none', accent: '' },
  },
  {
    id: 'bee',
    name: 'Bee',
    price: 400,
    unlockedBy: null,
    palette: { body: '#c8901a', mid: '#f2c230', dark: '#7a5208', outline: '#1d1404', highlight: '#ffe58a', pattern: 'stripes', accent: '#1d1404' },
  },
  {
    id: 'ember',
    name: 'Ember',
    price: 400,
    unlockedBy: null,
    palette: { body: '#8a2410', mid: '#d4511c', dark: '#4d1208', outline: '#1f0703', highlight: '#ffa04a', pattern: 'glow', accent: '#ff7a2a' },
  },
  {
    id: 'golden',
    name: 'Golden',
    price: 900,
    unlockedBy: null,
    palette: { body: '#a87a14', mid: '#e0b53a', dark: '#6b4a08', outline: '#2a1d04', highlight: '#fff0a8', pattern: 'shine', accent: '#fffbe0' },
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
