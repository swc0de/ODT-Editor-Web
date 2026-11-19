/** Helpers for commands acting on the selected drawing object. */
import { NodeSelection } from 'prosemirror-state';
import { withWrap, wrapOf, graphicProps } from '../../core/objects.js';

export const canEdit = (c) => !!c.editor && c.state.editingMode !== 'viewing';

/** { view, pos, node, ov, inText } of the selected object (or the one whose text is being edited). */
export const sel = (c) => (c.ui.objects?.selected(c.editor) || (c.mainEditor && c.ui.objects?.selected(c.mainEditor)) || null);
export const hasObj = (c) => canEdit(c) && !!sel(c);
export const hasKind = (...kinds) => (c) => { const s = canEdit(c) && sel(c); return !!s && kinds.includes(s.node.attrs.kind); };
export const styleIndex = (c) => c.ui.docArea?.styleIndex;
export const gpOf = (c) => { const s = sel(c); return s ? graphicProps(s.node.attrs, styleIndex(c)) : {}; };

/** Replaces the selected object's attrs with fn(attrs) as one undoable step; keeps it selected. */
export function update(c, fn) {
  const s = sel(c);
  if (!s) return false;
  const next = fn(s.node.attrs, s);
  if (!next || next === s.node.attrs) return false;
  const tr = s.view.state.tr.setNodeMarkup(s.pos, null, next);
  if (!s.inText) tr.setSelection(NodeSelection.create(tr.doc, s.pos));
  s.view.dispatch(tr);
  if (!s.inText) s.view.focus();
  return true;
}

/** Position (px) of the object's box relative to its anchor paragraph, from the screen. */
export function screenOffset(c, s) {
  const dom = s.view.nodeDOM(s.pos);
  const box = dom?.querySelector?.('.obj-box') || dom;
  const p = dom?.parentElement?.closest('p, h1, h2, h3, h4, h5, h6');
  if (!box || !p) return { x: 0, y: 0 };
  const z = c.state.zoom / 100;
  const br = box.getBoundingClientRect();
  const pr = p.getBoundingClientRect();
  return { x: Math.max(0, (br.left - pr.left) / z), y: Math.max(0, (br.top - pr.top) / z) };
}

/**
 * Changes the wrapping. A floating object is moved to the start of its
 * paragraph (where floats are anchored) and keeps its place on the page.
 */
export function setWrap(c, wrap) {
  const s = sel(c);
  if (!s) return false;
  const a = s.node.attrs;
  const from = wrapOf(a, styleIndex(c));
  if (from === wrap) return true;
  const off = from === 'inline' ? screenOffset(c, s) : null;
  const next = withWrap(a, wrap, off || undefined);
  const tr = s.view.state.tr;
  const $p = tr.doc.resolve(s.pos);
  const start = $p.start();
  if (wrap !== 'inline' && s.pos !== start && !s.inText) {
    tr.delete(s.pos, s.pos + s.node.nodeSize);
    tr.insert(start, s.node.type.create(next));
    tr.setSelection(NodeSelection.create(tr.doc, start));
  } else {
    tr.setNodeMarkup(s.pos, null, next);
    if (!s.inText) tr.setSelection(NodeSelection.create(tr.doc, s.pos));
  }
  s.view.dispatch(tr);
  s.view.focus();
  return true;
}

/** All objects of the document: [{ node, pos }] in document order. */
export function allObjects(doc) {
  const out = [];
  doc.descendants((n, pos) => { if (n.type.name === 'frame') out.push({ node: n, pos }); return true; });
  return out;
}

export const zOf = (n) => Number(n.attrs.frameAttrs?.['draw:z-index'] ?? 0);
