// Every input device steers the leaf (gamepads cannot be emulated here; the
// unit tests cover their mapping).

import { type AntWindow, expect, expectScene, openTitle, playButton, playerX, scene, test } from './fixtures';

test('touch: a relative drag anywhere steers the leaf', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'Touch only.');
  await openTitle(page);
  await playButton(page).tap();
  await expectScene(page, 'run');
  const x0 = await playerX(page);

  // Raw touch events (Playwright's touchscreen API can only tap). The drag
  // starts low on the screen, well away from the ant: control is relative.
  const cdp = await page.context().newCDPSession(page);
  const vp = page.viewportSize() ?? { width: 390, height: 844 };
  const y = Math.round(vp.height * 0.82);
  let x = Math.round(vp.width * 0.3);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 0; i < 10; i++) {
    x += 12;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

  await expect.poll(() => playerX(page), { timeout: 3_000 }).toBeGreaterThan(x0 + 30);
  expect(await scene(page)).toBe('run');
});

test('keyboard: Enter starts, arrows steer, P pauses, M mutes', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Keyboard play is a desktop flow.');
  await openTitle(page);
  await page.keyboard.press('Enter');
  await expectScene(page, 'run');

  const x0 = await playerX(page);
  await page.keyboard.down('ArrowLeft');
  await expect.poll(() => playerX(page), { timeout: 3_000 }).toBeLessThan(x0 - 30);
  await page.keyboard.up('ArrowLeft');

  const x1 = await playerX(page);
  await page.keyboard.down('KeyD');
  await expect.poll(() => playerX(page), { timeout: 3_000 }).toBeGreaterThan(x1 + 30);
  await page.keyboard.up('KeyD');

  await page.keyboard.press('p');
  await expectScene(page, 'paused');
  await page.keyboard.press('p');
  await expectScene(page, 'run');

  const muted = () => page.evaluate(() => (window as unknown as AntWindow).__ant.settings.muted);
  const before = await muted();
  await page.keyboard.press('m');
  await expect.poll(muted).toBe(!before);
  await page.keyboard.press('m');
  await expect.poll(muted).toBe(before);
});

test('mouse: the leaf follows the cursor', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Mouse only.');
  await openTitle(page);
  await playButton(page).click();
  await expectScene(page, 'run');

  const vp = page.viewportSize() ?? { width: 1280, height: 800 };
  const x0 = await playerX(page);
  // Sweep to the left of centre: absolute steering, so the leaf should end up left of where it started.
  for (let i = 1; i <= 8; i++) await page.mouse.move(vp.width / 2 - i * 15, vp.height * 0.6);
  await expect.poll(() => playerX(page), { timeout: 3_000 }).toBeLessThan(x0 - 30);
  for (let i = 1; i <= 16; i++) await page.mouse.move(vp.width / 2 - 120 + i * 15, vp.height * 0.6);
  await expect.poll(() => playerX(page), { timeout: 3_000 }).toBeGreaterThan(x0 + 30);
});
