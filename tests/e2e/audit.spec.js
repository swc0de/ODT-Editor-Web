/**
 * M13 audit: automated accessibility checks (axe-core, WCAG 2.1 A/AA,
 * including colour contrast) of every ribbon tab, Backstage page, the main
 * dialogs, panes and views, in the dark and light themes; and a keyboard-only
 * walk through every tab with KeyTips.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { openApp } from './helpers.js';

const AXE = readFileSync(path.resolve('node_modules/axe-core/axe.min.js'), 'utf8');
const TABS = ['home', 'insert', 'draw', 'design', 'layout', 'references', 'mailings', 'review', 'view', 'developer', 'help'];
const run = (page, id, ...args) => page.evaluate(({ id, args }) => { const r = window.odtEditor.registry.run(id, ...args); return r instanceof Promise ? 'pending' : r; }, { id, args });

async function violations(page, label) {
  const v = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] })).violations
    .map((x) => `${x.id}: ${x.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`));
  return v.map((x) => `[${label}] ${x}`);
}

for (const theme of ['dark', 'light']) {
  test(`accessibility (${theme}): tabs, Backstage, dialogs, panes and views have no WCAG A/AA violations`, async ({ page }) => {
    test.setTimeout(120_000);
    await openApp(page, { theme });
    await page.addScriptTag({ content: AXE });
    await page.locator('.page-flow > .odt-doc > .ProseMirror').click();
    await page.keyboard.type('Accessibility check. ');
    const found = [];
    for (const tab of TABS) {
      await page.evaluate((t) => window.odtEditor.store.set({ activeTab: t }), tab);
      found.push(...await violations(page, `tab ${tab}`));
    }
    for (const p of ['home', 'new', 'open', 'info', 'recover', 'saveAs', 'print', 'export', 'about']) {
      await page.evaluate((pg) => window.odtEditor.store.set({ backstageOpen: true, backstagePage: pg }), p);
      await page.waitForTimeout(100);
      found.push(...await violations(page, `backstage ${p}`));
    }
    await page.evaluate(() => window.odtEditor.store.set({ backstageOpen: false }));
    for (const [cmd, label] of [['file.options', 'options'], ['help.help', 'shortcuts'], ['home.fontDialog', 'font dialog'], ['home.paragraphDialog', 'paragraph dialog'], ['insert.symbolDialog', 'symbol']]) {
      if (!(await page.evaluate((c) => window.odtEditor.registry.has(c), cmd))) continue;
      await run(page, cmd);
      await page.waitForTimeout(150);
      found.push(...await violations(page, label));
      await page.keyboard.press('Escape');
      await page.waitForTimeout(80);
    }
    await run(page, 'view.navigationPane');
    await run(page, 'home.stylesPane');
    found.push(...await violations(page, 'panes'));
    await run(page, 'view.outline');
    found.push(...await violations(page, 'outline'));
    await run(page, 'view.immersiveReader');
    found.push(...await violations(page, 'immersive'));
    await run(page, 'view.readMode');
    await page.waitForTimeout(150);
    found.push(...await violations(page, 'read mode'));
    expect(found).toEqual([]);
  });
}

test('keyboard only: every tab opens with its KeyTip, shows control KeyTips, and F6 cycles the regions', async ({ page }) => {
  await openApp(page);
  await page.setViewportSize({ width: 2400, height: 900 });
  const tips = await page.evaluate(() => Object.fromEntries(window.odtEditor.tabs.filter((t) => !t.contextual && !t.backstage).map((t) => [t.id, t.keytip])));
  for (const [id, key] of Object.entries(tips)) {
    await page.keyboard.press('Alt');
    await expect(page.locator('.keytip').first()).toBeVisible();
    await page.keyboard.type(key.toLowerCase());
    await expect(page.locator(`[role=tab][data-tab="${id}"]`), id).toHaveAttribute('aria-selected', 'true');
    // The control letters of the tab are showing.
    await expect.poll(() => page.evaluate(() => window.odtEditor.keytips.level)).toBe('tab');
    await expect.poll(() => page.locator('.keytip').count()).toBeGreaterThan(2);
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => window.odtEditor.keytips.level)).toBe('top');
    await page.keyboard.press('Escape');
    await expect(page.locator('.keytip')).toHaveCount(0);
  }
  // F6 visits the tabs, the ribbon, the document and the status bar.
  const regions = [];
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('F6');
    regions.push(await page.evaluate(() => document.activeElement.closest('[data-region]')?.dataset.region || document.activeElement.className));
  }
  expect(new Set(regions)).toEqual(new Set(['tabs', 'ribbon', 'document', 'status']));
  // Every visible ribbon button has an accessible name.
  for (const id of Object.keys(tips)) {
    await page.evaluate((t) => window.odtEditor.store.set({ activeTab: t }), id);
    const unnamed = await page.evaluate(() => [...document.querySelectorAll('.ribbon-panel:not([hidden]) button, .ribbon-panel:not([hidden]) input, .ribbon-panel:not([hidden]) select')]
      .filter((b) => b.offsetParent && !(b.getAttribute('aria-label') || b.textContent.trim() || b.labels?.[0]?.textContent.trim())).map((b) => b.outerHTML.slice(0, 80)));
    expect(unnamed, id).toEqual([]);
  }
});
