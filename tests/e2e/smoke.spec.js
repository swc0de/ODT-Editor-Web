import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openApp, APP_FILE } from './helpers.js';

const APP_NAME = readFileSync('src/config.js', 'utf8').match(/export const APP_NAME\s*=\s*'([^']+)'/)[1];

test('loads from file:// with no errors and no network requests', async ({ page }) => {
  const problems = await openApp(page);
  await expect(page).toHaveTitle(APP_NAME);
  await expect(page.locator('.page')).toBeVisible();
  // Let any late async work (fonts, timers) settle.
  await page.waitForTimeout(300);
  expect(problems.pageErrors).toEqual([]);
  expect(problems.consoleErrors).toEqual([]);
  expect(problems.networkRequests).toEqual([]);
});

test('the build output is a single self-contained file', async () => {
  const html = readFileSync(APP_FILE, 'utf8');
  expect(html).not.toMatch(/<script[^>]+src=/i);
  expect(html).not.toMatch(/<link[^>]+rel=["']?stylesheet/i);
  expect(html).not.toMatch(/url\(\s*["']?https?:/i);
  expect(html).toMatch(/Content-Security-Policy/);
  expect(html).toMatch(/font\/woff2;base64,/);
});

test('works with the network fully offline', async ({ page, context }) => {
  await context.setOffline(true);
  const problems = await openApp(page);
  expect(problems.consoleErrors).toEqual([]);
  expect(problems.pageErrors).toEqual([]);
  await expect(page).toHaveTitle(APP_NAME);
});

test('bundled fonts are embedded and load', async ({ page }) => {
  await openApp(page);
  const loaded = await page.evaluate(async () => {
    const out = {};
    for (const f of ['Carlito', 'Caladea', 'Liberation Sans', 'Liberation Serif', 'Liberation Mono']) {
      const faces = await document.fonts.load(`700 italic 12pt "${f}"`);
      out[f] = faces.length > 0;
    }
    return out;
  });
  expect(loaded).toEqual({ Carlito: true, Caladea: true, 'Liberation Sans': true, 'Liberation Serif': true, 'Liberation Mono': true });
});

test('theme switching updates the colour tokens', async ({ page }) => {
  await openApp(page);
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await bg()).toBe('rgb(31, 31, 31)');
  await page.evaluate(() => window.odtEditor.registry.run('theme.light'));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await bg()).toBe('rgb(243, 243, 243)');
  // The choice persists across reloads.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.locator('[data-command="theme.toggle"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('command registry and i18n are wired up', async ({ page }) => {
  await openApp(page);
  const info = await page.evaluate(() => {
    const { registry, t } = window.odtEditor;
    return {
      ids: registry.all().map((c) => c.id),
      label: registry.label('theme.light'),
      words: t('status.words', { count: 3 }),
    };
  });
  expect(info.ids).toEqual(expect.arrayContaining(['theme.dark', 'theme.light', 'theme.system', 'theme.toggle']));
  expect(info.label).toBe('Light theme');
  expect(info.words).toBe('3 words');
  await expect(page.locator('.status-bar')).toContainText('Page 1 of 1');
  await expect(page.locator('.status-bar')).toContainText('English (United Kingdom)');
});

test('the page is A4 at 96 dpi', async ({ page }) => {
  await openApp(page);
  const box = await page.locator('.page').boundingBox();
  expect(Math.round(box.width)).toBe(794);
  expect(Math.round(box.height)).toBe(1123);
});
