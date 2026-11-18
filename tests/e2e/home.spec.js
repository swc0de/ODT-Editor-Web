/**
 * Home tab (M4): character and paragraph formatting, lists, styles, find and
 * replace, selection tools, Format Painter, paste options, AutoCorrect, the
 * mini-toolbar and context menu — and ODT round-trips of every formatting type.
 */
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import path from 'node:path';
import { openApp } from './helpers.js';
import { readZipText } from '../lib/odf.mjs';

const OUT = path.resolve('test-results/home');
mkdirSync(OUT, { recursive: true });

const paras = (page) => page.evaluate(() => {
  const out = [];
  window.odtEditor.editor.getDoc().descendants((n) => { if (n.isTextblock) { out.push(n.textContent); return false; } return true; });
  return out;
});

/** Selects text in the document by its first occurrence. */
const selectText = (page, needle, nth = 0) => page.evaluate(({ needle, nth }) => {
  const { editor } = window.odtEditor;
  const view = editor.view;
  let found = null;
  let count = 0;
  view.state.doc.descendants((node, pos) => {
    if (found || !node.isText) return !found;
    let i = node.text.indexOf(needle);
    while (i >= 0 && !found) {
      if (count++ === nth) found = [pos + i, pos + i + needle.length];
      i = node.text.indexOf(needle, i + 1);
    }
    return false;
  });
  if (!found) throw new Error(`text not found: ${needle}`);
  view.dispatch(view.state.tr.setSelection(window.odtEditor.pm.TextSelection.create(view.state.doc, found[0], found[1])));
  view.focus();
}, { needle, nth });

// Commands that open a dialog return a promise; don't wait for the dialog to close.
const run = (page, id, ...args) => page.evaluate(({ id, args }) => { const r = window.odtEditor.registry.run(id, ...args); return r instanceof Promise ? 'pending' : r; }, { id, args });
const btn = (page, id) => page.locator(`.ribbon-panel [data-command="${id}"]`).first();

/** Effective direct text properties of the text containing `needle`. */
const textProps = (page, needle) => page.evaluate((needle) => {
  let out = null;
  window.odtEditor.editor.getDoc().descendants((node) => {
    if (out || !node.isText || !node.text.includes(needle)) return !out;
    out = node.marks.find((m) => m.type.name === 'textProps')?.attrs.auto?.props?.['style:text-properties']?.a || {};
    return false;
  });
  return out;
}, needle);

/** Saves through the session, re-opens and returns { same, content, styles, file }. */
async function roundTrip(page, name) {
  const r = await page.evaluate(async () => {
    const { session, editor, io } = window.odtEditor;
    const bytes = await session.serialize();
    const b = io.importOdt(bytes);
    let bin = '';
    for (const c of bytes) bin += String.fromCharCode(c);
    return { a: editor.getDoc().toJSON(), b: b.doc.toJSON(), out: btoa(bin) };
  });
  const bytes = Buffer.from(r.out, 'base64');
  const file = path.join(OUT, name);
  writeFileSync(file, bytes);
  const zip = readZipText(new Uint8Array(bytes));
  const diff = (x, y, at = '') => {
    if (JSON.stringify(x) === JSON.stringify(y)) return null;
    if (typeof x !== 'object' || typeof y !== 'object' || !x || !y) return `${at}: ${JSON.stringify(x)?.slice(0, 300)} ≠ ${JSON.stringify(y)?.slice(0, 300)}`;
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) { const d = diff(x[k], y[k], `${at}.${k}`); if (d) return d; }
    return at;
  };
  return { same: diff(r.a, r.b) || true, a: r.a, b: r.b, content: zip['content.xml'], styles: zip['styles.xml'], file };
}

const soffice = ['soffice', 'libreoffice'].find((bin) => spawnSync(bin, ['--version'], { timeout: 60_000 }).status === 0);
function libreOfficeHtml(file) {
  const out = path.join(OUT, 'lo');
  execFileSync(soffice, [`-env:UserInstallation=file://${OUT}/lo-profile`, '--headless', '--norestore', '--convert-to', 'html', '--outdir', out, file], { stdio: 'pipe', timeout: 120_000 });
  const html = path.join(out, path.basename(file).replace(/\.odt$/, '.html'));
  return existsSync(html) ? readFileSync(html, 'utf8') : null;
}

