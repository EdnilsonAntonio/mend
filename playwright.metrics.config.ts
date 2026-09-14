import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './metrics',
  outputDir: './test-results/metrics-artifacts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 30_000,
  reporter: [['list']],
});
