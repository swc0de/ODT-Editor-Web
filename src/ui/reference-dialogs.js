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

export { field, number, select, check, radios, row, group, text, okCancel };
