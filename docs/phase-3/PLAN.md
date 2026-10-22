# Phase 3: "Reasons to come back"

Phase 1 made the game fair and competitive, and Phase 2 made each run varied
(zones, crumbs, power-ups, night). Phase 3 gives every session a purpose: a
streak to keep, daily missions to finish, crumbs to spend, and badges to earn.

Status: **shipped** (see "As shipped" at the end). The future roadmap is in
`docs/ROADMAP.md`.

## Ground rules

- **Cosmetic and meta only.** Nothing changes hitboxes, spawns, scoring or
  difficulty, so leaderboards and the Daily River stay fair.
- **New code lives in `src/meta/`**, outside `src/game/`. It may use `Date`
  because it is not part of the deterministic simulation. `src/game/**` keeps
  every rule in `CLAUDE.md`.
- **Phase 2 players keep their crumbs.** The wallet starts from the existing
  lifetime crumbs (`stats.totalCrumbs`), and the migration never loses data.
- **Lean execution:** see "How to run it" below. The budget matters more than
  exhaustive testing.

## Features

### 1. Daily streak 🔥 (size XS)

- **What counts:** a day counts when the player finishes at least one run, in
  any mode. Days use the local date, the same as the Daily River
  (`dailyInfo().id`).
- **Counting:**
  - Playing the next day: +1.
  - Missing a day: resets to 1 on the next run.
  - Playing again the same day: no change.
- **Milestone bonuses:** 3, 7, 14 and 30 days give +25, +75, +150 and +300
  crumbs.
- **Where it shows:**
  - a flame with the count on the title
  - a "🔥 Day N" line on game over
  - in share text
- **Saved:** `lastPlayDay`, `count` and `best`.

### 2. Daily missions (size M)

- **Three missions a day:** one easy, one medium and one hard. They are chosen
  from the local date with `hashString` (`src/engine/rng.ts`), so every player
  gets the same three, and they reset at local midnight.
- **Rewards:** easy 30, medium 60, hard 100 crumbs. Shown as a pill during the
  run and again on game over.
- **Two kinds of mission:**
  - **"In one run":** checked from the run summary or the run's events.
  - **"Today":** a running total across today's runs.
- **Saved:** progress for today only, keyed by the date id.

The templates below each have easy, medium and hard targets.

| Mission | Targets (E / M / H) | Counted from |
|---|---|---|
| Collect crumbs in one run | 15 / 30 / 50 | `RunSummary.crumbs` |
| Near-misses in one run | 10 / 25 / 40 | `RunSummary.nearMisses` |
| Reach a chain | ×4 / ×8 / ×12 | `RunSummary.maxCombo` |
| Travel in one run | 300 / 600 / 1000 m | `RunSummary.distanceM` |
| Reach zones in one run | 2 / 3 / 4 | `zone` events |
| Enter a specific zone | Night, Rapids or Lily Marsh | `zone` event |
| Perfect trails today | 1 / 3 / 5 | `trail-complete` events |
| Use power-ups today | 2 / 4 / 6 | `power-start` events |
| Block a hit with the mushroom cap | 1 | `shield-block` event |
| Survive without a hit | 30 / 60 / 90 s | `hit` events + run time |
| Play today's Daily River | 1 | game over with mode `daily` |
| Finish runs today | 3 / 5 / 8 | game-over count |
| Score in one run | 500 / 1500 / 3000 | `RunSummary.score` |
| Collect crumbs today | 40 / 80 / 150 | `pickup` events (crumbs) |

### 3. Crumb Shop with ant skins (size M)

- **Wallet** = crumbs from runs + mission, streak and achievement rewards −
  spending.
  - Never negative.
  - Safe with two tabs open: reuse the re-read-before-write pattern already in
    `src/storage.ts`.
  - Initialised once from `stats.totalCrumbs`.
- **Skins** are colour and pattern settings for the ant, which is already drawn
  in code (`src/render/ant.ts`). No image files.

| Skin | How to get it |
|---|---|
| Classic | owned from the start |
| Leafcutter (green) | 150 crumbs |
| Bee (yellow and black stripes) | 400 crumbs |
| Ember (orange glow) | 400 crumbs |
| Golden | 900 crumbs |
| Night Glow | achievement only (Night Owl) |

- **Shop screen:** opened from a new title icon.
  - A live animated preview of each skin.
  - Price, "Owned" or "Equipped" on each card.
  - Buy and Equip buttons.
  - A purchase plays a sound and a small burst.
- **Rule:** skins are visual only. `ANT_HIT_R` and `LEAF_HIT_R` never change,
  and a test checks that a different skin produces an identical game.

### 4. Achievements (size S)

- **About 12 badges**, checked at the end of each run from `RunSummary`, the
  lifetime stats, the streak and a few new lifetime counters. Nothing is
  tracked frame by frame.
