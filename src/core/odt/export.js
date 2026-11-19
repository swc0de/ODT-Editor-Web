/**
 * ODT export: DocumentState → ODF 1.3 package bytes.
 *
 *  - Paragraph/text formatting in the model becomes automatic styles,
 *    de-duplicated by content (same parent + same properties → one style).
 *  - Automatic styles kept verbatim from the source are written only if
 *    something still refers to them; generated names never clash with them.
 *  - Unreferenced pictures are dropped; unknown package files are kept.
 *  - meta.xml gets fresh statistics, date and generator.
 */
import { SOURCES_FILE } from '../bibliography.js';
import { exportChanges } from '../track-changes.js';
import { schema } from '../schema.js';
import { escText, escAttr, attrsToXml, treeToXml, treeText, nsDeclarations, XML_DECL } from './xml.js';
import { ROOT_PREFIXES } from './namespaces.js';
import { writePackage } from './package.js';
import { treeFromAuto, stableStringify } from './styles.js';
import { documentStats, createBlankState } from '../document.js';
import { APP_NAME, APP_VERSION, ODT_MIME, OTT_MIME } from '../../config.js';

const MARK = '\u0001';

/** Collects automatic styles generated while writing the body. */
export function createAutoRegistry() {
  const byKey = new Map();
  return {
    /** Embedded objects whose files live in the model: { dir, files, mime }. */
    objects: [],
    ref(family, parent, auto, prefix = null) {
      const key = stableStringify([family, parent || null, auto]);
      let e = byKey.get(key);
      if (!e) {
        e = { id: byKey.size, family, parent, auto, name: null, prefix };
        byKey.set(key, e);
      }
      return `${MARK}${e.id}${MARK}`;
    },
    entries: () => [...byKey.values()],
  };
}

