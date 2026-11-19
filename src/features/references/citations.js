/**
 * References ▸ Citations & Bibliography. Citations are text:bibliography-mark
 * fields; their text and every bibliography's entries are produced by
 * citeproc-js with the chosen CSL style (APA, MLA, Chicago author-date,
 * IEEE, Harvard). The engine is a lazily loaded chunk.
 */
import { DOMParser as PMDOMParser, Fragment } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';
import { schema } from '../../core/schema.js';
import { editState } from '../../core/state-step.js';
import { ensureStyles } from '../../core/style-edit.js';
import { loadChunk } from '../../core/chunk-loader.js';
import { markAttrs, itemFromMark, withUniqueIds } from '../../core/bibliography.js';
import { findIndexes, uniqueIndexName } from '../../core/indexes.js';
import { insertBlockAtCaret } from './toc.js';
import { t } from '../../i18n/index.js';

export const BIB_STYLES = ['Bibliography_20_Heading', 'Bibliography_20_1', 'Index'];
const MARK = 'text:bibliography-mark';
const ODF_TYPES = ['article', 'book', 'booklet', 'conference', 'custom1', 'custom2', 'custom3', 'custom4', 'custom5', 'email', 'inbook', 'incollection', 'inproceedings', 'journal', 'manual', 'mastersthesis', 'misc', 'phdthesis', 'proceedings', 'techreport', 'unpublished', 'www'];

/** The document's sources and style. */
export const bibState = (st) => ({ style: st?.bibliography?.style || 'apa', sources: st?.bibliography?.sources || [] });

/** Changes state.bibliography undoably. */
export function setBibliography(c, change, withTr = null) {
  editState(c.mainEditor.view, c.session.state, ['bibliography'], (st) => { st.bibliography = { ...bibState(st), ...change }; return true; }, withTr);
}

/** Citations in the body in order: [{ node, pos }]. */
export function citationsOf(doc) {
  const out = [];
  doc.descendants((n, pos) => { if (n.type.name === 'field' && n.attrs.element === MARK) out.push({ node: n, pos }); return true; });
  return out;
}

/** Sources of the document plus any only known from a citation (e.g. a LibreOffice file). */
export function allSources(c) {
  const { sources } = bibState(c.session.state);
  const ids = new Set(sources.map((s) => s.id));
  const extra = [];
  for (const { node } of citationsOf(c.mainEditor.view.state.doc)) {
    const id = node.attrs.fieldAttrs['text:identifier'];
    if (id && !ids.has(id)) { ids.add(id); extra.push(itemFromMark(node.attrs.fieldAttrs)); }
  }
  return [...sources, ...extra];
}

// ------------------------------------------------------------------ engine

let engineChunk = null;
const chunk = () => (engineChunk ??= loadChunk('odt-citeproc', 'The citation engine is not included in this build.'));

/**
 * Formats citations (one per id in cites, in order) and the bibliography of
 * the cited sources. → { cites: [text], entries: [html], hanging }
 */
export async function formatWith(style, items, cites) {
  const { CSL, STYLES, LOCALES } = await chunk();
  const byId = new Map(items.map((it) => [it.id, it]));
  const sys = { retrieveLocale: (lang) => LOCALES[lang] || LOCALES['en-US'], retrieveItem: (id) => byId.get(id) };
  const engine = new CSL.Engine(sys, STYLES[style] || STYLES.apa, 'en-GB', true);
  engine.setOutputFormat('html');
  const real = [...new Set(cites.filter((id) => byId.has(id) && !byId.get(id).placeholder))];
  engine.updateItems(real);
  const out = cites.map((id) => {
    const it = byId.get(id);
    if (!it || it.placeholder) return `(${id})`;
    return htmlToText(engine.makeCitationCluster([{ id }]));
  });
  let entries = [];
  let hanging = false;
  if (real.length) {
    const [params, list] = engine.makeBibliography() || [{}, []];
    entries = list;
    hanging = !!params.hangingindent;
  }
  return { cites: out, entries, hanging };
}

