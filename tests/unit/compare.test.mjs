import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schema } from '../../src/core/schema.js';
import { compareDocs } from '../../src/core/compare.js';
import { changesOf, resolveChanges } from '../../src/core/track-recording.js';
import { EditorState } from 'prosemirror-state';

const doc = (...ps) => schema.node('doc', null, ps.map((t) => schema.node('paragraph', null, t ? schema.text(t) : [])));
const texts = (d) => { const o = []; d.forEach((p) => o.push(p.textContent)); return o; };

test('compare marks changed words, inserted and deleted paragraphs; accept gives the revised text, reject the original', () => {
  const a = doc('The quick brown fox.', 'A paragraph to remove.', 'Unchanged end.');
  const b = doc('The quick red fox jumps.', 'Unchanged end.', 'A new last line.');
  const r = compareDocs(a, b, { author: 'Compare' });
  const kinds = changesOf(r).map((c) => c.type);
  assert.ok(kinds.includes('insertion') && kinds.includes('deletion'));
  const st = EditorState.create({ doc: r });
  const acc = st.apply(resolveChanges(st.tr, changesOf(r), true)).doc;
  assert.deepEqual(texts(acc), texts(b));
  const rej = st.apply(resolveChanges(st.tr, changesOf(r), false)).doc;
  assert.deepEqual(texts(rej).filter((x, i, arr) => x || i < arr.length - 1), texts(a));
});
