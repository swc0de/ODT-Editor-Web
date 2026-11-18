/**
 * Table Layout contextual tab: Table, Draw, Rows & Columns, Merge, Cell Size,
 * Alignment, Data.
 */
import { defineCommands } from '../define.js';
import { t } from '../../i18n/index.js';
import {
  tableAt, selectedCells, CellSelection, insertRows, insertColumns, deleteRows, deleteColumns, deleteTable, mergeCells, splitCells, splitTable,
  setColumnWidth, setRowHeight, distributeRows, distributeColumns, alignCells, cellAlignment, setCellMargins, toggleHeaderRows, tableToText,
  sortRows, insertFormula, setWidths, withWidths, cellProps, updateCells, nodeAuto, changeAuto,
} from '../../core/commands/tables.js';
import { tablePropertiesDialog, splitCellsDialog, convertTextDialog, sortDialog, formulaDialog, cellMarginsDialog } from '../../ui/table-dialogs.js';
import { inTable, V, docState, widthOpts, runCmd, widthsAt, bodyWidth } from './shared.js';
import { toPx, pxToLength } from '../../layout/units.js';

const CM = 96 / 2.54;

function select(c, what) {
  const tt = tableAt(V(c).state);
  if (!tt) return;
  const { map, tableStart, rect } = tt;
  const cellPos = (r, col) => tableStart + map.map[r * map.width + col];
  let a;
  let b;
  if (what === 'cell') { a = cellPos(rect.top, rect.left); b = a; }
  if (what === 'row') { a = cellPos(rect.top, 0); b = cellPos(rect.bottom - 1, map.width - 1); }
  if (what === 'column') { a = cellPos(0, rect.left); b = cellPos(map.height - 1, rect.right - 1); }
  if (what === 'table') { a = cellPos(0, 0); b = cellPos(map.height - 1, map.width - 1); }
  V(c).dispatch(V(c).state.tr.setSelection(CellSelection.create(V(c).state.doc, a, b)));
  c.editor.focus();
}

/** AutoFit: 'contents' measures the natural widths, 'window' fills the page, 'fixed' keeps the current widths. */
function autoFit(c, how) {
  const tt = tableAt(V(c).state);
  if (!tt) return;
  const dom = V(c).nodeDOM(tt.tablePos);
  let widths = widthsAt(c);
  if (how === 'contents' && dom) {
    const save = dom.style.cssText;
    const cols = [...dom.querySelectorAll(':scope > colgroup > col')];
    const colSave = cols.map((x) => x.style.width);
    cols.forEach((x) => { x.style.width = ''; });
    dom.style.tableLayout = 'auto';
    dom.style.width = 'auto';
    const measured = cols.map((x) => x.getBoundingClientRect().width);
    dom.style.cssText = save;
    cols.forEach((x, i) => { x.style.width = colSave[i]; });
    if (measured.every((w) => w > 0)) widths = measured.map((w) => Math.min(w + 2, bodyWidth(c)));
    const total = widths.reduce((x, y) => x + y, 0);
    if (total > bodyWidth(c)) widths = widths.map((w) => (w * bodyWidth(c)) / total);
  } else if (how === 'window') {
    const total = widths.reduce((x, y) => x + y, 0);
    widths = widths.map((w) => (w * bodyWidth(c)) / total);
  }
  runCmd(c, setWidths, widths);
  if (how === 'window' || how === 'contents') {
    const v = V(c);
    const t2 = tableAt(v.state);
    v.dispatch(v.state.tr.setNodeMarkup(t2.tablePos, null, { ...t2.table.attrs, auto: changeAuto(t2.table.attrs.auto, 'style:table-properties', { 'table:align': how === 'window' ? 'margins' : 'left' }) }));
  }
  c.store.set({ tableAutoFit: how });
}

