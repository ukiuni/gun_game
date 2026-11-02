import { defineConfig, devices } from '@playwright/test';

const PORT = 8123;
export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}/`, trace: 'retain-on-failure' },
  webServer: { command: `node tools/server.mjs ${PORT}`, url: `http://localhost:${PORT}/`, reuseExistingServer: true },
  projects: [
    // Android phone (Chromium) / iPhone + iPad (WebKit = Safari engine)
    { name: 'android-pixel7', use: { ...devices['Pixel 7'] } },
    { name: 'iphone-15', use: { ...devices['iPhone 15'] } },
    { name: 'ipad', use: { ...devices['iPad (gen 7)'] } },
  ],
});