test.describe('home tab', () => {
  let problems;
  test.beforeEach(async ({ page }) => { problems = await openApp(page); });
  test.afterEach(() => {
    expect(problems.pageErrors).toEqual([]);
    expect(problems.consoleErrors).toEqual([]);
    expect(problems.networkRequests).toEqual([]);
  });

  test('font controls, shortcuts and the ribbon state follow the selection', async ({ page }) => {
    await page.locator('.ProseMirror').click();
    await page.keyboard.type('Alpha beta gamma delta');
    await selectText(page, 'beta');
    await page.keyboard.press('Control+b');
    await expect(btn(page, 'home.bold')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Control+i');
    await page.keyboard.press('Control+u');
    let p = await textProps(page, 'beta');
    expect(p['fo:font-weight']).toBe('bold');
    expect(p['fo:font-style']).toBe('italic');
    expect(p['style:text-underline-style']).toBe('solid');
    await page.keyboard.press('Control+b');
    p = await textProps(page, 'beta');
    expect(p['fo:font-weight']).toBeUndefined(); // turning bold off removes the property
    await expect(btn(page, 'home.bold')).toHaveAttribute('aria-pressed', 'false');

    // Font name and size combos.
    await selectText(page, 'gamma');
    const font = page.locator('.rb-combo.font .rb-combo-input');
    await font.fill('Liberation Serif');
    await font.press('Enter');
    const size = page.locator('.rb-combo.size .rb-combo-input');
    await size.fill('18');
    await size.press('Enter');
    p = await textProps(page, 'gamma');
    expect(p['style:font-name']).toBe('Liberation Serif');
    expect(p['fo:font-size']).toBe('18pt');
    await page.keyboard.press('Control+]');
    expect((await textProps(page, 'gamma'))['fo:font-size']).toBe('20pt');
    await expect(size).toHaveValue('20');
    await expect(font).toHaveValue('Liberation Serif');
    await page.keyboard.press('Control+[');
    expect((await textProps(page, 'gamma'))['fo:font-size']).toBe('18pt');

    // Sub/superscript, strikethrough, colour from the palette, highlight.
    await selectText(page, 'delta');
    await page.keyboard.press('Control+Shift+=');
    expect((await textProps(page, 'delta'))['style:text-position']).toMatch(/^super/);
    await page.keyboard.press('Control+=');
    expect((await textProps(page, 'delta'))['style:text-position']).toMatch(/^sub/);
    await btn(page, 'home.strikethrough').click();
    await page.locator('.ribbon-panel .rb-splitpair:has([data-command="home.fontColour"]) .rb-split-arrow').click();
    await page.locator('.menu .swatch[title="#ff0000"]').click();
    await page.locator('.ribbon-panel .rb-splitpair:has([data-command="home.highlight"]) .rb-split-arrow').click();
    await page.locator('.menu .swatch[title="#00ff00"]').click();
    p = await textProps(page, 'delta');
    expect(p['style:text-line-through-style']).toBe('solid');
    expect(p['fo:color']).toBe('#ff0000');
    expect(p['fo:background-color']).toBe('#00ff00');
    // The rendered text uses the formatting.
    const css = await page.locator('.ProseMirror span', { hasText: 'delta' }).last().evaluate((el) => getComputedStyle(el));
    expect(css).toBeTruthy();

    // Change case (Shift+F3 cycles) and clear character formatting (Ctrl+Space).
    await selectText(page, 'Alpha');
    await page.keyboard.press('Shift+F3');
    expect((await paras(page))[0]).toMatch(/^ALPHA /);
    await page.keyboard.press('Shift+F3');
    expect((await paras(page))[0]).toMatch(/^alpha /);
    await selectText(page, 'delta');
    await page.keyboard.press('Control+Space');
    expect(await textProps(page, 'delta')).toEqual({});
  });

  test('Font dialog: small caps, character spacing, underline style and colour', async ({ page }) => {
    await page.locator('.ProseMirror').click();
    await page.keyboard.type('Dialog text here');
    await selectText(page, 'text');
    await page.keyboard.press('Control+d');
    const dlg = page.getByRole('dialog', { name: 'Font' });
    await dlg.getByLabel('Small caps').check();
    await dlg.getByLabel('Underline style').selectOption('double');
    await dlg.getByRole('tab', { name: 'Advanced' }).click();
    await dlg.getByLabel('Spacing', { exact: true }).selectOption('expanded');
    await dlg.getByLabel('By', { exact: true }).first().fill('2 pt');
    await dlg.getByRole('button', { name: 'OK' }).click();
    const p = await textProps(page, 'text');
    expect(p['fo:font-variant']).toBe('small-caps');
    expect(p['style:text-underline-type']).toBe('double');
    expect(p['fo:letter-spacing']).toBe('2pt');
    const span = page.locator('.ProseMirror span', { hasText: 'text' }).last();
    await expect(span).toHaveCSS('font-variant-caps', 'small-caps');
    await expect(span).toHaveCSS('letter-spacing', /2\.6/);
  });

  test('paragraph controls, the Paragraph dialog, borders, shading and Show ¶', async ({ page }) => {
    await page.locator('.ProseMirror').click();
    await page.keyboard.type('First paragraph');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Second paragraph');
    await page.keyboard.press('Control+e');
    await expect(btn(page, 'home.alignCentre')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.ProseMirror p').nth(1)).toHaveCSS('text-align', 'center');
    await page.keyboard.press('Control+e'); // toggles back to left
    await expect(btn(page, 'home.alignLeft')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Control+j');
    await page.keyboard.press('Control+2');
    await page.keyboard.press('Control+m');
    const pp = () => page.evaluate(() => window.odtEditor.editor.getDoc().child(1).attrs.auto?.props?.['style:paragraph-properties']?.a || {});
    let a = await pp();
    expect(a['fo:text-align']).toBe('justify');
    expect(a['fo:line-height']).toBe('200%');
    expect(a['fo:margin-left']).toBe('1.27cm');
    await page.keyboard.press('Control+Shift+m');
    expect((await pp())['fo:margin-left']).toBe('0cm');

    // Borders ▾ Bottom Border, then Shading.
    await btn(page, 'home.borders').click();
    expect((await pp())['fo:border-bottom']).toMatch(/solid/);
    await run(page, 'home.shading', '#ffc000');
    expect((await pp())['fo:background-color']).toBe('#ffc000');

    // Paragraph dialog: spacing before/after and keep with next.
    await page.locator('.ribbon-panel [data-command="home.paragraphDialog"]').first().click();
    const dlg = page.getByRole('dialog', { name: 'Paragraph' });
    await dlg.getByRole('textbox', { name: 'Before' }).fill('6 pt');
    await dlg.getByRole('textbox', { name: 'After' }).fill('12 pt');
    await dlg.getByRole('tab', { name: 'Line and Page Breaks' }).click();
    await dlg.getByLabel('Keep with Next').check();
    await dlg.getByRole('button', { name: 'OK' }).click();
    a = await pp();
    expect(a['fo:margin-top']).toBe('6pt');
    expect(a['fo:margin-bottom']).toBe('12pt');
    expect(a['fo:keep-with-next']).toBe('always');

    // Tabs dialog with a dotted leader.
    await run(page, 'home.tabsDialog');
    const td = page.getByRole('dialog', { name: 'Tabs' });
    await td.getByLabel('Tab stop position').fill('5 cm');
    await td.getByLabel('Right tab').check();
    await td.getByLabel('.......').check();
    await td.getByRole('button', { name: 'Set' }).click();
    await td.getByRole('button', { name: 'OK' }).click();
    const stops = await page.evaluate(() => window.odtEditor.editor.getDoc().child(1).attrs.auto.props['style:paragraph-properties'].c[0].c[0].a);
    expect(stops).toMatchObject({ 'style:position': '5cm', 'style:type': 'right', 'style:leader-style': 'dotted' });

    // Show ¶ (Ctrl+Shift+8) shows pilcrows and space dots.
    await page.keyboard.press('Control+Shift+8');
    await expect(page.locator('.ProseMirror.show-marks')).toHaveCount(1);
    await expect(page.locator('.ProseMirror .odt-space').first()).toBeAttached();
    await page.keyboard.press('Control+Shift+8');
    await expect(page.locator('.ProseMirror.show-marks')).toHaveCount(0);

    // Clear paragraph formatting (Ctrl+Q).
    await page.keyboard.press('Control+q');
    expect(await pp()).toEqual({});
  });

  test('lists: autoformat, levels with Tab, labels, restart and toggling off', async ({ page }) => {
    await page.locator('.ProseMirror').click();
    await page.keyboard.type('* Apples');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Pears');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await page.keyboard.type('Conference');
    await expect(page.locator('.ProseMirror ul li')).toHaveCount(3);
    await expect(page.locator('.ProseMirror li li')).toHaveCount(1);
    await expect(page.locator('.ProseMirror li li')).toHaveAttribute('data-label', '◦');
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('.ProseMirror li li')).toHaveCount(0);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter'); // an empty item leaves the list
    await page.keyboard.type('1. One');
    await page.keyboard.press('Enter');
    await page.keyboard.type('two');
    await page.keyboard.press('Enter');
    await page.keyboard.type('three');
    const numbered = page.locator('.ProseMirror ol li');
    await expect(numbered).toHaveCount(3);
    await expect(numbered.nth(1)).toHaveAttribute('data-label', '2.');
    await expect(btn(page, 'home.numbering')).toHaveAttribute('aria-pressed', 'true');
    // Restart at 1 / Set Numbering Value on the third item.
    await run(page, 'home.restartNumbering');
    await expect(numbered.nth(2)).toHaveAttribute('data-label', '1.');
    await run(page, 'home.continueNumbering');
    await expect(numbered.nth(2)).toHaveAttribute('data-label', '3.');
    // A library preset: multilevel 1. / 1.1.
    await selectText(page, 'two');
    await run(page, 'home.multilevel', 0);
    await page.keyboard.press('Home');
    await page.keyboard.press('Tab');
    await expect(page.locator('.ProseMirror li li').first()).toHaveAttribute('data-label', '1.1.');
    // Bullets button applied twice toggles the list off.
    await selectText(page, 'Apples');
    await btn(page, 'home.bullets').click();
    expect(await page.evaluate(() => window.odtEditor.editor.getDoc().firstChild.type.name)).toBe('paragraph');
    const rt = await roundTrip(page, 'lists-m4.odt');
    expect(rt.same).toBe(true);
    expect(rt.content).toContain('text:continue-numbering="true"');
    expect(rt.content).toMatch(/<text:list-style style:name="L\d+">/);
  });

  test('styles: live gallery, shortcuts, Styles pane (new, modify, update to match, delete) saved to ODT', async ({ page }) => {
    await page.locator('.ProseMirror').click();
    await page.keyboard.type('Heading text');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Body text');
    await selectText(page, 'Heading');
    await page.locator('.gal-tile[data-gallery-item="heading1"]').click();
    expect(await page.evaluate(() => window.odtEditor.editor.getDoc().firstChild.type.name)).toBe('heading');
    await expect(page.locator('.gal-tile[data-gallery-item="heading1"]')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Control+Alt+2');
    expect(await page.evaluate(() => window.odtEditor.editor.getDoc().firstChild.attrs)).toMatchObject({ styleName: 'Heading_20_2', level: 2 });
    await page.keyboard.press('Control+Shift+n');
    expect(await page.evaluate(() => window.odtEditor.editor.getDoc().firstChild.attrs.styleName)).toBe('Standard');
    // Character style from the gallery.
    await selectText(page, 'Body');
    await page.locator('.gal-tile[data-gallery-item="strong"]').click();
    expect(await page.evaluate(() => window.odtEditor.editor.getDoc().child(1).firstChild.marks.map((m) => m.attrs.name))).toContain('Strong_20_Emphasis');

    // Styles pane: modify Normal through Update to Match: make text bold-coloured first.
    await page.keyboard.press('Control+Alt+Shift+s');
    const pane = page.locator('[data-pane="styles"]');
    await expect(pane).toBeVisible();
    await selectText(page, 'Heading text');
    await run(page, 'home.fontColour', '#123456');
    await pane.locator('.sp-row[data-style="Standard"] .sp-more').click({ force: true });
    await page.getByRole('menuitem', { name: /Update Normal to Match Selection|Update .* to Match Selection/ }).click();
    const std = await page.evaluate(() => {
      const t2 = window.odtEditor.session.state.commonStyles.c.find((x) => x.a?.['style:name'] === 'Standard' && x.a['style:family'] === 'paragraph');
      return t2.c.find((c) => c.n === 'style:text-properties')?.a['fo:color'];
    });
    expect(std).toBe('#123456');
    // Body text (also Normal) is now that colour, through the style.
    await expect(page.locator('.ProseMirror p').nth(1)).toHaveCSS('color', 'rgb(18, 52, 86)');

    // New style from formatting.
    await pane.getByRole('button', { name: 'New Style…' }).click();
    const dlg = page.getByRole('dialog', { name: 'Create New Style from Formatting' });
    await dlg.getByLabel('Name').fill('Callout');
    await dlg.getByLabel('Bold').check();
    await dlg.getByRole('button', { name: 'OK' }).click();
    expect(await page.evaluate(() => window.odtEditor.editor.getDoc().firstChild.attrs.styleName)).toBe('Callout');
    await expect(pane.locator('.sp-row[data-style="Callout"]')).toHaveClass(/is-active/);

    // Modify it: italic too.
    await pane.locator('.sp-row[data-style="Callout"] .sp-more').click({ force: true });
    await page.getByRole('menuitem', { name: 'Modify…' }).click();
    const md = page.getByRole('dialog', { name: 'Modify Style' });
    await md.getByLabel('Italic').check();
    await md.getByRole('button', { name: 'OK' }).click();
    await expect(page.locator('.ProseMirror p').first()).toHaveCSS('font-style', 'italic');

    const rt = await roundTrip(page, 'styles-m4.odt');
    expect(rt.same).toBe(true);
    expect(rt.styles).toMatch(/<style:style style:name="Callout" style:family="paragraph" style:parent-style-name="Standard"[^>]*>/);
    expect(rt.styles).toMatch(/style:name="Callout"[\s\S]*?fo:font-style="italic"/);

    // Delete the custom style: the paragraph returns to its parent.
    await pane.locator('.sp-row[data-style="Callout"] .sp-more').click({ force: true });
    await page.getByRole('menuitem', { name: /Delete "Callout"/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Yes' }).click();
    expect(await page.evaluate(() => window.odtEditor.editor.getDoc().firstChild.attrs.styleName)).toBe('Standard');
  });

  test('find: Navigation pane results, replace dialog with options, Go To', async ({ page }) => {
    await page.locator('.ProseMirror').click();
    await page.keyboard.type('The cat sat. A Cat ran. Concatenate cats.');
    await page.keyboard.press('Control+f');
    const nav = page.locator('[data-pane="navigation"]');
    await expect(nav).toBeVisible();
    await page.locator('.nav-search').fill('cat');
    await expect(nav.locator('.nav-status')).toHaveText('Result 1 of 4');
    await expect(nav.locator('.nav-result')).toHaveCount(4);
    await expect(page.locator('.ProseMirror .odt-find')).toHaveCount(4);
    await nav.locator('.nav-result').nth(2).click();
    expect(await page.evaluate(() => { const s = window.odtEditor.editor.view.state; return s.doc.textBetween(s.selection.from, s.selection.to); })).toBe('cat');

    // Replace: whole words + match case.
    await page.keyboard.press('Control+h');
    const fr = page.getByRole('dialog', { name: 'Find and Replace' });
    await fr.getByLabel('Find what').fill('cat');
    await fr.getByLabel('Replace with').fill('dog');
    await fr.getByLabel('Match case').check();
    await fr.getByLabel('Find whole words only').check();
    await fr.getByRole('button', { name: 'Replace All' }).click();
    await expect(fr.locator('.fr-status')).toHaveText('Made 1 replacement.');
    expect((await paras(page))[0]).toBe('The dog sat. A Cat ran. Concatenate cats.');
    // Regular expressions with groups, and one undo step.
    await fr.getByLabel('Match case').uncheck();
    await fr.getByLabel('Find whole words only').uncheck();
    await fr.getByLabel('Regular expressions').check();
    await fr.getByLabel('Find what').fill('(\\w+) ran');
    await fr.getByLabel('Replace with').fill('ran $1');
    await fr.getByRole('button', { name: 'Replace All' }).click();
    expect((await paras(page))[0]).toBe('The dog sat. A ran Cat. Concatenate cats.');
    // Wildcards: c?t* → word starting with c.t
    await fr.getByLabel('Use wildcards').check();
    await fr.getByLabel('Find what').fill('<c?ts>');
    await fr.getByLabel('Replace with').fill('felines');
    await fr.getByRole('button', { name: 'Replace All' }).click();
    expect((await paras(page))[0]).toBe('The dog sat. A ran Cat. Concatenate felines.');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+z');
    expect((await paras(page))[0]).toBe('The dog sat. A ran Cat. Concatenate cats.');

    // Replace with formatting.
    await page.keyboard.press('Control+h');
    await fr.getByLabel('Use wildcards').uncheck();
    await fr.getByLabel('Regular expressions').uncheck();
    await fr.getByLabel('Find what').fill('dog');
    await fr.getByLabel('Replace with').fill('dog');
    await fr.getByLabel('Replace formatting').selectOption('bold');
    await fr.getByRole('button', { name: 'Replace All' }).click();
    expect((await textProps(page, 'dog'))['fo:font-weight']).toBe('bold');
    // Find formatting: only the bold one.
    await fr.getByLabel('Find formatting').selectOption('bold');
    await fr.getByLabel('Find what').fill('d');
    await fr.getByRole('button', { name: 'Find Next' }).click();
    await expect(fr.locator('.fr-status')).toHaveText('Result 1 of 1');

    // Go To.
    await fr.getByRole('tab', { name: 'Go To' }).click();
    await fr.getByLabel('Enter number, name or +/−').fill('1');
    await fr.getByRole('button', { name: 'Go To' }).click();
    await expect(fr).toHaveCount(0);
  });

  test('Select ▾: similar formatting and objects; Format Painter; F4 repeat', async ({ page }) => {
    await page.locator('.ProseMirror').click();
    await page.keyboard.type('one two three four five');
    await selectText(page, 'two');
    await page.keyboard.press('Control+b');
    await selectText(page, 'four');
    await page.keyboard.press('F4'); // repeat bold
    expect((await textProps(page, 'four'))['fo:font-weight']).toBe('bold');
    await run(page, 'home.selectSimilar');
    const ranges = await page.evaluate(() => window.odtEditor.editor.view.state.selection.ranges.length);
    expect(ranges).toBe(2);
    await expect(page.locator('.ProseMirror .odt-multisel')).toHaveCount(2);
    await page.keyboard.press('Control+i'); // applies to both ranges
    expect((await textProps(page, 'two'))['fo:font-style']).toBe('italic');
    expect((await textProps(page, 'four'))['fo:font-style']).toBe('italic');

    await run(page, 'home.selectObjects');
    await expect(page.locator('.toast')).toContainText('no objects');

    // Format Painter: copy bold italic from "two" to "five".
    await selectText(page, 'two');
    await btn(page, 'home.formatPainter').click();
    await expect(page.locator('.ProseMirror.painter')).toHaveCount(1);
    const five = await page.evaluate(() => {
      const v = window.odtEditor.editor.view;
      let pos = 0;
      v.state.doc.descendants((n, p) => { if (n.isText && n.text.includes('five')) pos = p + n.text.indexOf('five') + 2; });
      const c = v.coordsAtPos(pos);
      return { x: c.left, y: (c.top + c.bottom) / 2 };
    });
    await page.mouse.click(five.x, five.y);
    await expect.poll(async () => (await textProps(page, 'five'))['fo:font-weight']).toBe('bold');
    expect((await textProps(page, 'five'))['fo:font-style']).toBe('italic');
    await expect(page.locator('.ProseMirror.painter')).toHaveCount(0);
  });

  test('AutoCorrect: quotes, dashes, symbols, capitals; Backspace undoes a correction', async ({ page }) => {
    await page.locator('.ProseMirror').click();
    await page.keyboard.type('"hello" it\'s a test -- really... (c) 2026. next one');
    expect((await paras(page))[0]).toBe('“Hello” it’s a test – really… © 2026. Next one');
    await page.keyboard.press('Enter');
    await page.keyboard.type('(tm)');
    await page.keyboard.press('Backspace');
    expect((await paras(page))[1]).toBe('(tm)');
  });

  test('paste options: keep source, merge and text only; floating Paste Options button', async ({ page }) => {
    await page.locator('.ProseMirror').click();
    await page.keyboard.type('Target ');
    const paste = (html) => page.evaluate((html) => {
      const dt = new DataTransfer();
      dt.setData('text/html', html);
      dt.setData('text/plain', html.replace(/<[^>]+>/g, ''));
      window.odtEditor.editor.view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, html);
    await paste('<b style="color:#ff0000">Red bold</b>');
    expect((await textProps(page, 'Red bold'))['fo:font-weight']).toBe('bold');
    await expect(page.locator('.paste-options')).toBeVisible();
    await page.locator('.paste-options').click();
    await page.getByRole('menuitem', { name: 'Keep Text Only' }).click();
    expect(await textProps(page, 'Red bold')).toEqual({});
    expect((await paras(page))[0]).toBe('Target Red bold');
    await page.locator('.paste-options').click();
    await page.getByRole('menuitem', { name: 'Merge Formatting' }).click();
    const merged = await textProps(page, 'Red bold');
    expect(merged['fo:font-weight']).toBe('bold');
    expect(merged['fo:color']).toBeUndefined();
  });

  test('mini-toolbar on selection and the context menu', async ({ page }) => {
    await page.locator('.ProseMirror').click();
    await page.keyboard.type('Select these words please');
    const p = page.locator('.ProseMirror p').first();
    const box = await p.boundingBox();
    await page.mouse.move(box.x + 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 90, box.y + box.height / 2, { steps: 4 });
    await page.mouse.up();
    const mini = page.locator('.mini-toolbar');
    await expect(mini).toBeVisible();
    await mini.locator('[data-command="home.bold"]').click();
    await expect(mini.locator('[data-command="home.bold"]')).toHaveClass(/is-checked/);
    await p.click({ button: 'right', position: { x: 20, y: 5 } });
    const menu = page.getByRole('menu').last();
    await expect(menu.getByRole('menuitem', { name: 'Font Settings' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Paragraph Settings' })).toBeVisible();
    await menu.getByRole('menuitem', { name: 'Paragraph Settings' }).click();
    await expect(page.getByRole('dialog', { name: 'Paragraph' })).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('Dictate is enabled only where speech recognition exists', async ({ page }) => {
    const supported = await page.evaluate(() => !!(window.SpeechRecognition || window.webkitSpeechRecognition));
    if (!supported) { await expect(btn(page, 'home.dictate')).toHaveAttribute('aria-disabled', 'true'); return; }
    await expect(btn(page, 'home.dictate')).not.toHaveAttribute('aria-disabled', 'true');
    expect(await page.evaluate(() => window.odtEditor.registry.isEnabled('home.dictate'))).toBe(true);
  });

  test('every formatting type survives an ODT round-trip and LibreOffice reads it', async ({ page }) => {
    test.setTimeout(180_000);
    await page.locator('.ProseMirror').click();
    const words = ['bold', 'italic', 'under', 'dbl', 'strike', 'sub', 'sup', 'border', 'outline', 'shadow', 'hilite', 'colour', 'font', 'size', 'caps', 'small', 'hidden', 'spaced'];
    await page.keyboard.type(`Words: ${words.join(' ')}.`);
    const fmt = {
      bold: ['home.bold'], italic: ['home.italic'], under: ['home.underline'], dbl: ['home.underlineDouble'], strike: ['home.strikethrough'],
      sub: ['home.subscript'], sup: ['home.superscript'], border: ['home.characterBorder'], outline: ['home.textOutline'], shadow: ['home.textShadow'],
      hilite: ['home.highlight', '#ffff00'], colour: ['home.fontColour', '#0070c0'], font: ['home.fontName', 'Liberation Mono'], size: ['home.fontSize', 16],
    };
    for (const [w, [id, ...args]] of Object.entries(fmt)) { await selectText(page, w); await run(page, id, ...args); }
    for (const [w, change] of [['caps', { 'fo:text-transform': 'uppercase' }], ['small', { 'fo:font-variant': 'small-caps' }], ['hidden', { 'text:display': 'none' }], ['spaced', { 'fo:letter-spacing': '0.1cm', 'style:text-scale': '120%' }]]) {
      await selectText(page, w);
      await page.evaluate((change) => {
        const v = window.odtEditor.editor.view;
        const type = v.state.schema.marks.textProps;
        const { from, to } = v.state.selection;
        v.dispatch(v.state.tr.addMark(from, to, type.create({ auto: { styleAttrs: {}, props: { 'style:text-properties': { a: change } } } })));
      }, change);
    }
    // Paragraph formatting.
    await page.evaluate(() => { const v = window.odtEditor.editor.view; v.dispatch(v.state.tr.setSelection(window.odtEditor.pm.TextSelection.atEnd(v.state.doc))); v.focus(); });
    const lines = ['Centred', 'Right', 'Justified', 'Spaced', 'Indented', 'Bordered', 'Shaded', 'Kept', 'Heading One', 'Quoted', 'Bullet item', 'Number item'];
    for (const l of lines) { await page.keyboard.press('Enter'); await page.keyboard.type(l); }
    const para = [['Centred', 'home.alignCentre'], ['Right', 'home.alignRight'], ['Justified', 'home.justify'], ['Spaced', 'home.lineSpacing15'], ['Indented', 'home.increaseIndent'],
      ['Bordered', 'home.borderAll'], ['Shaded', 'home.shading', '#d9d9d9'], ['Kept', 'home.keepWithNext'], ['Heading One', 'home.styleHeading1'], ['Quoted', 'home.applyStyle', 'quote'],
      ['Bullet item', 'home.bullets'], ['Number item', 'home.numbering']];
    for (const [l, id, ...args] of para) { await selectText(page, l); await run(page, id, ...args); }
    const rt = await roundTrip(page, 'formatting-m4.odt');
    expect(rt.same, 'model after re-opening').toBe(true);
    for (const attr of ['fo:font-weight="bold"', 'fo:font-style="italic"', 'style:text-underline-style="solid"', 'style:text-underline-type="double"',
      'style:text-line-through-style="solid"', 'style:text-position="sub 58%"', 'style:text-position="super 58%"', 'fo:border="0.5pt solid #000000"',
      'style:text-outline="true"', 'fo:text-shadow="1pt 1pt"', 'fo:background-color="#ffff00"', 'fo:color="#0070c0"', 'style:font-name="Liberation Mono"',
      'fo:font-size="16pt"', 'fo:text-transform="uppercase"', 'fo:font-variant="small-caps"', 'text:display="none"', 'fo:letter-spacing="0.1cm"',
      'fo:text-align="center"', 'fo:text-align="end"', 'fo:text-align="justify"', 'fo:line-height="150%"', 'fo:margin-left="1.27cm"',
      'fo:border-top="0.5pt solid #000000"', 'fo:background-color="#d9d9d9"', 'fo:keep-with-next="always"', 'text:outline-level="1"', 'text:style-name="Quote"',
      '<text:list ', 'text:bullet-char', 'style:num-format="1"']) {
      expect(rt.content.includes(attr) || rt.styles.includes(attr), attr).toBe(true);
    }
    expect(rt.content).toContain('<style:font-face style:name="Liberation Mono"');

    if (!soffice) return;
    const html = libreOfficeHtml(rt.file);
    expect(html, 'LibreOffice converted our file').toBeTruthy();
    for (const w of ['bold', 'italic', 'Centred', 'Heading One', 'Bullet item']) expect(html).toContain(w);
    expect(html).toMatch(/<b>[^<]*bold|font-weight: bold[^>]*>[^<]*bold/i);
    expect(html).toMatch(/<i>[^<]*italic|font-style: italic/i);
    expect(html).toMatch(/<sup>|vertical-align: super/i);
    expect(html).toMatch(/<sub>|vertical-align: sub/i);
    expect(html).toMatch(/#0070c0/i);
    expect(html).toMatch(/align="center"|text-align: center/i);
    expect(html).toMatch(/<h1/i);
    expect(html).toMatch(/<ul|<ol/i);
  });
});
