/**
 * Table dialogs: Insert Table, Table Properties, Split Cells, Convert Text
 * to Table, Convert Table to Text, Sort, Formula, Cell Margins. Each returns
 * the chosen values (or null when cancelled); commands apply them.
 */
import { h } from './dom.js';
import { t } from '../i18n/index.js';
import { showDialog } from './dialog.js';
import { field, number, select, check, radios, length, tabs, row, group, text } from './form.js';

const okCancel = [{ label: t('common.ok'), value: true, primary: true }, { label: t('common.cancel'), value: false }];
const CM = 96 / 2.54;

export async function insertTableDialog() {
  const cols = number(5, { min: '1', max: '63' });
  const rows = number(2, { min: '1', max: '1000' });
  const fit = radios('it-fit', [['fixed', t('tbl.fixedWidth')], ['contents', t('tbl.autofitContents')], ['window', t('tbl.autofitWindow')]], 'window');
  const body = h('div', {}, group(t('tbl.size'), row(field(t('tbl.columns'), cols), field(t('tbl.rows'), rows))), group(t('tbl.autofitBehaviour'), fit));
  const ok = await showDialog({ title: t('tbl.insertTitle'), message: body, buttons: okCancel, cancelValue: false });
  if (!ok) return null;
  return { cols: Math.max(1, Math.min(63, Number(cols.value) || 1)), rows: Math.max(1, Math.min(1000, Number(rows.value) || 1)), fit: fit.value() };
}

/**
 * Table Properties. cur = { width, align, indent, rowHeight, rowRule, rowBreak, header, colWidth, vAlign }
 * (lengths in px). Returns the same shape.
 */
export async function tablePropertiesDialog(cur, tab = 0) {
  const width = length(cur.width, 'cm');
  const align = radios('tp-align', [['left', t('pd.left')], ['center', t('pd.centred')], ['right', t('pd.right')]], cur.align);
  const indent = length(cur.indent || 0, 'cm');
  const rowHeight = length(cur.rowHeight || 0, 'cm');
  const rowRule = select([['atLeast', t('pd.atLeast')], ['exactly', t('pd.exactly')]], cur.rowRule || 'atLeast');
  const rowBreak = check(t('tbl.rowBreak'), cur.rowBreak !== false);
  const header = check(t('tbl.repeatHeader'), !!cur.header);
  const colWidth = length(cur.colWidth || 0, 'cm');
  const vAlign = radios('tp-valign', [['top', t('tbl.top')], ['middle', t('tbl.centre')], ['bottom', t('tbl.bottom')]], cur.vAlign || 'top');
  const body = h('div', { class: 'tp' }, tabs([
    [t('tbl.tableTab'), h('div', {}, row(field(t('tbl.preferredWidth'), width)), group(t('pd.alignment'), align), row(field(t('tbl.indentLeft'), indent)))],
    [t('tbl.rowTab'), h('div', {}, row(field(t('tbl.height'), rowHeight), field(t('tbl.rowHeightIs'), rowRule)), rowBreak, header)],
    [t('tbl.columnTab'), h('div', {}, row(field(t('tbl.width'), colWidth)))],
    [t('tbl.cellTab'), h('div', {}, group(t('tbl.verticalAlignment'), vAlign))],
  ], tab));
  const ok = await showDialog({ title: t('tbl.propertiesTitle'), message: body, buttons: okCancel, cancelValue: false, wide: true });
  if (!ok) return null;
  return {
    width: width.px(), align: align.value(), indent: indent.px() || 0, rowHeight: rowHeight.px() || 0, rowRule: rowRule.value,
    rowBreak: rowBreak.input.checked, header: header.input.checked, colWidth: colWidth.px() || 0, vAlign: vAlign.value(),
  };
}

