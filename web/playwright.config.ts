import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E Configuration — Gramoz Platform (TASK-13)
 *
 * Configured for real browser end-to-end testing across Next.js frontend (port 3000)
 * and NestJS backend (port 5000) with PostgreSQL 16 (5433) and Redis 7 (6380).
 *
 * Optimized for low-resource environments (1 vCPU, 1 GB RAM target) with:
 * - Single worker (workers: 1) to eliminate resource thrashing.
 * - Headless Chromium execution.
 * - Failure screenshots and traces retained strictly on failure.
 * - Deterministic timeouts and automatic waiting.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 35000,
  expect: {
    timeout: 8000,
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 15000,
    navigationTimeout: 30000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
      },
    },
  ],
  webServer: [
    {
      command: 'npm run start:prod',
      cwd: '../server',
      url: 'http://localhost:5000/api/v1/products',
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
    },
    {
      command: 'npm run start',
      cwd: '.',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
    },
  ],
});
