/**
 * References ▸ Captions: Insert Caption, Insert Table of Figures, Update
 * Table, Cross-reference, and F9 (update fields).
 */
import { TextSelection, NodeSelection } from 'prosemirror-state';
import { Fragment } from 'prosemirror-model';
import { schema } from '../../core/schema.js';
import { editState } from '../../core/state-step.js';
import { ensureStyles } from '../../core/style-edit.js';
import { findIndexes, uniqueIndexName } from '../../core/indexes.js';
import {
  sequencesOf, uniqueRefName, declareSequence, sequenceNames, refFieldsOf, refText, headingsOf, bookmarksOf, captionText, categoryAndValue,
} from '../../core/captions.js';
import { notesOf } from '../../core/notes.js';
import { insertBlockAtCaret, pageOf, whenLaidOut, updateAllTocs } from './toc.js';
import { refreshCitations } from './citations.js';
import { t } from '../../i18n/index.js';

export const BUILT_IN_LABELS = ['Equation', 'Figure', 'Table'];
const CAPTION_STYLES = ['Caption', 'Figure', 'Table', 'Equation', 'Illustration_20_Index_20_Heading', 'Illustration_20_Index_20_1', 'Index', 'Index_20_Link'];

/** Labels offered: built-in plus any used / declared in the document. */
export function captionLabels(c) {
  const names = new Set(BUILT_IN_LABELS);
  for (const n of sequenceNames(c.session.state)) if (!['Illustration', 'Text', 'Drawing'].includes(n)) names.add(n);
  for (const s of sequencesOf(c.mainEditor.view.state.doc)) names.add(s.name);
  return [...names].sort();
}

/** What a caption would attach to: { kind: 'figure' | 'table' | 'text', before, after } positions in the body. */
function captionAnchor(view) {
  const sel = view.state.selection;
  const $f = sel.$from;
  for (let d = $f.depth; d > 0; d--) {
    if ($f.node(d).type.name === 'table') return { kind: 'table', before: $f.before(d), after: $f.after(d) };
  }
  const isFrame = sel instanceof NodeSelection && sel.node.type.name === 'frame';
  if ($f.depth >= 1 && $f.parent.isTextblock) return { kind: isFrame ? 'figure' : 'text', before: $f.before($f.depth), after: $f.after($f.depth) };
  if (isFrame && $f.depth >= 1) return { kind: 'figure', before: $f.before($f.depth), after: $f.after($f.depth) };
  return { kind: 'text', before: sel.from, after: sel.to };
}

/** The default label for what's selected (Word suggests Table in tables). */
export const suggestedLabel = (c) => (captionAnchor(c.mainEditor.view).kind === 'table' ? 'Table' : 'Figure');

/**
 * Inserts a caption. o = { label, text, position: 'above'|'below', excludeLabel, numFormat }
 */
export function insertCaption(c, o) {
  const view = c.mainEditor.view;
  const label = o.label || 'Figure';
  const style = BUILT_IN_LABELS.includes(label) ? label : 'Caption';
  const anchor = captionAnchor(view);
  const refName = uniqueRefName(view.state.doc, label);
  const seq = schema.nodes.field.create({
    element: 'text:sequence',
    fieldAttrs: { 'text:ref-name': refName, 'text:name': label, 'text:formula': `ooow:${label}+1`, 'style:num-format': o.numFormat || '1' },
    text: '1',
  });
  const content = [];
  if (!o.excludeLabel) content.push(schema.text(`${label} `));
  content.push(seq);
  if (o.text) content.push(schema.text(`${o.excludeLabel ? ' ' : ': '}${o.text}`));
  const para = schema.nodes.paragraph.create({ styleName: style }, content);
  editState(view, c.session.state, ['commonStyles', 'prelude'], (st) => {
    const a = ensureStyles(st, 'paragraph', CAPTION_STYLES);
    const b = ensureStyles(st, 'text', ['Index_20_Link']);
    const d = declareSequence(st, label);
    return a || b || d;
  }, (tr) => {
    const at = o.position === 'above' ? anchor.before : anchor.after;
    tr.insert(at, para);
    tr.setSelection(TextSelection.create(tr.doc, at + para.nodeSize - 1)).scrollIntoView();
  });
  view.focus();
  return refName;
}

// ------------------------------------------------------------------ table of figures

export const TOF_DEFAULTS = { label: 'Figure', includeLabel: true, pageNumbers: true, rightAlign: true, leader: '.', links: true };

const tofElement = (label) => (label === 'Table' ? 'text:table-index' : 'text:illustration-index');