const decoder = typeof document !== 'undefined' ? document.createElement('textarea') : null;
function htmlToText(html) {
  const s = String(html).replace(/<[^>]+>/g, '');
  if (!decoder) return s;
  decoder.innerHTML = s;
  return decoder.value;
}

/** A bibliography entry (citeproc HTML) → paragraph content. */
function entryContent(html) {
  const fixed = String(html)
    .replace(/<div class="csl-left-margin">([\s\S]*?)<\/div>\s*<div class="csl-right-inline">([\s\S]*?)<\/div>/, '$1<span data-tab></span>$2')
    .replace(/<\/?div[^>]*>/g, '');
  const wrap = document.createElement('div');
  wrap.innerHTML = `<p>${fixed.trim()}</p>`;
  for (const tab of wrap.querySelectorAll('span[data-tab]')) tab.replaceWith('\t');
  const doc = PMDOMParser.fromSchema(schema).parse(wrap);
  const p = doc.firstChild;
  // Tabs from the left margin: real tab nodes.
  const parts = [];
  p.forEach((n) => {
    if (n.isText && n.text.includes('\t')) {
      n.text.split('\t').forEach((s, i) => { if (i) parts.push(schema.nodes.tab.create()); if (s) parts.push(schema.text(s, n.marks)); });
    } else parts.push(n);
  });
  return Fragment.from(parts);
}

// ------------------------------------------------------------------ bibliography index

/** The text:bibliography-source: entry templates LibreOffice uses when it regenerates the list. */
export function bibliographySource(title) {
  const field = (f) => ({ n: 'text:index-entry-bibliography', a: { 'text:bibliography-data-field': f } });
  const span = (s) => ({ n: 'text:index-entry-span', a: {}, c: [s] });
  return {
    n: 'text:bibliography-source', a: {},
    c: [
      { n: 'text:index-title-template', a: { 'text:style-name': 'Bibliography_20_Heading' }, ...(title ? { c: [title] } : {}) },
      ...ODF_TYPES.map((type) => ({ n: 'text:bibliography-entry-template', a: { 'text:bibliography-type': type, 'text:style-name': 'Bibliography_20_1' }, c: [field('author'), span(' ('), field('year'), span('). '), field('title'), span('.')] })),
    ],
  };
}

const TITLES = { bibliography: 'ref.bibliography', references: 'ref.references', worksCited: 'ref.worksCited' };

/** Inserts a bibliography (kind: bibliography | references | worksCited | null for none). */
export async function insertBibliography(c, kind = null) {
  const title = kind ? t(TITLES[kind] || 'ref.bibliography') : '';
  editState(c.mainEditor.view, c.session.state, ['commonStyles'], (st) => { const a = ensureStyles(st, 'paragraph', BIB_STYLES); return a; });
  const view = c.mainEditor.view;
  const name = uniqueIndexName(view.state.doc, 'Bibliography');
  const blocks = [];
  if (title) blocks.push(schema.nodes.paragraph.create({ styleName: 'Bibliography_20_Heading' }, schema.text(title)));
  blocks.push(schema.nodes.paragraph.create({ styleName: 'Bibliography_20_1' }, schema.text(t('ref.noSources'))));
  const node = schema.nodes.index.create({
    element: 'text:bibliography', attrs: { 'text:protected': 'true', 'text:name': name }, source: bibliographySource(title),
    titleCount: title ? 1 : 0, titleAttrs: title ? { 'text:name': `${name}_Head` } : null,
  }, blocks);
  insertBlockAtCaret(c, node);
  await refreshCitations(c);
}

// ------------------------------------------------------------------ refresh

let pending = null;

/**
 * Re-formats every citation and bibliography with the current style and
 * sources (after inserting a citation, editing a source or changing style).
 */