export function createBodyWriter(registry) {
  // Splitting a paragraph copies its attributes, so ids must be de-duplicated.
  const seenIds = new Set();
  const attrs = (obj) => {
    if (!obj) return '';
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith('#')) continue;
      if (k === 'xml:id' || k === 'text:id') { if (seenIds.has(v)) continue; seenIds.add(v); }
      out[k] = v;
    }
    return attrsToXml(out);
  };
  const styleAttr = (attrName, family, styleName, auto) => {
    if (auto) return ` ${attrName}="${registry.ref(family, styleName, auto)}"`;
    return styleName ? ` ${attrName}="${escAttr(styleName)}"` : '';
  };

  function block(node) {
    const a = node.attrs;
    switch (node.type.name) {
      case 'paragraph':
        return `<text:p${styleAttr('text:style-name', 'paragraph', a.styleName, a.auto)}${attrs(a.extra)}>${inlines(node)}</text:p>`;
      case 'heading':
        return `<text:h${styleAttr('text:style-name', 'paragraph', a.styleName, a.auto)} text:outline-level="${a.level}"${attrs(a.extra)}>${inlines(node)}</text:h>`;
      case 'list': {
        let s = `<text:list${a.styleName ? ` text:style-name="${escAttr(a.styleName)}"` : ''}${attrs(a.extra)}>`;
        node.forEach((item) => {
          const tag = item.attrs.header ? 'text:list-header' : 'text:list-item';
          s += `<${tag}${attrs(item.attrs.extra)}>`;
          item.forEach((c) => { s += block(c); });
          s += `</${tag}>`;
        });
        return `${s}</text:list>`;
      }
      case 'table': return table(node);
      case 'section': {
        let s = `<text:section${a.styleName ? ` text:style-name="${escAttr(a.styleName)}"` : ''} text:name="${escAttr(a.name)}"${attrs(a.extra)}>`;
        if (a.extra?.['#xml']) s += a.extra['#xml'];
        node.forEach((c) => { s += block(c); });
        return `${s}</text:section>`;
      }
      case 'index': {
        let s = `<${a.element}${attrs(a.attrs)}>${a.source ? treeToXml(a.source) : ''}<text:index-body>`;
        let i = 0;
        if (a.titleCount) s += `<text:index-title${attrs(a.titleAttrs)}>`;
        node.forEach((c) => {
          s += block(c);
          i++;
          if (a.titleCount && i === a.titleCount) s += '</text:index-title>';
        });
        if (a.titleCount && i < a.titleCount) s += '</text:index-title>';
        return `${s}</text:index-body></${a.element}>`;
      }
      case 'opaque_block': return node.attrs.xml;
      default: return '';
    }
  }

  /** Style reference of a table / column / row / cell: its automatic style, or its named style. */
  const tstyle = (family, x) => (x.auto ? ` table:style-name="${registry.ref(family, null, x.auto)}"` : (x.styleName ? ` table:style-name="${escAttr(x.styleName)}"` : ''));

  function table(node) {
    const a = node.attrs;
    let s = `<table:table${tstyle('table', a)}${attrs(a.extra)}>`;
    if (!(a.columns || []).length) {
      let w = 0;
      node.forEach((row) => { let n = 0; row.forEach((c) => { n += c.attrs.colspan; }); w = Math.max(w, n); });
      s += `<table:table-column${w > 1 ? ` table:number-columns-repeated="${w}"` : ''}/>`;
    }
    for (const col of a.columns || []) {
      s += `<table:table-column${tstyle('table-column', col)}${col.repeat > 1 ? ` table:number-columns-repeated="${col.repeat}"` : ''}${col.defaultCellStyle ? ` table:default-cell-style-name="${escAttr(col.defaultCellStyle)}"` : ''}${attrs(col.extra)}/>`;
    }
    // Width of the grid (for covered cells at row ends).
    let width = (a.columns || []).reduce((n, c) => n + (c.repeat || 1), 0);
    node.forEach((row) => { let w = 0; row.forEach((c) => { w += c.attrs.colspan; }); width = Math.max(width, w); });
    const covered = []; // covered[r] = Set of columns covered by row spans
    let inHeader = false;
    node.forEach((row, _, r) => {
      if (row.attrs.header && !inHeader) { s += '<table:table-header-rows>'; inHeader = true; }
      if (!row.attrs.header && inHeader) { s += '</table:table-header-rows>'; inHeader = false; }
      s += `<table:table-row${tstyle('table-row', row.attrs)}${attrs(row.attrs.extra)}>`;
      const cov = covered[r] || new Set();
      let col = 0;
      const coveredCell = () => { s += '<table:covered-table-cell/>'; col++; };
      row.forEach((cell) => {
        while (cov.has(col)) coveredCell();
        const ca = cell.attrs;
        s += `<table:table-cell${tstyle('table-cell', ca)}${ca.colspan > 1 ? ` table:number-columns-spanned="${ca.colspan}"` : ''}${ca.rowspan > 1 ? ` table:number-rows-spanned="${ca.rowspan}"` : ''}${attrs(ca.extra)}>`;
        cell.forEach((c) => { s += block(c); });
        s += '</table:table-cell>';
        for (let k = 1; k < ca.rowspan; k++) {
          covered[r + k] = covered[r + k] || new Set();
          for (let j = 0; j < ca.colspan; j++) covered[r + k].add(col + j);
        }
        col++;
        for (let j = 1; j < ca.colspan; j++) coveredCell();
      });
      while (col < width && cov.has(col)) coveredCell();
      s += '</table:table-row>';
    });
    if (inHeader) s += '</table:table-header-rows>';
    return `${s}</table:table>`;
  }

  /** Inline content: links outermost, then spans; ODF white-space encoding. */
  function inlines(parent) {
    const items = [];
    parent.forEach((child) => items.push(child));
    if (!items.length) return '';
    const st = { prevSpace: true };
    let out = '';
    let i = 0;
    while (i < items.length) {
      const link = items[i].marks.find((m) => m.type.name === 'link');
      let j = i + 1;
      while (j < items.length && sameLink(items[j], link)) j++;
      const inner = spans(items.slice(i, j), st);
      if (link) {
        const ex = link.attrs.extra || {};
        out += `<text:a xlink:type="simple" xlink:href="${escAttr(link.attrs.href)}"${attrs(ex)}>${inner}</text:a>`;
      } else out += inner;
      i = j;
    }
    return out;
  }

  const sameLink = (node, link) => {
    const l = node.marks.find((m) => m.type.name === 'link');
    return link ? !!l && l.eq(link) : !l;
  };

  function spanRef(node) {
    const cs = node.marks.find((m) => m.type.name === 'charStyle');
    const tp = node.marks.find((m) => m.type.name === 'textProps');
    if (tp && tp.attrs.auto) return registry.ref('text', cs?.attrs.name || null, tp.attrs.auto);
    return cs ? escAttr(cs.attrs.name) : null;
  }

  function spans(items, st) {
    let out = '';
    let i = 0;
    while (i < items.length) {
      const ref = items[i].isText ? spanRef(items[i]) : null;
      let j = i + 1;
      while (j < items.length && items[j].isText && ref && spanRef(items[j]) === ref) j++;
      let inner = '';
      for (let k = i; k < j; k++) inner += leaf(items[k], st);
      out += ref ? `<text:span text:style-name="${ref}">${inner}</text:span>` : inner;
      i = j;
    }
    return out;
  }

  function encodeText(text, st) {
    let out = '';
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (ch === ' ') {
        let k = 1;
        while (text[i + k] === ' ') k++;
        if (st.prevSpace) out += k === 1 ? '<text:s/>' : `<text:s text:c="${k}"/>`;
        else out += k === 1 ? ' ' : ` <text:s${k - 1 > 1 ? ` text:c="${k - 1}"` : ''}/>`;
        st.prevSpace = true;
        i += k;
        continue;
      }
      if (ch === '\t') out += '<text:tab/>';
      else if (ch === '\n') out += '<text:line-break/>';
      else if (ch === '\r') { i++; continue; } else out += escText(ch);
      st.prevSpace = false;
      i++;
    }
    return out;
  }

  function leaf(node, st) {
    const a = node.attrs;
    switch (node.type.name) {
      case 'text': return encodeText(node.text, st);
      case 'tab': st.prevSpace = false; return '<text:tab/>';
      case 'hard_break': st.prevSpace = false; return a.clear ? `<text:line-break loext:clear="${escAttr(a.clear)}"/>` : '<text:line-break/>';
      case 'field': st.prevSpace = false; return a.text ? `<${a.element}${attrsToXml(a.fieldAttrs)}>${escText(a.text)}</${a.element}>` : `<${a.element}${attrsToXml(a.fieldAttrs)}/>`;
      case 'frame': st.prevSpace = false; return drawObject(a);
      case 'opaque_inline': st.prevSpace = false; return a.xml;
      case 'bookmark': return `<${a.element} text:name="${escAttr(a.name)}"${attrs(a.extra)}/>`;
      case 'change_marker': {
        const el = a.kind === 'point' ? 'text:change' : `text:change-${a.kind}`;
        return `<${el} text:change-id="${escAttr(a.changeId)}"/>`;
      }
      case 'annotation_end': return `<office:annotation-end office:name="${escAttr(a.name)}"/>`;
      case 'annotation': {
        const initialsEl = a.extra?.['#initialsEl'] || 'meta:creator-initials';
        let s = `<office:annotation${a.name ? ` office:name="${escAttr(a.name)}"` : ''}${attrs(a.extra)}>`;
        if (a.creator) s += `<dc:creator>${escText(a.creator)}</dc:creator>`;
        if (a.date) s += `<dc:date>${escText(a.date)}</dc:date>`;
        if (a.initials) s += `<${initialsEl}>${escText(a.initials)}</${initialsEl}>`;
        s += blocksFromJSON(a.body);
        return `${s}</office:annotation>`;
      }
      case 'note': {
        st.prevSpace = false;
        return `<text:note text:note-class="${escAttr(a.noteClass)}"${attrs(a.extra)}><text:note-citation${a.label != null ? ` text:label="${escAttr(a.label)}"` : ''}>${escText(a.citation)}</text:note-citation><text:note-body>${blocksFromJSON(a.body)}</text:note-body></text:note>`;
      }
      default: return '';
    }
  }

  /** A drawing object (frame node) back to its ODF element. */
  function drawObject(a) {
    let style = '';
    if (a.auto) style = ` draw:style-name="${registry.ref('graphic', a.styleName, a.auto, a.element === 'draw:frame' ? 'fr' : 'gr')}"`;
    else if (a.styleName) style = ` draw:style-name="${escAttr(a.styleName)}"`;
    let inner = '';
    for (const p of a.parts || []) {
      if (p.n === '#body') inner += blocksFromJSON(a.body);
      else if (p['#body']) inner += `<${p.n}${attrsToXml(p.a)}>${blocksFromJSON(a.body)}</${p.n}>`;
      else {
        inner += treeToXml(p);
        if (p['#files'] && registry.objects) registry.objects.push({ dir: String(p.a['xlink:href'] || '').replace(/^\.\//, '').replace(/\/$/, ''), files: p['#files'], mime: p['#mime'] || '' });
      }
    }
    return `<${a.element}${style}${attrs(a.frameAttrs)}>${inner}</${a.element}>`;
  }

  function blocksFromJSON(list) {
    let s = '';
    for (const j of list || []) s += block(schema.nodeFromJSON(j));
    return s;
  }

  return {
    body(doc) { let s = ''; doc.forEach((n) => { s += block(n); }); return s; },
    block,
    blocks: blocksFromJSON,
  };
}

// --------------------------------------------------------------- references

const REF_ATTR = /(?:marker-start|marker-end|stroke-dash|style-name|list-style-name|data-style-name|master-page-name|default-cell-style-name|next-style-name|parent-style-name|percentage-data-style-name|class-names|cond-style-name|apply-style-name|citation-style-name|citation-body-style-name|visited-style-name|paragraph-style-name|text-style-name|default-style-name|base-cell-address)="([^"]*)"/g;

