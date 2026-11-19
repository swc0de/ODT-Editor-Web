/**
 * ODT import: package → DocumentState (see core/document.js).
 *
 * Paragraph and text automatic styles are resolved into the model (named
 * style + `auto` formatting); every other automatic style is kept verbatim.
 * Elements the editor doesn't model become opaque nodes holding their XML.
 */
import { Fragment } from 'prosemirror-model';
import { SOURCES_FILE } from '../bibliography.js';
import { importChanges } from '../track-changes.js';
import { schema } from '../schema.js';
import { readPackage, strFromU8, PackageError } from './package.js';
import { parseXml, toTree, qname, attrsOf, createNsContext, elementToXml, treeText } from './xml.js';
import { autoFromTree, mergeAuto, buildStyleIndex, listIsOrdered } from './styles.js';
import { createBlankState } from '../document.js';

const MIME_TEXT = 'application/vnd.oasis.opendocument.text';
const MIME_TEMPLATE = 'application/vnd.oasis.opendocument.text-template';

/** Elements that may open office:text before the body content. */
const PRELUDE = new Set([
  'office:forms', 'text:tracked-changes', 'text:variable-decls', 'text:sequence-decls', 'text:user-field-decls',
  'text:dde-connection-decls', 'text:alphabetical-index-auto-mark-file', 'table:calculation-settings',
  'table:content-validations', 'table:label-ranges',
]);

/** Inline elements with structure the importer handles explicitly. */
const STRUCTURAL_INLINE = new Set([
  'text:span', 'text:a', 'text:s', 'text:tab', 'text:line-break', 'text:note', 'text:soft-page-break', 'text:number',
  'text:bookmark', 'text:bookmark-start', 'text:bookmark-end', 'text:reference-mark', 'text:reference-mark-start',
  'text:reference-mark-end', 'text:change', 'text:change-start', 'text:change-end', 'text:ruby', 'text:meta',
  'text:meta-field', 'text:toc-mark', 'text:toc-mark-start', 'text:toc-mark-end', 'text:user-index-mark',
  'text:user-index-mark-start', 'text:user-index-mark-end',
]);

const BLOCK_LABELS = {
  'text:table-of-content': 'Table of Contents', 'text:illustration-index': 'Table of Figures', 'text:table-index': 'Table of Tables',
  'text:alphabetical-index': 'Index', 'text:bibliography': 'Bibliography', 'text:user-index': 'User Index', 'text:object-index': 'Table of Objects',
  'text:numbered-paragraph': 'Numbered paragraph', 'draw:frame': 'Frame',
};

export class ImportError extends Error {}

const without = (obj, ...keys) => {
  const out = {};
  for (const k in obj) if (!keys.includes(k)) out[k] = obj[k];
  return Object.keys(out).length ? out : null;
};

/**
 * @param {Uint8Array|ArrayBuffer} bytes
 * @returns {object} DocumentState
 */
