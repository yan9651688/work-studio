import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './apps/web/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:3100' },
  webServer: {
    command: 'corepack pnpm --filter @studio/server exec tsx test/http-server.ts',
    url: 'http://127.0.0.1:3100/healthz',
    reuseExistingServer: true,
    timeout: 30000,
  },
  timeout: 30000,
});
