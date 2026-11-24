/**
 * The document schema: maps 1:1 onto the ODT concepts the editor uses.
 *
 * Formatting model (mirrors ODF):
 *   - Blocks reference a named style (styleName) and may carry "auto"
 *     formatting = the contents of an ODF automatic style:
 *       auto = { styleAttrs: {attr: value}, props: { 'style:paragraph-properties': {a:{…}, c:[…]}, … } }
 *     The exporter turns auto formatting back into de-duplicated automatic styles.
 *   - Text carries a `charStyle` mark (named character style) and/or a
 *     `textProps` mark (direct formatting, same auto structure).
 *
 * Nodes keep every attribute they don't interpret in `extra`, and content the
 * editor doesn't understand becomes opaque_block / opaque_inline holding the
 * original XML, so it is written back unchanged.
 *
 * All attrs are plain JSON so documents can be autosaved and compared.
 */
import { Schema } from 'prosemirror-model';
import { autoToCss, tableAutoCss } from './odt/css.js';
import { inheritedTextProps, htmlBlockAttrs } from './clipboard.js';

const BLOCK = 'paragraph | heading | list | table | section | index | opaque_block';
const AUTO = { default: null };
const EXTRA = { default: null };

const json = (v) => (v == null ? '' : JSON.stringify(v));
const parseJson = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
const sanitize = (name) => String(name || '').replace(/[^A-Za-z0-9_-]/g, '_');

/** DOM attributes shared by paragraphs and headings. */
function blockDomAttrs(node) {
  const a = node.attrs;
  let style = autoToCss(a.auto, 'paragraph');
  const pp = a.auto?.props?.['style:paragraph-properties']?.a || {};
  // Drop cap (style:drop-cap inside the paragraph properties).
  const dc = a.auto?.props?.['style:paragraph-properties']?.c?.find?.((x) => x.n === 'style:drop-cap');
  const lines = dc ? Number(dc.a['style:lines'] || 0) : 0;
  if (lines > 1) style = `${style ? `${style};` : ''}--dc-lines:${lines};--dc-gap:${dc.a['style:distance'] || '0cm'}`;
  return {
    class: `ps-${sanitize(a.styleName)}${lines > 1 ? ' has-dropcap' : ''}${a.change ? ` tc-break tc-break-${a.change.type === 'deletion' ? 'del' : 'ins'}` : ''}`,
    style: style || null,
    'data-style': a.styleName || '',
    'data-auto': a.auto ? json(a.auto) : null,
    'data-extra': a.extra ? json(a.extra) : null,
    'data-break': pp['fo:break-before'] && pp['fo:break-before'] !== 'auto' ? pp['fo:break-before'] : null,
    'data-change': a.change ? json(a.change) : null,
    'data-author': a.change ? authorKey(a.change.author) : null,
  };
}

function blockAttrsFromDom(dom) {
  return {
    styleName: dom.getAttribute('data-style') || 'Standard',
    auto: parseJson(dom.getAttribute('data-auto')),
    extra: parseJson(dom.getAttribute('data-extra')),
    change: parseJson(dom.getAttribute('data-change')),
  };
}

/**
 * Tracked changes. Text carries insertion / deletion / formatChange marks
 * ({ author, date, cid }); a paragraph whose ending (its break to the next
 * paragraph) was inserted or deleted has `change` = { type, author, date, cid }.
 * See core/track-changes.js.
 */
const CHANGE = { default: null };
const changeAttrs = { author: { default: '' }, date: { default: '' }, cid: { default: '' }, old: { default: null } };
/** A short stable key per author, used to colour their changes. */
export function authorKey(name) {
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return String(h % 8);
}
const changeDom = (cls) => (mark) => ['span', { class: `tc-${cls}`, 'data-tc': json(mark.attrs), 'data-author': authorKey(mark.attrs.author), title: `${mark.attrs.author || ''}` }, 0];
const changeParse = (cls) => [{ tag: `span.tc-${cls}`, priority: 70, getAttrs: (dom) => parseJson(dom.getAttribute('data-tc')) || {} }];

