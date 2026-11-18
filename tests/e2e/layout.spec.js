/**
 * M5: Layout tab (page setup, columns, breaks, sections, line numbers,
 * hyphenation, paragraph spins), headers and footers, and the Design tab —
 * with undo, ODT round-trips and LibreOffice reading what we write.
 */
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import path from 'node:path';
import { openApp, openFixture } from './helpers.js';
import { readZipText } from '../lib/odf.mjs';

const OUT = path.resolve('test-results/layout');
mkdirSync(OUT, { recursive: true });
const soffice = ['soffice', 'libreoffice'].find((bin) => spawnSync(bin, ['--version'], { timeout: 60_000 }).status === 0);

async function settled(page) {
  let last = '';
  for (let i = 0; i < 80; i++) {
    const [sig, pending] = await page.evaluate(() => [window.odtEditor.docArea.pages.map((p) => `${p.startPos}:${p.master}:${Math.round(p.top)}`).join(','), window.odtEditor.docArea.layoutPending]);
    if (sig === last && !pending) return;
    last = sig;
    await page.waitForTimeout(150);
  }
}

const run = (page, id, ...args) => page.evaluate(({ id, args }) => { const r = window.odtEditor.registry.run(id, ...args); return r instanceof Promise ? 'pending' : r; }, { id, args });
const pages = (page) => page.evaluate(() => window.odtEditor.docArea.pages.map((p) => ({ master: p.master, number: p.number, blank: !!p.blank, width: window.odtEditor.docArea.model.masters.get(p.master).width, height: p.box.pageHeight })));

async function fill(page, n = 40) {
  await page.locator('.page-flow .ProseMirror').click();
  await page.evaluate((n) => {
    const v = window.odtEditor.editor.view;
    const s = v.state.schema;
    const paras = [];
    for (let i = 0; i < n; i++) paras.push(s.node('paragraph', null, [s.text(`Paragraph ${i + 1}. ${'Internationalisation and extraordinarily comprehensive documentation help everyone understand. '.repeat(3)}`)]));
    v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, paras));
  }, n);
  await settled(page);
}

const caretInParagraph = (page, index, offset = 3) => page.evaluate(({ index, offset }) => {
  const v = window.odtEditor.editor.view;
  let p = null;
  let k = 0;
  v.state.doc.descendants((n, pos) => { if (n.isTextblock) { if (k++ === index) p = pos + 1 + offset; return false; } return p == null; });
  v.dispatch(v.state.tr.setSelection(window.odtEditor.pm.TextSelection.create(v.state.doc, p)));
  v.focus();
}, { index, offset });

/** Text lines outside every page body (column regions included). */
const linesOutsideBodies = (page) => page.evaluate(() => {
  const { docArea, editor, store } = window.odtEditor;
  const stack = docArea.view.stack.getBoundingClientRect();
  const z = store.get().zoom / 100;
  const out = [];
  const range = document.createRange();
  const walker = document.createTreeWalker(editor.view.dom, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.data.trim() || n.parentElement.closest('.odt-shy')) continue;
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) {
      if (r.width < 5) continue;
      const top = (r.top - stack.top) / z;
      const bottom = (r.bottom - stack.top) / z;
      if (!docArea.pages.some((p) => top >= p.top + p.box.top - 2 && bottom <= p.top + p.box.bottom + 2)) out.push(n.data.slice(0, 20));
    }
  }
  return out;
});

/** Saves, re-opens (model must match) and returns the package parts. */
async function roundTrip(page, name) {
  const r = await page.evaluate(async () => {
    const { session, editor, io } = window.odtEditor;
    const bytes = await session.serialize();
    const b = io.importOdt(bytes);
    let bin = '';
    for (const c of bytes) bin += String.fromCharCode(c);
    return { same: JSON.stringify(editor.getDoc().toJSON()) === JSON.stringify(b.doc.toJSON()), masters: JSON.stringify(b.masterStyles) === JSON.stringify(session.state.masterStyles), out: btoa(bin) };
  });
  const bytes = Buffer.from(r.out, 'base64');
  const file = path.join(OUT, name);
  writeFileSync(file, bytes);
  const zip = readZipText(new Uint8Array(bytes));
  return { ...r, file, content: zip['content.xml'], styles: zip['styles.xml'] };
}