- **Rewards:** 50–200 crumbs each, plus the Night Glow unlock.
- **Where it shows:**
  - a badge-grid screen from the title, with locked badges greyed out and a
    hint
  - an "Achievement unlocked" reveal on game over

| # | Badge | Requirement |
|---|---|---|
| 1 | First Splash | finish a run |
| 2 | River Runner | 1,000 m in one run |
| 3 | Long Haul | 2,000 m in one run |
| 4 | Chain Reaction | ×8 chain |
| 5 | Untouchable | 25 near-misses in one run |
| 6 | World Tour | all 4 zone *kinds* in one run. Count distinct kinds from `zone` events, because `zonesReached` counts segments, not kinds. |
| 7 | Night Owl | 5 Night River zones survived (lifetime); **unlocks Night Glow** |
| 8 | Sweet Tooth | 1,000 lifetime crumbs |
| 9 | Perfectionist | 10 Perfect trails (lifetime) |
| 10 | Shielded | 10 mushroom-cap blocks (lifetime) |
| 11 | Devotee | 7-day streak |
| 12 | Centurion | 100 runs |

### 5. Phase 2 polish (size S)

- "Dare" crumb trails really hug a rock's lane, so they become a real
  risk-for-reward choice (`src/game/pickups.ts`; layout stays deterministic).
- Night River: rock and twig outlines fade beyond about 300 units, so night
  feels darker. Rain telegraphs stay fully visible.
- Real screenshots in the README.
- Tuning from real-device playtests (constants only).

## Economy targets (checked once, at the end)

- **Earning:** about 15–35 crumbs per run (an estimate from Phase 2 bot data;
  measure it), plus missions (about 190 a day if all three are done), streak
  bonuses and badges.
- **Pacing:** first skin after about 4–6 runs, all skins after about 60–80
  runs. Adjust prices if it is far off.

## Shared definitions (written by the orchestrator before any agent starts)

- **`src/types.ts` additions:**
  - `SkinId`, `Skin` (palette and pattern)
  - `MissionDef`, `MissionProgress`, `AchievementDef`
  - `MetaRewards`: crumbs earned, missions completed, badges unlocked, streak
    change
  - `MetaInfo`: wallet, streak, today's missions, equipped skin
- **`src/storage.ts`:**
  - A new versioned `meta` section with migration: the wallet starts from
    `stats.totalCrumbs`, and nothing is ever lost.
  - The same validation and two-tab safety as today.
  - API: `getMeta`, `spend`, `credit`, `setSkin`, `markUnlocked`.
- **`src/meta/` modules with fixed signatures:**
  - `index.ts` (the shared interface)
  - `streak.ts`, `missions.ts`, `achievements.ts`, `skins.ts`
- **Wiring in `src/main.ts`:**
  - Every game event is also passed to `meta.onEvent(e, world)`.
  - At game over, `meta.finishRun(summary)` returns `MetaRewards`, which go
    into the game-over info for the UI.
  - The title info gets `MetaInfo`.
  - The equipped skin is passed to the renderer.
- **Renderer:** `setSkin(skin)` rebuilds the ant's cached sprites only when the
  skin changes. Nothing is allocated per frame.

## How to run it (lean, budget-aware)

| Step | Who | Owns | Output |
|---|---|---|---|
| 0 | **Opus** (orchestrator) | this plan, shared definitions, storage + migration, stubs, `main.ts` wiring | compiles and runs; commit |
| 1A | Sonnet 5.5 | `src/meta/**` | streak, missions, achievements logic + ~10 small tests |
| 1B | Sonnet 5.5 | `src/render/ant.ts`, skin catalogue data, shop preview helper | 6 skins + 1 "a different skin produces an identical game" test |
| 1C | Sonnet 5.5 | `src/ui/**`, `src/audio/synth.ts` | Shop, mission cards, streak flame, badges screen, game-over rewards, pills, 3 sounds (purchase, mission, achievement) |
| 1D | Sonnet 5.5 | `src/game/pickups.ts` (dare trails only), `src/render/night.ts`, README | polish |
| 2 | Sonnet 5.5 integrator | whole repo | `npm run check` and `npm run test:e2e` pass; at most 4 screenshots; commit |
| 3 | **Opus** | none (checks only) | runs the checks, reviews the diff, then opens the PR and deploys **only when the owner says "deploy"** |

- Steps 1A–1D run in parallel on separate files. Every agent call uses
  `model: 'sonnet'`.
- No playtest agent and no separate review agent. The owner playtests on a
  phone.

### Testing policy (lean)

