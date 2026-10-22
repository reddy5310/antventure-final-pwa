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

| # | Issue | Depends on | Size | Model | Status |
|---|---|---|---|---|---|
| 1 | Contracts + zone timeline (sim) | — | M | coding tier | Implemented |
| 2 | Zone looks: Jungle/Marsh/Rapids render + banner + stinger | 1 | L | coding tier | Implemented |
| 3 | Night River render: darkness mask, glowing telegraphs, fireflies | 2 | M | coding tier | Implemented |
| 4 | Crumbs (sim + storage) | 1 | M | coding tier | Implemented |
| 5 | Crumbs (render, HUD, audio, game over) | 4 | M | coding tier | Implemented |
| 6 | Power-ups (sim) | 4 | M | coding tier | Implemented |
| 7 | Power-ups (render, HUD, audio, hints, help) | 5, 6 | M | coding tier | Implemented |
| 8 | Zone mechanics: marsh pads, rapids density, night mods + fairness tests | 1, 3 | M | coding tier | Implemented |
| 9 | Balance + QA pass: bot metrics, e2e, README | all | M | planning tier review | Implemented (see "As shipped") |

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

## How we run it (budget-aware)

Spend the strong model where it has the most leverage (planning, specs,
review of the risky PRs). Use the cheaper model for the bulk of the coding.

1. **Plan (strong model, once).** This file, `CLAUDE.md`, and one precise
   GitHub issue per row of the work breakdown. A precise spec is what lets a
   cheaper model succeed on the first try.
2. **Code (Sonnet, via GitHub Actions).** `.github/workflows/claude.yml` runs
   `anthropics/claude-code-action@v1` with `--model sonnet` on the owner's
   subscription token. Comment `@claude implement this issue` on the next
   open issue, one at a time, in table order.
3. **Verify (free).** CI (typecheck, unit tests, build, e2e) runs on every PR.
   Merge only when green. For fixes, reply on the PR with `@claude ...`.
4. **Review (strong model, sparingly).** Only issue 1 (contracts and
   determinism) and issue 9 (balance) get a strong-model review.
5. **Locally:** `/model opusplan` in Claude Code plans with Opus (Shift+Tab
   for plan mode) and switches to Sonnet automatically for the coding.

Usage hygiene: `/clear` between issues, check `/usage`, keep `CLAUDE.md`
short, and avoid multi-agent fan-outs (Phase 1's 9-agent workflow was the
expensive part).

## Balance targets (checked in issue 9)

| Metric | Target |
|---|---|
| Idle-player survival (median) | unchanged (15–25 s); pickups must not make idling viable |
| Dodging-bot survival (median) | 100–160 s (Phase 1: ~127 s) |
| Crumb share of a strong bot's score | 10–20 % |
| Power-ups seen per 2-minute run | 2–3 |
| Zones reached per 2-minute run | 2–3 |
| Frame time | game code p95 under 2 ms in headless Chromium |

## As shipped

Where the shipped game differs from the design above, and what was measured.
Numbers come from `tests/unit` bots (keyboard-speed dodging bot, 0.2 s
reaction) and from headless Chromium, so read them as relative, not absolute.

### Deviations from the design

- **Crumb trails** start 55–105 m apart (not 40–90 m), scaled by the zone's
  crumb multiplier. At 40–90 m a crumb-chasing bot made about 19 % of its score
  from crumbs, the top of the 10–20 % target.
- **First power-up** comes at 64–110 m, after the point where an idle player has
  died, and two power-ups are never laid out less than 100 m apart. The gap to
  the next one is counted in "power-up metres" along the way (`powerGapEnd`), so
  the Rapids' ×1.3 is really felt even though a Rapids stretch is shorter than a
  gap: 0.63 power-ups per 100 m in the Rapids against 0.53 in the Jungle, 0.41 in
  the Marsh and 0.45 at Night.
