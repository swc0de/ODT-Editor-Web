/**
 * Table editing on the ODF table model: table / column / row / cell
 * formatting lives in each node's `auto` (an automatic style), so every
 * command edits node attributes and the exporter writes de-duplicated
 * automatic styles. Structure uses prosemirror-tables (TableMap, cell
 * selections); new rows, columns and cells copy the formatting of their
 * neighbours, like Word.
 */
import { Fragment } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';
import {
  TableMap, CellSelection, selectedRect, isInTable, addColumn, addRow, removeColumn, removeRow, mergeCells, splitCell, deleteTable,
} from 'prosemirror-tables';
import { schema } from '../schema.js';
import { autoFromTree, mergeAuto } from '../odt/styles.js';
import { toPx, pxToLength } from '../../layout/units.js';

const { table: TABLE, table_row: ROW, table_cell: CELL, paragraph: PARA } = schema.nodes;
const CP = 'style:table-cell-properties';
const TP = 'style:table-properties';
const COLP = 'style:table-column-properties';
const RP = 'style:table-row-properties';
const PP = 'style:paragraph-properties';
const cm = (px) => pxToLength(px, 'cm', 3);

export { isInTable, CellSelection, TableMap, selectedRect };

// ------------------------------------------------------------ formatting helpers

/** Effective automatic formatting of a table/row/cell node (its auto, or its kept style). */
export function nodeAuto(node, docState, family) {
  if (node.attrs.auto) return node.attrs.auto;
  if (!node.attrs.styleName) return null;
  const t = (docState?.contentAutoStyles || []).find((x) => x.n === 'style:style' && x.a['style:family'] === family && x.a['style:name'] === node.attrs.styleName);
  return t ? autoFromTree(t).auto : null;
}

/** New auto with attribute changes on one properties element (null deletes). */
export function changeAuto(auto, key, change) {
  const out = auto ? structuredClone(auto) : { styleAttrs: {}, props: {} };
  out.props = out.props || {};
  const p = out.props[key] || { a: {} };
  p.a = { ...p.a };
  for (const [k, v] of Object.entries(change)) { if (v == null) delete p.a[k]; else p.a[k] = v; }
  if (Object.keys(p.a).length || p.c?.length) out.props[key] = p; else delete out.props[key];
  return Object.keys(out.props).length || Object.keys(out.styleAttrs || {}).length ? out : null;
}

export const cellProps = (cell, docState) => nodeAuto(cell, docState, 'table-cell')?.props?.[CP]?.a || {};

/** Table context at the selection: { table, tablePos, tableStart, map, rect } or null. */
export function tableAt(state) {
  if (!isInTable(state)) return null;
  const rect = selectedRect(state);
  return { table: rect.table, tableStart: rect.tableStart, tablePos: rect.tableStart - 1, map: rect.map, rect };
}

/** Cells in the selection rectangle: [{ node, pos, row, col, rect }] (each once). */
export function selectedCells(state) {
  const t = tableAt(state);
  if (!t) return [];
  const { map, table, tableStart, rect } = t;
  return map.cellsInRect(rect).map((rel) => {
    const r = map.findCell(rel);
    return { node: table.nodeAt(rel), pos: tableStart + rel, row: r.top, col: r.left, rect: r };
  });
}

/** Applies fn(cell, info) → { auto?, attrs? } to the selected cells as one step. */
export function updateCells(state, dispatch, docState, fn, cells = selectedCells(state)) {
  if (!cells.length) return false;
  if (dispatch) {
    const tr = state.tr;
    for (const c of cells) {
      const ch = fn(c.node, c);
      if (!ch) continue;
      tr.setNodeMarkup(c.pos, null, { ...c.node.attrs, ...(ch.attrs || {}), ...('auto' in ch ? { auto: ch.auto, styleName: null } : {}) });
    }
    dispatch(tr);
  }
  return true;
}

/** Sets cell properties (null removes) on the selected cells. */
export const setCellProps = (state, dispatch, docState, change, cells) => updateCells(state, dispatch, docState, (cell) => ({ auto: changeAuto(nodeAuto(cell, docState, 'table-cell'), CP, change) }), cells);

// ------------------------------------------------------------ columns

/** Column entries expanded to one per grid column. */
export function expandColumns(table) {
  const out = [];
  for (const c of table.attrs.columns || []) for (let i = 0; i < (c.repeat || 1); i++) out.push({ ...c, repeat: 1 });
  const w = TableMap.get(table).width;
  while (out.length < w) out.push({ ...(out[out.length - 1] || { styleName: null, auto: null, defaultCellStyle: null, extra: null, width: null }), repeat: 1 });
  return out.slice(0, w);
}

/** Merges equal neighbouring column entries (table:number-columns-repeated). */
export function compressColumns(cols) {
  const out = [];
  for (const c of cols) {
    const last = out[out.length - 1];
    const key = (x) => JSON.stringify([x.styleName, x.auto, x.defaultCellStyle, x.extra]);
    if (last && key(last) === key(c)) last.repeat += 1;
    // Same key order as the importer builds, so models compare equal after a round-trip.
    else out.push({ styleName: c.styleName ?? null, auto: c.auto ?? null, repeat: 1, defaultCellStyle: c.defaultCellStyle ?? null, extra: c.extra ?? null, width: c.width ?? null });
  }
  return out;
}

/** Column widths in px (from the column styles, else measured from the DOM, else equal). */
export function columnWidths(table, dom = null, bodyWidth = 640) {
  const cols = expandColumns(table);
  const abs = cols.map((c) => toPx(c.auto?.props?.[COLP]?.a?.['style:column-width'] || c.width || '') || 0);
  if (abs.every((w) => w > 0)) return abs;
  if (dom) {
    const colEls = dom.querySelectorAll(':scope > colgroup > col');
    const measured = [...colEls].map((c) => c.getBoundingClientRect().width);
    if (measured.length === cols.length && measured.every((w) => w > 0)) return measured;
  }
  return cols.map(() => bodyWidth / cols.length);
}

/** Column entry with an absolute width. */
const columnWith = (c, px) => ({
  ...c, styleName: null, width: cm(px),
  auto: changeAuto(c.auto, COLP, { 'style:column-width': cm(px), 'style:rel-column-width': `${Math.round(px * 100)}*` }),
});

