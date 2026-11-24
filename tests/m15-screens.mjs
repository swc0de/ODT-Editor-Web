/**
 * M15 screenshots (dark and light): File ▸ Save As, the File Conversion
 * dialog and the compatibility prompt → reference/compare/m15-*.png
 */
import { chromium } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

const OUT = path.resolve('reference/compare');
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
for (const theme of ['dark', 'light']) {
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 })).newPage();
  await page.addInitScript((t) => { window.__ODT_TEST_DEFAULTS__ = { fileSystemAccess: false, theme: t }; }, theme);
  await page.goto(pathToFileURL(path.resolve('dist/odt-editor.html')).href);
  await page.waitForFunction(() => window.odtEditor && document.getElementById('app').getAttribute('aria-busy') === 'false');
  await page.locator('.ProseMirror').first().click();
  await page.keyboard.type('Quarterly report – “draft” for the café team ✓');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+b');
  // Save As page.
  await page.keyboard.press('F12');
  await page.locator('[data-saveas-name]').fill('Quarterly report');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `m15-saveas-${theme}.png`) });
  // Compatibility prompt (Plain Text).
  await page.locator('[data-saveas-type]').selectOption('txt');
  await page.locator('[data-saveas-save]').click();
  await page.locator('.dlg').waitFor();
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, `m15-compatibility-${theme}.png`) });
  // File Conversion dialog.
  await page.locator('.dlg').getByRole('button', { name: 'Keep current format' }).click();
  const conv = page.locator('.dlg', { hasText: 'File Conversion' });
  await conv.waitFor();
  await conv.locator('[data-option="encoding"]').selectOption('windows-1252');
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, `m15-file-conversion-${theme}.png`) });
  await page.close();
}
await browser.close();
console.log('written reference/compare/m15-*.png');
