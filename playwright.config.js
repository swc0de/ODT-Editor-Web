// Playwright e2e tests run against the built single file, dist/odt-editor.html.
import { defineConfig, devices } from '@playwright/test';

const use = { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 900 }, trace: 'off' };

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: [['list']],
  use,
  projects: [
    { name: 'e2e', testIgnore: /perf\.spec\.js/, use },
    // Timing-sensitive checks run alone, after everything else.
    { name: 'perf', testMatch: /perf\.spec\.js/, dependencies: ['e2e'], use, fullyParallel: false },
  ],
});