/** Table attrs with new column widths (px) and the table width kept in step. */
export function withWidths(table, widths) {
  const cols = expandColumns(table).map((c, i) => columnWith(c, widths[i]));
  const total = widths.reduce((a, b) => a + b, 0);
  const tAuto = changeAuto(table.attrs.auto, TP, { 'style:width': cm(total), 'style:rel-width': null });
  return { ...table.attrs, styleName: table.attrs.auto ? null : table.attrs.styleName, auto: tAuto, columns: compressColumns(cols) };
}

// ------------------------------------------------------------ creating tables

/** Default cell look for new tables ("Table Grid"). */
export const GRID_CELL = { 'fo:border': '0.5pt solid #000000', 'fo:padding': '0.097cm' };

/** Creates a table node: rows × cols, total width (px), cell contents from `text(r, c)`. */
export function createTable({ rows, cols, width, text = null, cell = GRID_CELL, widths = null, header = false }) {
  const ws = widths || Array.from({ length: cols }, () => width / cols);
  const cellAuto = cell ? changeAuto(null, CP, cell) : null;
  const rowNodes = [];
  for (let r = 0; r < rows; r++) {
    const cells = [];
    for (let c = 0; c < cols; c++) {
      const t = text?.(r, c);
      cells.push(CELL.create({ auto: cellAuto }, PARA.create({ styleName: 'Table_20_Contents' }, t ? schema.text(t) : null)));
    }
    rowNodes.push(ROW.create({ header: header && r === 0 }, cells));
  }
  const base = TABLE.create({ auto: changeAuto(null, TP, { 'style:width': cm(width), 'table:align': 'margins' }), columns: [] }, rowNodes);
  return TABLE.create(withWidths(base, ws), rowNodes);
}

/** Inserts a table at the selection (after the current paragraph when it isn't empty). */
export function insertTable(state, dispatch, table) {
  if (!dispatch) return true;
  const tr = state.tr;
  const { $from } = state.selection;
  const para = $from.parent;
  if (para.isTextblock && para.content.size === 0 && $from.depth > 0) {
    tr.replaceWith($from.before(), $from.after(), [table, PARA.create({ styleName: para.attrs.styleName })]);
    tr.setSelection(TextSelection.create(tr.doc, $from.before() + 4));
  } else {
    const at = $from.depth > 0 ? $from.after() : $from.pos;
    tr.insert(at, table);
    tr.setSelection(TextSelection.create(tr.doc, at + 4));
  }
  dispatch(tr.scrollIntoView());
  return true;
}

// ------------------------------------------------------------ rows and columns

/** A fresh cell shaped like `ref` (formatting kept, content empty with the same paragraph style). */
function cellLike(ref) {
  const first = ref?.firstChild;
  const p = PARA.create({ styleName: first?.isTextblock ? first.attrs.styleName : 'Table_20_Contents', auto: first?.isTextblock ? first.attrs.auto : null });
  return CELL.create({ ...(ref?.attrs || {}), colspan: 1, rowspan: 1, colwidth: null }, p);
}

/** Insert rows above/below the selection (as many as are selected), formatted like the selection's edge row. */
export function insertRows(state, dispatch, below) {
  const t = tableAt(state);
  if (!t) return false;
  if (!dispatch) return true;
  const { rect } = t;
  const n = rect.bottom - rect.top;
  const tr = state.tr;
  for (let i = 0; i < n; i++) {
    const at = below ? rect.bottom + i : rect.top;
    addRow(tr, selectedRectFor(tr, rect.tableStart), at);
    // Reference row in the new table: just above (below) or just below (above).
    copyRowFormatting(tr, rect.tableStart, below ? at - 1 : at + 1, at);
  }
  dispatch(tr.scrollIntoView());
  return true;
}

function selectedRectFor(tr, tableStart) {
  const table = tr.doc.nodeAt(tableStart - 1);
  const map = TableMap.get(table);
  return { map, table, tableStart, left: 0, right: map.width, top: 0, bottom: map.height };
}

/** Cells of the new row `at` (and the row itself) take the formatting of row `ref`. */
function copyRowFormatting(tr, tableStart, ref, at) {
  const table = tr.doc.nodeAt(tableStart - 1);
  const map = TableMap.get(table);
  const refRow = table.child(ref);
  let rowPos = tableStart;
  for (let i = 0; i < at; i++) rowPos += table.child(i).nodeSize;
  tr.setNodeMarkup(rowPos, null, { ...table.child(at).attrs, styleName: refRow.attrs.styleName, auto: refRow.attrs.auto, header: false });
  for (let col = 0; col < map.width; col++) {
    const pos = map.map[at * map.width + col];
    const r = map.findCell(pos);
    if (r.top !== at || r.left !== col) continue;
    const cell = table.nodeAt(pos);
    const refCell = table.nodeAt(map.map[ref * map.width + col]);
    tr.setNodeMarkup(tableStart + pos, null, { ...cell.attrs, styleName: refCell.attrs.styleName, auto: refCell.attrs.auto });
    const first = cell.firstChild;
    const refFirst = refCell.firstChild;
    if (first?.isTextblock && refFirst?.isTextblock) tr.setNodeMarkup(tableStart + pos + 1, null, { ...first.attrs, styleName: refFirst.attrs.styleName, auto: refFirst.attrs.auto });
  }
}

