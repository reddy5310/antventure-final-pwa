# Phase 2: "More to chase"

Phase 1 made the game fair, readable and competitive. Phase 2 adds things to
go *for* (crumbs, power-ups) and variety *within* a run (river zones with
their own rules, including a real night river). It must not break what makes
Phase 1 work: fair telegraphs, determinism, and identical Daily Rivers.

Each work item below is one GitHub issue and one pull request, sized so a
mid-tier model can finish it in a single run. The issue text links back to
the matching section of this file.

## Goals

1. **Routing decisions every few seconds.** Crumb trails pull you towards
   risk (near rocks, under rain) for points.
2. **Moments of power.** Rare pickups that change how you play for 8–12 s.
3. **A run that changes as it goes.** A new zone every ~40–60 s of play, each
   with a different challenge, so a 2-minute run has 2–3 distinct chapters.
4. **Stay competitive.** Same layout for everyone on the Daily. Score stays
   skill-based: near-miss combos remain the main lever, and crumbs add about
   10–20 % on top.

### Non-goals (Phase 3 or later)

Spending crumbs (shop, skins), missions, achievements, global leaderboards,
new music.

## Hard rules (every PR must keep these)

- **Determinism.** Gameplay randomness comes from seeded streams only.
  Zones are a pure function of `(seed, river distance)`. Pickups are laid out
  by river distance from their own stream (`itemRng`, seeded from
  `seed ^ 0x17E45`), never from `world.rng`. Layout never depends on screen
  height or on player state. Effects may use player state.
- **Fairness.** Every drop telegraph stays visible in every zone, at night
  too. No zone or pickup may create a spawn the fairness check
  (`src/game/fairness.ts`) would reject. Pickups are never required, and
  never placed inside an obstacle.
- **Frame-rate independence.** All timing runs in `stepWorld` steps (`SIM_DT`).
- **Performance.** No per-frame allocations in render or sim hot paths. Pool
  particles. Night darkness uses one cached offscreen mask.
- **Tests.** `npm run check` and `npm run test:e2e` stay green. New gameplay
  needs unit tests, including a determinism test that covers it.

## Design

### Zones

A river is a sequence of zones laid out by distance. **0–120 m is always
Jungle** (onboarding). After that, segments of 150–220 m (seeded) are drawn
from a seeded bag of the four zones, with no zone repeating back to back.
Each boundary blends over 12 m. Typical players reach 2–3 zones per run;
strong players see all four.

| Zone | Feel | Mechanics (multipliers blend in over the 12 m transition) |
|---|---|---|
| **Jungle** | baseline | ×1 everything |
| **Lily Marsh** | breather, scoring | river 15 % wider, scroll ×0.9, rain ×0.85, rocks replaced by **lily pads**: soft bumpers that push you, no damage. Crumbs ×1.6 |
| **Rapids** | speed and nerve | river 15 % narrower, scroll ×1.3 (more metres per second, so more points), rain ×0.75, rock density ×1.4 (fairness lanes kept), power-ups ×1.3, whitewater visuals |
| **Night River** | tension | darkness except a ~150-unit pool of light around the leaf. Telegraph rings **glow** and stay visible, rocks and twigs keep a faint foam outline, crumbs glow. Rain ×0.9. Fireflies drift by. The firefly power-up widens the light |

Implementation: `src/game/zones.ts` exports `ZONES` (data table) and
`zoneAt(seed, d, out)`, which returns `{ zone, next, blend }` and allocates
nothing. `riverEdgesInto` applies the zone's width multiplier, so it stays
pure. The world tracks the zone at the leaf and emits
`{ type: 'zone', zone }` when the leaf enters a new one. The renderer samples
`zoneAt` per row band, so the next zone's banks scroll into view before you
reach it.

### Crumbs (collectible)

- **Trails** of 5–9 sugar crumbs, about 22 units apart, laid out every
  40–90 m by river distance.
