import fs from 'fs';
import { defineConfig } from '@playwright/test';

const e2ePort = Number(process.env.PLAYWRIGHT_E2E_PORT || 3299);

const chromiumExecutable = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/snap/bin/chromium',
].find((candidate): candidate is string => Boolean(candidate && fs.existsSync(candidate)));

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /.*\.spec\.ts/,
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  timeout: 120_000,
  expect: {
    timeout: 15_000,
  },
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results/playwright',
  use: {
    baseURL: `http://127.0.0.1:${e2ePort}`,
    browserName: 'chromium',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    viewport: { width: 1440, height: 960 },
    launchOptions: {
      executablePath: chromiumExecutable,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    },
  },
  webServer: {
    command: 'node tests/e2e/run-server.mjs',
    url: `http://127.0.0.1:${e2ePort}/`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      PLAYWRIGHT_E2E_PORT: String(e2ePort),
    },
  },
});