/** Insert columns left/right of the selection, keeping the table width. */
export function insertColumns(state, dispatch, right, { bodyWidth = 640, dom = null } = {}) {
  const t = tableAt(state);
  if (!t) return false;
  if (!dispatch) return true;
  const { rect } = t;
  const n = rect.right - rect.left;
  const oldWidths = columnWidths(t.table, dom, bodyWidth);
  const total = oldWidths.reduce((a, b) => a + b, 0);
  let tr = state.tr;
  const at0 = right ? rect.right : rect.left;
  for (let i = 0; i < n; i++) {
    const r = selectedRectFor(tr, rect.tableStart);
    tr = addColumn(tr, r, at0 + i);
  }
  // Formatting from the neighbouring column; widths scaled to the old total.
  const table = tr.doc.nodeAt(rect.tableStart - 1);
  const map = TableMap.get(table);
  const refCol = right ? rect.right - 1 : rect.left + n;
  for (let row = 0; row < map.height; row++) {
    for (let k = 0; k < n; k++) {
      const col = at0 + k;
      const pos = map.map[row * map.width + col];
      const cell = table.nodeAt(pos);
      const r = map.findCell(pos);
      if (r.left !== col || r.top !== row || cell.attrs.colspan > 1) continue;
      const refCell = table.nodeAt(map.map[row * map.width + refCol]);
      tr.setNodeMarkup(rect.tableStart + pos, null, { ...cell.attrs, styleName: refCell.attrs.styleName, auto: refCell.attrs.auto });
      const first = cell.firstChild;
      const refFirst = refCell.firstChild;
      if (first?.isTextblock && refFirst?.isTextblock && !first.content.size) tr.setNodeMarkup(rect.tableStart + pos + 1, null, { ...first.attrs, styleName: refFirst.attrs.styleName, auto: refFirst.attrs.auto });
    }
  }
  const widths = [...oldWidths];
  const refW = oldWidths[right ? rect.right - 1 : rect.left];
  widths.splice(at0, 0, ...Array.from({ length: n }, () => refW));
  const scale = total / widths.reduce((a, b) => a + b, 0);
  const t2 = tr.doc.nodeAt(rect.tableStart - 1);
  const oldCols = expandColumns(t.table);
  const cols = [...oldCols];
  cols.splice(at0, 0, ...Array.from({ length: n }, () => ({ ...oldCols[right ? rect.right - 1 : rect.left] })));
  const tmp = t2.type.create({ ...t2.attrs, columns: compressColumns(cols) }, t2.content);
  tr.setNodeMarkup(rect.tableStart - 1, null, withWidths(tmp, widths.map((w) => w * scale)));
  dispatch(tr.scrollIntoView());
  return true;
}

/** Deletes the selected rows (the table when all rows are selected). */
export function deleteRows(state, dispatch) {
  const t = tableAt(state);
  if (!t) return false;
  if (t.rect.top === 0 && t.rect.bottom === t.map.height) return deleteTable(state, dispatch);
  if (!dispatch) return true;
  let tr = state.tr;
  for (let row = t.rect.bottom - 1; row >= t.rect.top; row--) removeRow(tr, selectedRectFor(tr, t.rect.tableStart), row);
  dispatch(tr.scrollIntoView());
  return true;
}

/** Deletes the selected columns, giving their width to the remaining ones. */
export function deleteColumns(state, dispatch, { bodyWidth = 640, dom = null } = {}) {
  const t = tableAt(state);
  if (!t) return false;
  if (t.rect.left === 0 && t.rect.right === t.map.width) return deleteTable(state, dispatch);
  if (!dispatch) return true;
  const widths = columnWidths(t.table, dom, bodyWidth);
  const total = widths.reduce((a, b) => a + b, 0);
  let tr = state.tr;
  for (let col = t.rect.right - 1; col >= t.rect.left; col--) removeColumn(tr, selectedRectFor(tr, t.rect.tableStart), col);
  const left = widths.filter((_, i) => i < t.rect.left || i >= t.rect.right);
  const cols = expandColumns(t.table).filter((_, i) => i < t.rect.left || i >= t.rect.right);
  const t2 = tr.doc.nodeAt(t.rect.tableStart - 1);
  const scale = total / left.reduce((a, b) => a + b, 0);
  const tmp = t2.type.create({ ...t2.attrs, columns: compressColumns(cols) }, t2.content);
  tr.setNodeMarkup(t.rect.tableStart - 1, null, withWidths(tmp, left.map((w) => w * scale)));
  dispatch(tr.scrollIntoView());
  return true;
}

export { mergeCells, deleteTable };

/**
 * Split Cells: the selected cell becomes `cols` × `rows` cells. A merged cell
 * is first split back; extra columns/rows are added to the grid and the other
 * cells in them are widened/heightened to keep the layout.
 */
export function splitCells(state, dispatch, cols, rows, opts = {}) {
  const t = tableAt(state);
  if (!t) return false;
  const cell = selectedCells(state)[0];
  if (!cell) return false;
  if (!dispatch) return true;
  let st = state;
  const step = (fn) => fn(st, (tr) => { st = st.apply(tr); trs.push(tr); });
  const trs = [];
  if (cell.node.attrs.colspan > 1 || cell.node.attrs.rowspan > 1) step(splitCell);
  const pos0 = cell.pos;
  const extraCols = Math.max(0, cols - cell.node.attrs.colspan);
  const extraRows = Math.max(0, rows - cell.node.attrs.rowspan);
  const sel = (s) => s.tr.setSelection(TextSelection.create(s.doc, Math.min(s.doc.content.size, pos0 + 2)));
  if (extraCols) {
    st = st.apply(sel(st));
    for (let i = 0; i < extraCols; i++) step((s, d) => insertColumns(s, d, true, opts));
    // Other rows keep one cell across the new columns.
    const tt = tableAt(st);
    const tr = st.tr;
    const col = cell.col;
    for (let row = tt.map.height - 1; row >= 0; row--) {
      if (row >= cell.row && row < cell.rect.bottom) continue;
      const pos = tt.map.map[row * tt.map.width + col];
      const r = tt.map.findCell(pos);
      if (r.top !== row) continue;
      const c = tt.table.nodeAt(pos);
      const rm = [];
      for (let k = 1; k <= extraCols; k++) rm.push(tt.map.map[row * tt.map.width + col + k]);
      let content = c.content;
      for (const p of rm.reverse()) { const x = tt.table.nodeAt(p); if (x.textContent) content = content.append(x.content); tr.delete(tr.mapping.map(tt.tableStart + p), tr.mapping.map(tt.tableStart + p + x.nodeSize)); }
      tr.replaceWith(tr.mapping.map(tt.tableStart + pos), tr.mapping.map(tt.tableStart + pos + c.nodeSize), c.type.create({ ...c.attrs, colspan: c.attrs.colspan + extraCols }, content));
    }
    st = st.apply(tr);
    trs.push(tr);
  }
  if (extraRows) {
    st = st.apply(sel(st));
    for (let i = 0; i < extraRows; i++) step((s, d) => insertRows(s, d, true));
    const tt = tableAt(st);
    const tr = st.tr;
    for (let col = tt.map.width - 1; col >= 0; col--) {
      if (col >= cell.col && col < cell.col + cols) continue;
      const pos = tt.map.map[cell.row * tt.map.width + col];
      const r = tt.map.findCell(pos);
      if (r.left !== col || r.top !== cell.row) continue;
      const c = tt.table.nodeAt(pos);
      for (let k = 1; k <= extraRows; k++) {
        const p = tt.map.map[(cell.row + k) * tt.map.width + col];
        const x = tt.table.nodeAt(p);
        tr.delete(tr.mapping.map(tt.tableStart + p), tr.mapping.map(tt.tableStart + p + x.nodeSize));
      }
      tr.setNodeMarkup(tr.mapping.map(tt.tableStart + pos), null, { ...c.attrs, rowspan: c.attrs.rowspan + extraRows });
    }
    st = st.apply(tr);
    trs.push(tr);
  }
  const out = state.tr;
  for (const t2 of trs) for (const s of t2.steps) out.step(s);
  dispatch(out.scrollIntoView());
  return true;
}

