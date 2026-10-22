// Number/date formatting for the UI. Hand-rolled instead of Intl so the HUD
// can format a changing score many times a second without allocating
// formatter state, and so numbers look identical on every device (runs are
// shared and compared).

/** 1234567 → "1,234,567". */
export function fmtInt(n: number): string {
  const v = Math.floor(Math.abs(n));
  const s = String(v);
  const sign = n < 0 ? '-' : '';
  if (s.length <= 3) return sign + s;
  let out = '';
  const head = s.length % 3;
  if (head) out = s.slice(0, head);
  for (let i = head; i < s.length; i += 3) {
    out += (out ? ',' : '') + s.slice(i, i + 3);
  }
  return sign + out;
}

/** Whole metres → "512 m" / "1,234 m". */
export function fmtMeters(m: number): string {
  return `${fmtInt(m)} m`;
}

/** Lifetime totals: metres below 1 km, then "12.3 km". */
export function fmtDistance(m: number): string {
  if (m < 1000) return fmtMeters(m);
  const km = m / 1000;
  return `${km < 100 ? km.toFixed(1) : fmtInt(km)} km`;
}

/** Seconds → "2:05". */
export function fmtTime(s: number): string {
  const total = Math.max(0, Math.floor(s));
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min}:${sec < 10 ? '0' : ''}${sec}`;
}

/** 2.5 → "×2.5", 2 → "×2", 1.25 → "×1.25". */
export function fmtMult(m: number): string {
  return `×${Math.round(m * 100) / 100}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** ISO timestamp → "Today", "Yesterday", "3d ago", "Oct 12". */
export function fmtRelDate(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** 1 → "1st", 2 → "2nd", 11 → "11th". */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${fmtInt(n)} ${n === 1 ? one : many}`;
}
