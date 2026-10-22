# Hazard readability pack: rain vs rocks

**Status:** ✅ shipped (see "As shipped" at the end).

## The problem (from family playtests)

Players mix up the raindrop warnings and the rocks. In the code they look the
same:

| | Rain warning (before) | Rock (before) |
|---|---|---|
| Shape | dark round disc | grey, nearly round blob |
| Ring | white ring around it | full white foam ring around it |
| Size (radius, units) | 15–22 | 16–29 |
| Motion | scrolls down with the river | scrolls down with the river |

They follow different rules, though:

- **Rain:** move the *ant* out of the circle before the ring closes. The leaf
  can sit under a splash for free.
- **Rocks:** solid. Keep the *leaf* from touching them.

## The fix: four changes, drawing and text only

Nothing in `src/game/**` changes. Hitboxes, sizes, timings, scores and the
Daily River stay exactly the same. Only how things look and what the help text
says changes.

### 1. Rain looks like rain (`src/render/drops.ts`)

- **No dark disc.** The splash zone becomes a light "rain circle": a pale blue
  fill (`P.rainFill`) that grows stronger as impact nears.
- **Dashed rim** in `P.rainRim`, slowly turning, on a thin dark under-stroke so
  it reads on pale Marsh water and dark water alike. A dashed line says "zone",
  never "solid thing".
- **A 💧 teardrop in the centre.** It grows from about 0.3 r to 0.5 r as
  impact nears, with a pale body, a dark outline and a highlight. It fades out
  in the last 0.1 s, when the real drop streaks in.
- **The closing ring is the timer and stays as it is:** dark outline, light
  ring, gold when the ant is inside, and four ticks on aimed drops.
- **Night stays at least as readable as today:** keep the glow halos and the
  night fill, and keep the dashed rim brighter at night. Telegraphs must always
  be visible (`CLAUDE.md`).
- **No allocations per frame:** dash arrays are module constants, and paths
  are drawn directly.

### 2. Rocks look like rocks (`src/render/obstacles.ts`, palette)

- **Warm river stone**, using the new palette `rock*` colours and `rockSide`.
  Warm and earthy against the cool blue-white rain.
- **Height:** a darker side face (`P.rockSide`) shows below and right of the
  top face, so the rock sits *up out of* the water. It has a soft cast shadow
  to the lower right, plus the existing moss, cracks and highlights. The
  outline still comes from `rockShape` (`silhouettes.ts`) and must still match
  the collision circle (tests in `tests/unit/silhouettes.test.ts`).
- **No full foam circle and no round dark eddy.** These were what made rocks
  look like rain circles. Water flows *up* the screen past a rock, so instead:
  - a crescent **bow wave** hugs the lower side;
  - a **V-shaped wake** of two foam lines leaves the rock's left and right
    edges, opens upward, gently wobbles, and fades over about 1.6 r;
  - the existing short ripple arcs above the rock stay.

  The Rapids spray and foam streaks stay.
- Night outlines (`night.ts`) already follow the rock's own shape and are
  unchanged.

### 3. Teach it once (`src/ui/**`)

- **One-time hints** in the existing first-time hint (`PickupHint`, the
  `.pk-hint` line). Each shows once ever and is stored as a `seen:*` flag:
  - `rock`: **Rocks**: solid, steer the leaf around them (icon `rock`).
  - `rain`: **Rain**: move the ant out of the circle before the ring closes
    (icon `drop`). This one is for players who already finished the first-run
    tutorial, which explains rain to new players. When the tutorial has not
    been seen yet, `seen:rain` is set instead of showing it.
  - Flags are re-read from storage at the start of every run, and a hint
    waits while the tutorial card is on screen.
- **First-run tutorial:** the rain card says "Rain circles show where drops
  land". Its small visual matches the new look: a dashed light circle with a
  teardrop and a closing ring.
- **How to play:**
  - A new first card, **"Rain or rock?"**, shows both side by side: "💧 Rain:
    get the ant out" and "🪨 Rock: steer around".
  - The rain and rock illustrations are redrawn to match the game.
  - The rule texts say "rain circle" instead of "shadow".
- e2e helpers that skip the tutorial also mark `seen:rain` and `seen:rock`, so
  the Phase 2 hint tests stay about the hint they test.

### 4. Different hit feedback (`src/render/effects.ts`)

- On a `hit` event, a short word floats up from the hit point: **"Splash!"**
  (light blue) for rain, **"Bonk!"** (warm stone) for a rock and **"Snap!"**
  (bark) for a twig.
- It uses a small fixed pool with pre-set strings, so nothing is allocated.
  With reduced motion it fades in place instead of rising.
- The existing particles stay: droplets for rain, chips for rock and twig.

## Not in scope (deferred)

- A separate hit sound for rocks.
- Showing the falling drop for the whole warning. It would be drawn over the
  wrong spot in a top-down view and clutter storms.
- Any change to sizes, hitboxes or spawn rules.

## How it was built (budget run)

- The orchestrator (Opus) wrote this plan and the palette tokens, then
  reviewed, validated and deployed.
- Three Sonnet agents built in parallel on separate files: rain, rocks, and
  teach and feedback.
- Validation: `npm run check`, e2e once, before/after phone screenshots.

## As shipped

- **Gameplay unchanged.** `src/game/**`, `src/types.ts` and `src/config.ts`
  are untouched, so the Daily River, hitboxes and scores are identical.
- **Rain:** a pale fill, a turning dashed rim fitted to the circle (no seam),
  and a 💧 that grows with the timer.
  - The 💧 also fades where the ant is under it, so the ant stays visible
    inside a circle.
  - Night: the glowing rim and the halos are kept. Checked with a forced-dark
    screenshot.
- **Rocks:**
  - Sprites: warm stone, a side face, a cast shadow and a lit shoulder. They
    are rendered 3 R0 wide, with the light kept upper left even when a rock is
    turned.
  - Water: a crescent bow wave, a V wake of three nested strokes, and a narrow
    lee shade. There is no full ring and no round dark eddy.
- **Hints:**
  - `seen:rock` and `seen:rain` in `PickupHint`.
  - `arm()` runs on every run start and resume.
  - Hints wait while the tutorial card is up.
- **How to play:** a new "Rain or rock?" card, and redrawn rain and rock
  pictures.
- **Wording:** the game over tip and the share card art also use the rain
  circle now.
- **Hit words:** "Splash!", "Bonk!" and "Snap!" come from a 4-slot pool. They
  rise, or just fade with reduced motion.
- **Validation:**
  - `npm run check` passes (216 unit tests).
  - e2e: 53 passed, plus the 7 usual skips that run on one project only.
  - Phone screenshots by day and night, plus the hint and the help modal.
- **Budget:** 3 Sonnet builders, about 360k tokens in total. The orchestrator
  reviewed and fixed the rest.
