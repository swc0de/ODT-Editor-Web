/**
 * M16 screenshots (dark and light): File ▸ Save As with PDF chosen, the PDF
 * and XPS options dialogs → reference/compare/m16-*.png
 */
import { chromium } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { mkdirSync, readFileSync } from 'node:fs';

const OUT = path.resolve('reference/compare');
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
for (const theme of ['dark', 'light']) {
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 })).newPage();
  await page.addInitScript((t) => { window.__ODT_TEST_DEFAULTS__ = { fileSystemAccess: false, theme: t }; }, theme);
  await page.goto(pathToFileURL(path.resolve('dist/odt-editor.html')).href);
  await page.waitForFunction(() => window.odtEditor && document.getElementById('app').getAttribute('aria-busy') === 'false');
  const b64 = readFileSync('tests/fixtures/word-features.docx').toString('base64');
  await page.evaluate(async (b) => { await window.odtEditor.session.openBytes(Uint8Array.from(atob(b), (c) => c.charCodeAt(0)), { name: 'word-features.docx', skipGuard: true }); }, b64);
  await page.waitForTimeout(500);
  await page.keyboard.press('F12');
  await page.locator('[data-saveas-type]').selectOption('pdf');
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, `m16-saveas-pdf-${theme}.png`) });
  await page.locator('[data-saveas-more]').click();
  await page.locator('.dlg').waitFor();
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, `m16-pdf-options-${theme}.png`) });
  await page.locator('.dlg').getByRole('button', { name: 'Cancel' }).click();
  await page.locator('[data-saveas-type]').selectOption('xps');
  await page.locator('[data-saveas-more]').click();
  await page.locator('.dlg').waitFor();
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, `m16-xps-options-${theme}.png`) });
  await page.close();
}
await browser.close();
