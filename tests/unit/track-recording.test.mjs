import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, TextSelection } from 'prosemirror-state';
import { schema } from '../../src/core/schema.js';
import { trackChangesPlugin, changesOf, resolveChanges } from '../../src/core/track-recording.js';

let author = 'Ada';
const plugin = trackChangesPlugin({ isOn: () => true, author: () => author });
const make = (...paras) => EditorState.create({ doc: schema.node('doc', null, paras.map((t) => schema.node('paragraph', null, t ? schema.text(t) : []))), plugins: [plugin] });
const at = (st, pos, to = pos) => st.apply(st.tr.setSelection(TextSelection.create(st.doc, pos, to)));
const view = (st) => {
  const out = [];
  st.doc.forEach((p) => {
    let s = '';
    p.forEach((n) => {
      const m = n.marks.map((x) => x.type.name);
      s += m.includes('deletion') ? `[-${n.text}-]` : m.includes('insertion') ? `[+${n.text}+]` : m.includes('formatChange') ? `[~${n.text}~]` : n.text;
    });
    out.push(s + (p.attrs.change ? (p.attrs.change.type === 'insertion' ? '¶+' : '¶-') : ''));
  });
  return out.join(' | ');
};

test('typing is recorded as an insertion; deleting your own insertion removes it', () => {
  let st = at(make('Hello world'), 7);
  st = st.apply(st.tr.insertText('big '));
  assert.equal(view(st), 'Hello [+big +]world');
  // Backspace over the last inserted char: really gone.
  st = st.apply(st.tr.delete(st.selection.from - 1, st.selection.from));
  assert.equal(view(st), 'Hello [+big+]world');
});

test('Backspace on old text marks it deleted and moves the caret before it', () => {
  let st = at(make('Hello world'), 7);
  st = st.apply(st.tr.delete(6, 7));
  assert.equal(view(st), 'Hello[- -]world');
  assert.equal(st.selection.from, 6);
  st = st.apply(st.tr.delete(5, 6));
  assert.equal(view(st), 'Hell[-o -]world');
});

test('Delete key moves the caret after the deleted text; selection replaced by typing', () => {
  let st = at(make('abcdef'), 3);
  st = st.apply(st.tr.delete(3, 4));
  assert.equal(view(st), 'ab[-c-]def');
  assert.equal(st.selection.from, 4);
  st = at(st, 5, 7);
  st = st.apply(st.tr.insertText('X'));
  assert.equal(view(st), 'ab[-c-]d[-ef-][+X+]');
  // Typing on: the caret stays after the new text.
  st = st.apply(st.tr.insertText('Y'));
  assert.equal(view(st), 'ab[-c-]d[-ef-][+XY+]');
});

test('Enter is an inserted paragraph break; joining paragraphs is a deleted break', () => {
  let st = at(make('OneTwo'), 4);
  st = st.apply(st.tr.split(4));
  assert.equal(view(st), 'One¶+ | Two');
  let st2 = at(make('First', 'Second'), 7);
  st2 = st2.apply(st2.tr.join(7));
  assert.equal(view(st2), 'First¶- | Second');
});

test('another author deleting your insertion keeps it, marked deleted', () => {
  let st = at(make('x'), 2);
  st = st.apply(st.tr.insertText('yz'));
  author = 'Ben';
  st = st.apply(st.tr.delete(2, 4));
  author = 'Ada';
  assert.equal(view(st), 'x[-yz-]');
  const c = changesOf(st.doc);
  assert.deepEqual(c.map((x) => [x.type, x.author]), [['insertion', 'Ada'], ['deletion', 'Ben']]);
});

test('accept and reject', () => {
  let st = at(make('Hello world', 'Next'), 7);
  st = st.apply(st.tr.insertText('big '));
  st = st.apply(st.tr.delete(11, 14)); // "wor" → deleted
  st = st.apply(st.tr.setSelection(TextSelection.create(st.doc, 1)));
  const base = view(st);
  assert.equal(base, 'Hello [+big +][-wor-]ld | Next');
  const accepted = st.apply(resolveChanges(st.tr.setMeta('tcSkip', true), changesOf(st.doc), true));
  assert.equal(view(accepted), 'Hello big ld | Next');
  const rejected = st.apply(resolveChanges(st.tr.setMeta('tcSkip', true), changesOf(st.doc), false));
  assert.equal(view(rejected), 'Hello world | Next');
  // Breaks: reject an inserted break joins; accept a deleted break joins.
  let s2 = at(make('OneTwo'), 4);
  s2 = s2.apply(s2.tr.split(4));
  assert.equal(view(s2.apply(resolveChanges(s2.tr.setMeta('tcSkip', true), changesOf(s2.doc), false))), 'OneTwo');
  assert.equal(view(s2.apply(resolveChanges(s2.tr.setMeta('tcSkip', true), changesOf(s2.doc), true))), 'One | Two');
});

test('formatting changes remember the old formatting for Reject', () => {
  let st = at(make('plain text'), 1, 6);
  const bold = schema.marks.textProps.create({ auto: { styleAttrs: {}, props: { 'style:text-properties': { a: { 'fo:font-weight': 'bold' } } } } });
  st = st.apply(st.tr.addMark(1, 6, bold));
  assert.equal(view(st), '[~plain~] text');
  const rej = st.apply(resolveChanges(st.tr.setMeta('tcSkip', true), changesOf(st.doc), false));
  assert.equal(view(rej), 'plain text');
  assert.equal(rej.doc.firstChild.firstChild.marks.length, 0);
});
