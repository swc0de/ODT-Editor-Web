/**
 * Structural checks of every ODT fixture: package layout per ODF 1.3
 * (mimetype first, stored, no extra field), manifest completeness and XML
 * well-formedness. Round-trip tests through the app arrive in M2.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listZipEntries, readZipText, checkWellFormed } from '../lib/odf.mjs';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const files = readdirSync(dir).filter((f) => /\.(odt|ott)$/.test(f)).sort();

const REQUIRED = [
  'formatting-zoo.odt', 'styles.odt', 'lists.odt', 'tables.odt', 'images.odt', 'headers-footers.odt',
  'footnotes.odt', 'toc.odt', 'comments.odt', 'tracked-changes.odt', 'sections-columns.odt',
  'bookmarks-fields.odt', 'long-50-pages.odt', 'long-100-pages.odt', 'template.ott',
];

test('all required fixtures exist, plus LibreOffice-written ones', () => {
  for (const f of REQUIRED) assert.ok(files.includes(f), `missing fixture ${f} — run npm run fixtures`);
  assert.ok(files.some((f) => f.startsWith('lo-')), 'no LibreOffice-exported fixture (lo-*.odt)');
});

for (const file of files) {
  test(`fixture ${file} is a valid ODF package`, () => {
    const bytes = new Uint8Array(readFileSync(path.join(dir, file)));
    const entries = listZipEntries(bytes);
    assert.equal(entries[0].name, 'mimetype', 'mimetype must be the first entry');
    assert.equal(entries[0].method, 0, 'mimetype must be stored');
    assert.equal(entries[0].extraLen, 0, 'mimetype must have no extra field');

    const zip = readZipText(bytes);
    const mime = zip.mimetype;
    assert.equal(mime, file.endsWith('.ott') ? 'application/vnd.oasis.opendocument.text-template' : 'application/vnd.oasis.opendocument.text');
    for (const name of ['content.xml', 'styles.xml', 'meta.xml', 'META-INF/manifest.xml']) assert.ok(zip[name], `${name} missing`);

    for (const [name, data] of Object.entries(zip)) {
      if (typeof data === 'string' && name.endsWith('.xml')) {
        const err = checkWellFormed(data);
        assert.equal(err, null, `${name}: ${err}`);
      }
    }

    const manifest = zip['META-INF/manifest.xml'];
    assert.match(manifest, new RegExp(`manifest:full-path="/"[^>]*manifest:media-type="${mime}"|manifest:media-type="${mime}"[^>]*manifest:full-path="/"`));
    for (const name of Object.keys(zip)) {
      if (name === 'mimetype' || name.startsWith('META-INF/') || name.endsWith('/')) continue;
      assert.ok(manifest.includes(`manifest:full-path="${name}"`), `${name} not listed in manifest`);
    }
  });
}
