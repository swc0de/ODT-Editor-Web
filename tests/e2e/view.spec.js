/**
 * M12: the View tab — Read Mode, Web Layout, Outline (Outlining tab), Draft,
 * Focus, Immersive Reader, Navigation pane (drag headings, page thumbnails),
 * Switch Modes, New Window (kept in sync), Split, Side by Side with
 * Synchronous Scrolling, Switch Windows, Full Screen, templates.
 */
import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { openApp, APP_URL } from './helpers.js';
import { readZipText } from '../lib/odf.mjs';

const OUT = path.resolve('test-results/view');
mkdirSync(OUT, { recursive: true });

const run = (page, id, ...args) => page.evaluate(({ id, args }) => { const r = window.odtEditor.registry.run(id, ...args); return r instanceof Promise ? 'pending' : r; }, { id, args });
const body = (page) => page.locator('.page-flow > .odt-doc > .ProseMirror');
const blocks = (page) => page.evaluate(() => { const o = []; window.odtEditor.editor.view.state.doc.forEach((b) => o.push(`${b.type.name === 'heading' ? `H${b.attrs.level}` : 'P'}:${b.textContent}`)); return o; });
const pages = (page) => page.evaluate(() => window.odtEditor.docArea.pages.length);
/** Puts the caret in the textblock with this text. */
const caretIn = (page, text) => page.evaluate((text) => {
  const v = window.odtEditor.editor.view;
  let at = null;
  v.state.doc.descendants((n, pos) => { if (at == null && n.isTextblock && n.textContent === text) at = pos + 2; return at == null; });
  v.dispatch(v.state.tr.setSelection(window.odtEditor.pm.TextSelection.create(v.state.doc, at)));
  v.focus();
}, text);
/** Puts the caret in an element's text with a real mouse click. */
async function clickIn(page, locator) {
  const bb = await locator.boundingBox();
  await page.mouse.click(bb.x + 30, bb.y + bb.height / 2);
}

async function settled(page) {
  let last = '';
  for (let i = 0; i < 60; i++) {
    const [sig, pending] = await page.evaluate(() => [window.odtEditor.docArea.pages.map((p) => `${p.startPos}:${Math.round(p.top)}`).join(','), window.odtEditor.docArea.layoutPending]);
    if (sig === last && !pending) return;
    last = sig;
    await page.waitForTimeout(120);
  }
}

const PARA = 'The studio is open to members seven days a week. This handbook explains how the space works and how to book equipment so that everyone gets a fair turn. ';

/** Chapters with headings and body text (`n` chapters of `reps` sentences). */
async function sampleDoc(page, n = 3, reps = 6) {
  await page.evaluate(({ n, reps, para }) => {
    const { editor } = window.odtEditor;
    const view = editor.view;
    const { schema } = view.state;
    const H = (level, text) => schema.nodes.heading.create({ level, styleName: `Heading_20_${level}` }, schema.text(text));
    const P = (text) => schema.nodes.paragraph.create({ styleName: 'Standard' }, schema.text(text));
    const out = [];
    for (let s = 1; s <= n; s++) out.push(H(1, `Chapter ${s}`), P(para.repeat(reps)), H(2, `Section ${s}.1`), P(`Body ${s}.1`));
    out.push(P('End.'));
    const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, out);
    view.dispatch(tr);
    view.focus();
  }, { n, reps, para: PARA });
  await settled(page);
}

