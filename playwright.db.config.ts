import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './db',
  outputDir: './test-results/db-artifacts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 30_000,
  reporter: [['list']],
});
