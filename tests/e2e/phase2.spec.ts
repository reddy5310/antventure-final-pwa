// Phase 2 end to end: river zones, crumbs, power-ups and what the screen says
// about them. Like the other specs these drive the game through window.__ant
// and read what a player reads (names, roles, text). The world is nudged only
// where waiting for it would take minutes: jumping the river distance to a
// zone (zones are a pure function of seed and distance) and placing a pickup
// on the leaf.

import type { Page } from '@playwright/test';
import { UNITS_PER_METER } from '../../src/config';
import type { Viewport } from '../../src/engine/viewport';
import { createZoneSample, FIRST_ZONE_M, ZONES, zoneAt } from '../../src/game/zones';
import type { Drop, World, ZoneId } from '../../src/types';
import { type AntWindow, expect, expectScene, forceDeath, openTitle, pauseButton, playButton, resumeButton, test } from './fixtures';

/** A fresh endless run with the first-run tutorial out of the way. */
async function startRun(page: Page): Promise<number> {
  await openTitle(page);
  await page.evaluate(() => (window as unknown as AntWindow).__ant.storage.setFlag('tutorialSeen'));
  await playButton(page).click();
  await expectScene(page, 'run');
  return page.evaluate(() => (window as unknown as AntWindow).__ant.world.seed);
}

/** Clears the hazards and makes the leaf safe from the rain that is already on its way. */
async function calmWater(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = (window as unknown as AntWindow).__ant.world;
    w.drops.length = 0;
    w.obstacles.length = 0;
  });
}

/** Puts a pickup of `kind` on the leaf; the next sim step takes it. */
async function dropOnLeaf(page: Page, kind: 'crumb' | 'mushroom' | 'honey' | 'ladybug' | 'firefly'): Promise<void> {
  await page.evaluate((k) => {
    const w = (window as unknown as AntWindow).__ant.world;
    const p = w.player;
    w.pickups.push({ id: w.nextId++, kind: k, x: p.x, y: p.y - 4, trail: 0, taken: false, variant: 0 });
  }, kind);
}

/** A raindrop that lands on the leaf on the next step. */
async function splashLeaf(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = (window as unknown as AntWindow).__ant.world;
    const fall = 0.5;
    w.drops.push({ id: w.nextId++, x: w.player.x, y: w.player.y, age: fall - 0.002, fall, r: 30, aimed: true });
  });
}

/**
 * Where on this river a stretch of `zone` lies (units): the middle of its first
 * segment, clear of the 12 m blend at the start.
 */
function middleOf(seed: number, zone: ZoneId): number {
  const out = createZoneSample();
  let start = -1;
  for (let m = 0; m < 6000; m += 5) {
    const d = m * UNITS_PER_METER;
    zoneAt(seed, d, out);
    const inside = out.zone === zone && out.next === zone;
    if (inside && start < 0) start = m;
    if (!inside && start >= 0) return ((start + m) / 2) * UNITS_PER_METER;
  }
  throw new Error(`no ${zone} within 6 km of seed ${seed}`);
}

const hudCrumbs = (page: Page) => page.getByTitle('Crumbs collected this run');

