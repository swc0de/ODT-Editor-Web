import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { existsSync } from 'node:fs';

export const APP_FILE = path.resolve('dist/odt-editor.html');
export const APP_URL = pathToFileURL(APP_FILE).href;

/**
 * Opens the app and records console errors, page errors and any request
 * that isn't the app file itself or an inline data:/blob: resource.
 */
export async function openApp(page, { theme } = {}) {
  if (!existsSync(APP_FILE)) throw new Error('dist/odt-editor.html missing — run npm run build first');
  const problems = { consoleErrors: [], pageErrors: [], networkRequests: [] };
  page.on('console', (msg) => { if (msg.type() === 'error') problems.consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => problems.pageErrors.push(String(err)));
  page.on('request', (req) => {
    const url = req.url();
    if (url === APP_URL || url.startsWith('data:') || url.startsWith('blob:')) return;
    problems.networkRequests.push(url);
  });
  if (theme) {
    await page.addInitScript((t) => {
      try { localStorage.setItem('odt-editor:settings', JSON.stringify({ theme: t })); } catch {}
    }, theme);
  }
  await page.goto(APP_URL);
  await page.waitForFunction(() => window.odtEditor && document.getElementById('app').getAttribute('aria-busy') === 'false');
  return problems;
}