export const nodes = {
  doc: { content: `(${BLOCK})+` },

  paragraph: {
    group: 'block',
    content: 'inline*',
    attrs: { styleName: { default: 'Standard' }, auto: AUTO, extra: EXTRA, change: CHANGE },
    parseDOM: [
      { tag: 'p[data-style]', priority: 60, getAttrs: blockAttrsFromDom },
      { tag: 'p', getAttrs: htmlBlockAttrs },
      { tag: 'blockquote', getAttrs: htmlBlockAttrs },
      { tag: 'pre', getAttrs: () => ({ styleName: 'Standard', auto: null, extra: null }), preserveWhitespace: 'full' },
    ],
    toDOM: (node) => ['p', blockDomAttrs(node), 0],
  },

  heading: {
    group: 'block',
    content: 'inline*',
    defining: true,
    attrs: {
      styleName: { default: 'Heading_20_1' }, level: { default: 1 }, auto: AUTO, extra: EXTRA, change: CHANGE,
    },
    parseDOM: [{
      tag: 'h1[data-style], h2[data-style], h3[data-style], h4[data-style], h5[data-style], h6[data-style]', priority: 60,
      getAttrs: (dom) => ({ ...blockAttrsFromDom(dom), level: Number(dom.getAttribute('data-level')) || Number(dom.tagName[1]) }),
    }, ...[1, 2, 3, 4, 5, 6].map((n) => ({ tag: `h${n}`, getAttrs: () => ({ styleName: `Heading_20_${n}`, level: n, auto: null, extra: null }) }))],
    toDOM: (node) => [`h${Math.min(6, Math.max(1, node.attrs.level))}`, { ...blockDomAttrs(node), 'data-level': String(node.attrs.level) }, 0],
  },

  list: {
    group: 'block',
    content: 'list_item+',
    attrs: { styleName: { default: null }, extra: EXTRA, ordered: { default: false } },
    parseDOM: [{
      tag: 'ul[data-odt-list], ol[data-odt-list]', priority: 60,
      getAttrs: (dom) => ({ styleName: dom.getAttribute('data-list-style') || null, extra: parseJson(dom.getAttribute('data-extra')), ordered: dom.tagName === 'OL' }),
    }, { tag: 'ul', getAttrs: () => ({ styleName: 'List_20_Bullet', ordered: false, extra: null }) },
    { tag: 'ol', getAttrs: () => ({ styleName: 'Numbering_20_123', ordered: true, extra: null }) }],
    toDOM: (node) => [node.attrs.ordered ? 'ol' : 'ul', {
      'data-odt-list': '', 'data-list-style': node.attrs.styleName || null, class: node.attrs.styleName ? `ls-${sanitize(node.attrs.styleName)}` : null,
      'data-extra': node.attrs.extra ? json(node.attrs.extra) : null,
    }, 0],
  },

  list_item: {
    content: '(paragraph | heading | list | opaque_block)+',
    defining: true,
    attrs: { header: { default: false }, extra: EXTRA },
    parseDOM: [{ tag: 'li[data-odt-item]', priority: 60, getAttrs: (dom) => ({ header: dom.hasAttribute('data-header'), extra: parseJson(dom.getAttribute('data-extra')) }) }, { tag: 'li' }],
    toDOM: (node) => ['li', {
      'data-odt-item': '', 'data-header': node.attrs.header ? '' : null, 'data-extra': node.attrs.extra ? json(node.attrs.extra) : null,
      value: node.attrs.extra?.['text:start-value'] || null,
    }, 0],
  },

  table: {
    group: 'block',
    content: 'table_row+',
    tableRole: 'table',
    isolating: true,
    // styleName: a named table style; auto: the table's own (automatic) formatting.
    // columns: [{ styleName, auto, repeat, defaultCellStyle, extra, width }].
    attrs: { styleName: { default: null }, auto: AUTO, columns: { default: [] }, extra: EXTRA },
    parseDOM: [{
      tag: 'table[data-odt-table]', priority: 60,
      getAttrs: (dom) => ({ styleName: dom.getAttribute('data-style') || null, auto: parseJson(dom.getAttribute('data-auto')), columns: parseJson(dom.getAttribute('data-columns')) || [], extra: parseJson(dom.getAttribute('data-extra')) }),
    }, { tag: 'table', getAttrs: () => ({ styleName: null, columns: [], extra: null }) }],
    toDOM: (node) => {
      const cols = [];
      for (const col of node.attrs.columns) for (let i = 0; i < (col.repeat || 1); i++) cols.push(['col', col.width ? { style: `width:${col.width}` } : {}]);
      return ['table', {
        'data-odt-table': '', 'data-style': node.attrs.styleName || null, class: node.attrs.styleName ? `ts-${sanitize(node.attrs.styleName)}` : null,
        style: node.attrs.auto ? tableAutoCss(node.attrs.auto, 'table') || null : null,
        'data-auto': node.attrs.auto ? json(node.attrs.auto) : null,
        'data-columns': json(node.attrs.columns), 'data-extra': node.attrs.extra ? json(node.attrs.extra) : null,
      }, ['colgroup', ...cols], ['tbody', 0]];
    },
  },

  table_row: {
    content: 'table_cell+',
    tableRole: 'row',
    attrs: { styleName: { default: null }, auto: AUTO, header: { default: false }, extra: EXTRA },
    parseDOM: [{ tag: 'tr[data-odt-row]', priority: 60, getAttrs: (dom) => ({ styleName: dom.getAttribute('data-style') || null, auto: parseJson(dom.getAttribute('data-auto')), header: dom.hasAttribute('data-header'), extra: parseJson(dom.getAttribute('data-extra')) }) },
      { tag: 'tr', getAttrs: (dom) => ({ styleName: null, header: dom.parentElement?.tagName === 'THEAD', extra: null }) }],
    toDOM: (node) => ['tr', {
      'data-odt-row': '', 'data-style': node.attrs.styleName || null, 'data-header': node.attrs.header ? '' : null,
      style: node.attrs.auto ? tableAutoCss(node.attrs.auto, 'table-row') || null : null,
      'data-auto': node.attrs.auto ? json(node.attrs.auto) : null,
      'data-extra': node.attrs.extra ? json(node.attrs.extra) : null,
    }, 0],
  },

  table_cell: {
    content: `(${BLOCK})+`,
    tableRole: 'cell',
    isolating: true,
    attrs: { styleName: { default: null }, auto: AUTO, colspan: { default: 1 }, rowspan: { default: 1 }, colwidth: { default: null }, extra: EXTRA },
    parseDOM: [{
      tag: 'td[data-odt-cell]', priority: 60,
      getAttrs: (dom) => ({
        styleName: dom.getAttribute('data-style') || null, auto: parseJson(dom.getAttribute('data-auto')), colspan: Number(dom.getAttribute('colspan')) || 1,
        rowspan: Number(dom.getAttribute('rowspan')) || 1, extra: parseJson(dom.getAttribute('data-extra')),
      }),
    }, ...['td', 'th'].map((tag) => ({ tag, getAttrs: (dom) => ({ styleName: null, colspan: Number(dom.getAttribute('colspan')) || 1, rowspan: Number(dom.getAttribute('rowspan')) || 1, colwidth: null, extra: null }) }))],
    toDOM: (node) => ['td', {
      'data-odt-cell': '', 'data-style': node.attrs.styleName || null, class: node.attrs.styleName ? `tc-${sanitize(node.attrs.styleName)}` : null,
      colspan: node.attrs.colspan > 1 ? String(node.attrs.colspan) : null, rowspan: node.attrs.rowspan > 1 ? String(node.attrs.rowspan) : null,
      style: node.attrs.auto ? tableAutoCss(node.attrs.auto, 'table-cell') || null : null,
      'data-auto': node.attrs.auto ? json(node.attrs.auto) : null,
      'data-extra': node.attrs.extra ? json(node.attrs.extra) : null,
    }, 0],
  },

  section: {
    group: 'block',
    content: `(${BLOCK})+`,
    isolating: true,
    attrs: { name: { default: '' }, styleName: { default: null }, extra: EXTRA },
    parseDOM: [{ tag: 'section[data-odt-section]', priority: 60, getAttrs: (dom) => ({ name: dom.getAttribute('data-name') || '', styleName: dom.getAttribute('data-style') || null, extra: parseJson(dom.getAttribute('data-extra')) }) }],
    toDOM: (node) => ['section', {
      'data-odt-section': '', 'data-name': node.attrs.name, 'data-style': node.attrs.styleName || null,
      class: node.attrs.styleName ? `ss-${sanitize(node.attrs.styleName)}` : null, 'data-extra': node.attrs.extra ? json(node.attrs.extra) : null,
    }, 0],
  },

  /**
   * Generated indexes: table of contents, table of figures/tables, alphabetical
   * index, bibliography. `source` is the *-source element (kept as a tree and
   * written back), the content is the index body; its first `titleCount`
   * blocks are the index title (text:index-title, attributes `titleAttrs`).
   * The body is regenerated by Update Table / Update Index.
   */
  index: {
    group: 'block',
    content: `(${BLOCK})+`,
    isolating: true,
    // ooxml: a TOC read from Word ({ sdtPr, instr, begin, source }): its content control and field are written back as they were.
    attrs: { element: { default: 'text:table-of-content' }, attrs: { default: {} }, source: { default: null }, titleCount: { default: 0 }, titleAttrs: { default: null }, ooxml: { default: null } },
    parseDOM: [{ tag: 'div[data-odt-index]', priority: 60, getAttrs: (dom) => parseJson(dom.getAttribute('data-index')) || {} }],
    toDOM: (node) => ['div', { 'data-odt-index': '', 'data-index': json(node.attrs), class: `odt-index ${node.attrs.element.replace(':', '-')}` }, 0],
  },

  /** Block-level XML the editor doesn't model (unknown elements). */
  opaque_block: {
    group: 'block',
    atom: true,
    selectable: true,
    // dialect: 'odf' (from an ODT) or 'ooxml' (from a .docx; part: the package part it came from, for its relationships).
    attrs: { xml: { default: '' }, label: { default: '' }, text: { default: '' }, dialect: { default: 'odf' }, part: { default: null } },
    parseDOM: [{ tag: 'div[data-odt-opaque]', priority: 60, getAttrs: (dom) => ({ xml: dom.getAttribute('data-xml') || '', label: dom.getAttribute('data-label') || '', text: dom.textContent, dialect: dom.getAttribute('data-dialect') || 'odf', part: dom.getAttribute('data-part') || null }) }],
    toDOM: (node) => ['div', { 'data-odt-opaque': '', 'data-xml': node.attrs.xml, 'data-label': node.attrs.label, 'data-dialect': node.attrs.dialect, 'data-part': node.attrs.part, class: 'odt-opaque', contenteditable: 'false', title: node.attrs.label }, node.attrs.text || ' '],
  },

  text: { group: 'inline' },

  /** Line break; `clear` (Text Wrapping Break) moves below floating objects (LibreOffice's loext:clear). */
  hard_break: {
    group: 'inline', inline: true, selectable: false,
    attrs: { clear: { default: null } },
    parseDOM: [{ tag: 'br', getAttrs: (dom) => ({ clear: dom.getAttribute('data-clear') || null }) }],
    toDOM: (node) => ['br', node.attrs.clear ? { 'data-clear': node.attrs.clear } : {}],
  },

  tab: {
    group: 'inline', inline: true, selectable: false,
    // ptab: a Word positional tab { alignment, relativeTo, leader }: it goes to the margin / indent position itself, whatever the tab stops.
    attrs: { ptab: { default: null } },
    parseDOM: [{ tag: 'span.odt-tab', priority: 60, getAttrs: (dom) => ({ ptab: parseJson(dom.getAttribute('data-ptab')) }) }],
    toDOM: (node) => ['span', { class: 'odt-tab', 'data-ptab': node.attrs.ptab ? json(node.attrs.ptab) : null }, '\t'],
    leafText: () => '\t',
  },

  /**
   * Drawing objects: draw:frame (picture, text box, embedded object) and
   * shapes (draw:custom-shape, draw:line, draw:rect, draw:ellipse).
   *   element    the ODF element name
   *   styleName  named graphic style; auto = its automatic graphic style
   *   frameAttrs the element's other attributes (anchor, position, size, z-index, name, transform…)
   *   parts      the element's children as XML trees, in order; the text of a
   *              text box / shape is `body` (block JSON) and sits where the
   *              part { n: '#body' } or the text-box part ('#body': true) is
   *   kind       image | textbox | shape | wordart | line | object | equation | chart
   *   href       picture / object path (for display)
   * Rendered by layout/object-view.js.
   */
  frame: {
    group: 'inline', inline: true, atom: true, draggable: true,
    attrs: {
      element: { default: 'draw:frame' }, styleName: { default: null }, auto: AUTO, frameAttrs: { default: {} },
      parts: { default: [] }, body: { default: [] }, kind: { default: 'image' }, href: { default: '' },
    },
    parseDOM: [{
      tag: 'img[src^="data:image/"]',
      getAttrs: (dom) => ({ frameAttrs: { '#pastedSrc': dom.getAttribute('src'), '#w': dom.getAttribute('width') || '', '#h': dom.getAttribute('height') || '', '#alt': dom.getAttribute('alt') || '' }, kind: 'image' }),
    }, {
      tag: 'span[data-odt-frame]', priority: 60,
      getAttrs: (dom) => parseJson(dom.getAttribute('data-frame')) || {},
    }],
    toDOM: (node) => ['span', { 'data-odt-frame': '', 'data-frame': json(node.attrs), class: `odt-frame kind-${node.attrs.kind}` }],
  },

  /** Footnote / endnote. The body is a list of block nodes as JSON (edited in M8). */
  note: {
    group: 'inline', inline: true, atom: true,
    // ooxml: from Word, the run properties of the reference and of the mark inside the note ({ ref, mark }).
    attrs: { noteClass: { default: 'footnote' }, citation: { default: '' }, label: { default: null }, body: { default: [] }, extra: EXTRA, ooxml: { default: null } },
    parseDOM: [{ tag: 'sup[data-odt-note]', priority: 60, getAttrs: (dom) => ({ ...parseJson(dom.getAttribute('data-note')) }) }],
    toDOM: (node) => ['sup', { 'data-odt-note': '', 'data-note': json(node.attrs), class: `odt-note ${node.attrs.noteClass}` }, node.attrs.citation || '*'],
  },

  /** Comment (office:annotation); body as JSON blocks (edited in M9). */
  annotation: {
    group: 'inline', inline: true, atom: true,
    attrs: { name: { default: null }, creator: { default: '' }, date: { default: '' }, initials: { default: '' }, body: { default: [] }, extra: EXTRA },
    parseDOM: [{ tag: 'span[data-odt-annotation]', priority: 60, getAttrs: (dom) => ({ ...parseJson(dom.getAttribute('data-annotation')) }) }],
    toDOM: (node) => ['span', { 'data-odt-annotation': '', 'data-annotation': json(node.attrs), class: 'odt-annotation', title: node.attrs.creator }],
  },

  annotation_end: {
    group: 'inline', inline: true, atom: true, selectable: false,
    attrs: { name: { default: '' } },
    parseDOM: [{ tag: 'span[data-odt-annotation-end]', priority: 60, getAttrs: (dom) => ({ name: dom.getAttribute('data-name') || '' }) }],
    toDOM: (node) => ['span', { 'data-odt-annotation-end': '', 'data-name': node.attrs.name, class: 'odt-anchor' }],
  },

  /** Bookmarks and reference marks (point / start / end). */
  bookmark: {
    group: 'inline', inline: true, atom: true, selectable: false,
    attrs: { element: { default: 'text:bookmark' }, name: { default: '' }, extra: EXTRA },
    parseDOM: [{ tag: 'span[data-odt-bookmark]', priority: 60, getAttrs: (dom) => ({ ...parseJson(dom.getAttribute('data-bookmark')) }) }],
    toDOM: (node) => ['span', { 'data-odt-bookmark': '', 'data-bookmark': json(node.attrs), class: 'odt-anchor' }],
  },

  /** Fields (page number, date, cross-reference, merge field…): element name, attributes and displayed text. */
  field: {
    group: 'inline', inline: true, atom: true,
    attrs: { element: { default: 'text:page-number' }, fieldAttrs: { default: {} }, text: { default: '' } },
    parseDOM: [{ tag: 'span[data-odt-field]', priority: 60, getAttrs: (dom) => ({ ...parseJson(dom.getAttribute('data-field')) }) }],
    toDOM: (node) => ['span', { 'data-odt-field': '', 'data-field': json(node.attrs), 'data-num-format': node.attrs.fieldAttrs?.['style:num-format'] ?? null, class: `odt-field f-${node.attrs.element.replace(':', '-')}` }, ['span', { class: 'odt-field-text' }, node.attrs.text || '​']],
    leafText: (node) => node.attrs.text,
  },

  /** Tracked-change markers (text:change-start / change-end / change). The changes themselves stay in the document prelude until M9. */
  change_marker: {
    group: 'inline', inline: true, atom: true, selectable: false,
    attrs: { kind: { default: 'start' }, changeId: { default: '' } },
    parseDOM: [{ tag: 'span[data-odt-change]', priority: 60, getAttrs: (dom) => ({ kind: dom.getAttribute('data-kind'), changeId: dom.getAttribute('data-id') }) }],
    toDOM: (node) => ['span', { 'data-odt-change': '', 'data-kind': node.attrs.kind, 'data-id': node.attrs.changeId, class: 'odt-anchor' }],
  },

  /** Inline XML the editor doesn't model (ruby, shapes, index marks…). */
  opaque_inline: {
    group: 'inline', inline: true, atom: true,
    // hidden: nothing to show (Word's hidden bookmarks, empty runs).
    attrs: { xml: { default: '' }, text: { default: '' }, dialect: { default: 'odf' }, part: { default: null }, hidden: { default: false } },
    parseDOM: [{ tag: 'span[data-odt-opaque]', priority: 60, getAttrs: (dom) => ({ xml: dom.getAttribute('data-xml') || '', text: dom.textContent, dialect: dom.getAttribute('data-dialect') || 'odf', part: dom.getAttribute('data-part') || null, hidden: dom.hasAttribute('data-hidden') }) }],
    toDOM: (node) => ['span', { 'data-odt-opaque': '', 'data-xml': node.attrs.xml, 'data-dialect': node.attrs.dialect, 'data-part': node.attrs.part, 'data-hidden': node.attrs.hidden ? '' : null, class: node.attrs.hidden ? 'odt-opaque-hidden' : 'odt-opaque-inline' }, node.attrs.hidden ? '' : node.attrs.text || '□'],
    leafText: (node) => node.attrs.text,
  },
};