function referencedNames(xml) {
  const set = new Set();
  for (const m of xml.matchAll(REF_ATTR)) for (const n of m[1].split(/\s+/)) if (n) set.add(n);
  return set;
}

/**
 * Picks which kept automatic styles are still referenced (directly, or by
 * another kept style), in their original order.
 */
function keptAutoStyles(state, bodyXml) {
  const byName = new Map();
  for (const t of state.contentAutoStyles) byName.set(t.a?.['style:name'], t);
  const need = referencedNames(bodyXml);
  const kept = new Set();
  const queue = [...need];
  while (queue.length) {
    const n = queue.pop();
    if (kept.has(n) || !byName.has(n)) continue;
    kept.add(n);
    for (const r of referencedNames(treeToXml(byName.get(n)))) queue.push(r);
  }
  return state.contentAutoStyles.filter((t) => kept.has(t.a?.['style:name']));
}

/**
 * Pasted or template content may use built-in styles (Heading 1, List Bullet…)
 * that the opened document doesn't define: add them (with their parents).
 */
function withMissingStyles(commonStyles, xml, autoNames) {
  // Styles are named by style:name; markers, dashes and gradients by draw:name.
  const nameOf = (t) => t.a?.['style:name'] || t.a?.['draw:name'];
  const defined = new Set((commonStyles?.c || []).map(nameOf).filter(Boolean));
  const missing = [...referencedNames(xml)].filter((n) => !defined.has(n) && !autoNames.has(n));
  if (!missing.length) return commonStyles;
  const defaults = new Map();
  for (const t of createBlankState().commonStyles.c || []) if (nameOf(t)) defaults.set(nameOf(t), t);
  const add = [];
  const queue = [...missing];
  while (queue.length) {
    const n = queue.pop();
    if (defined.has(n) || !defaults.has(n)) continue;
    defined.add(n);
    const t = defaults.get(n);
    add.push(t);
    for (const r of referencedNames(treeToXml(t))) queue.push(r);
  }
  return add.length ? { ...commonStyles, c: [...(commonStyles.c || []), ...add] } : commonStyles;
}

