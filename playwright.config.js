import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './browser',
  testMatch: '**/*.spec.js',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 2,
  timeout: 30_000,
  expect: { timeout: 5000 },
  reporter: 'list',
  use: { headless: true, screenshot: 'off', video: 'off', trace: 'off' },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
})
