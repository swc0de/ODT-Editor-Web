/**
 * DocumentState: everything needed to edit and re-save an ODT document.
 *
 *   doc               ProseMirror document (office:text body)
 *   officeTextAttrs   attributes of <office:text>
 *   prelude           trees before the body content (sequence-decls, tracked-changes, forms…)
 *   fontFaces         style:font-face trees (union of content.xml and styles.xml)
 *   commonStyles      <office:styles> tree (named styles, list styles, defaults…)
 *   stylesAutoStyles  <office:automatic-styles> tree of styles.xml (page layouts, header/footer styles)
 *   masterStyles      <office:master-styles> tree
 *   contentAutoStyles automatic style trees of content.xml kept verbatim (tables, sections, lists, frames…)
 *   scripts           <office:scripts> tree or null
 *   meta              <office:meta> tree
 *   settingsXml       settings.xml text or null
 *   pictures          { 'Pictures/x.png': { bytes, mediaType } }
 *   extraFiles        other package files kept verbatim { path: { bytes, mediaType } }
 *   extraManifest     manifest entries to keep (directories…)
 *   nsExtra           { uri: prefix } for unknown namespaces
 *   contentRootAttrs / stylesRootAttrs  root attributes (office:version…)
 *   mime              'text' | 'template'
 */
import { schema } from './schema.js';
import { parseXml, toTree, createNsContext, findChild } from './odt/xml.js';
import { DEFAULT_STYLES_XML } from './odt/default-styles.js';
import { APP_NAME, APP_VERSION } from '../config.js';

export function emptyDoc() {
  return schema.node('doc', null, [schema.node('paragraph', { styleName: 'Standard' })]);
}

/** A new, blank document using the built-in default styles. */
export function createBlankState({ doc = null } = {}) {
  const ctx = createNsContext();
  const root = parseXml(DEFAULT_STYLES_XML).documentElement;
  // The default styles are pretty-printed: drop whitespace-only text between elements.
  const strip = (t) => {
    if (typeof t === 'string' || !t.c) return t;
    const c = t.c.filter((x) => typeof x !== 'string' || x.trim()).map(strip);
    return c.length ? { ...t, c } : { n: t.n, a: t.a };
  };
  const part = (name) => {
    const el = [...root.children].find((c) => c.localName === name);
    return el ? strip(toTree(el, ctx)) : { n: `office:${name}`, a: {} };
  };
  const now = new Date().toISOString().replace(/\.\d+Z$/, '');
  return {
    doc: doc || emptyDoc(),
    officeTextAttrs: {},
    prelude: [{
      n: 'text:sequence-decls', a: {},
      c: ['Illustration', 'Table', 'Text', 'Drawing', 'Figure'].map((name) => ({ n: 'text:sequence-decl', a: { 'text:display-outline-level': '0', 'text:name': name } })),
    }],
    fontFaces: part('font-face-decls').c || [],
    commonStyles: part('styles'),
    stylesAutoStyles: part('automatic-styles'),
    masterStyles: part('master-styles'),
    contentAutoStyles: [],
    scripts: null,
    meta: {
      n: 'office:meta', a: {}, c: [
        { n: 'meta:generator', a: {}, c: [`${APP_NAME}/${APP_VERSION}`] },
        { n: 'meta:creation-date', a: {}, c: [now] },
        { n: 'dc:language', a: {}, c: ['en-GB'] },
      ],
    },
    settingsXml: null,
    pictures: {},
    extraFiles: {},
    extraManifest: [],
    nsExtra: { ...ctx.extra },
    contentRootAttrs: { 'office:version': '1.3' },
    stylesRootAttrs: { 'office:version': '1.3' },
    mime: 'text',
  };
}

/** Serialisable copy (for IndexedDB autosave): the PM doc becomes JSON. */
export function stateToJSON(state) {
  return { ...state, doc: state.doc.toJSON() };
}

export function stateFromJSON(json) {
  return { ...json, doc: schema.nodeFromJSON(json.doc) };
}

/** Title from meta (dc:title), if any. */
export function metaTitle(state) {
  const t = findChild(state.meta || {}, 'dc:title');
  return t ? (t.c || []).join('') : '';
}

/** Word, character and paragraph counts of the body. */
export function documentStats(doc) {
  let words = 0;
  let chars = 0;
  let charsNoSpace = 0;
  let paragraphs = 0;
  let tables = 0;
  let images = 0;
  doc.descendants((node) => {
    if (node.type.name === 'paragraph' || node.type.name === 'heading') {
      paragraphs++;
      const text = node.textContent;
      chars += text.length;
      charsNoSpace += text.replace(/\s/g, '').length;
      const m = text.match(/[\p{L}\p{N}]+(?:['’\-.][\p{L}\p{N}]+)*/gu);
      if (m) words += m.length;
    } else if (node.type.name === 'table') tables++;
    else if (node.type.name === 'frame' && node.attrs.kind === 'image') images++;
    return true;
  });
  return { words, chars, charsNoSpace, paragraphs, tables, images };
}