/** Splits the table above the current row (an empty paragraph goes between). */
export function splitTable(state, dispatch) {
  const t = tableAt(state);
  if (!t || t.rect.top === 0) return false;
  if (!dispatch) return true;
  const at = t.rect.top;
  const rows = [];
  t.table.forEach((r) => rows.push(r));
  // Row spans that cross the split end at it.
  const first = rows.slice(0, at).map((row, ri) => {
    const cells = [];
    row.forEach((c) => cells.push(c.attrs.rowspan > 1 && ri + c.attrs.rowspan > at ? c.type.create({ ...c.attrs, rowspan: at - ri }, c.content) : c));
    return row.copy(Fragment.fromArray(cells));
  });
  const second = rows.slice(at).map((r, i) => (i === 0 && r.attrs.header ? r.type.create({ ...r.attrs, header: false }, r.content) : r));
  const extra2 = t.table.attrs.extra ? Object.fromEntries(Object.entries(t.table.attrs.extra).filter(([k]) => k !== 'table:name')) : null;
  const t1 = t.table.type.create(t.table.attrs, first);
  const t2 = t.table.type.create({ ...t.table.attrs, extra: extra2 && Object.keys(extra2).length ? extra2 : null }, second);
  const tr = state.tr.replaceWith(t.tablePos, t.tablePos + t.table.nodeSize, [t1, PARA.create({ styleName: 'Standard' }), t2]);
  tr.setSelection(TextSelection.create(tr.doc, t.tablePos + t1.nodeSize + 1));
  dispatch(tr.scrollIntoView());
  return true;
}

// ------------------------------------------------------------ sizes

/** Sets the width (px) of the selected columns; neighbours on the right give or take the difference. */
export function setColumnWidth(state, dispatch, px, opts = {}) {
  const t = tableAt(state);
  if (!t) return false;
  if (!dispatch) return true;
  const widths = columnWidths(t.table, opts.dom, opts.bodyWidth);
  for (let c = t.rect.left; c < t.rect.right; c++) {
    const diff = px - widths[c];
    widths[c] = px;
    const next = c + 1 < widths.length && !(c + 1 < t.rect.right) ? c + 1 : -1;
    if (next >= 0 && opts.keepTotal !== false) widths[next] = Math.max(10, widths[next] - diff);
  }
  dispatch(state.tr.setNodeMarkup(t.tablePos, null, withWidths(t.table, widths)));
  return true;
}

export function setWidths(state, dispatch, widths) {
  const t = tableAt(state);
  if (!t) return false;
  if (dispatch) dispatch(state.tr.setNodeMarkup(t.tablePos, null, withWidths(t.table, widths)));
  return true;
}

/** Row height (px; rule 'atLeast' | 'exactly') for the selected rows. */
export function setRowHeight(state, dispatch, docState, px, rule = 'atLeast') {
  const t = tableAt(state);
  if (!t) return false;
  if (!dispatch) return true;
  const tr = state.tr;
  let pos = t.tableStart;
  t.table.forEach((row, _o, i) => {
    if (i >= t.rect.top && i < t.rect.bottom) {
      const auto = changeAuto(nodeAuto(row, docState, 'table-row'), RP, rule === 'exactly' ? { 'style:row-height': cm(px), 'style:min-row-height': null } : { 'style:min-row-height': cm(px), 'style:row-height': null });
      tr.setNodeMarkup(pos, null, { ...row.attrs, styleName: null, auto });
    }
    pos += row.nodeSize;
  });
  dispatch(tr);
  return true;
}

/** Distribute Rows: the selected rows get the same height (the tallest's). */
export function distributeRows(state, dispatch, docState, rowHeights) {
  const t = tableAt(state);
  if (!t) return false;
  const sel = rowHeights.slice(t.rect.top, t.rect.bottom);
  const avg = sel.reduce((a, b) => a + b, 0) / Math.max(1, sel.length);
  return setRowHeight(state, dispatch, docState, avg, 'atLeast');
}

/** Distribute Columns: the selected columns (all when one cell) share their total width. */
export function distributeColumns(state, dispatch, opts = {}) {
  const t = tableAt(state);
  if (!t) return false;
  const widths = columnWidths(t.table, opts.dom, opts.bodyWidth);
  let a = t.rect.left;
  let b = t.rect.right;
  if (b - a < 2) { a = 0; b = widths.length; }
  const total = widths.slice(a, b).reduce((x, y) => x + y, 0);
  for (let i = a; i < b; i++) widths[i] = total / (b - a);
  return setWidths(state, dispatch, widths);
}

// ------------------------------------------------------------ borders

export const SIDES = ['top', 'bottom', 'left', 'right'];
const side = (a, s) => a[`fo:border-${s}`] ?? a['fo:border'];
const hasSide = (a, s) => { const v = side(a, s); return !!v && v !== 'none'; };