for (const name of ['hard_break', 'tab', 'frame', 'note', 'annotation', 'annotation_end', 'bookmark', 'field', 'change_marker', 'opaque_inline']) {
  if (!nodes[name].leafText) nodes[name].leafText = () => (name === 'hard_break' ? '\n' : '');
}

export const marks = {
  insertion: { attrs: changeAttrs, inclusive: true, excludes: 'insertion', parseDOM: changeParse('ins'), toDOM: changeDom('ins') },
  deletion: { attrs: changeAttrs, inclusive: false, excludes: 'deletion', parseDOM: changeParse('del'), toDOM: changeDom('del') },
  formatChange: { attrs: changeAttrs, inclusive: false, excludes: 'formatChange', parseDOM: changeParse('fmt'), toDOM: changeDom('fmt') },
  /**
   * A content control (Developer tab; LibreOffice's loext:content-control):
   * attrs = the element's attributes (loext:checkbox, loext:dropdown,
   * loext:alias, loext:tag, loext:lock…), items = drop-down entries.
   */
  contentControl: {
    // ooxml: from Word, { sdtPr, attrs } — the control's properties as written, while its attributes are unchanged.
    attrs: { attrs: { default: {} }, items: { default: [] }, ooxml: { default: null } },
    inclusive: false,
    excludes: 'contentControl',
    parseDOM: [{ tag: 'span[data-cc]', priority: 80, getAttrs: (dom) => ({ attrs: parseJson(dom.getAttribute('data-cc')) || {}, items: parseJson(dom.getAttribute('data-items')) || [] }) }],
    toDOM: (mark) => {
      const a = mark.attrs.attrs || {};
      const kind = a['loext:checkbox'] === 'true' ? 'checkbox' : a['loext:combobox'] === 'true' ? 'combobox' : a['loext:dropdown'] === 'true' ? 'dropdown' : a['loext:date'] === 'true' ? 'date' : a['loext:picture'] === 'true' ? 'picture' : a['loext:plain-text'] === 'true' ? 'plain' : 'rich';
      return ['span', {
        'data-cc': json(a), 'data-items': mark.attrs.items?.length ? json(mark.attrs.items) : null, 'data-kind': kind,
        'data-title': a['loext:alias'] || null, class: `cc cc-${kind}${a['loext:showing-place-holder'] === 'true' ? ' cc-placeholder' : ''}`,
      }, 0];
    },
  },
  link: {
    // ooxml: from Word, the hyperlink's other attributes (history, tooltip, target frame) as XML text.
    attrs: { href: { default: '' }, extra: EXTRA, ooxml: { default: null } },
    inclusive: false,
    parseDOM: [{ tag: 'a[href]', getAttrs: (dom) => ({ href: dom.getAttribute('href'), extra: parseJson(dom.getAttribute('data-extra')) }) }],
    toDOM: (mark) => ['a', { href: mark.attrs.href, 'data-extra': mark.attrs.extra ? json(mark.attrs.extra) : null, class: 'odt-link' }, 0],
  },
  /** A named character style (text:span with a common style). */
  charStyle: {
    attrs: { name: { default: '' } },
    parseDOM: [{ tag: 'span[data-char-style]', priority: 60, getAttrs: (dom) => ({ name: dom.getAttribute('data-char-style') }) }],
    toDOM: (mark) => ['span', { 'data-char-style': mark.attrs.name, class: `cs-${sanitize(mark.attrs.name)}` }, 0],
  },
  /** Direct character formatting = an automatic text style. */
  textProps: {
    attrs: { auto: { default: null } },
    parseDOM: [
      { tag: 'span[data-text-auto]', priority: 60, getAttrs: (dom) => ({ auto: parseJson(dom.getAttribute('data-text-auto')) }) },
      // Generic HTML (pasted from other apps): the element's formatting merged with its inline ancestors'.
      {
        tag: 'b, strong, i, em, u, ins, s, strike, del, sub, sup, font, span, code, kbd, mark, cite',
        getAttrs: (dom) => {
          if (dom.style?.fontWeight === 'normal' && dom.tagName === 'B' && /docs-internal-guid/.test(dom.id || '')) return false;
          const a = inheritedTextProps(dom);
          return Object.keys(a).length ? { auto: { styleAttrs: {}, props: { 'style:text-properties': { a } } } } : false;
        },
      },
    ],
    toDOM: (mark) => ['span', { 'data-text-auto': json(mark.attrs.auto), style: autoToCss(mark.attrs.auto, 'text') || null }, 0],
  },
};

export const schema = new Schema({ nodes, marks });
export { sanitize as cssName };
