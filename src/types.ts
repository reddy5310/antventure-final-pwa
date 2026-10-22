// Shared contracts between the game modules. Coordinates are in "world units":
// the playfield is WORLD_W units wide; y = 0 is the top of the visible view and
// grows downward. The camera follows the river, so things on the water scroll
// down the screen as the leaf drifts downstream.

import type { Rng } from './engine/rng';

export type Mode = 'endless' | 'daily';

/** attract = menu backdrop (no hazards, no damage). */
export type RunState = 'attract' | 'running' | 'dying' | 'over';

export type StormPhase = 'calm' | 'drizzle' | 'downpour' | 'cloudburst';

export type HitSource = 'drop' | 'rock' | 'twig';

/** River zones, laid out by distance (src/game/zones.ts). */
export type ZoneId = 'jungle' | 'marsh' | 'rapids' | 'night';

export type PickupKind = 'crumb' | 'mushroom' | 'honey' | 'ladybug' | 'firefly';

/** Pickups with a timed effect (the ladybug is instant). */
export type PowerKind = 'mushroom' | 'honey' | 'firefly';

export type Device = 'touch' | 'mouse' | 'keyboard' | 'gamepad';

export interface Player {
  /** Leaf centre (the ant sits at the centre). */
  x: number;
  y: number;
  /** Where steering wants the leaf to be; x eases towards it. */
  targetX: number;
  /** Horizontal velocity, units/s (for tilt, wake and leg animation). */
  vx: number;
  hearts: number;
  /** Seconds of invulnerability left after a hit. */
  invuln: number;
  /** Seconds left of the hurt flash. */
  hurt: number;
  /** 0..1 how soaked the ant looks. */
  wet: number;
  /** Visual tilt of the leaf in radians. */
  tilt: number;
}

export interface Drop {
  id: number;
  /** Landing point; scrolls with the river while the drop falls. */
  x: number;
  y: number;
  /** Seconds since the drop was spawned. */
  age: number;
  /** Seconds from spawn to impact (the telegraph length). */
  fall: number;
  /** Splash radius: the ant is hit if its centre is within r + ANT_HIT_R. */
  r: number;
  /** Spawned targeting the player. */
  aimed: boolean;
}

/** 'pad' = lily pad (Lily Marsh): a soft bumper that pushes the leaf, never damages. */
export type ObstacleKind = 'rock' | 'twig' | 'pad';

export interface Obstacle {
  id: number;
  kind: ObstacleKind;
  x: number;
  y: number;
  /** Rock: collision radius. Twig: half thickness of its capsule. */
  r: number;
  /** Twig: half length of its capsule. 0 for rocks. */
  len: number;
  angle: number;
  /** Radians per second. */
  spin: number;
  /** Lateral drift, units/s. */
  vx: number;
  /** 0..1, stable per obstacle, for render variety. */
  variant: number;
  /** Already collided with the leaf (no double hits). */
  hit: boolean;
}

/** A collectible floating on the river (scrolls with it, like obstacles). */
export interface Pickup {
  id: number;
  kind: PickupKind;
  x: number;
  y: number;
  /** Crumb trail id (for the Perfect-trail bonus); 0 for power-ups. */
  trail: number;
  /** Collected this run; renderer may animate it out, sim removes it soon after. */
  taken: boolean;
  /** 0..1, stable per pickup, for render variety. */
  variant: number;
}

export interface ActivePower {
  kind: PowerKind;
  /** Seconds left. */
  left: number;
  /** Full duration (for HUD timer rings). */
  total: number;
}

export type GameEvent =
  | { type: 'start' }
  | { type: 'drop-impact'; x: number; y: number; r: number; onLeaf: boolean }
  | { type: 'near-miss'; x: number; y: number; combo: number; points: number }
  | { type: 'hit'; x: number; y: number; source: HitSource; heartsLeft: number }
  | { type: 'bank-bump'; x: number; y: number; side: -1 | 1 }
  | { type: 'combo-lost'; combo: number }
  | { type: 'milestone'; meters: number }
  | { type: 'new-best' }
  | { type: 'storm'; phase: StormPhase }
  | { type: 'death'; x: number; y: number }
  | { type: 'game-over' }
  | { type: 'zone'; zone: ZoneId }
  /** points: score added (0 for the instant ladybug heal); streak: crumbs taken in a row in this trail. */
  | { type: 'pickup'; kind: PickupKind; x: number; y: number; points: number; streak: number }
  | { type: 'trail-complete'; x: number; y: number; points: number }
  | { type: 'power-start'; kind: PowerKind; duration: number }
  | { type: 'power-end'; kind: PowerKind }
  /** The mushroom cap absorbed a hit. */
  | { type: 'shield-block'; x: number; y: number; source: HitSource }
  /** Ladybug restored a heart. */
  | { type: 'heal'; hearts: number }
  | { type: 'pad-bump'; x: number; y: number };

