// Playwright e2e tests run against the built single file, dist/odt-editor.html.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1600, height: 900 },
    trace: 'off',
  },
});
