/**
 * References tab dialogs: Table of Contents, Update Table, Footnote and
 * Endnote, Caption, Cross-reference, Mark Index Entry, Index, Table of
 * Figures. Each returns the chosen values or null when cancelled.
 */
import { h } from './dom.js';
import { t } from '../i18n/index.js';
import { showDialog } from './dialog.js';
import { field, number, select, check, radios, row, group, text } from './form.js';

const okCancel = (ok = t('common.ok')) => [{ label: ok, value: true, primary: true }, { label: t('common.cancel'), value: false }];
const LEADERS = () => [['.', '.......'], ['-', '-------'], ['_', '_______'], ['', t('ref.none')]];

/** cur = TOC options (core/indexes.js) → options */
export async function tocDialog(cur) {
  const title = text(cur.title || '', { 'aria-label': t('ref.tocTitle') });
  const pages = check(t('ref.showPageNumbers'), cur.pageNumbers);
  const right = check(t('ref.rightAlign'), cur.rightAlign);
  const leader = select(LEADERS(), cur.leader);
  const links = check(t('ref.useLinks'), cur.links);
  const levels = number(cur.levels, { min: '1', max: '9' });
  const preview = h('div', { class: 'ref-preview', 'aria-hidden': 'true' });
  const draw = () => {
    const n = Math.max(1, Math.min(9, Number(levels.value) || 1));
    preview.replaceChildren(...Array.from({ length: Math.min(n, 3) }, (_, i) => h('div', { class: 'ref-prev-line', style: { paddingLeft: `${i * 14}px`, fontSize: `${13 - i}px` } },
      h('span', {}, `${t('ref.heading')} ${i + 1}`), pages.input.checked && right.input.checked ? h('span', { class: 'ref-prev-leader' }, leader.value.repeat(30)) : null, pages.input.checked ? h('span', {}, String(i * 2 + 1)) : null)));
  };
  [pages.input, right.input].forEach((x) => x.addEventListener('change', draw));
  leader.addEventListener('change', draw);
  levels.addEventListener('input', draw);
  draw();
  const body = h('div', { class: 'ref-dlg' }, preview, field(t('ref.tocTitle'), title, { wide: true }), pages, right, row(field(t('ref.tabLeader'), leader), field(t('ref.showLevels'), levels)), links);
  const ok = await showDialog({ title: t('ref.tocDialogTitle'), message: body, buttons: okCancel(), cancelValue: false });
  if (!ok) return null;
  return { title: title.value.trim(), pageNumbers: pages.input.checked, rightAlign: right.input.checked, leader: leader.value, links: links.input.checked, levels: Math.max(1, Math.min(9, Number(levels.value) || 3)) };
}

/** Update Table of Contents → 'pages' | 'all' | null */
export async function updateTableDialog(kind = 'toc') {
  const mode = radios('upd-mode', [['pages', t('ref.updatePages')], ['all', t('ref.updateAll')]], 'pages');
  const ok = await showDialog({ title: t(kind === 'figures' ? 'ref.updateFiguresTitle' : 'ref.updateTocTitle'), message: h('div', {}, h('p', {}, t('ref.updateQuestion')), mode), buttons: okCancel(), cancelValue: false });
  return ok ? mode.value() : null;
}

const FORMATS = () => [['1', '1, 2, 3, …'], ['a', 'a, b, c, …'], ['A', 'A, B, C, …'], ['i', 'i, ii, iii, …'], ['I', 'I, II, III, …']];

/**
 * Footnote and Endnote. cur(cls) → current options of a class.
 * → { action: 'insert' | 'apply', cls, position, numFormat, startAt, restart, mark, convert } or null
 */
