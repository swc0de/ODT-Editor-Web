/**
 * References ▸ Index: Mark Entry (Alt+Shift+X), Insert Index (in a section
 * with columns, like Word's two-column index) and Update Index.
 */
import { schema } from '../../core/schema.js';
import { editState } from '../../core/state-step.js';
import { ensureStyles } from '../../core/style-edit.js';
import { setSectionStyle } from '../../core/page-setup.js';
import { findIndexes, uniqueIndexName } from '../../core/indexes.js';
import { INDEX_DEFAULTS, indexSource, indexOptions, indexBody, indexMark, indexEntries } from '../../core/alpha-index.js';
import { insertBlockAtCaret, pageOf, whenLaidOut } from './toc.js';
import { t } from '../../i18n/index.js';

const INDEX_STYLES = ['Index', 'Index_20_Heading', 'Index_20_1', 'Index_20_2', 'Index_20_3', 'Index_20_Separator'];
const ELEMENT = 'text:alphabetical-index';

/** The selected text, as Mark Entry's default main entry. */
export function selectedText(c) {
  const { from, to } = c.mainEditor.view.state.selection;
  return c.mainEditor.view.state.doc.textBetween(from, to, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

/**
 * Marks an entry: at the end of the selection, or (all) after the first
 * occurrence of the text in every paragraph. Returns the number of marks.
 */
export function markEntry(c, { main, sub = '', all = false }) {
  const view = c.mainEditor.view;
  if (!main) return 0;
  const tr = view.state.tr;
  let count = 0;
  if (!all) {
    tr.insert(view.state.selection.to, indexMark(main, sub));
    count = 1;
  } else {
    const spots = [];
    const needle = (sub || main).toLowerCase();
    view.state.doc.descendants((n, pos) => {
      if (n.type.name === 'index') return false;
      if (!n.isTextblock) return true;
      const text = n.textBetween(0, n.content.size, '￼', '￼').toLowerCase();
      const i = text.indexOf(needle);
      if (i >= 0) spots.push(pos + 1 + i + needle.length);
      return false;
    });
    for (const at of spots.reverse()) { tr.insert(at, indexMark(main, sub)); count++; }
  }
  if (count) view.dispatch(tr.scrollIntoView());
  view.focus();
  return count;
}

export function insertIndex(c, options) {
  const o = { ...INDEX_DEFAULTS, ...options };
  const view = c.mainEditor.view;
  let sectionStyle = null;
  editState(view, c.session.state, ['commonStyles', 'contentAutoStyles'], (st) => {
    ensureStyles(st, 'paragraph', INDEX_STYLES);
    if (o.columns > 1) sectionStyle = setSectionStyle(st, null, { count: o.columns });
    return true;
  });
  const doc = view.state.doc;
  const name = uniqueIndexName(doc, 'Alphabetical Index');
  const index = schema.nodes.index.create({ element: ELEMENT, attrs: { 'text:protected': 'true', 'text:name': name }, source: indexSource(o), titleCount: 0, titleAttrs: null }, indexBody(doc, o, pageOf(c), t('ref.noIndexEntries')));
  const block = sectionStyle ? schema.nodes.section.create({ name: uniqueIndexName(doc, 'Index Section'), styleName: sectionStyle }, index) : index;
  insertBlockAtCaret(c, block);
  whenLaidOut(c, () => updateIndexes(c, { history: false }));
}

/** Rebuilds every alphabetical index (entries and page numbers). */
export function updateIndexes(c, { history = true } = {}) {
  const view = c.mainEditor.view;
  const tr = view.state.tr;
  for (const { node, pos } of findIndexes(view.state.doc, ELEMENT).reverse()) {
    const o = indexOptions(node.attrs.source);
    const head = [];
    for (let i = 0; i < node.attrs.titleCount && i < node.childCount; i++) head.push(node.child(i));
    const next = node.type.create(node.attrs, [...head, ...indexBody(view.state.doc, o, pageOf(c), t('ref.noIndexEntries'))]);
    if (!next.eq(node)) tr.replaceWith(pos, pos + node.nodeSize, next);
  }
  if (!tr.docChanged) return;
  if (!history) tr.setMeta('addToHistory', false);
  view.dispatch(tr);
}

/** Update Index: entries now, then page numbers once the pages settle. */
export function updateIndexCommand(c) {
  updateIndexes(c);
  whenLaidOut(c, () => updateIndexes(c, { history: false }));
}

export const hasIndex = (c) => !!c.mainEditor && findIndexes(c.mainEditor.view.state.doc, ELEMENT).length > 0;
export const entryCount = (c) => indexEntries(c.mainEditor.view.state.doc).length;