test.describe('river zones', () => {
  test('crossing into the next zone shows its banner and counts it', async ({ page }) => {
    const seed = await startRun(page);
    // Just past the boundary the sample is still blending: `next` is the zone being entered.
    const next = zoneAt(seed, FIRST_ZONE_M * UNITS_PER_METER + 1, createZoneSample()).next;
    expect(next).not.toBe('jungle');
    expect(await page.evaluate(() => (window as unknown as AntWindow).__ant.world.zone)).toBe('jungle');

    // 2 m short of the first boundary: the leaf drifts across it by itself.
    await page.evaluate((d) => {
      const w = (window as unknown as AntWindow).__ant.world;
      w.distance = d;
      w.player.invuln = 60;
    }, FIRST_ZONE_M * UNITS_PER_METER - 2 * UNITS_PER_METER);

    await expect(page.getByText(`Entering ${ZONES[next].name}`)).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as unknown as AntWindow).__ant.world.zonesReached)).toBe(2);
    // The banner is for the zone being entered; the leaf is in it once the blend is over.
    await expect
      .poll(() => page.evaluate(() => (window as unknown as AntWindow).__ant.world.zone), { timeout: 10_000 })
      .toBe(next);
  });

  test('every zone runs without errors, keeps its rules and the river moves on', async ({ page }) => {
    const seed = await startRun(page);
    // In river order, so every jump is downstream and enters the zone (an upstream jump is not an "entry").
    const zones = (['jungle', 'marsh', 'rapids', 'night'] as const)
      .map((zone) => ({ zone, d: middleOf(seed, zone) }))
      .sort((a, b) => a.d - b.d);
    for (const { zone, d } of zones) {
      await page.evaluate((to) => {
        const w = (window as unknown as AntWindow).__ant.world;
        // What the last stretch left on the water is not this zone's course: start from clear water.
        w.obstacles.length = 0;
        w.pickups.length = 0;
        w.distance = to;
        w.player.invuln = 60;
        w.player.hearts = 3;
      }, d);
      await expect.poll(() => page.evaluate(() => (window as unknown as AntWindow).__ant.world.zone), { timeout: 5_000 }).toBe(zone);
      if (zone !== 'jungle') await expect(page.getByText(`Entering ${ZONES[zone].name}`)).toBeVisible();

      // Let the zone's own course lay out and scroll, then look at the world.
      const start = await page.evaluate(() => (window as unknown as AntWindow).__ant.world.distance);
      await expect.poll(() => page.evaluate(() => (window as unknown as AntWindow).__ant.world.distance), { timeout: 8_000 }).toBeGreaterThan(start + 150);
      const state = await page.evaluate(() => {
        const w = (window as unknown as AntWindow).__ant.world;
        return {
          zone: w.zone,
          darkness: w.darkness,
          total: w.obstacles.length,
          rocks: w.obstacles.filter((o) => o.kind === 'rock').length,
          pads: w.obstacles.filter((o) => o.kind === 'pad').length,
          scroll: w.scrollSpeed,
        };
      });
      expect(state.zone).toBe(zone);
      // Night is dark; everywhere else is day.
      if (zone === 'night') expect(state.darkness).toBeGreaterThan(0.95);
      else expect(state.darkness).toBe(0);
      // Lily pads replace rocks in the Marsh, and only there.
      expect(state.total).toBeGreaterThan(0);
      if (zone === 'marsh') {
        expect(state.rocks).toBe(0);
        expect(state.pads).toBeGreaterThan(0);
      } else {
        expect(state.pads).toBe(0);
      }
    }
    expect(await page.evaluate(() => (window as unknown as AntWindow).__ant.world.state)).toBe('running');
  });

  test('the Rapids show their ×1.4 score bonus on the HUD, and no other zone does', async ({ page }) => {
    const seed = await startRun(page);
    const chip = page.locator('.hud-pay');
    await expect(chip).toBeHidden();

    const jumpTo = (d: number) =>
      page.evaluate((to) => {
        const w = (window as unknown as AntWindow).__ant.world;
        w.obstacles.length = 0;
        w.pickups.length = 0;
        w.distance = to;
        w.player.invuln = 60;
        w.player.hearts = 3;
      }, d);
    const rapids = middleOf(seed, 'rapids');
    await jumpTo(rapids);
    await expect.poll(() => page.evaluate(() => (window as unknown as AntWindow).__ant.world.zone)).toBe('rapids');
    await expect(chip).toBeVisible();
    await expect(chip).toHaveText('×1.4');

    // The next zone downstream that is not the Rapids: the chip goes away (downstream only, as the sim never goes back).
    const out = createZoneSample();
    let after = -1;
    for (let m = Math.ceil(rapids / UNITS_PER_METER) + 30; m < Math.ceil(rapids / UNITS_PER_METER) + 3000 && after < 0; m += 5) {
      zoneAt(seed, m * UNITS_PER_METER, out);
      if (out.zone === out.next && out.zone !== 'rapids') after = m * UNITS_PER_METER;
    }
    expect(after).toBeGreaterThan(0);
    await jumpTo(after);
    await expect(chip).toBeHidden();
  });

  test('the Night River keeps rain telegraphs on the canvas, brighter than the dark around them', async ({ page }) => {
    const seed = await startRun(page);
    await calmWater(page);
    await page.evaluate((d) => {
      const w = (window as unknown as AntWindow).__ant.world;
      w.distance = d;
      w.player.invuln = 60;
    }, middleOf(seed, 'night'));
    await expect.poll(() => page.evaluate(() => (window as unknown as AntWindow).__ant.world.darkness)).toBeGreaterThan(0.95);
    await calmWater(page);

    // A telegraph far above the leaf, outside its light pool: it must still be readable.
    const lit = await page.evaluate(
      () =>
        new Promise<{ ring: number; around: number }>((resolve) => {
          const a = (window as unknown as AntWindow).__ant as unknown as { world: World; viewport: Viewport };
          const w = a.world;
          const v = a.viewport;
          const canvas = document.getElementById('game') as HTMLCanvasElement;
          const probe = document.createElement('canvas');
          const g = probe.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
          /** Brightness (r + g + b) of the canvas around a world point: peak and mean. */
          const look = (x: number, y: number, half: number) => {
            const s = v.scale * v.dpr;
            const size = Math.max(2, Math.round(2 * half * s));
            probe.width = probe.height = size;
            g.drawImage(canvas, (v.originX + x * v.scale) * v.dpr - size / 2, y * s - size / 2, size, size, 0, 0, size, size);
            const px = g.getImageData(0, 0, size, size).data;
            let peak = 0;
            let sum = 0;
            for (let i = 0; i < px.length; i += 4) {
              const b = px[i] + px[i + 1] + px[i + 2];
              peak = Math.max(peak, b);
              sum += b;
            }
            return { peak, mean: sum / (px.length / 4) };
          };
          const fall = 2;
          const r = 26;
          const drop: Drop = { id: w.nextId++, x: w.player.x < 200 ? 320 : 80, y: 0, age: 0, fall, r, aimed: false };
          drop.y = w.player.y - 330 - w.scrollSpeed * fall;
          w.drops.push(drop);
          window.setTimeout(() => {
            const at = w.drops.find((d) => d.id === drop.id);
            if (!at) throw new Error('the test drop vanished');
            const ring = look(at.x, at.y, r + 16).peak;
            const around = look(at.x < 200 ? at.x + 110 : at.x - 110, at.y - 60, r + 16).mean;
            resolve({ ring, around });
          }, 700);
        }),
    );
    // Far brighter than the dark water next to it (about 560 against about 30 on the sum of r, g and b;
    // the exact colours are the renderer's business, but a faint ring would be a fairness bug).
    expect(lit.ring).toBeGreaterThan(lit.around + 250);
  });
});

