#!/usr/bin/env node
// Rasterises the vector art in scripts/icon-art.mjs into the PWA icons,
// favicons and the social card, using the Chromium that Playwright already
// ships for the e2e tests (no image tooling dependencies).
//
//   npm run icons            # writes public/icons/* and public/og-image.png
//   npm run icons -- --check # also renders a contact sheet into the OS temp dir
//
// Every PNG is palette-quantized when that stays visually lossless (PSNR
// above MIN_PSNR), otherwise it falls back to lossless truecolour.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { iconSvg, ogHtml } from './icon-art.mjs';
import { decodePng, encodeIndexed, encodeTruecolor } from './png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const FONT = path.join(ROOT, 'node_modules/@fontsource-variable/fredoka/files/fredoka-latin-wght-normal.woff2');
/** Below this, palette quantization visibly shifts small accents (eye whites, highlights). */
const MIN_PSNR = 42;

const ICONS = [
  { file: 'icons/icon-192.png', variant: 'any', size: 192 },
  { file: 'icons/icon-512.png', variant: 'any', size: 512 },
  { file: 'icons/maskable-192.png', variant: 'maskable', size: 192 },
  { file: 'icons/maskable-512.png', variant: 'maskable', size: 512 },
  { file: 'icons/apple-touch-icon.png', variant: 'apple', size: 180 },
  { file: 'icons/favicon-32.png', variant: 'favicon', size: 32 },
];

/** Picks the smallest encoding that is either lossless or above MIN_PSNR. */
function optimise(img) {
  const candidates = [{ png: encodeTruecolor(img), psnr: Infinity, how: 'truecolour' }];
  for (const dither of [0, 0.6]) {
    const q = encodeIndexed(img, { colors: 256, dither });
    if (q.psnr >= MIN_PSNR) candidates.push({ ...q, how: `${q.colors} colours${dither ? ', dithered' : ''}` });
  }
  return candidates.reduce((a, b) => (b.png.length < a.png.length ? b : a));
}

/** Minifies the generated SVG for shipping as favicon.svg. */
function minifySvg(svg) {
  return svg
    .replace(/>\s+</g, '><')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s*\n\s*/g, '')
    .trim();
}

async function render(page, html, width, height, transparent) {
  await page.setViewportSize({ width, height });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.fit?.();
  });
  const buf = await page.screenshot({ omitBackground: transparent, clip: { x: 0, y: 0, width, height } });
  return decodePng(buf);
}

function svgPage(svg, size) {
  const sized = svg.replace('width="512" height="512"', `width="${size}" height="${size}"`);
  return `<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block}</style></head><body>${sized}</body></html>`;
}

async function main() {
  const check = process.argv.includes('--check');
  await mkdir(path.join(PUBLIC, 'icons'), { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const report = [];

  for (const icon of ICONS) {
    const img = await render(page, svgPage(iconSvg(icon.variant), icon.size), icon.size, icon.size, true);
    const best = optimise(img);
    await writeFile(path.join(PUBLIC, icon.file), best.png);
    report.push([icon.file, best.png.length, best.how]);
  }

  const favicon = minifySvg(iconSvg('favicon'));
  await writeFile(path.join(PUBLIC, 'icons/favicon.svg'), favicon);
  report.push(['icons/favicon.svg', Buffer.byteLength(favicon), 'svg']);

  // Inline the font: the card renders from about:blank, which may not read file:// URLs.
  const font = `data:font/woff2;base64,${(await readFile(FONT)).toString('base64')}`;
  const og = await render(page, ogHtml(font), 1200, 630, false);
  const ogBest = optimise(og);
  await writeFile(path.join(PUBLIC, 'og-image.png'), ogBest.png);
  report.push(['og-image.png', ogBest.png.length, ogBest.how]);

  if (check) {
    // Contact sheet: every icon at real size on light and dark tiles, plus a 32 px zoom.
    const tiles = ICONS.map(
      (i) => `<figure><img src="${pathToFileURL(path.join(PUBLIC, i.file)).href}" width="${Math.min(i.size, 192)}"><figcaption>${i.file}</figcaption></figure>`,
    ).join('');
    const sheet = `<!doctype html><html><body style="margin:0;padding:16px;font:12px sans-serif;background:#eee">
      <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end">${tiles}
      <figure><img src="${pathToFileURL(path.join(PUBLIC, 'icons/favicon-32.png')).href}" width="128" style="image-rendering:pixelated"><figcaption>favicon x4</figcaption></figure>
      <figure style="background:#202124;padding:8px"><img src="${pathToFileURL(path.join(PUBLIC, 'icons/favicon.svg')).href}" width="16"> <img src="${pathToFileURL(path.join(PUBLIC, 'icons/favicon.svg')).href}" width="32"><figcaption style="color:#fff">svg 16/32</figcaption></figure>
      <figure><img src="${pathToFileURL(path.join(PUBLIC, 'icons/maskable-512.png')).href}" width="192" style="border-radius:50%"><figcaption>maskable, circle</figcaption></figure>
      </div><img src="${pathToFileURL(path.join(PUBLIC, 'og-image.png')).href}" width="600"></body></html>`;
    // A file (not data:) page, so it may load the file:// images.
    const sheetFile = path.join(tmpdir(), 'antventure-icon-preview.html');
    const sheetPng = path.join(tmpdir(), 'antventure-icon-preview.png');
    await writeFile(sheetFile, sheet);
    const sheetPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await sheetPage.goto(pathToFileURL(sheetFile).href);
    await sheetPage.screenshot({ path: sheetPng, fullPage: true });
    console.log(`Contact sheet: ${sheetPng}`);
  }

  await browser.close();
  const pad = Math.max(...report.map((r) => r[0].length));
  let total = 0;
  for (const [file, bytes, how] of report) {
    total += bytes;
    console.log(`${file.padEnd(pad)}  ${(bytes / 1024).toFixed(1).padStart(6)} KB  ${how}`);
  }
  console.log(`${'total'.padEnd(pad)}  ${(total / 1024).toFixed(1).padStart(6)} KB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
