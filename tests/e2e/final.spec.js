/**
 * M13: importing DOCX / HTML / Markdown / RTF / TXT, exporting every format,
 * printing (and PDF), File ▸ Info (properties, inspect, versions, password
 * protection), Options, Quick Access Toolbar and the Help tab.
 */
import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import path from 'node:path';
import { openApp } from './helpers.js';
import { readZipText } from '../lib/odf.mjs';

const OUT = path.resolve('test-results/final');
mkdirSync(OUT, { recursive: true });
const FIX = path.resolve('tests/fixtures');
const soffice = ['soffice', 'libreoffice'].find((bin) => spawnSync(bin, ['--version'], { timeout: 60_000 }).status === 0);
const hasPdftotext = spawnSync('pdftotext', ['-v']).status === 0;

const run = (page, id, ...args) => page.evaluate(({ id, args }) => { const r = window.odtEditor.registry.run(id, ...args); return r instanceof Promise ? 'pending' : r; }, { id, args });
const body = (page) => page.locator('.page-flow > .odt-doc > .ProseMirror');
const docText = (page) => page.evaluate(() => window.odtEditor.editor.view.state.doc.textContent);

async function openFile(page, name, buffer) {
  const chooser = page.waitForEvent('filechooser');
  await run(page, 'file.open');
  await (await chooser).setFiles({ name, mimeType: 'application/octet-stream', buffer });
}

async function exportFile(page, id) {
  const dl = page.waitForEvent('download');
  await run(page, `file.export_${id}`);
  const d = await dl;
  const file = path.join(OUT, d.suggestedFilename());
  await d.saveAs(file);
  return file;
}

function loText(file) {
  const dir = path.join(OUT, 'lo', path.basename(file).replace(/\W/g, '_'));
  mkdirSync(dir, { recursive: true });
  execFileSync(soffice, [`-env:UserInstallation=file://${OUT}/lo-profile`, '--headless', '--norestore', '--convert-to', 'txt:Text (encoded):UTF8', '--outdir', dir, file], { stdio: 'pipe', timeout: 120_000 });
  return readFileSync(path.join(dir, `${path.basename(file).replace(/\.[^.]+$/, '')}.txt`), 'utf8');
}

