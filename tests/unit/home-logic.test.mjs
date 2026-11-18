import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, TextSelection } from 'prosemirror-state';
import { schema } from '../../src/core/schema.js';
import { buildRegex, wildcardToRegex, findAll, replacementFor } from '../../src/core/search.js';
import { formatNumber, makeListStyle, listLevels, computeListLabels } from '../../src/core/commands/lists.js';
import { CASES, changeCase, nextSize, applyTextProps, textPropsAtSelection } from '../../src/core/commands/text.js';
import { encodeStyleName } from '../../src/core/style-edit.js';

const p = (text) => schema.node('paragraph', null, text ? [schema.text(text)] : []);
const docOf = (...texts) => schema.node('doc', null, texts.map(p));

test('wildcards translate to regular expressions', () => {
  assert.equal(new RegExp(wildcardToRegex('c?t'), 'u').test('cat'), true);
  assert.equal(new RegExp(`^${wildcardToRegex('b*d')}$`, 'u').test('bread'), true);
  assert.equal(new RegExp(`^${wildcardToRegex('[!a]x')}$`, 'u').test('bx'), true);
  assert.equal(new RegExp(`^${wildcardToRegex('[!a]x')}$`, 'u').test('ax'), false);
  assert.equal(new RegExp(`^${wildcardToRegex('lo@k')}$`, 'u').test('loook'), true);
  assert.equal(new RegExp(`^${wildcardToRegex('10{2}')}$`, 'u').test('100'), true);
  const words = 'cats concatenate'.match(new RegExp(wildcardToRegex('<c?t*>'), 'gu'));
  assert.deepEqual(words, ['cats']);
});

test('buildRegex: match case, whole words, regex', () => {
  assert.equal(buildRegex({ query: 'Cat', matchCase: true }).test('cat'), false);
  assert.equal(buildRegex({ query: 'Cat' }).test('cat'), true);
  const whole = buildRegex({ query: 'cat', wholeWord: true });
  assert.equal('concatenate cat'.match(whole).length, 1);
  assert.equal(buildRegex({ query: 'a.c' }).test('abc'), false); // literal dot
  assert.equal(buildRegex({ query: 'a.c', regex: true }).test('abc'), true);
});

test('findAll maps matches to document positions; replacements use groups', () => {
  const doc = docOf('The cat sat', 'A cat ran');
  const ms = findAll(doc, { query: 'cat' });
  assert.equal(ms.length, 2);
  assert.equal(doc.textBetween(ms[0].from, ms[0].to), 'cat');
  assert.equal(doc.textBetween(ms[1].from, ms[1].to), 'cat');
  const [m] = findAll(doc, { query: '(\\w+) ran', regex: true });
  assert.equal(replacementFor(m, '$1 walked', { regex: true }), 'cat walked');
  assert.equal(replacementFor(m, '[^&]', {}), '[cat ran]');
});

test('list numbers: decimal, letters and roman numerals', () => {
  assert.equal(formatNumber(4, '1'), '4');
  assert.equal(formatNumber(28, 'a'), 'ab');
  assert.equal(formatNumber(14, 'I'), 'XIV');
  assert.equal(formatNumber(9, 'i'), 'ix');
  const style = makeListStyle('L1', [{ format: '1', suffix: '.', display: 10 }]);
  const levels = listLevels(style);
  assert.equal(levels.length, 10);
  assert.equal(levels[2].display, 3);
});

test('list labels honour levels, display-levels and start values', () => {
  const style = makeListStyle('L1', [{ format: '1', suffix: '.', display: 10 }]);
  const item = (text, extra = null, sub = null) => schema.node('list_item', { extra }, [p(text), ...(sub ? [sub] : [])]);
  const inner = schema.node('list', { styleName: null }, [item('a'), item('b')]);
  const list = schema.node('list', { styleName: 'L1', ordered: true }, [item('one', null, inner), item('two'), item('three', { 'text:start-value': '7' })]);
  const doc = schema.node('doc', null, [list]);
  const labels = [];
  computeListLabels(doc, () => style).find().sort((a, b) => a.from - b.from).forEach((d) => labels.push(d.type.attrs['data-label']));
  assert.deepEqual(labels, ['1.', '1.1.', '1.2.', '2.', '7.']);
});

test('change case modes', () => {
  assert.equal(CASES.sentence('hello WORLD. again'), 'Hello world. Again');
  assert.equal(CASES.capitalize('the quick-brown fox'), 'The Quick-Brown Fox');
  assert.equal(CASES.toggle('AbC'), 'aBc');
  let state = EditorState.create({ doc: docOf('make me loud') });
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 13)));
  // Shift+F3 cycles lowercase → Capitalised Each Word → UPPERCASE → lowercase.
  const cycle = () => changeCase(state, (tr) => { state = state.apply(tr); }, 'cycle');
  cycle();
  assert.equal(state.doc.textContent, 'Make Me Loud');
  cycle();
  assert.equal(state.doc.textContent, 'MAKE ME LOUD');
  cycle();
  assert.equal(state.doc.textContent, 'make me loud');
});

test('font size steps follow the size list', () => {
  assert.equal(nextSize(12, 1), 14);
  assert.equal(nextSize(12, -1), 11);
  assert.equal(nextSize(72, 1), 80);
  assert.equal(nextSize(8, -1), 7);
});

test('applyTextProps drops values equal to the style and initial values', () => {
  let state = EditorState.create({ doc: docOf('bold me') });
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 5)));
  const index = { effective: () => null };
  applyTextProps(state, (tr) => { state = state.apply(tr); }, index, { 'fo:font-weight': 'bold' });
  assert.equal(textPropsAtSelection(state, index)['fo:font-weight'], 'bold');
  applyTextProps(state, (tr) => { state = state.apply(tr); }, index, { 'fo:font-weight': 'normal' });
  let marks = 0;
  state.doc.descendants((n) => { if (n.isText) marks += n.marks.length; });
  assert.equal(marks, 0);
});

test('style names are encoded the ODF way', () => {
  assert.equal(encodeStyleName('Heading 1'), 'Heading_20_1');
  assert.equal(encodeStyleName('My-Style'), 'My_2d_Style');
});
