import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const appDirectory = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  testDir: './tests',
  testMatch: /partner-h5\.playwright\.mjs/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: { baseURL: 'http://127.0.0.1:4103' },
  webServer: {
    command: `corepack pnpm --dir ${appDirectory} exec next dev -p 4103`,
    url: 'http://127.0.0.1:4103/login',
    reuseExistingServer: false,
  },
});