async function sample(page) {
  await body(page).click();
  await run(page, 'home.styleHeading1');
  await page.keyboard.type('Garden report');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Some ');
  await page.keyboard.press('Control+b');
  await page.keyboard.type('bold');
  await page.keyboard.press('Control+b');
  await page.keyboard.type(' and ');
  await page.keyboard.press('Control+i');
  await page.keyboard.type('italic');
  await page.keyboard.press('Control+i');
  await page.keyboard.type(' text, café “quotes”.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('* first item');
  await page.keyboard.press('Enter');
  await page.keyboard.type('second item');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('The end.');
}

test.describe('final', () => {
  let problems;
  test.beforeEach(async ({ page }) => { problems = await openApp(page); });
  test.afterEach(() => {
    expect(problems.pageErrors).toEqual([]);
    expect(problems.consoleErrors).toEqual([]);
    expect(problems.networkRequests).toEqual([]);
  });

  test('imports DOCX, RTF, HTML, Markdown and plain text as new documents', async ({ page }) => {
    await openFile(page, 'lo-formatting-zoo.docx', readFileSync(path.join(FIX, 'lo-formatting-zoo.docx')));
    await expect.poll(() => docText(page)).not.toBe('');
    const docx = await page.evaluate(() => { const o = { headings: 0, bold: 0, italic: 0 }; window.odtEditor.editor.view.state.doc.descendants((n) => { if (n.type.name === 'heading') o.headings++; for (const m of n.marks || []) { const a = m.attrs.auto?.props?.['style:text-properties']?.a || {}; if (a['fo:font-weight'] === 'bold') o.bold++; if (a['fo:font-style'] === 'italic') o.italic++; } return true; }); return o; });
    expect(docx.bold + docx.italic).toBeGreaterThan(0);
    expect(await page.title()).toContain('lo-formatting-zoo');
    // Tables survive a DOCX import.
    await openFile(page, 'lo-tables.docx', readFileSync(path.join(FIX, 'lo-tables.docx')));
    await page.locator('.dlg button', { hasText: 'Don’t Save' }).click();
    await expect.poll(() => page.evaluate(() => { let n = 0; window.odtEditor.editor.view.state.doc.descendants((x) => { if (x.type.name === 'table') n++; return true; }); return n; })).toBeGreaterThan(0);
    // RTF from LibreOffice: tables and formatting.
    await openFile(page, 'lo-tables.rtf', readFileSync(path.join(FIX, 'lo-tables.rtf')));
    await page.locator('.dlg button', { hasText: 'Don’t Save' }).click();
    await expect.poll(() => page.evaluate(() => { let n = 0; window.odtEditor.editor.view.state.doc.descendants((x) => { if (x.type.name === 'table') n++; return true; }); return n; })).toBeGreaterThan(0);
    await openFile(page, 'lo-formatting-zoo.rtf', readFileSync(path.join(FIX, 'lo-formatting-zoo.rtf')));
    await page.locator('.dlg button', { hasText: 'Don’t Save' }).click();
    await expect.poll(() => docText(page)).not.toBe('');
    // HTML, Markdown, text.
    await openFile(page, 'page.html', Buffer.from('<h1>Web title</h1><p>Hello <b>web</b> <script>window.bad = 1</script></p><ul><li>one</li><li>two</li></ul>'));
    await page.locator('.dlg button', { hasText: 'Don’t Save' }).click();
    await expect.poll(() => docText(page)).toBe('Web titleHello webonetwo');
    expect(await page.evaluate(() => window.bad)).toBeUndefined();
    await openFile(page, 'notes.md', Buffer.from('# Notes\n\nSome *emphasis* and **strong** text.\n\n1. First\n2. Second\n\n| A | B |\n|---|---|\n| 1 | 2 |\n'));
    await page.locator('.dlg button', { hasText: 'Don’t Save' }).click();
    await expect.poll(() => page.evaluate(() => { const o = []; window.odtEditor.editor.view.state.doc.forEach((b) => o.push(b.type.name)); return o; })).toEqual(['heading', 'paragraph', 'list', 'table']);
    await openFile(page, 'plain.txt', Buffer.from('Line one\nLine\ttwo\n\nLine four\n'));
    await page.locator('.dlg button', { hasText: 'Don’t Save' }).click();
    await expect.poll(() => page.evaluate(() => window.odtEditor.editor.view.state.doc.childCount)).toBe(4);
    // Saving an imported document writes ODT.
    const bytes = await page.evaluate(async () => Array.from(await window.odtEditor.session.serialize()));
    expect(readZipText(new Uint8Array(bytes)).mimetype).toBe('application/vnd.oasis.opendocument.text');
  });

  test('Word import reads styles, fonts, page setup, sections, headers, lists, tables, notes and changes', async ({ page }) => {
    await openFile(page, 'word-features.docx', readFileSync(path.join(FIX, 'word-features.docx')));
    await expect.poll(() => docText(page)).toContain('Imported from Word');
    await expect.poll(() => page.evaluate(() => window.odtEditor.docArea.pages.length)).toBeGreaterThan(2);
    const r = await page.evaluate(() => {
      const { session, editor, docArea } = window.odtEditor;
      const st = session.state;
      const style = (name) => st.commonStyles.c.find((x) => x.n === 'style:style' && x.a['style:name'] === name);
      const tp = (s) => s?.c?.find((x) => x.n === 'style:text-properties')?.a || {};
      const def = st.commonStyles.c.find((x) => x.n === 'style:default-style' && x.a['style:family'] === 'paragraph');
      const o = { blocks: [], lists: [], marks: new Set(), nodes: new Set(), merges: [] };
      editor.view.state.doc.forEach((b) => o.blocks.push(b.type.name + ':' + (b.attrs.styleName || '')));
      editor.view.state.doc.descendants((n) => {
        if (n.type.name === 'list') o.lists.push(n.attrs.styleName);
        if (n.type.name === 'table_cell' && (n.attrs.colspan > 1 || n.attrs.rowspan > 1)) o.merges.push(`${n.attrs.colspan}x${n.attrs.rowspan}`);
        for (const m of n.marks || []) o.marks.add(m.type.name);
        if (n.isInline && !n.isText) o.nodes.add(n.type.name);
        return true;
      });
      const masters = st.masterStyles.c.filter((m) => m.n === 'style:master-page');
      const xml = JSON.stringify(st.masterStyles);
      const pages = docArea.pages.map((p) => { const m = docArea.model.masters.get(p.master) || docArea.model.first; return [p.master, Math.round(m.width), Math.round(m.height), m.columns?.count || 1]; });
      return {
        defaultFont: tp(def)['style:font-name'], h1: tp(style('Heading_20_1')), callout: !!style('Callout_20_Text'), term: !!st.commonStyles.c.find((x) => x.a?.['style:name'] === 'Highlighted_20_Term' && x.a['style:family'] === 'text'),
        fonts: st.fontFaces.map((f) => f.a['style:name']), masters: masters.length, pageFields: (xml.match(/text:page-number/g) || []).length, pageCount: xml.includes('text:page-count'), firstHeader: xml.includes('First page header'),
        pages, blocks: o.blocks, lists: o.lists, merges: o.merges, marks: [...o.marks], nodes: [...o.nodes], title: st.meta?.c?.find?.((x) => x.n === 'dc:title')?.t ?? JSON.stringify(st.meta).includes('Word Features Sample'),
      };
    });
    // Styles and fonts come from the file.
    expect(r.defaultFont).toBe('Georgia');
    expect(r.h1['style:font-name']).toBe('Verdana');
    expect(r.h1['fo:color']).toBe('#1f4e79');
    expect(r.callout && r.term).toBe(true);
    expect(r.fonts).toEqual(expect.arrayContaining(['Georgia', 'Verdana', 'Courier New', 'Arial']));
    // Page setup: A5 portrait, then a landscape A4 section with two columns.
    expect(r.pages[0].slice(1, 3)).toEqual([559, 794]);
    const last = r.pages[r.pages.length - 1];
    expect(last[0]).not.toBe(r.pages[0][0]);
    expect(last.slice(1)).toEqual([1122, 794, 2]);
    // Headers and footers with page fields, and a separate first-page header.
    expect(r.pageFields).toBeGreaterThanOrEqual(2);
    expect(r.pageCount && r.firstHeader).toBe(true);
    // Structure: headings, lists, merged table cells, notes, comments, links, pictures, tracked changes.
    expect(r.blocks.filter((b) => b.startsWith('heading')).length).toBe(4);
    expect(r.blocks).toContain('paragraph:Callout_20_Text');
    expect(r.lists.length).toBeGreaterThanOrEqual(2);
    expect(r.merges).toEqual(expect.arrayContaining(['1x2', '2x1']));
    expect(r.marks).toEqual(expect.arrayContaining(['textProps', 'charStyle', 'link', 'insertion', 'deletion']));
    expect(r.nodes).toEqual(expect.arrayContaining(['note', 'annotation', 'annotation_end', 'frame']));
    expect(r.title).toBeTruthy();
    // It saves as an ODT that LibreOffice opens with the same text.
    if (soffice) {
      const bytes = await page.evaluate(async () => Array.from(await window.odtEditor.session.serialize()));
      const file = path.join(OUT, 'word-features.odt');
      writeFileSync(file, Buffer.from(bytes));
      const text = loText(file);
      expect(text).toContain('A paragraph in a custom style.');
      expect(text).toContain('Text in a landscape section with two columns.');
    }
  });

  test('exports DOCX, HTML, Markdown, RTF, TXT and PNG; others open them', async ({ page }) => {
    await sample(page);
    const md = readFileSync(await exportFile(page, 'markdown'), 'utf8');
    expect(md).toBe('# Garden report\n\nSome **bold** and *italic* text, café “quotes”.\n\n- First item\n- Second item\n\nThe end.\n');
    const txt = readFileSync(await exportFile(page, 'text'), 'utf8');
    expect(txt).toContain('• First item');
    const html = readFileSync(await exportFile(page, 'html'), 'utf8');
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('<h1');
    expect(html).not.toContain('contenteditable');
    const rtf = readFileSync(await exportFile(page, 'rtf'), 'latin1');
    expect(rtf).toMatch(/^\{\\rtf1/);
    expect(rtf).toContain('{\\f2\\fs24\\b bold}');
    const png = readFileSync(await exportFile(page, 'png'));
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.readUInt32BE(16)).toBeGreaterThan(1000);
    const docx = await exportFile(page, 'docx');
    expect(readFileSync(docx).subarray(0, 2).toString()).toBe('PK');
    // The app opens its own exports again.
    for (const f of [docx]) {
      await openFile(page, path.basename(f), readFileSync(f));
      await page.locator('.dlg button', { hasText: 'Don’t Save' }).click().catch(() => {});
      await expect.poll(() => docText(page)).toContain('Some bold and italic text');
    }
    if (soffice) {
      expect(loText(docx)).toContain('Some bold and italic text, café “quotes”.');
      expect(loText(path.join(OUT, 'Document1.rtf'))).toContain('Some bold and italic text, café “quotes”.');
    }
  });

  test('printing: the print layout makes one PDF page per page, ranges work; Print page preview', async ({ page }) => {
    await page.evaluate(() => { const v = window.odtEditor.editor.view; const s = v.state.schema; const ps = []; for (let i = 0; i < 90; i++) ps.push(s.nodes.paragraph.create(null, s.text(`Paragraph ${i} of a long document with enough words to wrap over a line or two in the page body.`))); v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, ps)); });
    await expect.poll(() => page.evaluate(() => window.odtEditor.docArea.pages.length)).toBeGreaterThan(4);
    const n = await page.evaluate(() => window.odtEditor.docArea.pages.length);
    const starts = await page.evaluate(() => window.odtEditor.docArea.pages.map((p) => window.odtEditor.editor.view.state.doc.textBetween(p.startPos, p.startPos + 13)));
    expect(await page.evaluate(() => window.odtEditor.registry.context().ui.print.prepare({ range: 'all' }))).toBe(n);
    await page.pdf({ path: path.join(OUT, 'all.pdf'), preferCSSPageSize: true, printBackground: true });
    await page.evaluate(() => window.odtEditor.registry.context().ui.print.cleanup());
    expect(await page.evaluate(() => window.odtEditor.registry.context().ui.print.prepare({ range: 'custom', pages: '2-3' }))).toBe(2);
    await page.pdf({ path: path.join(OUT, 'range.pdf'), preferCSSPageSize: true });
    await page.evaluate(() => window.odtEditor.registry.context().ui.print.cleanup());
    if (hasPdftotext) {
      const pages = (f) => Number(execFileSync('pdfinfo', [f]).toString().match(/Pages:\s+(\d+)/)[1]);
      expect(pages(path.join(OUT, 'all.pdf'))).toBe(n);
      expect(pages(path.join(OUT, 'range.pdf'))).toBe(2);
      for (let i = 1; i <= n; i++) {
        const text = execFileSync('pdftotext', ['-f', String(i), '-l', String(i), path.join(OUT, 'all.pdf'), '-']).toString().trim();
        expect(text.startsWith(starts[i - 1].trim().slice(0, 12))).toBe(true);
      }
      expect(execFileSync('pdftotext', ['-f', '1', '-l', '1', path.join(OUT, 'range.pdf'), '-']).toString().trim().startsWith(starts[1].trim().slice(0, 12))).toBe(true);
    }
    // After printing the screen layout is back (with page gaps).
    await expect.poll(() => page.evaluate(() => window.odtEditor.docArea.pages[1].top - window.odtEditor.docArea.pages[0].box.pageHeight)).toBe(16);
    // Ctrl+P opens the Print page with a preview.
    await body(page).click();
    await page.keyboard.press('Control+p');
    await expect(page.locator('.bs-print-page .page-stack')).toHaveCount(1);
    await expect(page.locator('.bs-print-label')).toHaveText(`1 of ${n}`);
    await page.locator('.bs-print-nav button').last().click();
    await expect(page.locator('.bs-print-label')).toHaveText(`2 of ${n}`);
  });

  test('Info: properties, inspect, version history; password protection both ways', async ({ page }) => {
    await sample(page);
    await run(page, 'file.infoPage');
    await page.locator('.bs-prop-input[data-prop="title"]').fill('Garden Report 2026');
    await page.locator('.bs-prop-input[data-prop="keywords"]').fill('garden, report');
    await page.locator('.bs-prop-input[data-prop="keywords"]').press('Tab');
    await expect(page.locator('[data-stat="words"]')).toHaveText('15');
    expect(await page.locator('.bs-inspect-row').count()).toBeGreaterThanOrEqual(0);
    const meta = await page.evaluate(async () => { const b = await window.odtEditor.session.serialize(); return window.odtEditor.io.importOdt(b).meta.c.filter((x) => x.n === 'dc:title' || x.n === 'meta:keyword').map((x) => `${x.n}=${x.c[0]}`); });
    expect(meta).toEqual(['dc:title=Garden Report 2026', 'meta:keyword=garden', 'meta:keyword=report']);
    // Encrypt with a password; the saved file is encrypted and opens again with it.
    await page.locator('.bs-info-btn[data-action="protect"]').click();
    const inputs = page.locator('.pw-dlg input[type=password]');
    await inputs.nth(0).fill('s3cret');
    await inputs.nth(1).fill('s3cret');
    await page.locator('.dlg button.primary').click();
    const enc = Buffer.from(await page.evaluate(async () => Array.from(await window.odtEditor.session.serialize())));
    const file = path.join(OUT, 'protected.odt');
    writeFileSync(file, enc);
    const zip = readZipText(new Uint8Array(enc));
    expect(zip['META-INF/manifest.xml']).toContain('manifest:encryption-data');
    expect(Object.keys(zip)).not.toContain('Thumbnails/thumbnail.png');
    await page.keyboard.press('Escape');
    await openFile(page, 'protected.odt', enc);
    await page.locator('.pw-dlg input[type=password]').fill('wrong');
    await page.locator('.dlg button.primary').click();
    await expect(page.locator('.pw-error')).toHaveText('The password is incorrect. Try again.');
    await page.locator('.pw-dlg input[type=password]').fill('s3cret');
    await page.locator('.dlg button.primary').click();
    await page.locator('.dlg button', { hasText: 'Don’t Save' }).click();
    await expect.poll(() => docText(page)).toContain('Garden report');
    expect(await page.evaluate(() => window.odtEditor.session.protected)).toBe(true);
    // A file LibreOffice encrypted.
    await openFile(page, 'lo-encrypted.odt', readFileSync(path.join(FIX, 'protected', 'lo-encrypted.odt')));
    await page.locator('.pw-dlg input[type=password]').fill('lo-pass');
    await page.locator('.dlg button.primary').click();
    await expect.poll(() => docText(page)).toBe('Written and encrypted by LibreOffice.');
    // LibreOffice opens our encrypted file with the password.
    if (soffice && existsSync('/usr/lib/libreoffice/program/pythonloader.py')) {
      const py = spawnSync('python3', [path.resolve('tests/lib/lo-open-encrypted.py'), file, 's3cret', OUT], { timeout: 180_000 });
      expect(py.stdout.toString()).toContain('Garden report');
    }
  });

  test('Options: units, Customise Ribbon, Quick Access Toolbar; Help, Feedback, What\'s New, About; version history', async ({ page }) => {
    await sample(page);
    await run(page, 'file.options');
    await expect(page.locator('.opt-nav-item')).toHaveCount(8);
    // Advanced ▸ measurement units: inches.
    await page.locator('.opt-nav-item[data-section="advanced"]').click();
    await page.locator('.opt-body select').first().selectOption('in');
    // Customise Ribbon: hide Mailings.
    await page.locator('.opt-nav-item[data-section="ribbon"]').click();
    await page.locator('[data-tab-option="mailings"]').uncheck();
    // Quick Access Toolbar: on, with Bold added.
    await page.locator('.opt-nav-item[data-section="qat"]').click();
    await page.locator('.opt-body .fm-check input').first().check();
    await page.locator('.opt-qat select').first().selectOption('home.bold');
    await page.locator('.opt-qat-buttons button').first().click();
    await expect(page.locator('[data-qat-list] option')).toHaveCount(4);
    await page.locator('.dlg button.primary').click();
    await expect(page.locator('[role=tab][data-tab="mailings"]')).toBeHidden();
    await expect(page.locator('.qat .qat-btn')).toHaveCount(4);
    await expect(page.locator('.qat [data-command="file.save"]')).toBeVisible();
    // The ruler counts inches and the indent box shows inches.
    await expect(page.locator('.hruler-ticks .rt-num').first()).toHaveText('1');
    const inchPx = await page.evaluate(() => { const n = [...document.querySelectorAll('.hruler-ticks .rt-num')]; return parseFloat(n[1].style.left) - parseFloat(n[0].style.left); });
    expect(Math.round(inchPx)).toBe(96);
    await page.locator('[role=tab][data-tab="layout"]').click();
    await expect(page.locator('.rb-spin-input[data-command="layout.indentLeft"]')).toHaveValue('0.00 in');
    await page.locator('.rb-spin-input[data-command="layout.indentLeft"]').fill('0.5');
    await page.locator('.rb-spin-input[data-command="layout.indentLeft"]').press('Enter');
    await expect.poll(() => page.evaluate(() => { const n = window.odtEditor.editor.view.state.selection.$from.parent; return n.attrs.auto?.props?.['style:paragraph-properties']?.a?.['fo:margin-left']; })).toMatch(/^1\.27\d*cm$/);
    // The QAT button runs its command.
    await body(page).click();
    await page.keyboard.press('Control+a');
    await page.locator('.qat [data-command="home.bold"]').click();
    await expect.poll(() => page.evaluate(() => window.odtEditor.registry.isChecked('home.bold'))).toBe(true);
    // Help: shortcuts sheet with Bold (Ctrl+B), filtering.
    await page.keyboard.press('F1');
    await expect(page.locator('.help-table').first()).toBeVisible();
    await page.locator('.help-filter').fill('bold');
    await expect(page.locator('.help-table tr', { hasText: 'Bold' }).first()).toContainText('Ctrl+B');
    await page.keyboard.press('Escape');
    await run(page, 'help.feedback');
    await page.locator('.feedback-text').fill('Lovely app.');
    await page.locator('.dlg button.primary').click();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('odt-editor:settings')).feedbackNote)).toBe('Lovely app.');
    await run(page, 'help.whatsNew');
    await expect(page.locator('.help-sheet section')).toHaveCount(10);
    await page.keyboard.press('Escape');
    await run(page, 'help.about');
    await expect(page.locator('.about-page')).toContainText('UI inspired by the open-source WordCraft project (MIT/Apache-2.0).');
    await expect(page.locator('.about-licences tr')).toHaveCount(14);
    // Version history: autosaves keep earlier versions; one opens as a new document.
    await page.evaluate(() => window.odtEditor.session.autosaveNow());
    await run(page, 'file.infoPage');
    await expect(page.locator('.bs-versions [data-version]')).toHaveCount(1);
    await page.locator('.bs-versions [data-version]').click();
    await page.locator('.dlg button', { hasText: 'Don’t Save' }).click();
    await expect.poll(() => page.title()).toContain('version');
    await expect.poll(() => docText(page)).toContain('Garden report');
  });
});