/**
 * Applies borders to the selection rectangle. kind: 'all' | 'none' | 'outside' |
 * 'inside' | 'insideH' | 'insideV' | 'top' | 'bottom' | 'left' | 'right'.
 * Toggling a single outside edge removes it when it's already there.
 */
export function applyBorders(state, dispatch, docState, kind, line) {
  const t = tableAt(state);
  if (!t) return false;
  const R = t.rect;
  const cells = selectedCells(state);
  const want = (c, s) => {
    const edge = { top: c.rect.top === R.top, bottom: c.rect.bottom === R.bottom, left: c.rect.left === R.left, right: c.rect.right === R.right }[s];
    switch (kind) {
      case 'all': return true;
      case 'none': return false;
      case 'outside': return edge ? true : undefined;
      case 'inside': return edge ? undefined : true;
      case 'insideH': return (s === 'top' || s === 'bottom') && !edge ? true : undefined;
      case 'insideV': return (s === 'left' || s === 'right') && !edge ? true : undefined;
      default: return s === kind && edge ? 'toggle' : undefined;
    }
  };
  const allOn = SIDES.includes(kind) && cells.filter((c) => want(c, kind) === 'toggle').every((c) => hasSide(cellProps(c.node, docState), kind));
  return updateCells(state, dispatch, docState, (cell, info) => {
    const a = cellProps(cell, docState);
    const change = { 'fo:border': null };
    for (const s of SIDES) {
      let w = want(info, s);
      if (w === 'toggle') w = !allOn;
      const cur = hasSide(a, s) ? side(a, s) : 'none';
      change[`fo:border-${s}`] = w === undefined ? cur : (w ? line : 'none');
    }
    if (SIDES.every((s) => change[`fo:border-${s}`] === change['fo:border-top'])) {
      change['fo:border'] = change['fo:border-top'];
      for (const s of SIDES) change[`fo:border-${s}`] = null;
    }
    return { auto: changeAuto(nodeAuto(cell, docState, 'table-cell'), CP, change) };
  }, cells);
}

/** Border Painter: paints one edge of a cell (and the neighbour's facing edge). */
export function paintEdge(state, dispatch, docState, cellPos, sideName, line) {
  const $c = state.doc.resolve(cellPos + 1);
  let d = $c.depth;
  while (d > 0 && $c.node(d).type !== TABLE) d--;
  if (!d) return false;
  const table = $c.node(d);
  const tableStart = $c.start(d);
  const map = TableMap.get(table);
  const rel = cellPos - tableStart;
  const r = map.findCell(rel);
  const cells = [{ node: table.nodeAt(rel), pos: cellPos, side: sideName }];
  const nb = { top: [r.top - 1, r.left], bottom: [r.bottom, r.left], left: [r.top, r.left - 1], right: [r.top, r.right] }[sideName];
  if (nb[0] >= 0 && nb[0] < map.height && nb[1] >= 0 && nb[1] < map.width) {
    const p = map.map[nb[0] * map.width + nb[1]];
    if (p !== rel) cells.push({ node: table.nodeAt(p), pos: tableStart + p, side: { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }[sideName] });
  }
  if (dispatch) {
    const tr = state.tr;
    for (const c of cells) {
      const a = cellProps(c.node, docState);
      const change = { 'fo:border': null };
      for (const s of SIDES) change[`fo:border-${s}`] = s === c.side ? line : (hasSide(a, s) ? side(a, s) : 'none');
      tr.setNodeMarkup(c.pos, null, { ...c.node.attrs, styleName: null, auto: changeAuto(nodeAuto(c.node, docState, 'table-cell'), CP, change) });
    }
    dispatch(tr);
  }
  return true;
}

// ------------------------------------------------------------ alignment, direction, margins

/** Cell alignment: vertical 'top'|'middle'|'bottom', horizontal 'start'|'center'|'end'. */
export function alignCells(state, dispatch, docState, vertical, horizontal) {
  const cells = selectedCells(state);
  if (!cells.length) return false;
  if (!dispatch) return true;
  const tr = state.tr;
  for (const c of cells) {
    tr.setNodeMarkup(c.pos, null, { ...c.node.attrs, styleName: null, auto: changeAuto(nodeAuto(c.node, docState, 'table-cell'), CP, { 'style:vertical-align': vertical }) });
    c.node.descendants((n, p) => {
      if (!n.isTextblock) return true;
      const auto = changeAuto(n.attrs.auto, PP, { 'fo:text-align': horizontal === 'start' ? null : horizontal });
      tr.setNodeMarkup(c.pos + 1 + p, null, { ...n.attrs, auto });
      return false;
    });
  }
  dispatch(tr);
  return true;
}

export const cellAlignment = (state, docState) => {
  const c = selectedCells(state)[0];
  if (!c) return null;
  const v = cellProps(c.node, docState)['style:vertical-align'] || 'top';
  const p = c.node.firstChild?.isTextblock ? mergeAuto(null, c.node.firstChild.attrs.auto)?.props?.[PP]?.a?.['fo:text-align'] : null;
  return { vertical: v === 'automatic' ? 'top' : v, horizontal: { left: 'start', right: 'end', center: 'center', end: 'end', justify: 'start' }[p] || 'start' };
};

/** Cell margins (padding, px) for every cell of the table. */
export function setCellMargins(state, dispatch, docState, { top, bottom, left, right }) {
  const t = tableAt(state);
  if (!t) return false;
  const cells = [];
  t.table.descendants((n, p) => { if (n.type === CELL) { cells.push({ node: n, pos: t.tableStart + p }); return false; } return true; });
  return updateCells(state, dispatch, docState, (cell) => ({ auto: changeAuto(nodeAuto(cell, docState, 'table-cell'), CP, { 'fo:padding': null, 'fo:padding-top': cm(top), 'fo:padding-bottom': cm(bottom), 'fo:padding-left': cm(left), 'fo:padding-right': cm(right) }) }), cells.map((c) => ({ ...c })));
}

// ------------------------------------------------------------ header rows

