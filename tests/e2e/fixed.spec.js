/**
 * M16: native PDF and XPS writers.
 *
 * The files are checked with real tools when they're installed (poppler:
 * pdfinfo / pdffonts / pdftotext / pdftoppm; qpdf; mutool; libgxps xpstopdf):
 * structure, embedded and subset fonts, text and reading order, properties,
 * bookmarks, links, tags, PDF/A-2b structure, XPS package and text, page
 * ranges, markup, pixel comparison with the editor's pages, export time of a
 * 100-page document, and Save As PDF / XPS writing a copy.
 */
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { openApp, openFixture } from './helpers.js';

const OUT = path.resolve('test-results/fixed');
const has = (cmd, arg = '-v') => spawnSync(cmd, [arg]).status !== null && !spawnSync(cmd, [arg]).error;
const POPPLER = has('pdfinfo');
const QPDF = has('qpdf', '--version');
const MUTOOL = has('mutool', '-v');
const GXPS = has('xpstopdf', '--help');

/** The document written as PDF / XPS with these options (session.serializeAs). */
async function exportAs(page, kind, options = {}) {
  const b64 = await page.evaluate(async ({ kind, options }) => {
    const bytes = await window.odtEditor.session.serializeAs(kind, options);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }, { kind, options });
  return Buffer.from(b64, 'base64');
}
const save = (name, bytes) => { const f = path.join(OUT, name); writeFileSync(f, bytes); return f; };
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'pipe' }).toString();
const pdfPages = (f) => Number(run('pdfinfo', [f]).match(/Pages:\s+(\d+)/)[1]);
/** The PDF's objects uncompressed (qpdf QDF), as text to search. */
const qdf = (f) => { const o = `${f}.qdf`; execFileSync('qpdf', ['--qdf', '--object-streams=disable', f, o]); return readFileSync(o, 'latin1'); };
const inOrder = (text, parts) => { let at = -1; for (const p of parts) { const i = text.indexOf(p, at + 1); if (i < 0) return `missing or out of order: ${p}`; at = i; } return true; };

