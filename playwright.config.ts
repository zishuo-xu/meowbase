import { defineConfig } from '@playwright/test';

const baseURL = process.env.E2E_WEB_URL;
if (!baseURL) {
  throw new Error('E2E_WEB_URL 未设。请走 pnpm e2e:web,不要直接 playwright test');
}

export default defineConfig({
  testDir: './scripts',
  testMatch: 'e2e-web.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL,
    browserName: 'chromium',
    locale: 'zh-CN',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
