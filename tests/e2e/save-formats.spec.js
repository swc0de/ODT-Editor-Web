/**
 * M15: DOCX as the default format; Save / Save As in the seven formats.
 *
 * File System Access is simulated with in-page pickers that record what they
 * were offered and what was written; without it, downloads are checked.
 */
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { openApp } from './helpers.js';

const OUT = path.resolve('test-results/save-formats');
const soffice = spawnSync('soffice', ['--version']).status === 0;

/** Fake showSaveFilePicker / showOpenFilePicker: offered options and written bytes go to window.__fs. */
const FAKE_FS = () => {
  window.__fs = { offered: [], written: {}, openQueue: [] };
  const handle = (name) => ({
    kind: 'file', name,
    queryPermission: async () => 'granted', requestPermission: async () => 'granted',
    async createWritable() { const chunks = []; return { write: async (b) => chunks.push(b), close: async () => { const blob = new Blob(chunks); window.__fs.written[name] = new Uint8Array(await blob.arrayBuffer()); } }; },
    async getFile() { return new File([window.__fs.written[name] || new Uint8Array()], name); },
  });
  window.showSaveFilePicker = async (opts) => {
    window.__fs.offered.push(opts);
    const want = window.__fs.nextName || opts.suggestedName;
    window.__fs.nextName = null;
    return handle(want);
  };
  window.showOpenFilePicker = async () => [handle(window.__fs.openQueue.shift())];
};

const info = (page) => page.evaluate(() => { const i = window.odtEditor.session.info; return { name: i.name, format: i.format, dirty: i.dirty, hasHandle: i.hasHandle, fileName: i.fileName }; });
/** Types at the end of the document. */
const type = async (page, text) => {
  await page.evaluate(() => { const v = window.odtEditor.editor.view; v.focus(); const end = window.odtEditor.pm.TextSelection.atEnd(v.state.doc); v.dispatch(v.state.tr.setSelection(end)); });
  await page.keyboard.type(text);
};
const written = async (page, name) => Buffer.from(await page.evaluate((n) => Array.from(window.__fs.written[n] || []), name));
const docText = (page) => page.evaluate(() => window.odtEditor.editor.getDoc().textContent);
async function openBytes(page, name, bytes) {
  await page.evaluate(async ({ b64, name }) => {
    const b = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await window.odtEditor.session.openBytes(b, { name, skipGuard: true });
  }, { b64: Buffer.from(bytes).toString('base64'), name });
}
const isDocx = (bytes) => { const z = unzipSync(new Uint8Array(bytes)); return !!z['[Content_Types].xml'] && strFromU8(z['[Content_Types].xml']).includes('wordprocessingml.document.main+xml') && !!z['word/document.xml']; };

