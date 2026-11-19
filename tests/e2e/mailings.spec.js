/**
 * M11: the Mailings tab — recipient lists (CSV, XLSX, typed), merge fields,
 * address block, greeting line, rules, preview, merging, envelopes and labels.
 */
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import path from 'node:path';
import { openApp } from './helpers.js';
import { readZipText, makePng } from '../lib/odf.mjs';

const OUT = path.resolve('test-results/mailings');
mkdirSync(OUT, { recursive: true });
const soffice = ['soffice', 'libreoffice'].find((bin) => spawnSync(bin, ['--version'], { timeout: 60_000 }).status === 0);

const run = (page, id, ...args) => page.evaluate(({ id, args }) => { const r = window.odtEditor.registry.run(id, ...args); return r instanceof Promise ? 'pending' : r; }, { id, args });
const body = (page) => page.locator('.page-flow > .odt-doc > .ProseMirror');
const selected = (page) => page.evaluate(() => { const s = window.odtEditor.editor.view.state.selection; return s.node?.type.name === 'frame' ? s.node.attrs : null; });
const gp = (a) => a?.auto?.props?.['style:graphic-properties']?.a || {};

async function settled(page) {
  let last = '';
  for (let i = 0; i < 60; i++) {
    const [sig, pending] = await page.evaluate(() => [window.odtEditor.docArea.pages.map((p) => `${p.startPos}:${Math.round(p.top)}`).join(','), window.odtEditor.docArea.layoutPending]);
    if (sig === last && !pending) return;
    last = sig;
    await page.waitForTimeout(120);
  }
}

/** Saves, re-opens (model must match) and returns the package parts. */
async function roundTrip(page, name) {
  const r = await page.evaluate(async () => {
    const { session, editor, io } = window.odtEditor;
    const bytes = await session.serialize();
    const b = io.importOdt(bytes);
    let bin = '';
    for (const c of bytes) bin += String.fromCharCode(c);
    const A = JSON.stringify(editor.getDoc().toJSON());
    const B = JSON.stringify(b.doc.toJSON());
    let i = 0;
    while (i < A.length && A[i] === B[i]) i++;
    return { same: A === B, diff: A === B ? null : [A.slice(Math.max(0, i - 200), i + 200), B.slice(Math.max(0, i - 200), i + 200)], out: btoa(bin) };
  });
  const bytes = Buffer.from(r.out, 'base64');
  const file = path.join(OUT, name);
  writeFileSync(file, bytes);
  const zip = readZipText(new Uint8Array(bytes));
  return { ...r, file, zip, content: zip['content.xml'], styles: zip['styles.xml'] };
}

/** LibreOffice opens our file and saves it again: its package text parts. */
function libreOfficeResave(file) {
  const dir = path.join(OUT, 'lo');
  execFileSync(soffice, [`-env:UserInstallation=file://${OUT}/lo-profile-${path.basename(file, '.odt')}`, '--headless', '--norestore', '--convert-to', 'odt', '--outdir', dir, file], { stdio: 'pipe', timeout: 120_000 });
  const out = path.join(dir, path.basename(file));
  return existsSync(out) ? readZipText(new Uint8Array(readFileSync(out))) : null;
}

async function dialogOk(page) {
  await page.locator('.dlg button.primary').click();
  await expect(page.locator('.dlg')).toHaveCount(0);
  // The command finishes after the dialog closes.
  await page.waitForTimeout(80);
}

async function typeText(page, text) {
  await body(page).click();
  await page.keyboard.type(text);
}

import * as XLSX from 'xlsx';

const CSV = 'Title,First Name,Last Name,Company,Address Line 1,City,Postcode,Points\nMs,Ada,Lovelace,,12 Engine Street,London,N1 1AA,120\nMr,Charles,Babbage,Analytical Ltd,3 Gear Road,Cambridge,CB2 1TN,80\nDr,Grace,Hopper,,1 Harbour Way,Arlington,22201,95\n';
const docText = (page) => page.evaluate(() => { const o = []; window.odtEditor.editor.view.state.doc.forEach((b) => o.push(b.textContent)); return o; });
const shown = (page) => page.evaluate(() => [...document.querySelectorAll('.page-flow .odt-field')].map((f) => f.dataset.shown ?? f.textContent));

