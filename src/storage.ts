// Local persistence: settings, player name, local leaderboards, lifetime stats.
// localStorage can throw (private mode, blocked storage) — everything falls back
// to an in-memory copy so the game always works.
//
// Several tabs (or the installed app plus a browser tab) share one save, so
// every write re-reads the stored copy first and changes only what it means to
// change; a 'storage' event from another tab refreshes this one. Whatever is
// read is validated field by field: a damaged or future-format save degrades
// to defaults instead of breaking boot.

import type { LifetimeStats, Mode, RunSummary, ScoreEntry, Settings } from './types';

const KEY = 'antventure.v2';
const BOARD_SIZE = 10;
const DAILY_KEEP_DAYS = 14;
/** Player names are at most this many user-perceived characters. */
export const NAME_MAX = 12;

interface SaveData {
  settings: Settings;
  name: string;
  flags: Record<string, boolean>;
  /** 'endless' or 'daily:YYYY-MM-DD' → top entries, best first. */
  boards: Record<string, ScoreEntry[]>;
  dailyAttempts: Record<string, number>;
  /** Daily id → score of the first attempt that day (the "first try" a share card shows). */
  dailyFirst: Record<string, number>;
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
    dailyFirst: {},
    stats: { runs: 0, totalDistanceM: 0, totalNearMisses: 0, bestCombo: 0, totalCrumbs: 0 },
  };
}

// --- Validation ---------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, def: number, lo = -Infinity, hi = Infinity): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def;
const bool = (v: unknown, def: boolean): boolean => (typeof v === 'boolean' ? v : def);

function cleanSettings(raw: unknown): Settings {
  const d = defaultSettings();
  if (!isObj(raw)) return d;
  return {
    music: num(raw.music, d.music, 0, 1),
    sfx: num(raw.sfx, d.sfx, 0, 1),
    muted: bool(raw.muted, d.muted),
    haptics: bool(raw.haptics, d.haptics),
    reducedMotion: bool(raw.reducedMotion, d.reducedMotion),
    sensitivity: num(raw.sensitivity, d.sensitivity, 0.5, 2),
    showFps: bool(raw.showFps, d.showFps),
  };
}

function cleanEntry(raw: unknown): ScoreEntry | null {
  if (!isObj(raw) || typeof raw.score !== 'number' || !Number.isFinite(raw.score)) return null;
  return {
    name: typeof raw.name === 'string' ? cleanName(raw.name) || 'You' : 'You',
    score: Math.max(0, Math.floor(raw.score)),
    distanceM: Math.floor(num(raw.distanceM, 0, 0)),
    maxCombo: Math.floor(num(raw.maxCombo, 0, 0)),
    nearMisses: Math.floor(num(raw.nearMisses, 0, 0)),
    date: typeof raw.date === 'string' ? raw.date : new Date(0).toISOString(),
    mode: raw.mode === 'daily' ? 'daily' : 'endless',
    dailyId: typeof raw.dailyId === 'string' ? raw.dailyId : null,
  };
}

const byRank = (a: ScoreEntry, b: ScoreEntry) => b.score - a.score || b.distanceM - a.distanceM;

function cleanBoards(raw: unknown): Record<string, ScoreEntry[]> {
  const out: Record<string, ScoreEntry[]> = {};
  if (!isObj(raw)) return out;
  for (const [key, list] of Object.entries(raw)) {
    if (!Array.isArray(list)) continue;
    const entries = list.map(cleanEntry).filter((e): e is ScoreEntry => e !== null);
    if (entries.length) out[key] = entries.sort(byRank).slice(0, BOARD_SIZE);
  }
  return out;
}

function cleanCounts(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObj(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k] = Math.floor(v);
  }
  return out;
}

function cleanFlags(raw: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (!isObj(raw)) return out;
  for (const [k, v] of Object.entries(raw)) if (typeof v === 'boolean') out[k] = v;
  return out;
}

function cleanStats(raw: unknown): LifetimeStats {
  const s = isObj(raw) ? raw : {};
  return {
    runs: Math.floor(num(s.runs, 0, 0)),
    totalDistanceM: Math.floor(num(s.totalDistanceM, 0, 0)),
    totalNearMisses: Math.floor(num(s.totalNearMisses, 0, 0)),
    bestCombo: Math.floor(num(s.bestCombo, 0, 0)),
    totalCrumbs: Math.floor(num(s.totalCrumbs, 0, 0)),
  };
}

// --- Load / save -----------------------------------------------------------------

let data: SaveData = freshData();
/** False once a write has failed: from then on this tab's memory is the only copy. */
let writable = true;
data = load();

function load(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return freshData();
    const parsed: unknown = JSON.parse(raw);
    if (!isObj(parsed)) return freshData();
    return {
      settings: cleanSettings(parsed.settings),
      name: typeof parsed.name === 'string' ? cleanName(parsed.name) : '',
      flags: cleanFlags(parsed.flags),
      boards: cleanBoards(parsed.boards),
      dailyAttempts: cleanCounts(parsed.dailyAttempts),
      dailyFirst: cleanCounts(parsed.dailyFirst),
      stats: cleanStats(parsed.stats),
    };
  } catch {
    // Unreadable (blocked storage, corrupt JSON): keep what this tab has.
    return data;
  }
}

/** Re-read before a write so another tab's changes are kept, not overwritten. */
function sync(): void {
  if (writable) data = load();
}

function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Storage unavailable (private mode, quota): keep playing with the in-memory copy.
    writable = false;
  }
}

