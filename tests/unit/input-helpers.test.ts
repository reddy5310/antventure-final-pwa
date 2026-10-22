import { describe, expect, it } from 'vitest';
import { HeldDirections, keyAction, keyDirection, pickSpatial, stickResponse, type NavRect } from '../../src/engine/input';

describe('stickResponse', () => {
  it('ignores the deadzone and noise', () => {
    expect(stickResponse(0)).toBe(0);
    expect(stickResponse(0.1)).toBe(0);
    expect(stickResponse(-0.18)).toBe(0);
    expect(stickResponse(Number.NaN)).toBe(0);
  });

  it('reaches full deflection before the physical edge', () => {
    expect(stickResponse(0.95)).toBeCloseTo(1, 5);
    expect(stickResponse(1)).toBe(1);
    expect(stickResponse(-1)).toBe(-1);
  });

  it('is monotonic, odd, and gentler than linear near the centre', () => {
    let prev = 0;
    for (let x = 0.19; x <= 1; x += 0.01) {
      const y = stickResponse(x);
      expect(y).toBeGreaterThanOrEqual(prev);
      expect(stickResponse(-x)).toBeCloseTo(-y, 10);
      prev = y;
    }
    // Half-way through the live range gives well under half speed (fine control).
    const mid = 0.18 + (0.95 - 0.18) / 2;
    expect(stickResponse(mid)).toBeLessThan(0.4);
    expect(stickResponse(mid)).toBeGreaterThan(0.2);
  });
});

describe('keyboard mapping', () => {
  it('maps arrows and A/D by position, and Q by label for AZERTY', () => {
    expect(keyDirection('ArrowLeft', 'ArrowLeft')).toBe(-1);
    expect(keyDirection('ArrowRight', 'ArrowRight')).toBe(1);
    expect(keyDirection('KeyA', 'a')).toBe(-1);
    expect(keyDirection('KeyD', 'd')).toBe(1);
    // AZERTY: the key labelled Q sits where QWERTY has A.
    expect(keyDirection('KeyA', 'q')).toBe(-1);
    // AZERTY: the key labelled A (QWERTY's Q position).
    expect(keyDirection('KeyQ', 'a')).toBe(-1);
    expect(keyDirection('KeyD', 'D')).toBe(1);
    expect(keyDirection('KeyW', 'w')).toBe(0);
    expect(keyDirection('Space', ' ')).toBe(0);
  });

  it('maps hotkeys', () => {
    expect(keyAction('Space', ' ')).toBe('confirm');
    expect(keyAction('Enter', 'Enter')).toBe('confirm');
    expect(keyAction('NumpadEnter', 'Enter')).toBe('confirm');
    expect(keyAction('Escape', 'Escape')).toBe('back');
    expect(keyAction('KeyP', 'p')).toBe('pause');
    expect(keyAction('KeyR', 'R')).toBe('retry');
    expect(keyAction('KeyM', 'm')).toBe('mute');
    expect(keyAction('KeyX', 'x')).toBeNull();
    expect(keyAction('Tab', 'Tab')).toBeNull();
  });

  it('follows the printed label on Latin layouts and position on non-Latin ones', () => {
    // Dvorak: the physical R key types "p".
    expect(keyAction('KeyR', 'p')).toBe('pause');
    // AZERTY: physical M types ",", which is not a hotkey.
    expect(keyAction('KeyM', ',')).toBeNull();
    // Russian: physical R types "к"; fall back to the position.
    expect(keyAction('KeyR', 'к')).toBe('retry');
  });
});

describe('HeldDirections', () => {
  it('lets the most recent key win and falls back on release', () => {
    const h = new HeldDirections();
    expect(h.axis).toBe(0);
    h.press('ArrowLeft', -1);
    expect(h.axis).toBe(-1);
    h.press('ArrowRight', 1);
    expect(h.axis).toBe(1);
    h.release('ArrowRight');
    expect(h.axis).toBe(-1);
    h.release('ArrowLeft');
    expect(h.axis).toBe(0);
  });

  it('treats auto-repeat as one key and survives stray releases', () => {
    const h = new HeldDirections();
    h.press('KeyA', -1);
    h.press('ArrowRight', 1);
    h.press('KeyA', -1);
    expect(h.axis).toBe(-1);
    h.release('KeyZ');
    h.release('KeyA');
    expect(h.axis).toBe(1);
    h.clear();
    expect(h.axis).toBe(0);
  });
});

describe('pickSpatial', () => {
  const r = (x: number, y: number, w = 100, h = 40): NavRect => ({ x, y, w, h });
  // A vertical menu with a row of two small buttons at the bottom.
  const play = r(100, 100);
  const daily = r(100, 160);
  const settings = r(100, 220, 45);
  const board = r(155, 220, 45);

  it('moves along a column', () => {
    expect(pickSpatial(play, [daily, settings, board], 'down')).toBe(0);
    expect(pickSpatial(daily, [play, settings, board], 'up')).toBe(0);
  });

  it('moves along a row', () => {
    expect(pickSpatial(settings, [play, daily, board], 'right')).toBe(2);
    expect(pickSpatial(board, [play, daily, settings], 'left')).toBe(2);
  });

  it('prefers aligned candidates over merely closer ones', () => {
    const aligned = r(100, 400);
    const offside = r(400, 300);
    expect(pickSpatial(play, [offside, aligned], 'down')).toBe(1);
  });

  it('returns -1 at an edge without wrap, wraps within the column with it', () => {
    expect(pickSpatial(settings, [play, daily, board], 'down')).toBe(-1);
    expect(pickSpatial(daily, [play, settings], 'down', true)).toBe(1);
    expect(pickSpatial(settings, [play, daily, board], 'down', true)).toBe(0);
    // Nothing in the same row to wrap to.
    expect(pickSpatial(r(100, 600), [r(500, 100)], 'down', true)).toBe(-1);
  });
});
