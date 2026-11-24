/**
 * M15 §4 / §8: a .docx the app didn't create keeps everything on Save.
 *
 * Corpus: tests/fixtures/*.docx, tests/fixtures/word-fidelity/*.docx, every
 * ODT fixture converted to DOCX by LibreOffice (tests/fixtures/lo-docx/), real
 * Word files in tests/fixtures/word-real/ (when the user adds some) and the
 * M14 reference document. For each file:
 *   1. open → save DOCX → reopen gives the same model
 *   2. every element and attribute of the original body parts is in the
 *      output, except the allowed noise (tests/lib/ooxml-diff.mjs)
 *   3. every part the editor doesn't own is byte-identical
 *   4. LibreOffice opens the output and lays it out on as many pages as the original
 * plus: the reader drops no element, and after an edit (typing in the first
 * paragraph) nothing else is lost either.
 */
import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { openApp } from './helpers.js';
import { ooxmlDiff } from '../lib/ooxml-diff.mjs';

const OUT = path.resolve('test-results/docx-preserve');
const soffice = spawnSync('soffice', ['--version']).status === 0 ? 'soffice' : null;
const dirFiles = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => /\.docx$/i.test(f)).map((f) => path.join(dir, f)) : []);
const CORPUS = [
  ...dirFiles('tests/fixtures'),
  ...dirFiles('tests/fixtures/word-fidelity'),
  ...dirFiles('tests/fixtures/lo-docx'),
  ...dirFiles('tests/fixtures/word-real'),
  'reference/docx/DOCX-Fidelity-Reference.docx',
];

/** The model without the raw XML kept for write-back (source bookkeeping, not content). */
const MODEL = () => {
  const sort = (v) => (Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).filter((k) => k !== 'ooxml' && k !== 'part').sort().map((k) => [k, sort(v[k])])) : v);
  return JSON.stringify(sort(window.odtEditor.editor.view.state.doc.toJSON()));
};

async function open(page, file, bytes) {
  await page.evaluate(async ({ b64, name }) => {
    const b = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await window.odtEditor.session.openBytes(b, { name, skipGuard: true });
  }, { b64: Buffer.from(bytes).toString('base64'), name: path.basename(file) });
}
const saveDocx = async (page) => Buffer.from(await page.evaluate(async () => {
  const o = await window.odtEditor.session.serializeAs('docx');
  let s = '';
  for (let i = 0; i < o.length; i += 0x8000) s += String.fromCharCode.apply(null, o.subarray(i, i + 0x8000));
  return btoa(s);
}), 'base64');

function loPages(files, sub) {
  const dir = path.join(OUT, 'lo-pdf', sub);
  mkdirSync(dir, { recursive: true });
  execFileSync(soffice, [`-env:UserInstallation=file://${OUT}/lo-profile`, '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', dir, ...files], { stdio: 'pipe', timeout: 600_000 });
  return Object.fromEntries(files.map((f) => {
    const pdf = path.join(dir, `${path.basename(f).replace(/\.[^.]+$/, '')}.pdf`);
    const info = existsSync(pdf) ? execFileSync('pdfinfo', [pdf]).toString() : '';
    return [path.basename(f), Number(/Pages:\s+(\d+)/.exec(info)?.[1] || 0)];
  }));
}

test.describe('DOCX: keep everything on Save (corpus)', () => {
  // In order, in one worker (the LibreOffice check reads the outputs); a failure doesn't stop the others.
  test.describe.configure({ mode: 'default' });
  const outName = (i) => path.join(OUT, 'out', `${path.basename(CORPUS[i], '.docx')}-${i}.docx`);

  for (const [i, file] of CORPUS.entries()) {
    test(`${file}: open → save → reopen keeps the model, every element and every unowned part`, async ({ page }) => {
      test.setTimeout(120_000);
      const problems = await openApp(page);
      const orig = readFileSync(file);
      await open(page, file, orig);
      const dropped = await page.evaluate(() => window.odtEditor.session.state.docxSource?.dropped);
      expect(dropped, 'elements the reader dropped').toEqual({});
      const before = await page.evaluate(MODEL);
      const updates = await page.evaluate(() => !!window.odtEditor.session.state.updateFieldsOnOpen);
      const out = await saveDocx(page);
      mkdirSync(path.join(OUT, 'out'), { recursive: true });
      writeFileSync(outName(i), out);
      // 2 and 3.
      const r = ooxmlDiff(new Uint8Array(orig), new Uint8Array(out));
      expect(r.missing, 'elements missing from the output').toEqual([]);
      // Word's "update fields on open" TOCs get their page numbers: the text changes there only.
      if (!updates) expect(r.text.output).toBe(r.text.original);
      expect(r.unowned.filter((u) => !u.identical), 'unowned parts changed').toEqual([]);
      // 1.
      await open(page, 'roundtrip.docx', out);
      expect(await page.evaluate(MODEL)).toBe(before);
      // After an edit (typing at the start of the first top-level paragraph that isn't a content
      // control, which typing would legitimately change) nothing else is lost.
      await open(page, file, orig);
      await page.evaluate(() => {
        const v = window.odtEditor.editor.view;
        let pos = null;
        v.state.doc.forEach((n, p) => { if (pos == null && n.isTextblock && !(n.firstChild?.marks || []).some((m) => m.type.name === 'contentControl')) pos = p + 1; });
        if (pos == null) pos = 1;
        v.dispatch(v.state.tr.insertText('EDITED ', pos));
      });
      const edited = await saveDocx(page);
      const r2 = ooxmlDiff(new Uint8Array(orig), new Uint8Array(edited));
      expect(r2.missing, 'elements missing after an edit').toEqual([]);
      expect(r2.text.output).toContain('EDITED ');
      expect([...problems.pageErrors, ...problems.consoleErrors]).toEqual([]);
    });
  }

  test('4. LibreOffice opens every output with the same page count as the original', async () => {
    test.skip(!soffice, 'LibreOffice is not installed');
    test.setTimeout(900_000);
    const outputs = CORPUS.map((file, i) => ({ file, outFile: outName(i) }));
    for (const o of outputs) expect(existsSync(o.outFile), `${o.file} was saved`).toBe(true);
    // Same base names would collide in one output folder: originals are copied under their output names.
    const origDir = path.join(OUT, 'orig');
    mkdirSync(origDir, { recursive: true });
    const origs = outputs.map(({ file, outFile }) => { const p = path.join(origDir, path.basename(outFile)); writeFileSync(p, readFileSync(file)); return p; });
    const a = loPages(origs, 'orig');
    const b = loPages(outputs.map((o) => o.outFile), 'out');
    for (const o of outputs) {
      const name = path.basename(o.outFile);
      expect(b[name], `${o.file}: LibreOffice opens the output`).toBeGreaterThan(0);
      expect(b[name], `${o.file}: page count`).toBe(a[name]);
    }
  });
});
