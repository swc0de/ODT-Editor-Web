/**
 * Round-trip tests: every fixture is opened, saved and re-opened in the app;
 * the document model must be identical. The saved package is checked against
 * ODF packaging rules, and (if LibreOffice is installed) LibreOffice must read
 * the same text from our file as from the original.
 */
import { test, expect } from '@playwright/test';
import { readdirSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import path from 'node:path';
import { openApp } from './helpers.js';
import { listZipEntries, readZipText, checkWellFormed } from '../lib/odf.mjs';

const FIXTURES = readdirSync('tests/fixtures').filter((f) => /\.(odt|ott)$/.test(f)).sort();
const OUT = path.resolve('test-results/roundtrip');
mkdirSync(OUT, { recursive: true });

test.describe.configure({ mode: 'serial' });

let page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await openApp(page);
});
test.afterAll(async () => { await page.close(); });

for (const name of FIXTURES) {
  test(`round-trip ${name}`, async () => {
    const b64 = readFileSync(path.join('tests/fixtures', name)).toString('base64');
    const r = await page.evaluate(async (b64) => {
      const { importOdt, exportOdt } = window.odtEditor.io;
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const a = importOdt(bytes);
      // Save through the real session path (with thumbnail), then re-open.
      const { session } = window.odtEditor;
      session.load(a, { name: 'rt' });
      const saved = await session.serialize();
      const b = importOdt(saved);
      const strip = (s) => ({
        doc: s.doc.toJSON(), masterStyles: s.masterStyles, stylesAutoStyles: s.stylesAutoStyles,
        commonStyles: s.commonStyles, prelude: s.prelude, officeTextAttrs: s.officeTextAttrs,
        pictures: Object.keys(s.pictures).sort(), extraFiles: Object.keys(s.extraFiles).sort(),
        title: (s.meta.c || []).find((c) => c.n === 'dc:title') || null,
      });
      let bin = '';
      for (const c of saved) bin += String.fromCharCode(c);
      return { a: strip(a), b: strip(b), out: btoa(bin) };
    }, b64);
    // Pictures nothing refers to are dropped on save; everything else must match exactly.
    expect(r.b.doc).toEqual(r.a.doc);
    expect(r.b.masterStyles).toEqual(r.a.masterStyles);
    expect(r.b.stylesAutoStyles).toEqual(r.a.stylesAutoStyles);
    expect(r.b.prelude).toEqual(r.a.prelude);
    expect(r.b.officeTextAttrs).toEqual(r.a.officeTextAttrs);
    expect(r.b.extraFiles).toEqual(r.a.extraFiles);
    expect(r.b.title).toEqual(r.a.title);
    expect(r.a.pictures).toEqual(expect.arrayContaining(r.b.pictures));
    // Common styles: same named styles, nothing lost.
    const names = (cs) => (cs.c || []).filter((t) => typeof t !== 'string').map((t) => `${t.n}|${t.a['style:name'] || t.a['style:family'] || ''}`);
    expect(names(r.b.commonStyles)).toEqual(expect.arrayContaining(names(r.a.commonStyles)));

    const bytes = Buffer.from(r.out, 'base64');
    const outName = name.replace(/\.ott$/, '.ott');
    writeFileSync(path.join(OUT, outName), bytes);
    const entries = listZipEntries(new Uint8Array(bytes));
    expect(entries[0].name).toBe('mimetype');
    expect(entries[0].method).toBe(0);
    expect(entries[0].extraLen).toBe(0);
    const zip = readZipText(new Uint8Array(bytes));
    for (const f of ['content.xml', 'styles.xml', 'meta.xml', 'settings.xml', 'META-INF/manifest.xml', 'Thumbnails/thumbnail.png']) expect(zip[f], f).toBeTruthy();
    for (const [f, data] of Object.entries(zip)) if (f.endsWith('.xml')) expect(checkWellFormed(data), f).toBeNull();
    for (const f of Object.keys(zip)) if (f !== 'mimetype' && f !== 'META-INF/manifest.xml') expect(zip['META-INF/manifest.xml']).toContain(`manifest:full-path="${f}"`);
    expect(zip['content.xml']).toContain('office:version="1.3"');
    expect(zip['meta.xml']).toContain('meta:document-statistic');
  });
}

test('LibreOffice reads the same text from our files as from the originals', async () => {
  const soffice = ['soffice', 'libreoffice'].find((bin) => spawnSync(bin, ['--version'], { timeout: 60_000 }).status === 0);
  test.skip(!soffice, 'LibreOffice is not installed');
  test.setTimeout(300_000);
  const work = path.resolve('test-results/lo');
  const env = [`-env:UserInstallation=file://${work}/profile`, '--headless', '--norestore', '--convert-to', 'txt:Text (encoded):UTF8'];
  execFileSync(soffice, [...env, '--outdir', `${work}/orig`, ...FIXTURES.map((f) => path.resolve('tests/fixtures', f))], { stdio: 'pipe', timeout: 240_000 });
  execFileSync(soffice, [...env, '--outdir', `${work}/ours`, ...FIXTURES.map((f) => path.join(OUT, f))], { stdio: 'pipe', timeout: 240_000 });
  // Word-count fields show the file's statistics, which LibreOffice computes slightly differently.
  const norm = (s) => s.replace(/words \d+/g, 'words N');
  for (const f of FIXTURES) {
    const txt = f.replace(/\.(odt|ott)$/, '.txt');
    expect(existsSync(path.join(work, 'ours', txt)), `LibreOffice could not open our ${f}`).toBe(true);
    expect(norm(readFileSync(path.join(work, 'ours', txt), 'utf8')), f).toBe(norm(readFileSync(path.join(work, 'orig', txt), 'utf8')));
  }
});
