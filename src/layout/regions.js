/**
 * Sections with their own page style. A paragraph (or table) whose style
 * names a master page starts a new page style; every top-level block until
 * the next such switch belongs to it. The editor flow is laid out at the
 * first page's body width, so blocks of a page style with another body width
 * or left edge (landscape, different margins) are wrapped and moved to line
 * up with their own pages' body.
 */
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { changesBlocks } from '../core/commands/lists.js';
import { autoFromTree } from '../core/odt/styles.js';

export const regionsKey = new PluginKey('regions');

/** Master page named by a top-level block (paragraph / heading / table), or null. */
export function blockMaster(node, index) {
  const name = node.type.name;
  if (name === 'paragraph' || name === 'heading') {
    return node.attrs.auto?.styleAttrs?.['style:master-page-name'] || index?.families.get('paragraph')?.get(node.attrs.styleName)?.a['style:master-page-name'] || null;
  }
  if (name === 'section') return node.firstChild ? blockMaster(node.firstChild, index) : null;
  if (name === 'table' && node.attrs.auto) return node.attrs.auto.styleAttrs?.['style:master-page-name'] || null;
  if (name === 'table' && node.attrs.styleName) {
    const t = index?.autos.get(`table:${node.attrs.styleName}`);
    return t ? autoFromTree(t).auto?.styleAttrs?.['style:master-page-name'] || t.a['style:master-page-name'] || null : null;
  }
  return null;
}

/** For each top-level block: [pos, node, masterName]. */
export function topLevelMasters(doc, index, firstName) {
  const out = [];
  let cur = firstName;
  doc.forEach((node, pos) => {
    const m = blockMaster(node, index);
    if (m) cur = m;
    out.push([pos, node, cur]);
  });
  return out;
}

export function regionsPlugin(getModel, getIndex) {
  function compute(doc) {
    const model = getModel();
    if (!model) return DecorationSet.empty;
    const list = topLevelMasters(doc, getIndex(), model.first.name);
    if (!list.length) return DecorationSet.empty;
    const base = model.masters.get(list[0][2]) || model.first;
    const decos = [];
    for (const [pos, node, name] of list) {
      const m = model.masters.get(name) || model.first;
      const dx = (m.x + m.marginLeft) - (base.x + base.marginLeft);
      if (Math.abs(dx) < 0.5 && Math.abs(m.bodyWidth - base.bodyWidth) < 0.5) continue;
      decos.push(Decoration.node(pos, pos + node.nodeSize, { nodeName: 'div', class: 'pg-region', style: `margin-left:${dx.toFixed(2)}px;width:${m.bodyWidth.toFixed(2)}px` }));
    }
    return DecorationSet.create(doc, decos);
  }
  return new Plugin({
    key: regionsKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, old, _o, state) {
        if (tr.getMeta(regionsKey) || (tr.docChanged && changesBlocks(tr))) return compute(state.doc);
        return tr.docChanged ? old.map(tr.mapping, tr.doc) : old;
      },
    },
    props: { decorations: (state) => regionsKey.getState(state) },
  });
}
