/**
 * M6: tables — Insert ▸ Table (grid, dialog, Quick Tables, Draw Table,
 * Convert Text ↔ Table), the Table Design and Table Layout contextual tabs,
 * mouse/ruler resizing, Tab navigation, repeated heading rows across pages,
 * nested tables, and ODT round-trips that LibreOffice reads back.
 */
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import path from 'node:path';
import { openApp } from './helpers.js';
import { readZipText } from '../lib/odf.mjs';

const OUT = path.resolve('test-results/tables');
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
const enabled = (page, id) => page.evaluate((id) => window.odtEditor.registry.isEnabled(id), id);
const checked = (page, id) => page.evaluate((id) => window.odtEditor.registry.isChecked(id), id);
const cellTexts = (page, sel = '.page-flow .ProseMirror > table') => page.evaluate((sel) => [...document.querySelector(sel).querySelectorAll(':scope > tbody > tr')].map((tr) => [...tr.children].map((td) => td.textContent)), sel);
const tableShape = (page) => page.evaluate(() => {
  const out = [];
  window.odtEditor.editor.view.state.doc.descendants((n) => { if (n.type.name === 'table') { out.push({ rows: n.childCount, cells: [...Array(n.childCount).keys()].map((i) => n.child(i).childCount) }); return false; } return true; });
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
    return { same: JSON.stringify(editor.getDoc().toJSON()) === JSON.stringify(b.doc.toJSON()), out: btoa(bin) };
  });
  const bytes = Buffer.from(r.out, 'base64');
  const file = path.join(OUT, name);
  writeFileSync(file, bytes);
  const zip = readZipText(new Uint8Array(bytes));
  return { ...r, file, content: zip['content.xml'], styles: zip['styles.xml'] };
}

/** LibreOffice opens our file and saves it again: returns its content.xml. */
function libreOfficeResave(file) {
  const dir = path.join(OUT, 'lo');
  execFileSync(soffice, [`-env:UserInstallation=file://${OUT}/lo-profile-${path.basename(file, '.odt')}`, '--headless', '--norestore', '--convert-to', 'odt', '--outdir', dir, file], { stdio: 'pipe', timeout: 120_000 });
  const out = path.join(dir, path.basename(file));
  if (!existsSync(out)) return null;
  return readZipText(new Uint8Array(readFileSync(out)))['content.xml'];
}

async function newTable(page, cols, rows) {
  await page.locator('.page-flow .ProseMirror').click();
  await run(page, 'insert.tableGrid', { cols, rows });
  await settled(page);
}

async function typeCells(page, values) {
  for (let i = 0; i < values.length; i++) {
    if (values[i]) await page.keyboard.type(values[i]);
    if (i < values.length - 1) await page.keyboard.press('Tab');
  }
}

/** Clicks into a cell and waits for the editor to take the new selection (it follows selectionchange). */
async function clickCell(locator) {
  const page = locator.page();
  const before = await page.evaluate(() => window.odtEditor.editor.view.state.selection.head);
  await locator.click();
  for (let i = 0; i < 20; i++) {
    if (await page.evaluate((b) => window.odtEditor.editor.view.state.selection.head !== b, before)) break;
    await page.waitForTimeout(25);
  }
  await page.waitForTimeout(30);
}

async function dialogOk(page) {
  await page.locator('.dlg button.primary').click();
  await expect(page.locator('.dlg')).toHaveCount(0);
}