export async function splitCellsDialog(cur = { cols: 2, rows: 1 }) {
  const cols = number(cur.cols, { min: '1', max: '63' });
  const rows = number(cur.rows, { min: '1', max: '100' });
  const ok = await showDialog({ title: t('tbl.splitTitle'), message: h('div', {}, row(field(t('tbl.columns'), cols), field(t('tbl.rows'), rows))), buttons: okCancel, cancelValue: false });
  if (!ok) return null;
  return { cols: Math.max(1, Number(cols.value) || 1), rows: Math.max(1, Number(rows.value) || 1) };
}

const SEPARATORS = () => [['\t', t('tbl.sepTabs')], [',', t('tbl.sepCommas')], ['\n', t('tbl.sepParagraphs')], ['other', t('tbl.sepOther')]];

export async function convertTextDialog({ toTable = true, guessCols = 2 } = {}) {
  const sep = radios('ct-sep', SEPARATORS(), '\t');
  const other = text('-', { size: '2', maxlength: '1', 'aria-label': t('tbl.sepOther') });
  const cols = number(guessCols, { min: '1', max: '63' });
  const body = h('div', {}, toTable ? row(field(t('tbl.columns'), cols)) : null, group(t('tbl.separateAt'), sep, other));
  const ok = await showDialog({ title: t(toTable ? 'tbl.toTableTitle' : 'tbl.toTextTitle'), message: body, buttons: okCancel, cancelValue: false });
  if (!ok) return null;
  const v = sep.value();
  return { separator: v === 'other' ? (other.value || '-') : v, cols: Number(cols.value) || null };
}

export async function sortDialog(columns) {
  const col = select(columns.map((c, i) => [String(i), c]), '0');
  const type = select([['text', t('so.text')], ['number', t('so.number')], ['date', t('so.date')]], 'text');
  const order = radios('ts-order', [['asc', t('so.ascending')], ['desc', t('so.descending')]], 'asc');
  const header = check(t('tbl.hasHeader'), true);
  const body = h('div', {}, row(field(t('tbl.sortBy'), col), field(t('so.type'), type)), group(t('so.order'), order), header);
  const ok = await showDialog({ title: t('so.title'), message: body, buttons: okCancel, cancelValue: false });
  if (!ok) return null;
  return { column: Number(col.value), type: type.value, descending: order.value() === 'desc', hasHeader: header.input.checked };
}

export async function formulaDialog(initial = '=SUM(ABOVE)') {
  const f = text(initial, { 'aria-label': t('tbl.formula') });
  const fmt = select([['general', t('tbl.fmtGeneral')], ['0', '0'], ['0.00', '0.00'], ['#,##0.00', '#,##0.00'], ['percent', '0%']], 'general');
  const paste = select([['', t('tbl.pasteFunction')], ...['SUM', 'AVERAGE', 'MIN', 'MAX', 'PRODUCT', 'COUNT'].map((x) => [x, x])], '');
  paste.addEventListener('change', () => { if (paste.value) { f.value += `${paste.value}()`; paste.value = ''; f.focus(); } });
  const body = h('div', {}, field(t('tbl.formula'), f, { wide: true }), row(field(t('tbl.numberFormat'), fmt), field(t('tbl.pasteFunction'), paste)));
  const ok = await showDialog({ title: t('tbl.formula'), message: body, buttons: okCancel, cancelValue: false });
  if (!ok) return null;
  return { formula: f.value, format: fmt.value };
}

export async function cellMarginsDialog(cur) {
  const top = length(cur.top, 'cm');
  const bottom = length(cur.bottom, 'cm');
  const left = length(cur.left, 'cm');
  const right = length(cur.right, 'cm');
  const ok = await showDialog({ title: t('tbl.marginsTitle'), message: h('div', {}, row(field(t('ps.top'), top), field(t('ps.bottom'), bottom)), row(field(t('pd.left'), left), field(t('pd.right'), right))), buttons: okCancel, cancelValue: false });
  if (!ok) return null;
  return { top: top.px() || 0, bottom: bottom.px() || 0, left: left.px() || 0, right: right.px() || 0 };
}

export { CM };
