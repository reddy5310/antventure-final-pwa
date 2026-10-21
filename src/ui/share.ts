// Sharing a run: the native share sheet where it exists (phones), otherwise
// the clipboard. The text is self-contained (score line + link) so it reads
// well in any chat app.

import type { DailyInfo, RunSummary } from '../types';
import { fmtInt, fmtMeters } from './format';

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

export function shareUrl(): string {
  return location.origin + location.pathname;
}

export function buildShareText(s: RunSummary, daily: DailyInfo | null): string {
  const head = daily ? `🐜 Antventure Daily River #${daily.number}` : '🐜 Antventure';
  const parts = [`${fmtInt(s.score)} pts`, fmtMeters(s.distanceM)];
  if (s.maxCombo > 1) parts.push(`x${s.maxCombo} combo`);
  return `${head} — ${parts.join(' · ')}  ${shareUrl()}`;
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

export async function shareText(text: string): Promise<ShareResult> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: 'Antventure', text });
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
      // Share sheet unavailable (e.g. desktop without targets): fall back to copying.
    }
  }
  return (await copy(text)) ? 'copied' : 'failed';
}