function tofSource(o) {
  const el = tofElement(o.label);
  const parts = [];
  if (o.links) parts.push({ n: 'text:index-entry-link-start', a: { 'text:style-name': 'Index_20_Link' } });
  parts.push({ n: 'text:index-entry-text', a: {} });
  if (o.pageNumbers) {
    parts.push(o.rightAlign ? { n: 'text:index-entry-tab-stop', a: { 'style:type': 'right', ...(o.leader ? { 'style:leader-char': o.leader } : {}) } } : { n: 'text:index-entry-span', a: {}, c: [' '] });
    parts.push({ n: 'text:index-entry-page-number', a: {} });
  }
  if (o.links) parts.push({ n: 'text:index-entry-link-end', a: {} });
  return {
    n: `${el}-source`, a: { 'text:caption-sequence-name': o.label, 'text:caption-sequence-format': o.includeLabel ? 'text' : 'caption' },
    c: [
      { n: 'text:index-title-template', a: { 'text:style-name': 'Illustration_20_Index_20_Heading' } },
      { n: `${el}-entry-template`, a: { 'text:style-name': 'Illustration_20_Index_20_1' }, c: parts },
    ],
  };
}

/** Options read back from a table of figures' source. */
export function tofOptions(source) {
  const o = { ...TOF_DEFAULTS };
  if (!source) return o;
  o.label = source.a?.['text:caption-sequence-name'] || 'Figure';
  o.includeLabel = source.a?.['text:caption-sequence-format'] !== 'caption';
  const tpl = (source.c || []).find((x) => /-entry-template$/.test(x.n));
  const parts = tpl?.c || [];
  o.links = parts.some((p) => p.n === 'text:index-entry-link-start');
  o.pageNumbers = parts.some((p) => p.n === 'text:index-entry-page-number');
  const tab = parts.find((p) => p.n === 'text:index-entry-tab-stop');
  o.rightAlign = !!tab;
  o.leader = tab ? (tab.a['style:leader-char'] ?? '') : '.';
  return o;
}

function tofBody(doc, o, page) {
  const blocks = [];
  for (const s of sequencesOf(doc).filter((x) => x.name === o.label)) {
    const text = o.includeLabel ? `${categoryAndValue(s)}${captionText(s) ? `: ${captionText(s)}` : ''}` : captionText(s) || categoryAndValue(s);
    const marks = o.links ? [schema.marks.link.create({ href: `#${s.name}!${s.node.attrs.text}|sequence`, extra: { 'text:style-name': 'Index_20_Link', 'text:visited-style-name': 'Index_20_Link' } })] : [];
    const content = [schema.text(text || ' ', marks)];
    if (o.pageNumbers) {
      if (o.rightAlign) content.push(schema.nodes.tab.create());
      else content.push(schema.text(' ', marks));
      content.push(schema.text(page(s.pos) || ' ', marks));
    }
    blocks.push(schema.nodes.paragraph.create({ styleName: 'Illustration_20_Index_20_1' }, content));
  }
  if (!blocks.length) blocks.push(schema.nodes.paragraph.create({ styleName: 'Illustration_20_Index_20_1' }, schema.text(t('ref.noFigures'))));
  return Fragment.from(blocks);
}

const isTof = (n) => n.attrs.element === 'text:illustration-index' || n.attrs.element === 'text:table-index';

export function insertTableOfFigures(c, options) {
  const o = { ...TOF_DEFAULTS, ...options };
  const view = c.mainEditor.view;
  editState(view, c.session.state, ['commonStyles'], (st) => { const a = ensureStyles(st, 'paragraph', CAPTION_STYLES); const b = ensureStyles(st, 'text', ['Index_20_Link']); return a || b; });
  const base = o.label === 'Table' ? 'Table index' : 'Illustration Index';
  const node = schema.nodes.index.create({ element: tofElement(o.label), attrs: { 'text:protected': 'true', 'text:name': uniqueIndexName(view.state.doc, base) }, source: tofSource(o), titleCount: 0, titleAttrs: null }, tofBody(view.state.doc, o, pageOf(c)));
  insertBlockAtCaret(c, node);
  whenLaidOut(c, () => updateTablesOfFigures(c, { history: false }));
}

/** Rebuilds every table of figures (entries and page numbers). */
export function updateTablesOfFigures(c, { history = true } = {}) {
  const view = c.mainEditor.view;
  const tr = view.state.tr;
  for (const { node, pos } of findIndexes(view.state.doc).filter((x) => isTof(x.node)).reverse()) {
    const o = tofOptions(node.attrs.source);
    const head = [];
    for (let i = 0; i < node.attrs.titleCount && i < node.childCount; i++) head.push(node.child(i));
    const content = Fragment.from(head).append(tofBody(view.state.doc, o, pageOf(c)));
    if (!content.eq(node.content)) tr.replaceWith(pos, pos + node.nodeSize, node.type.create(node.attrs, content));
  }
  if (!tr.docChanged) return;
  if (!history) tr.setMeta('addToHistory', false);
  view.dispatch(tr);
}

export const hasTof = (c) => !!c.mainEditor && findIndexes(c.mainEditor.view.state.doc).some((x) => isTof(x.node));

// ------------------------------------------------------------------ cross-references

