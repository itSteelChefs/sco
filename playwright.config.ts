import { defineConfig, devices } from '@playwright/test';
import { assertTestDatabaseSafety } from './scripts/test/test-database-environment.mjs';

assertTestDatabaseSafety();

const shellEnvironment = 'NODE_ENV=development';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:3102', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    { command: `${shellEnvironment} && corepack pnpm --filter @sco/api exec tsx src/main.ts`, url: 'http://127.0.0.1:3101/health/live', reuseExistingServer: false },
    { command: `${shellEnvironment} && corepack pnpm --filter @sco/partner-web run dev`, url: 'http://127.0.0.1:3102/login', reuseExistingServer: false },
    { command: `${shellEnvironment} && corepack pnpm --filter @sco/operations-web run dev`, url: 'http://127.0.0.1:3103/login', reuseExistingServer: false },
  ],
});