// ------------------------------------------------------------------ meta

function updatedMeta(state) {
  const stats = documentStats(state.doc);
  // Like LibreOffice, the word count includes header and footer text.
  const masterText = treeText(state.masterStyles || { c: [] });
  stats.words += (masterText.match(/[\p{L}\p{N}]+(?:['’\-.][\p{L}\p{N}]+)*/gu) || []).length;
  const now = new Date().toISOString().replace(/\.\d+Z$/, '');
  const c = (state.meta?.c || []).filter((t) => typeof t !== 'string' && !['meta:generator', 'dc:date', 'meta:document-statistic', 'meta:editing-cycles'].includes(t.n));
  const cycles = Number((state.meta?.c || []).find((t) => t.n === 'meta:editing-cycles')?.c?.[0] || 0) + 1;
  c.unshift({ n: 'meta:generator', a: {}, c: [`${APP_NAME}/${APP_VERSION}`] });
  c.push({ n: 'dc:date', a: {}, c: [now] });
  c.push({ n: 'meta:editing-cycles', a: {}, c: [String(cycles)] });
  c.push({
    n: 'meta:document-statistic',
    a: {
      'meta:table-count': String(stats.tables), 'meta:image-count': String(stats.images), 'meta:object-count': '0',
      'meta:paragraph-count': String(stats.paragraphs), 'meta:word-count': String(stats.words),
      'meta:character-count': String(stats.chars), 'meta:non-whitespace-character-count': String(stats.charsNoSpace),
    },
  });
  return { n: 'office:meta', a: state.meta?.a || {}, c };
}

// ------------------------------------------------------------------ main

export const DEFAULT_SETTINGS = `${XML_DECL}<office:document-settings xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0" office:version="1.3"><office:settings><config:config-item-set config:name="ooo:view-settings"><config:config-item config:name="ViewAreaTop" config:type="long">0</config:config-item></config:config-item-set></office:settings></office:document-settings>\n`;

/**
 * @param {object} state DocumentState
 * @param {{ thumbnail?: Uint8Array, asTemplate?: boolean }} [opts]
 * @returns {{ bytes: Uint8Array, contentXml: string, stylesXml: string }}
 */
export function exportOdt(state, opts = {}) {
  const registry = createAutoRegistry();
  const writer = createBodyWriter(registry);
  // Tracked changes: marks back to change markers and text:tracked-changes regions.
  const tc = exportChanges(state.doc.toJSON());
  let body = writer.body(schema.nodeFromJSON(tc.doc));
  const regionXml = tc.regions.map((r) => {
    const info = `<office:change-info><dc:creator>${escText(r.author || '')}</dc:creator><dc:date>${escText(r.date || '')}</dc:date></office:change-info>`;
    const kind = r.type === 'format-change' ? 'text:format-change' : `text:${r.type}`;
    return `<text:changed-region xml:id="${escAttr(r.id)}" text:id="${escAttr(r.id)}"><${kind}>${info}${r.type === 'deletion' ? writer.blocks(r.blocks) : ''}</${kind}></text:changed-region>`;
  }).join('');
  let preludeTrees = state.prelude || [];
  if ((regionXml || state.trackChanges) && !preludeTrees.some((t) => t.n === 'text:tracked-changes')) {
    // After office:forms, before the declarations (ODF prelude order).
    const at = preludeTrees.findIndex((t) => t.n !== 'office:forms');
    const tcTree = { n: 'text:tracked-changes', a: {}, c: [] };
    preludeTrees = at < 0 ? [...preludeTrees, tcTree] : [...preludeTrees.slice(0, at), tcTree, ...preludeTrees.slice(at)];
  }
  const prelude = preludeTrees.map((t) => {
    if (t.n !== 'text:tracked-changes') return treeToXml(t);
    const a = { ...t.a };
    if (state.trackChanges) a['text:track-changes'] = 'true'; else delete a['text:track-changes'];
    return `<text:tracked-changes${attrsToXml(a)}>${(t.c || []).map((c) => (typeof c === 'string' ? escText(c) : treeToXml(c))).join('')}${regionXml}</text:tracked-changes>`;
  }).join('');

  // Name generated automatic styles, avoiding names that are kept or used by
  // common styles. Kept styles include those the generated ones refer to (data styles…).
  const genXml = registry.entries().map((e) => treeToXml(treeFromAuto('x', e.family, e.parent, e.auto))).join('');
  const kept = keptAutoStyles(state, body + prelude + genXml);
  const taken = new Set(kept.map((t) => t.a['style:name']));
  for (const t of state.commonStyles?.c || []) if (t.a?.['style:name']) taken.add(t.a['style:name']);
  const PREFIX = { paragraph: 'P', text: 'T', table: 'Tab', 'table-column': 'TabCol', 'table-row': 'TabRow', 'table-cell': 'TabCell' };
  const counters = {};
  const generated = [];
  for (const e of registry.entries()) {
    const prefix = e.prefix || PREFIX[e.family] || 'X';
    counters[prefix] = counters[prefix] || 0;
    let name;
    do { name = `${prefix}${++counters[prefix]}`; } while (taken.has(name));
    taken.add(name);
    e.name = name;
    generated.push(treeFromAuto(name, e.family, e.parent, e.auto));
  }
  const names = registry.entries();
  body = body.replace(/\u0001(\d+)\u0001/g, (_, id) => escAttr(names[Number(id)].name));

  const autoNames = new Set([...kept, ...generated].map((t) => t.a['style:name']));
  const commonStyles = withMissingStyles(state.commonStyles || { n: 'office:styles', a: {} }, body + treeToXml({ n: 'x', a: {}, c: [...kept, ...generated] }), autoNames);
  const nsDecl = nsDeclarations(ROOT_PREFIXES, state.nsExtra);
  const fonts = `<office:font-face-decls>${(state.fontFaces || []).map(treeToXml).join('')}</office:font-face-decls>`;
  const rootAttrs = (a) => attrsToXml({ ...a, 'office:version': '1.3' });

  const contentXml = `${XML_DECL}<office:document-content${nsDecl}${rootAttrs(state.contentRootAttrs)}>`
    + `${state.scripts ? treeToXml(state.scripts) : '<office:scripts/>'}${fonts}`
    + `<office:automatic-styles>${[...kept, ...generated].map(treeToXml).join('')}</office:automatic-styles>`
    + `<office:body><office:text${attrsToXml(state.officeTextAttrs)}>${prelude}${body}</office:text></office:body></office:document-content>\n`;

  const stylesXml = `${XML_DECL}<office:document-styles${nsDecl}${rootAttrs(state.stylesRootAttrs)}>${fonts}`
    + `${treeToXml(commonStyles)}`
    + `${treeToXml(state.stylesAutoStyles || { n: 'office:automatic-styles', a: {} })}`
    + `${treeToXml(state.masterStyles || { n: 'office:master-styles', a: {} })}</office:document-styles>\n`;

  const metaXml = `${XML_DECL}<office:document-meta${nsDeclarations(['office', 'meta', 'dc', 'xlink', 'ooo', 'grddl'])} office:version="1.3">${treeToXml(updatedMeta(state))}</office:document-meta>\n`;

  // Pictures still referenced anywhere.
  const allXml = contentXml + stylesXml;
  const entries = [
    ['content.xml', contentXml, { mediaType: 'text/xml' }],
    ['styles.xml', stylesXml, { mediaType: 'text/xml' }],
    ['meta.xml', metaXml, { mediaType: 'text/xml' }],
    ['settings.xml', state.settingsXml || DEFAULT_SETTINGS, { mediaType: 'text/xml' }],
  ];
  for (const [path, pic] of Object.entries(state.pictures || {})) {
    if (allXml.includes(path)) entries.push([path, pic.bytes, { mediaType: pic.mediaType || undefined }]);
  }
  // Embedded objects kept in the model (equations, charts).
  const objectDirs = [];
  const seenDirs = new Set();
  for (const o of registry.objects) {
    if (!o.dir || seenDirs.has(o.dir)) continue;
    seenDirs.add(o.dir);
    for (const [name, text] of Object.entries(o.files)) entries.push([`${o.dir}/${name}`, text, { mediaType: 'text/xml' }]);
    objectDirs.push({ path: `${o.dir}/`, mediaType: o.mime || 'application/vnd.oasis.opendocument.formula' });
  }
  for (const [path, f] of Object.entries(state.extraFiles || {})) {
    // Replacement pictures of objects that are gone are dropped.
    if (path.startsWith('ObjectReplacements/') && !allXml.includes(path)) continue;
    entries.push([path, f.bytes, { mediaType: f.mediaType || undefined }]);
  }
  const bib = state.bibliography;
  if (bib && (bib.sources?.length || (bib.style && bib.style !== 'apa'))) entries.push([SOURCES_FILE, JSON.stringify({ style: bib.style || 'apa', sources: bib.sources || [] }, null, 1), { mediaType: 'application/json' }]);
  if (opts.thumbnail) entries.push(['Thumbnails/thumbnail.png', opts.thumbnail, { mediaType: 'image/png' }]);

  const mime = opts.asTemplate || (opts.asTemplate === undefined && state.mime === 'template') ? OTT_MIME : ODT_MIME;
  const bytes = writePackage(mime, entries, [...objectDirs, ...(state.extraManifest || [])]);
  return { bytes, contentXml, stylesXml };
}
