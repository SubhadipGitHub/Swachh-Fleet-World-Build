import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run against the built single file over file:// (N-1). `npm run test:e2e` builds it first.
// All three engines run, because blob workers from file:// behave differently across browsers (risk R-6).
const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: CI ? 120_000 : 60_000,
  expect: { timeout: CI ? 15_000 : 8_000 },
  reporter: CI ? [['list'], ['github']] : 'list',
  fullyParallel: false,
  workers: 1,
  use: {
    headless: true,
    viewport: { width: 1280, height: 800 },
    screenshot: CI ? 'only-on-failure' : 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Software WebGL in headless Chromium.
        launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
      },
    },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
