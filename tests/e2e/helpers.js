import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { existsSync } from 'node:fs';

export const APP_FILE = path.resolve('dist/odt-editor.html');
export const APP_URL = pathToFileURL(APP_FILE).href;

/**
 * Opens the app and records console errors, page errors and any request
 * that isn't the app file itself or an inline data:/blob: resource.
 */
export async function openApp(page, { theme, settings = {} } = {}) {
  if (!existsSync(APP_FILE)) throw new Error('dist/odt-editor.html missing — run npm run build first');
  const problems = { consoleErrors: [], pageErrors: [], networkRequests: [] };
  page.on('console', (msg) => { if (msg.type() === 'error') problems.consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => problems.pageErrors.push(String(err)));
  page.on('request', (req) => {
    const url = req.url();
    if (url === APP_URL || url.startsWith('data:') || url.startsWith('blob:')) return;
    problems.networkRequests.push(url);
  });
  // Tests use downloads and <input type=file> rather than native file pickers.
  // Defaults are passed through a global: touching localStorage from an init
  // script races with Chromium's storage on reload (file://) and loses writes.
  await page.addInitScript((s) => { window.__ODT_TEST_DEFAULTS__ = s; }, { fileSystemAccess: false, ...(theme ? { theme } : {}), ...settings });
  await page.goto(APP_URL);
  await page.waitForFunction(() => window.odtEditor && document.getElementById('app').getAttribute('aria-busy') === 'false');
  return problems;
}

/** Opens a fixture in the running app (bypassing the file picker). */
export async function openFixture(page, name) {
  const { readFileSync } = await import('node:fs');
  const b64 = readFileSync(path.resolve('tests/fixtures', name)).toString('base64');
  await page.evaluate(async ({ b64, name }) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await window.odtEditor.session.openBytes(bytes, { name, skipGuard: true });
  }, { b64, name });
}