const ALIGN = [['top', 'start', 'top-left'], ['top', 'center', 'top-centre'], ['top', 'end', 'top-right'], ['middle', 'start', 'middle-left'], ['middle', 'center', 'middle-centre'], ['middle', 'end', 'middle-right'], ['bottom', 'start', 'bottom-left'], ['bottom', 'center', 'bottom-centre'], ['bottom', 'end', 'bottom-right']];
const alignCmds = Object.fromEntries(ALIGN.map(([v, hz, icon]) => [`align${icon.replace(/(^|-)(\w)/g, (_, _a, ch) => ch.toUpperCase())}`, {
  icon: `align-${icon}`, isEnabled: inTable,
  isChecked: (c) => { if (!inTable(c)) return false; const a = cellAlignment(V(c).state, docState(c)); return !!a && a.vertical === v && a.horizontal === hz; },
  run: (c) => runCmd(c, alignCells, docState(c), v, hz),
}]));

const DIRS = ['lr-tb', 'tb-rl', 'bt-lr'];
function cycleDirection(c) {
  const cell = selectedCells(V(c).state)[0];
  if (!cell) return;
  const cur = cellProps(cell.node, docState(c))['style:writing-mode'] || 'lr-tb';
  const next = DIRS[(DIRS.indexOf(cur) + 1) % DIRS.length];
  runCmd(c, updateCells, docState(c), (n) => ({ auto: changeAuto(nodeAuto(n, docState(c), 'table-cell'), 'style:table-cell-properties', { 'style:writing-mode': next === 'lr-tb' ? null : next }) }));
}

async function properties(c) {
  const tt = tableAt(V(c).state);
  if (!tt) return;
  const ta = nodeAuto(tt.table, docState(c), 'table')?.props?.['style:table-properties']?.a || {};
  const row = tt.table.child(tt.rect.top);
  const ra = nodeAuto(row, docState(c), 'table-row')?.props?.['style:table-row-properties']?.a || {};
  const cell = selectedCells(V(c).state)[0];
  const widths = widthsAt(c);
  const res = await tablePropertiesDialog({
    width: widths.reduce((x, y) => x + y, 0), align: { center: 'center', right: 'right' }[ta['table:align']] || 'left', indent: toPx(ta['fo:margin-left'] || '0cm') || 0,
    rowHeight: toPx(ra['style:row-height'] || ra['style:min-row-height'] || '0cm') || 0, rowRule: ra['style:row-height'] ? 'exactly' : 'atLeast',
    rowBreak: ra['fo:keep-together'] !== 'always', header: row.attrs.header, colWidth: widths[tt.rect.left] || 0,
    vAlign: cellProps(cell.node, docState(c))['style:vertical-align'] || 'top',
  });
  if (!res) return;
  const v = V(c);
  // Table width scales the columns; alignment and indent go to the table style.
  let ws = widths;
  if (res.colWidth && Math.abs(res.colWidth - widths[tt.rect.left]) > 0.5) {
    for (let i = tt.rect.left; i < tt.rect.right; i++) ws[i] = res.colWidth;
  }
  const total = ws.reduce((x, y) => x + y, 0);
  if (res.width && Math.abs(res.width - total) > 0.5) ws = ws.map((w) => (w * res.width) / total);
  const t2 = tableAt(v.state);
  const attrs = withWidths(t2.table, ws);
  attrs.auto = changeAuto(attrs.auto, 'style:table-properties', { 'table:align': res.align === 'left' && !res.indent ? 'left' : res.align, 'fo:margin-left': res.align === 'left' && res.indent ? pxToLength(res.indent, 'cm', 3) : null });
  let tr = v.state.tr.setNodeMarkup(t2.tablePos, null, attrs);
  v.dispatch(tr);
  if (res.rowHeight) setRowHeight(v.state, v.dispatch, docState(c), res.rowHeight, res.rowRule);
  // Row break and vertical alignment.
  const t3 = tableAt(v.state);
  tr = v.state.tr;
  let pos = t3.tableStart;
  t3.table.forEach((r, _o, i) => {
    if (i >= t3.rect.top && i < t3.rect.bottom) tr.setNodeMarkup(pos, null, { ...r.attrs, styleName: null, auto: changeAuto(nodeAuto(r, docState(c), 'table-row'), 'style:table-row-properties', { 'fo:keep-together': res.rowBreak ? null : 'always' }) });
    pos += r.nodeSize;
  });
  v.dispatch(tr);
  if (res.header !== row.attrs.header) toggleHeaderRows(v.state, v.dispatch);
  updateCells(v.state, v.dispatch, docState(c), (n) => ({ auto: changeAuto(nodeAuto(n, docState(c), 'table-cell'), 'style:table-cell-properties', { 'style:vertical-align': res.vAlign }) }));
  c.editor.focus();
}

