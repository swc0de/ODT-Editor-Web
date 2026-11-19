import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schema } from '../../src/core/schema.js';
import { importChanges, exportChanges } from '../../src/core/track-changes.js';

const A = { author: 'Ada', date: '2026-01-01T10:00:00', old: null };
const ins = (cid) => ({ type: 'insertion', attrs: { ...A, cid } });
const del = (cid) => ({ type: 'deletion', attrs: { ...A, cid } });
const T = (text, ...marks) => ({ type: 'text', text, ...(marks.length ? { marks } : {}) });
const P = (content, change = null, styleName = 'Standard') => ({ type: 'paragraph', attrs: { styleName, auto: null, extra: null, change }, ...(content.length ? { content } : {}) });

/** export → import gives the same model (regions read back like the importer does). */
function roundTrip(blocks) {
  const doc = schema.nodeFromJSON({ type: 'doc', content: blocks }).toJSON();
  const { doc: out, regions } = exportChanges(doc);
  const map = new Map(regions.map((r) => [r.id, { type: r.type, author: r.author, date: r.date, blocks: r.blocks }]));
  const back = importChanges(out.content, map);
  return { out, regions, back: schema.nodeFromJSON({ type: 'doc', content: back.blocks }).toJSON(), doc };
}

test('inline insertion and deletion', () => {
  const r = roundTrip([P([T('Keep '), T('new ', ins('c1')), T('old ', del('c2')), T('end.')])]);
  assert.deepEqual(r.back, r.doc);
  assert.deepEqual(r.out.content[0].content.map((n) => n.type === 'change_marker' ? `${n.attrs.kind}:${n.attrs.changeId}` : n.text), ['Keep ', 'start:c1', 'new ', 'end:c1', 'point:c2', 'end.']);
  assert.equal(r.regions.find((x) => x.id === 'c2').blocks[0].content[0].text, 'old ');
});

test('a deletion across a paragraph break merges the paragraphs in ODF and splits them back', () => {
  const blocks = [
    P([T('First '), T('gone', del('d1'))], { type: 'deletion', ...A, cid: 'd1' }),
    P([T('also gone', del('d1')), T(' second.')], null, 'Quote'),
  ];
  const r = roundTrip(blocks);
  assert.equal(r.out.content.length, 1);
  assert.equal(r.regions[0].blocks.length, 2);
  assert.equal(r.regions[0].blocks[1].attrs.styleName, 'Quote');
  assert.deepEqual(r.back, r.doc);
});

test('only a paragraph break deleted', () => {
  const r = roundTrip([P([T('One')], { type: 'deletion', ...A, cid: 'd2' }), P([T('Two')])]);
  assert.equal(r.out.content.length, 1);
  assert.equal(r.regions[0].blocks.length, 2);
  assert.deepEqual(r.back, r.doc);
});

test('an inserted paragraph spans the break', () => {
  const blocks = [
    P([T('Old text'), T(' added', ins('i1'))], { type: 'insertion', ...A, cid: 'i1' }),
    P([T('New paragraph', ins('i1'))]),
    P([T('Untouched')]),
  ];
  const r = roundTrip(blocks);
  assert.equal(r.regions.length, 1);
  assert.deepEqual(r.back, r.doc);
});

test('an inserted empty paragraph (Enter only)', () => {
  const r = roundTrip([P([T('Line')], { type: 'insertion', ...A, cid: 'i2' }), P([T('Next')])]);
  assert.deepEqual(r.back, r.doc);
});