test.describe('save formats', () => {
  test.beforeAll(() => mkdirSync(OUT, { recursive: true }));

  test.describe('with File System Access', () => {
    let problems;
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(FAKE_FS);
      problems = await openApp(page, { settings: { fileSystemAccess: true } });
    });
    test.afterEach(() => { expect([...problems.pageErrors, ...problems.consoleErrors]).toEqual([]); });

    test('new document → Ctrl+S: the picker offers .docx first and writes a valid DOCX', async ({ page }) => {
      await type(page, 'Hello Word');
      await page.keyboard.press('Control+s');
      await expect.poll(() => page.evaluate(() => window.__fs.offered.length)).toBe(1);
      const offered = await page.evaluate(() => window.__fs.offered[0]);
      expect(offered.suggestedName).toBe('Document1.docx');
      expect(Object.values(offered.types[0].accept)[0]).toEqual(['.docx']);
      expect(offered.types.map((x) => Object.values(x.accept)[0][0])).toEqual(['.docx', '.odt', '.xml', '.html', '.txt']);
      await expect.poll(() => info(page)).toMatchObject({ format: 'docx', dirty: false, hasHandle: true, fileName: 'Document1.docx' });
      expect(isDocx(await written(page, 'Document1.docx'))).toBe(true);
      // Shift+F12 saves too, writing back without a picker.
      await type(page, '!');
      await page.keyboard.press('Shift+F12');
      await expect.poll(() => info(page)).toMatchObject({ dirty: false });
      expect(await page.evaluate(() => window.__fs.offered.length)).toBe(1);
    });

    test('an opened .docx with a handle: edit → Ctrl+S writes back the same file in DOCX, no Save As', async ({ page }) => {
      const bytes = readFileSync('tests/fixtures/word-features.docx');
      await page.evaluate((b) => { window.__fs.written['report.docx'] = new Uint8Array(b); window.__fs.openQueue.push('report.docx'); }, [...bytes]);
      await page.keyboard.press('Control+o');
      await expect.poll(() => info(page)).toMatchObject({ name: 'report', format: 'docx', dirty: false, hasHandle: true });
      await type(page, 'Changed ');
      await expect.poll(async () => (await info(page)).dirty).toBe(true);
      await page.keyboard.press('Control+s');
      await expect.poll(async () => (await info(page)).dirty).toBe(false);
      expect(await page.evaluate(() => window.__fs.offered.length)).toBe(0);
      const out = await written(page, 'report.docx');
      expect(isDocx(out)).toBe(true);
      expect(strFromU8(unzipSync(new Uint8Array(out))['word/document.xml'])).toContain('Changed');
    });

    test('Save As picks the format from the chosen extension; PDF / XPS are not offered yet', async ({ page }) => {
      await type(page, 'Formats');
      for (const [name, format] of [['a.odt', 'odt'], ['b.xml', 'xml'], ['c.docx', 'docx']]) {
        await page.evaluate((n) => { window.__fs.nextName = n; }, name);
        await page.keyboard.press('F12');
        await expect.poll(async () => (await info(page)).fileName).toBe(name);
        expect(await info(page)).toMatchObject({ format, dirty: false, hasHandle: true });
      }
      // The document's current format comes first (Word XML when c.docx was chosen).
      const types = await page.evaluate(() => window.__fs.offered.at(-1).types.map((x) => Object.values(x.accept)[0][0]));
      expect(types[0]).toBe('.xml');
      expect(types).not.toContain('.pdf');
      // The Backstage Save As page fills the picker from its name and type.
      await page.evaluate(() => window.odtEditor.registry.run('file.saveAsPage'));
      await page.locator('[data-saveas-name]').fill('Renamed');
      await page.locator('[data-saveas-type]').selectOption('odt');
      await page.locator('[data-saveas-save]').click();
      await expect.poll(async () => (await info(page)).fileName).toBe('Renamed.odt');
      expect(await page.evaluate(() => window.__fs.offered.at(-1).suggestedName)).toBe('Renamed.odt');
    });

    test('lossy formats: the compatibility prompt lists what is lost; Don’t ask again; Save as Word Document', async ({ page }) => {
      await type(page, 'Bold here');
      await page.keyboard.press('Control+a');
      await page.keyboard.press('Control+b');
      await page.evaluate(() => { window.__fs.nextName = 'page.html'; });
      await page.keyboard.press('F12');
      const dlg = page.locator('.dlg');
      await expect(dlg).toContainText('“Document1” may contain features that aren’t compatible with Web Page.');
      await dlg.locator('[data-dont-ask]').check();
      await dlg.getByRole('button', { name: 'Keep current format' }).click();
      await expect.poll(() => info(page)).toMatchObject({ format: 'html', fileName: 'page.html', dirty: false });
      const html = (await written(page, 'page.html')).toString('utf8');
      expect(html).toContain('id="odte-source"');
      // Don't ask again: the next save doesn't ask.
      await type(page, ' more');
      await page.keyboard.press('Control+s');
      await expect.poll(async () => (await info(page)).dirty).toBe(false);
      await expect(page.locator('.dlg')).toHaveCount(0);
      // Plain Text asks (with the lost features listed); Save as Word Document goes to Save As with .docx.
      await page.evaluate(() => { window.__fs.nextName = 'notes.txt'; });
      await page.keyboard.press('F12');
      await expect(page.locator('.dlg [data-loss="textFormat"]')).toBeVisible();
      await page.evaluate(() => { window.__fs.nextName = 'back.docx'; });
      await page.locator('.dlg').getByRole('button', { name: 'Save as Word Document' }).click();
      await expect.poll(() => info(page)).toMatchObject({ format: 'docx', fileName: 'back.docx' });
    });

    test('the File Conversion dialog: encoding, line endings, substitution, preview with unencodable characters', async ({ page }) => {
      await type(page, 'Café “quotes” – €5 ✓');
      await page.evaluate(() => { window.__fs.nextName = 'plain.txt'; });
      await page.keyboard.press('F12');
      await page.locator('.dlg').getByRole('button', { name: 'Keep current format' }).click();
      const conv = page.locator('.dlg', { hasText: 'File Conversion' });
      await expect(conv).toBeVisible();
      await conv.locator('[data-option="encoding"]').selectOption('iso-8859-1');
      await expect(conv.locator('.sv-bad')).toHaveCount(5); // “ ” – € ✓
      await conv.locator('[data-option="substitute"]').check();
      await expect(conv.locator('.sv-bad')).toHaveCount(1); // quotes, dash and € have ASCII substitutes; ✓ doesn't
      await conv.locator('[data-option="lineEnding"]').selectOption('lf');
      await conv.getByRole('button', { name: 'OK' }).click();
      await expect.poll(() => info(page)).toMatchObject({ format: 'txt', fileName: 'plain.txt' });
      const bytes = await written(page, 'plain.txt');
      expect(bytes.toString('latin1')).toBe('Café "quotes" - EUR5 ?\n');
      expect(await page.locator('[data-status-format]').textContent()).toBe('Plain Text');
    });

    test('password: a protected DOCX is encrypted (Agile) and reopens only with the password', async ({ page }) => {
      test.setTimeout(240_000);
      await type(page, 'Secret plans');
      await page.evaluate(() => window.odtEditor.session.setPassword('pa55'));
      await page.evaluate(() => { window.__fs.nextName = 'secret.docx'; });
      await page.keyboard.press('F12');
      await expect.poll(() => info(page)).toMatchObject({ fileName: 'secret.docx', dirty: false });
      const enc = await written(page, 'secret.docx');
      expect([...enc.subarray(0, 4)]).toEqual([0xd0, 0xcf, 0x11, 0xe0]);
      writeFileSync(path.join(OUT, 'secret.docx'), enc);
      // LibreOffice and msoffcrypto-tool (independent implementations) decrypt it.
      if (soffice && existsSync('/usr/lib/libreoffice/program/pythonloader.py')) {
        const py = spawnSync('python3', [path.resolve('tests/lib/lo-open-encrypted.py'), path.join(OUT, 'secret.docx'), 'pa55', OUT], { timeout: 180_000 });
        expect(py.stdout.toString()).toContain('Secret plans');
      }
      if (spawnSync('python3', ['-c', 'import msoffcrypto']).status === 0) {
        const r = spawnSync('python3', ['-I', path.resolve('tests/lib/msoffcrypto-check.py'), path.join(OUT, 'secret.docx'), 'pa55', path.join(OUT, 'secret-dec.docx')]);
        expect(r.status).toBe(0);
        expect(isDocx(readFileSync(path.join(OUT, 'secret-dec.docx')))).toBe(true);
      }
      await page.evaluate(() => window.odtEditor.session.newDocument({ skipGuard: true }));
      await page.evaluate((b) => { window.__openDone = window.odtEditor.session.openBytes(new Uint8Array(b), { name: 'secret.docx', skipGuard: true }); }, [...enc]);
      await page.locator('.pw-dlg input[type=password]').fill('wrong');
      await page.locator('.dlg button.primary').click();
      await expect(page.locator('.pw-error')).toHaveText('The password is incorrect. Try again.');
      await page.locator('.pw-dlg input[type=password]').fill('pa55');
      await page.locator('.dlg button.primary').click();
      await expect.poll(() => docText(page)).toBe('Secret plans');
      expect(await page.evaluate(() => window.odtEditor.session.protected)).toBe(true);
      expect(await info(page)).toMatchObject({ format: 'docx', dirty: false });
      // Cancelling the password keeps the current document.
      await page.evaluate((b) => { window.__openDone = window.odtEditor.session.openBytes(new Uint8Array(b), { name: 'secret.docx', skipGuard: true }); }, [...enc]);
      await page.locator('.dlg button', { hasText: 'Cancel' }).click();
      expect(await page.evaluate(() => window.__openDone)).toBe(false);
      // A format that can't keep a password asks.
      await page.evaluate(() => { window.__fs.nextName = 'open.txt'; });
      await page.keyboard.press('F12');
      await expect(page.locator('.dlg')).toContainText('can’t be protected with a password');
      await page.locator('.dlg').getByRole('button', { name: 'Cancel' }).click();
    });
  });

  test.describe('without File System Access', () => {
    let problems;
    test.beforeEach(async ({ page }) => { problems = await openApp(page); });
    test.afterEach(() => { expect([...problems.pageErrors, ...problems.consoleErrors]).toEqual([]); });

    test('Save As each format from the Backstage page: download, file, format and dirty state', async ({ page }) => {
      await type(page, 'Seven formats');
      const expectations = [['docx', 'Report.docx', 'docx'], ['odt', 'Report.odt', 'odt'], ['xml', 'Report.xml', 'xml'], ['html', 'Report.html', 'html'], ['txt', 'Report.txt', 'txt']];
      for (const [id, fileName, format] of expectations) {
        await type(page, '.');
        await page.keyboard.press('F12');
        await page.locator('[data-saveas-name]').fill('Report');
        await page.locator('[data-saveas-type]').selectOption(id);
        const dl = page.waitForEvent('download');
        await page.locator('[data-saveas-save]').click();
        if (id === 'html' || id === 'txt') await page.locator('.dlg').getByRole('button', { name: 'Keep current format' }).click();
        if (id === 'txt') await page.locator('.dlg', { hasText: 'File Conversion' }).getByRole('button', { name: 'OK' }).click();
        const d = await dl;
        expect(d.suggestedFilename()).toBe(fileName);
        const file = path.join(OUT, `nofsa-${fileName}`);
        await d.saveAs(file);
        await expect.poll(() => info(page)).toMatchObject({ format, fileName, dirty: false, hasHandle: false });
        // Each file reopens with the text.
        await openBytes(page, fileName, readFileSync(file));
        await expect.poll(() => docText(page)).toContain('Seven formats');
        expect((await info(page)).format).toBe(format);
      }
      // PDF and XPS are listed but not available until the PDF/XPS writers exist.
      await page.keyboard.press('F12');
      const opts = await page.locator('[data-saveas-type] option').evaluateAll((os) => os.map((o) => [o.textContent, o.disabled]));
      expect(opts).toEqual([['Word Document (*.docx)', false], ['OpenDocument Text (*.odt)', false], ['Word XML Document (*.xml)', false], ['Web Page (*.htm; *.html)', false], ['Plain Text (*.txt)', false], ['PDF (*.pdf)', true], ['XPS Document (*.xps)', true]]);
    });

    test('keyboard: Alt+F, A opens Save As; the status bar names Web Page / Plain Text / Word XML; Recent shows format icons', async ({ page }) => {
      await page.locator('.ProseMirror').first().click();
      await page.keyboard.press('Alt');
      await page.keyboard.press('f');
      await expect(page.locator('.backstage')).toBeVisible();
      await page.keyboard.press('a');
      await expect(page.locator('[data-saveas-type]')).toBeVisible();
      await expect(page.locator('[data-saveas-type]')).toHaveValue('docx');
      await page.keyboard.press('Escape');
      for (const [name, label] of [['a.txt', 'Plain Text'], ['b.html', 'Web Page'], ['c.docx', '']]) {
        const bytes = name.endsWith('.docx') ? readFileSync('tests/fixtures/word-features.docx') : Buffer.from(name.endsWith('.html') ? '<p>x</p>' : 'x');
        await openBytes(page, name, bytes);
        await expect.poll(() => page.locator('[data-status-format]').textContent()).toBe(label);
      }
      await expect.poll(async () => (await page.evaluate(async () => (await window.odtEditor.session.listRecent()).map((e) => e.name))).sort()).toEqual(['a.txt', 'b.html', 'c.docx']);
      await page.evaluate(() => window.odtEditor.registry.run('file.openPage'));
      // Each with its format's icon (an original page with the format's name) and its extension.
      const row = page.locator('.bs-recent-row', { hasText: 'c.docx' });
      await expect(row.locator('.bs-recent-icon svg text')).toHaveText('DOCX');
      await expect(page.locator('.bs-recent-row', { hasText: 'a.txt' }).locator('.bs-recent-icon svg text')).toHaveText('TXT');
    });

    test('Options ▸ Save "Save files in this format": OpenDocument Text → new documents save as .odt', async ({ page }) => {
      await page.evaluate(() => { window.odtEditor.registry.run('file.options'); });
      await page.locator('.opt-nav-item[data-section="save"]').click();
      await page.locator('[data-option="defaultFormat"]').selectOption('odt');
      await page.locator('.dlg button.primary').click();
      await type(page, 'ODT by default');
      await page.keyboard.press('Control+s');
      await expect(page.locator('[data-saveas-type]')).toHaveValue('odt');
      const dl = page.waitForEvent('download');
      await page.locator('[data-saveas-save]').click();
      expect((await dl).suggestedFilename()).toBe('Document1.odt');
    });

    test('Web Page keeps the document for lossless reopening; without it, text, headings, lists, tables and pictures survive', async ({ page }) => {
      await openBytes(page, 'word-features.docx', readFileSync('tests/fixtures/word-features.docx'));
      const model = () => page.evaluate(() => { const sort = (v) => (Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).filter((k) => k !== 'ooxml' && k !== 'part').sort().map((k) => [k, sort(v[k])])) : v); return JSON.stringify(sort(window.odtEditor.editor.getDoc().toJSON())); });
      const before = await model();
      const html = Buffer.from(await page.evaluate(async () => Array.from(await window.odtEditor.session.serializeAs('html', { keepSource: true }))));
      expect(html.toString('utf8')).toMatch(/<script type="application\/x-odte-flatopc\+xml" id="odte-source">/);
      await openBytes(page, 'kept.html', html);
      expect(await model()).toBe(before);
      // Without the embedded source.
      const plain = Buffer.from(await page.evaluate(async () => Array.from(await window.odtEditor.session.serializeAs('html', { keepSource: false }))));
      expect(plain.toString('utf8')).not.toContain('odte-source');
      await openBytes(page, 'plain.html', plain);
      const kinds = await page.evaluate(() => { const s = new Set(); window.odtEditor.editor.getDoc().descendants((n) => { s.add(n.type.name); }); return [...s]; });
      expect(kinds).toEqual(expect.arrayContaining(['heading', 'list', 'table', 'frame']));
      // A damaged embedded source falls back to the page.
      const broken = html.toString('utf8').replace(/(id="odte-source">)[\s\S]{40}/, '$1<garbage');
      await openBytes(page, 'broken.html', Buffer.from(broken));
      expect((await info(page)).format).toBe('html');
      expect(await docText(page)).not.toBe('');
    });

    test('Word XML and flat ODT open and save back without loss', async ({ page }) => {
      const model = () => page.evaluate(() => { const sort = (v) => (Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).filter((k) => k !== 'ooxml' && k !== 'part').sort().map((k) => [k, sort(v[k])])) : v); return JSON.stringify(sort(window.odtEditor.editor.getDoc().toJSON())); });
      await openBytes(page, 'word-features.docx', readFileSync('tests/fixtures/word-features.docx'));
      const before = await model();
      const xml = Buffer.from(await page.evaluate(async () => Array.from(await window.odtEditor.session.serializeAs('xml'))));
      expect(xml.toString('utf8')).toMatch(/^<\?xml version="1.0" standalone="yes"\?>\r\n<\?mso-application progid="Word.Document"\?>\r\n<pkg:package /);
      await openBytes(page, 'word.xml', xml);
      expect(await info(page)).toMatchObject({ format: 'xml', dirty: false });
      expect(await model()).toBe(before);
      // Flat ODT (an .xml file with office:document) opens and is written back as flat ODT.
      await openBytes(page, 'styles.odt', readFileSync('tests/fixtures/styles.odt'));
      const odtModel = await model();
      const fodt = Buffer.from(await page.evaluate(async () => Array.from(await window.odtEditor.session.serializeAs('xml', { flavour: 'flat-odt' }))));
      expect(fodt.toString('utf8')).toContain('<office:document ');
      writeFileSync(path.join(OUT, 'flat.xml'), fodt);
      await openBytes(page, 'flat.xml', fodt);
      expect(await info(page)).toMatchObject({ format: 'xml' });
      expect(await page.evaluate(() => window.odtEditor.session.info.options.flavour)).toBe('flat-odt');
      expect(await model()).toBe(odtModel);
      // LibreOffice opens our flat ODT.
      if (soffice) {
        const r = spawnSync('soffice', [`-env:UserInstallation=file://${OUT}/lo-profile`, '--headless', '--convert-to', 'txt:Text (encoded):UTF8', '--outdir', OUT, path.join(OUT, 'flat.xml')], { timeout: 120_000 });
        expect(r.status).toBe(0);
        expect(existsSync(path.join(OUT, 'flat.txt'))).toBe(true);
      }
    });

    test('Plain Text: identical text for every encoding and line ending', async ({ page }) => {
      await type(page, 'Line one');
      await page.keyboard.press('Enter');
      await page.keyboard.type('Line two – Café');
      const text = await page.evaluate(() => window.odtEditor.editor.getDoc().textBetween(0, window.odtEditor.editor.getDoc().content.size, '\n'));
      for (const encoding of ['utf-8', 'utf-8-bom', 'utf-16le', 'utf-16be', 'windows-1252', 'iso-8859-1', 'us-ascii']) {
        for (const lineEnding of ['crlf', 'lf', 'cr']) {
          const subst = encoding === 'iso-8859-1' || encoding === 'us-ascii';
          const bytes = Buffer.from(await page.evaluate(async (o) => Array.from(await window.odtEditor.session.serializeAs('txt', o)), { encoding, lineEnding, substitute: subst }));
          const eol = { crlf: '\r\n', lf: '\n', cr: '\r' }[lineEnding];
          await openBytes(page, `${encoding}-${lineEnding}.txt`, bytes);
          const got = await page.evaluate(() => window.odtEditor.editor.getDoc().textBetween(0, window.odtEditor.editor.getDoc().content.size, '\n'));
          const want = encoding === 'us-ascii' ? text.replace('–', '-').replace('é', '?') : encoding === 'iso-8859-1' ? text.replace('–', '-') : text;
          expect(got, `${encoding} ${lineEnding}`).toBe(want);
          expect(await page.evaluate(() => window.odtEditor.session.info.options.lineEnding)).toBe(lineEnding);
          void eol;
          // Back to the original document.
          await page.evaluate((t) => { const s = window.odtEditor.session; return s.openBytes(new TextEncoder().encode(t), { name: 'src.txt', skipGuard: true }); }, text);
        }
      }
    });
  });
});