async function deleteCellsDialog(c) {
  const { showDialog } = await import('../../ui/dialog.js');
  const { radios } = await import('../../ui/form.js');
  const r = radios('dc-mode', [['row', t('tbl.deleteRow')], ['column', t('tbl.deleteColumn')]], 'row');
  const ok = await showDialog({ title: t('cmd.tableLayout.deleteCells').replace(/…$/, ''), message: r, buttons: [{ label: t('common.ok'), value: true, primary: true }, { label: t('common.cancel'), value: false }], cancelValue: false });
  if (!ok) return;
  if (r.value() === 'row') runCmd(c, deleteRows); else runCmd(c, deleteColumns, widthOpts(c));
}

/** Current row height / column width (cm) for the Cell Size spins. */
export function tableSpinValues(c) {
  if (!inTable(c)) return {};
  const tt = tableAt(V(c).state);
  const dom = V(c).nodeDOM(tt.tablePos);
  const rowEl = dom?.querySelectorAll(':scope > tbody > tr')[tt.rect.top];
  const k = c.state.zoom / 100;
  return {
    'tableLayout.rowHeight': rowEl ? rowEl.getBoundingClientRect().height / k / CM : 0,
    'tableLayout.columnWidth': (widthsAt(c)[tt.rect.left] || 0) / CM,
  };
}

const modeCmd = (mode) => ({ isEnabled: (c) => !!c.editor, isChecked: (c) => c.state.tableMode === mode, run: (c) => c.store.set({ tableMode: c.state.tableMode === mode ? null : mode }) });

