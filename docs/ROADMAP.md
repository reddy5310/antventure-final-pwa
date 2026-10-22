# Antventure roadmap

| Phase | Theme | Status |
|---|---|---|
| 1 | Modern rebuild: fair telegraphed rain, near-miss combos, Daily River, local leaderboards, installable PWA | ✅ Shipped (see README) |
| 2 | More to chase: river zones, crumbs, power-ups, night river | ✅ Shipped (`docs/phase-2/PLAN.md`) |
| 3 | Reasons to come back: streak, daily missions, crumb shop with skins, achievements, polish | ✅ Shipped (`docs/phase-3/PLAN.md`) |
| 4 | More game, still offline | 💡 Ideas |
| 5 | Online and competitive | 💡 Ideas |
| 6 | Reach and polish | 💡 Ideas |

Rules that hold for every phase: the simulation stays deterministic, the
Daily River stays identical for everyone, rain telegraphs stay visible, and
nothing pay-to-win is ever added (see `CLAUDE.md`).

## Phase 4: more game, still offline (medium cost)

1. **Ghost of your best run.**
   - A see-through leaf replays your best path in each mode, including the
     Daily River.
   - Record the leaf's x position about every 0.25 s, roughly 4 KB per run.
   - This is the strongest competitive feature left.
2. **Leaf boats.** Lotus, Maple and Banana leaf shapes, sold in the shop. They
   are purely visual; the leaf's hitbox never changes.
3. **New zones.**
   - **Urban Drain:** concrete banks, litter, and whirlpools that pull the
     leaf sideways.
   - **Waterfall finale:** a speed burst that pays double points.
4. **Storm Surge events.** A 10-second burst of patterned rain with a big
   bonus for getting through without a hit.
5. **Weekly challenge.** A fixed seed for the whole week, with its own
   leaderboard tab.

## Phase 5: online and competitive (needs a small backend)

1. **Global Daily leaderboard with cheat checks.**
   - The simulation is deterministic, so a run can be submitted as its seed
     plus its inputs.
   - The server replays the inputs and confirms the score before accepting
     it. This is far stronger than trusting a score sent by the browser.
   - Hosting options: Cloudflare Workers with D1/KV, or Supabase. Both have
     free tiers that should cover a small game.
2. **Friend codes and rivals.** Compare Daily results with friends, plus a
   "beat my score" share link.
3. **Optional sign-in** to keep progress across devices. Local play stays the
   default.

## Phase 6: reach and polish (low to medium cost, mostly one-time)

1. **Android Play Store:** wrap the PWA as a Trusted Web Activity with
   Bubblewrap. There is a one-time developer fee.
2. **iOS App Store:** a Capacitor wrapper. Requires an Apple developer
   membership.
3. **Accessibility:**
   - colour-blind palettes
   - one-hand mode
   - high-contrast telegraph option
   - a sound-free mode with stronger visual cues
4. **Languages:** move all UI text into one file, then translate.
5. **Analytics:** privacy-friendly and cookie-free (for example Plausible or
   self-hosted), to see where players drop off and adjust difficulty.
6. **Error reporting**, plus a test run on a real low-end phone to tune the
   quality governor.

## Ongoing (cheap, continuous)

- Tune balance from playtests and analytics (constants only).
- Add one new cosmetic or mission template a week to keep things fresh. Each
  is small enough for one `@claude` comment on a GitHub issue through
  `.github/workflows/claude.yml`. That needs the `CLAUDE_CODE_OAUTH_TOKEN`
  repository secret (from `claude setup-token`).
- Keep `CLAUDE.md` and the plan docs current, so every new session starts
  cheaply.

## Optional: income (only if wanted, after Phase 5)

- Cosmetic-only purchases (skin packs) or a "supporter" badge.
- **Never pay-to-win**, so leaderboards stay fair.
- Stores, payments and their policies add real work and cost.

## Working on a budget (lessons from Phases 1–2)

- Use a strong model (Opus) for planning, the shared definitions and the final
  review. Use Sonnet for building.
- Start a fresh session per phase.
- Keep multi-agent runs small: 4–5 builders on separate files, and give every
  agent a `model: 'sonnet'` override.
- Commit checkpoints often. Container restarts happened 3 times in Phase 2,
  and only the interrupted agent's work had to be redone.
- Avoid screenshot-heavy agent loops. The owner playtesting on a real phone is
  free and more accurate.
