import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, TextSelection } from 'prosemirror-state';
import { schema } from '../../src/core/schema.js';
import {
  createTable, insertRows, insertColumns, deleteRows, deleteColumns, splitCells, mergeCells, applyBorders, cellProps,
  evalFormula, insertFormula, textToTable, tableToText, sortRows, splitTable, columnWidths, toggleHeaderRows, TableMap, CellSelection,
  alignCells, distributeColumns,
} from '../../src/core/commands/tables.js';

const W = 600;
const docWith = (table) => schema.node('doc', null, [table, schema.node('paragraph')]);
/** State with the caret in cell (row, col). */
function at(doc, row, col) {
  const table = doc.firstChild;
  const map = TableMap.get(table);
  const pos = 1 + map.map[row * map.width + col];
  return EditorState.create({ doc, selection: TextSelection.create(doc, pos + 2) });
}
const apply = (state, cmd) => { let s = state; cmd(s, (tr) => { s = s.apply(tr); }); return s; };
const grid = (s) => { const t = s.doc.firstChild; const m = TableMap.get(t); return [m.height, m.width]; };
const texts = (s) => { const out = []; s.doc.firstChild.forEach((r) => { const row = []; r.forEach((c) => row.push(c.textContent)); out.push(row); }); return out; };

test('createTable: rows × cols, grid borders, widths add up to the table width', () => {
  const t = createTable({ rows: 3, cols: 4, width: W });
  assert.equal(t.childCount, 3);
  assert.equal(TableMap.get(t).width, 4);
  assert.equal(cellProps(t.firstChild.firstChild)['fo:border'], '0.5pt solid #000000');
  const ws = columnWidths(t);
  assert.ok(Math.abs(ws.reduce((a, b) => a + b, 0) - W) < 1);
});

test('insert rows and columns copy formatting; delete restores', () => {
  let s = at(docWith(createTable({ rows: 2, cols: 2, width: W, text: (r, c) => `${r}${c}` })), 0, 0);
  s = apply(s, (st, d) => insertRows(st, d, true));
  assert.deepEqual(grid(s), [3, 2]);
  assert.deepEqual(texts(s)[1], ['', '']);
  assert.equal(cellProps(s.doc.firstChild.child(1).firstChild)['fo:border'], '0.5pt solid #000000');
  s = apply(s, (st, d) => insertColumns(st, d, true, { bodyWidth: W }));
  assert.deepEqual(grid(s), [3, 3]);
  const ws = columnWidths(s.doc.firstChild);
  assert.equal(ws.length, 3);
  assert.ok(Math.abs(ws.reduce((a, b) => a + b, 0) - W) < 1, 'table width kept');
  s = apply(s, (st, d) => deleteColumns(st, d, { bodyWidth: W }));
  assert.deepEqual(grid(s), [3, 2]);
  s = apply(s, (st, d) => deleteRows(st, d));
  assert.deepEqual(grid(s), [2, 2]);
});

test('merge and split cells', () => {
  const doc = docWith(createTable({ rows: 2, cols: 3, width: W, text: (r, c) => `${r}${c}` }));
  const table = doc.firstChild;
  const map = TableMap.get(table);
  let s = EditorState.create({ doc, selection: CellSelection.create(doc, 1 + map.map[0], 1 + map.map[1]) });
  s = apply(s, mergeCells);
  assert.equal(s.doc.firstChild.firstChild.firstChild.attrs.colspan, 2);
  s = apply(at(s.doc, 0, 0), (st, d) => splitCells(st, d, 2, 1, { bodyWidth: W }));
  assert.equal(s.doc.firstChild.firstChild.childCount, 3);
  // Split a single cell into 2 columns × 2 rows.
  s = apply(at(s.doc, 1, 1), (st, d) => splitCells(st, d, 2, 2, { bodyWidth: W }));
  assert.deepEqual(grid(s), [3, 4]);
});

test('borders: outside / inside / none on a selection', () => {
  const doc = docWith(createTable({ rows: 2, cols: 2, width: W, cell: null }));
  const map = TableMap.get(doc.firstChild);
  let s = EditorState.create({ doc, selection: CellSelection.create(doc, 1 + map.map[0], 1 + map.map[3]) });
  s = apply(s, (st, d) => applyBorders(st, d, null, 'outside', '1pt solid #ff0000'));
  const tl = cellProps(s.doc.firstChild.child(0).child(0));
  assert.equal(tl['fo:border-top'], '1pt solid #ff0000');
  assert.equal(tl['fo:border-left'], '1pt solid #ff0000');
  assert.equal(tl['fo:border-right'], 'none');
  s = apply(s, (st, d) => applyBorders(st, d, null, 'all', '0.5pt solid #000000'));
  assert.equal(cellProps(s.doc.firstChild.child(1).child(1))['fo:border'], '0.5pt solid #000000');
  s = apply(s, (st, d) => applyBorders(st, d, null, 'none', ''));
  assert.equal(cellProps(s.doc.firstChild.child(0).child(0))['fo:border'], 'none');
});

