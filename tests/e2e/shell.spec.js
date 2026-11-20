import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

const tab = (page, name) => page.getByRole('tab', { name, exact: true });
const TAB_NAMES = ['File', 'Home', 'Insert', 'Draw', 'Design', 'Layout', 'References', 'Mailings', 'Review', 'View', 'Developer', 'Zotero', 'Help'];

test.describe('app shell', () => {
  let problems;
  test.beforeEach(async ({ page }) => { problems = await openApp(page); });
  test.afterEach(() => {
    expect(problems.pageErrors).toEqual([]);
    expect(problems.consoleErrors).toEqual([]);
    expect(problems.networkRequests).toEqual([]);
  });

  test('tab bar has every tab in order and the right-side buttons', async ({ page }) => {
    await expect(page.getByRole('tab')).toHaveText(TAB_NAMES);
    await expect(tab(page, 'Home')).toHaveAttribute('aria-selected', 'true');
    for (const name of ['Comments', 'Editing', 'Share']) await expect(page.locator('.top-actions')).toContainText(name);
  });

  test('every tab renders its ribbon and every control is bound to a known command', async ({ page }) => {
    for (const name of TAB_NAMES.slice(1)) {
      await tab(page, name).click();
      await expect(tab(page, name)).toHaveAttribute('aria-selected', 'true');
      const result = await page.evaluate(() => {
        const panel = document.querySelector('.ribbon-panel');
        const ids = [...panel.querySelectorAll('[data-command]')].map((el) => el.dataset.command);
        const unknown = ids.filter((id) => !window.odtEditor.registry.has(id));
        return { groups: panel.querySelectorAll('.group').length, controls: ids.length, unknown };
      });
      expect(result.groups, name).toBeGreaterThan(0);
      expect(result.controls, name).toBeGreaterThan(2);
      expect(result.unknown, name).toEqual([]);
    }
  });

  test('Home tab has the reference groups in order', async ({ page }) => {
    await expect(page.locator('.ribbon-panel .group-label > span')).toHaveText(['Clipboard', 'Font', 'Paragraph', 'Paragraph Tools', 'Styles', 'Editing', 'Voice', 'Editor']);
    await expect(page.locator('.gal.styles .gal-name')).toContainText(['Normal', 'No Spacing', 'Heading 1', 'Title', 'Heading 2', 'Subtitle']);
    await expect(page.locator('.rb-combo.font input')).toHaveValue('Aptos');
    // Aptos isn't bundled, so the missing-font badge shows.
    await expect(page.locator('.rb-combo-warn')).toBeVisible();
  });

  test('unbuilt commands are disabled with a "Coming soon" tooltip', async ({ page }) => {
    const enclose = page.locator('.ribbon-panel [data-command="home.enclosedCharacters"]');
    await expect(enclose).toHaveAttribute('aria-disabled', 'true');
    await enclose.hover();
    await expect(page.locator('.tooltip')).toContainText('Enclose Characters');
    await expect(page.locator('.tooltip')).toContainText('Coming soon');
    await enclose.click({ force: true });
    await expect(page.locator('.toast')).toContainText('Enclose Characters — coming soon');
  });

  test('Ctrl+F1 and double-clicking a tab collapse the ribbon; clicking a tab peeks', async ({ page }) => {
    const ribbon = page.locator('.ribbon');
    await expect(ribbon).toBeVisible();
    await page.keyboard.press('Control+F1');
    await expect(ribbon).toBeHidden();
    await tab(page, 'Insert').click();
    await expect(ribbon).toBeVisible();
    await expect(ribbon).toHaveClass(/is-peek/);
    await page.locator('.canvas').click({ position: { x: 20, y: 400 } });
    await expect(ribbon).toBeHidden();
    await tab(page, 'Home').dblclick();
    await expect(ribbon).toBeVisible();
    await expect(ribbon).not.toHaveClass(/is-collapsed/);
  });

  test('narrow windows collapse groups right-most first into dropdowns', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 700 });
    const collapsed = page.locator('.ribbon-panel .group.is-collapsed');
    await expect(collapsed.first()).toBeVisible();
    const order = await page.evaluate(() => [...document.querySelectorAll('.ribbon-panel .group')].map((g) => g.classList.contains('is-collapsed')));
    // Once a group collapses, every group to its right is collapsed too.
    const first = order.indexOf(true);
    expect(order.slice(first).every(Boolean)).toBe(true);
    expect(order[0]).toBe(false);
    await page.locator('.group.is-collapsed[data-group="editing"] .group-collapsed-btn').click();
    await expect(page.locator('.group-popup [data-command="home.replace"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.group-popup')).toHaveCount(0);
    await page.setViewportSize({ width: 2400, height: 900 });
    await expect(collapsed).toHaveCount(0);
  });

  test('dropdown menus open, navigate with the keyboard and run commands', async ({ page }) => {
    await tab(page, 'View').click();
    const btn = page.locator('.ribbon-panel [data-command="view.interfaceTheme"]');
    await btn.click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitemcheckbox')).toHaveText([/Dark/, /Light/, /Use System Setting/]);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(menu).toHaveCount(0);
    // Menus of unbuilt features still open, with every item marked Coming soon.
    await tab(page, 'Mailings').click();
    await page.locator('.ribbon-panel [data-command="mailings.startMailMerge"]').click();
    await expect(page.getByRole('menu').locator('.menu-soon').first()).toHaveText('Coming soon');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
  });

  test('table grid picker shows the size under the pointer', async ({ page }) => {
    await tab(page, 'Insert').click();
    await page.locator('.ribbon-panel [data-command="insert.table"]').click();
    await page.locator('.table-cell[data-c="3"][data-r="2"]').hover();
    await expect(page.getByRole('menu')).toContainText('3 × 2 Table');
  });

  test('KeyTips: Alt shows tab letters, a letter opens the tab and shows control letters', async ({ page }) => {
    await page.keyboard.press('Alt');
    await expect(page.locator('.keytip').filter({ hasText: /^H$/ })).toBeVisible();
    await expect(page.locator('.keytip').filter({ hasText: /^N$/ })).toBeVisible();
    await page.keyboard.press('n');
    await expect(tab(page, 'Insert')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.keytip').first()).toBeVisible();
    const count = await page.locator('.keytip').count();
    expect(count).toBeGreaterThan(15);
    await page.keyboard.press('Escape');
    await expect(page.locator('.keytip').filter({ hasText: /^H$/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.keytip')).toHaveCount(0);
    // Alt, W (View), then the Interface Theme control's tip opens its menu
    // (a wide window, so no View group is folded away).
    await page.setViewportSize({ width: 2400, height: 900 });
    await page.keyboard.press('Alt');
    await page.keyboard.press('w');
    // Control letters appear on the next frame.
    await expect.poll(() => page.evaluate(() => window.odtEditor.keytips.level)).toBe('tab');
    await expect.poll(() => page.locator('.keytip').count()).toBeGreaterThan(15);
    const tip = await page.evaluate(() => {
      const el = document.querySelector('.ribbon-panel [data-command="view.interfaceTheme"]');
      const r = el.getBoundingClientRect();
      const tips = [...document.querySelectorAll('.keytip')];
      const near = tips.map((k) => ({ text: k.textContent, d: Math.abs(parseFloat(k.style.left) - (r.left + r.width / 2)) + Math.abs(parseFloat(k.style.top) - (r.bottom - 10)) }));
      near.sort((a, b) => a.d - b.d);
      return near[0].text;
    });
    await page.keyboard.type(tip.toLowerCase());
    await expect(page.getByRole('menu')).toBeVisible();
  });

  test('Alt+Q searches every command', async ({ page }) => {
    await page.keyboard.press('Alt+q');
    const input = page.getByRole('combobox', { name: 'Search commands' });
    await expect(input).toBeFocused();
    const total = await page.locator('.cs-row').count();
    const registered = await page.evaluate(() => window.odtEditor.registry.all().filter((c) => !c.hidden).length);
    expect(total).toBe(registered);
    await input.fill('bold');
    await expect(page.locator('.cs-row').first()).toContainText('Bold');
    await expect(page.locator('.cs-row').first()).toContainText('Home › Font');
    await expect(page.locator('.cs-row').first()).toContainText('Ctrl+B');
    await input.fill('light');
    await expect(page.locator('.cs-row').first()).toContainText('Light');
    await page.keyboard.press('Enter');
    await expect(page.locator('.cs-overlay')).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('Backstage: greeting, templates, recent, no Discord link; Esc and ‹ return', async ({ page }) => {
    await tab(page, 'File').click();
    const bs = page.locator('#backstage');
    await expect(bs).toBeVisible();
    await expect(bs.locator('.bs-title')).toHaveText(/^Good (morning|afternoon|evening)$/);
    await expect(bs.locator('.tp-caption')).toHaveText(['Blank document', 'Studio handbook (sample)', 'Letter', 'Résumé']);
    await expect(bs).toContainText('More templates');
    await expect(bs).toContainText('Documents you open will show up here.');
    await expect(bs.locator('.bs-nav-item')).toHaveText(['Home', 'New', 'Open', 'Info', 'Recover', 'Save', 'Save As', 'Print', 'Export', 'Close', 'Options', 'About']);
    await expect(bs).not.toContainText(/discord/i);
    await bs.locator('.bs-nav-item[data-page="info"]').click();
    await expect(bs.locator('.bs-title')).toHaveText('Info');
    await page.keyboard.press('Escape');
    await expect(bs).toBeHidden();
    await tab(page, 'File').click();
    await bs.locator('.bs-back').click();
    await expect(bs).toBeHidden();
  });

  test('status bar items, and right-click customisation', async ({ page }) => {
    const bar = page.locator('.status-bar');
    await expect(bar).toContainText('Page 1 of 1');
    await expect(bar).toContainText('0 words');
    await expect(bar).toContainText('English (United Kingdom)');
    await expect(bar).toContainText('Focus');
    await expect(bar).toContainText('100%');
    await expect(bar.locator('[data-view="view.printLayout"]')).toHaveClass(/is-checked/);
    await bar.click({ button: 'right', position: { x: 600, y: 10 } });
    await page.getByRole('menuitemcheckbox', { name: 'Word Count' }).click();
    await expect(bar.locator('[data-item="words"]')).toBeHidden();
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(page.locator('.status-bar [data-item="words"]')).toBeHidden();
  });

  test('rulers line up with the page', async ({ page }) => {
    const [ruler, pageBox] = await Promise.all([page.locator('.hruler').boundingBox(), page.locator('.pg').first().boundingBox()]);
    expect(Math.abs(ruler.x - pageBox.x)).toBeLessThan(1);
    expect(Math.abs(ruler.width - pageBox.width)).toBeLessThan(1);
    const vr = await page.locator('.vruler').boundingBox();
    expect(Math.abs(vr.y - pageBox.y)).toBeLessThan(1);
    await expect(page.locator('.hruler .rt-num').first()).toHaveText('1');
  });

  test('F6 cycles between the tabs, ribbon, document and status bar', async ({ page }) => {
    await page.locator('.canvas').focus();
    await page.keyboard.press('F6');
    await expect(page.locator('.status-bar')).toContainText('Page');
    expect(await page.evaluate(() => document.activeElement.closest('[data-region]')?.dataset.region)).toBe('status');
    await page.keyboard.press('F6');
    expect(await page.evaluate(() => document.activeElement.closest('[data-region]')?.dataset.region)).toBe('tabs');
    await page.keyboard.press('F6');
    expect(await page.evaluate(() => document.activeElement.closest('[data-region]')?.dataset.region)).toBe('ribbon');
  });

  test('app shortcuts never trigger browser defaults', async ({ page }) => {
    // Ctrl+P opens File ▸ Print (not the browser's own print dialog straight away).
    await page.keyboard.press('Control+p');
    await expect(page.locator('.bs-print-settings')).toBeVisible();
  });
});
