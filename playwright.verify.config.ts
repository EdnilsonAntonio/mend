import { defineConfig, devices } from '@playwright/test';

const APP_BASE_URL = 'http://localhost:3100';

export default defineConfig({
  testDir: process.env['MEND_VERIFY_DIR'] ?? './mend-tmp',
  outputDir: './test-results/verify-artifacts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 15_000,
  expect: { timeout: 5_000 },
  reporter: [
    ['line'],
    ['json', { outputFile: process.env['MEND_VERIFY_JSON'] ?? 'test-results/verify.json' }],
  ],
  use: {
    baseURL: APP_BASE_URL,
    actionTimeout: 5_000,
    navigationTimeout: 10_000,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run start:app',
    url: APP_BASE_URL,
    reuseExistingServer: true,
    timeout: 30_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
