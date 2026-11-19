/** Content Control Properties (Developer ▸ Properties). */
import { h } from './dom.js';
import { t } from '../i18n/index.js';
import { showDialog } from './dialog.js';
import { field, select, text, check, group } from './form.js';

const okCancel = () => [{ label: t('common.ok'), value: true, primary: true }, { label: t('common.cancel'), value: false }];
const DATE_FORMATS = ['dd/MM/yyyy', 'd MMMM yyyy', 'dddd, d MMMM yyyy', 'dd/MM/yy', 'yyyy-MM-dd', 'MM/dd/yyyy', 'd MMM yyyy'];

/** kind, attrs (loext), items → { attrs, items } or null */
export async function controlPropertiesDialog(kind, attrs, items) {
  const a = { ...attrs };
  const title = text(a['loext:alias'] || '', { 'aria-label': t('cc.title') });
  const tag = text(a['loext:tag'] || '', { 'aria-label': t('cc.tag') });
  const lockDelete = check(t('cc.lockDelete'), a['loext:lock'] === 'sdtLocked' || a['loext:lock'] === 'sdtContentLocked');
  const lockEdit = check(t('cc.lockEdit'), a['loext:lock'] === 'contentLocked' || a['loext:lock'] === 'sdtContentLocked');
  const extra = [];
  let list = (items || []).map((x) => ({ ...x }));
  let checked; let unchecked; let fmt;
  if (kind === 'checkbox') {
    checked = text(a['loext:checked-state'] || '☒', { maxlength: '2', style: 'width:60px' });
    unchecked = text(a['loext:unchecked-state'] || '☐', { maxlength: '2', style: 'width:60px' });
    extra.push(group(t('cc.checkboxProps'), field(t('cc.checkedSymbol'), checked), field(t('cc.uncheckedSymbol'), unchecked)));
  }
  if (kind === 'date') {
    fmt = select(DATE_FORMATS.map((f) => [f, f]), a['loext:date-format'] || 'dd/MM/yyyy');
    extra.push(group(t('cc.dateProps'), field(t('cc.dateFormat'), fmt, { wide: true })));
  }
  let listEl = null;
  if (kind === 'dropdown' || kind === 'combobox') {
    listEl = h('select', { class: 'src-list', size: '6', 'aria-label': t('cc.items') });
    const disp = text('', { placeholder: t('cc.displayName'), 'aria-label': t('cc.displayName') });
    const val = text('', { placeholder: t('cc.value'), 'aria-label': t('cc.value') });
    const draw = () => listEl.replaceChildren(...list.map((it, i) => h('option', { value: String(i) }, it.value && it.value !== it.display ? `${it.display}  (${it.value})` : it.display)));
    const add = h('button', { type: 'button', class: 'dlg-btn', onclick: () => { if (!disp.value.trim()) return; list.push({ display: disp.value.trim(), value: val.value.trim() || disp.value.trim() }); disp.value = ''; val.value = ''; draw(); } }, t('cc.add'));
    const remove = h('button', { type: 'button', class: 'dlg-btn', onclick: () => { const i = Number(listEl.value); if (Number.isFinite(i)) { list.splice(i, 1); draw(); } } }, t('cc.remove'));
    const up = h('button', { type: 'button', class: 'dlg-btn', onclick: () => { const i = Number(listEl.value); if (i > 0) { [list[i - 1], list[i]] = [list[i], list[i - 1]]; draw(); listEl.value = String(i - 1); } } }, t('cc.moveUp'));
    draw();
    extra.push(group(t('cc.listProps'), listEl, h('div', { class: 'cc-row' }, disp, val, add), h('div', { class: 'cc-row' }, remove, up)));
  }
  const body = h('div', { class: 'ref-dlg cc-dlg' }, field(t('cc.title'), title, { wide: true }), field(t('cc.tag'), tag, { wide: true }), group(t('cc.locking'), lockDelete, lockEdit), ...extra);
  const ok = await showDialog({ title: t('cc.propertiesTitle'), message: body, buttons: okCancel(), cancelValue: false });
  if (!ok) return null;
  const set = (k, v) => { if (v) a[k] = v; else delete a[k]; };
  set('loext:alias', title.value.trim());
  set('loext:tag', tag.value.trim());
  const del = lockDelete.input.checked;
  const ed = lockEdit.input.checked;
  set('loext:lock', del && ed ? 'sdtContentLocked' : del ? 'sdtLocked' : ed ? 'contentLocked' : '');
  if (kind === 'checkbox') { a['loext:checked-state'] = checked.value || '☒'; a['loext:unchecked-state'] = unchecked.value || '☐'; }
  if (kind === 'date') a['loext:date-format'] = fmt.value;
  return { attrs: a, items: list };
}
