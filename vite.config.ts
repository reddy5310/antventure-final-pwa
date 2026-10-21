import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Relative base so the build works both at the GitHub Pages sub-path
// (/antventure-final-pwa/) and at a domain root.
export default defineConfig({
  base: './',
  build: { target: 'es2022', assetsInlineLimit: 0 },
  plugins: [
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icons/*.png', 'icons/*.svg', 'audio/*.mp3'],
      manifest: {
        name: 'Antventure: Leaf of Fate',
        short_name: 'Antventure',
        description: 'Guide a tiny ant on a leaf down a stormy river. Dodge the rain, chain near-misses, beat your best.',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0b1d26',
        theme_color: '#0b1d26',
        icons: [],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,mp3}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
});