async function loadList(page, name, buffer) {
  const chooser = page.waitForEvent('filechooser');
  await run(page, 'mailings.useExistingList');
  await (await chooser).setFiles({ name, mimeType: 'application/octet-stream', buffer });
}

test.describe('mailings', () => {
  let problems;
  test.beforeEach(async ({ page }) => { problems = await openApp(page); });
  test.afterEach(() => {
    expect(problems.pageErrors).toEqual([]);
    expect(problems.consoleErrors).toEqual([]);
    expect(problems.networkRequests).toEqual([]);
  });

  test('letters: CSV list, recipients, address block, greeting, fields, rules, preview, merge, round trip', async ({ page }) => {
    await typeText(page, '');
    await loadList(page, 'people.csv', Buffer.from(CSV));
    await expect.poll(() => page.evaluate(() => window.odtEditor.session.state.mailMerge?.records.length)).toBe(3);
    // Untick Babbage in Edit Recipient List.
    await run(page, 'mailings.editRecipientList');
    await expect(page.locator('.mm-table tbody tr')).toHaveCount(3);
    await page.locator('.mm-table tbody tr', { hasText: 'Babbage' }).locator('input[type=checkbox]').uncheck();
    await page.locator('.dlg button.primary').click();
    // Address block, greeting, a field and an IF rule.
    await page.evaluate(() => window.odtEditor.editor.focus());
    await run(page, 'mailings.addressBlock');
    await expect(page.locator('.mm-preview')).toHaveText('Ada Lovelace\n12 Engine Street\nLondon\nN1 1AA');
    await page.locator('.dlg button.primary').click();
    await page.keyboard.press('Enter');
    await run(page, 'mailings.greetingLine');
    await page.locator('.dlg button.primary').click();
    await page.keyboard.press('Enter');
    await page.keyboard.type('You have ');
    await run(page, 'mailings.insertMergeField', 'Points');
    await page.keyboard.type(' points. ');
    await run(page, 'mailings.ruleIfThenElse');
    await page.locator('.dlg select').first().selectOption('Points');
    await page.locator('.dlg select').nth(1).selectOption('ge');
    await page.locator('.dlg input').nth(0).fill('100');
    await page.locator('.dlg input').nth(1).fill('Gold member!');
    await page.locator('.dlg input').nth(2).fill('Keep going.');
    await page.locator('.dlg button.primary').click();
    expect(await docText(page)).toEqual(['«First Name» «Last Name»\n«Company»\n«Address Line 1»\n«City»\n«Postcode»', 'Dear «First Name»,', 'You have «Points» points. Keep going.']);
    // Preview: record 1, then 2 (Babbage is unticked, so Hopper).
    await page.locator('[role=tab][data-tab="mailings"]').click();
    await run(page, 'mailings.previewResults');
    await expect.poll(() => shown(page)).toEqual(['Ada', 'Lovelace', '', '12 Engine Street', 'London', 'N1 1AA', 'Ada', '120', 'Gold member!']);
    await run(page, 'mailings.nextRecord');
    await expect(page.locator('.rb-number[data-command="mailings.recordNumber"]')).toHaveValue('2');
    await expect.poll(() => shown(page)).toEqual(['Grace', 'Hopper', '', '1 Harbour Way', 'Arlington', '22201', 'Grace', '95', 'Keep going.']);
    // Highlight merge fields.
    await run(page, 'mailings.highlightMergeFields');
    await expect(page.locator('.page-flow .ProseMirror')).toHaveClass(/mm-highlight/);
    // The document with its list saves and re-opens; LibreOffice keeps the database fields.
    const rt = await roundTrip(page, 'letter.odt');
    expect(rt.diff).toBe(null);
    expect(rt.content).toContain('<text:database-display text:table-name="Sheet1" text:table-type="table" text:database-name="people" text:column-name="First Name">«First Name»</text:database-display>');
    expect(rt.content).toContain('text:condition="ooow:[people.Sheet1.Points] &gt;= &quot;100&quot;"');
    expect(Buffer.from(rt.zip['MailMerge/recipients.json']).toString()).toContain('Lovelace');
    if (soffice) {
      const lo = libreOfficeResave(rt.file);
      expect(lo['content.xml']).toMatch(/text:database-display[^>]*text:column-name="Last Name"/);
      expect(lo['content.xml']).toContain('text:conditional-text');
    }
    // Finish & Merge ▸ Edit Individual Documents: two letters, the second on a new page.
    await run(page, 'mailings.editIndividual');
    await page.locator('.dlg button.primary').click();
    await page.locator('.dlg button', { hasText: 'Don’t Save' }).click();
    await expect.poll(() => docText(page)).toEqual(['Ada Lovelace\n12 Engine Street\nLondon\nN1 1AA', 'Dear Ada,', 'You have 120 points. Gold member!', 'Grace Hopper\n1 Harbour Way\nArlington\n22201', 'Dear Grace,', 'You have 95 points. Keep going.']);
    expect(await page.evaluate(() => window.odtEditor.docArea.pages.length)).toBe(2);
  });

  test('XLSX list, typed list, envelopes and labels', async ({ page }) => {
    await typeText(page, 'Letter.');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['First Name', 'Last Name', 'City'], ['Ada', 'Lovelace', 'London'], ['Alan', 'Turing', 'Wilmslow']]), 'Members');
    await loadList(page, 'members.xlsx', Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })));
    await expect.poll(() => page.evaluate(() => window.odtEditor.session.state.mailMerge?.table)).toBe('Members');
    expect(await page.evaluate(() => window.odtEditor.session.state.mailMerge.records[1])).toEqual(['Alan', 'Turing', 'Wilmslow']);
    // Type a New List.
    await run(page, 'mailings.typeNewList');
    await page.locator('.mm-table tbody input.mm-cell').nth(1).fill('Katherine');
    await page.locator('.mm-table tbody input.mm-cell').nth(2).fill('Johnson');
    await page.locator('.dlg button.primary').click();
    expect(await page.evaluate(() => window.odtEditor.session.state.mailMerge.records)).toEqual([['', 'Katherine', 'Johnson', '', '', '', '', '', '', '', '']]);
    // Envelopes: a DL envelope document.
    await run(page, 'mailings.envelopes');
    await page.locator('.mm-env textarea').first().fill('Ada Lovelace\n12 Engine Street\nLondon');
    await page.locator('.mm-env textarea').nth(1).fill('Babbage & Co\n3 Gear Road');
    await page.locator('.dlg button.primary').click();
    await page.locator('.dlg button', { hasText: 'Don’t Save' }).click();
    await expect.poll(() => docText(page)).toEqual(['Babbage & Co\n3 Gear Road', 'Ada Lovelace\n12 Engine Street\nLondon']);
    const pg = await page.locator('.page-bgs .pg').first().boundingBox();
    expect(pg.width).toBeGreaterThan(pg.height * 1.8);
    // Labels: a full sheet of L7160 (21 labels).
    await run(page, 'mailings.labels');
    await page.locator('.mm-env textarea').first().fill('Hello label');
    await page.locator('.dlg button.primary').click();
    await expect.poll(() => page.evaluate(() => { let n = 0; window.odtEditor.editor.view.state.doc.descendants((x) => { if (x.type.name === 'table_cell' && x.textContent === 'Hello label') n++; return true; }); return n; })).toBe(21);
    const rt = await roundTrip(page, 'labels.odt');
    expect(rt.diff).toBe(null);
  });

  test('Developer: content controls, properties, design mode, filling in forms, round trip with LibreOffice', async ({ page }) => {
    await typeText(page, 'Name: ');
    await run(page, 'developer.plainText');
    await page.keyboard.press('End');
    await page.keyboard.type(' Agree: ');
    await run(page, 'developer.checkBox');
    await page.keyboard.type(' Colour: ');
    await run(page, 'developer.dropDownList');
    await page.keyboard.press('End');
    await page.keyboard.type(' Date: ');
    await run(page, 'developer.datePicker');
    const ccs = () => page.evaluate(() => [...document.querySelectorAll('.page-flow .cc')].map((e) => `${e.dataset.kind}:${e.textContent}`));
    expect(await ccs()).toEqual(['plain:Click or tap here to enter text.', 'checkbox:☐', 'dropdown:Choose an item.', 'date:Click or tap to enter a date.']);
    // Clicking the placeholder selects it; typing replaces it and ends the placeholder.
    await page.locator('.page-flow .cc-plain').click();
    await page.keyboard.type('Ada Lovelace');
    await expect(page.locator('.page-flow .cc-plain')).toHaveText('Ada Lovelace');
    await expect(page.locator('.page-flow .cc-plain')).not.toHaveClass(/cc-placeholder/);
    // Check box toggles.
    await page.locator('.page-flow .cc-checkbox').click();
    await expect(page.locator('.page-flow .cc-checkbox')).toHaveText('☒');
    // Drop-down: add items in Properties, then choose one.
    await page.evaluate(() => { const v = window.odtEditor.editor.view; const el = document.querySelector('.page-flow .cc-dropdown'); const pos = v.posAtDOM(el, 0) + 1; v.dispatch(v.state.tr.setSelection(window.odtEditor.pm.TextSelection.create(v.state.doc, pos))); v.focus(); });
    await run(page, 'developer.properties');
    await page.locator('.cc-dlg input').first().fill('Favourite colour');
    for (const c of ['Red', 'Green', 'Blue']) { await page.locator('.cc-row input').first().fill(c); await page.locator('.cc-row button', { hasText: 'Add' }).click(); }
    await page.locator('.dlg button.primary').click();
    await page.locator('.page-flow .cc-dropdown').click();
    await page.locator('.menu .menu-item', { hasText: 'Green' }).click();
    await expect(page.locator('.page-flow .cc-dropdown')).toHaveText('Green');
    // Date picker.
    await page.locator('.page-flow .cc-date').click();
    await page.locator('.cc-date-input').fill('2026-03-05');
    await expect(page.locator('.page-flow .cc-date')).toHaveText('05/03/2026');
    // Design Mode shows titles.
    await run(page, 'developer.designMode');
    await expect(page.locator('.page-flow .ProseMirror')).toHaveClass(/cc-design/);
    await run(page, 'developer.designMode');
    // Restrict Editing: filling in forms — text outside controls can't change, inside can.
    await run(page, 'review.restrictEditing');
    await page.locator('.rst-pane input[type=checkbox]').check();
    await page.locator('.rst-pane select').selectOption('forms');
    await page.locator('.rst-pane button', { hasText: 'Start Enforcing' }).click();
    await page.evaluate(() => window.odtEditor.editor.focus());
    await page.keyboard.press('Control+Home');
    await page.keyboard.type('XX');
    expect(await page.evaluate(() => window.odtEditor.editor.view.state.doc.textContent.startsWith('Name: '))).toBe(true);
    await page.locator('.page-flow .cc-plain').click();
    await page.keyboard.press('End');
    await page.keyboard.type(' B');
    await expect(page.locator('.page-flow .cc-plain')).toContainText('Lovelace');
    await page.locator('.rst-pane button', { hasText: 'Stop Protection' }).click();
    const rt = await roundTrip(page, 'form.odt');
    expect(rt.diff).toBe(null);
    expect(rt.content).toMatch(/<loext:content-control loext:checkbox="true" loext:checked="true" loext:checked-state="☒" loext:unchecked-state="☐" loext:id="\d+">☒<\/loext:content-control>/);
    expect(rt.content).toMatch(/<loext:content-control loext:dropdown="true" loext:id="\d+" loext:alias="Favourite colour"><loext:list-item loext:display-text="Red" loext:value="Red"\/>/);
    if (soffice) {
      const lo = libreOfficeResave(rt.file);
      expect(lo['content.xml']).toMatch(/loext:content-control[^>]*loext:checkbox="true"/);
      expect(lo['content.xml']).toMatch(/loext:list-item loext:display-text="Green"/);
      expect(lo['content.xml']).toContain('05/03/2026');
    }
  });
});