- **Rapids** are rain ×0.9 and rocks ×1.25 (design: ×0.75 and ×1.4), and pay
  **×1.4 on everything scored there** (`ZoneDef.pay`, applied through
  `payFactor` in `scoring.ts`: distance, near-misses, crumbs, trail bonus and the
  ladybug's points; shown as a HUD chip). Distance is only about 20 % of a
  score, so "more metres" alone paid less per second than the Jungle while
  costing 1.4 to 2 times the hits. Measured (strong bot, 60 seeds, 90–135 s):
  Jungle 56 points/s at 2.8 hits/min (1192 points per hit), Rapids 73 at 3.8
  (1146), so risk and reward now match.
- **The first zone after the opening Jungle is Marsh or Night**, never the
  Rapids (`FIRST_DRAW`; it reorders the bag without using the RNG, so every later
  segment is unchanged). Before this, a third of rivers opened with the Rapids
  at about 47 s, when a new player is at their most fragile.
- **The zone's rain multiplier scales drop patterns as well as single drops**
  (patterns are about 40 % of all rain). Night is rain ×1.1 (design ×0.9): with
  perfect-vision bots it was the easiest zone, because telegraphs glow more by
  night than by day. At 135–200 s it is now a little harder than the Jungle
  (6.1 against 5.0 hits/min).
- **Lily pads** (radius 18–30, no damage) are packed 1.35× denser than rocks.
  A gate row in the Marsh becomes two pads, so the Marsh has no rocks at all
  (twigs still hurt). Pads switch on at the blend's midpoint. They are **walls
  to the fairness sweep** (a pad shoves the leaf, so a resting spot inside its
  reach is not one the leaf can keep), the shove is capped at 105 u/s (150 at
  first, which carried a pad-ignoring leaf into a third of its splashes), and a
  pad holds its shove while a splash landing within 0.4 s is in the way.
  Measured over 52 min of Marsh: a leaf that ignores pads takes 1.45 hits/min
  (3 % of them within 0.7 s of a bump), one that avoids them 2.2.
- **A first-sight hint for lily pads** ("soft: they push, never hurt"), like the
  power-ups': they look like solid obstacles, and a player who steers around every
  one never learns otherwise. The hint timers count sim time, so a paused game
  keeps its hint.
- **Honey** lasts 12 s and reaches 160 units (design 9 s, 110), and the odds are
  honey 1.8, firefly 1.4 (were 2.4 and 1.1). At 110 units the magnet paid about
  +0.7 crumbs; now about +2.8 crumbs and +14 % score over the 25 s after pickup,
  against +28 % for a firefly and a halved hit rate for a mushroom.
- **Obstacle density follows the clock a living run keeps**
  (`timeAtDistanceOnRiver`, which integrates the real zone speeds), so the
  difficulty curve does not drift after the first zone change.
- **Drops across a zone change** are placed with `expectedTravel`, which
  includes the speed change on the way, so a drop spawned inside a 12 m blend
  lands on the row it was meant for (a unit test pins this).
- **Obstacles look 280 units further ahead** than before, so crumbs and
  power-ups (laid out only once the obstacle stream has passed them) first
  appear above the top edge on tall phones too.
- **Crumbs and power-ups keep clear of drifting twigs.** A twig is laid out in
  one place and then drifts for seconds, so a crumb placed against its birth spot
  could end up under it (1 crumb in 100 near the leaf, a lure into a hit). The
  layout now asks where the twig will be when the leaf gets to that row (its
  drift start, speed and banks are fixed by the seed and the distance). The
  opening trail, if the rocks and twigs near the start leave it too few crumbs,
  gets one more try mirrored across the start lane.
- **`zonesReached`** counts different zones entered alive: the river drifting on
  under a fallen leaf reaches nothing, and meeting the Jungle twice is not five
  of four.
- **`setViewHeight`** re-anchors pickups at once (a rotation pauses the game, and
  no step runs to catch them up).
- **`wallet`** is saved next to `stats.totalCrumbs`: crumbs to spend in Phase 3.
  Nothing spends it yet.
- **The zone stinger is voiced per zone** (`STINGERS` in `synth.ts`: bright
  Marsh, rushing Rapids, hushed Night); `main.ts` passes the zone as the
  sound's `variant`.

### Measured

| Metric | Target | Result |
|---|---|---|
| Idle-player survival (median) | unchanged (15–25 s) | 14.6 s over 24 seeds, identical to Phase 1 on every one of the same seeds |
| Dodging-bot survival (median) | 100–160 s (Phase 1: ~127 s) | 125.9 s over 24 seeds (p25 116.7, p75 147.8). A slower bot (scratch simulator, 80 seeds): 123 s at 0.35 s reaction, 76 s at 0.45 s |
| Zones reached by the bot | 2–3 per two minutes | median 3 (the bot lives about 2 min) |
| Crumb share of a strong bot's score | 10–20 % | 17.0 % for a bot that routes for crumbs, 9.2 % for one that ignores them (gated by `pickups.test.ts`) |
| Power-ups seen per two-minute run | 2–3 | about 2.1 (gated by `pickups.test.ts`) |
| Frame time, game code p95 | under 2 ms | phone 390×844 at density 2: Jungle 1.5–1.6, Night 1.6–1.9, Rapids 1.9–2.3, Marsh 2.2–2.5 ms (p50 0.8–1.3 ms) |

Hits per minute at the same run time (strong bot, immortal, 60 seeds), the
fairest comparison between zones because the difficulty rises with the clock:

| Run time | Jungle | Marsh | Rapids | Night |
|---|---|---|---|---|
| 90–135 s | 2.8 | 0.8 | 3.8 | 1.6 |
| 135–200 s | 5.0 | 3.9 | 7.7 | 6.1 |

The frame times are rAF callback durations (simulation, render and HUD) in
headless Chromium with software GL on a shared machine, so they overstate a
real phone, but Marsh is the most expensive zone to draw (many decorative
lily sprites): that is the first place to trim if a device struggles
(`MARSH_LILY_SLOT` in `src/render/water.ts`).

### Known limits and follow-ups

- Rapids are still the hardest zone (about 1.4 to 1.5 times the Jungle's hits at
  the same run time), by design now that they pay ×1.4. About a third of strong
  bot runs end there, because they arrive late. If humans find them too rough,
  `ZONES.rapids.rocks` (1.25) and `.pay` are the knobs.
- Night is mechanically close to the Jungle. Rocks and twigs keep a faint foam
  outline beyond the pool of light; fading it beyond about 300 units would make
  Night cost more attention, but wants a few human sessions first.
- "Dare" trails run along a rock's edge but every crumb is still collectable from
  clear water (a crumb is at the rock's collision edge + 8 and the pickup radius
  is 32), so the risk of a dare comes from the rain, not the rock: a lane lure.
- The stock test bot dodges lily pads like rocks; `createDodgeBot({ ignorePads: true })`
  behaves like a human who ignores them.
- Crumbs are 22 units apart and the pickup radius is 32, so on a straight trail
  missing one crumb means missing its neighbours.
- The SFX (crumb pitch at streaks 7–9, the trail sparkle, the pad boing, the
  zone stingers) were checked by reading the synth and by peak levels, not by
  ear: a listening pass is worthwhile.
- The balance gates in `pickups.test.ts` (crumb share 10–20 %, 1.8–3 power-ups
  per run) are deliberate, so later obstacle or zone changes may trip them.
- Phase 3 candidates: spending crumbs, missions.