/** Repeat Header Rows: rows from the top through the selection become header rows (toggle). */
export function toggleHeaderRows(state, dispatch) {
  const t = tableAt(state);
  if (!t) return false;
  const on = !t.table.child(t.rect.top).attrs.header;
  if (dispatch) {
    const tr = state.tr;
    let pos = t.tableStart;
    t.table.forEach((row, _o, i) => {
      const want = on ? i < t.rect.bottom : (i < t.rect.top && row.attrs.header);
      if (row.attrs.header !== want) tr.setNodeMarkup(pos, null, { ...row.attrs, header: want });
      pos += row.nodeSize;
    });
    dispatch(tr);
  }
  return true;
}

// ------------------------------------------------------------ conversions

/** Convert Text to Table: the selected paragraphs, split by a separator. */
export function textToTable(state, dispatch, { separator = '\t', cols = null, width = 640 }) {
  const { $from, $to } = state.selection;
  const start = $from.before(1);
  const end = $to.after(1);
  const lines = [];
  state.doc.nodesBetween(start, end, (n) => {
    if (!n.isTextblock) return true;
    const parts = [[]];
    n.forEach((ch) => {
      if (separator === '\t' && ch.type.name === 'tab') { parts.push([]); return; }
      if (ch.isText && separator !== '\t' && separator !== '\n') {
        ch.text.split(separator).forEach((s, i) => { if (i) parts.push([]); if (s) parts[parts.length - 1].push(schema.text(s, ch.marks)); });
        return;
      }
      parts[parts.length - 1].push(ch);
    });
    lines.push(separator === '\n' ? [[...(n.content.content || [])]] : parts);
    return false;
  });
  let rows;
  if (separator === '\n') {
    const n = Math.max(1, cols || 1);
    const flat = lines.map((l) => l[0]);
    rows = [];
    for (let i = 0; i < flat.length; i += n) rows.push(flat.slice(i, i + n));
  } else rows = lines;
  const ncol = Math.max(cols || 1, ...rows.map((r) => r.length));
  const table = createTable({ rows: rows.length, cols: ncol, width });
  const filled = table.copy(Fragment.fromArray(table.content.content.map((row, ri) => row.copy(Fragment.fromArray(row.content.content.map((cell, ci) => {
    const inl = rows[ri][ci] || [];
    return cell.copy(Fragment.from(PARA.create({ styleName: 'Table_20_Contents' }, inl.filter((x) => x.isInline))));
  }))))));
  // Like Word, a table is always followed by a paragraph.
  const after = end >= state.doc.content.size ? [filled, PARA.create({ styleName: 'Standard' })] : [filled];
  if (dispatch) {
    const tr = state.tr.replaceWith(start, end, after);
    // The caret goes into the first cell, so the table tabs apply straight away.
    tr.setSelection(TextSelection.create(tr.doc, start + 4));
    dispatch(tr.scrollIntoView());
  }
  return true;
}

/** Convert Table to Text: rows become paragraphs, cells joined by the separator ('\t', ',', '\n' = paragraphs). */
export function tableToText(state, dispatch, separator = '\t') {
  const t = tableAt(state);
  if (!t) return false;
  const paras = [];
  t.table.forEach((row) => {
    const parts = [];
    row.forEach((cell) => { const p = []; cell.forEach((b) => { if (b.isTextblock) p.push(b); }); parts.push(p); });
    if (separator === '\n') { for (const p of parts) for (const b of p) paras.push(b); return; }
    const inl = [];
    parts.forEach((p, i) => {
      if (i) inl.push(separator === '\t' ? schema.nodes.tab.create() : schema.text(separator));
      p.forEach((b, j) => { if (j) inl.push(schema.text(' ')); b.forEach((x) => inl.push(x)); });
    });
    paras.push(PARA.create({ styleName: 'Standard' }, inl));
  });
  if (dispatch) dispatch(state.tr.replaceWith(t.tablePos, t.tablePos + t.table.nodeSize, paras.length ? paras : [PARA.create()]).scrollIntoView());
  return true;
}

// ------------------------------------------------------------ sort

/** Sorts body rows by a column: type 'text' | 'number' | 'date'; header rows stay. */
export function sortRows(state, dispatch, { column = 0, type = 'text', descending = false, hasHeader = true }) {
  const t = tableAt(state);
  if (!t) return false;
  const rows = [];
  t.table.forEach((r) => rows.push(r));
  if (rows.some((r) => { let span = false; r.forEach((c) => { if (c.attrs.rowspan > 1) span = true; }); return span; })) return false;
  const head = hasHeader ? rows.filter((r, i) => r.attrs.header || i === 0).slice(0, Math.max(1, rows.filter((r) => r.attrs.header).length)) : [];
  const body = rows.slice(head.length);
  const keyOf = (r) => {
    let txt = '';
    let col = 0;
    r.forEach((c) => { if (col <= column && column < col + c.attrs.colspan) txt = c.textContent.trim(); col += c.attrs.colspan; });
    if (type === 'number') return parseFloat(txt.replace(/[^\d.-]/g, '')) || 0;
    if (type === 'date') return Date.parse(txt) || 0;
    return txt.toLocaleLowerCase();
  };
  body.sort((a, b) => { const x = keyOf(a); const y = keyOf(b); const r = typeof x === 'number' ? x - y : String(x).localeCompare(String(y)); return descending ? -r : r; });
  if (dispatch) dispatch(state.tr.replaceWith(t.tableStart, t.tableStart + t.table.content.size, [...head, ...body]));
  return true;
}

// ------------------------------------------------------------ formula