export async function footnoteDialog(cur, initialCls = 'footnote') {
  const loc = radios('fn-loc', [['footnote', t('ref.footnotes')], ['endnote', t('ref.endnotes')]], initialCls);
  const position = select([['page', t('ref.bottomOfPage')], ['document', t('ref.endOfDocument')]], 'page');
  const endPos = select([['document', t('ref.endOfDocument')]], 'document', { disabled: '' });
  const convert = select([['', t('ref.convertNone')], ['toEndnotes', t('ref.convertToEndnotes')], ['toFootnotes', t('ref.convertToFootnotes')], ['swap', t('ref.convertSwap')]], '');
  const format = select(FORMATS(), '1');
  const mark = text('', { maxlength: '8', 'aria-label': t('ref.customMark') });
  const start = number(1, { min: '1', max: '999' });
  const restart = select([['document', t('ref.continuous')], ['chapter', t('ref.restartChapter')], ['page', t('ref.restartPage')]], 'document');
  const load = () => {
    const cls = loc.value();
    const o = cur(cls);
    format.value = o.numFormat;
    start.value = String(o.startAt);
    position.value = o.position;
    restart.value = o.restart;
    position.disabled = cls !== 'footnote';
    restart.disabled = cls !== 'footnote';
  };
  loc.addEventListener('change', load);
  load();
  const body = h('div', { class: 'ref-dlg fn-dlg' },
    h('fieldset', { class: 'fm-group' }, h('legend', {}, t('ref.location')), loc, row(field(t('ref.footnotes'), position), field(t('ref.endnotes'), endPos)), field(t('ref.convert'), convert)),
    h('fieldset', { class: 'fm-group' }, h('legend', {}, t('ref.format')), field(t('ref.numberFormat'), format), field(t('ref.customMark'), mark), row(field(t('ref.startAt'), start), field(t('ref.numbering'), restart))));
  const action = await showDialog({ title: t('ref.footnoteDialogTitle'), message: body, buttons: [{ label: t('ref.insert'), value: 'insert', primary: true }, { label: t('ref.apply'), value: 'apply' }, { label: t('common.cancel'), value: false }], cancelValue: false });
  if (!action) return null;
  return { action, cls: loc.value(), position: position.value, numFormat: format.value, startAt: Math.max(1, Number(start.value) || 1), restart: restart.value, mark: mark.value.trim() || null, convert: convert.value || null };
}

/**
 * Insert Caption. labels: available labels; cur = { label, position }.
 * → { label, text, position, excludeLabel, numFormat } or null
 */
export async function captionDialog(labels, cur) {
  let list = [...labels];
  const label = select(list.map((l) => [l, l]), cur.label);
  const textIn = text('', { 'aria-label': t('ref.captionText') });
  const prefix = h('span', { class: 'cap-prefix' });
  const exclude = check(t('ref.excludeLabel'), false);
  const position = select([['below', t('ref.belowItem')], ['above', t('ref.aboveItem')]], cur.position);
  const numFormat = select(FORMATS(), '1');
  const drawPrefix = () => { prefix.textContent = `${exclude.input.checked ? '' : `${label.value} `}${{ 1: '1', a: 'a', A: 'A', i: 'i', I: 'I' }[numFormat.value]}: `; };
  [label, numFormat].forEach((x) => x.addEventListener('change', drawPrefix));
  exclude.input.addEventListener('change', drawPrefix);
  drawPrefix();
  const newLabel = h('button', { type: 'button', class: 'dlg-btn', onclick: async () => {
    const name = text('');
    const ok = await showDialog({ title: t('ref.newLabel'), message: field(t('ref.labelName'), name, { wide: true }), buttons: okCancel(), cancelValue: false, validate: () => /^[\p{L}\p{N} _-]+$/u.test(name.value.trim()) });
    const v = name.value.trim();
    if (!ok || !v) return;
    if (!list.includes(v)) { list = [...list, v]; label.append(h('option', { value: v }, v)); }
    label.value = v;
    drawPrefix();
  } }, t('ref.newLabel'));
  const body = h('div', { class: 'ref-dlg cap-dlg' },
    h('label', { class: 'fm-label' }, t('ref.captionLabel')),
    h('div', { class: 'cap-line' }, prefix, textIn),
    group(t('ref.options'), row(field(t('ref.label'), label), field(t('ref.position'), position)), exclude, row(field(t('ref.numberFormat'), numFormat), newLabel)));
  const ok = await showDialog({ title: t('ref.captionTitle'), message: body, buttons: okCancel(), cancelValue: false });
  if (!ok) return null;
  return { label: label.value, text: textIn.value.trim(), position: position.value, excludeLabel: exclude.input.checked, numFormat: numFormat.value };
}

/** Table of Figures. labels, cur = TOF options → options or null */
export async function tofDialog(labels, cur) {
  const label = select(labels.map((l) => [l, l]), cur.label);
  const include = check(t('ref.includeLabel'), cur.includeLabel);
  const pages = check(t('ref.showPageNumbers'), cur.pageNumbers);
  const right = check(t('ref.rightAlign'), cur.rightAlign);
  const leader = select(LEADERS(), cur.leader);
  const links = check(t('ref.useLinks'), cur.links);
  const body = h('div', { class: 'ref-dlg' }, pages, right, field(t('ref.tabLeader'), leader), links, group(t('ref.general'), field(t('ref.captionLabelPick'), label), include));
  const ok = await showDialog({ title: t('ref.tofTitle'), message: body, buttons: okCancel(), cancelValue: false });
  if (!ok) return null;
  return { label: label.value, includeLabel: include.input.checked, pageNumbers: pages.input.checked, rightAlign: right.input.checked, leader: leader.value, links: links.input.checked };
}

