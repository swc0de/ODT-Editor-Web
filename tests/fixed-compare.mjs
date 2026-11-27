/**
 * M16: the editor's pages vs the PDF (pdftoppm) and XPS (mutool draw and
 * xpstopdf) renderings at 96 dpi. For each page: the share of pixels that
 * differ by more than 40 (with a 1-pixel antialiasing tolerance), and a
 * picture: editor | PDF | heat map → reference/compare/m16-pdf-<doc>-p<n>.png
 * (and m16-xps-…). Prints JSON results; used by tests/e2e/fixed.spec.js.
 *
 *   node tests/fixed-compare.mjs [fixture…] [--no-images]
 */
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { decodePng, encodePng, pixelDiff } from './lib/pixel-diff.mjs';

const args = process.argv.slice(2);
const writeImages = !args.includes('--no-images');
const files = args.filter((a) => !a.startsWith('--'));
const FIX = files.length ? files : ['tests/fixtures/formatting-zoo.odt', 'tests/fixtures/tables.odt', 'tests/fixtures/images.odt', 'tests/fixtures/lists.odt', 'tests/fixtures/headers-footers.odt', 'tests/fixtures/word-features.docx', 'tests/fixtures/word-fidelity/synthetic-fidelity.docx'];
const OUT = path.resolve('test-results/fixed-compare');
const CMP = path.resolve('reference/compare');
mkdirSync(OUT, { recursive: true });
mkdirSync(CMP, { recursive: true });

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1400, height: 1500 }, deviceScaleFactor: 1 })).newPage();
await page.addInitScript(() => { window.__ODT_TEST_DEFAULTS__ = { fileSystemAccess: false, checkSpelling: false }; });
await page.goto(pathToFileURL(path.resolve('dist/odt-editor.html')).href);
await page.waitForFunction(() => window.odtEditor && document.getElementById('app').getAttribute('aria-busy') === 'false');
await page.evaluate(() => { window.odtEditor.registry.run('app.setZoom', 100); window.odtEditor.store.set({ ribbonCollapsed: true, showRuler: false }); });

const side = (imgs) => {
  const h = Math.max(...imgs.map((i) => i.height));
  const w = imgs.reduce((a, i) => a + i.width + 8, -8);
  const out = Buffer.alloc(w * h * 4, 200);
  let x0 = 0;
  for (const im of imgs) {
    for (let y = 0; y < im.height; y++) Buffer.from(im.data.buffer, im.data.byteOffset + y * im.width * 4, im.width * 4).copy(out, (y * w + x0) * 4);
    x0 += im.width + 8;
  }
  return encodePng(w, h, out);
};

const results = [];
for (const file of FIX) {
  const name = path.basename(file).replace(/\.[^.]+$/, '');
  await page.evaluate(async ({ b64, n }) => { const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); await window.odtEditor.session.openBytes(bytes, { name: n, skipGuard: true }); }, { b64: readFileSync(file).toString('base64'), n: path.basename(file) });
  await page.waitForTimeout(800);
  await page.evaluate(() => window.odtEditor.docArea.relayout());
  await page.waitForTimeout(600);
  // The pages as shown (screen-only aids off, as in the export).
  await page.evaluate(() => { const v = window.odtEditor.editor.view; v.dom.blur(); window.getSelection().removeAllRanges(); window.odtEditor.docArea.view.stack.classList.add('png-export'); });
  const count = await page.evaluate(() => window.odtEditor.docArea.pages.length);
  const shots = [];
  const shotFiles = [];
  for (let i = 0; i < count; i++) {
    const box = await page.evaluate((i) => { const el = window.odtEditor.docArea.view.pageElement(i); el.scrollIntoView({ block: 'start' }); window.scrollTo(0, 0); document.scrollingElement.scrollTop = 0; const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; }, i);
    await page.waitForTimeout(150);
    const b2 = await page.evaluate((i) => { const r = window.odtEditor.docArea.view.pageElement(i).getBoundingClientRect(); return { x: Math.round(r.left + window.scrollX), y: Math.round(r.top + window.scrollY), width: Math.round(r.width), height: Math.round(r.height) }; }, i);
    void box;
    const shot = await page.screenshot({ clip: b2 });
    shots.push(decodePng(shot));
    shotFiles.push(shot);
  }
  await page.evaluate(() => window.odtEditor.docArea.view.stack.classList.remove('png-export'));
  const t0 = Date.now();
  const pdf = Buffer.from(await page.evaluate(async () => Array.from(await window.odtEditor.session.serializeAs('pdf'))));
  const pdfMs = Date.now() - t0;
  const xps = Buffer.from(await page.evaluate(async () => Array.from(await window.odtEditor.session.serializeAs('xps'))));
  const pdfFile = path.join(OUT, `${name}.pdf`);
  const xpsFile = path.join(OUT, `${name}.xps`);
  writeFileSync(pdfFile, pdf);
  writeFileSync(xpsFile, xps);
  const dir = path.join(OUT, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  execFileSync('pdftoppm', ['-r', '96', '-png', pdfFile, path.join(dir, 'pdf')]);
  execFileSync('mutool', ['draw', '-q', '-r', '96', '-o', path.join(dir, 'xps-%d.png'), xpsFile], { stdio: 'pipe' });
  let gxps = false;
  try { execFileSync('xpstopdf', [xpsFile, path.join(dir, 'gxps.pdf')], { stdio: 'pipe' }); execFileSync('pdftoppm', ['-r', '96', '-png', path.join(dir, 'gxps.pdf'), path.join(dir, 'gxps')]); gxps = true; } catch { gxps = false; }
  shotFiles.forEach((b, i) => writeFileSync(path.join(dir, `editor-${i + 1}.png`), b));
  const pngs = readdirSync(dir);
  const find = (prefix, i) => { const f = pngs.filter((p) => p.startsWith(prefix) && p.endsWith('.png')).sort((a, b) => Number(a.match(/(\d+)\.png$/)[1]) - Number(b.match(/(\d+)\.png$/)[1]))[i]; return f ? decodePng(readFileSync(path.join(dir, f))) : null; };
  const res = { file, pages: count, pdfMs, pdf: [], xps: [], gxps: [] };
  for (let i = 0; i < count; i++) {
    for (const [kind, prefix] of [['pdf', 'pdf-'], ['xps', 'xps-'], ['gxps', 'gxps-']]) {
      if (kind === 'gxps' && !gxps) continue;
      const r = find(prefix, i);
      if (!r) { res[kind].push(null); continue; }
      const d = pixelDiff(shots[i], r);
      res[kind].push(+(d.ratio * 100).toFixed(3));
      if (writeImages && kind !== 'gxps') writeFileSync(path.join(CMP, `m16-${kind}-${name}-p${i + 1}.png`), side([shots[i], r, { width: d.width, height: d.height, data: d.heat }]));
    }
  }
  results.push(res);
}
await browser.close();
console.log(JSON.stringify(results, null, 1));
void existsSync;
