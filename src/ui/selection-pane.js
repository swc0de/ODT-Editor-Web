/**
 * Selection Pane: every drawing object in the document, top-most first.
 * Click selects it, double-click renames it (draw:name), the eye hides or
 * shows it (draw:display="none"), ▲ / ▼ change the stacking order, and
 * Show All / Hide All apply to every object.
 */
import { NodeSelection } from 'prosemirror-state';
import { h } from './dom.js';
import { t } from '../i18n/index.js';
import { iconSvg } from './icons.js';
import { withFrameAttrs } from '../core/objects.js';

const zOf = (n) => Number(n.attrs.frameAttrs?.['draw:z-index'] ?? 0);

export function createSelectionPane({ dock, store, getEditor, registry }) {
  let rec = null;
  let listEl = null;
  let lastKey = '';

  const objects = () => {
    const out = [];
    getEditor().view.state.doc.descendants((n, pos) => { if (n.type.name === 'frame') out.push({ node: n, pos }); return true; });
    return out.sort((a, b) => zOf(b.node) - zOf(a.node) || b.pos - a.pos);
  };

  const setAttrsAll = (items) => {
    const view = getEditor().view;
    const tr = view.state.tr;
    for (const { pos, attrs } of items) tr.setNodeMarkup(pos, null, attrs);
    view.dispatch(tr);
  };

  function render(force = false) {
    if (!rec) return;
    const view = getEditor().view;
    const sel = view.state.selection;
    const items = objects();
    const key = JSON.stringify([items.map((x) => [x.pos, x.node.attrs.frameAttrs['draw:name'], x.node.attrs.frameAttrs['draw:display'], zOf(x.node)]), sel instanceof NodeSelection ? sel.from : -1]);
    if (!force && key === lastKey) return;
    lastKey = key;
    listEl.replaceChildren();
    if (!items.length) { listEl.append(h('div', { class: 'selp-empty' }, t('selp.empty'))); return; }
    for (const { node, pos } of items) {
      const name = node.attrs.frameAttrs['draw:name'] || t(`selp.kind.${node.attrs.kind}`);
      const hidden = node.attrs.frameAttrs['draw:display'] === 'none';
      const active = sel instanceof NodeSelection && sel.from === pos;
      const label = h('span', { class: 'selp-name' }, name);
      const eye = h('button', { type: 'button', class: 'selp-eye', 'aria-label': t(hidden ? 'selp.show' : 'selp.hide', { name }), 'data-tip': t(hidden ? 'selp.show' : 'selp.hide', { name }), 'aria-pressed': String(!hidden), html: iconSvg(hidden ? 'minus' : 'eye', { size: 14 }) });
      const row = h('div', { class: `selp-row${active ? ' is-active' : ''}${hidden ? ' is-hidden' : ''}`, role: 'option', 'aria-selected': String(active), tabindex: '0', 'data-pos': String(pos) }, label, eye);
      row.addEventListener('click', (e) => {
        if (eye.contains(e.target)) return;
        view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)).scrollIntoView());
        view.focus();
      });
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter') row.click(); if (e.key === 'F2') rename(); });
      row.addEventListener('dblclick', () => rename());
      eye.addEventListener('click', () => setAttrsAll([{ pos, attrs: withFrameAttrs(node.attrs, { 'draw:display': hidden ? null : 'none' }) }]));
      const rename = () => {
        const input = h('input', { class: 'fm-input selp-input', value: name, 'aria-label': t('selp.rename') });
        label.replaceWith(input);
        input.focus();
        input.select();
        const done = (ok) => {
          if (ok && input.value.trim() && input.value.trim() !== name) setAttrsAll([{ pos, attrs: withFrameAttrs(node.attrs, { 'draw:name': input.value.trim() }) }]);
          else render(true);
        };
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); e.stopPropagation(); });
        input.addEventListener('blur', () => done(true), { once: true });
      };
      listEl.append(row);
    }
  }

  function open() {
    if (rec) return;
    listEl = h('div', { class: 'selp-list', role: 'listbox', 'aria-label': t('selp.title') });
    const all = (hide) => setAttrsAll(objects().map(({ node, pos }) => ({ pos, attrs: withFrameAttrs(node.attrs, { 'draw:display': hide ? 'none' : null }) })));
    const btn = (label, onclick, icon) => h('button', { type: 'button', class: 'dlg-btn selp-btn', onclick, ...(icon ? { 'aria-label': label, 'data-tip': label, html: iconSvg(icon, { size: 14 }) } : {}) }, icon ? null : label);
    const bar = h('div', { class: 'selp-bar' },
      btn(t('selp.showAll'), () => all(false)), btn(t('selp.hideAll'), () => all(true)),
      btn(t('cmd.layout.bringForward'), () => registry.run('layout.bringForward'), 'chevron-up'),
      btn(t('cmd.layout.sendBackward'), () => registry.run('layout.sendBackward'), 'chevron-down'));
    rec = dock.open({ id: 'selection', title: t('selp.title'), body: h('div', { class: 'pane-body selp' }, bar, listEl), onClose: () => { rec = null; store.set({ selectionPaneOpen: false }); } });
    lastKey = '';
    render(true);
  }

  store.subscribe((s, changed) => {
    if (!changed.includes('selectionPaneOpen')) return;
    if (s.selectionPaneOpen) open(); else if (rec) dock.close('selection');
  });

  return { open, refresh: () => render(false), isOpen: () => !!rec };
}
