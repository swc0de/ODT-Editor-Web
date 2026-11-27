import test from 'node:test';
import assert from 'node:assert/strict';
import { SAVE_FORMATS, TEMPLATE_FORMATS, formatForName, formatById, stripExt, saveTypes, openTypes, canWriteBack, DEFAULT_FORMAT_CHOICES } from '../../src/core/formats.js';
import { lossesFor } from '../../src/core/losses.js';
import { schema } from '../../src/core/schema.js';

test('the Save as type list: seven formats in Word\'s order', () => {
  assert.deepEqual(SAVE_FORMATS.map((f) => f.exts[0]), ['.docx', '.odt', '.xml', '.html', '.txt', '.pdf', '.xps']);
  assert.deepEqual(SAVE_FORMATS.map((f) => f.kind), ['native', 'native', 'native', 'lossy', 'lossy', 'fixed', 'fixed']);
  assert.deepEqual(TEMPLATE_FORMATS.map((f) => f.id), ['dotx', 'ott']);
  assert.deepEqual(DEFAULT_FORMAT_CHOICES, ['docx', 'odt']);
});

test('formats by name, extensions, write-back', () => {
  assert.equal(formatForName('Report.DOCX').id, 'docx');
  assert.equal(formatForName('page.htm').id, 'html');
  assert.equal(formatForName('a.markdown').id, 'md');
  assert.equal(formatForName('x.pdf').kind, 'fixed');
  assert.equal(formatForName('noext'), null);
  assert.equal(stripExt('My.Report.odt'), 'My.Report');
  assert.equal(stripExt('notes.v2'), 'notes.v2');
  assert.ok(canWriteBack('txt') && canWriteBack('xml') && !canWriteBack('pdf') && !canWriteBack('rtf') && !canWriteBack(null));
  // M16: PDF and XPS are written (as copies: Save never writes back to them).
  assert.notEqual(formatById('xps').available, false);
  assert.notEqual(formatById('pdf').available, false);
});

test('picker types: current format first; PDF/XPS offered last; Open lists every readable type', () => {
  assert.deepEqual(saveTypes('txt').map((t) => Object.values(t.accept)[0][0]), ['.txt', '.docx', '.odt', '.xml', '.html', '.pdf', '.xps']);
  const open = openTypes();
  assert.deepEqual(Object.values(open[0].accept)[0], ['.docx', '.dotx', '.xml', '.odt', '.ott', '.htm', '.html', '.txt', '.rtf', '.md']);
});

const doc = (content) => ({ doc: schema.nodeFromJSON({ type: 'doc', content }), masterStyles: { c: [] } });
const bold = { type: 'textProps', attrs: { auto: { styleAttrs: {}, props: { 'style:text-properties': { a: { 'fo:font-weight': 'bold' } } } } } };

test('lossesFor: text loses formatting, tables, notes; DOCX and ODT lose only content of the other dialect', () => {
  const st = doc([
    { type: 'paragraph', content: [{ type: 'text', text: 'Bold', marks: [bold] }, { type: 'note', attrs: { body: [{ type: 'paragraph' }] } }, { type: 'opaque_inline', attrs: { xml: '<x/>', dialect: 'ooxml' } }] },
    { type: 'table', content: [{ type: 'table_row', content: [{ type: 'table_cell', content: [{ type: 'paragraph' }] }] }] },
    { type: 'opaque_block', attrs: { xml: '<text:x/>' } },
  ]);
  const ids = (f) => lossesFor(st, f).map((l) => `${l.id}:${l.count}`);
  assert.deepEqual(ids('txt'), ['textFormat:1', 'tables:1', 'notes:1', 'opaque:2']);
  assert.deepEqual(ids('docx'), ['opaqueOdf:1']);
  assert.deepEqual(ids('odt'), ['opaqueOoxml:1']);
  assert.deepEqual(lossesFor(st, 'xml', { flavour: 'flat-odt' }).map((l) => l.id), ['opaqueOoxml']);
  assert.deepEqual(ids('html'), ['opaque:2']);
  // Word-only package parts.
  const w = { ...doc([{ type: 'paragraph' }]), docxSource: { files: { 'customXml/item1.xml': 1, 'word/glossary/document.xml': 1, 'word/vbaProject.bin': 1, 'word/_rels/x.rels': 1 } } };
  assert.deepEqual(lossesFor(w, 'odt').map((l) => l.id), ['customXml', 'glossary', 'macros']);
  // Drawing objects: Word shows them as pictures.
  const d = doc([{ type: 'paragraph', content: [{ type: 'frame', attrs: { kind: 'ink' } }, { type: 'frame', attrs: { kind: 'image' } }] }]);
  assert.deepEqual(ids.call(null, 'docx').length, 1);
  assert.deepEqual(lossesFor(d, 'docx').map((l) => `${l.id}:${l.count}`), ['frame-ink:1']);
});