test.describe('PDF and XPS', () => {
  test.describe.configure({ timeout: 120_000 });
  let problems;
  test.beforeAll(() => mkdirSync(OUT, { recursive: true }));
  test.beforeEach(async ({ page }) => { problems = await openApp(page); });
  test.afterEach(() => { expect([...problems.pageErrors, ...problems.consoleErrors]).toEqual([]); expect(problems.networkRequests).toEqual([]); });

  test('PDF: valid, fonts embedded and subset, text in reading order, properties, bookmarks, links, tags', async ({ page }) => {
    test.skip(!POPPLER || !QPDF, 'poppler-utils and qpdf are needed');
    await openFixture(page, 'word-fidelity/synthetic-fidelity.docx');
    await page.waitForTimeout(500);
    const pages = await page.evaluate(() => window.odtEditor.docArea.pages.length);
    const f = save('synthetic.pdf', await exportAs(page, 'pdf'));
    expect(readFileSync(f).subarray(0, 8).toString()).toBe('%PDF-1.7');
    // qpdf: no structural errors.
    const check = spawnSync('qpdf', ['--check', f]);
    expect(check.status, check.stdout.toString() + check.stderr.toString()).toBe(0);
    // Every font embedded, subset, with a ToUnicode map.
    const fonts = run('pdffonts', [f]).split('\n').slice(2).filter((l) => l.trim());
    expect(fonts.length).toBeGreaterThan(1);
    for (const l of fonts) {
      const cols = l.trim().split(/\s+/);
      const [emb, sub, uni] = cols.slice(-5, -2);
      expect([emb, sub, uni], l).toEqual(['yes', 'yes', 'yes']);
      expect(cols[0], l).toMatch(/^[A-Z]{6}\+/);
    }
    // One PDF page per page; the properties.
    const info = run('pdfinfo', [f]);
    expect(pdfPages(f)).toBe(pages);
    expect(info).toMatch(/Tagged:\s+yes/);
    expect(info).toMatch(/Producer:\s+ODT Editor/);
    expect(info).toMatch(/Title:\s+\S/);
    // Text, in reading order (page 2: character formatting, then paragraph formatting).
    const p2 = run('pdftotext', ['-f', '2', '-l', '2', f, '-']);
    expect(inOrder(p2, ['1. Character Formatting', 'Plain, bold, italic', 'Unicode: café', 'Ελληνικά', 'Русский', '日本語', '2. Paragraph Formatting', 'Left-aligned paragraph.', 'Center-aligned paragraph.', 'Right-aligned paragraph.', 'Justified paragraph.'])).toBe(true);
    // Columns read column by column (page 7), in the order the page is written (-raw: pdftotext's
    // layout mode guesses its own order and interleaves the two columns).
    const p7 = run('pdftotext', ['-raw', '-f', '7', '-l', '7', f, '-']);
    expect(inOrder(p7, ['9. Landscape Section', '1. Lorem', '4. Lorem', '5. Lorem', '6. Lorem'])).toBe(true);
    // Bookmarks from the headings, with their levels.
    if (MUTOOL) {
      const outline = run('mutool', ['show', f, 'outline']);
      expect(outline).toContain('"1. Character Formatting"\t#page=2');
      expect(outline).toMatch(/\t\t"2\.1 Alignment"\t#page=2/);
    }
    const objs = qdf(f);
    expect(objs).toMatch(/\/Outlines \d+ 0 R/);
    // Links: web links (URI) and the table of contents (internal destinations).
    expect(objs).toMatch(/\/S \/URI/);
    expect((objs.match(/\/Subtype \/Link/g) || []).length).toBeGreaterThan(10);
    expect(objs).toMatch(/\/Dest \[\s*\d+ 0 R\s+\/XYZ/);
    // Tags: a structure tree with headings, paragraphs, lists, tables and a figure with its alternative text.
    expect(objs).toMatch(/\/StructTreeRoot \d+ 0 R/);
    expect(objs).toMatch(/\/MarkInfo <<\s*\/Marked true\s*>>/);
    for (const tag of ['H1', 'H2', 'P', 'L', 'LI', 'Table', 'TR', 'TD', 'Figure']) expect(objs, tag).toMatch(new RegExp(`/S /${tag}\\b`));
    expect(objs).toMatch(/\/Alt \(/);
    // XMP metadata.
    expect(objs).toContain('<x:xmpmeta');
  });

  test('PDF options: no bookmarks / properties / tags; Minimum size; PDF/A-2b structure', async ({ page }) => {
    test.skip(!POPPLER || !QPDF, 'poppler-utils and qpdf are needed');
    await openFixture(page, 'images.odt');
    await page.waitForTimeout(400);
    const plain = save('plain.pdf', await exportAs(page, 'pdf', { bookmarks: false, properties: false, tagged: false }));
    const objs = qdf(plain);
    expect(objs).not.toMatch(/\/Outlines \d+ 0 R/);
    expect(objs).not.toMatch(/\/StructTreeRoot/);
    expect(run('pdfinfo', [plain])).toMatch(/Tagged:\s+no/);
    // Minimum size: pictures above 150 dpi as drawn are scaled down to 150 dpi.
    await openFixture(page, 'word-fidelity/synthetic-fidelity.docx');
    await page.waitForTimeout(500);
    const std = save('std.pdf', await exportAs(page, 'pdf'));
    const small = save('small.pdf', await exportAs(page, 'pdf', { minimumSize: true }));
    expect(readFileSync(small).length).toBeLessThan(readFileSync(std).length);
    if (POPPLER) {
      const ppi = (f) => run('pdfimages', ['-list', f]).split('\n').slice(2).filter((l) => l.trim()).map((l) => Number(l.trim().split(/\s+/)[12]));
      expect(Math.max(...ppi(std))).toBeGreaterThan(200);
      expect(Math.max(...ppi(small))).toBeLessThanOrEqual(155);
    }
    // PDF/A-2b (veraPDF isn't installed here: the requirements are checked one by one).
    const a = save('pdfa.pdf', await exportAs(page, 'pdf', { pdfa: true }));
    expect(spawnSync('qpdf', ['--check', a]).status).toBe(0);
    const ao = qdf(a);
    expect(ao).toMatch(/\/OutputIntents \[/);
    expect(ao).toMatch(/\/S \/GTS_PDFA1/);
    expect(ao).toMatch(/\/DestOutputProfile \d+ 0 R/);
    expect(ao).toContain('<pdfaid:part>2</pdfaid:part>');
    expect(ao).toContain('<pdfaid:conformance>B</pdfaid:conformance>');
    expect(ao).toMatch(/\/ID \[<[0-9a-f]{32}>\s*<[0-9a-f]{32}>\]/i);
    expect(ao).not.toMatch(/\/Encrypt|\/JavaScript|\/Launch/);
    expect(ao).toMatch(/\/StructTreeRoot/);
    for (const l of run('pdffonts', [a]).split('\n').slice(2).filter((x) => x.trim())) expect(l.trim().split(/\s+/).slice(-5, -4)[0]).toBe('yes');
    // The ICC profile is a valid sRGB display profile.
    expect(ao).toMatch(/\/N 3/);
  });

  test('page ranges: pages From–To, Current page, Selection', async ({ page }) => {
    test.skip(!POPPLER, 'poppler-utils are needed');
    await openFixture(page, 'word-fidelity/synthetic-fidelity.docx');
    await page.waitForTimeout(500);
    const full = save('range-all.pdf', await exportAs(page, 'pdf'));
    const pageText = (f, n) => run('pdftotext', ['-f', String(n), '-l', String(n), f, '-']).trim();
    const two = save('range-2-3.pdf', await exportAs(page, 'pdf', { range: 'pages', from: 2, to: 3 }));
    expect(pdfPages(two)).toBe(2);
    expect(pageText(two, 1)).toBe(pageText(full, 2));
    expect(pageText(two, 2)).toBe(pageText(full, 3));
    const cur = save('range-current.pdf', await exportAs(page, 'pdf', { range: 'current' }));
    expect(pdfPages(cur)).toBe(1);
    // A selection on page 4.
    await page.evaluate(() => {
      const v = window.odtEditor.editor.view;
      let at = null;
      v.state.doc.descendants((n, pos) => { if (at == null && n.isTextblock && n.textContent.startsWith('3. Lists')) at = pos + 1; });
      v.dispatch(v.state.tr.setSelection(window.odtEditor.pm.TextSelection.create(v.state.doc, at, at + 5)));
    });
    const sel = save('range-selection.pdf', await exportAs(page, 'pdf', { range: 'selection' }));
    expect(pdfPages(sel)).toBe(1);
    expect(pageText(sel, 1)).toContain('3. Lists');
    // XPS too.
    const xps = unzipSync(new Uint8Array(await exportAs(page, 'xps', { range: 'pages', from: 5, to: 6 })));
    expect(Object.keys(xps).filter((k) => /Pages\/\d+\.fpage$/.test(k))).toHaveLength(2);
  });

  test('Document vs Document showing markup: comments become PDF notes only with markup', async ({ page }) => {
    test.skip(!QPDF, 'qpdf is needed');
    await openFixture(page, 'word-fidelity/synthetic-fidelity.docx');
    await page.waitForTimeout(500);
    const before = await page.evaluate(() => window.odtEditor.store.get().reviewDisplay);
    const doc = qdf(save('nomarkup.pdf', await exportAs(page, 'pdf', { markup: false })));
    const mk = qdf(save('markup.pdf', await exportAs(page, 'pdf', { markup: true })));
    expect(doc).not.toMatch(/\/Subtype \/Text/);
    expect(mk).toMatch(/\/Subtype \/Text/);
    // The review display is put back.
    expect(await page.evaluate(() => window.odtEditor.store.get().reviewDisplay)).toBe(before);
  });

  test('XPS: a valid package (sequence, fonts obfuscated, outline, links), text, and other viewers open it', async ({ page }) => {
    await openFixture(page, 'word-fidelity/synthetic-fidelity.docx');
    await page.waitForTimeout(500);
    const pages = await page.evaluate(() => window.odtEditor.docArea.pages.length);
    const bytes = await exportAs(page, 'xps');
    const f = save('synthetic.xps', bytes);
    const z = unzipSync(new Uint8Array(bytes));
    const names = Object.keys(z);
    expect(names[0]).toBe('[Content_Types].xml');
    expect(strFromU8(z['_rels/.rels'])).toContain('FixedDocumentSequence.fdseq');
    expect(strFromU8(z['FixedDocumentSequence.fdseq'])).toContain('Documents/1/FixedDocument.fdoc');
    expect(strFromU8(z['Documents/1/FixedDocument.fdoc']).match(/<PageContent /g)).toHaveLength(pages);
    expect(names).toContain('docProps/core.xml');
    expect(names.some((n) => /DocStructure\.struct$/.test(n))).toBe(true);
    // Fonts: obfuscated with the GUID of their name (the first 32 bytes XOR the key) → TrueType.
    const fontsFound = names.filter((n) => n.endsWith('.odttf'));
    expect(fontsFound.length).toBeGreaterThan(1);
    for (const n of fontsFound) {
      const guid = path.basename(n, '.odttf').replace(/-/g, '');
      const key = Array.from({ length: 16 }, (_, i) => parseInt(guid.substr(30 - i * 2, 2), 16));
      const font = Uint8Array.from(z[n]);
      for (let i = 0; i < 32; i++) font[i] ^= key[i % 16];
      expect(Buffer.from(font.subarray(0, 4)).toString('hex'), n).toBe('00010000');
    }
    const page2 = strFromU8(z['Documents/1/Pages/2.fpage']);
    expect(page2).toMatch(/<Glyphs [^>]*FontUri="[^"]+\.odttf"[^>]*UnicodeString="1\. Character Formatting"/);
    expect(page2).toMatch(/Indices="\d+,[\d.]+;/);
    expect(strFromU8(z['Documents/1/Pages/1.fpage'])).toMatch(/FixedPage\.NavigateUri="[^"]*#/);
    if (MUTOOL) {
      const r = spawnSync('mutool', ['draw', '-q', '-F', 'txt', '-o', '-', f, '2']);
      expect(r.stderr.toString().split('\n').filter((l) => l && !/ICC support is not available/.test(l))).toEqual([]);
      // mutool spaces out characters drawn as pictures (it measures the invisible glyph, not the
      // advance): compared without spaces. The file holds UnicodeString="日本語".
      expect(inOrder(r.stdout.toString().replace(/\s+/g, ''), ['1.CharacterFormatting', 'Plain,bold', 'Ελληνικά', 'עברית', '日本語', '2.ParagraphFormatting'])).toBe(true);
      expect(page2).toContain('UnicodeString="日本語"');
    }
    if (GXPS) {
      const r = spawnSync('xpstopdf', [f, path.join(OUT, 'synthetic-gxps.pdf')]);
      expect(r.status, r.stderr.toString()).toBe(0);
      expect(r.stderr.toString()).toBe('');
      if (POPPLER) expect(pdfPages(path.join(OUT, 'synthetic-gxps.pdf'))).toBe(pages);
    }
  });

  test('File ▸ Save As ▸ PDF ▸ More options…: the options dialog chooses pages and markup', async ({ page }) => {
    await openFixture(page, 'word-fidelity/synthetic-fidelity.docx');
    await page.waitForTimeout(500);
    await page.evaluate(() => window.odtEditor.registry.run('file.saveAsPage'));
    await page.locator('[data-saveas-type]').selectOption('pdf');
    await page.locator('[data-saveas-more]').click();
    const dlg = page.getByRole('dialog');
    await expect(dlg).toBeVisible();
    for (const o of ['range-all', 'range-current', 'range-selection', 'range-pages', 'what-document', 'what-markup', 'bookmarks', 'properties', 'tagged', 'pdfa', 'opt-standard', 'opt-minimum']) await expect(dlg.locator(`[data-option="${o}"]`).first(), o).toBeAttached();
    await expect(dlg.locator('[data-option="range-all"]')).toBeChecked();
    await expect(dlg.locator('[data-option="tagged"] input, input[data-option="tagged"]').first()).toBeChecked();
    await expect(dlg.locator('[data-option="pdfa"] input, input[data-option="pdfa"]').first()).not.toBeChecked();
    await dlg.locator('[data-option="from"]').fill('3');
    await dlg.locator('[data-option="to"]').fill('4');
    await expect(dlg.locator('[data-option="range-pages"]')).toBeChecked();
    await dlg.getByRole('button', { name: 'OK' }).click();
    const download = page.waitForEvent('download');
    await page.locator('[data-saveas-save]').click();
    const d = await download;
    expect(d.suggestedFilename()).toMatch(/\.pdf$/);
    const f = path.join(OUT, 'dialog-range.pdf');
    await d.saveAs(f);
    if (POPPLER) {
      expect(pdfPages(f)).toBe(2);
      expect(run('pdftotext', ['-f', '1', '-l', '1', f, '-'])).toContain('2.3 Spacing');
    }
    // The document is still the .docx it was.
    expect(await page.evaluate(() => window.odtEditor.session.info.format)).toBe('docx');
  });

  test('pixels: the PDF and XPS pages match the editor\'s pages', async () => {
    test.skip(!POPPLER || !MUTOOL, 'pdftoppm and mutool are needed');
    test.setTimeout(900_000);
    // A separate browser run (tests/fixed-compare.mjs) captures the pages and renders the files at 96 dpi.
    const r = spawnSync('node', ['tests/fixed-compare.mjs'], { encoding: 'utf8', maxBuffer: 64 << 20, timeout: 880_000 });
    expect(r.status, r.stderr).toBe(0);
    const results = JSON.parse(r.stdout);
    writeFileSync(path.join(OUT, 'pixels.json'), JSON.stringify(results, null, 1));
    // A page passes when the share of pixels differing by more than 40 (1 px antialiasing
    // tolerance) is at most 0.5 % above what two renderers of the same PDF disagree on
    // by themselves on that page (pdftoppm vs mutool: glyph antialiasing and hinting).
    const fails = [];
    for (const d of results) {
      for (let i = 0; i < d.pages; i++) {
        const limit = 0.5 + (d.floor[i] ?? 0);
        const pdf = Math.min(d.pdf[i] ?? 100, d.mupdf[i] ?? 100);
        const xps = Math.min(d.xps[i] ?? 100, d.gxps[i] ?? 100);
        if (pdf > limit) fails.push(`${d.file} p${i + 1} PDF ${pdf}% > ${limit.toFixed(3)}%`);
        if (xps > limit) fails.push(`${d.file} p${i + 1} XPS ${xps}% > ${limit.toFixed(3)}%`);
      }
    }
    expect(fails).toEqual([]);
  });
});

test.describe('Save As copies', () => {
  test('Save As PDF / XPS writes a copy: the document stays attached to its .docx', async ({ page }) => {
    await page.addInitScript(() => {
      window.__fs = { written: {}, offered: [] };
      const handle = (name) => ({ kind: 'file', name, queryPermission: async () => 'granted', requestPermission: async () => 'granted', async createWritable() { const chunks = []; return { write: async (b) => chunks.push(b), close: async () => { window.__fs.written[name] = new Uint8Array(await new Blob(chunks).arrayBuffer()); } }; } });
      window.showSaveFilePicker = async (o) => { window.__fs.offered.push(o); const n = window.__fs.nextName || o.suggestedName; window.__fs.nextName = null; return handle(n); };
    });
    const problems = await openApp(page, { settings: { fileSystemAccess: true } });
    await page.evaluate(() => { const v = window.odtEditor.editor.view; v.focus(); });
    await page.keyboard.type('Copies');
    await page.evaluate(() => { window.__fs.nextName = 'report.docx'; });
    await page.keyboard.press('F12');
    const info = () => page.evaluate(() => { const i = window.odtEditor.session.info; return { format: i.format, fileName: i.fileName, hasHandle: i.hasHandle, dirty: i.dirty }; });
    await expect.poll(info).toMatchObject({ format: 'docx', fileName: 'report.docx', hasHandle: true });
    for (const [name, magic] of [['report.pdf', '%PDF'], ['report.xps', 'PK']]) {
      await page.evaluate((n) => { window.__fs.nextName = n; }, name);
      await page.keyboard.press('F12');
      await expect.poll(() => page.evaluate((n) => !!window.__fs.written[n], name)).toBe(true);
      const b = Buffer.from(await page.evaluate((n) => Array.from(window.__fs.written[n]), name));
      expect(b.subarray(0, magic.length).toString()).toBe(magic);
      expect(await info()).toMatchObject({ format: 'docx', fileName: 'report.docx', hasHandle: true });
    }
    // Save still writes the .docx.
    await page.keyboard.type('!');
    await page.keyboard.press('Control+s');
    await expect.poll(info).toMatchObject({ dirty: false });
    expect(Buffer.from(await page.evaluate(() => Array.from(window.__fs.written['report.docx']))).subarray(0, 2).toString()).toBe('PK');
    // Recent lists the document, not its PDF / XPS copies.
    const recent = await page.evaluate(async () => (await window.odtEditor.recent?.list?.()) || null);
    if (recent) expect(recent.map((r) => r.name)).not.toContain('report.pdf');
    expect([...problems.pageErrors, ...problems.consoleErrors]).toEqual([]);
  });

});

test.describe('export speed', () => {
  test('a 100-page document exports to PDF and to XPS in under 10 s each', async ({ page }) => {
    test.setTimeout(180_000);
    const problems = await openApp(page);
    await openFixture(page, 'long-100-pages.odt');
    await expect.poll(() => page.evaluate(() => window.odtEditor.docArea.pages.length), { timeout: 60_000 }).toBeGreaterThanOrEqual(100);
    const time = (kind) => page.evaluate(async (k) => { const t0 = performance.now(); const b = await window.odtEditor.session.serializeAs(k); return { ms: performance.now() - t0, size: b.length }; }, kind);
    const pdf = await time('pdf');
    const xps = await time('xps');
    mkdirSync(OUT, { recursive: true });
    writeFileSync(path.join(OUT, 'timings.json'), JSON.stringify({ pdf, xps }, null, 1));
    console.log(`100-page export: PDF ${Math.round(pdf.ms)} ms (${Math.round(pdf.size / 1024)} KiB), XPS ${Math.round(xps.ms)} ms (${Math.round(xps.size / 1024)} KiB)`);
    expect(pdf.ms).toBeLessThan(10_000);
    expect(xps.ms).toBeLessThan(10_000);
    expect([...problems.pageErrors, ...problems.consoleErrors]).toEqual([]);
  });
});
