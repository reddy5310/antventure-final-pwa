/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const THEME = '#0b1d26';

/**
 * Open Graph / Twitter crawlers need absolute image URLs, but the build uses a
 * relative base so it works on any host. When SITE_URL is set (the Pages
 * workflow passes the deployed URL) the social tags are made absolute and
 * og:url is added; local builds keep the relative paths.
 */
function socialUrls(siteUrl: string | undefined): Plugin {
  const site = siteUrl ? siteUrl.replace(/\/*$/, '/') : null;
  return {
    name: 'antventure:social-urls',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        if (!site) return html;
        return html
          .replace(/(<meta (?:property|name)="(?:og|twitter):image" content=")(?:\.?\/)?([^"]+)"/g, `$1${site}$2"`)
          .replace('<meta property="og:type"', `<meta property="og:url" content="${site}" />\n    <meta property="og:type"`);
      },
    },
  };
}

// No @types/node in this project: read the environment without the global type.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

// Relative base so the same build works at the GitHub Pages sub-path
// (/antventure-final-pwa/), at a domain root, and under `vite preview`.
export default defineConfig({
  base: './',
  build: { target: 'es2022', assetsInlineLimit: 0 },
  plugins: [
    socialUrls(env.SITE_URL),
    VitePWA({
      // main.ts registers the worker via virtual:pwa-register and shows an
      // "Update" toast, so a new version never reloads mid-run.
      registerType: 'prompt',
      injectRegister: false,
      // The icons are already matched by globPatterns below; listing them twice bloats sw.js.
      includeManifestIcons: false,
      manifest: {
        // Same identity as the v1 PWA (its id defaulted to its start_url,
        // /antventure-final-pwa/index.html), so existing installs update in
        // place instead of v2 showing up as a second app.
        id: '/antventure-final-pwa/index.html',
        name: 'Antventure: Leaf of Fate',
        short_name: 'Antventure',
        description:
          'Ride a leaf down a stormy jungle river. Read the rain, dodge by a hair, chain near-misses and beat your best. Daily River challenge, plays offline.',
        lang: 'en',
        dir: 'ltr',
        start_url: './',
        scope: './',
        // Immersive on Android; desktop browsers fall back to a standalone window.
        display: 'standalone',
        display_override: ['fullscreen', 'standalone'],
        orientation: 'portrait',
        background_color: THEME,
        theme_color: THEME,
        categories: ['games'],
        launch_handler: { client_mode: ['focus-existing', 'auto'] },
        // Long-press the app icon → straight into today's shared river (main.ts reads ?mode).
        shortcuts: [
          {
            name: 'Daily River',
            short_name: 'Daily',
            description: 'Same river for everyone today',
            url: './?mode=daily',
            icons: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
          },
        ],
        // Richer install dialog (Chrome / Android). Not precached: only the install UI shows them.
        screenshots: [
          { src: 'screenshots/title-narrow.jpg', sizes: '540x1170', type: 'image/jpeg', form_factor: 'narrow', label: 'Title screen with the Daily River' },
          { src: 'screenshots/run-narrow.jpg', sizes: '540x1170', type: 'image/jpeg', form_factor: 'narrow', label: 'Dodging raindrops for a near-miss combo' },
          { src: 'screenshots/run-wide.jpg', sizes: '1280x800', type: 'image/jpeg', form_factor: 'wide', label: 'Desktop play with the side-panel HUD' },
        ],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell (html/js/css), icons, the Fredoka woff2 subsets and both
        // music loops: everything the game needs to boot and sound right offline.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,mp3}'],
        globIgnores: [
          '**/node_modules/**',
          // Only social crawlers fetch the share card; only the install dialog shows the screenshots.
          'og-image.png',
          'screenshots/**',
          // v1 migration helpers: they run as workers, never as page assets.
          'service-worker.js',
          'sw-legacy-cleanup.js',
        ],
        // Deletes the v1 cache for players whose v1 worker was replaced directly.
        importScripts: ['sw-legacy-cleanup.js'],
        // bgm.mp3 is ~2.5 MB.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  test: {
    // Playwright specs live in tests/e2e and must not be collected by Vitest.
    include: ['tests/unit/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
});
