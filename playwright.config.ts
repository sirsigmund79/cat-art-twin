import { defineConfig, devices } from '@playwright/test';

// BASE_URL=https://... npm run test:e2e runs the smoke test against a deployed site instead.
const baseURL = process.env.BASE_URL ?? 'http://localhost:4173';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 240_000,
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Optional: point at an already-installed Chromium instead of Playwright's download.
        launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
      },
    },
  ],
  webServer: process.env.BASE_URL
    ? undefined
    : { command: 'npm run build && npm run preview', url: baseURL, reuseExistingServer: true, timeout: 120_000 },
});