export function importOdt(bytes) {
  const pkg = readPackage(bytes);
  if (pkg.mimetype && pkg.mimetype !== MIME_TEXT && pkg.mimetype !== MIME_TEMPLATE) {
    throw new PackageError(`This is not a text document (${pkg.mimetype}).`, 'wrong-type');
  }
  if (!pkg.files.has('content.xml')) throw new PackageError('This file has no content.xml, so it is not a valid ODT document.', 'no-content');
  const ns = createNsContext();
  const text = (path) => (pkg.files.has(path) ? strFromU8(pkg.files.get(path)) : null);

  const content = parseXml(text('content.xml')).documentElement;
  const stylesXml = text('styles.xml');
  const blank = createBlankState();
  const stylesRoot = stylesXml ? parseXml(stylesXml).documentElement : null;
  const metaXml = text('meta.xml');
  const metaRoot = metaXml ? parseXml(metaXml).documentElement : null;

  const child = (root, name) => (root ? [...root.children].find((c) => qname(c, ns) === name) : null);
  const treeOf = (root, name) => { const el = child(root, name); return el ? toTree(el, ns) : null; };

  // Fonts: union of both parts.
  const fontFaces = [];
  const seenFonts = new Set();
  for (const root of [stylesRoot, content]) {
    const decls = treeOf(root, 'office:font-face-decls');
    for (const f of decls?.c || []) {
      if (typeof f === 'string' || seenFonts.has(f.a['style:name'])) continue;
      seenFonts.add(f.a['style:name']);
      fontFaces.push(f);
    }
  }

  const contentAutoStyles = (treeOf(content, 'office:automatic-styles')?.c || []).filter((t) => typeof t !== 'string');
  const state = {
    ...blank,
    fontFaces: fontFaces.length ? fontFaces : blank.fontFaces,
    commonStyles: stylesRoot ? (treeOf(stylesRoot, 'office:styles') || { n: 'office:styles', a: {} }) : blank.commonStyles,
    stylesAutoStyles: stylesRoot ? (treeOf(stylesRoot, 'office:automatic-styles') || { n: 'office:automatic-styles', a: {} }) : blank.stylesAutoStyles,
    masterStyles: stylesRoot ? (treeOf(stylesRoot, 'office:master-styles') || { n: 'office:master-styles', a: {} }) : blank.masterStyles,
    contentAutoStyles,
    scripts: treeOf(content, 'office:scripts'),
    meta: metaRoot ? (treeOf(metaRoot, 'office:meta') || { n: 'office:meta', a: {} }) : blank.meta,
    settingsXml: text('settings.xml'),
    pictures: {},
    extraFiles: {},
    extraManifest: [],
    contentRootAttrs: attrsOf(content, ns),
    stylesRootAttrs: stylesRoot ? attrsOf(stylesRoot, ns) : blank.stylesRootAttrs,
    mime: pkg.mimetype === MIME_TEMPLATE ? 'template' : 'text',
    prelude: [],
  };

  // Package files.
  const mediaTypes = new Map(pkg.manifest.map((e) => [e.path, e.mediaType]));
  const OWN = new Set(['mimetype', 'META-INF/manifest.xml', 'content.xml', 'styles.xml', 'meta.xml', 'settings.xml', 'Thumbnails/thumbnail.png']);
  for (const [path, bytesOf] of pkg.files) {
    if (OWN.has(path)) continue;
    const entry = { bytes: bytesOf, mediaType: mediaTypes.get(path) || '' };
    if (path.startsWith('Pictures/')) state.pictures[path] = entry;
    else state.extraFiles[path] = entry;
  }
  state.extraManifest = pkg.manifest.filter((e) => e.path && e.path !== '/' && e.path.endsWith('/'));
  // The document's sources and citation style (see core/bibliography.js).
  if (state.extraFiles[SOURCES_FILE]) {
    try {
      const b = JSON.parse(strFromU8(state.extraFiles[SOURCES_FILE].bytes));
      state.bibliography = { style: String(b.style || 'apa'), sources: Array.isArray(b.sources) ? b.sources : [] };
    } catch { /* unreadable: ignored */ }
    delete state.extraFiles[SOURCES_FILE];
  }

  // Auto style lookup for paragraphs/text.
  const autoIndex = new Map();
  for (const t of contentAutoStyles) if (t.n === 'style:style') autoIndex.set(`${t.a['style:family']}:${t.a['style:name']}`, t);
  const styleIndex = buildStyleIndex(state);

  // Body.
  const body = child(content, 'office:body');
  const officeText = body && child(body, 'office:text');
  if (!officeText) throw new PackageError('This document has no text body.', 'no-body');
  state.officeTextAttrs = attrsOf(officeText, ns);

  const conv = createConverter({ ns, autoIndex, styleIndex, objectKind: (href) => objectKindOf(state, href), takeObjectFiles: (href) => takeObjectFiles(state, href) });
  let blocks = [];
  let inPrelude = true;
  const regions = new Map();
  for (const el of officeText.children) {
    const name = qname(el, ns);
    if (inPrelude && PRELUDE.has(name)) {
      state.prelude.push(toTree(el, ns));
      if (name === 'text:tracked-changes') readRegions(el, ns, conv, regions, state);
      continue;
    }
    inPrelude = false;
    blocks.push(...conv.block(el));
  }
  // Tracked changes become marks; the regions turned into marks leave the prelude.
  const tc = importChanges(blocks, regions);
  blocks = tc.blocks;
  if (tc.used.size) {
    state.prelude = state.prelude.map((t) => (t.n === 'text:tracked-changes'
      ? { ...t, c: (t.c || []).filter((r) => typeof r === 'string' || !tc.used.has(r.a?.['text:id'])) }
      : t)).filter((t) => t.n !== 'text:tracked-changes' || (t.c || []).some((r) => typeof r !== 'string'));
  }
  if (!blocks.length) blocks.push({ type: 'paragraph', attrs: { styleName: 'Standard' } });
  state.doc = schema.nodeFromJSON({ type: 'doc', content: blocks });
  state.nsExtra = { ...ns.extra };
  return state;
}

