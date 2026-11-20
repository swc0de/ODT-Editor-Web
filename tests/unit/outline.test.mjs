import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from 'prosemirror-state';
import { schema } from '../../src/core/schema.js';
import { outlineItems, subtreeEnd, sectionRange, moveSection, BODY } from '../../src/core/outline.js';

const H = (level, text) => schema.node('heading', { level, styleName: `Heading_20_${level}` }, [schema.text(text)]);
const P = (text) => schema.node('paragraph', null, [schema.text(text)]);
const doc = () => schema.node('doc', null, [H(1, 'A'), P('a1'), H(2, 'A.1'), P('a2'), H(1, 'B'), P('b1'), H(1, 'C')]);
const texts = (d) => { const o = []; d.forEach((n) => o.push(n.textContent)); return o; };

test('outline items and sections', () => {
  const items = outlineItems(doc());
  assert.deepEqual(items.map((i) => i.level), [1, BODY, 2, BODY, 1, BODY, 1]);
  assert.equal(subtreeEnd(items, 0), 4);
  assert.equal(subtreeEnd(items, 2), 4);
  const r = sectionRange(doc(), items[0].pos);
  assert.equal(r.from, 0);
  assert.equal(r.to, items[4].pos);
});

test('moving a section before another heading and to the end', () => {
  const d = doc();
  const items = outlineItems(d);
  let tr = EditorState.create({ doc: d }).tr;
  moveSection(tr, items[4].pos, items[0].pos);
  assert.deepEqual(texts(tr.doc), ['B', 'b1', 'A', 'a1', 'A.1', 'a2', 'C']);
  tr = EditorState.create({ doc: d }).tr;
  moveSection(tr, items[0].pos, null);
  assert.deepEqual(texts(tr.doc), ['B', 'b1', 'C', 'A', 'a1', 'A.1', 'a2']);
  // Into its own section: refused.
  tr = EditorState.create({ doc: d }).tr;
  assert.equal(moveSection(tr, items[0].pos, items[2].pos), null);
});
