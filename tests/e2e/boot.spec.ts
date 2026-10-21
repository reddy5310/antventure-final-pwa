// Loading, installability and offline: the PWA shell around the game.

import { dailyButton, expect, expectRiverMoving, expectScene, openTitle, playButton, scene, test } from './fixtures';

test('boots to the title screen with no errors', async ({ page }) => {
  await openTitle(page);
  await expect(page).toHaveTitle(/Antventure/);
  await expect(dailyButton(page)).toBeVisible();
  await expect(dailyButton(page)).toContainText(/Daily River #\d+/);

  // The canvas fills the viewport (no white margins, no scroll).
  const viewport = page.viewportSize();
  const box = await page.locator('#game').boundingBox();
  expect(box).not.toBeNull();
  expect(Math.round(box?.width ?? 0)).toBe(viewport?.width);
  expect(Math.round(box?.height ?? 0)).toBe(viewport?.height);
  const scroll = await page.evaluate(() => ({
    x: document.documentElement.scrollWidth - innerWidth,
    y: document.documentElement.scrollHeight - innerHeight,
  }));
  expect(scroll).toEqual({ x: 0, y: 0 });

  // Give late failures (fonts, worker registration) a moment to surface.
  await page.waitForTimeout(500);
  expect(await scene(page)).toBe('menu');
});

test('manifest, icons and social card are served', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Static asset checks only need one project.');
  await openTitle(page);

  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  const manifestUrl = new URL(href ?? '', page.url()).href;
  const res = await request.get(manifestUrl);
  expect(res.ok()).toBe(true);
  const manifest = (await res.json()) as {
    name: string;
    short_name: string;
    display: string;
    theme_color: string;
    categories: string[];
    icons: { src: string; sizes: string; type: string; purpose?: string }[];
    shortcuts?: { name: string; url: string }[];
  };
  expect(manifest.name).toBe('Antventure: Leaf of Fate');
  expect(manifest.short_name).toBe('Antventure');
  expect(manifest.display).toBe('standalone');
  expect(manifest.theme_color).toBe('#0b1d26');
  expect(manifest.categories).toContain('games');
  const has = (size: string, purpose: string) => manifest.icons.some((i) => i.sizes === size && (i.purpose ?? 'any') === purpose);
  expect(has('192x192', 'any')).toBe(true);
  expect(has('512x512', 'any')).toBe(true);
  expect(has('512x512', 'maskable')).toBe(true);
  // Long-press shortcut straight into the Daily River.
  expect(manifest.shortcuts?.find((s) => s.name === 'Daily River')?.url).toContain('mode=daily');

  // Every manifest icon is a real PNG of the declared size.
  for (const icon of manifest.icons) {
    const r = await request.get(new URL(icon.src, manifestUrl).href);
    expect(r.ok(), icon.src).toBe(true);
    const bytes = new Uint8Array(await r.body());
    const u32 = (o: number) => ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
    expect(Array.from(bytes.slice(1, 4)), icon.src).toEqual([0x50, 0x4e, 0x47]);
    expect(`${u32(16)}x${u32(20)}`, icon.src).toBe(icon.sizes);
  }

  // Head links and the share card resolve.
  for (const selector of ['link[rel="icon"][type="image/svg+xml"]', 'link[rel="icon"][sizes="32x32"]', 'link[rel="apple-touch-icon"]']) {
    const link = await page.locator(selector).getAttribute('href');
    expect(link, selector).toBeTruthy();
    expect((await request.get(new URL(link ?? '', page.url()).href)).ok(), selector).toBe(true);
  }
  const og = await page.locator('meta[property="og:image"]').getAttribute('content');
  expect((await request.get(new URL(og ?? '', page.url()).href)).ok()).toBe(true);
});

test('boots and plays offline after the first visit', async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One project is enough for the service worker check.');
  await openTitle(page);

  // The worker activates only once precaching (shell, audio, fonts, icons) is
  // done; `ready` can resolve while it is still 'activating'.
  const state = await page.evaluate(async () => {
    const sw = (await navigator.serviceWorker.ready).active;
    if (sw && sw.state !== 'activated') {
      await new Promise<void>((resolve) => sw.addEventListener('statechange', () => sw.state === 'activated' && resolve()));
    }
    return sw?.state;
  });
  expect(state).toBe('activated');

  await context.setOffline(true);
  await page.reload();
  await expect(playButton(page)).toBeVisible();
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  // A full run start works from the cache too (audio is fetched on Play).
  await playButton(page).click();
  await expectScene(page, 'run');
  await expectRiverMoving(page);
  await context.setOffline(false);
});
