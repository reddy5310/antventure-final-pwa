// Cross-module constants. Module-specific tuning lives in each module.

/** Playfield width in world units. Fixed on every device so runs are comparable. */
export const WORLD_W = 400;
/** The view is scaled so at least this much world height is visible. */
export const MIN_VIEW_H = 740;
/** Distance from the bottom of the view to the leaf centre. */
export const PLAYER_FROM_BOTTOM = 190;
/** Obstacles spawn this far above the leaf, the same on every screen. */
export const SPAWN_AHEAD = 950;

/** Fixed simulation step (seconds). Gameplay is frame-rate independent. */
export const SIM_DT = 1 / 120;
export const MAX_STEPS_PER_FRAME = 12;

export const UNITS_PER_METER = 50;
export const MAX_HEARTS = 3;

/** Leaf drawn size (world units). */
export const LEAF_W = 78;
export const LEAF_H = 50;
/** Leaf collision radius against obstacles and banks. */
export const LEAF_HIT_R = 26;
/** Ant collision radius against raindrops. */
export const ANT_HIT_R = 10;

/** River distance (units) over which the river narrows to its tightest. */
export const RIVER_NARROW_DIST = 40000;

/** First day of the Daily River (local date). Daily #1. */
export const DAILY_EPOCH = '2026-10-21';