- Trail shapes: `line`, `arc` (bends around the next obstacle), `zigzag`,
  and `dare` (runs along the edge of a rock's lane). Crumbs are slid out of
  obstacles and kept inside the river edges.
- **Pickup:** within `LEAF_HIT_R + 6` of the leaf centre.
- **Scoring:** +10 × multiplier per crumb. Taking every crumb in a trail gives
  a **Perfect trail** bonus of +50 × multiplier.
- **Link to combos:** a crumb adds 0.4 s to an active combo timer (capped at
  `COMBO_TIME`), so routing through crumbs keeps a chain alive.
- **Persistence:** crumbs per run go into `RunSummary.crumbs`. Lifetime
  `stats.totalCrumbs` and a `wallet` count are saved for the Phase 3 shop.
  They are shown on game over.

### Power-ups

- One power-up laid out every 160–260 m (seeded), on a reachable mid-lane
  spot at least 60 units from obstacles. Its kind comes from seeded weights
  per zone: fireflies are likelier in or just before Night, and Rapids raises
  the overall rate.
- Picking up a kind that is already active refreshes its timer.

| Pickup | Effect |
|---|---|
| 🍄 **Mushroom cap** | Shield for 10 s, or until it blocks one hit (rain or obstacle). A block costs no heart, keeps the combo, and gives 0.5 s of invulnerability. |
| 🍯 **Honey** | Magnet for 9 s. Crumbs within 110 units drift to the leaf at 260 u/s. |
| 🐞 **Ladybug** | +1 heart, up to `MAX_HEARTS`. With full hearts, +100 × multiplier points instead. Instant. |
| ✨ **Firefly** | For 12 s, the near-miss band ×1.5 (easier chains) and the night light radius ×1.8. |

The first time a player ever sees each power-up on screen, a one-line hint
appears once (stored as a storage flag).

### Feedback

- **Pickups:** crumbs pluck with rising pitch along a trail, sparkle on
  Perfect trail, play an activation whoosh plus an aura on the ant, show a
  timer ring in the HUD, and blip when an effect ends.
- **Zones:** an "Entering Rapids" banner (same queue as storm banners) and a
  short audio stinger.
- **HUD:** a crumb counter chip, and active power-ups as icons with radial
  timers. On wide screens these sit in the side panel.
- **Game over:** crumbs earned and zones reached. The help modal gets
  sections for zones and pickups.

## Contract changes (all land in issue 1)

All shared types land at once, so later issues never edit `src/types.ts` in
parallel.

```ts
export type ZoneId = 'jungle' | 'marsh' | 'rapids' | 'night';
export type PickupKind = 'crumb' | 'mushroom' | 'honey' | 'ladybug' | 'firefly';
export type PowerKind = 'mushroom' | 'honey' | 'firefly';
export type ObstacleKind = 'rock' | 'twig' | 'pad';          // + 'pad' (marsh bumper)

export interface Pickup {
  id: number; kind: PickupKind;
  x: number; y: number;          // scrolls with the river
  trail: number;                 // crumb trail id, 0 = none
  taken: boolean; variant: number;
}
export interface ActivePower { kind: PowerKind; left: number; total: number }

// World += { zone: ZoneId; nextZone: ZoneId; zoneBlend: number;
//            pickups: Pickup[]; crumbs: number; powers: ActivePower[];
//            darkness: number /* 0 day .. 1 night, at the leaf */ }
// GameEvent += zone | pickup | trail-complete | power-start | power-end | shield-block
// RunSummary += { crumbs: number; zonesReached: number }
// LifetimeStats += { totalCrumbs: number }      storage += wallet
// Sfx += 'crumb' | 'trail' | 'power' | 'power-end' | 'shield' | 'zone' | 'heart-up'
```

## Work breakdown

| # | Issue | Depends on | Size | Model |
|---|---|---|---|---|
| 1 | Contracts + zone timeline (sim) | — | M | coding tier |
| 2 | Zone looks: Jungle/Marsh/Rapids render + banner + stinger | 1 | L | coding tier |
| 3 | Night River render: darkness mask, glowing telegraphs, fireflies | 2 | M | coding tier |
| 4 | Crumbs (sim + storage) | 1 | M | coding tier |
| 5 | Crumbs (render, HUD, audio, game over) | 4 | M | coding tier |
| 6 | Power-ups (sim) | 4 | M | coding tier |
| 7 | Power-ups (render, HUD, audio, hints, help) | 5, 6 | M | coding tier |
| 8 | Zone mechanics: marsh pads, rapids density, night mods + fairness tests | 1, 3 | M | coding tier |
| 9 | Balance + QA pass: bot metrics, e2e, README | all | M | planning tier review |

Issues 2–3 and 4–6 are independent tracks, but **run one at a time** to
avoid merge conflicts and keep usage predictable.

### Acceptance checklist (every issue)

- [ ] `npm run check` passes (typecheck, unit tests, build).
- [ ] `npm run test:e2e` passes.
- [ ] New sim behaviour has unit tests, and the determinism test still passes
      with the new feature active.
- [ ] No `Math.random`/`Date` in `src/game/**`. No allocations in per-frame
      paths.
- [ ] PR description lists what changed, what was measured, and anything
      deferred.

## Balance targets (checked in issue 9)

| Metric | Target |
|---|---|
| Idle-player survival (median) | unchanged (15–25 s); pickups must not make idling viable |
| Dodging-bot survival (median) | 100–160 s (Phase 1: ~127 s) |
| Crumb share of a strong bot's score | 10–20 % |
| Power-ups seen per 2-minute run | 2–3 |
| Zones reached per 2-minute run | 2–3 |
| Frame time | game code p95 under 2 ms in headless Chromium |
