/**
 * File ▸ Info: Protect Document (encrypt with a password), Inspect Document
 * (comments, tracked changes, personal information, hidden data — with
 * Remove buttons), Version History (from autosaves), and the document's
 * properties (title, subject, author, keywords, comments) and statistics.
 */
import { h } from './dom.js';
import { iconSvg } from './icons.js';
import { t } from '../i18n/index.js';
import { documentStats } from '../core/document.js';
import { findChild } from '../core/odt/xml.js';
import { editState } from '../core/state-step.js';
import { passwordDialog } from './password-dialog.js';

const PROPS = [
  ['title', 'dc:title'],
  ['subject', 'dc:subject'],
  ['author', 'meta:initial-creator'],
  ['keywords', 'meta:keyword'],
  ['comments', 'dc:description'],
];

const textOf = (tree) => (tree?.c || []).filter((x) => typeof x === 'string').join('');

/** A property's value from the meta tree (keywords: all meta:keyword joined with commas). */
export function metaValue(meta, el) {
  if (el === 'meta:keyword') return (meta?.c || []).filter((x) => x.n === 'meta:keyword').map(textOf).join(', ');
  return textOf(findChild(meta || {}, el));
}

/** A new meta tree with a property set (empty removes it). */
export function setMetaValue(meta, el, value) {
  const c = (meta?.c || []).filter((x) => typeof x === 'string' || x.n !== el);
  const v = String(value || '').trim();
  if (el === 'meta:keyword') for (const k of v.split(/\s*[,;]\s*/).filter(Boolean)) c.push({ n: el, a: {}, c: [k] });
  else if (v) c.push({ n: el, a: {}, c: [v] });
  return { ...(meta || { n: 'office:meta', a: {} }), c };
}

/** What Inspect Document finds: [{ id, count, label, detail, remove? }] */
export function inspect(state, doc) {
  const found = { comments: 0, changes: 0, authors: new Set(), opaque: 0, merge: !!state.mailMerge, controls: 0 };
  doc.descendants((n) => {
    if (n.type.name === 'annotation') { found.comments++; if (n.attrs.creator) found.authors.add(n.attrs.creator); }
    if (n.attrs?.change) { found.changes++; if (n.attrs.change.author) found.authors.add(n.attrs.change.author); }
    for (const m of n.marks || []) if (['insertion', 'deletion', 'formatChange'].includes(m.type.name)) { found.changes++; if (m.attrs.author) found.authors.add(m.attrs.author); }
    if (n.type.name === 'opaque_block' || n.type.name === 'opaque_inline') found.opaque++;
    return true;
  });
  for (const el of ['meta:initial-creator', 'dc:creator', 'meta:printed-by']) { const v = metaValue(state.meta, el); if (v) found.authors.add(v); }
  return found;
}

