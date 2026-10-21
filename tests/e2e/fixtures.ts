// Shared e2e plumbing. Tests drive the game through the same surfaces a
// player uses (roles/names, keys, touch) and read state from the debug hook
// main.ts exposes as window.__ant, so nothing test-only lives in src/.

import { test as base, expect, type Locator, type Page } from '@playwright/test';
import type * as Storage from '../../src/storage';
import type { Mode, Settings, World } from '../../src/types';

export type Scene = 'menu' | 'run' | 'paused' | 'over';

/** Shape of window.__ant (main.ts types it as unknown on purpose). */
export interface AntHook {
  readonly world: World;
  readonly scene: Scene;
  readonly settings: Settings;
  readonly storage: typeof Storage;
  play(mode: Mode): void;
  pause(): void;
  resume(): void;
  menu(): void;
}

/** For page.evaluate callbacks: `(window as unknown as AntWindow).__ant`. */
export interface AntWindow {
  __ant: AntHook;
}

interface ErrorLog {
  readonly messages: string[];
  /** Tolerate console errors matching `pattern` in this test (page errors still fail). */
  allowConsole(pattern: RegExp): void;
}

/**
 * Every test fails on an uncaught exception or a console error, so a broken
 * module, a 404 or an unhandled rejection anywhere in a flow is caught.
 */
export const test = base.extend<{ errors: ErrorLog }>({
  errors: [
    async ({ page }, use) => {
      const messages: string[] = [];
      const allowed: RegExp[] = [];
      page.on('pageerror', (err) => messages.push(`pageerror: ${err.message}`));
      page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        const text = msg.text();
        if (!allowed.some((re) => re.test(text))) messages.push(`console.error: ${text}`);
      });
      await use({ messages, allowConsole: (re) => void allowed.push(re) });
      expect(messages, 'page errors / console errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

// --- Locators (the names the UI promises) -----------------------------------

/** Title screen: endless run. Anchored so "How to play" never matches. */
export const playButton = (page: Page): Locator => page.getByRole('button', { name: /^play\b/i });
export const dailyButton = (page: Page): Locator => page.getByRole('button', { name: /daily/i }).first();
export const pauseButton = (page: Page): Locator => page.getByRole('button', { name: /^pause\b/i });
export const resumeButton = (page: Page): Locator => page.getByRole('button', { name: /resume/i });
export const retryButton = (page: Page): Locator => page.getByRole('button', { name: /retry/i });

// --- State reads ----------------------------------------------------------------

export function scene(page: Page): Promise<Scene> {
  return page.evaluate(() => (window as unknown as AntWindow).__ant.scene);
}

export function distance(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as AntWindow).__ant.world.distance);
}

export function playerX(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as AntWindow).__ant.world.player.x);
}

export interface RunInfo {
  mode: Mode;
  seed: number;
  dailyId: string | null;
  hearts: number;
  distance: number;
  state: World['state'];
}

export function runInfo(page: Page): Promise<RunInfo> {
  return page.evaluate(() => {
    const w = (window as unknown as AntWindow).__ant.world;
    return { mode: w.mode, seed: w.seed, dailyId: w.dailyId, hearts: w.player.hearts, distance: w.distance, state: w.state };
  });
}

// --- Flows ------------------------------------------------------------------------

/** Loads the game and waits for the interactive title screen. */
export async function openTitle(page: Page): Promise<void> {
  await page.goto('./');
  await expect(playButton(page)).toBeVisible();
  await expect.poll(() => scene(page)).toBe('menu');
}

/** Waits for a scene, polling fast so timing assertions stay meaningful. */
export async function expectScene(page: Page, want: Scene, timeout = 5_000): Promise<void> {
  await expect.poll(() => scene(page), { timeout, intervals: [50] }).toBe(want);
}

/** Waits until the river has visibly moved past `from` world units. */
export async function expectRiverMoving(page: Page, from?: number): Promise<void> {
  const start = from ?? (await distance(page));
  await expect.poll(() => distance(page), { timeout: 6_000 }).toBeGreaterThan(start + 60);
}

/**
 * Milliseconds from the player's input (pointer/key) to the run scene, timed
 * inside the page so Playwright's own actionability waits don't count.
 */
export async function msToRun(page: Page, act: () => Promise<void>): Promise<number> {
  await page.evaluate(() => {
    const w = window as unknown as AntWindow & { __inputAt?: number };
    w.__inputAt = undefined;
    const mark = () => {
      w.__inputAt ??= performance.now();
    };
    for (const type of ['pointerdown', 'keydown', 'click']) addEventListener(type, mark, { capture: true, once: true });
  });
  const timing = page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const w = window as unknown as AntWindow & { __inputAt?: number };
        const tick = () => {
          if (w.__inputAt !== undefined && w.__ant.scene === 'run') resolve(performance.now() - w.__inputAt);
          else requestAnimationFrame(tick);
        };
        tick();
      }),
  );
  await act();
  return timing;
}

/**
 * Ends the current run through the real damage pipeline: down to one heart,
 * then a splash centred on the ant one step before impact. Re-armed until
 * the game-over screen shows, so it also works across a resume countdown.
 */
export async function forceDeath(page: Page): Promise<void> {
  await page.evaluate(() => {
    const p = (window as unknown as AntWindow).__ant.world.player;
    p.hearts = 1;
    p.invuln = 0;
  });
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const { world: w, scene: s } = (window as unknown as AntWindow).__ant;
          if (s === 'run' && w.state === 'running') {
            const fall = 0.5;
            const armed = w.drops.some((d) => d.r === 30 && d.fall === fall && d.fall - d.age < 0.05);
            if (!armed) {
              w.player.invuln = 0;
              w.drops.push({ id: w.nextId++, x: w.player.x, y: w.player.y, age: fall - 0.002, fall, r: 30, aimed: true });
            }
          }
          return s;
        }),
      { timeout: 10_000, intervals: [100] },
    )
    .toBe('over');
}