test.describe('crumbs', () => {
  test('taking a crumb counts on the HUD and pays points', async ({ page }) => {
    await startRun(page);
    await calmWater(page);
    const before = await page.evaluate(() => ({ crumbs: (window as unknown as AntWindow).__ant.world.crumbs, score: (window as unknown as AntWindow).__ant.world.score }));
    await expect(hudCrumbs(page)).toHaveText(String(before.crumbs));

    await dropOnLeaf(page, 'crumb');
    await expect(hudCrumbs(page)).toHaveText(String(before.crumbs + 1));
    const after = await page.evaluate(() => ({ crumbs: (window as unknown as AntWindow).__ant.world.crumbs, score: (window as unknown as AntWindow).__ant.world.score }));
    expect(after.crumbs).toBe(before.crumbs + 1);
    // 10 x the multiplier per crumb (plus a sliver of distance).
    expect(after.score - before.score).toBeGreaterThanOrEqual(10);
  });

  test('following the opening trail takes every crumb and pays the Perfect trail bonus', async ({ page }) => {
    await startRun(page);
    // The first trail is 18 to 26 m down the river: jump to just before it.
    await page.evaluate(() => {
      const w = (window as unknown as AntWindow).__ant.world;
      w.distance = 16 * 50;
      w.player.invuln = 60;
    });
    await expect
      .poll(() => page.evaluate(() => (window as unknown as AntWindow).__ant.world.pickups.filter((k) => k.kind === 'crumb' && k.trail === 1).length), {
        timeout: 8_000,
      })
      .toBeGreaterThanOrEqual(5);
    await calmWater(page);
    const total = await page.evaluate(() => (window as unknown as AntWindow).__ant.world.pickups.filter((k) => k.kind === 'crumb' && k.trail === 1).length);
    const before = await page.evaluate(() => (window as unknown as AntWindow).__ant.world.score);

    // Steer onto the nearest crumb that has not yet passed, every frame, like a player who keeps their eyes on the trail.
    await page.evaluate(() => {
      const step = () => {
        const w = (window as unknown as AntWindow).__ant.world;
        const p = w.player;
        p.invuln = 60;
        let best: (typeof w.pickups)[number] | null = null;
        for (const k of w.pickups) {
          if (k.kind === 'crumb' && k.trail === 1 && !k.taken && k.y <= p.y + 20 && (!best || k.y > best.y)) best = k;
        }
        if (best) {
          p.x = best.x;
          p.targetX = best.x;
        }
        (window as unknown as { __follow: number }).__follow = requestAnimationFrame(step);
      };
      step();
    });

    await expect(page.getByText('Perfect trail!')).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => cancelAnimationFrame((window as unknown as { __follow: number }).__follow));
    const after = await page.evaluate(() => ({ crumbs: (window as unknown as AntWindow).__ant.world.crumbs, score: (window as unknown as AntWindow).__ant.world.score }));
    expect(after.crumbs).toBe(total);
    // Crumbs at 10 each and the +50 trail bonus, all times a multiplier of at least x1.
    expect(after.score - before).toBeGreaterThanOrEqual(10 * total + 50);
    await expect(hudCrumbs(page)).toHaveText(String(total));
  });
});

