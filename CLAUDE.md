# Antventure — notes for Claude

Top-down river game: an ant on a leaf dodges telegraphed raindrops, rocks and
twigs. Vite + TypeScript (strict), Canvas 2D, no runtime framework. Installable
PWA deployed to GitHub Pages from `main`.

## Commands

- `npm ci`: install (Node 22).
- `npm run check`: typecheck, unit tests (vitest), production build. Must pass.
- `npm run test:e2e`: Playwright (phone and desktop projects). Builds itself.
- `npm run dev`: dev server.

## Architecture (read the file header comments before editing a module)

- `src/types.ts`: **shared contracts** (World, GameEvent, Settings, ...).
  `src/config.ts`: cross-module constants. Change these only when your issue
  says so.
- `src/main.ts`: the only place modules are wired together. Scenes:
  menu → run ⇄ paused → over. Drains `world.events` after every sim step and
  dispatches them to renderer, UI, audio and haptics.
- `src/game/`: deterministic simulation. `world.ts` (stepWorld), `drops.ts`,
  `obstacles.ts`, `fairness.ts`, `scoring.ts`, `storm.ts`, `difficulty.ts`,
  `player.ts`, `damage.ts`. Phase 2 adds `zones.ts` (the zone timeline and the
  `ZONES` table), `pickups.ts` (crumb trails, power-up layout and collection)
  and `powers.ts` (timed effects, the shield). Tuning constants live in
  `tuning.ts`. Internal bookkeeping lives in `state.ts` (a SimState kept beside
  the World in a WeakMap).
- `src/render/`: Canvas renderer (`renderer.ts` composes the layers), with
  sprites pre-rendered in `build()`. Palette in `palette.ts`. Effects pooled in
  `effects.ts`. Zone looks are `zonelook.ts` and `zonefoliage.ts`; the night
  mask is `night.ts` and is drawn *below* the drop telegraphs; `pickups.ts`
  and `powers.ts` draw crumbs, power-up bubbles and the auras.
- `src/ui/`: DOM overlay (`ui.ts` facade; `hud.ts`, `screens/*`, `modals/*`,
  `feedback.ts` for banners, pills, hints and toasts). Styles in `styles.css`.
  Icons are inline SVG in `icons.ts`. Zone and pickup names and one-line rules
  live in `pickupinfo.ts`.
- `src/audio/`: Web Audio. All SFX are synthesised in `synth.ts`; there are no
  sound files besides the music and rain loops.
- `src/engine/`: input, fixed-timestep loop, viewport, RNG, quality governor.
- `src/storage.ts`: localStorage with validation and multi-tab safety.

World coordinates: playfield `WORLD_W` (400) units wide, y down, the leaf near
the bottom. River distance at view y is `world.distance + (player.y - y)`.

## Rules that keep the game fair and competitive

- **Determinism.** No `Math.random()`/`Date` in `src/game/**`. Use the seeded
  streams. Spawns are laid out by river distance and consume a fixed number of
  RNG values whatever the branch, so the Daily River is identical for
  everyone.
- **Fairness.** Drop spawns go through `fairness.ts`. Never bypass it. Drop
  telegraphs must always be visible, at night too. Pickups are never required
  and never placed inside an obstacle.
- **Zones and pickups.** Zones are a pure function of `(seed, river distance)`
  (`zoneAt`). Pickups are laid out by river distance from their own stream
  (`seed ^ 0x17E45`), never from `world.rng`, and independent of screen height
  and of what the player does. Anything that places something to land or arrive
  later (drops, obstacles) must use the speed of the zones on the way
  (`expectedTravel` in `fairness.ts`), not today's speed.
- **Scoring.** Everything that awards points multiplies by `payFactor(world)`
  (`scoring.ts`: the chain multiplier times the zone's `pay`), never by
  `world.multiplier` alone, or the Rapids' bonus silently skips it.
- **Fixed timestep.** Gameplay timing happens in sim steps (`SIM_DT`), never
  per frame.
- **Performance.** No allocations in per-frame render or sim paths (reuse
  objects, pool particles).
- Events are the only way the sim talks to renderer, UI and audio.

## Conventions

- 2-space indent, single quotes, semicolons. Comments explain *why*. Keep
  modules small.
- Tests go in `tests/unit/*.test.ts` (vitest) and `tests/e2e/*.spec.ts`
  (Playwright). e2e tests drive the game through `window.__ant` (world, scene,
  play, pause, resume, menu, storage) and accessible button names.
- Never skip or weaken a test to get green. Fix the cause.
- Phase 2 (zones, crumbs, power-ups, the night river) has shipped; its design
  and an "As shipped" section with measured balance are in
  `docs/phase-2/PLAN.md`. Implement only your issue's scope, and list anything
  deferred in the PR description.