const externalListeners = new Set<() => void>();

try {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY && e.key !== null) return;
    sync();
    for (const cb of externalListeners) cb();
  });
} catch {
  // No window (tests): nothing to listen to.
}

/** Another tab changed the save (this tab's copy is already refreshed). */
export function onExternalChange(cb: () => void): () => void {
  externalListeners.add(cb);
  return () => externalListeners.delete(cb);
}

// --- Settings, name, flags ------------------------------------------------------

export function loadSettings(): Settings {
  return { ...data.settings };
}

export function saveSettings(settings: Settings): void {
  sync();
  data.settings = cleanSettings(settings);
  persist();
}

export function getName(): string {
  return data.name;
}

/**
 * Letters (with their combining marks, so Indic and decomposed accents
 * survive), digits, space and _ . - ; at most NAME_MAX graphemes.
 */
export function cleanName(name: string): string {
  const clean = name.normalize('NFC').replace(/[^\p{L}\p{M}\p{N} _.-]/gu, '').replace(/\s+/g, ' ').trim();
  return truncateGraphemes(clean, NAME_MAX).trim();
}

function truncateGraphemes(s: string, max: number): string {
  type Seg = { segment(input: string): Iterable<{ segment: string }> };
  const Segmenter = (Intl as unknown as { Segmenter?: new (locale?: string, o?: { granularity: string }) => Seg }).Segmenter;
  // Code points, not UTF-16 units, so a surrogate pair is never split.
  const parts = Segmenter
    ? Array.from(new Segmenter(undefined, { granularity: 'grapheme' }).segment(s), (x) => x.segment)
    : Array.from(s);
  return parts.length <= max ? s : parts.slice(0, max).join('');
}

export function setName(name: string): string {
  sync();
  const clean = cleanName(name);
  data.name = clean;
  persist();
  return clean;
}

export function getFlag(flag: string): boolean {
  return !!data.flags[flag];
}

export function setFlag(flag: string, value = true): void {
  sync();
  data.flags[flag] = value;
  persist();
}

// --- Boards ---------------------------------------------------------------------

export function boardKey(mode: Mode, dailyId: string | null): string {
  return mode === 'daily' ? `daily:${dailyId}` : 'endless';
}

export function getBoard(mode: Mode, dailyId: string | null): ScoreEntry[] {
  return [...(data.boards[boardKey(mode, dailyId)] ?? [])];
}

export function getBest(mode: Mode, dailyId: string | null): ScoreEntry | null {
  return data.boards[boardKey(mode, dailyId)]?.[0] ?? null;
}

/** Farthest distance (m) among the board's runs, 0 if none. */
export function getFarthest(mode: Mode, dailyId: string | null): number {
  let m = 0;
  for (const e of data.boards[boardKey(mode, dailyId)] ?? []) m = Math.max(m, e.distanceM);
  return m;
}

export function getDailyAttempts(dailyId: string): number {
  return data.dailyAttempts[dailyId] ?? 0;
}

/** Score of the first attempt at a Daily River, or null before the first run. */
export function getDailyFirst(dailyId: string): number | null {
  return data.dailyFirst[dailyId] ?? null;
}

export function getStats(): LifetimeStats {
  return { ...data.stats };
}

export interface RecordResult {
  entry: ScoreEntry;
  /** 1-based rank on the board, or null if it didn't make the top list. */
  rank: number | null;
  /** Strictly beat the previous best score (a tie is not a new best). */
  isBest: boolean;
  prevBest: ScoreEntry | null;
  board: ScoreEntry[];
}

export function recordRun(summary: RunSummary): RecordResult {
  sync();
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

  const next = [...board, entry].sort(byRank);
  const idx = next.indexOf(entry);
  data.boards[key] = next.slice(0, BOARD_SIZE);
  const rank = idx < BOARD_SIZE ? idx + 1 : null;
  const isBest = summary.score > 0 && summary.score > (prevBest?.score ?? 0);

  if (summary.mode === 'daily' && summary.dailyId) {
    const id = summary.dailyId;
    if (!(id in data.dailyFirst) && getDailyAttempts(id) === 0) data.dailyFirst[id] = summary.score;
    data.dailyAttempts[id] = getDailyAttempts(id) + 1;
  }
  data.stats.runs += 1;
  data.stats.totalDistanceM += summary.distanceM;
  data.stats.totalNearMisses += summary.nearMisses;
  data.stats.bestCombo = Math.max(data.stats.bestCombo, summary.maxCombo);
  data.stats.totalCrumbs += Math.max(0, Math.floor(summary.crumbs || 0));

  pruneDaily();
  persist();
  return { entry, rank, isBest, prevBest, board: [...data.boards[key]] };
}

function pruneDaily(): void {
  const cutoff = Date.now() - DAILY_KEEP_DAYS * 86400000;
  const old = (id: string) => {
    const t = Date.parse(id);
    return Number.isFinite(t) && t < cutoff;
  };
  for (const key of Object.keys(data.boards)) {
    if (key.startsWith('daily:') && old(key.slice(6))) delete data.boards[key];
  }
  for (const id of Object.keys(data.dailyAttempts)) if (old(id)) delete data.dailyAttempts[id];
  for (const id of Object.keys(data.dailyFirst)) if (old(id)) delete data.dailyFirst[id];
}

/** Test helper: wipe everything. */
export function resetAll(): void {
  data = freshData();
  persist();
}
