/**
 * Reviewing Pane: a summary (counts of insertions, deletions, formatting
 * changes and comments) and every revision in document order with its
 * author and time; click one to go to it. Docked on the left ("vertical") or
 * as a strip under the document ("horizontal").
 */
import { TextSelection } from 'prosemirror-state';
import { h } from './dom.js';
import { t } from '../i18n/index.js';
import { changesOf } from '../core/track-recording.js';
import { authorKey } from '../core/schema.js';

const when = (d) => {
  if (!d) return '';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export function createReviewingPane({ dock, bottom, store, getEditor }) {
  let rec = null;
  let list = null;
  let summary = null;
  let key = '';
  let mode = null;

  function items() {
    const doc = getEditor().view.state.doc;
    const out = changesOf(doc).map((c) => ({ kind: c.type, author: c.author, date: c.date, from: c.from, to: c.to, text: c.text }));
    doc.descendants((n, pos) => {
      if (n.type.name === 'annotation' && !n.attrs.parent) out.push({ kind: 'comment', author: n.attrs.creator, date: n.attrs.date, from: pos, to: pos + 1, text: (n.attrs.body || []).map((b) => (b.content || []).map((x) => x.text || '').join('')).join(' ') });
      return true;
    });
    return out.sort((a, b) => a.from - b.from);
  }

  function render(force = false) {
    if (!rec) return;
    const all = items();
    const k = JSON.stringify(all);
    if (!force && k === key) return;
    key = k;
    const count = (kind) => all.filter((x) => x.kind === kind).length;
    const revisions = all.filter((x) => x.kind !== 'comment').length;
    summary.replaceChildren(
      h('div', { class: 'rvp-total' }, t('rvp.revisions', { n: revisions })),
      h('div', { class: 'rvp-counts' }, `${t('rvp.insertions')}: ${count('insertion')} · ${t('rvp.deletions')}: ${count('deletion')} · ${t('rvp.formatting')}: ${count('formatChange')} · ${t('rvp.comments')}: ${count('comment')}`));
    list.replaceChildren(...(all.length ? all.map((x) => {
      const row = h('button', { type: 'button', class: `rvp-item k-${x.kind}`, 'data-author': authorKey(x.author) },
        h('span', { class: 'rvp-head' }, h('b', {}, x.author || t('rvp.unknown')), ` ${t(`rvp.kind.${x.kind}`)}`, h('span', { class: 'rvp-date' }, when(x.date))),
        h('span', { class: 'rvp-text' }, x.text || '¶'));
      row.addEventListener('click', () => {
        const view = getEditor().view;
        const to = Math.min(x.to, view.state.doc.content.size);
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, x.from, Math.max(x.from, to))).scrollIntoView());
        view.focus();
      });
      return row;
    }) : [h('div', { class: 'rvp-empty' }, t('rvp.none'))]));
  }

  function open(where = 'vertical') {
    close();
    mode = where;
    summary = h('div', { class: 'rvp-summary' });
    list = h('div', { class: 'rvp-list', role: 'list' });
    const body = h('div', { class: 'rvp-body' }, summary, list);
    if (where === 'horizontal') {
      bottom.replaceChildren(h('header', { class: 'pane-head' }, h('h2', { class: 'pane-title' }, t('rvp.title')), h('button', { type: 'button', class: 'pane-x', 'aria-label': t('common.close'), onclick: () => store.set({ reviewingPane: null }) }, '×')), body);
      bottom.hidden = false;
      rec = { bottom: true };
    } else {
      rec = dock.open({ id: 'reviewing', title: t('rvp.title'), body, onClose: () => { rec = null; if (store.get().reviewingPane === 'vertical') store.set({ reviewingPane: null }); } });
    }
    key = '';
    render(true);
  }

  function close() {
    if (!rec) return;
    if (rec.bottom) { bottom.hidden = true; bottom.replaceChildren(); rec = null; } else { const r = rec; rec = null; void r; dock.close('reviewing'); }
    mode = null;
  }

  store.subscribe((s, changed) => {
    if (!changed.includes('reviewingPane')) return;
    if (!s.reviewingPane) close();
    else if (s.reviewingPane !== mode) open(s.reviewingPane);
  });

  return { render, open, close, get isOpen() { return !!rec; } };
}