export function refreshCitations(c, { history = false } = {}) {
  const run = async () => {
    const view = c.mainEditor.view;
    const { style } = bibState(c.session.state);
    const items = allSources(c);
    const cites = citationsOf(view.state.doc).map(({ node }) => node.attrs.fieldAttrs['text:identifier']);
    const r = await formatWith(style, items, cites);
    // Positions are taken again now: the document may have changed meanwhile.
    const st = view.state;
    const marks = citationsOf(st.doc);
    const byId = new Map(items.map((it) => [it.id, it]));
    const tr = st.tr;
    marks.forEach(({ node, pos }, i) => {
      const id = node.attrs.fieldAttrs['text:identifier'];
      const text = cites[i] === id ? r.cites[i] : `(${id})`;
      const item = byId.get(id);
      const fieldAttrs = item && !item.placeholder ? markAttrs(item) : node.attrs.fieldAttrs;
      if (node.attrs.text !== text || JSON.stringify(node.attrs.fieldAttrs) !== JSON.stringify(fieldAttrs)) tr.setNodeMarkup(tr.mapping.map(pos), null, { ...node.attrs, text, fieldAttrs });
    });
    for (const { node, pos } of findIndexes(tr.doc, 'text:bibliography').reverse()) {
      const content = [];
      for (let i = 0; i < node.attrs.titleCount && i < node.childCount; i++) content.push(node.child(i));
      if (r.entries.length) for (const html of r.entries) content.push(schema.nodes.paragraph.create({ styleName: 'Bibliography_20_1' }, entryContent(html)));
      else content.push(schema.nodes.paragraph.create({ styleName: 'Bibliography_20_1' }, schema.text(t('ref.noSources'))));
      const next = node.type.create(node.attrs, content);
      if (!next.eq(node)) tr.replaceWith(pos, pos + node.nodeSize, next);
    }
    if (!tr.docChanged) return;
    if (!history) tr.setMeta('addToHistory', false);
    view.dispatch(tr);
  };
  pending = (pending || Promise.resolve()).then(run, run).catch((e) => { c.ui?.toast?.(String(e.message || e)); });
  return pending;
}

// ------------------------------------------------------------------ citations

/** Inserts a citation of a source at the caret. */
export async function insertCitation(c, id) {
  const view = c.mainEditor.view;
  const item = allSources(c).find((s) => s.id === id);
  if (!item) return;
  const attrs = item.placeholder ? { 'text:identifier': id, 'text:bibliography-type': 'misc' } : markAttrs(item);
  const node = schema.nodes.field.create({ element: MARK, fieldAttrs: attrs, text: `(${id})` });
  const { from, to } = view.state.selection;
  const tr = view.state.tr.replaceWith(from, to, node);
  tr.setSelection(TextSelection.create(tr.doc, from + 1));
  view.dispatch(tr.scrollIntoView());
  view.focus();
  await refreshCitations(c);
}

/** Adds (or replaces, same id) sources of the document. */
export function saveSources(c, items, { replaceId = null } = {}) {
  const { sources } = bibState(c.session.state);
  let list = [...sources];
  if (replaceId) list = list.map((s) => (s.id === replaceId ? items[0] : s));
  else {
    const used = new Set(list.map((s) => s.id));
    list.push(...withUniqueIds(items, used));
  }
  // A renamed tag renames its citations too.
  const renamed = replaceId && items[0].id !== replaceId ? [replaceId, items[0].id] : null;
  setBibliography(c, { sources: list }, renamed ? (tr) => {
    for (const { node, pos } of citationsOf(tr.doc)) {
      if (node.attrs.fieldAttrs['text:identifier'] === renamed[0]) tr.setNodeMarkup(pos, null, { ...node.attrs, fieldAttrs: { ...node.attrs.fieldAttrs, 'text:identifier': renamed[1] } });
    }
  } : null);
  return refreshCitations(c);
}

/** Removes a source (only when it isn't cited). */
export function deleteSource(c, id) {
  if (citationsOf(c.mainEditor.view.state.doc).some(({ node }) => node.attrs.fieldAttrs['text:identifier'] === id)) return false;
  setBibliography(c, { sources: bibState(c.session.state).sources.filter((s) => s.id !== id) });
  return true;
}

export function setCitationStyle(c, style) {
  setBibliography(c, { style });
  return refreshCitations(c);
}

/** The citation at the selection (a selected field), if any. */
export function selectedCitation(c) {
  const sel = c.mainEditor?.view.state.selection;
  const n = sel?.node;
  return n?.type.name === 'field' && n.attrs.element === MARK ? { node: n, pos: sel.from } : null;
}