test('formulas: SUM(ABOVE), AVERAGE(LEFT), cell references', () => {
  const vals = [['1', '2', ''], ['3', '4', ''], ['', '', '']];
  const doc = docWith(createTable({ rows: 3, cols: 3, width: W, text: (r, c) => vals[r][c] }));
  let s = at(doc, 2, 0);
  assert.equal(evalFormula(s, '=SUM(ABOVE)').value, 4);
  assert.equal(evalFormula(at(doc, 1, 2), '=AVERAGE(LEFT)').value, 3.5);
  assert.equal(evalFormula(s, '=A1+B2*2').value, 9);
  assert.equal(evalFormula(s, '=MAX(A1:B2)').value, 4);
  assert.equal(evalFormula(s, '=SUM(ABOVE)').odf, 'ooow:sum <A1:A2>');
  assert.equal(evalFormula(at(doc, 1, 2), '=AVERAGE(LEFT)').odf, 'ooow:mean <A2:B2>');
  assert.equal(evalFormula(s, '=A1+B2*2').odf, 'ooow:<A1>+<B2>*2');
  assert.equal(evalFormula(s, '=MAX(A1:B2)/2').odf, 'ooow:max <A1:B2> /2');
  s = apply(s, (st, d) => insertFormula(st, d, '=SUM(ABOVE)'));
  const cell = s.doc.firstChild.child(2).child(0);
  assert.equal(cell.textContent, '4');
  assert.equal(cell.attrs.extra['office:value'], '4');
  assert.match(cell.attrs.extra['table:formula'], /^ooow:/);
  assert.throws(() => evalFormula(s, '=alert(1)'));
});

test('text ↔ table, sort, split table, header rows, alignment, distribute', () => {
  const p = (t) => schema.node('paragraph', null, t.split('\t').flatMap((x, i) => [...(i ? [schema.nodes.tab.create()] : []), ...(x ? [schema.text(x)] : [])]));
  const doc = schema.node('doc', null, [p('Name\tAge'), p('Zoe\t30'), p('Adam\t25')]);
  let s = EditorState.create({ doc, selection: TextSelection.create(doc, 1, doc.content.size - 1) });
  s = apply(s, (st, d) => textToTable(st, d, { separator: '\t', width: W }));
  assert.deepEqual(texts(s), [['Name', 'Age'], ['Zoe', '30'], ['Adam', '25']]);
  s = apply(at(s.doc, 1, 0), (st, d) => sortRows(st, d, { column: 0, type: 'text', hasHeader: true }));
  assert.deepEqual(texts(s).map((r) => r[0]), ['Name', 'Adam', 'Zoe']);
  s = apply(at(s.doc, 1, 0), (st, d) => sortRows(st, d, { column: 1, type: 'number', descending: true, hasHeader: true }));
  assert.deepEqual(texts(s).map((r) => r[1]), ['Age', '30', '25']);
  s = apply(at(s.doc, 0, 0), toggleHeaderRows);
  assert.equal(s.doc.firstChild.firstChild.attrs.header, true);
  s = apply(at(s.doc, 0, 0), (st, d) => alignCells(st, d, null, 'middle', 'center'));
  assert.equal(cellProps(s.doc.firstChild.firstChild.firstChild)['style:vertical-align'], 'middle');
  s = apply(at(s.doc, 0, 0), (st, d) => distributeColumns(st, d, { bodyWidth: W }));
  const ws = columnWidths(s.doc.firstChild);
  assert.ok(Math.abs(ws[0] - ws[1]) < 0.5);
  const split = apply(at(s.doc, 2, 0), splitTable);
  assert.equal(split.doc.childCount, 4); // table, paragraph, table, trailing paragraph
  const text = apply(at(s.doc, 0, 0), (st, d) => tableToText(st, d, '\t'));
  assert.equal(text.doc.firstChild.textContent, 'Name\tAge');
  assert.equal(text.doc.childCount, 4);
});