- The existing suites must stay green, since CI blocks merges.
- **About 15 new unit tests only:**
  - wallet and migration (never negative, two-tab safe, crumbs carried over)
  - mission selection is the same for a given date, and progress counts
    correctly
  - achievement rules
  - a different skin produces an identical game
- No new e2e tests unless an existing one breaks.

### Budget guards

- Start from a **fresh chat**. Long conversations re-send their whole history
  on every message.
- Use Opus only for steps 0 and 3. Every builder uses Sonnet.
- Cap the run with a token limit, for example **"+300k"**. If it hits the cap,
  work stops and stays on disk to resume.
- Commit a checkpoint after each stage, so a container restart only re-runs
  the interrupted agent.
- Keep screenshots to 4 or fewer, because images are expensive for agents.
- Rough estimate: about a third of Phase 2's usage.

## Definition of done

- Streak, missions, the shop with skins, badges and the polish items all work
  on phone and desktop.
- `npm run check` and `npm run test:e2e` pass, and CI is green on the PR.
- The owner playtests on a phone and says "deploy". The PR is squash-merged to
  `main`, and GitHub Pages publishes it automatically.

## Kickoff message for a new session

> Antventure (repo `reddy5310/antventure-final-pwa`). Read `CLAUDE.md`, then
> run **Phase 3** from `docs/phase-3/PLAN.md`, lean, to fit my budget:
> - You (Opus) are the orchestrator. Do step 0 yourself: shared definitions,
>   storage + migration, stubs and wiring.
> - Then use the Workflow tool with **`model: 'sonnet'` for every agent**:
>   builders 1A–1D in parallel, then one integrator.
> - No playtest or review agents, at most 4 screenshots, and only the new
>   tests listed in the plan.
> - Commit checkpoints after each stage. **Don't open a PR or deploy** until I
>   say "deploy".
> - Budget cap: +300k.

## As shipped

All five features landed as planned: streak, three daily missions, the crumb
shop with six skins, 12 badges, and the Phase 2 polish. `npm run check` (216
unit tests) and the full Playwright suite (phone and desktop) pass, with no
e2e test changed.

### What differs from the plan

- **Storage API.** The plan listed `spend`, `credit`, `setSkin` and
  `markUnlocked`. Shipped: `getMeta`, `updateMeta(fn)` (the callback returns the
  crumbs to credit, so a run's rewards are one two-tab-safe write), `buySkin`,
  `equipSkin` and `getWallet`. The wallet never goes negative.
- **Mission pills.** "Finish N runs" and "Play the Daily River" only complete at
  game over, so they have no in-run pill. A mission announced mid-run is paid
  when the run is recorded; abandoning a live run records nothing, so that
  mission can be completed again later.
- **Streak milestones** are paid each time a streak reaches 3, 7, 14 or 30, so a
  player who breaks and rebuilds a streak is paid again (each payout takes real
  days of play).
- **Sweet Tooth** counts lifetime `stats.totalCrumbs`, so a Phase 2 player with
  1,000+ crumbs unlocks it on their first Phase 3 run.
- **Title layout.** On screens up to 680 px tall the brand mark and tagline are
  hidden so the missions card clears the river.
- **Skins.** Bee and Golden bodies have low luminance contrast with the light
  leaf (about 1.7:1 and 2:1). They rely on the dark outline and, for the bee, the
  stripes. Skins never touch `ANT_HIT_R` or `LEAF_HIT_R`; a test runs the same
  seed with every skin and compares the worlds.
- **Dare trails** now run on a circle just outside the rock's hit radius, and any
  dare crumb that ends up inside the hit circle is dropped, so a dare crumb never
  costs a heart. Night outlines fade beyond about 300 units.

### Economy (measured once, no new tests)

- **Crumbs per run:** a bot that ignores crumbs picks up about 2 crumbs by 30 s,
  about 4 by 60 s and about 7 by 120 s (20 seeds). A player who routes for
  trails collects roughly two to three times that, so **about 5-20 crumbs a run**
  and 10-15 for a typical casual run. This is under the plan's 15-35 guess,
  because 1 crumb = 1 wallet crumb; the trail bonus pays points, not crumbs.
- **Missions** add up to 190 a day (30 + 60 + 100). An easy and a medium one are
  realistic on a normal day.
- **Pacing:** the first run pays First Splash (+50) plus crumbs, so the first
  skin (Leafcutter, 150) arrives in about 3-5 runs on day one. At about 5 runs
  and 100-150 crumbs of missions a day, all four buyable skins (1,850 crumbs)
  take about 10-12 days, roughly 50-60 runs, plus badge payouts. That is close
  to the 60-80 run target, so prices stay at 150 / 400 / 400 / 900.

### Deferred

- Share text does not include the streak line yet.
- A mission progress bar on the title does not move during a run, only after
  game over.
- Re-checking the retuned skin palettes on a real phone in daylight.

