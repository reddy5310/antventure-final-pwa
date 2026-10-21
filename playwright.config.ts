import { defineConfig, devices } from '@playwright/test';

// No @types/node in this project: read the environment without the global type.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const CI = !!env.CI;
// Overridable so several local runs (or a running dev box) can coexist.
const PORT = Number(env.E2E_PORT ?? 4173);
const OUT_DIR = env.E2E_OUT_DIR ?? 'dist';

/**
 * End-to-end tests run against the real production build (service worker,
 * hashed assets, relative base) served by `vite preview`.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  timeout: 45_000,
  expect: { timeout: 7_000 },
  reporter: CI ? [['github'], ['html', { open: 'never' }], ['list']] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORT}/`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'phone',
      // Mobile Chrome UA + touch, sized like a typical modern phone.
      use: {
        ...devices['Pixel 7'],
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
      },
    },
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        browserName: 'chromium',
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
  webServer: {
    command: `npx vite build --outDir ${OUT_DIR} --emptyOutDir && npx vite preview --outDir ${OUT_DIR} --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !CI,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
