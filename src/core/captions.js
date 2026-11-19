/**
 * Captions and cross-references.
 *
 * A caption is a paragraph (style Figure / Table / Equation…) holding a
 * text:sequence field: "Figure <seq>1</seq>: A chart". Sequences are numbered
 * in document order per name (Figure, Table…), declared in the body prelude
 * (text:sequence-decls).
 *
 * Cross-references are fields pointing at a target:
 *   text:bookmark-ref  → a bookmark (headings get a __RefHeading__ bookmark pair)
 *   text:sequence-ref  → a caption's sequence (by its text:ref-name)
 *   text:note-ref      → a footnote or endnote (by its text:id)
 * with text:reference-format: text | page | direction | number | category-and-value | caption | value | chapter.
 */
import { Plugin, PluginKey } from 'prosemirror-state';
import { formatNumber } from './commands/lists.js';

export const sequenceKey = new PluginKey('sequenceNumbering');
export const REF_ELEMENTS = new Set(['text:bookmark-ref', 'text:sequence-ref', 'text:note-ref', 'text:reference-ref']);

const isSeq = (n) => n.type.name === 'field' && n.attrs.element === 'text:sequence';

/** Every sequence field: [{ node, pos, name, refName, para, paraPos, value }] (value = shown number). */
export function sequencesOf(doc) {
  const out = [];
  doc.descendants((n, pos) => {
    if (n.type.name === 'index') return false;
    if (n.isTextblock) {
      n.forEach((c, off) => {
        if (isSeq(c)) out.push({ node: c, pos: pos + 1 + off, name: c.attrs.fieldAttrs['text:name'] || '', refName: c.attrs.fieldAttrs['text:ref-name'] || '', para: n, paraPos: pos, value: c.attrs.text });
      });
      return false;
    }
    return true;
  });
  return out;
}

/** The numbers sequences should show: Map(pos → text). Restarts are not modelled (ODF formulas are kept). */
export function sequenceNumbers(doc) {
  const count = new Map();
  const out = new Map();
  for (const s of sequencesOf(doc)) {
    const formula = s.node.attrs.fieldAttrs['text:formula'] || '';
    let n = (count.get(s.name) || 0) + 1;
    // A formula that sets a fixed value (e.g. "ooow:5") restarts from it.
    const fixed = /^(?:ooow:)?(\d+)$/.exec(formula);
    if (fixed) n = Number(fixed[1]);
    count.set(s.name, n);
    out.set(s.pos, formatNumber(n, s.node.attrs.fieldAttrs['style:num-format'] || '1'));
  }
  return out;
}

/** Keeps caption numbers in order as captions are added, moved or deleted. */
export function sequencePlugin() {
  return new Plugin({
    key: sequenceKey,
    appendTransaction(trs, _old, state) {
      if (!trs.some((tr) => tr.docChanged) || trs.some((tr) => tr.getMeta('load'))) return null;
      let tr = null;
      for (const [pos, text] of sequenceNumbers(state.doc)) {
        const n = state.doc.nodeAt(pos);
        if (n.attrs.text !== text) { tr = tr || state.tr; tr.setNodeMarkup(pos, null, { ...n.attrs, text }); }
      }
      return tr ? tr.setMeta('addToHistory', false) : null;
    },
  });
}

/** A ref-name not used by another sequence ("refFigure3"). */
export function uniqueRefName(doc, name) {
  const used = new Set(sequencesOf(doc).map((s) => s.refName));
  let i = 0;
  while (used.has(`ref${name}${i}`)) i++;
  return `ref${name}${i}`;
}

/** Caption text after the label and number ("Figure 1: A chart" → "A chart"). */
export function captionText(seq) {
  let after = false;
  let text = '';
  seq.para.forEach((c, off) => {
    if (seq.paraPos + 1 + off === seq.pos) { after = true; return; }
    if (after) text += c.isText ? c.text : c.type.name === 'field' ? c.attrs.text : c.type.name === 'tab' ? ' ' : '';
  });
  return text.replace(/^\s*[:.\-–—]\s*/, '').trim();
}

/** Label and number as shown ("Figure 1"). */
export function categoryAndValue(seq) {
  let text = '';
  let done = false;
  seq.para.forEach((c, off) => {
    if (done) return;
    if (seq.paraPos + 1 + off === seq.pos) { text += c.attrs.text; done = true; return; }
    text += c.isText ? c.text : '';
  });
  return text.trim();
}

/** The sequence names used in the document (and the declared ones). */
export function sequenceNames(state) {
  const names = new Set();
  const decls = (state.prelude || []).find((t) => t.n === 'text:sequence-decls');
  for (const d of decls?.c || []) if (d.a?.['text:name']) names.add(d.a['text:name']);
  return names;
}

