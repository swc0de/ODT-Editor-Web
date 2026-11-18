/**
 * Header / footer content: the children of a master page's style:header
 * (…-left, …-first) ⇄ ProseMirror documents for the header/footer editor.
 * Formatting becomes automatic styles in styles.xml (MP… / MT…); styles that
 * nothing refers to any more are removed.
 */
import { schema } from './schema.js';
import { createConverter } from './odt/import.js';
import { createBodyWriter, createAutoRegistry } from './odt/export.js';
import { parseXml, toTree, treeToXml, createNsContext, nsDeclarations, findChild } from './odt/xml.js';
import { ROOT_PREFIXES } from './odt/namespaces.js';
import { treeFromAuto } from './odt/styles.js';

/** Element name of a header/footer variant: kind 'right' (default) | 'left' | 'first'. */
export const partElement = (part, kind) => (kind === 'left' ? `style:${part}-left` : kind === 'first' ? `style:${part}-first` : `style:${part}`);

/** The master page tree and its part element. */
export function findPart(state, masterName, part, kind) {
  const master = (state.masterStyles?.c || []).find((m) => typeof m !== 'string' && m.n === 'style:master-page' && m.a['style:name'] === masterName);
  return { master, tree: master ? findChild(master, partElement(part, kind)) : null };
}

/** A part tree → ProseMirror document (at least one paragraph). */
export function partToDoc(state, styleIndex, tree) {
  const autoIndex = new Map();
  for (const t of state.stylesAutoStyles?.c || []) if (typeof t !== 'string' && t.n === 'style:style') autoIndex.set(`${t.a['style:family']}:${t.a['style:name']}`, t);
  const converter = createConverter({ ns: createNsContext(), autoIndex, styleIndex });
  const xml = `<root${nsDeclarations(ROOT_PREFIXES, state.nsExtra)}>${(tree?.c || []).map((c) => (typeof c === 'string' ? '' : treeToXml(c))).join('')}</root>`;
  const blocks = converter.blocks(parseXml(xml).documentElement);
  if (!blocks.length) blocks.push({ type: 'paragraph', attrs: { styleName: 'Header' } });
  return schema.nodeFromJSON({ type: 'doc', content: blocks });
}

const REF = /(?:style-name|parent-style-name|next-style-name|list-style-name|data-style-name|master-page-name)="([^"]*)"/g;
const refs = (xml) => new Set([...xml.matchAll(REF)].map((m) => m[1]));

/**
 * Writes a header/footer document back: replaces the part's content in
 * state.masterStyles, adds its automatic styles to state.stylesAutoStyles
 * and drops paragraph/text automatic styles nothing uses any more.
 */
export function writePart(state, masterName, part, kind, doc) {
  const registry = createAutoRegistry();
  const writer = createBodyWriter(registry);
  let xml = writer.body(doc);
  const autos = (state.stylesAutoStyles?.c || []).filter((t) => typeof t !== 'string');
  const taken = new Set([...autos, ...(state.contentAutoStyles || []), ...(state.commonStyles?.c || [])].map((t) => t?.a?.['style:name']).filter(Boolean));
  const counters = { paragraph: 0, text: 0 };
  const generated = [];
  for (const e of registry.entries()) {
    const prefix = e.family === 'paragraph' ? 'MP' : 'MT';
    let name;
    do { name = `${prefix}${++counters[e.family]}`; } while (taken.has(name));
    taken.add(name);
    e.name = name;
    generated.push(treeFromAuto(name, e.family, e.parent, e.auto));
  }
  const names = registry.entries();
  xml = xml.replace(/\u0001(\d+)\u0001/g, (_, id) => names[Number(id)].name);
  const root = parseXml(`<root${nsDeclarations(ROOT_PREFIXES, state.nsExtra)}>${xml}</root>`).documentElement;
  const ns = createNsContext();
  const children = [...root.children].map((el) => toTree(el, ns));
  const el = partElement(part, kind);
  const masters = (state.masterStyles?.c || []).map((m) => {
    if (typeof m === 'string' || m.n !== 'style:master-page' || m.a['style:name'] !== masterName) return m;
    const c = [...(m.c || [])];
    const i = c.findIndex((x) => typeof x !== 'string' && x.n === el);
    const tree = { n: el, a: i >= 0 ? c[i].a : {}, c: children };
    if (i >= 0) c[i] = tree;
    else {
      // ODF order: header, header-left, header-first, footer, footer-left, footer-first.
      const order = ['style:header', 'style:header-left', 'style:header-first', 'style:footer', 'style:footer-left', 'style:footer-first'];
      const at = c.findIndex((x) => typeof x !== 'string' && order.indexOf(x.n) > order.indexOf(el));
      if (at < 0) c.push(tree); else c.splice(at, 0, tree);
    }
    return { ...m, c };
  });
  state.masterStyles = { ...state.masterStyles, c: masters };
  pruneAutos(state, generated);
}

/** Keeps paragraph/text automatic styles in styles.xml only while something refers to them. */
export function pruneAutos(state, add = []) {
  const all = [...(state.stylesAutoStyles?.c || []), ...add];
  const isPT = (t) => typeof t !== 'string' && t.n === 'style:style' && (t.a['style:family'] === 'paragraph' || t.a['style:family'] === 'text');
  const used = refs(treeToXml(state.masterStyles || { n: 'x', a: {} }) + all.filter((t) => !isPT(t)).map((t) => (typeof t === 'string' ? '' : treeToXml(t))).join(''));
  // Styles referred to by kept styles (parents) stay too.
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of all) if (isPT(t) && used.has(t.a['style:name'])) for (const r of refs(treeToXml(t))) if (!used.has(r)) { used.add(r); grew = true; }
  }
  state.stylesAutoStyles = { ...(state.stylesAutoStyles || { n: 'office:automatic-styles', a: {} }), c: all.filter((t) => !isPT(t) || used.has(t.a['style:name'])) };
}

/** Removes a header/footer variant (or with kind null the whole part, all variants). */
export function removePart(state, masterName, part, kind = null) {
  const names = kind ? [partElement(part, kind)] : [`style:${part}`, `style:${part}-left`, `style:${part}-first`];
  state.masterStyles = {
    ...state.masterStyles,
    c: (state.masterStyles?.c || []).map((m) => (typeof m === 'string' || m.n !== 'style:master-page' || m.a['style:name'] !== masterName ? m : { ...m, c: (m.c || []).filter((x) => typeof x === 'string' || !names.includes(x.n)) })),
  };
  pruneAutos(state);
}
