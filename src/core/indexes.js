/**
 * Generated indexes: tables of contents (and, via the same machinery, tables
 * of figures, alphabetical indexes and bibliographies). An index node keeps
 * its ODF *-source element (the templates LibreOffice uses to regenerate it)
 * and its body; this module writes those templates and rebuilds the body from
 * the document, with page numbers from the layout.
 */
import { schema } from './schema.js';

const T = (text, marks) => ({ type: 'text', text, ...(marks?.length ? { marks } : {}) });
const P = (styleName, content = [], auto = null) => ({ type: 'paragraph', attrs: { styleName, auto, extra: null }, ...(content.length ? { content } : {}) });

// ---------------------------------------------------------------- TOC options

/**
 * Options of a table of contents:
 *   { title, levels (1–9), pageNumbers, rightAlign, leader ('.' | '-' | '_' | ''), links }
 */
export const TOC_DEFAULTS = { title: 'Contents', levels: 3, pageNumbers: true, rightAlign: true, leader: '.', links: true };

/** The text:table-of-content-source element for options. */
export function tocSource(o) {
  const c = [{ n: 'text:index-title-template', a: { 'text:style-name': 'Contents_20_Heading' }, c: o.title ? [o.title] : [] }];
  for (let lv = 1; lv <= 10; lv++) {
    const parts = [];
    if (o.links) parts.push({ n: 'text:index-entry-link-start', a: { 'text:style-name': 'Index_20_Link' } });
    parts.push({ n: 'text:index-entry-chapter', a: {} }, { n: 'text:index-entry-text', a: {} });
    if (o.pageNumbers) {
      if (o.rightAlign) parts.push({ n: 'text:index-entry-tab-stop', a: { 'style:type': 'right', ...(o.leader ? { 'style:leader-char': o.leader } : {}) } });
      else parts.push({ n: 'text:index-entry-span', a: {}, c: [' '] });
      parts.push({ n: 'text:index-entry-page-number', a: {} });
    }
    if (o.links) parts.push({ n: 'text:index-entry-link-end', a: {} });
    c.push({ n: 'text:table-of-content-entry-template', a: { 'text:outline-level': String(lv), 'text:style-name': `Contents_20_${Math.min(lv, 9)}` }, c: parts });
  }
  return { n: 'text:table-of-content-source', a: { 'text:outline-level': String(o.levels), 'text:use-index-marks': 'false' }, c };
}

/** Options read back from a TOC's source (also LibreOffice's). */
export function tocOptions(source) {
  const o = { ...TOC_DEFAULTS };
  if (!source) return o;
  o.levels = Math.max(1, Math.min(10, Number(source.a?.['text:outline-level']) || 3));
  const title = (source.c || []).find((x) => x.n === 'text:index-title-template');
  o.title = title ? (title.c || []).filter((x) => typeof x === 'string').join('') : '';
  const first = (source.c || []).find((x) => x.n === 'text:table-of-content-entry-template');
  const parts = first?.c || [];
  o.links = parts.some((p) => p.n === 'text:index-entry-link-start');
  o.pageNumbers = parts.some((p) => p.n === 'text:index-entry-page-number');
  const tab = parts.find((p) => p.n === 'text:index-entry-tab-stop');
  o.rightAlign = !!tab;
  o.leader = tab ? (tab.a['style:leader-char'] ?? '') : '.';
  return o;
}

// ---------------------------------------------------------------- headings

/** Headings for a TOC: [{ level, text, pos }] in document order (outside indexes). */
export function collectHeadings(doc, maxLevel) {
  const out = [];
  doc.descendants((n, pos) => {
    if (n.type.name === 'index') return false;
    if (n.type.name === 'heading') {
      const text = n.textContent.replace(/\s+/g, ' ').trim();
      if (text && n.attrs.level <= maxLevel) out.push({ level: n.attrs.level, text, pos });
      return false;
    }
    return !n.isTextblock;
  });
  return out;
}

/** The link target LibreOffice uses for a heading: "#Heading text|outline". */
export const headingHref = (text) => `#${text}|outline`;

/**
 * The body of a TOC as block JSON. pageOf(pos) → page number string (or '').
 * With right-aligned numbers the entry styles' right tab (with its leader)
 * lines them up; a different leader is given on the paragraph itself.
 */
export function tocBody(doc, o, pageOf) {
  const blocks = [];
  if (o.title) blocks.push(P('Contents_20_Heading', [T(o.title)]));
  const linkMark = (text) => (o.links ? [{ type: 'link', attrs: { href: headingHref(text), extra: { 'text:style-name': 'Index_20_Link', 'text:visited-style-name': 'Index_20_Link' } } }] : []);
  const entries = collectHeadings(doc, o.levels);
  for (const h of entries) {
    const marks = linkMark(h.text);
    const content = [T(h.text, marks)];
    if (o.pageNumbers) {
      if (o.rightAlign) content.push({ type: 'tab' }); // ODF keeps no marks on tabs
      else content.push(T(' ', marks));
      content.push(T(String(pageOf(h.pos) || ''), marks));
    }
    // A leader other than the style's dots: the paragraph's own tab stop.
    let auto = null;
    if (o.pageNumbers && o.rightAlign && o.leader !== '.') {
      const ind = (Math.min(h.level, 9) - 1) * 0.388;
      const leader = { '': {}, '-': { 'style:leader-style': 'dash', 'style:leader-text': '-' }, _: { 'style:leader-style': 'solid', 'style:leader-text': '_' } }[o.leader] || {};
      auto = { styleAttrs: {}, props: { 'style:paragraph-properties': { a: {}, c: [{ n: 'style:tab-stops', a: {}, c: [{ n: 'style:tab-stop', a: { 'style:position': `${(15.92 - ind).toFixed(3)}cm`, 'style:type': 'right', ...leader } }] }] } } };
    }
    blocks.push(P(`Contents_20_${Math.min(h.level, 9)}`, content, auto));
  }
  if (!entries.length) blocks.push(P('Contents_20_1', [T('No table of contents entries found.')]));
  return blocks;
}

/** A complete TOC node for options. */
export function tocNode(doc, o, pageOf, name = 'Table of Contents1') {
  const body = tocBody(doc, o, pageOf);
  return schema.nodeFromJSON({
    type: 'index',
    attrs: {
      element: 'text:table-of-content', attrs: { 'text:protected': 'true', 'text:name': name }, source: tocSource(o),
      titleCount: o.title ? 1 : 0, titleAttrs: o.title ? { 'text:name': `${name}_Head` } : null,
    },
    content: body,
  });
}

/** A name not used by another index of the same kind ("Table of Contents2"). */
export function uniqueIndexName(doc, base) {
  const used = new Set();
  doc.descendants((n) => { if (n.type.name === 'index' && n.attrs.attrs?.['text:name']) used.add(n.attrs.attrs['text:name']); return true; });
  let i = 1;
  while (used.has(`${base}${i}`)) i++;
  return `${base}${i}`;
}

/** All index nodes of an element type: [{ node, pos }]. */
export function findIndexes(doc, element = null) {
  const out = [];
  doc.descendants((n, pos) => { if (n.type.name === 'index') { if (!element || n.attrs.element === element) out.push({ node: n, pos }); return false; } return true; });
  return out;
}