/** Reads text:tracked-changes: id → { type, author, date, blocks (deleted paragraphs) }. */
function readRegions(el, ns, conv, regions, state) {
  if (attrsOf(el, ns)['text:track-changes'] === 'true') state.trackChanges = true;
  for (const r of el.children) {
    if (qname(r, ns) !== 'text:changed-region') continue;
    const a = attrsOf(r, ns);
    const id = a['text:id'] || a['xml:id'];
    const kind = [...r.children].find((c) => ['text:insertion', 'text:deletion', 'text:format-change'].includes(qname(c, ns)));
    if (!id || !kind) continue;
    const type = qname(kind, ns).slice(5);
    const info = [...kind.children].find((c) => qname(c, ns) === 'office:change-info');
    const get = (n) => [...(info?.children || [])].find((c) => qname(c, ns) === n)?.textContent || '';
    const region = { type, author: get('dc:creator'), date: get('dc:date') };
    if (type === 'deletion') {
      region.blocks = [];
      for (const c of kind.children) {
        if (qname(c, ns) === 'office:change-info') continue;
        region.blocks.push(...conv.block(c));
      }
    }
    // Several change-infos or extra attributes: keep it as it is.
    if ([...kind.children].filter((c) => qname(c, ns) === 'office:change-info').length !== 1) continue;
    regions.set(id, region);
  }
}

