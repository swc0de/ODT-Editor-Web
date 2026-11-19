/**
 * References ▸ Table of Contents: the gallery (two automatic tables), Custom
 * Table of Contents, Remove, Add Text (outline level of the paragraph) and
 * Update Table (page numbers only, or the entire table). Page numbers come
 * from the layout; after a change the numbers are refreshed once the pages
 * have settled.
 */
import { TextSelection } from 'prosemirror-state';
import { Fragment } from 'prosemirror-model';
import { schema } from '../../core/schema.js';
import { TOC_DEFAULTS, tocNode, tocBody, tocOptions, tocSource, findIndexes, uniqueIndexName, collectHeadings, headingHref } from '../../core/indexes.js';
import { editState } from '../../core/state-step.js';
import { ensureStyles } from '../../core/style-edit.js';
import { useStyle } from '../home/index.js';

export const TOC_STYLES = ['Contents_20_Heading', 'Index_20_Link', ...Array.from({ length: 9 }, (_, i) => `Contents_20_${i + 1}`)];

/** Page number of a document position, as shown on the page. */
export const pageOf = (c) => (pos) => {
  const da = c.ui.docArea;
  const p = da.pages[da.pageAt(pos)];
  return p ? String(p.number ?? '') : '';
};

/** Runs fn once the pagination has settled (a few frames without pending work). */
export function whenLaidOut(c, fn) {
  let quiet = 0;
  let frames = 0;
  const tick = () => {
    frames++;
    quiet = c.ui.docArea.layoutPending ? 0 : quiet + 1;
    if (quiet >= 3 || frames > 120) fn(); else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Makes sure the document defines the styles an index uses (undoable). */
export function ensureIndexStyles(c, names) {
  editState(c.mainEditor.view, c.session.state, ['commonStyles'], (st) => { const a = ensureStyles(st, 'paragraph', names); const b = ensureStyles(st, 'text', names); return a || b; });
}

/** Inserts a block node at the caret: replacing an empty paragraph, else before the current top-level block. */
export function insertBlockAtCaret(c, node) {
  const view = c.mainEditor.view;
  const { $from } = view.state.selection;
  const tr = view.state.tr;
  let pos;
  if ($from.depth >= 1 && $from.parent.isTextblock && !$from.parent.content.size && $from.depth === 1) {
    pos = $from.before(1);
    tr.replaceWith(pos, pos + $from.parent.nodeSize, node);
  } else {
    pos = $from.depth >= 1 ? $from.before(1) : $from.pos;
    tr.insert(pos, node);
  }
  tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1)));
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return pos;
}

/**
 * Rebuilds the body of the index at pos. pagesOnly: keep the entries, only
 * refresh their page numbers. history: false for the follow-up after layout.
 */
export function updateToc(c, pos, { pagesOnly = false, history = true } = {}) {
  const view = c.mainEditor.view;
  const node = view.state.doc.nodeAt(pos);
  if (!node || node.type.name !== 'index') return;
  const o = tocOptions(node.attrs.source);
  const page = pageOf(c);
  let content;
  if (pagesOnly && o.pageNumbers) {
    // Each linked entry ends with its page number: replace just that.
    const heads = new Map(collectHeadings(view.state.doc, 10).map((h) => [headingHref(h.text), h.pos]));
    const blocks = [];
    node.forEach((p) => {
      const link = p.firstChild?.marks.find((m) => m.type.name === 'link');
      const target = link && heads.get(link.attrs.href);
      const last = p.lastChild;
      if (target == null || !last?.isText || !/^\d*$/.test(last.text.trim())) { blocks.push(p); return; }
      const kids = [];
      p.forEach((k, _o, i) => { kids.push(i === p.childCount - 1 ? schema.text(page(target) || ' ', last.marks) : k); });
      blocks.push(p.copy(Fragment.from(kids)));
    });
    content = Fragment.from(blocks);
  } else {
    o.title = o.title ?? '';
    content = Fragment.fromJSON(schema, tocBody(view.state.doc, o, page));
  }
  const attrs = pagesOnly ? node.attrs : { ...node.attrs, titleCount: o.title ? 1 : 0, titleAttrs: o.title ? (node.attrs.titleAttrs || { 'text:name': `${node.attrs.attrs['text:name'] || 'Table of Contents1'}_Head` }) : null };
  if (content.eq(node.content) && attrs === node.attrs) return;
  const tr = view.state.tr.replaceWith(pos, pos + node.nodeSize, node.type.create(attrs, content));
  if (!history) tr.setMeta('addToHistory', false);
  view.dispatch(tr);
}

/** Updates every TOC: entries (unless pagesOnly), then page numbers once laid out. */
export function updateAllTocs(c, { pagesOnly = false } = {}) {
  for (const { pos } of findIndexes(c.mainEditor.view.state.doc, 'text:table-of-content').reverse()) updateToc(c, pos, { pagesOnly });
  whenLaidOut(c, () => {
    for (const { pos } of findIndexes(c.mainEditor.view.state.doc, 'text:table-of-content').reverse()) updateToc(c, pos, { pagesOnly: true, history: false });
  });
}

/** Inserts a TOC (or replaces the first one) with options. */
export function insertToc(c, options) {
  const o = { ...TOC_DEFAULTS, ...options };
  ensureIndexStyles(c, TOC_STYLES);
  const view = c.mainEditor.view;
  const existing = findIndexes(view.state.doc, 'text:table-of-content')[0];
  if (existing) {
    const n = existing.node;
    const tr = view.state.tr.setNodeMarkup(existing.pos, null, { ...n.attrs, source: tocSource(o) });
    view.dispatch(tr);
    updateToc(c, existing.pos);
  } else {
    insertBlockAtCaret(c, tocNode(view.state.doc, o, pageOf(c), uniqueIndexName(view.state.doc, 'Table of Contents')));
  }
  whenLaidOut(c, () => {
    for (const { pos } of findIndexes(c.mainEditor.view.state.doc, 'text:table-of-content').reverse()) updateToc(c, pos, { pagesOnly: true, history: false });
  });
}

export function removeToc(c) {
  const view = c.mainEditor.view;
  const found = findIndexes(view.state.doc, 'text:table-of-content');
  const here = found.find((f) => view.state.selection.from >= f.pos && view.state.selection.from <= f.pos + f.node.nodeSize) || found[0];
  if (!here) return;
  const tr = view.state.tr.delete(here.pos, here.pos + here.node.nodeSize);
  if (!tr.doc.content.size) tr.insert(0, schema.nodes.paragraph.create({ styleName: 'Standard' }));
  view.dispatch(tr);
  view.focus();
}

/** Outline level of the paragraph at the caret: 0 = not in the TOC. */
export function outlineLevelAt(c) {
  const $f = c.editor.view.state.selection.$from;
  return $f.parent.type.name === 'heading' ? $f.parent.attrs.level : 0;
}

/** Add Text: makes the paragraph a heading of that level (its Heading N style), or plain text. */
export function setOutlineLevel(c, level) {
  if (level) useStyle(c, 'paragraph', `Heading_20_${level}`);
  else useStyle(c, 'paragraph', 'Standard');
}
