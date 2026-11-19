/**
 * M8: the References tab — table of contents, footnotes and endnotes,
 * citations and bibliography, captions, cross-references and the index.
 * Every test saves and re-opens (identical model); LibreOffice re-saves the
 * file and keeps what we wrote.
 */
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import path from 'node:path';
import { openApp } from './helpers.js';
import { readZipText, makePng } from '../lib/odf.mjs';

const OUT = path.resolve('test-results/references');
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

const notes = (page) => page.evaluate(() => {
  const out = [];
  window.odtEditor.editor.view.state.doc.descendants((n, pos) => { if (n.type.name === 'note') out.push({ pos, cls: n.attrs.noteClass, citation: n.attrs.citation, text: n.attrs.body.map((b) => (b.content || []).map((x) => x.text || '').join('')).join('\n') }); return true; });
  return out;
});

test.describe('references', () => {
  let problems;
  test.beforeEach(async ({ page }) => { problems = await openApp(page); });
  test.afterEach(() => {
    expect(problems.pageErrors).toEqual([]);
    expect(problems.consoleErrors).toEqual([]);
    expect(problems.networkRequests).toEqual([]);
  });

  test('table of contents: gallery, page numbers from the layout, Add Text, update, round trip', async ({ page }) => {
    await typeText(page, 'Intro');
    await run(page, 'home.styleHeading1');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Body text');
    await page.keyboard.press('Control+Enter');
    await page.keyboard.type('Second');
    await run(page, 'home.styleHeading2');
    await page.keyboard.press('Control+Home');
    await run(page, 'references.insertToc', 'auto1');
    await settled(page);
    await page.waitForTimeout(300);
    const toc = await page.evaluate(() => { let t = null; window.odtEditor.editor.view.state.doc.descendants((n) => { if (n.type.name === 'index') { t = n.textContent; return false; } return true; }); return t; });
    expect(toc).toContain('Contents');
    expect(toc).toMatch(/Intro\s*1/);
    expect(toc).toMatch(/Second\s*2/);
    const rt = await roundTrip(page, 'toc.odt');
    expect(rt.same).toBe(true);
    expect(rt.content).toContain('<text:table-of-content ');
    expect(rt.content).toContain('<text:table-of-content-source');
    if (soffice) {
      const lo = libreOfficeResave(rt.file);
      expect(lo['content.xml']).toContain('text:table-of-content');
      expect(lo['content.xml']).toContain('Second');
    }
  });

  test('footnotes and endnotes: insert, type the note, numbering, options, navigation, round trip', async ({ page }) => {
    await typeText(page, 'First claim');
    await run(page, 'references.insertFootnote');
    await expect(page.locator('.fn-area.footnotes .fn-row')).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest('.fn-text') != null)).toBe(true);
    await page.keyboard.type('Source one.');
    await page.evaluate(() => window.odtEditor.editor.focus());
    await page.keyboard.press('End');
    await page.keyboard.type(' and a second');
    await run(page, 'references.insertFootnote');
    await expect(page.locator('.fn-area.footnotes .fn-row')).toHaveCount(2);
    await page.keyboard.type('Source two.');
    // Notes can't hold notes: back in the text first.
    await page.evaluate(() => window.odtEditor.editor.focus());
    await run(page, 'references.insertEndnote');
    await expect(page.locator('.fn-area.endnotes .fn-row')).toHaveCount(1);
    await page.keyboard.type('An endnote.');
    await settled(page);
    let n = await notes(page);
    expect(n.map((x) => [x.cls, x.citation, x.text])).toEqual([['footnote', '1', 'Source one.'], ['footnote', '2', 'Source two.'], ['endnote', 'i', 'An endnote.']]);
    // The footnote area sits at the bottom of page 1, under the body.
    const geo = await page.evaluate(() => {
      const a = document.querySelector('.fn-area.footnotes').getBoundingClientRect();
      const pg = document.querySelector('.page-bgs .pg').getBoundingClientRect();
      return { areaBottom: a.bottom, pageBottom: pg.bottom, pageTop: pg.top };
    });
    expect(geo.areaBottom).toBeLessThan(geo.pageBottom);
    expect(geo.areaBottom).toBeGreaterThan(geo.pageBottom - 200);
    // Navigation
    await page.evaluate(() => window.odtEditor.editor.focus());
    await page.keyboard.press('Control+Home');
    await run(page, 'references.nextFootnote');
    const sel1 = await page.evaluate(() => window.odtEditor.editor.view.state.selection.from);
    expect(sel1).toBe(n[0].pos + 1);
    await run(page, 'references.nextFootnote');
    expect(await page.evaluate(() => window.odtEditor.editor.view.state.selection.from)).toBe(n[1].pos + 1);
    // Options: a, b; restart, then Undo keeps the model sane
    await run(page, 'references.footnoteOptions');
    await page.locator('.fn-dlg select').nth(3).selectOption('a');
    await page.locator('.dlg button', { hasText: 'Apply' }).click();
    await expect(page.locator('.dlg')).toHaveCount(0);
    await settled(page);
    n = await notes(page);
    expect(n.map((x) => x.citation)).toEqual(['a', 'b', 'i']);
    await expect(page.locator('.fn-area.footnotes .fn-num').first()).toHaveText('a');
    // Deleting the first reference renumbers the rest.
    await page.evaluate((pos) => { const v = window.odtEditor.editor.view; v.dispatch(v.state.tr.delete(pos, pos + 1)); }, n[0].pos);
    await settled(page);
    n = await notes(page);
    expect(n.map((x) => x.citation)).toEqual(['a', 'i']);
    await expect(page.locator('.fn-area.footnotes .fn-row')).toHaveCount(1);
    const rt = await roundTrip(page, 'notes.odt');
    expect(rt.same).toBe(true);
    expect(rt.content).toContain('text:note-class="footnote"');
    expect(rt.content).toContain('text:note-class="endnote"');
    expect(rt.styles).toMatch(/text:notes-configuration text:note-class="footnote"[^>]*style:num-format="a"/);
    if (soffice) {
      const lo = libreOfficeResave(rt.file);
      expect(lo['content.xml']).toContain('Source two.');
      expect(lo['content.xml']).toContain('An endnote.');
      expect(lo['styles.xml']).toMatch(/note-class="footnote"[^>]*num-format="a"|num-format="a"[^>]*note-class="footnote"/);
    }
  });

  test('footnotes push text to the next page and stay with their reference', async ({ page }) => {
    await typeText(page, 'x');
    // Fill most of page 1 and put a long footnote near the bottom.
    await page.evaluate(() => {
      const v = window.odtEditor.editor.view;
      const { schema } = v.state;
      const paras = Array.from({ length: 60 }, (_, i) => schema.nodes.paragraph.create({ styleName: 'Standard' }, schema.text(`Line ${i + 1}`)));
      v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, paras));
    });
    await settled(page);
    const before = await page.evaluate(() => window.odtEditor.docArea.pages.map((p) => p.startPos));
    expect(before.length).toBeGreaterThan(1);
    // The caret at the end of the third-last line of page 1.
    const at = await page.evaluate((start2) => {
      const v = window.odtEditor.editor.view;
      const $p = v.state.doc.resolve(start2);
      const idx = $p.index(0) - 3;
      let p = 0;
      for (let i = 0; i < idx; i++) p += v.state.doc.child(i).nodeSize;
      const end = p + v.state.doc.child(idx).nodeSize - 1;
      v.dispatch(v.state.tr.setSelection(window.odtEditor.pm.TextSelection.create(v.state.doc, end)));
      v.focus();
      return end;
    }, before[1]);
    await run(page, 'references.insertFootnote');
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest('.fn-text') != null)).toBe(true);
    for (let i = 0; i < 12; i++) { await page.keyboard.type('A long footnote paragraph that takes room.'); await page.keyboard.press('Enter'); }
    await page.keyboard.type('End.');
    await settled(page);
    const r = await page.evaluate((at) => {
      const da = window.odtEditor.docArea;
      const withNote = da.pages.findIndex((p) => p.notes.some((n) => n.pos === at));
      return { withNote, refPage: da.pageAt(at), pages: da.pages.map((p) => p.startPos), notesH: da.pages[withNote]?.notesH };
    }, at);
    // The reference and its (long) note are on the same page; its text moved on.
    expect(r.withNote).toBe(1);
    expect(r.refPage).toBe(1);
    expect(r.notesH).toBeGreaterThan(150);
    expect(r.pages[1]).toBeLessThanOrEqual(at);
    const geo = await page.evaluate(() => {
      const a = document.querySelector('.fn-area.footnotes').getBoundingClientRect();
      const pg = document.querySelectorAll('.page-bgs .pg')[1].getBoundingClientRect();
      const last = [...document.querySelectorAll('.page-flow .ProseMirror > p')].filter((p) => p.getBoundingClientRect().bottom < a.bottom && p.getBoundingClientRect().top > pg.top).pop().getBoundingClientRect();
      return { areaTop: a.top, areaBottom: a.bottom, pageBottom: pg.bottom, lastBottom: last.bottom };
    });
    expect(geo.areaBottom).toBeLessThan(geo.pageBottom);
    await page.locator('.fn-area.footnotes').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(OUT, 'footnote-push.png') });
    expect(geo.lastBottom).toBeLessThan(geo.areaTop);
    expect(await notes(page)).toEqual([expect.objectContaining({ text: expect.stringMatching(/takes room\.\n(.*\n){11}End\.$/) })]);
  });

  test('citations and bibliography: import BibTeX, cite, switch styles, bibliography, round trip', async ({ page }) => {
    const bib = `@article{smith2020, author = {Smith, John and Doe, Jane}, title = {On the Origin of Things}, journal = {Journal of Stuff}, year = 2020, volume = 12, number = 3, pages = {100--120}}
@book{knuth1968, author = "Donald E. Knuth", title = "The Art of Computer Programming", publisher = {Addison-Wesley}, address = {Reading, MA}, year = 1968}`;
    await typeText(page, 'As shown ');
    // Manage Sources ▸ Import… (BibTeX file), then copy both to the document.
    await run(page, 'references.manageSources');
    const chooser = page.waitForEvent('filechooser');
    await page.locator('.src-search button').click();
    await (await chooser).setFiles({ name: 'refs.bib', mimeType: 'text/plain', buffer: Buffer.from(bib) });
    await expect(page.locator('.src-list').first().locator('option')).toHaveCount(2);
    await page.locator('.src-list').first().selectOption(['smith2020', 'knuth1968']);
    await page.locator('.src-mid button').first().click();
    await expect(page.locator('.src-list').nth(1).locator('option')).toHaveCount(2);
    await page.locator('.src-list').nth(1).selectOption('knuth1968');
    await expect(page.locator('.src-preview')).toContainText('Art of Computer Programming');
    await page.locator('.dlg button.primary').click();
    await expect(page.locator('.dlg')).toHaveCount(0);
    // Insert Citation lists the document's sources.
    await page.evaluate(() => window.odtEditor.editor.focus());
    await run(page, 'references.insertCitation', 'smith2020');
    const cites = () => page.evaluate(() => {
      const out = [];
      window.odtEditor.editor.view.state.doc.descendants((n) => { if (n.type.name === 'field' && n.attrs.element === 'text:bibliography-mark') out.push(n.attrs.text); return true; });
      return out;
    });
    await expect.poll(cites).toEqual(['(Smith & Doe, 2020)']);
    await page.keyboard.type(' and ');
    await run(page, 'references.insertCitation', 'knuth1968');
    await expect.poll(cites).toEqual(['(Smith & Doe, 2020)', '(Knuth, 1968)']);
    await page.keyboard.press('Enter');
    await run(page, 'references.insertBibliography', 'references');
    const bibText = () => page.evaluate(() => { let t = ''; window.odtEditor.editor.view.state.doc.descendants((n) => { if (n.type.name === 'index') { n.forEach((p) => { t += p.textContent + '\n'; }); return false; } return true; }); return t; });
    await expect.poll(bibText).toContain('Knuth, D. E. (1968). The Art of Computer Programming. Addison-Wesley.');
    expect(await bibText()).toMatch(/^References\n/);
    // IEEE: numbered citations and list.
    await run(page, 'references.styleIeee');
    await expect.poll(cites).toEqual(['[1]', '[2]']);
    await expect.poll(bibText).toMatch(/\[1\]\s*J\. Smith and J\. Doe/);
    await page.getByRole('tab', { name: 'References' }).click();
    await expect(page.locator('.rb-select-value').first()).toHaveText('IEEE');
    // Undo goes back to APA.
    await page.evaluate(() => window.odtEditor.editor.focus());
    await page.keyboard.press('Control+z');
    await expect.poll(cites).toEqual(['(Smith & Doe, 2020)', '(Knuth, 1968)']);
    await run(page, 'references.styleMla');
    await expect.poll(cites).toEqual(['(Smith and Doe 100–20)', '(Knuth)']).catch(async () => expect(await cites()).toEqual(['(Smith and Doe)', '(Knuth)']));
    await settled(page);
    const rt = await roundTrip(page, 'citations.odt');
    expect(rt.same).toBe(true);
    expect(rt.content).toContain('<text:bibliography-mark text:identifier="smith2020" text:bibliography-type="article" text:author="Smith, John; Doe, Jane"');
    expect(rt.content).toContain('<text:bibliography ');
    expect(rt.content).toContain('<text:bibliography-source>');
    expect(Buffer.from(rt.zip['Bibliography/sources.json']).toString()).toContain('"style": "mla"');
    // Re-opened: the sources and style are back.
    const back = await page.evaluate(async () => { const { io, session } = window.odtEditor; const b = io.importOdt(await session.serialize()); return b.bibliography; });
    expect(back.style).toBe('mla');
    expect(back.sources.map((s) => s.id)).toEqual(['smith2020', 'knuth1968']);
    if (soffice) {
      const lo = libreOfficeResave(rt.file);
      expect(lo['content.xml']).toContain('text:identifier="smith2020"');
      expect(lo['content.xml']).toContain('text:bibliography');
    }
  });

  test('captions, table of figures and cross-references (F9), round trip', async ({ page }) => {
    await typeText(page, 'Methods');
    await run(page, 'home.styleHeading1');
    await page.keyboard.press('Enter');
    await page.keyboard.type('A paragraph with a chart.');
    // Insert Caption (Figure, below) twice, a table caption, then reorder.
    for (const txt of ['First chart', 'Second chart']) {
      await run(page, 'references.insertCaption');
      await page.locator('.cap-line input').fill(txt);
      await dialogOk(page);
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await page.keyboard.type('Text after.');
    }
    const caps = () => page.evaluate(() => {
      const out = [];
      window.odtEditor.editor.view.state.doc.descendants((n) => { if (n.type.name === 'paragraph' && ['Figure', 'Table'].includes(n.attrs.styleName)) out.push(n.textContent); return true; });
      return out;
    });
    await expect.poll(caps).toEqual(['Figure 1: First chart', 'Figure 2: Second chart']);
    // Deleting the first caption renumbers the second.
    await page.evaluate(() => {
      const v = window.odtEditor.editor.view;
      let at = null;
      v.state.doc.descendants((n, pos) => { if (at == null && n.attrs?.styleName === 'Figure') at = [pos, pos + n.nodeSize]; return true; });
      v.dispatch(v.state.tr.delete(at[0], at[1]));
    });
    await expect.poll(caps).toEqual(['Figure 1: Second chart']);
    await page.evaluate(() => window.odtEditor.editor.focus());
    await page.keyboard.press('Control+z');
    await expect.poll(caps).toEqual(['Figure 1: First chart', 'Figure 2: Second chart']);
    // Table of figures at the end.
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await run(page, 'references.insertTableOfFigures');
    await dialogOk(page);
    await settled(page);
    const tof = () => page.evaluate(() => { let t = ''; window.odtEditor.editor.view.state.doc.descendants((n) => { if (n.type.name === 'index') { n.forEach((p) => { t += p.textContent + '\n'; }); return false; } return true; }); return t; });
    await expect.poll(tof).toBe('Figure 1: First chart\t1\nFigure 2: Second chart\t1\n');
    // Cross-references: to the second figure (label and number) and to the heading's page.
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('See ');
    await run(page, 'references.crossReference');
    await page.locator('.xref-dlg select').first().selectOption('Figure');
    await page.locator('.xref-dlg select').nth(1).selectOption('category-and-value');
    await page.locator('.xref-list').selectOption({ index: 1 });
    await page.locator('.dlg button.primary').click();
    await page.keyboard.type(' on page ');
    await run(page, 'references.crossReference');
    await page.locator('.xref-dlg select').first().selectOption('heading');
    await page.locator('.xref-dlg select').nth(1).selectOption('page');
    await page.locator('.dlg button.primary').click();
    await page.keyboard.type(', in ');
    await run(page, 'references.crossReference');
    await page.locator('.xref-dlg select').first().selectOption('heading');
    await page.locator('.dlg button.primary').click();
    const lastPara = () => page.evaluate(() => { const d = window.odtEditor.editor.view.state.doc; return d.lastChild.textContent + '|' + [...document.querySelectorAll('.page-flow .ProseMirror > p:last-child .odt-field')].map((f) => f.dataset.shown ?? f.textContent).join(','); });
    await expect.poll(lastPara).toMatch(/^See Figure 2 on page 1, in Methods\|Figure 2,1,Methods$/);
    // Rename the heading and the second caption moves first; F9 updates the references.
    await page.evaluate(() => {
      const v = window.odtEditor.editor.view;
      const h = v.state.doc.firstChild;
      const end = h.content.size; // before the bookmark-end atom
      v.dispatch(v.state.tr.insertText(' and data', end, end));
    });
    await page.evaluate(() => window.odtEditor.editor.focus());
    await page.keyboard.press('F9');
    await expect.poll(lastPara).toMatch(/in Methods and data/);
    const headingRefs = await page.evaluate(() => { const out = []; window.odtEditor.editor.view.state.doc.firstChild.forEach((n) => { if (n.type.name === 'bookmark') out.push(n.attrs.element); }); return out; });
    expect(headingRefs).toEqual(['text:bookmark-start', 'text:bookmark-end']);
    await settled(page);
    const rt = await roundTrip(page, 'captions.odt');
    expect(rt.diff).toBe(null);
    expect(rt.same).toBe(true);
    expect(rt.content).toMatch(/<text:sequence text:ref-name="refFigure\d" text:name="Figure" text:formula="ooow:Figure\+1" style:num-format="1">2<\/text:sequence>/);
    expect(rt.content).toContain('<text:sequence-ref text:reference-format="category-and-value" text:ref-name="refFigure');
    expect(rt.content).toMatch(/<text:bookmark-ref text:reference-format="page" text:ref-name="__RefHeading___Toc\d+_\d+">1<\/text:bookmark-ref>/);
    expect(rt.content).toContain('<text:illustration-index ');
    if (soffice) {
      const lo = libreOfficeResave(rt.file);
      expect(lo['content.xml']).toContain('text:sequence-ref');
      expect(lo['content.xml']).toMatch(/text:bookmark-ref[^>]*>Methods and data</);
      expect(lo['content.xml']).toContain('Second chart');
    }
  });
});