const colLetters = (n) => { let s = ''; n += 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const num = (s) => { const v = parseFloat(String(s).replace(/[^\d.,-]/g, '').replace(/,/g, '')); return Number.isFinite(v) ? v : null; };

/**
 * Evaluates a Word-style table formula (=SUM(ABOVE), =AVERAGE(LEFT),
 * =MAX(A1:B3), =A1*2…) for the current cell. Returns { value, odf } or throws.
 */
export function evalFormula(state, formula) {
  const t = tableAt(state);
  if (!t) throw new Error('not in a table');
  const { map, table } = t;
  const cur = selectedCells(state)[0];
  const valueAt = (row, col) => {
    if (row < 0 || col < 0 || row >= map.height || col >= map.width) return null;
    return num(table.nodeAt(map.map[row * map.width + col]).textContent);
  };
  const ref = (s) => { const m = /^([A-Z]+)(\d+)$/i.exec(s); if (!m) throw new Error(`bad reference ${s}`); let col = 0; for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64); return [Number(m[2]) - 1, col - 1]; };
  const name = (r, c) => `${colLetters(c)}${r + 1}`;
  /** Values of a function argument, and the argument in LibreOffice Writer syntax (<B1:B3>). */
  const range = (arg) => {
    const out = [];
    const a = arg.trim().toUpperCase();
    const run = (dr, dc) => {
      let r = cur.row + dr; let c = cur.col + dc; let last = null;
      while (r >= 0 && c >= 0 && r < map.height && c < map.width) { const v = valueAt(r, c); if (v == null && out.length) break; if (v != null) { out.push(v); last = [r, c]; } r += dr; c += dc; }
      const near = [cur.row + dr, cur.col + dc];
      if (!last) return `<${name(...near)}>`;
      const [a1, a2] = dr + dc < 0 ? [last, near] : [near, last];
      return `<${name(...a1)}:${name(...a2)}>`;
    };
    let lo;
    if (a === 'ABOVE') lo = run(-1, 0); else if (a === 'BELOW') lo = run(1, 0); else if (a === 'LEFT') lo = run(0, -1); else if (a === 'RIGHT') lo = run(0, 1);
    else if (a.includes(':')) {
      const [[r1, c1], [r2, c2]] = a.split(':').map(ref);
      for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) { const v = valueAt(r, c); if (v != null) out.push(v); }
      lo = `<${a}>`;
    } else { const [r, c] = ref(a); const v = valueAt(r, c); if (v != null) out.push(v); lo = `<${a}>`; }
    return { vals: out, lo };
  };
  const FN = {
    SUM: (v) => v.reduce((x, y) => x + y, 0), AVERAGE: (v) => (v.length ? v.reduce((x, y) => x + y, 0) / v.length : 0),
    MIN: (v) => Math.min(...v), MAX: (v) => Math.max(...v), PRODUCT: (v) => v.reduce((x, y) => x * y, 1), COUNT: (v) => v.length,
  };
  // LibreOffice Writer's names for the functions.
  const LO = { SUM: 'sum', AVERAGE: 'mean', MIN: 'min', MAX: 'max', PRODUCT: 'product', COUNT: 'count' };
  let src = formula.trim().replace(/^=/, '');
  const parts = [];
  const FN_RE = /\b(SUM|AVERAGE|MIN|MAX|PRODUCT|COUNT)\(([^)]*)\)/gi;
  src = src.replace(FN_RE, (_, f, args) => {
    const rs = args.split(/[;,]/).map(range);
    parts.push(`${LO[f.toUpperCase()]} ${rs.map((r) => r.lo).join('|')}`);
    return `\u0000${parts.length - 1}\u0000${FN[f.toUpperCase()](rs.flatMap((r) => r.vals))}\u0001`;
  });
  // ODF form: functions as above, plain references as <A1>.
  let odf = src.replace(/\u0000(\d+)\u0000[^\u0001]*\u0001/g, '\u0002$1\u0002').replace(/\b([A-Z]+\d+)\b/gi, (m) => `<${m.toUpperCase()}>`)
    .replace(/\u0002(\d+)\u0002/g, (_, i) => ` ${parts[i]} `);
  odf = odf.replace(/\s+/g, ' ').trim();
  src = src.replace(/\u0000\d+\u0000([^\u0001]*)\u0001/g, '$1');
  src = src.replace(/\b([A-Z]+\d+)\b/gi, (m) => String(valueAt(...ref(m)) ?? 0));
  if (!/^[\d.+\-*/()\s%]+$/.test(src)) throw new Error('unsupported formula');
  const value = arithmetic(src);
  if (!Number.isFinite(value)) throw new Error('not a number');
  return { value, odf: `ooow:${odf}`, address: name(cur.row, cur.col) };
}

/** Evaluates + - * / % ( ) on numbers (no eval: the app's security policy forbids it). */
function arithmetic(src) {
  const toks = src.match(/\d+(?:\.\d+)?|\.\d+|[-+*/%()]/g) || [];
  let i = 0;
  const peek = () => toks[i];
  const factor = () => {
    const tk = toks[i++];
    if (tk === '(') { const v = expr(); if (toks[i++] !== ')') throw new Error('missing )'); return v; }
    if (tk === '-') return -factor();
    if (tk === '+') return factor();
    const n = Number(tk);
    if (!Number.isFinite(n)) throw new Error('syntax error');
    if (peek() === '%') { i++; return n / 100; }
    return n;
  };
  const term = () => { let v = factor(); while (peek() === '*' || peek() === '/') { const op = toks[i++]; const r = factor(); v = op === '*' ? v * r : v / r; } return v; };
  const expr = () => { let v = term(); while (peek() === '+' || peek() === '-') { const op = toks[i++]; const r = term(); v = op === '+' ? v + r : v - r; } return v; };
  const v = expr();
  if (i < toks.length) throw new Error('syntax error');
  return v;
}

/** Puts a formula result in the current cell (kept as an ODF table formula). */
export function insertFormula(state, dispatch, formula, format = (v) => String(+v.toFixed(10))) {
  const r = evalFormula(state, formula);
  const cur = selectedCells(state)[0];
  if (dispatch) {
    const tr = state.tr;
    const extra = { ...(cur.node.attrs.extra || {}), 'table:formula': r.odf, 'office:value-type': 'float', 'office:value': String(r.value) };
    const para = cur.node.firstChild?.isTextblock ? cur.node.firstChild : PARA.create({ styleName: 'Table_20_Contents' });
    const cell = cur.node.type.create({ ...cur.node.attrs, extra }, para.type.create(para.attrs, schema.text(format(r.value))));
    tr.replaceWith(cur.pos, cur.pos + cur.node.nodeSize, cell);
    tr.setSelection(TextSelection.create(tr.doc, cur.pos + 1 + cell.firstChild.nodeSize - 1));
    dispatch(tr);
  }
  return r;
}

// ------------------------------------------------------------ table styles