test.describe('view', () => {
  let problems;
  test.beforeEach(async ({ page }) => { problems = await openApp(page); });
  test.afterEach(() => {
    expect(problems.pageErrors).toEqual([]);
    expect(problems.consoleErrors).toEqual([]);
    expect(problems.networkRequests).toEqual([]);
  });

  test('Web Layout, Draft and Print Layout; Read Mode pages through screens', async ({ page }) => {
    await sampleDoc(page, 4, 30);
    expect(await pages(page)).toBeGreaterThan(2);
    await run(page, 'view.webLayout');
    await settled(page);
    expect(await pages(page)).toBe(1);
    await expect(page.locator('.doc-area')).toHaveClass(/flowing/);
    await expect(page.locator('.page-bgs')).toBeHidden();
    expect(await page.evaluate(() => document.querySelectorAll('.page-flow .pg-gap').length)).toBe(0);
    // Web Layout wraps to the window.
    const webW = await page.locator('.page-stack').evaluate((el) => el.getBoundingClientRect().width);
    expect(webW).toBeGreaterThan(1200);
    await expect(page.locator('.status-bar [data-view="view.webLayout"]')).toHaveClass(/is-checked/);
    await run(page, 'view.draft');
    await settled(page);
    const draftW = await page.locator('.page-stack').evaluate((el) => el.getBoundingClientRect().width);
    expect(draftW).toBeLessThan(800);
    await run(page, 'view.printLayout');
    await settled(page);
    expect(await pages(page)).toBeGreaterThan(2);
    await expect(page.locator('.page-bgs .pg').first()).toBeVisible();
    // Read Mode: columns of the window's height, paged sideways.
    await run(page, 'view.readMode');
    await expect(page.locator('.read-mode')).toBeVisible();
    await expect(page.locator('.read-mode .rm-doc')).toContainText('Chapter 4');
    const status = page.locator('.rm-status');
    await expect(status).toContainText(/Screen 1 of [2-9]/);
    await page.locator('.rm-arrow.next').click();
    await expect(status).toContainText('Screen 2 of');
    await page.keyboard.press('ArrowLeft');
    await expect(status).toContainText('Screen 1 of');
    // Column width and page colour.
    await page.locator('.rm-menu', { hasText: 'View' }).click();
    await page.locator('.menu .menu-item', { hasText: 'Page Colour: Sepia' }).click();
    await expect(page.locator('.read-mode')).toHaveAttribute('data-colour', 'sepia');
    await page.keyboard.press('Escape');
    await expect(page.locator('.read-mode')).toBeHidden();
    expect(await page.evaluate(() => window.odtEditor.store.get().view)).toBe('print');
  });

  test('Outline: levels, promote/demote, move, collapse, show level; headings survive a round trip', async ({ page }) => {
    await sampleDoc(page, 3, 1);
    await run(page, 'view.outline');
    await expect(page.locator('[role=tab][data-tab="outlining"]')).toBeVisible();
    await expect(page.locator('[role=tab][data-tab="outlining"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.page-flow .ol-mark-plus')).toHaveCount(6);
    // Show Level 1: only the chapter headings.
    await run(page, 'outlining.show1');
    await expect(page.locator('.page-flow .ol-item:not(.ol-hidden)')).toHaveCount(3);
    await run(page, 'outlining.showAll');
    // Collapse Chapter 2 by clicking its symbol, then move it up (with its content).
    const ch2 = page.locator('.page-flow h1', { hasText: 'Chapter 2' });
    await ch2.locator('.ol-mark').dispatchEvent('mousedown');
    await expect(ch2).toHaveClass(/ol-collapsed/);
    await expect(page.locator('.page-flow .ol-hidden')).toHaveCount(3);
    await caretIn(page, 'Chapter 2');
    // Up past the previous visible paragraph (with its collapsed content), then, at
    // Show Level 1, past Chapter 1's whole section.
    await run(page, 'outlining.moveUp');
    expect((await blocks(page)).slice(2, 5)).toEqual(['H2:Section 1.1', 'H1:Chapter 2', `P:${PARA}`]);
    await run(page, 'outlining.show1');
    await run(page, 'outlining.moveUp');
    await run(page, 'outlining.showAll');
    expect((await blocks(page)).slice(0, 4)).toEqual(['H1:Chapter 2', `P:${PARA}`, 'H2:Section 2.1', 'P:Body 2.1']);
    // Promote / demote: Section 1.1 to level 3, then body text, then back to Heading 1.
    await caretIn(page, 'Section 1.1');
    await run(page, 'outlining.demote');
    expect(await blocks(page)).toContain('H3:Section 1.1');
    await expect(page.locator('.rb-select[data-command="outlining.outlineLevel"] .rb-select-value')).toHaveText('Level 3');
    for (let i = 0; i < 6; i++) await run(page, 'outlining.demote');
    expect(await blocks(page)).toContain('H9:Section 1.1');
    await run(page, 'outlining.demoteToBody');
    expect(await blocks(page)).toContain('P:Section 1.1');
    await run(page, 'outlining.promoteToHeading1');
    expect(await blocks(page)).toContain('H1:Section 1.1');
    await run(page, 'outlining.demote');
    await run(page, 'outlining.demote');
    await run(page, 'outlining.demote');
    await run(page, 'outlining.demote');
    // Heading 5 didn't exist in the document: its style was added.
    expect(await page.evaluate(() => window.odtEditor.session.state.commonStyles.c.some((s) => s.a?.['style:name'] === 'Heading_20_5'))).toBe(true);
    // Show Text Formatting off, First Line Only on.
    await run(page, 'outlining.showFormatting');
    await expect(page.locator('.doc-area')).toHaveClass(/ol-plain/);
    await run(page, 'outlining.firstLineOnly');
    await expect(page.locator('.doc-area')).toHaveClass(/ol-first-line/);
    // Round trip keeps the outline levels.
    const levels = await page.evaluate(async () => {
      const { session, io } = window.odtEditor;
      const st = io.importOdt(await session.serialize());
      const o = [];
      st.doc.forEach((b) => { if (b.type.name === 'heading') o.push(`${b.attrs.level}:${b.textContent}`); });
      return o;
    });
    expect(levels).toContain('5:Section 1.1');
    await run(page, 'outlining.close');
    expect(await page.evaluate(() => window.odtEditor.store.get().view)).toBe('print');
    await expect(page.locator('[role=tab][data-tab="outlining"]')).toBeHidden();
  });

  test('Focus, Immersive Reader (syllables, line focus, spacing, colour), Switch Modes', async ({ page }) => {
    await sampleDoc(page, 2, 2);
    await run(page, 'view.focus');
    await expect(page.locator('.shell')).toHaveClass(/focus-mode/);
    await expect(page.locator('.status-bar')).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(page.locator('.shell')).not.toHaveClass(/focus-mode/);

    await run(page, 'view.immersiveReader');
    await expect(page.locator('[role=tab][data-tab="immersiveReader"]')).toHaveAttribute('aria-selected', 'true');
    await settled(page);
    await run(page, 'immersiveReader.col_narrow');
    await expect.poll(() => page.locator('.page-stack').evaluate((el) => Math.round(el.getBoundingClientRect().width))).toBe(540 + 48);
    await run(page, 'immersiveReader.syllables');
    await expect.poll(() => page.locator('.page-flow .ir-syl').count()).toBeGreaterThan(20);
    // "members" → mem·bers (the text itself is unchanged).
    expect(await page.evaluate(() => window.odtEditor.editor.view.state.doc.textContent.includes('·'))).toBe(false);
    await run(page, 'immersiveReader.textSpacing');
    await expect(page.locator('.doc-area')).toHaveClass(/ir-spacing/);
    await run(page, 'immersiveReader.colour_sepia');
    await expect(page.locator('.doc-area')).toHaveClass(/ir-coloured/);
    await body(page).click();
    await run(page, 'immersiveReader.focus_three');
    await expect(page.locator('.ir-mask-top')).toBeVisible();
    const gap = await page.evaluate(() => { const top = document.querySelector('.ir-mask-top').getBoundingClientRect(); const bottom = document.querySelector('.ir-mask-bottom').getBoundingClientRect(); return bottom.top - top.bottom; });
    expect(gap).toBeGreaterThan(40);
    expect(gap).toBeLessThan(140);
    await run(page, 'immersiveReader.close');
    await expect(page.locator('.ir-mask-top')).toBeHidden();
    expect(await page.locator('.page-flow .ir-syl').count()).toBe(0);

    // Switch Modes: dark pages in the dark theme.
    await run(page, 'view.switchModes');
    await expect(page.locator('.doc-area')).toHaveClass(/dark-page/);
    await run(page, 'view.switchModes');
    await expect(page.locator('.doc-area')).not.toHaveClass(/dark-page/);
  });

  test('Navigation pane: drag a heading to move its section; page thumbnails', async ({ page }) => {
    await sampleDoc(page, 3, 30);
    await run(page, 'view.navigationPane');
    const heads = page.locator('.nav-heading');
    await expect(heads).toHaveCount(6);
    await heads.filter({ hasText: 'Chapter 3' }).dragTo(heads.filter({ hasText: 'Chapter 1' }), { targetPosition: { x: 20, y: 2 } });
    expect((await blocks(page)).filter((b) => b.startsWith('H1'))).toEqual(['H1:Chapter 3', 'H1:Chapter 1', 'H1:Chapter 2']);
    expect((await blocks(page))[2]).toBe('H2:Section 3.1');
    // Right-click ▸ Demote.
    await page.locator('.nav-heading', { hasText: 'Chapter 2' }).click({ button: 'right' });
    await page.locator('.menu .menu-item', { hasText: 'Demote' }).click();
    expect(await blocks(page)).toContain('H2:Chapter 2');
    // Pages: rendered thumbnails of every page.
    await settled(page);
    const n = await pages(page);
    expect(n).toBeGreaterThan(2);
    await page.locator('.nav-tab', { hasText: 'Pages' }).click();
    await expect(page.locator('.nav-thumb')).toHaveCount(n);
    await expect(page.locator('.nav-thumb').first().locator('.nav-mirror')).toHaveCount(1);
    await expect(page.locator('.nav-thumb').first().locator('.nav-mirror')).toContainText('Chapter 3');
    await page.locator('.nav-thumb').nth(n - 1).click();
    await expect.poll(() => page.evaluate(() => window.odtEditor.docArea.canvas.scrollTop)).toBeGreaterThan(500);
  });

  test('New Window stays in sync both ways; Switch Windows, Side by Side with Synchronous Scrolling; Split', async ({ page, context }) => {
    await sampleDoc(page, 2, 30);
    const [win2] = await Promise.all([context.waitForEvent('page'), run(page, 'view.newWindow')]);
    const errs = [];
    win2.on('pageerror', (e) => errs.push(String(e)));
    win2.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await win2.waitForFunction(() => window.odtEditor?.editor.view.state.doc.textContent.includes('Chapter 2'), null, { timeout: 10000 });
    await expect.poll(() => page.title()).toContain('Document1:1');
    await expect.poll(() => win2.title()).toContain('Document1:2');
    // Typing in either window shows in the other.
    await win2.locator('.page-flow > .odt-doc > .ProseMirror').click();
    await win2.keyboard.press('Control+Home');
    await win2.keyboard.type('From two. ');
    await body(page).click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('From one.');
    const text = (p) => p.evaluate(() => window.odtEditor.editor.view.state.doc.textContent);
    await expect.poll(() => text(page)).toContain('From two. Chapter 1');
    await expect.poll(() => text(win2)).toContain('From one.');
    expect(await text(page)).toBe(await text(win2));
    // Page setup made in one window applies in the other.
    await run(win2, 'layout.landscape');
    await expect.poll(() => page.evaluate(() => Math.round(window.odtEditor.docArea.model.width))).toBe(1123);
    // Switch Windows lists both.
    await page.setViewportSize({ width: 2400, height: 900 });
    await page.locator('[role=tab][data-tab="view"]').click();
    await page.locator('.ribbon-panel[data-tab="view"] [data-command="view.switchWindows"]').click();
    await expect(page.locator('.menu [data-window]')).toHaveCount(2);
    await page.keyboard.press('Escape');
    // Side by Side pairs the windows and turns on Synchronous Scrolling.
    await run(page, 'view.sideBySide');
    await expect.poll(() => win2.evaluate(() => !!window.odtEditor.store.get().sideBySide)).toBe(true);
    expect(await page.evaluate(() => window.odtEditor.store.get().syncScroll)).toBe(true);
    await win2.evaluate(() => { window.odtEditor.docArea.canvas.scrollTop = 0; });
    await page.evaluate(() => { window.odtEditor.docArea.canvas.scrollTop = 0; });
    await page.waitForTimeout(200);
    await page.evaluate(() => window.odtEditor.docArea.canvas.scrollBy(0, 600));
    await expect.poll(() => win2.evaluate(() => window.odtEditor.docArea.canvas.scrollTop)).toBeGreaterThan(500);
    await run(page, 'view.synchronousScrolling');
    expect(await page.evaluate(() => window.odtEditor.store.get().syncScroll)).toBe(false);
    // Split: a second pane; typing there edits the document (and the other window).
    await run(page, 'view.split');
    await expect(page.locator('.split-pane')).toBeVisible();
    await page.locator('.split-doc .ProseMirror').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' Split pane.');
    await expect.poll(() => text(page)).toContain('Split pane.');
    await expect.poll(() => text(win2)).toContain('Split pane.');
    await expect(page.locator('.split-doc .ProseMirror')).toContainText('From two.');
    // Commands act on the pane being typed in.
    await page.keyboard.press('Shift+Home');
    await expect.poll(() => page.evaluate(() => { const s = window.odtEditor.registry.context().editor.view.state.selection; return s.to - s.from; })).toBeGreaterThan(5);
    await run(page, 'home.bold');
    expect(await page.evaluate(() => { let b = false; window.odtEditor.editor.view.state.doc.descendants((n) => { if (n.isText && n.text.includes('Split pane') && n.marks.some((m) => m.type.name === 'textProps' || m.type.name === 'strong')) b = true; }); return b; })).toBe(true);
    await run(page, 'view.split');
    await expect(page.locator('.split-pane')).toBeHidden();
    // Closing the second window leaves this one on its own.
    await win2.close();
    await expect.poll(() => page.title(), { timeout: 10000 }).not.toContain(':1');
    expect(errs).toEqual([]);
  });

  test('Full Screen; templates gallery and Save as Template (.ott)', async ({ page }) => {
    await run(page, 'view.fullScreen');
    await expect(page.locator('.shell')).toHaveClass(/full-screen/);
    await page.keyboard.press('Escape');
    await expect(page.locator('.shell')).not.toHaveClass(/full-screen/);
    await run(page, 'view.templates');
    await expect(page.locator('.backstage')).toBeVisible();
    await expect(page.locator('.tp-card')).toHaveCount(7);
    await page.locator('.tp-card[data-template="report"]').click();
    await expect(body(page)).toContainText('Community Garden Annual Report');
    // M15: Save as Template asks for Word Template (*.dotx, the default) or OpenDocument Template (*.ott).
    await run(page, 'file.saveAsTemplate');
    await expect(page.locator('.dlg button.primary')).toHaveText('Word Template (*.dotx)');
    const download = page.waitForEvent('download');
    await page.locator('.dlg button', { hasText: 'OpenDocument Template (*.ott)' }).click();
    const d = await download;
    expect(d.suggestedFilename()).toMatch(/\.ott$/);
    const file = path.join(OUT, d.suggestedFilename());
    await d.saveAs(file);
    const zip = readZipText(new Uint8Array(readFileSync(file)));
    expect(zip.mimetype).toBe('application/vnd.oasis.opendocument.text-template');
    // The document stays as it was (a template is a copy).
    expect(await page.evaluate(() => window.odtEditor.session.info.format)).toBe(null);
    const dotx = page.waitForEvent('download');
    await run(page, 'file.saveAsTemplate');
    await page.locator('.dlg button.primary').click();
    const d2 = await dotx;
    expect(d2.suggestedFilename()).toMatch(/\.dotx$/);
    const f2 = path.join(OUT, d2.suggestedFilename());
    await d2.saveAs(f2);
    expect(readZipText(new Uint8Array(readFileSync(f2)))['[Content_Types].xml']).toContain('wordprocessingml.template.main+xml');
    void APP_URL;
  });
});
