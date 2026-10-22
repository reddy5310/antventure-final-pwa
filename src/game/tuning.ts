// Gameplay tuning that only the simulation needs. Cross-module constants
// (world size, hit radii, sim step) live in ../config.

import { LEAF_HIT_R } from '../config';

// --- Steering -------------------------------------------------------------

/** Keyboard / gamepad: how fast full deflection moves the steering target (u/s). */
export const KEY_SPEED = 420;
/** A key press starts at this fraction of KEY_SPEED so short taps nudge finely. */
export const KEY_RAMP_START = 0.45;
/** Seconds of holding before the key reaches full speed. */
export const KEY_RAMP_TIME = 0.12;
/** On key release keep this share of the target's lead, so the leaf stops close to where you let go. */
export const KEY_RELEASE_KEEP = 0.4;
/** Exponential follow rate of the leaf towards its target (1/s): responsive but watery. */
export const FOLLOW_RATE = 18;
/** Hard cap on leaf speed for every device, so mouse/touch cannot teleport (u/s). */
export const MAX_LEAF_SPEED = 560;
/** Leaf centre stays this far inside the water's edge. */
export const BANK_MARGIN = LEAF_HIT_R + 4;
export const BANK_BUMP_COOLDOWN = 0.35;
/** Max visual tilt (radians) and the speed that reaches it. */
export const TILT_MAX = 0.42;
export const TILT_SPEED_REF = 420;

// --- Run flow ---------------------------------------------------------------

export const ATTRACT_SCROLL = 70;
/** Seconds the river takes to stop after death. */
export const DEATH_STOP_TIME = 0.9;
/** Seconds from death to game over. */
export const DEATH_DURATION = 1.1;

// --- Damage -----------------------------------------------------------------

export const INVULN_TIME = 1.6;
export const HURT_TIME = 0.35;
export const WET_PER_HIT = 0.34;
/** A splash landing on the leaf (missing the ant) dampens it a little. */
export const WET_PER_SPLASH = 0.04;
/** Wetness dries at this rate (per second)... */
export const DRY_RATE = 0.035;
/** ...but never below this share of the storm intensity (it is raining, after all). */
export const WET_FLOOR_PER_INTENSITY = 0.25;
/** Obstacle hits push the leaf away from the obstacle (target shift, units). */
export const KNOCKBACK = 30;

// --- Scoring ----------------------------------------------------------------

/** Drops whose splash misses the ant by less than this are near-misses. */
export const NEAR_BAND = 20;
export const NEAR_MISS_POINTS = 25;
export const COMBO_TIME = 3.5;
export const COMBO_STEP = 0.25;
export const COMBO_CAP = 16;
export const MILESTONE_M = 100;

// --- Raindrops --------------------------------------------------------------

export const DROP_R_MIN = 15;
export const DROP_R_MAX = 22;
/** Aimed drops land within this many units of the player (seeded). */
export const AIM_SPREAD = 12;
/** Aimed drops lead a moving player by vx * this * level (s), clamped. */
export const AIM_LEAD = 0.12;
export const AIM_LEAD_MAX = 40;
/** Patterns get this much more telegraph than singles, for readability. */
export const PATTERN_EXTRA_FALL = 0.12;
export const PATTERN_MAX_FALL = 1.15;
/** Hard cap on live drops (perf and readability). */
export const MAX_DROPS = 56;

// --- Fairness ---------------------------------------------------------------

/** Assumed human reaction time before a dodge starts (s). */
export const REACTION = 0.22;
/** Only this share of the theoretical reach is assumed usable. */
export const REACH_SAFETY = 0.9;
/** Extra margin added to every forbidden interval (units). */
export const HIT_PAD = 3;
/** A safe spot must be at least this wide to count (units). */
export const MIN_SAFE_WIDTH = 8;

// --- Obstacles --------------------------------------------------------------

/** River distance of the first obstacle (units): it reaches the leaf after ~9 s. */
export const FIRST_OBSTACLE_D = 1000;
/** Every obstacle leaves at least one lane this wide for the leaf centre. */
export const OBSTACLE_PASS = 34;
export const ROCK_R_MIN = 16;
export const ROCK_R_MAX = 29;
export const TWIG_R = 6;
export const TWIG_LEN_MIN = 18;
export const TWIG_LEN_MAX = 62;
/** Gate: a pair of rocks around a guaranteed lane of this width (leaf centre). */
export const GATE_LANE = 40;
/** Entities this far below the view are removed. */
export const DESPAWN_BELOW = 120;
