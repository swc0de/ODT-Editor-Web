/** Menu widgets for the References tab: the Table of Contents and Bibliography galleries. */
import { h } from './dom.js';
import { t } from '../i18n/index.js';

function bind(el, { registry, close, toast }, cmdId, run) {
  const enabled = registry.isEnabled(cmdId);
  if (!enabled) el.classList.add('is-disabled');
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!enabled) { toast(t('toast.comingSoon', { name: registry.label(cmdId) })); return; }
    close({ restoreFocus: true });
    run?.();
  });
}

/** A gallery item: a caption and a small page preview. */
function tile(o, cmdId, arg, caption, preview, first) {
  const b = h('button', { type: 'button', class: 'ref-tile', tabindex: '-1', 'data-menu-focus': first ? '' : null, 'aria-label': caption },
    h('span', { class: 'ref-tile-caption' }, caption), h('span', { class: 'ref-tile-page' }, preview));
  bind(b, o, cmdId, () => o.registry.run(cmdId, arg));
  return b;
}

const tocPreview = (title) => [
  h('span', { class: 'ref-tile-title' }, title),
  ...[[0, t('ref.heading') + ' 1', 1], [1, t('ref.heading') + ' 2', 1], [2, t('ref.heading') + ' 3', 1], [0, t('ref.heading') + ' 1', 2]].map(([lv, label, page]) => h('span', { class: 'ref-tile-line', style: { paddingLeft: `${lv * 8}px` } }, h('span', {}, label), h('span', { class: 'ref-tile-dots' }), h('span', {}, String(page)))),
];

function tocGallery(o) {
  return h('div', { class: 'menu-widget ref-gallery' }, h('div', { class: 'menu-header' }, t('menu.builtIn')),
    tile(o, 'references.insertToc', 'auto1', t('ref.auto1'), tocPreview(t('ref.contents')), true),
    tile(o, 'references.insertToc', 'auto2', t('ref.auto2'), tocPreview(t('ref.tableOfContents')), false));
}

function bibliographyGallery(o) {
  const lines = (title) => [h('span', { class: 'ref-tile-title' }, title), ...[1, 2, 3].map(() => h('span', { class: 'ref-tile-line hanging' }, h('span', { class: 'ref-tile-bar' })))];
  return h('div', { class: 'menu-widget ref-gallery' }, h('div', { class: 'menu-header' }, t('menu.builtIn')),
    tile(o, 'references.insertBibliography', 'bibliography', t('ref.bibliography'), lines(t('ref.bibliography')), true),
    tile(o, 'references.insertBibliography', 'references', t('ref.references'), lines(t('ref.references')), false),
    tile(o, 'references.insertBibliography', 'worksCited', t('ref.worksCited'), lines(t('ref.worksCited')), false));
}

/** Insert Citation: the document's sources (Word lists them above Add New Source…). */
function citationList(o) {
  const c = o.registry.context();
  const list = c.mainEditor && c.session ? o.registry.get('references.insertCitation')?.sources?.(c) || [] : [];
  const wrap = h('div', { class: 'menu-widget cite-list', role: 'group', 'aria-label': t('src.currentList') });
  if (!list.length) wrap.append(h('div', { class: 'menu-note' }, t('src.noneYet')));
  list.slice(0, 30).forEach((s, i) => {
    const b = h('button', { type: 'button', class: 'menu-item cite-item', role: 'menuitem', tabindex: '-1', 'data-menu-focus': i === 0 ? '' : null },
      h('span', { class: 'cite-tag' }, s.id), h('span', { class: 'cite-label' }, s.label));
    bind(b, o, 'references.insertCitation', () => o.registry.run('references.insertCitation', s.id));
    wrap.append(b);
  });
  return wrap;
}

export const REFERENCE_WIDGETS = { tocGallery, bibliographyGallery, citationList };
