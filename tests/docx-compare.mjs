/**
 * Side-by-side pages of a Word file: LibreOffice's rendering (left) and the
 * editor's PDF export (right), one PNG per page in reference/compare/.
 *
 *   node tests/docx-compare.mjs [file.docx] [--app dist/odt-editor.html] [--name m14-docx]
 *
 * Default file: tests/fixtures/word-fidelity/docx-editor-test.docx (the
 * user's test document), else synthetic-fidelity.docx (names get
 * "-synthetic"). Needs soffice, pdftoppm and Python with Pillow.
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const real = path.resolve('tests/fixtures/word-fidelity/docx-editor-test.docx');
const file = path.resolve(args.find((a) => a.endsWith('.docx')) || (existsSync(real) ? real : 'tests/fixtures/word-fidelity/synthetic-fidelity.docx'));
const app = path.resolve(opt('--app', 'dist/odt-editor.html'));
const name = opt('--name', file === real ? 'm14-docx' : 'm14-docx-synthetic');
const tmp = path.resolve('test-results/docx-compare', name);
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
const outDir = path.resolve('reference/compare');

// LibreOffice.
execFileSync('soffice', [`-env:UserInstallation=file://${tmp}/lo-profile`, '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', tmp, file], { stdio: 'pipe', timeout: 180_000 });
const loPdf = path.join(tmp, `${path.basename(file, '.docx')}.pdf`);

// The editor: open, let it settle, print to PDF.
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.addInitScript(() => { window.__ODT_TEST_DEFAULTS__ = { fileSystemAccess: false }; });
await page.goto(pathToFileURL(app).href);
await page.waitForFunction(() => window.odtEditor && document.getElementById('app').getAttribute('aria-busy') === 'false');
await page.evaluate(async (b64) => { const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); await window.odtEditor.session.openFile(new File([bytes], 'doc.docx')); }, readFileSync(file).toString('base64'));
let last = '';
for (let i = 0, same = 0; i < 120 && same < 5; i++) {
  await page.waitForTimeout(250);
  const sig = await page.evaluate(() => (window.odtEditor.docArea.layoutPending ? 'p' : window.odtEditor.docArea.pages.map((p) => p.startPos).join(',')));
  if (sig !== 'p' && sig === last) same++; else { same = 0; last = sig; }
}
await page.evaluate(() => window.odtEditor.registry.context().ui.print.prepare({ range: 'all' }));
const edPdf = path.join(tmp, 'editor.pdf');
await page.pdf({ path: edPdf, preferCSSPageSize: true, printBackground: true });
await browser.close();

// Rasterise both at 100 dpi and put them side by side.
for (const [pdf, pre] of [[loPdf, 'lo'], [edPdf, 'ed']]) execFileSync('pdftoppm', ['-r', '100', '-png', pdf, path.join(tmp, pre)], { stdio: 'pipe' });
const py = `
import glob, os, sys
from PIL import Image, ImageDraw
tmp, out, name = sys.argv[1], sys.argv[2], sys.argv[3]
lo = sorted(glob.glob(os.path.join(tmp, 'lo-*.png'))); ed = sorted(glob.glob(os.path.join(tmp, 'ed-*.png')))
for f in glob.glob(os.path.join(out, name + '-p*.png')): os.remove(f)
for i in range(max(len(lo), len(ed))):
    a = Image.open(lo[i]).convert('RGB') if i < len(lo) else None
    b = Image.open(ed[i]).convert('RGB') if i < len(ed) else None
    w = (a.width if a else b.width) + (b.width if b else a.width) + 30; h = max(x.height for x in (a, b) if x) + 28
    im = Image.new('RGB', (w, h), (64, 64, 64)); d = ImageDraw.Draw(im)
    d.text((8, 6), f'LibreOffice 24.2 — page {i + 1}', fill=(255, 255, 255))
    if a: im.paste(a, (0, 28))
    x = (a.width if a else b.width) + 30
    d.text((x + 8, 6), f'ODT Editor (PDF export) — page {i + 1}', fill=(255, 255, 255))
    if b: im.paste(b, (x, 28))
    im.save(os.path.join(out, f'{name}-p{i + 1}.png'))
print(len(lo), len(ed))
`;
writeFileSync(path.join(tmp, 'sbs.py'), py);
const counts = execFileSync('python3', [path.join(tmp, 'sbs.py'), tmp, outDir, name]).toString().trim();
console.log(`LibreOffice / editor pages: ${counts} → reference/compare/${name}-p*.png`);
