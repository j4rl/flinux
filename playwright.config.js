import { defineConfig } from '@playwright/test';

const channel = process.env.FLINUX_BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined);

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  fullyParallel: true,
  workers: 2,
  timeout: 30000,
  expect: { timeout: 7000 },
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:8080',
    viewport: { width: 1440, height: 960 },
    headless: true,
    ...(channel ? { channel } : {}),
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/serve.js',
    url: 'http://127.0.0.1:8080',
    reuseExistingServer: true,
    timeout: 30000,
  },
});