/**
 * Cross-reference. api: types [[id, label]], items(type) → [{id,label}], formats(type) → [[fmt, key]].
 * → { type, id, format } or null
 */
export async function crossRefDialog(api, initialType = 'heading') {
  const type = select(api.types, initialType);
  const format = select([], '');
  const list = h('select', { class: 'src-list xref-list', size: '10', 'aria-label': t('ref.forWhich') });
  const empty = h('div', { class: 'menu-note' });
  const draw = () => {
    format.replaceChildren(...api.formats(type.value).map(([v, k]) => h('option', { value: v }, t(k))));
    const items = api.items(type.value);
    list.replaceChildren(...items.map((it, i) => { const o = h('option', { value: it.id }, it.label); if (i === 0) o.selected = true; return o; }));
    empty.textContent = items.length ? '' : t('ref.noItems');
  };
  type.addEventListener('change', draw);
  draw();
  const body = h('div', { class: 'ref-dlg xref-dlg' }, row(field(t('ref.refType'), type), field(t('ref.insertRefTo'), format)), h('label', { class: 'fm-label' }, t('ref.forWhich')), list, empty);
  const ok = await showDialog({ title: t('ref.crossRefTitle'), message: body, buttons: [{ label: t('ref.insert'), value: true, primary: true }, { label: t('common.cancel'), value: false }], cancelValue: false, validate: () => !!list.value });
  if (!ok || !list.value) return null;
  return { type: type.value, id: list.value, format: format.value };
}

/** Mark Index Entry → { main, sub, all } or null */
export async function markEntryDialog(selected) {
  const main = text(selected || '', { 'aria-label': t('ref.mainEntry') });
  const sub = text('', { 'aria-label': t('ref.subentry') });
  const body = h('div', { class: 'ref-dlg' }, field(t('ref.mainEntry'), main, { wide: true }), field(t('ref.subentry'), sub, { wide: true }), h('p', { class: 'fm-hint' }, t('ref.markHint')));
  const action = await showDialog({
    title: t('ref.markEntryTitle'), message: body, cancelValue: false,
    buttons: [{ label: t('ref.mark'), value: 'one', primary: true }, { label: t('ref.markAll'), value: 'all' }, { label: t('common.cancel'), value: false }],
    validate: () => { if (main.value.trim()) return true; main.focus(); return false; },
  });
  if (!action) return null;
  return { main: main.value.trim(), sub: sub.value.trim(), all: action === 'all' };
}

/** Index → { columns, rightAlign, leader, headings } or null */
export async function indexDialog(cur) {
  const columns = number(cur.columns, { min: '1', max: '4' });
  const right = check(t('ref.rightAlign'), cur.rightAlign);
  const leader = select(LEADERS(), cur.leader);
  const headings = check(t('ref.letterHeadings'), cur.headings);
  const preview = h('div', { class: 'ref-preview idx-preview', 'aria-hidden': 'true' });
  const draw = () => {
    const sep = right.input.checked ? h('span', { class: 'ref-prev-leader' }, leader.value.repeat(20)) : ', ';
    preview.replaceChildren(
      ...(headings.input.checked ? [h('div', { class: 'idx-prev-head' }, 'A')] : []),
      h('div', {}, 'Atmosphere', right.input.checked ? sep.cloneNode(true) : sep, '1'),
      h('div', { style: { paddingLeft: '14px' } }, 'Earth', right.input.checked ? sep.cloneNode(true) : ', ', '2'),
      h('div', {}, 'Asteroid belt', right.input.checked ? sep.cloneNode(true) : ', ', '3, 5'));
    preview.style.columnCount = String(Math.max(1, Math.min(4, Number(columns.value) || 1)));
  };
  [right.input, headings.input].forEach((x) => x.addEventListener('change', draw));
  leader.addEventListener('change', draw);
  columns.addEventListener('input', draw);
  draw();
  const body = h('div', { class: 'ref-dlg' }, preview, row(field(t('ref.columns'), columns), field(t('ref.tabLeader'), leader)), right, headings);
  const ok = await showDialog({ title: t('ref.indexTitle'), message: body, buttons: okCancel(), cancelValue: false });
  if (!ok) return null;
  return { columns: Math.max(1, Math.min(4, Number(columns.value) || 1)), rightAlign: right.input.checked, leader: leader.value, headings: headings.input.checked };
}

export { field, number, select, check, radios, row, group, text, okCancel };
