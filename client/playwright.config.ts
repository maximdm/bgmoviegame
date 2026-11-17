import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests for the client. They run against the Vite dev server (not a
 * production build) because the specs drive the game through the dev-only
 * `window.__movieGame` hook, which is stripped from production bundles.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // Cap parallelism: the Find-mode specs wait out a real 15–17s contest window,
  // and ten concurrent browser pages starve that timer under load (flaky). Two
  // workers keep the suite deterministic without a meaningful speed cost.
  workers: 2,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Some Find-mode specs deliberately wait out a 15–17s contest window; give
  // them headroom so parallel-worker load can't push a single test past the limit.
  timeout: 60_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 1280, height: 1000 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