/** LibreOffice opens our file and saves it again: returns its content.xml and styles.xml. */
function libreOfficeResave(file) {
  const dir = path.join(OUT, 'lo');
  // A profile per conversion: parallel workers can't share one.
  execFileSync(soffice, [`-env:UserInstallation=file://${OUT}/lo-profile-${path.basename(file, '.odt')}`, '--headless', '--norestore', '--convert-to', 'odt', '--outdir', dir, file], { stdio: 'pipe', timeout: 120_000 });
  const out = path.join(dir, path.basename(file));
  if (!existsSync(out)) return null;
  const zip = readZipText(new Uint8Array(readFileSync(out)));
  return { content: zip['content.xml'], styles: zip['styles.xml'] };
}

test.describe('layout, headers & footers, design', () => {
  let problems;
  test.beforeEach(async ({ page }) => { problems = await openApp(page); });
  test.afterEach(() => {
    expect(problems.pageErrors).toEqual([]);
    expect(problems.consoleErrors).toEqual([]);
    expect(problems.networkRequests).toEqual([]);
  });

  test('margins, size and orientation presets change the pages and undo', async ({ page }) => {
    await fill(page, 10);
    await run(page, 'layout.sizeA5');
    await run(page, 'layout.marginsNarrow');
    await settled(page);
    let p = (await pages(page))[0];
    expect(Math.round(p.width)).toBe(559); // 14.8 cm
    expect(await page.evaluate(() => window.odtEditor.registry.isChecked('layout.marginsNarrow'))).toBe(true);
    expect(await page.evaluate(() => window.odtEditor.docArea.model.first.marginLeft)).toBeCloseTo(48, 0); // 1.27 cm
    await run(page, 'layout.landscape');
    await settled(page);
    p = (await pages(page))[0];
    expect(Math.round(p.width)).toBe(794);
    expect(Math.round(p.height)).toBe(559);
    await page.keyboard.press('Control+z');
    await settled(page);
    expect(Math.round((await pages(page))[0].width)).toBe(559);
    await page.keyboard.press('Control+y');
    await settled(page);
    expect(Math.round((await pages(page))[0].width)).toBe(794);
    // The ribbon menus reflect it.
    await page.getByRole('tab', { name: 'Layout', exact: true }).click();
    await page.locator('.ribbon-panel [data-command="layout.orientation"]').click();
    await expect(page.getByRole('menuitemcheckbox', { name: 'Landscape' })).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    const rt = await roundTrip(page, 'page-setup.odt');
    expect(rt.same).toBe(true);
    expect(rt.styles).toMatch(/fo:page-width="21cm" fo:page-height="14.8cm"|fo:page-height="14.8cm"/);
    expect(rt.styles).toContain('style:print-orientation="landscape"');
  });

  test('Page Setup dialog: custom margins and paper size', async ({ page }) => {
    await fill(page, 5);
    run(page, 'layout.pageSetupDialog');
    const dlg = page.getByRole('dialog', { name: 'Page Setup' });
    await dlg.getByRole('textbox', { name: 'Top' }).fill('3 cm');
    await dlg.getByRole('textbox', { name: 'Left' }).fill('4 cm');
    await dlg.getByRole('tab', { name: 'Paper' }).click();
    await dlg.getByLabel('Size').selectOption('Letter');
    await dlg.getByRole('button', { name: 'OK' }).click();
    await settled(page);
    const m = await page.evaluate(() => { const f = window.odtEditor.docArea.model.first; return { w: f.width, ml: f.marginLeft, mt: f.marginTop }; });
    expect(m.w).toBeCloseTo(21.59 * 96 / 2.54, 0);
    expect(m.ml).toBeCloseTo(4 * 96 / 2.54, 0);
    expect(m.mt).toBeCloseTo(3 * 96 / 2.54, 0);
  });

  test('columns: two, three and one; every line stays inside the page bodies; saved as a section', async ({ page }) => {
    await fill(page, 40);
    for (const [id, n] of [['layout.columnsTwo', 2], ['layout.columnsThree', 3], ['layout.columnsLeft', 2]]) {
      await run(page, id);
      await settled(page);
      expect(await page.evaluate(() => getComputedStyle(document.querySelector('.ProseMirror section')).columnCount)).toBe(String(n));
      expect(await linesOutsideBodies(page), id).toEqual([]);
      expect(await page.locator('.pg-span').count()).toBeGreaterThan(0);
    }
    const rt = await roundTrip(page, 'columns.odt');
    expect(rt.same).toBe(true);
    expect(rt.content).toMatch(/<text:section text:style-name="Sect\d+" text:name="Section1">/);
    expect(rt.content).toMatch(/fo:column-count="2"/);
    expect(rt.content).toMatch(/style:rel-width/);
    await run(page, 'layout.columnsOne');
    await settled(page);
    expect(await page.locator('.pg-span').count()).toBe(0);
    expect(await linesOutsideBodies(page)).toEqual([]);
    if (soffice) {
      const lo = libreOfficeResave(rt.file);
      expect(lo, 'LibreOffice re-saved the file').toBeTruthy();
      expect(lo.content).toMatch(/fo:column-count="2"/);
      expect(lo.content).toContain('text:section');
    }
  });

  test('breaks: page, section (landscape), even page, continuous, text wrapping', async ({ page }) => {
    await fill(page, 40);
    await caretInParagraph(page, 2, 0);
    await page.keyboard.press('Control+Enter');
    await settled(page);
    // "Paragraph 3" now starts page 2.
    expect(await page.evaluate(() => {
      const { docArea, editor } = window.odtEditor;
      let at = -1;
      editor.getDoc().descendants((n, pos) => { if (at < 0 && n.isTextblock && n.textContent.startsWith('Paragraph 3.')) at = pos; return at < 0; });
      return docArea.pageAt(at + 1);
    })).toBe(1);
    await caretInParagraph(page, 21, 0);
    await run(page, 'layout.breakSectionNext');
    await settled(page);
    await run(page, 'layout.landscape');
    await settled(page);
    let ps = await pages(page);
    const firstLand = ps.findIndex((p) => p.width > p.height);
    expect(firstLand).toBeGreaterThan(0);
    expect(ps.slice(0, firstLand).every((p) => p.width < p.height)).toBe(true);
    expect(ps.slice(firstLand).every((p) => p.width > p.height)).toBe(true);
    expect(await linesOutsideBodies(page)).toEqual([]);
    // An even-page section break starts the section on an even page (inserting a blank page if needed).
    await caretInParagraph(page, 32, 0);
    await run(page, 'layout.breakSectionEven');
    await settled(page);
    ps = await pages(page);
    const start = ps.findIndex((p) => /Even/.test(p.master) && !p.blank);
    expect(ps[start].number % 2).toBe(0);
    // Continuous section break → a section; text wrapping break → a clearing line break.
    await caretInParagraph(page, 36, 0);
    await run(page, 'layout.breakSectionContinuous');
    await caretInParagraph(page, 38, 5);
    await run(page, 'layout.breakTextWrapping');
    await expect(page.locator('.ProseMirror br[data-clear]')).toHaveCount(1);
    const rt = await roundTrip(page, 'breaks.odt');
    expect(rt.same).toBe(true);
    expect(rt.content).toContain('fo:break-before="page"');
    expect(rt.content).toMatch(/style:master-page-name="Section_20_2"/);
    expect(rt.styles).toMatch(/<style:master-page style:name="Section_20_2" [^>]*style:display-name="Section 2"/);
    expect(rt.styles).toContain('style:page-usage="left"');
    expect(rt.content).toContain('loext:clear="all"');
    if (soffice) {
      const lo = libreOfficeResave(rt.file);
      expect(lo.styles).toMatch(/style:name="Section_20_2"/);
      expect(lo.content).toMatch(/master-page-name="Section_20_2"/);
    }
  });

  test('line numbers, suppression and hyphenation', async ({ page }) => {
    await fill(page, 12);
    await run(page, 'layout.lineNumbersContinuous');
    await settled(page);
    await expect.poll(() => page.locator('.ln-num').count()).toBeGreaterThan(20);
    const firstNums = await page.locator('.ln-num').evaluateAll((els) => els.slice(0, 3).map((e) => e.textContent));
    expect(firstNums).toEqual(['1', '2', '3']);
    const total = await page.locator('.ln-num').count();
    await caretInParagraph(page, 0, 0);
    await run(page, 'layout.lineNumbersSuppress');
    await settled(page);
    await expect.poll(() => page.locator('.ln-num').count()).toBeLessThan(total);
    await run(page, 'layout.hyphenationAuto');
    await settled(page);
    await expect.poll(() => page.locator('.odt-shy').count()).toBeGreaterThan(50);
    expect(await linesOutsideBodies(page)).toEqual([]);
    const rt = await roundTrip(page, 'lines.odt');
    expect(rt.same).toBe(true);
    expect(rt.styles).toMatch(/<text:linenumbering-configuration[^>]*text:number-lines="true"/);
    expect(rt.content).toContain('text:number-lines="false"');
    expect(rt.styles).toMatch(/fo:hyphenate="true"/);
    await run(page, 'layout.lineNumbersNone');
    await run(page, 'layout.hyphenationNone');
    await settled(page);
    await expect(page.locator('.ln-num')).toHaveCount(0);
    await expect(page.locator('.odt-shy')).toHaveCount(0);
  });

  test('Layout ▸ Paragraph spin boxes follow and set the paragraph', async ({ page }) => {
    await page.locator('.page-flow .ProseMirror').click();
    await page.keyboard.type('Spin me');
    await page.getByRole('tab', { name: 'Layout', exact: true }).click();
    const left = page.locator('.ribbon-panel [data-command="layout.indentLeft"]');
    await left.fill('1.5');
    await left.press('Enter');
    const after = page.locator('.ribbon-panel [data-command="layout.spacingAfter"]');
    await after.focus();
    await after.press('ArrowUp');
    const a = await page.evaluate(() => window.odtEditor.editor.getDoc().firstChild.attrs.auto.props['style:paragraph-properties'].a);
    expect(a['fo:margin-left']).toBe('1.5cm');
    expect(parseFloat(a['fo:margin-bottom'])).toBeGreaterThan(8);
    await page.locator('.page-flow .ProseMirror').click();
    await expect(left).toHaveValue('1.5 cm');
  });

  test('headers and footers: page numbers, editing, different first page, link to previous', async ({ page }) => {
    await fill(page, 30);
    await run(page, 'insert.pageNumberBottomCentre');
    await expect(page.locator('.hf-edit-box.footer')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Header & Footer' })).toBeVisible();
    await page.keyboard.press('End');
    await page.keyboard.type(' – draft');
    await run(page, 'headerFooter.close');
    await settled(page);
    await expect(page.getByRole('tab', { name: 'Header & Footer' })).toBeHidden();
    const footers = await page.locator('.pg-footer').allTextContents();
    expect(footers.length).toBeGreaterThan(2);
    footers.forEach((f, i) => expect(f).toBe(`${i + 1} – draft`));
    // Double-click the header area of page 1 to edit it.
    await page.evaluate(() => { document.querySelector('.canvas').scrollTop = 0; });
    const box = await page.locator('.pg').first().boundingBox();
    await page.mouse.dblclick(box.x + box.width / 2, box.y + 30);
    await expect(page.locator('.hf-edit-box.header')).toBeVisible();
    await page.keyboard.type('Company report');
    await run(page, 'headerFooter.differentFirst');
    await settled(page);
    await page.keyboard.press('Escape');
    await settled(page);
    const headers = await page.locator('.pg').evaluateAll((els) => els.map((e) => e.querySelector('.pg-header')?.textContent ?? null));
    expect(headers[0]).toBe('');
    expect(headers[1]).toBe('Company report');
    // Body text dims while editing and becomes editable again afterwards.
    expect(await page.evaluate(() => window.odtEditor.editor.view.editable)).toBe(true);
    // Page number format: i, ii, iii.
    run(page, 'insert.pageNumberFormat');
    const dlg = page.getByRole('dialog', { name: 'Page Number Format' });
    await dlg.getByLabel('Number format').selectOption('i');
    await dlg.getByRole('button', { name: 'OK' }).click();
    await settled(page);
    expect((await page.locator('.pg-footer').allTextContents())[1]).toBe('ii – draft');
    // Undo restores arabic numbers.
    await page.keyboard.press('Control+z');
    await settled(page);
    expect((await page.locator('.pg-footer').allTextContents())[1]).toBe('2 – draft');
    // A new section copies the page style; Link to Previous makes its header match again.
    await caretInParagraph(page, 20, 0);
    await run(page, 'layout.breakSectionNext');
    await settled(page);
    const ps = await pages(page);
    const sec2 = ps.findIndex((p) => p.master !== 'Standard');
    await page.evaluate((i) => window.odtEditor.ui ?? null, sec2);
    await run(page, 'insert.editHeader');
    await page.evaluate((i) => { window.odtEditor.registry.run('headerFooter.close'); void i; }, sec2);
    const rt = await roundTrip(page, 'headers.odt');
    expect(rt.same).toBe(true);
    expect(rt.masters).toBe(true);
    expect(rt.styles).toMatch(/<style:footer>[\s\S]*?<text:page-number[\s\S]*?<\/style:footer>/);
    expect(rt.styles).toContain('style:header-first');
    expect(rt.styles).toContain('Company report');
    if (soffice) {
      const lo = libreOfficeResave(rt.file);
      expect(lo.styles).toContain('Company report');
      expect(lo.styles).toMatch(/<text:page-number/);
    }
  });

  test('Design: theme, style set, paragraph spacing, watermark, page colour, borders, set as default', async ({ page }) => {
    await page.locator('.page-flow .ProseMirror').click();
    await page.keyboard.type('Annual report');
    await page.keyboard.press('Control+Alt+1');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Body text.');
    await page.getByRole('tab', { name: 'Design', exact: true }).click();
    await page.locator('.ribbon-panel [data-command="design.themes"]').click();
    await page.locator('.menu .theme-card[data-theme-id="ember"]').click();
    await expect(page.locator('.ProseMirror h1')).toHaveCSS('color', 'rgb(184, 71, 29)');
    await expect(page.locator('.ProseMirror h1')).toHaveCSS('font-family', /Liberation Serif/);
    await page.locator('.ribbon-panel .gal-tile[data-gallery-item="lines"]').click();
    await expect(page.locator('.ProseMirror h1')).toHaveCSS('border-bottom-style', 'solid');
    await run(page, 'design.paragraphSpacing', 'double');
    await expect(page.locator('.ProseMirror p').first()).toHaveCSS('line-height', /^(37|38)/);
    await page.locator('.ribbon-panel [data-command="design.watermark"]').click();
    await page.locator('.menu .wm-card[data-watermark="confidential"]').click();
    await expect(page.locator('.pg-watermark').first()).toHaveText('CONFIDENTIAL');
    await run(page, 'design.pageColour', '#fff2cc');
    await expect(page.locator('.pg').first()).toHaveCSS('background-color', 'rgb(255, 242, 204)');
    run(page, 'design.pageBorders');
    const dlg = page.getByRole('dialog', { name: 'Page Borders' });
    await dlg.getByLabel('Box').check();
    await dlg.getByRole('button', { name: 'OK' }).click();
    await expect(page.locator('.pg-border').first()).toBeVisible();
    const rt = await roundTrip(page, 'design.odt');
    expect(rt.same).toBe(true);
    expect(rt.styles).toContain('PowerPlusWaterMarkObject');
    expect(rt.styles).toContain('fontwork-plain-text');
    expect(rt.styles).toContain('fo:background-color="#fff2cc"');
    expect(rt.styles).toMatch(/fo:border="0.5pt solid #000000"/);
    expect(rt.styles).toMatch(/style:name="Heading_20_1"[\s\S]*?fo:color="#000000"/);
    if (soffice) {
      const lo = libreOfficeResave(rt.file);
      expect(lo.styles).toContain('CONFIDENTIAL');
    }
    // Undo removes the borders, then the page colour.
    await page.keyboard.press('Control+z');
    await expect(page.locator('.pg-border')).toHaveCount(0);
    await run(page, 'design.removeWatermark');
    await expect(page.locator('.pg-watermark')).toHaveCount(0);
    // Set as Default: a new document gets these styles.
    await run(page, 'design.setAsDefault');
    await page.evaluate(() => window.odtEditor.session.newDocument({ skipGuard: true }));
    await page.locator('.page-flow .ProseMirror').click();
    await page.keyboard.type('New heading');
    await page.keyboard.press('Control+Alt+1');
    await expect(page.locator('.ProseMirror h1')).toHaveCSS('font-family', /Liberation Serif/);
  });

  test('text direction rotates table cell text', async ({ page }) => {
    await openFixture(page, 'tables.odt');
    await settled(page);
    expect(await page.evaluate(() => window.odtEditor.registry.isEnabled('layout.textDirectionRotate90'))).toBe(false);
    await page.locator('.page-flow .ProseMirror td').first().click();
    await expect.poll(() => page.evaluate(() => window.odtEditor.registry.isEnabled('layout.textDirectionRotate90'))).toBe(true);
    await run(page, 'layout.textDirectionRotate90');
    await expect(page.locator('.page-flow .ProseMirror td').first()).toHaveCSS('writing-mode', 'vertical-rl');
    const rt = await roundTrip(page, 'cell-direction.odt');
    expect(rt.same).toBe(true);
    expect(rt.content).toContain('style:writing-mode="tb-rl"');
  });
});