export const commands = defineCommands('tableLayout', {
  select: { icon: 'table-select', menuOnly: true },
  selectCell: { isEnabled: inTable, run: (c) => select(c, 'cell') },
  selectColumn: { isEnabled: inTable, run: (c) => select(c, 'column') },
  selectRow: { isEnabled: inTable, run: (c) => select(c, 'row') },
  selectTable: { isEnabled: inTable, run: (c) => select(c, 'table') },
  viewGridlines: { icon: 'view-gridlines', isChecked: (c) => c.state.tableGridlines !== false, run: (c) => c.store.set({ tableGridlines: c.state.tableGridlines === false }) },
  properties: { icon: 'table-properties', isEnabled: inTable, run: properties },
  drawTable: { icon: 'draw-table', ...modeCmd('draw') },
  eraser: { icon: 'eraser', ...modeCmd('erase') },
  delete: { icon: 'delete-table', menuOnly: true },
  deleteCells: { isEnabled: inTable, run: deleteCellsDialog },
  deleteColumns: { isEnabled: inTable, run: (c) => runCmd(c, deleteColumns, widthOpts(c)) },
  deleteRows: { isEnabled: inTable, run: (c) => runCmd(c, deleteRows) },
  deleteTable: { isEnabled: inTable, run: (c) => runCmd(c, deleteTable) },
  insertAbove: { icon: 'insert-above', isEnabled: inTable, run: (c) => runCmd(c, insertRows, false) },
  insertBelow: { icon: 'insert-below', isEnabled: inTable, run: (c) => runCmd(c, insertRows, true) },
  insertLeft: { icon: 'insert-left', isEnabled: inTable, run: (c) => runCmd(c, insertColumns, false, widthOpts(c)) },
  insertRight: { icon: 'insert-right', isEnabled: inTable, run: (c) => runCmd(c, insertColumns, true, widthOpts(c)) },
  mergeCells: { icon: 'merge-cells', isEnabled: (c) => inTable(c) && V(c).state.selection instanceof CellSelection, run: (c) => runCmd(c, mergeCells) },
  splitCells: { icon: 'split-cells', isEnabled: inTable, run: async (c) => { const r = await splitCellsDialog(); if (r) runCmd(c, splitCells, r.cols, r.rows, widthOpts(c)); } },
  splitTable: { icon: 'split-table', isEnabled: (c) => inTable(c) && tableAt(V(c).state).rect.top > 0, run: (c) => runCmd(c, splitTable) },
  autoFit: { icon: 'autofit', menuOnly: true },
  autoFitContents: { isEnabled: inTable, run: (c) => autoFit(c, 'contents') },
  autoFitWindow: { isEnabled: inTable, run: (c) => autoFit(c, 'window') },
  fixedColumnWidth: { isEnabled: inTable, run: (c) => autoFit(c, 'fixed') },
  rowHeight: { icon: 'distribute-rows', isEnabled: inTable, run: (c, v) => { if (Number.isFinite(v) && v > 0) runCmd(c, setRowHeight, docState(c), v * CM, 'atLeast'); } },
  columnWidth: { icon: 'distribute-cols', isEnabled: inTable, run: (c, v) => { if (Number.isFinite(v) && v > 0) runCmd(c, setColumnWidth, v * CM, widthOpts(c)); } },
  distributeRows: {
    icon: 'distribute-rows', isEnabled: inTable,
    run: (c) => {
      const tt = tableAt(V(c).state);
      const dom = V(c).nodeDOM(tt.tablePos);
      const k = c.state.zoom / 100;
      const hs = [...dom.querySelectorAll(':scope > tbody > tr')].map((r) => r.getBoundingClientRect().height / k);
      runCmd(c, distributeRows, docState(c), hs);
    },
  },
  distributeColumns: { icon: 'distribute-cols', isEnabled: inTable, run: (c) => runCmd(c, distributeColumns, widthOpts(c)) },
  ...alignCmds,
  textDirection: { icon: 'text-direction', isEnabled: inTable, run: cycleDirection },
  cellMargins: {
    icon: 'cell-margins', isEnabled: inTable,
    run: async (c) => {
      const a = cellProps(selectedCells(V(c).state)[0].node, docState(c));
      const p = (s) => toPx(a[`fo:padding-${s}`] || a['fo:padding'] || '0.097cm') || 0;
      const r = await cellMarginsDialog({ top: p('top'), bottom: p('bottom'), left: p('left'), right: p('right') });
      if (r) runCmd(c, setCellMargins, docState(c), r);
    },
  },
  sort: {
    icon: 'sort', isEnabled: inTable,
    run: async (c) => {
      const tt = tableAt(V(c).state);
      const names = [];
      tt.table.firstChild.forEach((cell, _o, i) => names.push(cell.textContent.trim() || t('tbl.columnN', { n: i + 1 })));
      const r = await sortDialog(names);
      if (r && !runCmd(c, sortRows, r)) c.ui.toast?.(t('tbl.cannotSort'));
    },
  },
  repeatHeader: { icon: 'repeat-header', isEnabled: inTable, isChecked: (c) => inTable(c) && tableAt(V(c).state).table.child(tableAt(V(c).state).rect.top).attrs.header, run: (c) => runCmd(c, toggleHeaderRows) },
  convertToText: { icon: 'convert-text', isEnabled: inTable, run: async (c) => { const r = await convertTextDialog({ toTable: false }); if (r) runCmd(c, tableToText, r.separator); } },
  formula: {
    icon: 'formula', isEnabled: inTable,
    run: async (c) => {
      const tt = tableAt(V(c).state);
      const above = tt.rect.top > 0 && /\d/.test(tt.table.child(tt.rect.top - 1).textContent);
      const r = await formulaDialog(above ? '=SUM(ABOVE)' : '=SUM(LEFT)');
      if (!r) return;
      const fmt = { general: (x) => String(+x.toFixed(10)), 0: (x) => x.toFixed(0), '0.00': (x) => x.toFixed(2), '#,##0.00': (x) => x.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), percent: (x) => `${Math.round(x * 100)}%` }[r.format];
      try { runCmd(c, insertFormula, r.formula, fmt); } catch (e) { c.ui.toast?.(t('tbl.formulaError', { error: e.message })); }
    },
  },
});

