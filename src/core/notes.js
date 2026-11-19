/**
 * Footnotes and endnotes: numbering options (text:notes-configuration in
 * office:styles), automatic renumbering in document order, and new notes.
 * Notes are `note` nodes whose text is block JSON in `body`; the paginator
 * reserves room for footnotes at the bottom of their page and the notes
 * layer (layout/notes-layer.js) draws and edits them.
 */
import { Plugin, PluginKey } from 'prosemirror-state';
import { Fragment } from 'prosemirror-model';
import { schema } from './schema.js';
import { formatNumber } from './commands/lists.js';

export const notesNumberingKey = new PluginKey('notesNumbering');


/** Numbering configuration of a note class: { numFormat, startValue, position, restart, prefix, suffix }. */
export function notesConfig(state, cls = 'footnote') {
  const c = (state?.commonStyles?.c || []).find((t) => typeof t !== 'string' && t.n === 'text:notes-configuration' && t.a['text:note-class'] === cls);
  const a = c?.a || {};
  return {
    numFormat: a['style:num-format'] || (cls === 'footnote' ? '1' : 'i'),
    startValue: Number(a['text:start-value'] || 0),
    position: a['text:footnotes-position'] || 'page',
    restart: a['text:start-numbering-at'] || 'document',
    prefix: a['style:num-prefix'] || '',
    suffix: a['style:num-suffix'] || '',
  };
}

/** Writes a note class's configuration into state.commonStyles (returns the new tree list). */
export function setNotesConfig(state, cls, change) {
  const list = [...(state.commonStyles?.c || [])];
  let i = list.findIndex((t) => typeof t !== 'string' && t.n === 'text:notes-configuration' && t.a['text:note-class'] === cls);
  if (i < 0) { list.push({ n: 'text:notes-configuration', a: { 'text:note-class': cls, 'text:citation-style-name': cls === 'footnote' ? 'Footnote_20_anchor' : 'Endnote_20_anchor' } }); i = list.length - 1; }
  const a = { ...list[i].a };
  for (const [k, v] of Object.entries(change)) { if (v == null) delete a[k]; else a[k] = v; }
  list[i] = { ...list[i], a };
  state.commonStyles = { ...state.commonStyles, c: list };
}

/** The citation text for the n-th note (0-based) under a configuration. */
export function citationFor(cfg, n) {
  return `${cfg.prefix}${formatNumber(n + 1 + (cfg.startValue || 0), cfg.numFormat || '1')}${cfg.suffix}`;
}

/** Notes of the document in order: [{ node, pos }] (optionally one class). */
export function notesOf(doc, cls = null) {
  const out = [];
  doc.descendants((n, pos) => { if (n.type.name === 'note' && (!cls || n.attrs.noteClass === cls)) out.push({ node: n, pos }); return true; });
  return out;
}

/**
 * The citation changes needed to number every note in document order: a
 * transaction (or null). Notes with a custom mark (text:label) keep it and
 * don't take a number. Numbering restarts at each Heading 1 ("chapter") or
 * on each page ("page", with pageOf(pos) from the layout).
 */
export function numberNotes(state, st, pageOf = null) {
  const cfg = { footnote: notesConfig(st, 'footnote'), endnote: notesConfig(st, 'endnote') };
  const count = { footnote: 0, endnote: 0 };
  let page = -1;
  let tr = null;
  state.doc.descendants((n, pos) => {
    if (n.type.name === 'heading' && n.attrs.level === 1 && cfg.footnote.restart === 'chapter') count.footnote = 0;
    if (n.type.name !== 'note') return true;
    const cls = n.attrs.noteClass === 'endnote' ? 'endnote' : 'footnote';
    if (cls === 'footnote' && cfg.footnote.restart === 'page' && pageOf) {
      const pg = pageOf(pos);
      if (pg !== page) { page = pg; count.footnote = 0; }
    }
    if (n.attrs.label != null && n.attrs.label !== '') return false;
    const want = citationFor(cfg[cls], count[cls]++);
    if (n.attrs.citation !== want) { tr = tr || state.tr; tr.setNodeMarkup(pos, null, { ...n.attrs, citation: want }); }
    return false;
  });
  return tr;
}

/** Keeps note citations numbered as the document changes. */
export function notesNumberingPlugin(getState, getPageOf = () => null) {
  return new Plugin({
    key: notesNumberingKey,
    appendTransaction(trs, _old, state) {
      if (!trs.some((tr) => tr.docChanged) || trs.some((tr) => tr.getMeta('load'))) return null;
      const st = getState();
      if (!st) return null;
      const tr = numberNotes(state, st, getPageOf());
      return tr ? tr.setMeta('addToHistory', false) : null;
    },
  });
}

/** A new, empty note of a class with an unused text:id. */
export function newNote(doc, cls, label = null) {
  const used = new Set(notesOf(doc).map((x) => x.node.attrs.extra?.['text:id']).filter(Boolean));
  const prefix = cls === 'endnote' ? 'edn' : 'ftn';
  let i = 1;
  while (used.has(`${prefix}${i}`)) i++;
  const body = Fragment.fromArray([schema.nodes.paragraph.create({ styleName: cls === 'endnote' ? 'Endnote' : 'Footnote' })]).toJSON();
  return schema.nodes.note.create({ noteClass: cls, citation: '', label: label || null, body, extra: { 'text:id': `${prefix}${i}` } });
}
