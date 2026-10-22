let enabled = true;

export function setHapticsEnabled(on: boolean): void {
  enabled = on;
}

/** Best-effort vibration (Android/Chrome; silently ignored elsewhere). */
export function vibrate(pattern: number | number[]): void {
  if (!enabled) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Not supported.
  }
}