/** Items a cross-reference can point at, for a type: [{ id, label }]. */
export function refItems(c, type) {
  const doc = c.mainEditor.view.state.doc;
  if (type === 'heading') return headingsOf(doc).map((h) => ({ id: String(h.pos), label: `${' '.repeat(h.level - 1)}${h.text}` }));
  if (type === 'bookmark') return bookmarksOf(doc).filter((b) => !/^__RefHeading__/.test(b.name) && !b.name.startsWith('_')).map((b) => ({ id: b.name, label: b.name }));
  if (type === 'footnote' || type === 'endnote') return notesOf(doc, type).map(({ node }) => ({ id: node.attrs.extra?.['text:id'] || '', label: `${node.attrs.citation}  ${(node.attrs.body || []).map((b) => (b.content || []).map((x) => x.text || '').join('')).join(' ').slice(0, 60)}` })).filter((x) => x.id);
  return sequencesOf(doc).filter((s) => s.name === type).map((s) => ({ id: s.refName, label: `${categoryAndValue(s)}${captionText(s) ? `: ${captionText(s)}` : ''}` }));
}

/** Formats offered per type: [[ODF reference-format, i18n key]]. */
export function refFormats(type) {
  if (type === 'heading') return [['text', 'ref.fmt.headingText'], ['page', 'ref.fmt.page'], ['chapter', 'ref.fmt.headingNumber'], ['direction', 'ref.fmt.direction']];
  if (type === 'bookmark') return [['text', 'ref.fmt.bookmarkText'], ['page', 'ref.fmt.page'], ['direction', 'ref.fmt.direction']];
  if (type === 'footnote' || type === 'endnote') return [['text', type === 'footnote' ? 'ref.fmt.footnoteNumber' : 'ref.fmt.endnoteNumber'], ['page', 'ref.fmt.page'], ['direction', 'ref.fmt.direction']];
  return [['text', 'ref.fmt.entireCaption'], ['category-and-value', 'ref.fmt.labelNumber'], ['caption', 'ref.fmt.captionOnly'], ['page', 'ref.fmt.page'], ['direction', 'ref.fmt.direction']];
}

/** Gives a heading the __RefHeading__ bookmark pair a reference needs (in tr); returns its name. */
function headingBookmark(tr, pos) {
  const node = tr.doc.nodeAt(pos);
  let name = null;
  node.forEach((ch) => { if (!name && ch.type.name === 'bookmark' && ch.attrs.element === 'text:bookmark-start' && /^__RefHeading__/.test(ch.attrs.name)) name = ch.attrs.name; });
  if (name) return name;
  const used = new Set(bookmarksOf(tr.doc).map((b) => b.name));
  let n = 1000 + Math.floor(Math.random() * 8000);
  while (used.has(`__RefHeading___Toc${n}_${n * 7}`)) n++;
  name = `__RefHeading___Toc${n}_${n * 7}`;
  tr.insert(pos + 1 + node.content.size, schema.nodes.bookmark.create({ element: 'text:bookmark-end', name }));
  tr.insert(pos + 1, schema.nodes.bookmark.create({ element: 'text:bookmark-start', name }));
  return name;
}

/** Inserts a cross-reference: { type, id, format } at the caret. */
export function insertCrossReference(c, { type, id, format }) {
  const view = c.mainEditor.view;
  const tr = view.state.tr;
  let element;
  const fieldAttrs = { 'text:reference-format': format };
  if (type === 'heading') { element = 'text:bookmark-ref'; fieldAttrs['text:ref-name'] = headingBookmark(tr, Number(id)); }
  else if (type === 'bookmark') { element = 'text:bookmark-ref'; fieldAttrs['text:ref-name'] = id; }
  else if (type === 'footnote' || type === 'endnote') { element = 'text:note-ref'; fieldAttrs['text:note-class'] = type; fieldAttrs['text:ref-name'] = id; }
  else { element = 'text:sequence-ref'; fieldAttrs['text:ref-name'] = id; }
  // Reference fields carry their text:note-class / ref-name / format in ODF order.
  const ordered = element === 'text:note-ref' ? { 'text:note-class': fieldAttrs['text:note-class'], 'text:reference-format': format, 'text:ref-name': fieldAttrs['text:ref-name'] } : { 'text:reference-format': format, 'text:ref-name': fieldAttrs['text:ref-name'] };
  const at = tr.mapping.map(view.state.selection.from);
  const to = tr.mapping.map(view.state.selection.to);
  const probe = { element, fieldAttrs: ordered, text: '' };
  const text = refText(tr.doc, probe, pageOf(c), at);
  tr.replaceWith(at, to, schema.nodes.field.create({ ...probe, text }));
  tr.setSelection(TextSelection.create(tr.doc, at + 1));
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

/** F9: updates cross-references, tables of contents and figures, and citations. */
export function updateFields(c) {
  const view = c.mainEditor.view;
  const tr = view.state.tr;
  const page = pageOf(c);
  for (const { node, pos } of refFieldsOf(view.state.doc)) {
    const text = refText(view.state.doc, node.attrs, page, pos);
    if (text !== node.attrs.text) tr.setNodeMarkup(pos, null, { ...node.attrs, text });
  }
  if (tr.docChanged) view.dispatch(tr);
  updateTablesOfFigures(c);
  if (findIndexes(view.state.doc, 'text:table-of-content').length) updateAllTocs(c, { pagesOnly: true });
  refreshCitations(c);
}

export { captionAnchor };
