import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: /partner-h4\.playwright\.mjs/,
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: { baseURL: 'http://127.0.0.1:4102' },
  webServer: {
    command: 'corepack pnpm exec next dev -p 4102',
    url: 'http://127.0.0.1:4102/login',
    reuseExistingServer: false,
  },
});
