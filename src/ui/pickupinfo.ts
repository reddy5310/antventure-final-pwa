// UI-side facts about the Phase 2 zones and pickups: names, icons and the
// one-line rules the HUD hints, banners and the help modal share. Kept in one
// place so the wording can't drift between them. Zone names come from the sim's
// table (game/zones.ts) so a rename there shows up everywhere.

import { POWER_SECONDS } from '../game/powers';
import { ZONES } from '../game/zones';
import type { PickupKind, PowerKind, ZoneId } from '../types';
import type { IconName } from './icons';

export interface ZoneInfo {
  name: string;
  icon: IconName;
  /** Banner flavour line (wide screens only). */
  sub: string;
  /** Help modal rule, one line. */
  rule: string;
}

export const ZONE_ORDER: readonly ZoneId[] = ['jungle', 'marsh', 'rapids', 'night'];

export const ZONE_INFO: Readonly<Record<ZoneId, ZoneInfo>> = {
  jungle: {
    name: ZONES.jungle.name,
    icon: 'zoneJungle',
    sub: 'Steady waters',
    rule: 'Every river starts here. Learn the rain, find your rhythm.',
  },
  marsh: {
    name: ZONES.marsh.name,
    icon: 'zoneMarsh',
    sub: 'Wide, slow and crumb-rich',
    rule: 'Wider and slower, with more crumbs. Lily pads are soft bumpers: they push, never hurt.',
  },
  rapids: {
    name: ZONES.rapids.name,
    icon: 'zoneRapids',
    sub: `Fast, narrow, more rocks. Points ×${ZONES.rapids.pay}`,
    rule: `Faster and narrower with more rocks, but everything you score here counts ×${ZONES.rapids.pay}.`,
  },
  night: {
    name: ZONES.night.name,
    icon: 'zoneNight',
    sub: 'Stay in the light',
    rule: 'Dark except around the leaf. Rain shadows still glow, so keep reading the rings.',
  },
};

export interface PickupInfo {
  name: string;
  icon: IconName;
  /** Short effect, used after the name in hints ("Mushroom cap: blocks the next hit"). */
  effect: string;
  /** Help modal line. */
  help: string;
}

export const POWER_ORDER: readonly Exclude<PickupKind, 'crumb'>[] = ['mushroom', 'honey', 'ladybug', 'firefly'];

export const PICKUP_INFO: Readonly<Record<Exclude<PickupKind, 'crumb'>, PickupInfo>> = {
  mushroom: {
    name: 'Mushroom cap',
    icon: 'mushroom',
    effect: 'blocks the next hit',
    help: `A shield for ${POWER_SECONDS.mushroom} s that blocks one hit (rain or obstacle). No heart lost, chain kept.`,
  },
  honey: {
    name: 'Honey',
    icon: 'honey',
    effect: 'pulls crumbs to you',
    help: `A magnet for ${POWER_SECONDS.honey} s: nearby crumbs drift to the leaf.`,
  },
  ladybug: {
    name: 'Ladybug',
    icon: 'ladybug',
    effect: 'restores a heart',
    help: 'Restores one heart. With full hearts it pays bonus points instead.',
  },
  firefly: {
    name: 'Firefly',
    icon: 'firefly',
    effect: 'easier near-misses, wider light',
    help: `For ${POWER_SECONDS.firefly} s the near-miss zone grows by half and the night light widens.`,
  },
};

/** Lily pads get a first-sight hint like the power-ups: they look solid, and nothing else says they are not. */
export const PAD_INFO: Readonly<Pick<PickupInfo, 'name' | 'icon' | 'effect'>> = {
  name: 'Lily pads',
  icon: 'zoneMarsh',
  effect: 'soft: they push, never hurt',
};

export const POWER_NAME: Readonly<Record<PowerKind, string>> = {
  mushroom: PICKUP_INFO.mushroom.name,
  honey: PICKUP_INFO.honey.name,
  firefly: PICKUP_INFO.firefly.name,
};