test.describe('power-ups', () => {
  test('a mushroom cap blocks one hit: hearts stay, the combo survives, the cap is spent', async ({ page }) => {
    await startRun(page);
    await calmWater(page);
    await page.evaluate(() => {
      const w = (window as unknown as AntWindow).__ant.world;
      w.combo = 3;
      w.comboTimer = 3;
      w.multiplier = 1.5;
    });

    await dropOnLeaf(page, 'mushroom');
    const cap = page.getByRole('img', { name: /^Mushroom cap, \d+ s left$/ });
    await expect(cap).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as AntWindow).__ant.world.powers.map((p) => p.kind))).toEqual(['mushroom']);

    await splashLeaf(page);
    await expect(page.getByText('Blocked!')).toBeVisible();
    await expect(cap).toBeHidden();
    const after = await page.evaluate(() => {
      const w = (window as unknown as AntWindow).__ant.world;
      return { hearts: w.player.hearts, hits: w.hitsTaken, powers: w.powers.length, combo: w.combo };
    });
    expect(after.hearts).toBe(3);
    expect(after.hits).toBe(0);
    expect(after.powers).toBe(0);
    expect(after.combo).toBeGreaterThan(0);

    // Spent: after the short grace, the same splash costs a heart.
    await page.waitForTimeout(700);
    await calmWater(page);
    await splashLeaf(page);
    await expect.poll(() => page.evaluate(() => (window as unknown as AntWindow).__ant.world.player.hearts)).toBe(2);
  });

  test('a ladybug restores a heart; at full hearts it pays points instead', async ({ page }) => {
    await startRun(page);
    await calmWater(page);
    await page.evaluate(() => {
      (window as unknown as AntWindow).__ant.world.player.hearts = 2;
    });
    await expect(page.getByRole('img', { name: '2 of 3 hearts' })).toBeVisible();
    await dropOnLeaf(page, 'ladybug');
    await expect(page.getByRole('img', { name: '3 of 3 hearts' })).toBeVisible();

    const before = await page.evaluate(() => (window as unknown as AntWindow).__ant.world.score);
    await dropOnLeaf(page, 'ladybug');
    await expect.poll(() => page.evaluate((s) => (window as unknown as AntWindow).__ant.world.score - s, before)).toBeGreaterThanOrEqual(100);
    expect(await page.evaluate(() => (window as unknown as AntWindow).__ant.world.player.hearts)).toBe(3);
  });

  test('timers run in game time: pausing freezes them', async ({ page }) => {
    await startRun(page);
    await calmWater(page);
    await dropOnLeaf(page, 'honey');
    const power = page.getByRole('img', { name: /^Honey, \d+ s left$/ });
    await expect(power).toBeVisible();

    await pauseButton(page).click();
    await expectScene(page, 'paused');
    const frozen = await page.evaluate(() => (window as unknown as AntWindow).__ant.world.powers[0].left);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as unknown as AntWindow).__ant.world.powers[0].left)).toBe(frozen);

    await resumeButton(page).click();
    await expectScene(page, 'run');
    await expect.poll(() => page.evaluate(() => (window as unknown as AntWindow).__ant.world.powers[0]?.left ?? 0), { timeout: 5_000 }).toBeLessThan(frozen);
  });

  test('the first power-up ever seen gets a one-line hint, and only once', async ({ page }) => {
    await startRun(page);
    await calmWater(page);
    // Honey drifting down mid-screen, off to one side so the leaf does not take it.
    const putHoney = () =>
      page.evaluate(() => {
        const w = (window as unknown as AntWindow).__ant.world;
        const x = w.player.x < 200 ? 330 : 70;
        w.pickups.push({ id: w.nextId++, kind: 'honey', x, y: 200, trail: 0, taken: false, variant: 0 });
      });
    const hint = page.locator('.pk-hint');
    await putHoney();
    await expect(hint).toBeVisible();
    await expect(hint).toContainText('Honey');
    expect(await page.evaluate(() => (window as unknown as AntWindow).__ant.storage.getFlag('seen:honey'))).toBe(true);

    // It goes away by itself, and a second honey is no news.
    await expect(hint).toBeHidden({ timeout: 6_000 });
    await calmWater(page);
    await putHoney();
    await page.waitForTimeout(500);
    await expect(hint).toBeHidden();
  });

  test('the first lily pad ever seen says it is soft, and only once', async ({ page }) => {
    // Pads look like solid obstacles, and nothing else says they are harmless.
    const seed = await startRun(page);
    const hint = page.locator('.pk-hint');
    await page.evaluate((d) => {
      const w = (window as unknown as AntWindow).__ant.world;
      w.obstacles.length = 0;
      w.pickups.length = 0;
      w.distance = d;
      w.player.invuln = 60;
    }, middleOf(seed, 'marsh'));
    // The pads of the Marsh scroll into view from above.
    await expect(hint).toContainText('Lily pads', { timeout: 15_000 });
    expect(await page.evaluate(() => (window as unknown as AntWindow).__ant.storage.getFlag('seen:pad'))).toBe(true);
    await expect(hint).toBeHidden({ timeout: 8_000 });
    // More pads keep coming and the hint does not.
    await page.waitForTimeout(2_500);
    await expect(hint).toBeHidden();
  });
});

