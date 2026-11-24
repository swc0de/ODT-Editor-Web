import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { openApp } from './helpers.js';

const FIXTURE = path.resolve('tests/fixtures/styles.odt');
const firstText = (page) => page.evaluate(() => window.odtEditor.editor.getDoc().textContent);

async function openViaPicker(page, file = FIXTURE) {
  await page.locator('.ProseMirror').focus();
  const chooser = page.waitForEvent('filechooser', { timeout: 15_000 });
  await page.keyboard.press('Control+o');
  await (await chooser).setFiles(file);
  await expect(page).toHaveTitle(`${path.basename(file, '.odt')} - ODT Editor`);
}

test.describe('files', () => {
  let problems;
  test.beforeEach(async ({ page }) => { problems = await openApp(page); });
  test.afterEach(() => {
    expect(problems.pageErrors).toEqual([]);
    expect(problems.consoleErrors).toEqual([]);
    expect(problems.networkRequests).toEqual([]);
  });

  test('Ctrl+O opens, edits mark the title, Ctrl+S saves a file that reopens with the edit', async ({ page }) => {
    await openViaPicker(page);
    expect(await firstText(page)).toContain('Styles hierarchy');
    await page.locator('.ProseMirror h1, .ProseMirror p').first().click();
    await page.keyboard.press('Home');
    await page.keyboard.type('Edited ');
    await expect(page).toHaveTitle('● styles - ODT Editor');
    // M15: without File System Access there is no handle, so Ctrl+S opens File ▸ Save As with the file's own format.
    await page.keyboard.press('Control+s');
    await expect(page.locator('[data-saveas-name]')).toHaveValue('styles');
    await expect(page.locator('[data-saveas-type]')).toHaveValue('odt');
    const download = page.waitForEvent('download');
    await page.locator('[data-saveas-save]').click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('styles.odt');
    const saved = await file.path();
    await expect(page).toHaveTitle('styles - ODT Editor');
    // Reopen the saved file.
    await openViaPicker(page, saved);
    expect(await firstText(page)).toContain('Edited Styles hierarchy');
  });

  // M15: new documents save as .docx by default.
  test('F12 opens the Backstage Save As page, which downloads a .docx by default', async ({ page }) => {
    await page.locator('.ProseMirror').click();
    await page.keyboard.type('Report');
    await page.keyboard.press('F12');
    await expect(page.locator('[data-saveas-type]')).toHaveValue('docx');
    const download = page.waitForEvent('download');
    await page.locator('[data-saveas-save]').click();
    expect((await download).suggestedFilename()).toBe('Document1.docx');
    await expect(page).toHaveTitle('Document1 - ODT Editor');
  });

  test('New with unsaved changes asks to save; Don’t Save discards', async ({ page }) => {
    await page.locator('.ProseMirror').click();
    await page.keyboard.type('draft');
    await page.keyboard.press('Control+n');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Do you want to save your changes to “Document1”?');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    expect(await firstText(page)).toBe('draft');
    await page.keyboard.press('Control+n');
    await page.getByRole('dialog').getByRole('button', { name: 'Don’t Save' }).click();
    await expect(page).toHaveTitle('Document2 - ODT Editor');
    expect(await firstText(page)).toBe('');
  });

  test('Recent lists opened files, and they reopen from the Backstage', async ({ page }) => {
    await openViaPicker(page);
    await page.keyboard.press('Control+n');
    await page.getByRole('tab', { name: 'File', exact: true }).click();
    const row = page.locator('.bs-recent-row').filter({ hasText: 'styles.odt' });
    await expect(row).toBeVisible();
    await row.locator('.bs-recent-open').click();
    await expect(page).toHaveTitle('styles - ODT Editor');
    await page.getByRole('tab', { name: 'File', exact: true }).click();
    await page.locator('.bs-recent-row').filter({ hasText: 'styles.odt' }).getByRole('button', { name: 'Pin to list' }).click();
    await expect(page.locator('.bs-recent-row').filter({ hasText: 'styles.odt' }).getByRole('button', { name: 'Unpin from list' })).toBeVisible();
  });

  test('templates create new documents', async ({ page }) => {
    await page.getByRole('tab', { name: 'File', exact: true }).click();
    await page.locator('.tp-card[data-template="letter"]').click();
    await expect(page.locator('#backstage')).toBeHidden();
    expect(await firstText(page)).toContain('Dear Recipient');
    const style = await page.evaluate(() => window.odtEditor.editor.getDoc().child(0).attrs.styleName);
    expect(style).toBe('Title');
  });

  test('dropping an .odt on the window opens it', async ({ page }) => {
    const b64 = readFileSync(FIXTURE).toString('base64');
    await page.evaluate((b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], 'dropped.odt', { type: 'application/vnd.oasis.opendocument.text' }));
      document.querySelector('.canvas').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, b64);
    await expect(page).toHaveTitle('dropped - ODT Editor');
  });

  test('autosave keeps unsaved work, and Recover brings it back after a reload', async ({ page }) => {
    await page.locator('.ProseMirror').click();
    await page.keyboard.type('Precious unsaved words');
    await page.evaluate(() => window.odtEditor.session.autosaveNow());
    await page.reload();
    await page.waitForFunction(() => document.getElementById('app').getAttribute('aria-busy') === 'false');
    await expect(page.locator('.toast')).toContainText('can be recovered');
    await page.getByRole('tab', { name: 'File', exact: true }).click();
    await page.locator('.bs-nav-item[data-page="recover"]').click();
    const row = page.locator('.bs-recent-row').filter({ hasText: 'Document1' });
    await expect(row).toBeVisible();
    await row.locator('.bs-recent-open').click();
    await expect.poll(() => firstText(page)).toBe('Precious unsaved words');
    await expect(page).toHaveTitle('● Document1 - ODT Editor');
  });

  test('closing the tab with unsaved changes triggers the beforeunload guard', async ({ page }) => {
    await page.locator('.ProseMirror').click();
    await page.keyboard.type('x');
    let prompted = false;
    page.on('dialog', async (d) => { prompted = d.type() === 'beforeunload'; await d.dismiss(); });
    await page.close({ runBeforeUnload: true });
    await expect.poll(() => prompted).toBe(true);
  });

  test('a file that is not an ODT shows an error and keeps the current document', async ({ page }) => {
    await page.locator('.ProseMirror').click();
    await page.keyboard.type('keep me');
    await page.evaluate(() => { window.odtEditor.session.openBytes(new TextEncoder().encode('not a zip'), { name: 'bad.odt' }); });
    await expect(page.getByRole('alertdialog')).toContainText('couldn’t be opened');
    await page.getByRole('alertdialog').getByRole('button', { name: 'OK' }).click();
    expect(await firstText(page)).toBe('Keep me'); // AutoCorrect capitalises the sentence
  });
});