const line = (w, c) => `${w} solid ${c}`;
const accentStyle = (c, light) => ({
  header: { cell: { 'fo:background-color': c, 'fo:border-bottom': line('0.5pt', c) }, text: { bold: true, colour: '#ffffff' } },
  total: { cell: { 'fo:border-top': line('1pt', c) }, text: { bold: true } },
  firstCol: { text: { bold: true } },
  lastCol: { text: { bold: true } },
  band: { cell: { 'fo:background-color': light } },
  body: { cell: { 'fo:border-bottom': line('0.5pt', light) } },
});
/** Built-in table styles: role → { cell: cell properties, text: { bold, colour } }. */
export const TABLE_STYLES = {
  plain: { body: { cell: {} } },
  grid: { all: { cell: { 'fo:border': line('0.5pt', '#000000') } }, header: { text: { bold: true } } },
  gridLight: { all: { cell: { 'fo:border': line('0.5pt', '#bfbfbf') } }, header: { text: { bold: true } }, firstCol: { text: { bold: true } } },
  simpleBanded: { header: { cell: { 'fo:border-bottom': line('0.75pt', '#7f7f7f') }, text: { bold: true } }, total: { cell: { 'fo:border-top': line('0.75pt', '#7f7f7f') }, text: { bold: true } }, band: { cell: { 'fo:background-color': '#f2f2f2' } }, firstCol: { text: { bold: true } } },
  listBlue: accentStyle('#156082', '#c1e4f5'),
  listOrange: accentStyle('#e97132', '#fbe3d6'),
  gridBlue: { all: { cell: { 'fo:border': line('0.5pt', '#83cbeb') } }, header: { cell: { 'fo:background-color': '#156082' }, text: { bold: true, colour: '#ffffff' } }, band: { cell: { 'fo:background-color': '#c1e4f5' } }, firstCol: { text: { bold: true } } },
  gridGreen: { all: { cell: { 'fo:border': line('0.5pt', '#83e28e') } }, header: { cell: { 'fo:background-color': '#196b24' }, text: { bold: true, colour: '#ffffff' } }, band: { cell: { 'fo:background-color': '#c1f0c8' } }, firstCol: { text: { bold: true } } },
};

const OPT_ATTR = {
  header: 'table:use-first-row-styles', total: 'table:use-last-row-styles', firstCol: 'table:use-first-column-styles',
  lastCol: 'table:use-last-column-styles', bandedRows: 'table:use-banding-rows-styles', bandedCols: 'table:use-banding-columns-styles',
};
export const TABLE_OPTION_KEYS = Object.keys(OPT_ATTR);

/** The table's style and options (ODF table:template-name and table:use-…-styles). */
export function tableStyleOptions(table) {
  const ex = table.attrs.extra || {};
  const opts = { style: ex['table:template-name'] || null };
  const defaults = { header: true, total: false, firstCol: true, lastCol: false, bandedRows: true, bandedCols: false };
  for (const [k, a] of Object.entries(OPT_ATTR)) opts[k] = ex[a] != null ? ex[a] === 'true' : defaults[k];
  return opts;
}

const BORDER_KEYS = ['fo:border', 'fo:border-top', 'fo:border-bottom', 'fo:border-left', 'fo:border-right'];

/** Applies a table style with options to every cell (direct formatting, as LibreOffice does). */
export function applyTableStyle(state, dispatch, docState, styleId, options = {}) {
  const t = tableAt(state);
  if (!t) return false;
  const def = TABLE_STYLES[styleId] || TABLE_STYLES.grid;
  const opts = { ...tableStyleOptions(t.table), ...options };
  if (!dispatch) return true;
  const tr = state.tr;
  const { map, table, tableStart } = t;
  const headerRows = Math.max(1, (() => { let n = 0; table.forEach((r) => { if (r.attrs.header) n++; }); return n; })());
  const seen = new Set();
  for (let i = 0; i < map.map.length; i++) {
    const rel = map.map[i];
    if (seen.has(rel)) continue;
    seen.add(rel);
    const cell = table.nodeAt(rel);
    const r = map.findCell(rel);
    const isHeader = opts.header && r.top < headerRows;
    const isTotal = opts.total && r.bottom === map.height && !isHeader;
    const body = !isHeader && !isTotal;
    const roles = ['all', 'body'].filter((x) => x === 'all' || body);
    if (opts.bandedRows && body && (r.top - (opts.header ? headerRows : 0)) % 2 === 0) roles.push('band');
    if (opts.bandedCols && body && r.left % 2 === 0) roles.push('band');
    if (opts.firstCol && r.left === 0) roles.push('firstCol');
    if (opts.lastCol && r.right === map.width) roles.push('lastCol');
    if (isHeader) roles.push('header');
    if (isTotal) roles.push('total');
    const cellChange = Object.fromEntries([...BORDER_KEYS, 'fo:background-color'].map((k) => [k, null]));
    const text = { bold: false, colour: null };
    for (const role of roles) {
      Object.assign(cellChange, def[role]?.cell || {});
      if (def[role]?.text?.bold) text.bold = true;
      if (def[role]?.text?.colour) text.colour = def[role].text.colour;
    }
    if (!cellChange['fo:border'] && BORDER_KEYS.slice(1).every((k) => !cellChange[k])) cellChange['fo:border'] = 'none';
    tr.setNodeMarkup(tableStart + rel, null, { ...cell.attrs, styleName: null, auto: changeAuto(nodeAuto(cell, docState, 'table-cell'), CP, cellChange) });
    cell.descendants((n, p) => {
      if (!n.isTextblock) return true;
      const auto = changeAuto(n.attrs.auto, 'style:text-properties', { 'fo:font-weight': text.bold ? 'bold' : null, 'fo:color': text.colour });
      tr.setNodeMarkup(tableStart + rel + 1 + p, null, { ...n.attrs, auto });
      return false;
    });
  }
  const extra = { ...(table.attrs.extra || {}), 'table:template-name': styleId };
  for (const [k, a] of Object.entries(OPT_ATTR)) extra[a] = opts[k] ? 'true' : 'false';
  tr.setNodeMarkup(t.tablePos, null, { ...tr.doc.nodeAt(t.tablePos).attrs, extra });
  dispatch(tr);
  return true;
}
