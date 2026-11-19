/**
 * M9: the Review tab — track changes, comments, proofing, accessibility,
 * compare and restrict editing. Each test saves and re-opens (identical
 * model); LibreOffice re-saves the file and keeps what we wrote.
 */
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import path from 'node:path';
import { openApp } from './helpers.js';
import { readZipText, makePng } from '../lib/odf.mjs';

const OUT = path.resolve('test-results/review');
mkdirSync(OUT, { recursive: true });
const soffice = ['soffice', 'libreoffice'].find((bin) => spawnSync(bin, ['--version'], { timeout: 60_000 }).status === 0);

const run = (page, id, ...args) => page.evaluate(({ id, args }) => { const r = window.odtEditor.registry.run(id, ...args); return r instanceof Promise ? 'pending' : r; }, { id, args });
const body = (page) => page.locator('.page-flow > .odt-doc > .ProseMirror');
const frames = (page) => page.evaluate(() => {
  const out = [];
  window.odtEditor.editor.view.state.doc.descendants((n, pos) => { if (n.type.name === 'frame') out.push({ pos, ...n.attrs }); return true; });
  return out;
});
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

/** The body as text with [+inserted+] / [-deleted-] markup and ¶± for changed breaks. */
const marked = (page) => page.evaluate(() => {
  const out = [];
  window.odtEditor.editor.view.state.doc.forEach((p) => {
    let s = '';
    p.forEach((n) => {
      const m = n.marks.map((x) => x.type.name);
      const t = n.text ?? '';
      s += m.includes('deletion') ? `[-${t}-]` : m.includes('insertion') ? `[+${t}+]` : m.includes('formatChange') ? `[~${t}~]` : t;
    });
    out.push(s + (p.attrs.change ? (p.attrs.change.type === 'insertion' ? '¶+' : '¶-') : ''));
  });
  return out.join(' | ');
});