export const ribbon = {
  id: 'tableLayout',
  keytip: 'JL',
  contextual: 'table',
  groups: [
    { id: 'table', icon: 'table', controls: [{ t: 'col', items: [{ cmd: 'select', menu: ['selectCell', 'selectColumn', 'selectRow', 'selectTable'] }, { cmd: 'viewGridlines' }, { cmd: 'properties' }] }] },
    { id: 'draw', icon: 'draw-table', controls: [{ t: 'large', cmd: 'drawTable', label: 'label.tableLayout.drawTable' }, { t: 'large', cmd: 'eraser' }] },
    {
      id: 'rowsColumns', icon: 'insert-above',
      controls: [
        { t: 'large', cmd: 'delete', menu: ['deleteCells', 'deleteColumns', 'deleteRows', 'deleteTable'] },
        { t: 'large', cmd: 'insertAbove', label: 'label.tableLayout.insertAbove' },
        { t: 'col', items: [{ cmd: 'insertBelow' }, { cmd: 'insertLeft' }, { cmd: 'insertRight' }] },
      ],
    },
    { id: 'merge', icon: 'merge-cells', controls: [{ t: 'col', items: [{ cmd: 'mergeCells' }, { cmd: 'splitCells' }, { cmd: 'splitTable' }] }] },
    {
      id: 'cellSize', icon: 'autofit', launcher: 'properties',
      controls: [
        { t: 'large', cmd: 'autoFit', menu: ['autoFitContents', 'autoFitWindow', 'fixedColumnWidth'] },
        { t: 'spins', header: 'label.tableLayout.size', items: [{ cmd: 'rowHeight', label: 'label.tableLayout.height', unit: 'cm', value: 0, step: 0.1, decimals: 2 }, { cmd: 'columnWidth', label: 'label.tableLayout.width', unit: 'cm', value: 0, step: 0.1, decimals: 2 }] },
        { t: 'col', items: [{ cmd: 'distributeRows' }, { cmd: 'distributeColumns' }] },
      ],
    },
    {
      id: 'alignment', icon: 'align-top-left',
      controls: [
        { t: 'rows', rows: [[{ cmd: 'alignTopLeft' }, { cmd: 'alignTopCentre' }, { cmd: 'alignTopRight' }], [{ cmd: 'alignMiddleLeft' }, { cmd: 'alignMiddleCentre' }, { cmd: 'alignMiddleRight' }], [{ cmd: 'alignBottomLeft' }, { cmd: 'alignBottomCentre' }, { cmd: 'alignBottomRight' }]] },
        { t: 'large', cmd: 'textDirection', label: 'label.tableLayout.textDirection' },
        { t: 'large', cmd: 'cellMargins', label: 'label.tableLayout.cellMargins' },
      ],
    },
    {
      id: 'data', icon: 'sort',
      controls: [
        { t: 'large', cmd: 'sort' },
        { t: 'col', items: [{ cmd: 'repeatHeader' }, { cmd: 'convertToText' }, { cmd: 'formula' }] },
      ],
    },
  ],
};

export function register(registry) { registry.register(commands); }