/** Kind of an embedded object from its sub-document: equation (MathML), chart or other object. */
export function objectKindOf(state, href) {
  const dir = String(href || '').replace(/^\.\//, '').replace(/\/$/, '');
  const f = state.extraFiles?.[`${dir}/content.xml`];
  if (!f) return 'object';
  const head = strFromU8(f.bytes);
  if (/<(?:math:)?math[\s>]/.test(head)) return 'equation';
  if (/<office:chart[\s>]|<chart:chart[\s>]/.test(head)) return 'chart';
  return 'object';
}

/**
 * Moves the XML files of an embedded object ("Object 1/content.xml"…) out of
 * the package's other files into the model: { files: { name: text }, mime }.
 */
function takeObjectFiles(state, href) {
  const dir = String(href || '').replace(/^\.\//, '').replace(/\/$/, '');
  if (!dir) return null;
  const files = {};
  for (const path of Object.keys(state.extraFiles)) {
    if (path.startsWith(`${dir}/`) && path.endsWith('.xml') && !path.slice(dir.length + 1).includes('/')) {
      files[path.slice(dir.length + 1)] = strFromU8(state.extraFiles[path].bytes);
      delete state.extraFiles[path];
    }
  }
  if (!files['content.xml']) return null;
  const entry = state.extraManifest.find((e) => e.path === `${dir}/`);
  state.extraManifest = state.extraManifest.filter((e) => e.path !== `${dir}/`);
  return { files, mime: entry?.mediaType || '' };
}

/** Converts ODF body XML into ProseMirror JSON. */
export function createConverter({ ns, autoIndex, styleIndex, objectKind = null, takeObjectFiles = null }) {
  const q = (el) => qname(el, ns);

  /** Resolves a paragraph style reference → { styleName, auto }. */
  function paraStyle(name, fallback = 'Standard') {
    if (!name) return { styleName: fallback, auto: null };
    const t = autoIndex.get(`paragraph:${name}`);
    if (!t) return { styleName: name, auto: null };
    const { parent, auto } = autoFromTree(t);
    return { styleName: parent || fallback, auto };
  }

  function block(el) {
    const name = q(el);
    switch (name) {
      case 'text:p': return [paragraph(el)];
      case 'text:h': return [heading(el)];
      case 'text:list': return [list(el)];
      case 'table:table': return [table(el)];
      case 'text:section': return [section(el)];
      case 'text:table-of-content': case 'text:illustration-index': case 'text:table-index': case 'text:alphabetical-index':
      case 'text:bibliography': case 'text:user-index': case 'text:object-index':
        return [indexBlock(el)];
      case 'text:soft-page-break': return [];
      default: return [opaqueBlock(el)];
    }
  }

  const blocks = (el, accept) => {
    const out = [];
    for (const c of el.children) out.push(...block(c));
    return accept ? out.filter(accept) : out;
  };

  function opaqueBlock(el) {
    const name = q(el);
    const label = BLOCK_LABELS[name] || name;
    let text = '';
    const indexBody = [...el.children].find((c) => q(c) === 'text:index-body');
    const src = indexBody || el;
    const plain = (n) => [...n.childNodes].map((c) => {
      if (c.nodeType !== 1) return c.nodeType === 3 ? c.data.replace(/\s+/g, ' ') : '';
      if (c.localName === 'tab') return '\t';
      if (c.localName === 's') return ' '.repeat(Number(c.getAttribute('text:c')) || 1);
      if (c.localName === 'line-break') return '\n';
      return plain(c);
    }).join('');
    text = [...src.querySelectorAll('*')].filter((n) => ['p', 'h'].includes(n.localName)).map((n) => plain(n).trim()).join('\n') || src.textContent.replace(/\s+/g, ' ').trim();
    return { type: 'opaque_block', attrs: { xml: elementToXml(el, ns), label, text: text.slice(0, 4000) } };
  }

  function paragraph(el) {
    const a = attrsOf(el, ns);
    const { styleName, auto } = paraStyle(a['text:style-name']);
    const content = inlines(el);
    return { type: 'paragraph', attrs: { styleName, auto, extra: without(a, 'text:style-name') }, ...(content.length ? { content } : {}) };
  }

  function heading(el) {
    const a = attrsOf(el, ns);
    const { styleName, auto } = paraStyle(a['text:style-name'], null);
    const level = Number(a['text:outline-level']) || 1;
    const content = inlines(el);
    return { type: 'heading', attrs: { styleName, auto, level, extra: without(a, 'text:style-name', 'text:outline-level') }, ...(content.length ? { content } : {}) };
  }

  function list(el, inheritedStyle = null) {
    const a = attrsOf(el, ns);
    const styleName = a['text:style-name'] || null;
    const effective = styleName || inheritedStyle;
    const items = [];
    for (const c of el.children) {
      const n = q(c);
      if (n !== 'text:list-item' && n !== 'text:list-header') continue;
      const content = [];
      for (const b of c.children) {
        const bn = q(b);
        if (bn === 'text:list') content.push(list(b, effective));
        else if (bn === 'text:soft-page-break' || bn === 'text:number') continue;
        else content.push(...block(b));
      }
      if (!content.length) content.push({ type: 'paragraph', attrs: { styleName: 'Standard' } });
      items.push({ type: 'list_item', attrs: { header: n === 'text:list-header', extra: without(attrsOf(c, ns)) }, content: content.map(asListChild) });
    }
    if (!items.length) items.push({ type: 'list_item', attrs: { header: true, extra: null }, content: [{ type: 'paragraph', attrs: { styleName: 'Standard' } }] });
    return { type: 'list', attrs: { styleName, extra: without(a, 'text:style-name'), ordered: effective ? listIsOrdered(styleIndex, effective) : false }, content: items };
  }

  // List items may only hold paragraphs, headings, lists and opaque blocks.
  const asListChild = (n) => (['paragraph', 'heading', 'list', 'opaque_block'].includes(n.type) ? n : { type: 'opaque_block', attrs: { xml: '', label: n.type, text: '' } });

  /** An automatic table/column/row/cell style becomes the node's `auto`; a named style stays a name. */
  const tableStyle = (family, name) => {
    const t = name && autoIndex.get(`${family}:${name}`);
    return t ? { styleName: null, auto: autoFromTree(t).auto } : { styleName: name || null, auto: null };
  };

  function table(el) {
    const a = attrsOf(el, ns);
    const columns = [];
    const rows = [];
    const visit = (node, header) => {
      for (const c of node.children) {
        const n = q(c);
        if (n === 'table:table-column') {
          const ca = attrsOf(c, ns);
          const cs = tableStyle('table-column', ca['table:style-name']);
          const width = cs.auto?.props?.['style:table-column-properties']?.a?.['style:column-width'] || null;
          columns.push({
            ...cs, repeat: Number(ca['table:number-columns-repeated']) || 1,
            defaultCellStyle: ca['table:default-cell-style-name'] || null,
            extra: without(ca, 'table:style-name', 'table:number-columns-repeated', 'table:default-cell-style-name'), width,
          });
        } else if (['table:table-columns', 'table:table-header-columns', 'table:table-column-group'].includes(n)) visit(c, header);
        else if (n === 'table:table-header-rows') visit(c, true);
        else if (n === 'table:table-rows' || n === 'table:table-row-group') visit(c, header);
        else if (n === 'table:table-row') {
          const ra = attrsOf(c, ns);
          const repeat = Math.min(Number(ra['table:number-rows-repeated']) || 1, 1000);
          const cells = [];
          for (const cell of c.children) {
            const cn = q(cell);
            if (cn !== 'table:table-cell') continue; // covered cells are regenerated from spans
            const ca = attrsOf(cell, ns);
            const rep = Math.min(Number(ca['table:number-columns-repeated']) || 1, 1024);
            let content = blocks(cell);
            if (!content.length) content = [{ type: 'paragraph', attrs: { styleName: 'Standard' } }];
            for (let i = 0; i < rep; i++) {
              cells.push({
                type: 'table_cell',
                attrs: {
                  ...tableStyle('table-cell', ca['table:style-name']),
                  colspan: Number(ca['table:number-columns-spanned']) || 1,
                  rowspan: Number(ca['table:number-rows-spanned']) || 1,
                  colwidth: null,
                  extra: without(ca, 'table:style-name', 'table:number-columns-spanned', 'table:number-rows-spanned', 'table:number-columns-repeated'),
                },
                content: structuredClone(content),
              });
            }
          }
          if (!cells.length) cells.push({ type: 'table_cell', attrs: {}, content: [{ type: 'paragraph', attrs: { styleName: 'Standard' } }] });
          for (let i = 0; i < repeat; i++) {
            rows.push({ type: 'table_row', attrs: { ...tableStyle('table-row', ra['table:style-name']), header: !!header, extra: without(ra, 'table:style-name', 'table:number-rows-repeated') }, content: structuredClone(cells) });
          }
        }
      }
    };
    visit(el, false);
    if (!rows.length) return opaqueBlock(el);
    return { type: 'table', attrs: { ...tableStyle('table', a['table:style-name']), columns, extra: without(a, 'table:style-name') }, content: rows };
  }

  /** A generated index: its source is kept as a tree, its body becomes blocks. */
  function indexBlock(el) {
    const name = q(el);
    let source = null;
    let titleAttrs = null;
    const title = [];
    const rest = [];
    for (const c of el.children) {
      const n = q(c);
      if (n.endsWith('-source')) source = toTree(c, ns);
      else if (n === 'text:index-body') {
        for (const b of c.children) {
          if (q(b) === 'text:index-title') { titleAttrs = attrsOf(b, ns); title.push(...blocks(b)); } else rest.push(...block(b));
        }
      }
    }
    const content = [...title, ...rest];
    if (!content.length) content.push({ type: 'paragraph', attrs: { styleName: 'Standard' } });
    return { type: 'index', attrs: { element: name, attrs: attrsOf(el, ns), source, titleCount: title.length, titleAttrs }, content };
  }

  function section(el) {
    const a = attrsOf(el, ns);
    const extra = without(a, 'text:name', 'text:style-name') || {};
    const content = [];
    const other = [];
    for (const c of el.children) {
      const n = q(c);
      if (n === 'text:section-source' || n === 'office:dde-source') other.push(elementToXml(c, ns));
      else content.push(...block(c));
    }
    if (other.length) extra['#xml'] = other.join('');
    if (!content.length) content.push({ type: 'paragraph', attrs: { styleName: 'Standard' } });
    return { type: 'section', attrs: { name: a['text:name'] || '', styleName: a['text:style-name'] || null, extra: Object.keys(extra).length ? extra : null }, content };
  }

  // ------------------------------------------------------------ inline

  /** Marks for a text:span style reference, inheriting from the enclosing span. */
  function spanMarks(styleRef, outer) {
    const outerChar = outer.find((m) => m.type === 'charStyle');
    const outerProps = outer.find((m) => m.type === 'textProps');
    const rest = outer.filter((m) => m.type !== 'charStyle' && m.type !== 'textProps');
    let charName = outerChar?.attrs.name || null;
    let auto = outerProps?.attrs.auto || null;
    const t = styleRef && autoIndex.get(`text:${styleRef}`);
    if (t) {
      const r = autoFromTree(t);
      if (r.parent) charName = r.parent;
      auto = mergeAuto(auto, r.auto);
    } else if (styleRef) charName = styleRef;
    const marks = [...rest];
    if (charName) marks.push({ type: 'charStyle', attrs: { name: charName } });
    if (auto) marks.push({ type: 'textProps', attrs: { auto } });
    return marks;
  }

  /**
   * Converts the inline content of a paragraph. Applies ODF white-space
   * rules: runs of space/tab/newline collapse to one space, and leading
   * white space of the paragraph is dropped. Invisible anchors (bookmarks,
   * change marks) don't break a run of white space.
   */
  function inlines(el) {
    const out = [];
    const st = { lastSpace: true };
    const pushText = (text, marks) => {
      if (!text) return;
      const prev = out[out.length - 1];
      if (prev && prev.type === 'text' && JSON.stringify(prev.marks || []) === JSON.stringify(marks)) prev.text += text;
      else out.push(marks.length ? { type: 'text', text, marks } : { type: 'text', text });
    };
    const atom = (node, visible = true) => { out.push(node); if (visible) st.lastSpace = false; };

    const walk = (parent, marks) => {
      for (const node of parent.childNodes) {
        if (node.nodeType === 3 || node.nodeType === 4) {
          let t = node.data.replace(/[ \t\n\r]+/g, ' ');
          if (st.lastSpace && t.startsWith(' ')) t = t.slice(1);
          if (!t) continue;
          pushText(t, marks);
          st.lastSpace = t.endsWith(' ');
          continue;
        }
        if (node.nodeType !== 1) continue;
        const name = q(node);
        const a = attrsOf(node, ns);
        switch (name) {
          case 'text:s': pushText(' '.repeat(Math.max(1, Number(a['text:c']) || 1)), marks); st.lastSpace = true; break;
          case 'text:tab': atom({ type: 'tab' }); break;
          case 'text:line-break': atom(a['loext:clear'] ? { type: 'hard_break', attrs: { clear: a['loext:clear'] } } : { type: 'hard_break' }); break;
          case 'text:span': walk(node, spanMarks(a['text:style-name'], marks)); break;
          case 'text:a': {
            const link = { type: 'link', attrs: { href: a['xlink:href'] || '', extra: without(a, 'xlink:href', 'xlink:type') } };
            walk(node, [...marks.filter((m) => m.type !== 'link'), link]);
            break;
          }
          case 'text:soft-page-break': case 'text:number': break;
          case 'text:note': atom({ type: 'note', attrs: note(node, a) }); break;
          case 'office:annotation': atom({ type: 'annotation', attrs: annotation(node, a) }, false); break;
          case 'office:annotation-end': atom({ type: 'annotation_end', attrs: { name: a['office:name'] || '' } }, false); break;
          case 'text:bookmark': case 'text:bookmark-start': case 'text:bookmark-end':
          case 'text:reference-mark': case 'text:reference-mark-start': case 'text:reference-mark-end':
            atom({ type: 'bookmark', attrs: { element: name, name: a['text:name'] || '', extra: without(a, 'text:name') } }, false);
            break;
          case 'text:change-start': case 'text:change-end': case 'text:change':
            atom({ type: 'change_marker', attrs: { kind: name.slice(12) || 'point', changeId: a['text:change-id'] || '' } }, false);
            break;
          case 'draw:frame': case 'draw:custom-shape': case 'draw:line': case 'draw:rect': case 'draw:ellipse':
          case 'draw:path': case 'draw:polyline': case 'draw:polygon':
            atom({ type: 'frame', attrs: drawObject(node, name, a) });
            break;
          case 'draw:g': {
            const g = drawGroup(node, a);
            if (g) atom({ type: 'frame', attrs: g });
            else atom({ type: 'opaque_inline', attrs: { xml: elementToXml(node, ns), text: '' } });
            break;
          }
          default: {
            const onlyText = [...node.childNodes].every((c) => c.nodeType === 3 || c.nodeType === 4);
            if (name.startsWith('text:') && !STRUCTURAL_INLINE.has(name) && onlyText) {
              atom({ type: 'field', attrs: { element: name, fieldAttrs: a, text: node.textContent } });
            } else {
              atom({ type: 'opaque_inline', attrs: { xml: elementToXml(node, ns), text: node.textContent.replace(/\s+/g, ' ').trim().slice(0, 200) } });
            }
          }
        }
      }
    };
    walk(el, []);
    // Marks on atoms (inline nodes inside spans/links) are dropped: ODF keeps them outside styling.
    return out;
  }

  /** Block JSON as the editor writes it (all attributes, in schema order). */
  const normalBody = (list) => { try { return list.length ? Fragment.fromJSON(schema, list).toJSON() : []; } catch { return list; } };

  function note(el, a) {
    let citation = '';
    let label = null;
    let body = [];
    for (const c of el.children) {
      const n = q(c);
      if (n === 'text:note-citation') { citation = c.textContent; label = c.getAttribute('text:label') ?? attrsOf(c, ns)['text:label'] ?? null; }
      if (n === 'text:note-body') body = normalBody(blocks(c));
    }
    return { noteClass: a['text:note-class'] || 'footnote', citation, label, body, extra: without(a, 'text:note-class') };
  }

  function annotation(el, a) {
    let creator = '';
    let date = '';
    let initials = '';
    const extra = without(a, 'office:name') || {};
    const body = [];
    for (const c of el.children) {
      const n = q(c);
      if (n === 'dc:creator') creator = c.textContent;
      else if (n === 'dc:date') date = c.textContent;
      else if (n === 'meta:creator-initials' || n === 'loext:sender-initials') { initials = c.textContent; if (n !== 'meta:creator-initials') extra['#initialsEl'] = n; }
      else body.push(...block(c));
    }
    return { name: a['office:name'] || null, creator, date, initials, body: normalBody(body), extra: Object.keys(extra).length ? extra : null };
  }

  /**
   * A drawing object (see the frame node in schema.js): the graphic style is
   * resolved like paragraph styles; children are kept as trees except the
   * text of text boxes and shapes, which becomes editable blocks.
   */
  function drawObject(el, name, a) {
    let styleName = null;
    let auto = null;
    const ref = a['draw:style-name'];
    if (ref) {
      const t = autoIndex.get(`graphic:${ref}`);
      if (t) { const r = autoFromTree(t); styleName = r.parent; auto = r.auto; } else styleName = ref;
    }
    const parts = [];
    const body = [];
    let kind = '';
    let href = '';
    let bodyPlaced = false;
    for (const c of el.children) {
      const n = q(c);
      if (name === 'draw:frame' && n === 'draw:text-box' && !bodyPlaced) {
        parts.push({ n, a: attrsOf(c, ns), '#body': true });
        body.push(...blocks(c));
        bodyPlaced = true;
        kind = kind || 'textbox';
      } else if (name !== 'draw:frame' && (n === 'text:p' || n === 'text:h' || n === 'text:list')) {
        if (!bodyPlaced) { parts.push({ n: '#body' }); bodyPlaced = true; }
        body.push(...block(c));
      } else {
        const t = toTree(c, ns);
        parts.push(t);
        if (n === 'draw:image' && !kind) { kind = 'image'; href = t.a['xlink:href'] || ''; }
        if ((n === 'draw:object' || n === 'draw:object-ole') && !kind) {
          href = t.a['xlink:href'] || '';
          kind = objectKind ? objectKind(href) : 'object';
          // Equations and charts carry their files in the model (see core/equations.js).
          if ((kind === 'equation' || kind === 'chart') && n === 'draw:object' && takeObjectFiles) {
            const o = takeObjectFiles(href);
            if (o) { t['#files'] = o.files; t['#mime'] = o.mime; }
          }
        }
        if (n === 'draw:enhanced-geometry' && t.a['draw:text-path'] === 'true') kind = 'wordart';
      }
    }
    if (!kind) kind = name === 'draw:frame' ? 'object' : name === 'draw:line' ? 'line' : ['draw:path', 'draw:polyline', 'draw:polygon'].includes(name) ? 'ink' : 'shape';
    // Text bodies are kept exactly as ProseMirror serialises them (the nested editors write that form).
    const normal = body.length ? Fragment.fromJSON(schema, body).toJSON() : [];
    return { element: name, styleName, auto, frameAttrs: without(a, 'draw:style-name') || {}, parts, body: normal, kind, href };
  }

  /**
   * A group (draw:g): its shapes become parts in the group's own coordinates,
   * the group gets the bounding box (see core/ink.js; a Drawing Canvas is a
   * group named "Drawing Canvas …"). Groups holding frames, text or nested
   * groups stay as they are (null).
   */
  function drawGroup(el, a) {
    const SHAPES = new Set(['draw:path', 'draw:polyline', 'draw:polygon', 'draw:rect', 'draw:ellipse', 'draw:line', 'draw:custom-shape']);
    const kids = [...el.children];
    if (!kids.length || kids.some((c) => !SHAPES.has(q(c)) || [...c.children].some((x) => q(x) === 'text:p'))) return null;
    const num = (v) => parseFloat(v) || 0;
    const parts = kids.map((c) => {
      const t = toTree(c, ns);
      const ref = t.a['draw:style-name'];
      const st = ref && autoIndex.get(`graphic:${ref}`);
      if (st) { t['#graphic'] = autoFromTree(st).auto?.props?.['style:graphic-properties']?.a || {}; delete t.a['draw:style-name']; }
      return t;
    });
    // Bounding box (cm) of the children.
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (const t of parts) {
      const b = t.n === 'draw:line'
        ? [Math.min(num(t.a['svg:x1']), num(t.a['svg:x2'])), Math.min(num(t.a['svg:y1']), num(t.a['svg:y2'])), Math.max(num(t.a['svg:x1']), num(t.a['svg:x2'])), Math.max(num(t.a['svg:y1']), num(t.a['svg:y2']))]
        : [num(t.a['svg:x']), num(t.a['svg:y']), num(t.a['svg:x']) + num(t.a['svg:width']), num(t.a['svg:y']) + num(t.a['svg:height'])];
      x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]);
    }
    const f = (v) => `${(Math.round(v * 1000) / 1000).toFixed(3)}cm`;
    for (const t of parts) {
      for (const [k, o] of [['svg:x', x0], ['svg:y', y0], ['svg:x1', x0], ['svg:x2', x0], ['svg:y1', y0], ['svg:y2', y0]]) if (t.a[k] != null) t.a[k] = f(num(t.a[k]) - o);
    }
    let styleName = null;
    let auto = null;
    const ref = a['draw:style-name'];
    if (ref) { const t = autoIndex.get(`graphic:${ref}`); if (t) { const r = autoFromTree(t); styleName = r.parent; auto = r.auto; } else styleName = ref; }
    const frameAttrs = { ...(without(a, 'draw:style-name', 'svg:y') || {}), 'svg:x': f(x0), 'svg:y': f(y0), 'svg:width': f(x1 - x0), 'svg:height': f(y1 - y0) };
    const kind = /^Drawing Canvas/i.test(a['draw:name'] || '') ? 'canvas' : 'group';
    return { element: 'draw:g', styleName, auto, frameAttrs, parts, body: [], kind, href: '' };
  }

  return { block, blocks, inlines };
}

export { treeText };
