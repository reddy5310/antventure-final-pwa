// Sharing a run: the native share sheet where it exists (phones), with a
// pre-drawn image card when the platform accepts files, otherwise the
// clipboard. Daily River shares link straight into the same river
// (?mode=daily, handled by main.ts), so a friend is one tap from the challenge.

import type { DailyInfo, RunSummary } from '../types';
import { fmtInt, fmtMeters, plural } from './format';
import { renderShareCard } from './sharecard';

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

export interface ShareContext {
  /** Daily attempts so far (including this run). */
  attempts: number;
  /** Score of today's first attempt, if known. */
  firstTry: number | null;
  isBest: boolean;
  name: string;
}

export function shareUrl(daily: DailyInfo | null): string {
  const base = location.origin + location.pathname;
  return daily ? `${base}?mode=daily` : base;
}

export function buildShareText(s: RunSummary, daily: DailyInfo | null, ctx?: Partial<ShareContext>): string {
  const lines = [daily ? `🐜 Antventure · Daily River #${daily.number}` : '🐜 Antventure · Endless river'];
  const parts = [`${fmtInt(s.score)} pts${ctx?.isBest ? ' (new best!)' : ''}`, fmtMeters(s.distanceM)];
  if (s.nearMisses > 0) parts.push(plural(s.nearMisses, 'near-miss', 'near-misses'));
  // "chain", not "×N combo": × is the score multiplier (max ×5).
  if (s.maxCombo > 1) parts.push(`${fmtInt(s.maxCombo)} chain`);
  lines.push(parts.join(' · '));
  if (daily && ctx?.attempts && ctx.attempts > 1) {
    const first = ctx.firstTry !== null && ctx.firstTry !== undefined ? ` · first try ${fmtInt(ctx.firstTry)}` : '';
    lines.push(`Attempt ${ctx.attempts}${first}`);
  }
  lines.push(daily ? 'Same river for everyone today. Can you beat it?' : 'Can you beat it?');
  return lines.join('\n');
}

/** Whether this browser can share image files (decides if a card is worth drawing). */
export function canShareFiles(): boolean {
  try {
    if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
    const probe = new File([new Uint8Array(1)], 'probe.png', { type: 'image/png' });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

/** Draws the share card as a File, or null when unsupported or it fails. */
export async function prepareShareCard(s: RunSummary, daily: DailyInfo | null, ctx: ShareContext): Promise<File | null> {
  if (!canShareFiles()) return null;
  try {
    const blob = await renderShareCard(s, daily, { name: ctx.name, isBest: ctx.isBest, attempts: ctx.attempts });
    if (!blob) return null;
    const file = new File([blob], daily ? `antventure-daily-${daily.number}.png` : 'antventure-run.png', { type: 'image/png' });
    return navigator.canShare({ files: [file] }) ? file : null;
  } catch {
    return null;
  }
}

async function copy(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied or insecure context: try the legacy path.
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

const isAbort = (err: unknown) => err instanceof DOMException && err.name === 'AbortError';

/**
 * Shares a run. `card` must already be drawn: the share sheet has to open
 * within the tap's user activation, so nothing slow may run before it.
 */
export async function shareRun(s: RunSummary, daily: DailyInfo | null, ctx: ShareContext, card: File | null = null): Promise<ShareResult> {
  const text = buildShareText(s, daily, ctx);
  const url = shareUrl(daily);
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share(card ? { title: 'Antventure', text, url, files: [card] } : { title: 'Antventure', text, url });
      return 'shared';
    } catch (err) {
      if (isAbort(err)) return 'cancelled';
      if (card) {
        // Some targets refuse files: try once more with text only.
        try {
          await navigator.share({ title: 'Antventure', text, url });
          return 'shared';
        } catch (err2) {
          if (isAbort(err2)) return 'cancelled';
        }
      }
      // Share sheet unavailable (e.g. desktop without targets): fall back to copying.
    }
  }
  return (await copy(`${text}\n${url}`)) ? 'copied' : 'failed';
}