export function renderInfo({ registry, store, session, refresh }) {
  const c = registry.context();
  const view = () => c.mainEditor.view;
  const st = session.state;
  const stats = documentStats(view().state.doc);
  const fmt = (iso) => { const d = iso ? new Date(iso) : null; return d && !isNaN(d) ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(d) : '—'; };

  // ---------------------------------------------------------- protect
  const protectBtn = h('button', { type: 'button', class: 'bs-info-btn', 'data-action': 'protect' }, h('span', { html: iconSvg('restrict', { size: 26 }) }), h('span', {}, t('info.protect')));
  protectBtn.addEventListener('click', async () => {
    if (session.protected) { session.setPassword(null); c.ui.toast(t('info.passwordRemoved')); refresh(); return; }
    const pw = await passwordDialog({ title: t('info.encryptTitle'), message: t('info.encryptPrompt'), confirm: true });
    if (pw == null) return;
    session.setPassword(pw);
    c.ui.toast(t('info.passwordSet'));
    refresh();
  });
  const protect = h('section', { class: 'bs-info-row' }, protectBtn, h('div', {},
    h('h2', { class: 'bs-h2' }, t('info.protectTitle')),
    h('p', { class: 'bs-empty' }, session.protected ? t('info.protectedOn') : t('info.protectedOff')),
    session.protected ? h('button', { type: 'button', class: 'bs-text-btn', onclick: () => protectBtn.click() }, t('info.removePassword')) : null));

  // ---------------------------------------------------------- inspect
  const found = inspect(st, view().state.doc);
  const rows = [];
  const row = (id, label, detail, action) => rows.push(h('div', { class: 'bs-inspect-row', 'data-finding': id }, h('div', {}, h('strong', {}, label), h('div', { class: 'bs-empty' }, detail)), action ? h('button', { type: 'button', class: 'bs-text-btn', onclick: async () => { await action(); refresh(); } }, t('info.remove')) : null));
  if (found.comments) row('comments', t('info.findComments', { count: found.comments }), t('info.findCommentsDetail'), () => registry.run('review.deleteAllComments'));
  if (found.changes) row('changes', t('info.findChanges', { count: found.changes }), t('info.findChangesDetail'), () => registry.run('review.acceptAll'));
  if (found.authors.size) row('personal', t('info.findPersonal'), [...found.authors].join(', '), () => removePersonal(c, session));
  if (found.merge) row('merge', t('info.findMerge'), t('info.findMergeDetail'), () => registry.run('mailings.mergeNormal'));
  if (found.opaque) row('opaque', t('info.findOpaque', { count: found.opaque }), t('info.findOpaqueDetail'), null);
  if (!rows.length) rows.push(h('p', { class: 'bs-empty' }, t('info.findNothing')));
  const inspectSec = h('section', { class: 'bs-info-row' }, h('span', { class: 'bs-info-icon', html: iconSvg('accessibility', { size: 26 }) }), h('div', { class: 'bs-inspect' },
    h('h2', { class: 'bs-h2' }, t('info.inspectTitle')), h('p', { class: 'bs-empty' }, t('info.inspectHint')), ...rows));

  // ---------------------------------------------------------- versions
  const versionList = h('div', { class: 'bs-versions' }, h('p', { class: 'bs-empty' }, t('info.noVersions')));
  session.versions().then((vs) => {
    if (!vs.length) return;
    versionList.replaceChildren(...vs.map((v) => {
      const b = h('button', { type: 'button', class: 'bs-recent-open', 'data-version': v.id }, h('span', { class: 'bs-recent-icon', html: iconSvg('file-clock', { size: 18 }) }), h('span', { class: 'bs-recent-text' }, h('span', { class: 'bs-recent-name' }, fmt(v.savedAt)), h('span', { class: 'bs-recent-when' }, v.name)));
      b.addEventListener('click', async () => { if (await session.openVersion(v)) store.set({ backstageOpen: false }); });
      return b;
    }));
  });
  const versions = h('section', { class: 'bs-info-row' }, h('span', { class: 'bs-info-icon', html: iconSvg('file-clock', { size: 26 }) }), h('div', {},
    h('h2', { class: 'bs-h2' }, t('info.versionsTitle')), h('p', { class: 'bs-empty' }, t('info.versionsHint')), versionList));

  // ---------------------------------------------------------- properties
  const fields = PROPS.map(([key, el]) => {
    const input = h(key === 'comments' ? 'textarea' : 'input', { class: 'bs-prop-input', 'data-prop': key, 'aria-label': t(`info.prop.${key}`), placeholder: t('info.addValue'), rows: key === 'comments' ? '3' : null });
    input.value = metaValue(st.meta, el);
    input.addEventListener('change', () => {
      editState(view(), session.state, ['meta'], (s) => { s.meta = setMetaValue(s.meta, el, input.value); });
      if (key === 'title' && input.value.trim()) c.ui.toast(t('info.saved'));
    });
    return h('label', { class: 'bs-prop' }, h('span', { class: 'bs-prop-label' }, t(`info.prop.${key}`)), input);
  });
  const stat = (k, v) => h('div', { class: 'bs-prop' }, h('span', { class: 'bs-prop-label' }, t(`info.stat.${k}`)), h('span', { 'data-stat': k }, String(v)));
  const props = h('aside', { class: 'bs-props' },
    h('h2', { class: 'bs-h2' }, t('info.properties')), ...fields,
    h('h2', { class: 'bs-h2' }, t('info.statistics')),
    stat('pages', c.ui.docArea.pages.length), stat('words', stats.words), stat('characters', stats.chars), stat('paragraphs', stats.paragraphs), stat('tables', stats.tables), stat('pictures', stats.images),
    h('h2', { class: 'bs-h2' }, t('info.dates')),
    stat('created', fmt(metaValue(st.meta, 'meta:creation-date'))), stat('modified', fmt(metaValue(st.meta, 'dc:date'))), stat('lastModifiedBy', metaValue(st.meta, 'dc:creator') || '—'));

  return h('div', { class: 'bs-home bs-info' },
    h('h1', { class: 'bs-title' }, t('backstage.info')),
    h('p', { class: 'bs-info-name' }, session.info.name),
    h('div', { class: 'bs-info-cols' }, h('div', { class: 'bs-info-main' }, protect, inspectSec, versions), props));
}

/** Removes authors' names: document properties, comment authors and initials, tracked-change authors. */
function removePersonal(c, session) {
  const view = c.mainEditor.view;
  editState(view, session.state, ['meta'], (s) => {
    let meta = s.meta;
    for (const el of ['meta:initial-creator', 'dc:creator', 'meta:printed-by']) meta = setMetaValue(meta, el, '');
    s.meta = meta;
  }, (tr) => {
    const anon = t('info.author');
    view.state.doc.descendants((n, pos) => {
      if (n.type.name === 'annotation') tr.setNodeMarkup(pos, null, { ...n.attrs, creator: anon, initials: '' });
      if (n.attrs?.change?.author) tr.setNodeMarkup(pos, null, { ...n.attrs, change: { ...n.attrs.change, author: anon } });
      if (n.isText) {
        for (const m of n.marks) {
          if (['insertion', 'deletion', 'formatChange'].includes(m.type.name) && m.attrs.author && m.attrs.author !== anon) {
            tr.removeMark(pos, pos + n.nodeSize, m);
            tr.addMark(pos, pos + n.nodeSize, m.type.create({ ...m.attrs, author: anon }));
          }
        }
      }
      return true;
    });
    tr.setMeta('tcSkip', true);
  });
}