test.describe('review', () => {
  let problems;
  test.beforeEach(async ({ page }) => { problems = await openApp(page, { settings: { userName: 'Ada Reviewer', userInitials: 'AR' } }); });
  test.afterEach(() => {
    expect(problems.pageErrors).toEqual([]);
    expect(problems.consoleErrors).toEqual([]);
    expect(problems.networkRequests).toEqual([]);
  });

  test('track changes: record, display modes, reviewing pane, accept / reject, round trip', async ({ page }) => {
    await typeText(page, 'The quick brown fox jumps.');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Second line.');
    await page.keyboard.press('Control+Shift+E');
    await expect.poll(() => page.evaluate(() => window.odtEditor.store.get().editingMode)).toBe('reviewing');
    await expect(page.locator('[data-command="app.editingMode"]')).toContainText('Reviewing');
    // Insert, delete with Backspace, split a paragraph.
    await page.keyboard.press('Control+Home');
    for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.type('very ');
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
    for (let i = 0; i < 6; i++) await page.keyboard.press('Backspace');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('New paragraph.');
    expect(await marked(page)).toBe('The quick [+very +][-brown -]fox jumps.¶+ | [+New paragraph.+] | Second line.');
    // The text shows underlined / struck through in All Markup.
    const del = page.locator('.page-flow .tc-del').first();
    await expect(del).toHaveCSS('text-decoration-line', 'line-through');
    // Simple Markup hides the deleted text.
    await run(page, 'review.displaySimple');
    await expect(del).toBeHidden();
    await run(page, 'review.displayOriginal');
    await expect(page.locator('.page-flow .tc-ins').first()).toBeHidden();
    await run(page, 'review.displayAll');
    // Reviewing pane lists the revisions.
    await run(page, 'review.reviewingPane');
    await expect(page.locator('.rvp-item')).toHaveCount(3);
    await expect(page.locator('.rvp-item').first()).toContainText('Ada Reviewer');
    // Round trip and LibreOffice.
    const rt = await roundTrip(page, 'tracked.odt');
    expect(rt.diff).toBe(null);
    expect(rt.content).toContain('<text:tracked-changes text:track-changes="true">');
    expect(rt.content).toMatch(/<text:deletion><office:change-info><dc:creator>Ada Reviewer<\/dc:creator>/);
    if (soffice) {
      const lo = libreOfficeResave(rt.file);
      expect(lo['content.xml']).toContain('text:changed-region');
      expect(lo['content.xml']).toMatch(/<text:deletion>.*brown/);
      expect(lo['content.xml']).toContain('Ada Reviewer');
    }
    // Next / accept / reject.
    await page.evaluate(() => window.odtEditor.editor.focus());
    await page.keyboard.press('Control+Home');
    await run(page, 'review.nextChange');
    await run(page, 'review.acceptThis');
    expect(await marked(page)).toBe('The quick very [-brown -]fox jumps.¶+ | [+New paragraph.+] | Second line.');
    await run(page, 'review.nextChange');
    await run(page, 'review.rejectThis');
    expect(await marked(page)).toBe('The quick very brown fox jumps.¶+ | [+New paragraph.+] | Second line.');
    await run(page, 'review.rejectAll');
    expect(await marked(page)).toBe('The quick very brown fox jumps.New paragraph. | Second line.'.replace('jumps.New paragraph.', 'jumps.'));
    // Turning tracking off: edits are plain again.
    await page.keyboard.press('Control+Shift+E');
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' Done');
    expect(await marked(page)).toBe('The quick very brown fox jumps. | Second line. Done');
  });

  test('opening LibreOffice tracked changes shows them; Viewing mode is read-only', async ({ page }) => {
    const { openFixture } = await import('./helpers.js');
    await openFixture(page, 'lo-tracked-changes.odt');
    await settled(page);
    expect(await marked(page)).toContain('[+inserted text +]and a deletion here: [-removed words -]then');
    await expect(page.locator('.page-flow .tc-ins').first()).toHaveAttribute('title', 'Ada Reviewer');
    await run(page, 'review.markupPeople');
    await page.locator('.dlg label', { hasText: 'Ben Author' }).locator('input').uncheck();
    await page.locator('.dlg button.primary').click();
    await expect(page.locator('.page-flow .tc-del').first()).not.toHaveCSS('text-decoration-line', 'line-through');
    await run(page, 'app.modeViewing');
    await expect(page.locator('.page-flow .ProseMirror')).toHaveAttribute('contenteditable', 'false');
    await run(page, 'app.modeEditing');
    await expect(page.locator('.page-flow .ProseMirror')).toHaveAttribute('contenteditable', 'true');
  });

  test('comments: new, reply, resolve, previous/next, Comments pane, delete, round trip', async ({ page }) => {
    await typeText(page, 'The harbour opened at dawn. Boats came in.');
    // Select "harbour" and add a comment.
    await page.evaluate(() => { const v = window.odtEditor.editor.view; v.dispatch(v.state.tr.setSelection(window.odtEditor.pm.TextSelection.create(v.state.doc, 5, 12))); v.focus(); });
    await page.keyboard.press('Control+Alt+M');
    await expect(page.locator('.comments-layer .cmt-card')).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('.cmt-card'))).toBe(true);
    await page.keyboard.type('Which harbour?');
    await expect(page.locator('.cmt-card .cmt-who').first()).toHaveText('Ada Reviewer');
    await expect(page.locator('.page-flow .cmt-range')).toHaveText('harbour');
    // Reply.
    await page.locator('.cmt-card .cmt-reply').click();
    await expect(page.locator('.cmt-card .cmt-entry')).toHaveCount(2);
    await page.keyboard.type('The old one.');
    // A point comment later in the text.
    await page.evaluate(() => { const v = window.odtEditor.editor.view; v.dispatch(v.state.tr.setSelection(window.odtEditor.pm.TextSelection.atEnd(v.state.doc))); v.focus(); });
    await run(page, 'insert.comment');
    await expect(page.locator('.comments-layer .cmt-card')).toHaveCount(2);
    await page.keyboard.type('Add the time.');
    // Balloons don't overlap and sit right of the page.
    const boxes = await page.locator('.comments-layer .cmt-card').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
    const pg = await page.locator('.page-bgs .pg').first().boundingBox();
    expect(boxes[0].left).toBeGreaterThan(pg.x + pg.width);
    expect(boxes[1].top).toBeGreaterThanOrEqual(boxes[0].bottom);
    // Previous / Next.
    await page.evaluate(() => window.odtEditor.editor.focus());
    await run(page, 'review.previousComment');
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest('.cmt-card')?.textContent || '')).toContain('Which harbour?');
    // Resolve the first thread.
    await page.locator('.cmt-card').first().locator('.cmt-resolve').click();
    await expect(page.locator('.cmt-card').first()).toHaveClass(/is-resolved/);
    // List view: the Comments pane holds the cards.
    await page.locator('[data-command="app.commentsPane"]').click();
    await expect(page.locator('.cmt-pane .cmt-card')).toHaveCount(2);
    await expect(page.locator('.comments-layer')).toBeHidden();
    const rt = await roundTrip(page, 'comments.odt');
    expect(rt.diff).toBe(null);
    expect(rt.content).toMatch(/<office:annotation office:name="__Annotation__1" loext:resolved="true"><dc:creator>Ada Reviewer<\/dc:creator>/);
    expect(rt.content).toMatch(/<office:annotation office:name="__Annotation__\d" loext:parent-name="__Annotation__1"><dc:creator>Ada Reviewer/);
    expect(rt.content).toContain('<office:annotation-end office:name="__Annotation__1"/>');
    if (soffice) {
      const lo = libreOfficeResave(rt.file);
      expect(lo['content.xml']).toContain('Which harbour?');
      expect(lo['content.xml']).toContain('loext:parent-name="__Annotation__1"');
      expect(lo['content.xml']).toContain('loext:resolved="true"');
    }
    // Delete All Comments.
    await page.locator('.pane-x').last().click();
    await run(page, 'review.deleteAllComments');
    await expect(page.locator('.cmt-card')).toHaveCount(0);
    expect(await page.evaluate(() => window.odtEditor.editor.view.state.doc.textContent)).toBe('The harbour opened at dawn. Boats came in.');
  });
});
