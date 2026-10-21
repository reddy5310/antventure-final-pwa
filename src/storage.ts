// Local persistence: settings, player name, local leaderboards, lifetime stats.
// localStorage can throw (private mode, blocked storage) — everything falls back
// to an in-memory copy so the game always works.

import type {
  LifetimeStats,
  Mode,
  RunSummary,
  ScoreEntry,
  Settings,
} from './types';

const KEY = 'antventure.v2';
const BOARD_SIZE = 10;
const DAILY_KEEP_DAYS = 14;
const NAME_MAX = 12;

interface SaveData {
  settings: Settings;
  name: string;
  flags: Record<string, boolean>;
  /** 'endless' or 'daily:YYYY-MM-DD' → top entries, best first. */
  boards: Record<string, ScoreEntry[]>;
  dailyAttempts: Record<string, number>;
  stats: LifetimeStats;
}

function prefersReducedMotion(): boolean {
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function defaultSettings(): Settings {
  return {
    music: 0.6,
    sfx: 0.8,
    muted: false,
    haptics: true,
    reducedMotion: prefersReducedMotion(),
    sensitivity: 1,
    showFps: false,
  };
}

function freshData(): SaveData {
  return {
    settings: defaultSettings(),
    name: '',
    flags: {},
    boards: {},
    dailyAttempts: {},
    stats: { runs: 0, totalDistanceM: 0, totalNearMisses: 0, bestCombo: 0 },
  };
}

let data: SaveData = load();

function load(): SaveData {
  const base = freshData();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<SaveData>;
    return {
      ...base,
      ...parsed,
      settings: { ...base.settings, ...parsed.settings },
      stats: { ...base.stats, ...parsed.stats },
    };
  } catch {
    return base;
  }
}

function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Storage unavailable: keep playing with the in-memory copy.
  }
}

export function loadSettings(): Settings {
  return { ...data.settings };
}

export function saveSettings(settings: Settings): void {
  data.settings = { ...settings };
  persist();
}

export function getName(): string {
  return data.name;
}

export function setName(name: string): string {
  const clean = name.replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, NAME_MAX);
  data.name = clean;
  persist();
  return clean;
}

export function getFlag(flag: string): boolean {
  return !!data.flags[flag];
}

export function setFlag(flag: string, value = true): void {
  data.flags[flag] = value;
  persist();
}

export function boardKey(mode: Mode, dailyId: string | null): string {
  return mode === 'daily' ? `daily:${dailyId}` : 'endless';
}

export function getBoard(mode: Mode, dailyId: string | null): ScoreEntry[] {
  return [...(data.boards[boardKey(mode, dailyId)] ?? [])];
}

export function getBest(mode: Mode, dailyId: string | null): ScoreEntry | null {
  return data.boards[boardKey(mode, dailyId)]?.[0] ?? null;
}

export function getDailyAttempts(dailyId: string): number {
  return data.dailyAttempts[dailyId] ?? 0;
}

export function getStats(): LifetimeStats {
  return { ...data.stats };
}

export interface RecordResult {
  entry: ScoreEntry;
  /** 1-based rank on the board, or null if it didn't make the top list. */
  rank: number | null;
  isBest: boolean;
  prevBest: ScoreEntry | null;
  board: ScoreEntry[];
}

export function recordRun(summary: RunSummary): RecordResult {
  const key = boardKey(summary.mode, summary.dailyId);
  const board = data.boards[key] ?? [];
  const prevBest = board[0] ?? null;
  const entry: ScoreEntry = {
    name: data.name || 'You',
    score: summary.score,
    distanceM: summary.distanceM,
    maxCombo: summary.maxCombo,
    nearMisses: summary.nearMisses,
    date: new Date().toISOString(),
    mode: summary.mode,
    dailyId: summary.dailyId,
  };

  const next = [...board, entry].sort((a, b) => b.score - a.score || b.distanceM - a.distanceM);
  const idx = next.indexOf(entry);
  data.boards[key] = next.slice(0, BOARD_SIZE);
  const rank = idx < BOARD_SIZE ? idx + 1 : null;
  const isBest = idx === 0 && summary.score > 0;

  if (summary.mode === 'daily' && summary.dailyId) {
    data.dailyAttempts[summary.dailyId] = getDailyAttempts(summary.dailyId) + 1;
  }
  data.stats.runs += 1;
  data.stats.totalDistanceM += summary.distanceM;
  data.stats.totalNearMisses += summary.nearMisses;
  data.stats.bestCombo = Math.max(data.stats.bestCombo, summary.maxCombo);

  pruneDaily();
  persist();
  return { entry, rank, isBest, prevBest, board: [...data.boards[key]] };
}

function pruneDaily(): void {
  const cutoff = Date.now() - DAILY_KEEP_DAYS * 86400000;
  for (const key of Object.keys(data.boards)) {
    if (!key.startsWith('daily:')) continue;
    const t = Date.parse(key.slice(6));
    if (Number.isFinite(t) && t < cutoff) delete data.boards[key];
  }
  for (const id of Object.keys(data.dailyAttempts)) {
    const t = Date.parse(id);
    if (Number.isFinite(t) && t < cutoff) delete data.dailyAttempts[id];
  }
}

/** Test helper: wipe everything. */
export function resetAll(): void {
  data = freshData();
  persist();
}
