import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './dashboard/__tests__',
  outputDir: './test-results/dashboard-artifacts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 30_000,
  reporter: [['list']],
  testIgnore: ['**/node_modules/**'],
});