export interface World {
  mode: Mode;
  seed: number;
  dailyId: string | null;
  rng: Rng;
  state: RunState;
  /** Simulated seconds since the run started. */
  time: number;
  /** World units travelled downstream. */
  distance: number;
  /** Current river speed, units/s. */
  scrollSpeed: number;
  /** Visible world height (units). Player y is derived from it. */
  viewH: number;
  player: Player;
  drops: Drop[];
  obstacles: Obstacle[];
  score: number;
  combo: number;
  /** Seconds before the combo decays; 0 when there is no combo. */
  comboTimer: number;
  multiplier: number;
  maxCombo: number;
  nearMisses: number;
  hitsTaken: number;
  storm: StormPhase;
  /** 0..1 storm intensity, drives visuals and audio. */
  intensity: number;
  /**
   * Personal best SCORE on this board, 0 if none. Score is the one competitive
   * metric: beating it fires 'new-best' (once) and sets beatBest.
   */
  bestScore: number;
  beatBest: boolean;
  /** Farthest distance (units) reached on this board, 0 if none. Drawn as a flag on the river. */
  bestDistance: number;
  /** The leaf has passed the farthest-distance flag (no event: the flag itself lights up). */
  passedBest: boolean;
  /** Seconds since death began (state 'dying'). */
  deathTimer: number;
  nextId: number;
  /** Filled by stepWorld; drained by main after every step. */
  events: GameEvent[];

  // --- Phase 2 -------------------------------------------------------------
  /** Zone at the leaf. */
  zone: ZoneId;
  /** Zone being blended towards (equals zone outside transitions). */
  nextZone: ZoneId;
  /** 0..1 blend from zone to nextZone at the leaf. */
  zoneBlend: number;
  /** Zones entered this run, counting the opening Jungle (summary + game over). */
  zonesReached: number;
  pickups: Pickup[];
  /** Crumbs collected this run. */
  crumbs: number;
  /** Active timed power-ups (at most one per kind). */
  powers: ActivePower[];
  /** 0 = daylight .. 1 = full night darkness at the leaf (renderer + firefly). */
  darkness: number;
}

/** Per-step steering input. */
export interface InputFrame {
  /** Relative drag since the last frame, already in world units (touch/pen). */
  steerDelta: number;
  /** -1..1 analogue steering (keyboard / gamepad). */
  axis: number;
  /** Absolute target x in world units (mouse hover), or null. */
  absoluteX: number | null;
}

export type Action = 'confirm' | 'pause' | 'back' | 'retry' | 'mute';

export interface Settings {
  /** 0..1 */
  music: number;
  /** 0..1 */
  sfx: number;
  muted: boolean;
  haptics: boolean;
  reducedMotion: boolean;
  /** Touch drag sensitivity multiplier, 0.5..2. */
  sensitivity: number;
  showFps: boolean;
}

export interface ScoreEntry {
  name: string;
  score: number;
  distanceM: number;
  maxCombo: number;
  nearMisses: number;
  /** ISO timestamp. */
  date: string;
  mode: Mode;
  dailyId: string | null;
}

export interface LifetimeStats {
  runs: number;
  totalDistanceM: number;
  totalNearMisses: number;
  bestCombo: number;
  totalCrumbs: number;
}

export interface RunSummary {
  mode: Mode;
  dailyId: string | null;
  seed: number;
  score: number;
  distanceM: number;
  timeS: number;
  nearMisses: number;
  maxCombo: number;
  hitsTaken: number;
  /** What took the last heart; null for a run that did not end in death. */
  killedBy: HitSource | null;
  crumbs: number;
  zonesReached: number;
}

export interface DailyInfo {
  /** Local date, YYYY-MM-DD. */
  id: string;
  /** 1-based puzzle-style number, e.g. "Daily River #12". */
  number: number;
  seed: number;
}

export interface TitleInfo {
  name: string;
  endlessBest: ScoreEntry | null;
  daily: DailyInfo & { best: ScoreEntry | null; attempts: number };
  stats: LifetimeStats;
}

export interface GameOverInfo {
  summary: RunSummary;
  /** 1-based rank on this mode's local leaderboard, null if it didn't place. */
  rank: number | null;
  isBest: boolean;
  prevBest: ScoreEntry | null;
  board: ScoreEntry[];
  daily: DailyInfo | null;
}

export type Sfx =
  | 'tap'
  | 'back'
  | 'start'
  | 'countdown'
  | 'go'
  | 'pause'
  | 'splash'
  | 'near-miss'
  | 'hit'
  | 'bump'
  | 'combo-lost'
  | 'milestone'
  | 'new-best'
  | 'thunder'
  | 'death'
  | 'crumb'
  | 'trail'
  | 'power'
  | 'power-end'
  | 'shield'
  | 'heart-up'
  | 'zone'
  | 'pad';

export type AudioScene = 'menu' | 'run' | 'paused' | 'over';

export type TutorialHint = 'steer' | 'shadows' | null;
