/**
 * Spacing between paragraphs. CSS collapses adjoining margins to the larger
 * one; Word and LibreOffice add a paragraph's space after to the next one's
 * space before (rule L2). This plugin decorates the pairs where that
 * differs: the first paragraph loses its bottom margin and the second gets
 * the sum as its top margin. It also applies:
 *   - contextual spacing (style:contextual-spacing / w:contextualSpacing):
 *     no space between paragraphs of the same style,
 *   - with Word's layout rules, border grouping (rule L6): consecutive
 *     paragraphs with the same borders share one box, so the borders between
 *     them are not drawn and the space between them is inside the box.
 * Tables, cells and other blocks break the chain (their own margins apply).
 */
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { mergeAuto } from '../core/odt/styles.js';
import { changesBlocks } from '../core/commands/lists.js';
import { toPx } from './units.js';

export const paraSpacingKey = new PluginKey('paraSpacing');

const BOX = ['fo:border', 'fo:border-top', 'fo:border-bottom', 'fo:border-left', 'fo:border-right', 'fo:padding', 'fo:padding-top', 'fo:padding-bottom', 'fo:padding-left', 'fo:padding-right', 'fo:background-color', 'fo:margin-left', 'fo:margin-right'];
const hasBorder = (a) => ['fo:border', 'fo:border-top', 'fo:border-bottom', 'fo:border-left', 'fo:border-right'].some((k) => a[k] && a[k] !== 'none');

/** Spacing-relevant properties of a paragraph node (cached by style + automatic style). */
function propsCache(getIndex) {
  const cache = new Map();
  return (node) => {
    const key = `${node.attrs.styleName}|${node.attrs.auto ? JSON.stringify(node.attrs.auto) : ''}`;
    let v = cache.get(key);
    if (v) return v;
    const index = getIndex();
    const auto = mergeAuto(index?.effective('paragraph', node.attrs.styleName) || null, node.attrs.auto);
    const pp = auto?.props?.['style:paragraph-properties']?.a || {};
    const px = (x) => (x ? toPx(x) || 0 : 0);
    const pad = (side) => px(pp[`fo:padding-${side}`] ?? pp['fo:padding']);
    const own = node.attrs.auto?.props?.['style:paragraph-properties']?.a || {};
    v = {
      // Spacing set by the paragraph's own (automatic) style: the style sheet's pair rules don't know it.
      direct: ['fo:margin-top', 'fo:margin-bottom', 'fo:margin', 'style:contextual-spacing'].some((k) => own[k] != null),
      before: px(pp['fo:margin-top'] ?? pp['fo:margin']), after: px(pp['fo:margin-bottom'] ?? pp['fo:margin']),
      contextual: pp['style:contextual-spacing'] === 'true', style: node.attrs.styleName,
      box: hasBorder(pp) ? JSON.stringify(BOX.map((k) => pp[k] || '')) : null, padTop: pad('top'), padBottom: pad('bottom'),
    };
    cache.set(key, v);
    return v;
  };
}

/** The decorations for a document. */
export function spacingDecorations(doc, getIndex, props = propsCache(getIndex)) {
  const index = getIndex();
  if (!index) return DecorationSet.empty;
  const add = index.compat?.addSpacing !== false;
  const group = !!index.compat?.wordLayout;
  const style = new Map(); // pos → { size, css: [] }
  const css = (pos, size, decl) => { let e = style.get(pos); if (!e) { e = { size, css: [] }; style.set(pos, e); } e.css.push(decl); };
  let prev = null;
  let parentNode = doc;
  const visit = (node, pos) => {
    if (node.isTextblock) {
      if (node.type.name !== 'paragraph' && node.type.name !== 'heading') { prev = null; return; }
      const b = props(node);
      if (prev) {
        const a = prev.p;
        const same = a.style === b.style;
        const after = a.contextual && same ? 0 : a.after;
        const before = b.contextual && same ? 0 : b.before;
        const gap = add ? after + before : Math.max(after, before);
        // Siblings styled only by their paragraph styles: the style sheet adds their spacing (styles.js).
        const bySheet = add && prev.parent === parentNode && !a.direct && !b.direct;
        const sheetGap = bySheet ? (a.after > 0.01 && b.before > 0.01 && !((a.contextual || b.contextual) && same) ? a.after + b.before : Math.max(a.after, b.before)) : Math.max(a.after, b.before);
        if (group && a.box && a.box === b.box) {
          // One box: no border or padding between, the space between inside it.
          css(prev.pos, prev.size, 'border-bottom:none;padding-bottom:0;margin-bottom:0');
          css(pos, node.nodeSize, `border-top:none;padding-top:${gap.toFixed(2)}px;margin-top:0`);
        } else if (gap >= a.after && Math.abs(gap - sheetGap) > 0.01) {
          // Margins collapse to the larger one, so a top margin of the whole gap
          // is enough (one decoration: they are scanned per top-level node).
          css(pos, node.nodeSize, `margin-top:${gap.toFixed(2)}px`);
        } else if (Math.abs(gap - sheetGap) > 0.01) {
          css(prev.pos, prev.size, 'margin-bottom:0');
          css(pos, node.nodeSize, `margin-top:${gap.toFixed(2)}px`);
        }
      }
      prev = { pos, size: node.nodeSize, p: b, parent: parentNode };
      return;
    }
    if (node.type.name === 'table' || node.isAtom || node.isLeaf) {
      prev = null;
      if (node.type.name === 'table') visitChildren(node, pos);
      prev = null;
      return;
    }
    visitChildren(node, pos);
  };
  const visitChildren = (node, pos) => {
    // Cells start a chain of their own.
    if (node.type.spec.tableRole === 'cell' || node.type.spec.tableRole === 'header_cell') prev = null;
    node.forEach((child, offset) => {
      parentNode = node;
      visit(child, pos + 1 + offset);
      if (child.type.spec.tableRole === 'cell' || child.type.spec.tableRole === 'header_cell') prev = null;
    });
  };
  doc.forEach((child, offset) => { parentNode = doc; visit(child, offset); });
  const decos = [];
  for (const [pos, e] of style) decos.push(Decoration.node(pos, pos + e.size, { style: e.css.join(';') }));
  return DecorationSet.create(doc, decos);
}

export function paraSpacingPlugin(getIndex) {
  let props = propsCache(getIndex);
  return new Plugin({
    key: paraSpacingKey,
    state: {
      init: (_, state) => spacingDecorations(state.doc, getIndex, props),
      apply(tr, old, _o, state) {
        // New styles (a document was opened, a style changed): start over.
        if (tr.getMeta(paraSpacingKey)) { props = propsCache(getIndex); return spacingDecorations(state.doc, getIndex, props); }
        if (tr.docChanged && changesBlocks(tr)) return spacingDecorations(state.doc, getIndex, props);
        return tr.docChanged ? old.map(tr.mapping, tr.doc) : old;
      },
    },
    props: { decorations: (state) => paraSpacingKey.getState(state) },
  });
}