/** Declares a sequence name in the prelude (returns true if it changed). */
export function declareSequence(state, name) {
  if (sequenceNames(state).has(name)) return false;
  const prelude = [...(state.prelude || [])];
  let i = prelude.findIndex((t) => t.n === 'text:sequence-decls');
  if (i < 0) { prelude.unshift({ n: 'text:sequence-decls', a: {}, c: [] }); i = 0; }
  prelude[i] = { ...prelude[i], c: [...(prelude[i].c || []), { n: 'text:sequence-decl', a: { 'text:display-outline-level': '0', 'text:name': name } }] };
  state.prelude = prelude;
  return true;
}

// ------------------------------------------------------------------ targets

/** Bookmarks: [{ name, pos, end }] (point bookmarks and start/end pairs). */
export function bookmarksOf(doc) {
  const out = [];
  const open = new Map();
  doc.descendants((n, pos) => {
    if (n.type.name !== 'bookmark') return true;
    const el = n.attrs.element;
    if (el === 'text:bookmark') out.push({ name: n.attrs.name, pos, end: pos });
    else if (el === 'text:bookmark-start') open.set(n.attrs.name, pos);
    else if (el === 'text:bookmark-end' && open.has(n.attrs.name)) { out.push({ name: n.attrs.name, pos: open.get(n.attrs.name), end: pos }); open.delete(n.attrs.name); }
    return false;
  });
  return out;
}

/** Headings with the bookmark that marks them for references (if any). */
export function headingsOf(doc) {
  const out = [];
  doc.descendants((n, pos) => {
    if (n.type.name === 'index') return false;
    if (n.type.name === 'heading') {
      let bookmark = null;
      n.forEach((c) => { if (!bookmark && c.type.name === 'bookmark' && c.attrs.element === 'text:bookmark-start' && /^__RefHeading__/.test(c.attrs.name)) bookmark = c.attrs.name; });
      const text = n.textContent.trim();
      if (text) out.push({ pos, node: n, text, level: n.attrs.level, bookmark });
      return false;
    }
    return !n.isTextblock;
  });
  return out;
}

/** Where a reference field points: { pos, text, number, seq? } or null. */
export function resolveRef(doc, attrs) {
  const a = attrs.fieldAttrs || {};
  const name = a['text:ref-name'];
  switch (attrs.element) {
    case 'text:sequence-ref': {
      const s = sequencesOf(doc).find((x) => x.refName === name);
      return s ? { pos: s.pos, seq: s, text: captionText(s), number: s.node.attrs.text } : null;
    }
    case 'text:note-ref': {
      let found = null;
      doc.descendants((n, pos) => { if (found) return false; if (n.type.name === 'note' && n.attrs.extra?.['text:id'] === name) found = { pos, text: n.attrs.citation, number: n.attrs.citation }; return true; });
      return found;
    }
    case 'text:bookmark-ref': case 'text:reference-ref': {
      const b = bookmarksOf(doc).find((x) => x.name === name);
      if (!b) return null;
      const $p = doc.resolve(b.pos);
      const block = $p.parent;
      const text = b.end > b.pos ? doc.textBetween(b.pos, b.end, ' ', (n) => (n.type.name === 'field' ? n.attrs.text : '')).trim() : block.textContent.trim();
      return { pos: b.pos, text, number: block.type.name === 'heading' ? String(block.attrs.level) : text };
    }
    default: return null;
  }
}

/**
 * The text a reference shows. pageOf(pos) → page number string; at = the
 * reference's own position (for above / below).
 */
export function refText(doc, attrs, pageOf, at) {
  const r = resolveRef(doc, attrs);
  if (!r) return attrs.text || 'Error: Reference source not found';
  const fmt = attrs.fieldAttrs?.['text:reference-format'] || 'text';
  switch (fmt) {
    case 'page': return pageOf?.(r.pos) || attrs.text;
    case 'direction': return r.pos < at ? 'above' : 'below';
    case 'number': case 'number-no-superior': case 'number-all-superior': return r.number;
    case 'chapter': return r.number;
    case 'category-and-value': return r.seq ? categoryAndValue(r.seq) : r.text;
    case 'caption': return r.seq ? captionText(r.seq) : r.text;
    case 'value': return r.seq ? r.seq.node.attrs.text : r.number;
    default: return r.seq ? `${categoryAndValue(r.seq)}${captionText(r.seq) ? `: ${captionText(r.seq)}` : ''}` : r.text;
  }
}

/** All reference fields: [{ node, pos }]. */
export function refFieldsOf(doc) {
  const out = [];
  doc.descendants((n, pos) => { if (n.type.name === 'field' && REF_ELEMENTS.has(n.attrs.element)) out.push({ node: n, pos }); return true; });
  return out;
}
