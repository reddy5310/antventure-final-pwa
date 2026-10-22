// The competitive layer: what "best" means in a run, restarts that cannot
// throw a long run away by accident, and Daily shares that lead straight to
// the same river.

import { type AntWindow, expect, expectScene, forceDeath, openTitle, playButton, test } from './fixtures';

test('NEW BEST is about score: passing the farthest flag alone is not a best', async ({ page }) => {
  await openTitle(page);
  // A board whose best score (12) is far below its farthest run (300 m).
  await page.evaluate(() => {
    const s = (window as unknown as AntWindow).__ant.storage;
    s.resetAll();
    s.setFlag('tutorialSeen');
    const base = { mode: 'endless' as const, dailyId: null, seed: 1, timeS: 20, nearMisses: 0, maxCombo: 0, hitsTaken: 3, killedBy: 'drop' as const };
    s.recordRun({ ...base, score: 12, distanceM: 10 });
    s.recordRun({ ...base, score: 8, distanceM: 300 });
  });
  await playButton(page).click();
  await expectScene(page, 'run');

  const start = await page.evaluate(() => {
    const w = (window as unknown as AntWindow).__ant.world;
    return { bestScore: w.bestScore, bestDistance: w.bestDistance };
  });
  expect(start).toEqual({ bestScore: 12, bestDistance: 300 * 50 });
  await expect(page.locator('.hud-best')).toContainText('to beat');

  // Score passes 12 long before the leaf reaches 300 m.
  await expect.poll(() => page.evaluate(() => (window as unknown as AntWindow).__ant.world.beatBest), { timeout: 15_000 }).toBe(true);
  const at = await page.evaluate(() => {
    const w = (window as unknown as AntWindow).__ant.world;
    return { score: Math.floor(w.score), passedFlag: w.passedBest };
  });
  expect(at.score).toBeGreaterThan(12);
  expect(at.passedFlag).toBe(false);
  await expect(page.locator('.hud-best')).toHaveText('NEW BEST');
});

test('restarting a run that has real progress asks for a second press', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Keyboard flow.');
  await openTitle(page);
  await page.evaluate(() => (window as unknown as AntWindow).__ant.storage.setFlag('tutorialSeen'));
  await page.keyboard.press('Enter');
  await expectScene(page, 'run');
  // Pretend the run has been going for a while (the confirm threshold is run time).
  await page.evaluate(() => {
    (window as unknown as AntWindow).__ant.world.time = 40;
  });

  await page.keyboard.press('r');
  await expectScene(page, 'paused');
  await expect(page.locator('.btn-restart')).toHaveClass(/is-armed/);
  expect(await page.evaluate(() => (window as unknown as AntWindow).__ant.world.time)).toBeGreaterThanOrEqual(40);

  await page.keyboard.press('r');
  await expectScene(page, 'run');
  expect(await page.evaluate(() => (window as unknown as AntWindow).__ant.world.time)).toBeLessThan(5);

  // Early in a run R is still instant: a fresh river, no pause in between.
  const seed = await page.evaluate(() => (window as unknown as AntWindow).__ant.world.seed);
  await page.keyboard.press('r');
  await expect.poll(() => page.evaluate(() => (window as unknown as AntWindow).__ant.world.seed)).not.toBe(seed);
  expect(await page.evaluate(() => (window as unknown as AntWindow).__ant.scene)).toBe('run');
});

test('a Daily River share links to the same river', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __shared?: ShareData[] };
    w.__shared = [];
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: ShareData) => {
        w.__shared?.push(data);
      },
    });
  });
  await page.goto('./?mode=daily');
  await expectScene(page, 'run');
  await forceDeath(page);
  await page.getByRole('button', { name: /share/i }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __shared: ShareData[] }).__shared.length)).toBe(1);
  const shared = await page.evaluate(() => (window as unknown as { __shared: ShareData[] }).__shared[0]);
  expect(new URL(shared.url ?? '').searchParams.get('mode')).toBe('daily');
  expect(shared.text).toMatch(/Daily River #\d+/);
  expect(shared.text).toMatch(/\d+ pts/);
});