test.describe('the end of a run', () => {
  test('game over shows the crumbs collected and the zones reached', async ({ page }) => {
    await startRun(page);
    await calmWater(page);
    for (let i = 0; i < 3; i++) {
      await dropOnLeaf(page, 'crumb');
      await expect(hudCrumbs(page)).toHaveText(String(i + 1));
    }
    await forceDeath(page);

    const over = page.locator('.over-extras');
    await expect(over).toContainText('3 crumbs');
    await expect(over).toContainText('1 zone');
    // The run is saved with them, and the lifetime total grows.
    expect(await page.evaluate(() => (window as unknown as AntWindow).__ant.storage.getStats().totalCrumbs)).toBeGreaterThanOrEqual(3);
  });

  test('a run that reached the Marsh or beyond says so', async ({ page }) => {
    const seed = await startRun(page);
    await calmWater(page);
    await page.evaluate((d) => {
      const w = (window as unknown as AntWindow).__ant.world;
      w.distance = d;
      w.player.invuln = 60;
    }, middleOf(seed, 'marsh'));
    await expect.poll(() => page.evaluate(() => (window as unknown as AntWindow).__ant.world.zonesReached)).toBeGreaterThanOrEqual(2);
    await forceDeath(page);
    await expect(page.locator('.over-extras')).toContainText(/[2-9] zones/);
  });
});

test('the help modal explains the zones and the pickups', async ({ page }) => {
  await openTitle(page);
  await page.getByRole('button', { name: 'How to play' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  for (const text of ['River zones', 'Power-up bubbles', 'Lily Marsh', 'Rapids', 'Night River', 'Mushroom cap', 'Honey', 'Ladybug', 'Firefly']) {
    await expect(dialog.getByText(text, { exact: false }).first()).toBeAttached();
  }
});
