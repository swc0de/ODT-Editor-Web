#!/usr/bin/env node
/**
 * Captures the app in dark and light themes into reference/compare/, next to
 * any reference image with the same base name, for side-by-side review.
 *   node tests/screenshots.mjs [label]     (label defaults to "current")
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const label = process.argv[2] || 'current';
const OUT = path.resolve('reference/compare');
mkdirSync(OUT, { recursive: true });
const url = pathToFileURL(path.resolve('dist/odt-editor.html')).href;

const browser = await chromium.launch();
for (const theme of ['dark', 'light']) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.addInitScript((t) => localStorage.setItem('odt-editor:settings', JSON.stringify({ theme: t })), theme);
  await page.goto(url);
  await page.waitForFunction(() => document.getElementById('app')?.getAttribute('aria-busy') === 'false');
  const file = path.join(OUT, `${label}-${theme}.png`);
  await page.screenshot({ path: file });
  console.log('saved', path.relative(process.cwd(), file));
  await ctx.close();
}
await browser.close();
