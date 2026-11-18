#!/usr/bin/env node
/**
 * Visual comparison against reference/*.png.
 *
 * For every reference image, renders the app at the same viewport size (crops
 * of the ribbon are captured from a 2552×1331 window, the size of the full
 * reference screenshots) and writes reference/compare/<name>-compare.png:
 *   top    – the reference
 *   middle – ours, with "Coming soon" controls drawn at full strength so the
 *            layout can be compared like for like
 *   bottom – ours exactly as shipped (unbuilt controls dimmed)
 * It also writes <name>-light.png with the same view in the light theme.
 *
 *   node tests/screenshots.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const OUT = path.resolve('reference/compare');
mkdirSync(OUT, { recursive: true });
const APP = pathToFileURL(path.resolve('dist/odt-editor.html')).href;

// name → how to put the app in the same state as the reference
const VIEWS = [
  { name: 'home-document-dark', viewport: [2552, 1331], tab: 'home' },
  { name: 'backstage-home-dark', viewport: [2554, 1370], tab: 'home', backstage: true },
  { name: 'ribbon-insert-dark', viewport: [2552, 1331], tab: 'insert', clip: [1141, 128] },
  { name: 'ribbon-draw-dark', viewport: [2552, 1331], tab: 'draw', clip: [777, 127] },
  { name: 'ribbon-layout-dark', viewport: [2552, 1331], tab: 'layout', clip: [980, 123] },
  { name: 'ribbon-view-dark', viewport: [2552, 1331], tab: 'view', clip: [1759, 128] },
];

function pngSize(buf) { return [buf.readUInt32BE(16), buf.readUInt32BE(20)]; }

async function capture(browser, view, { theme, undim }) {
  const [w, h] = view.viewport;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.addInitScript((th) => localStorage.setItem('odt-editor:settings', JSON.stringify({ theme: th })), theme);
  await page.goto(APP);
  await page.waitForFunction(() => document.getElementById('app')?.getAttribute('aria-busy') === 'false');
  await page.evaluate(({ tab, undim, backstage }) => {
    if (undim) document.documentElement.classList.add('compare-undim');
    window.odtEditor.store.set({ activeTab: tab });
    if (backstage) window.odtEditor.registry.run('file.backstage');
    document.activeElement?.blur?.();
  }, { tab: view.tab, undim, backstage: !!view.backstage });
  // A morning greeting, as in the reference (the text depends on the clock).
  if (view.backstage) await page.evaluate(() => { document.querySelector('.bs-title').textContent = 'Good morning'; });
  await page.waitForTimeout(250);
  const clip = view.clip ? { x: 0, y: 0, width: view.clip[0], height: view.clip[1] } : undefined;
  const buf = await page.screenshot({ clip });
  await ctx.close();
  return buf;
}

async function stack(browser, images, labels) {
  const sizes = images.map(pngSize);
  const width = Math.max(...sizes.map((s) => s[0]));
  const ctx = await browser.newContext({ viewport: { width, height: 100 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const html = `<body style="margin:0;background:#c00;font:600 14px sans-serif">${images.map((b, i) =>
    `<div style="background:#c00;color:#fff;padding:3px 8px">${labels[i]}</div><img style="display:block" src="data:image/png;base64,${b.toString('base64')}">`).join('')}</body>`;
  await page.setContent(html);
  const out = await page.screenshot({ fullPage: true });
  await ctx.close();
  return out;
}

const browser = await chromium.launch();
for (const view of VIEWS) {
  const ref = readFileSync(path.resolve('reference', `${view.name}.png`));
  const [undimmed, shipped, light] = [
    await capture(browser, view, { theme: 'dark', undim: true }),
    await capture(browser, view, { theme: 'dark', undim: false }),
    await capture(browser, view, { theme: 'light', undim: false }),
  ];
  writeFileSync(path.join(OUT, `${view.name}-compare.png`), await stack(browser, [ref, undimmed, shipped], [
    `Reference: ${view.name}.png`, 'Ours (layout check: "Coming soon" controls shown at full strength)', 'Ours as shipped (unbuilt controls dimmed)',
  ]));
  writeFileSync(path.join(OUT, `${view.name.replace(/-dark$/, '')}-light.png`), light);
  console.log('compared', view.name);
}
await browser.close();