test.describe('tables', () => {
  let problems;
  test.beforeEach(async ({ page }) => { problems = await openApp(page); });
  test.afterEach(() => {
    expect(problems.pageErrors).toEqual([]);
    expect(problems.consoleErrors).toEqual([]);
    expect(problems.networkRequests).toEqual([]);
  });

  test('grid insert, Tab navigation adds rows, contextual tabs, rows/columns, merge/split, delete', async ({ page }) => {
    await expect(page.locator('[role=tab][data-tab="tableDesign"]')).toBeHidden();
    await newTable(page, 3, 2);
    await expect(page.locator('[role=tab][data-tab="tableDesign"]')).toBeVisible();
    await expect(page.locator('[role=tab][data-tab="tableLayout"]')).toBeVisible();
    await typeCells(page, ['a', 'b', 'c', 'd', 'e', 'f']);
    await page.keyboard.press('Tab'); // last cell: adds a row
    await page.keyboard.type('g');
    expect(await cellTexts(page)).toEqual([['a', 'b', 'c'], ['d', 'e', 'f'], ['g', '', '']]);
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => window.odtEditor.editor.view.state.selection.$from.parent.textContent)).toBe('f');

    await run(page, 'tableLayout.insertAbove');
    await run(page, 'tableLayout.insertRight');
    expect(await tableShape(page)).toEqual([{ rows: 4, cells: [4, 4, 4, 4] }]);
    await run(page, 'tableLayout.deleteColumns');
    await run(page, 'tableLayout.deleteRows');
    expect(await tableShape(page)).toEqual([{ rows: 3, cells: [3, 3, 3] }]);

    // Merge the first row, then split it again.
    await clickCell(page.locator('.page-flow td').first());
    expect(await enabled(page, 'tableLayout.mergeCells')).toBe(false);
    await run(page, 'tableLayout.selectRow');
    expect(await enabled(page, 'tableLayout.mergeCells')).toBe(true);
    await run(page, 'tableLayout.mergeCells');
    expect(await tableShape(page)).toEqual([{ rows: 3, cells: [1, 3, 3] }]);
    const rt = await roundTrip(page, 'merged.odt');
    expect(rt.same).toBe(true);
    expect(rt.content).toContain('table:number-columns-spanned="3"');
    expect(rt.content).toContain('<table:covered-table-cell');
    if (soffice) {
      const lo = libreOfficeResave(rt.file);
      expect(lo).toContain('table:number-columns-spanned="3"');
    }
    expect(await run(page, 'tableLayout.splitCells')).toBe('pending');
    await page.locator('.dlg input').first().fill('3');
    await dialogOk(page);
    expect(await tableShape(page)).toEqual([{ rows: 3, cells: [3, 3, 3] }]);

    // Split table at row 2, then delete one table; undo restores it.
    await clickCell(page.locator('.page-flow table').first().locator('tr').nth(1).locator('td').first());
    await run(page, 'tableLayout.splitTable');
    expect((await tableShape(page)).length).toBe(2);
    await clickCell(page.locator('.page-flow td').first());
    await run(page, 'tableLayout.deleteTable');
    expect((await tableShape(page)).length).toBe(1);
    await page.keyboard.press('Control+z');
    expect((await tableShape(page)).length).toBe(2);
  });

  test('Insert Table dialog, Quick Tables, Convert Text ↔ Table, sort and formula', async ({ page }) => {
    await page.locator('.page-flow .ProseMirror').click();
    expect(await run(page, 'insert.insertTableDialog')).toBe('pending');
    const inputs = page.locator('.dlg input[type=number]');
    await inputs.nth(0).fill('4');
    await inputs.nth(1).fill('3');
    await dialogOk(page);
    expect(await tableShape(page)).toEqual([{ rows: 3, cells: [4, 4, 4] }]);
    await page.keyboard.press('Control+z');
    expect(await tableShape(page)).toEqual([]);

    await run(page, 'insert.quickTables', 'calendar');
    const shape = await tableShape(page);
    expect(shape.length).toBe(1);
    expect(shape[0].cells[0]).toBe(7);
    await page.keyboard.press('Control+z');

    // Text → table → text.
    await page.evaluate(() => {
      const v = window.odtEditor.editor.view;
      const s = v.state.schema;
      const paras = [['Pear', '3'], ['Apple', '10'], ['Fig', '2']].map(([a, b]) => s.node('paragraph', null, [s.text(a), s.node('tab'), s.text(b)]));
      v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, paras));
      v.dispatch(v.state.tr.setSelection(window.odtEditor.pm.TextSelection.create(v.state.doc, 1, v.state.doc.content.size - 1)));
      v.focus();
    });
    expect(await run(page, 'insert.convertTextToTable')).toBe('pending');
    await dialogOk(page);
    expect(await cellTexts(page)).toEqual([['Pear', '3'], ['Apple', '10'], ['Fig', '2']]);

    // Sort by column 2 as numbers, no heading row.
    expect(await run(page, 'tableLayout.sort')).toBe('pending');
    await page.locator('.dlg select').nth(0).selectOption('1');
    await page.locator('.dlg select').nth(1).selectOption('number');
    await page.locator('.dlg input[type=checkbox]').uncheck();
    await dialogOk(page);
    expect(await cellTexts(page)).toEqual([['Fig', '2'], ['Pear', '3'], ['Apple', '10']]);

    // A total row with =SUM(ABOVE).
    await clickCell(page.locator('.page-flow td').nth(5));
    await page.keyboard.press('End');
    await page.keyboard.press('Tab');
    await page.keyboard.type('Total');
    await page.keyboard.press('Tab');
    expect(await run(page, 'tableLayout.formula')).toBe('pending');
    await expect(page.locator('.dlg input').first()).toHaveValue('=SUM(ABOVE)');
    await dialogOk(page);
    expect((await cellTexts(page))[3]).toEqual(['Total', '15']);
    const rt = await roundTrip(page, 'formula.odt');
    expect(rt.same).toBe(true);
    expect(rt.content).toContain('table:formula="ooow:sum &lt;B1:B3&gt;"');
    expect(rt.content).toContain('office:value="15"');

    // Table → text.
    expect(await run(page, 'tableLayout.convertToText')).toBe('pending');
    await dialogOk(page);
    expect(await tableShape(page)).toEqual([]);
    expect(await page.evaluate(() => { const d = window.odtEditor.editor.view.state.doc; return d.textBetween(0, d.content.size, '\n', (n) => (n.type.name === 'tab' ? '\t' : '')); })).toContain('Fig\t2');
  });

  test('Table Design: styles, style options, shading, borders and the border painter', async ({ page }) => {
    await newTable(page, 3, 4);
    await typeCells(page, ['Item', 'Q1', 'Q2', 'Rent', '100', '200']);
    await run(page, 'tableDesign.tableStyle', 'gridBlue');
    await page.locator('[role=tab][data-tab="tableDesign"]').click();
    await expect(page.locator('.tbl-tile[data-gallery-item="gridBlue"]')).toHaveAttribute('aria-selected', 'true');
    await clickCell(page.locator('.page-flow td').nth(4));
    const headBg = () => page.evaluate(() => getComputedStyle(document.querySelector('.page-flow td')).backgroundColor);
    expect(await headBg()).not.toBe('rgba(0, 0, 0, 0)');
    expect(await checked(page, 'tableDesign.headerRow')).toBe(true);
    await run(page, 'tableDesign.headerRow');
    expect(await checked(page, 'tableDesign.headerRow')).toBe(false);
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('.page-flow td')).fontWeight)).not.toBe('700');
    await run(page, 'tableDesign.headerRow');
    await run(page, 'tableDesign.totalRow');
    expect(await checked(page, 'tableDesign.totalRow')).toBe(true);

    // Shading on the last row's first cell, borders with a thick red pen.
    await clickCell(page.locator('.page-flow tr').last().locator('td').first());
    await run(page, 'tableDesign.shading', '#ffcc00');
    await expect(page.locator('.page-flow tr').last().locator('td').first()).toHaveCSS('background-color', 'rgb(255, 204, 0)');
    await run(page, 'tableDesign.weight3');
    await run(page, 'tableDesign.penColour', '#c00000');
    await run(page, 'tableDesign.borderOutside');
    await expect(page.locator('.page-flow tr').last().locator('td').first()).toHaveCSS('border-left-color', 'rgb(192, 0, 0)');

    // Border painter paints the clicked edge.
    await run(page, 'tableDesign.borderPainter');
    expect(await checked(page, 'tableDesign.borderPainter')).toBe(true);
    const cell = page.locator('.page-flow tr').nth(1).locator('td').nth(1);
    const box = await cell.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + 2);
    await expect(cell).toHaveCSS('border-top-color', 'rgb(192, 0, 0)');
    await page.keyboard.press('Escape');
    expect(await checked(page, 'tableDesign.borderPainter')).toBe(false);

    const rt = await roundTrip(page, 'styled.odt');
    expect(rt.same).toBe(true);
    expect(rt.content).toContain('fo:background-color="#ffcc00"');
    expect(rt.content).toMatch(/fo:border(-left)?="3pt solid #c00000"/);
    expect(rt.content).toMatch(/table:template-name="[^"]+"/);
    if (soffice) {
      const lo = libreOfficeResave(rt.file);
      expect(lo).toContain('#ffcc00');
      expect(lo).toMatch(/#c00000/);
    }
  });

  test('Table Layout: properties, cell size spins, distribute, AutoFit, alignment, margins, direction', async ({ page }) => {
    await newTable(page, 3, 2);
    await page.keyboard.type('Long text in the first cell');
    await run(page, 'tableLayout.columnWidth', 3);
    await settled(page);
    const widths = () => page.evaluate(() => [...document.querySelectorAll('.page-flow table col')].map((c) => Math.round(c.getBoundingClientRect().width)));
    expect((await widths())[0]).toBe(Math.round(3 * 96 / 2.54));
    await run(page, 'tableLayout.distributeColumns');
    const w = await widths();
    expect(Math.max(...w) - Math.min(...w)).toBeLessThanOrEqual(1);
    await run(page, 'tableLayout.rowHeight', 2);
    await settled(page);
    expect(Math.round(await page.evaluate(() => document.querySelector('.page-flow tr').getBoundingClientRect().height))).toBeGreaterThanOrEqual(Math.round(2 * 96 / 2.54) - 1);
    await run(page, 'tableLayout.autoFitContents');
    await settled(page);
    const fit = await widths();
    expect(fit[0]).toBeGreaterThan(fit[1]);
    await run(page, 'tableLayout.autoFitWindow');
    await settled(page);
    const bodyW = await page.evaluate(() => window.odtEditor.docArea.model.first.bodyWidth);
    expect(Math.abs((await widths()).reduce((a, b) => a + b, 0) - bodyW)).toBeLessThan(3);

    await run(page, 'tableLayout.alignBottomRight');
    expect(await checked(page, 'tableLayout.alignBottomRight')).toBe(true);
    await expect(page.locator('.page-flow td').first()).toHaveCSS('vertical-align', 'bottom');
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('.page-flow td p')).textAlign)).toMatch(/^(end|right)$/);

    expect(await run(page, 'tableLayout.cellMargins')).toBe('pending');
    const m = page.locator('.dlg input');
    await m.nth(0).fill('0.5');
    await dialogOk(page);
    await expect(page.locator('.page-flow td').first()).toHaveCSS('padding-top', /^18\.(89|9)\d*px$/);

    expect(await run(page, 'tableLayout.properties')).toBe('pending');
    await page.locator('.dlg input[type=radio][value=center]').check();
    await dialogOk(page);
    const rt = await roundTrip(page, 'layout-props.odt');
    expect(rt.same).toBe(true);
    expect(rt.content).toContain('table:align="center"');
    expect(rt.content).toContain('style:vertical-align="bottom"');
    expect(rt.content).toMatch(/style:min-row-height="2(\.0+)?cm"/);
    if (soffice) {
      const lo = libreOfficeResave(rt.file);
      expect(lo).toContain('table:align="center"');
      expect(lo).toContain('style:vertical-align="bottom"');
    }
  });

  test('mouse resizing: column border drag and ruler column markers', async ({ page }) => {
    await newTable(page, 3, 2);
    const widths = () => page.evaluate(() => [...document.querySelectorAll('.page-flow table col')].map((c) => c.getBoundingClientRect().width));
    await page.waitForTimeout(600); // separate undo steps
    const before = await widths();
    const td = page.locator('.page-flow td').first();
    const b = await td.boundingBox();
    await page.mouse.move(b.x + b.width - 1, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width + 60, b.y + b.height / 2, { steps: 6 });
    await page.mouse.up();
    let after = await widths();
    expect(after[0] - before[0]).toBeGreaterThan(40);
    expect(Math.abs(after.reduce((x, y) => x + y) - before.reduce((x, y) => x + y))).toBeLessThan(2);

    // Ruler: one marker per column boundary; dragging the second moves the boundary.
    await clickCell(td);
    await page.waitForTimeout(600);
    await expect(page.locator('.ruler-tcol')).toHaveCount(4);
    const mk = await page.locator('.ruler-tcol').nth(1).boundingBox();
    await page.mouse.move(mk.x + mk.width / 2, mk.y + mk.height / 2);
    await page.mouse.down();
    await page.mouse.move(mk.x + mk.width / 2 - 76, mk.y + mk.height / 2, { steps: 6 });
    await page.mouse.up();
    const before2 = after;
    after = await widths();
    expect(before2[0] - after[0]).toBeGreaterThan(60);
    expect(after[1] - before2[1]).toBeGreaterThan(60);
    await page.keyboard.press('Control+z');
    expect(Math.round((await widths())[0])).toBe(Math.round(before2[0]));
  });

  test('rows split across pages and heading rows repeat; nested tables', async ({ page }) => {
    await newTable(page, 3, 70);
    await typeCells(page, ['Name', 'Value', 'Note']);
    await clickCell(page.locator('.page-flow td').first());
    await run(page, 'tableLayout.repeatHeader');
    expect(await checked(page, 'tableLayout.repeatHeader')).toBe(true);
    await settled(page);
    const pages = await page.evaluate(() => window.odtEditor.docArea.pages.length);
    expect(pages).toBeGreaterThan(1);
    await expect(page.locator('.repeat-copy')).toHaveCount(pages - 1);
    await expect(page.locator('.repeat-copy td').first()).toHaveText('Name');
    // The copy sits at the top of the next page's body, the first continued row just below it.
    const geo = await page.evaluate(() => {
      const { docArea, store } = window.odtEditor;
      const z = store.get().zoom / 100;
      const st = docArea.view.stack.getBoundingClientRect();
      const copy = document.querySelector('.repeat-copy').getBoundingClientRect();
      const p = docArea.pages[1];
      return { copyTop: (copy.top - st.top) / z, bodyTop: p.top + p.box.top };
    });
    expect(Math.abs(geo.copyTop - geo.bodyTop)).toBeLessThan(2);

    const rt = await roundTrip(page, 'header-rows.odt');
    expect(rt.same).toBe(true);
    expect(rt.content).toContain('<table:table-header-rows>');

    // Nested table inside the second row's first cell.
    await clickCell(page.locator('.page-flow tr').nth(1).locator('td').first());
    await run(page, 'insert.tableGrid', { cols: 2, rows: 2 });
    await page.keyboard.type('inner');
    expect(await page.locator('.page-flow td table').count()).toBe(1);
    const rt2 = await roundTrip(page, 'nested.odt');
    expect(rt2.same).toBe(true);
    expect(rt2.content.match(/<table:table[ >]/g)).toHaveLength(2);
    expect(rt2.content).toMatch(/<table:table-cell[^>]*><table:table[ >]/);
    if (soffice) {
      const lo = libreOfficeResave(rt2.file);
      expect(lo).toContain('<table:table-header-rows>');
      expect(lo).toContain('inner');
    }
  });

  test('Draw Table and Eraser', async ({ page }) => {
    await page.locator('.page-flow .ProseMirror').click();
    await page.keyboard.type('Before');
    await run(page, 'tableLayout.drawTable');
    expect(await page.evaluate(() => window.odtEditor.store.get().tableMode)).toBe('draw');
    const p = await page.locator('.page-flow .ProseMirror p').first().boundingBox();
    await page.mouse.move(p.x + 4, p.y + p.height - 2);
    await page.mouse.down();
    await page.mouse.move(p.x + 300, p.y + 80, { steps: 5 });
    await page.mouse.up();
    expect(await tableShape(page)).toEqual([{ rows: 1, cells: [1] }]);
    // Drawing a vertical line across the cell splits it into two columns.
    const c = await page.locator('.page-flow td').first().boundingBox();
    await page.mouse.move(c.x + c.width / 2, c.y + 4);
    await page.mouse.down();
    await page.mouse.move(c.x + c.width / 2 + 1, c.y + c.height - 4, { steps: 4 });
    await page.mouse.up();
    expect(await tableShape(page)).toEqual([{ rows: 1, cells: [2] }]);
    // The eraser merges across the clicked edge.
    await run(page, 'tableLayout.eraser');
    const c2 = await page.locator('.page-flow td').first().boundingBox();
    await page.mouse.click(c2.x + c2.width - 1, c2.y + c2.height / 2);
    expect(await tableShape(page)).toEqual([{ rows: 1, cells: [1] }]);
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => window.odtEditor.store.get().tableMode)).toBe(null);
  });
});
