// The core loop: start, pause/resume, die, retry instantly, Daily River.

import {
  type AntWindow,
  dailyButton,
  distance,
  expect,
  expectRiverMoving,
  expectScene,
  forceDeath,
  msToRun,
  openTitle,
  pauseButton,
  playButton,
  resumeButton,
  retryButton,
  runInfo,
  test,
} from './fixtures';

test('Play starts an endless run and the river flows', async ({ page }) => {
  await openTitle(page);
  await playButton(page).click();
  await expectScene(page, 'run');

  const run = await runInfo(page);
  expect(run.mode).toBe('endless');
  expect(run.state).toBe('running');
  expect(run.hearts).toBe(3);
  await expectRiverMoving(page, run.distance);
  await expect(pauseButton(page)).toBeVisible();
});

test('Escape and the HUD button pause; Resume continues the run', async ({ page }) => {
  await openTitle(page);
  await playButton(page).click();
  await expectScene(page, 'run');
  await expectRiverMoving(page);

  await page.keyboard.press('Escape');
  await expectScene(page, 'paused');
  await expect(resumeButton(page)).toBeVisible();

  // Nothing moves while paused.
  const frozen = await distance(page);
  await page.waitForTimeout(400);
  expect(await distance(page)).toBe(frozen);

  await resumeButton(page).click();
  await expectScene(page, 'run');
  // Resume plays a short countdown before the river moves again.
  await expectRiverMoving(page, frozen);

  await pauseButton(page).click();
  await expectScene(page, 'paused');
  // Escape toggles back.
  await page.keyboard.press('Escape');
  await expectScene(page, 'run');
});

test('dying shows the game over screen; Retry and R restart within 1 s', async ({ page }) => {
  await openTitle(page);
  await playButton(page).click();
  await expectScene(page, 'run');
  await expectRiverMoving(page);

  await forceDeath(page);
  await expect(retryButton(page)).toBeVisible();
  const dead = await runInfo(page);
  expect(dead.hearts).toBe(0);

  // Button.
  expect(await msToRun(page, () => retryButton(page).click())).toBeLessThan(1_000);
  let fresh = await runInfo(page);
  expect(fresh.hearts).toBe(3);
  expect(fresh.state).toBe('running');
  expect(fresh.distance).toBeLessThan(dead.distance);
  await expectRiverMoving(page, fresh.distance);

  // Hotkey.
  await forceDeath(page);
  await expect(retryButton(page)).toBeVisible();
  expect(await msToRun(page, () => page.keyboard.press('r'))).toBeLessThan(1_000);
  fresh = await runInfo(page);
  expect(fresh.hearts).toBe(3);
  expect(fresh.mode).toBe('endless');
});

test('Daily River replays the same seed; endless rivers differ', async ({ page }) => {
  await openTitle(page);
  await dailyButton(page).click();
  await expectScene(page, 'run');
  const first = await runInfo(page);
  expect(first.mode).toBe('daily');
  expect(first.dailyId).toMatch(/^\d{4}-\d{2}-\d{2}$/);

  // Same seed from the title again...
  await page.evaluate(() => (window as unknown as AntWindow).__ant.menu());
  await expect(dailyButton(page)).toBeVisible();
  await dailyButton(page).click();
  await expectScene(page, 'run');
  const second = await runInfo(page);
  expect(second.mode).toBe('daily');
  expect(second.seed).toBe(first.seed);
  expect(second.dailyId).toBe(first.dailyId);

  // ...and from an instant retry after dying.
  await forceDeath(page);
  await page.keyboard.press('r');
  await expectScene(page, 'run', 1_000);
  const retried = await runInfo(page);
  expect(retried.mode).toBe('daily');
  expect(retried.seed).toBe(first.seed);

  // Endless runs roll a fresh river each time.
  await page.evaluate(() => (window as unknown as AntWindow).__ant.menu());
  await playButton(page).click();
  await expectScene(page, 'run');
  const endlessA = await runInfo(page);
  await page.evaluate(() => (window as unknown as AntWindow).__ant.menu());
  await playButton(page).click();
  await expectScene(page, 'run');
  const endlessB = await runInfo(page);
  expect(endlessA.mode).toBe('endless');
  expect(endlessA.seed).not.toBe(endlessB.seed);
  expect(endlessA.seed).not.toBe(first.seed);
});

test('an instant retry during the death animation still saves the run', async ({ page }) => {
  await openTitle(page);
  await playButton(page).click();
  await expectScene(page, 'run');
  await expectRiverMoving(page);

  // Last heart, then a splash on the ant; press R the moment it dies, before game over shows.
  await page.evaluate(() => {
    const w = (window as unknown as AntWindow).__ant.world;
    w.player.hearts = 1;
    w.player.invuln = 0;
    w.drops.push({ id: w.nextId++, x: w.player.x, y: w.player.y, age: 0.498, fall: 0.5, r: 30, aimed: true });
  });
  await expect
    .poll(() => page.evaluate(() => (window as unknown as AntWindow).__ant.world.state), { intervals: [20] })
    .toBe('dying');
  await page.keyboard.press('r');
  await expectScene(page, 'run');
  expect((await runInfo(page)).state).toBe('running');

  const saved = await page.evaluate(() => (window as unknown as AntWindow).__ant.storage.getBoard('endless', null).length);
  expect(saved).toBe(1);
});

test('Esc on the game over screen goes back to the title', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Keyboard flow.');
  await openTitle(page);
  await page.keyboard.press('Enter');
  await expectScene(page, 'run');
  await forceDeath(page);
  await expect(retryButton(page)).toBeFocused();
  await page.keyboard.press('Escape');
  await expectScene(page, 'menu');
  await expect(playButton(page)).toBeVisible();
});

test('the Daily River launch link starts today\'s river', async ({ page }) => {
  await page.goto('./?mode=daily');
  await expectScene(page, 'run');
  const run = await runInfo(page);
  expect(run.mode).toBe('daily');
  expect(run.dailyId).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  // The query is dropped, so a reload lands on the title instead of another run.
  expect(new URL(page.url()).search).toBe('');
  await page.reload();
  await expect(playButton(page)).toBeVisible();
  await expectScene(page, 'menu');
});
