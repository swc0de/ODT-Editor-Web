/**
 * Page-number and page-count fields in the body show the numbers of the
 * page they land on (headers and footers fill theirs in when pages render).
 * The field node keeps its stored text; a decoration supplies what's shown.
 */
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { formatNumber } from '../core/commands/lists.js';
import { REF_ELEMENTS, refText } from '../core/captions.js';

export const fieldsKey = new PluginKey('pageFields');

export function fieldsPlugin() {
  return new Plugin({
    key: fieldsKey,
    state: {
      init: () => ({ decos: DecorationSet.empty, sig: '' }),
      apply(tr, old) {
        const meta = tr.getMeta(fieldsKey);
        if (meta) return meta;
        return tr.docChanged ? { decos: old.decos.map(tr.mapping, tr.doc), sig: '' } : old;
      },
    },
    props: { decorations: (state) => fieldsKey.getState(state).decos },
  });
}

/** After a layout: numbers for the fields (pages = paginator pages; model for number formats). */
export function updatePageFields(view, pages, model) {
  if (!pages.length) return;
  const items = [];
  const pageOf = (pos) => {
    let i = 0;
    for (let k = pages.length - 1; k >= 0; k--) if (pages[k].startPos <= pos) { i = k; break; }
    return String(pages[i].number ?? i + 1);
  };
  view.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'field') return true;
    const el = node.attrs.element;
    // Cross-references to a page, or "above" / "below", follow the layout.
    if (REF_ELEMENTS.has(el) && ['page', 'direction'].includes(node.attrs.fieldAttrs?.['text:reference-format'])) {
      items.push([pos, node, refText(view.state.doc, node.attrs, pageOf, pos)]);
      return false;
    }
    if (el !== 'text:page-number' && el !== 'text:page-count') return false;
    let i = 0;
    for (let k = pages.length - 1; k >= 0; k--) if (pages[k].startPos <= pos) { i = k; break; }
    const page = pages[i];
    const fmt = node.attrs.fieldAttrs?.['style:num-format'] ?? (model?.masters.get(page.master)?.numFormat || '1');
    items.push([pos, node, el === 'text:page-number' ? formatNumber(page.number, fmt) : formatNumber(pages.length, fmt)]);
    return false;
  });
  const sig = items.map(([p, , v]) => `${p}:${v}`).join(',');
  if (sig === fieldsKey.getState(view.state).sig) return;
  const decos = items.map(([pos, node, v]) => Decoration.node(pos, pos + node.nodeSize, { 'data-shown': v }));
  view.dispatch(view.state.tr.setMeta(fieldsKey, { decos: DecorationSet.create(view.state.doc, decos), sig }).setMeta('addToHistory', false).setMeta('pagination', true));
}
