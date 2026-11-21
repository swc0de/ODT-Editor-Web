/**
 * Styles model helpers.
 *  - Automatic styles ↔ the `auto` objects stored on nodes and marks.
 *  - A StyleIndex over the document's common styles, resolving inheritance
 *    (default style → parents → style) for rendering.
 *  - Document CSS generation (named paragraph/character/list/table styles).
 */
import { findChild, findChildren, treeText } from './xml.js';
import { textPropsCss, paragraphPropsCss, cellPropsCss, tablePropsCss, sectionPropsCss, fontAliasCss } from './css.js';
import { getConfigItem } from '../doc-settings.js';
import { toPx } from '../../layout/units.js';
import { cssName } from '../schema.js';

const STYLE_IDENTITY = new Set(['style:name', 'style:family', 'style:parent-style-name', 'style:display-name']);

/** Canonical order of *-properties elements inside a style (as LibreOffice writes them). */
const PROPS_ORDER = ['style:graphic-properties', 'loext:graphic-properties', 'style:paragraph-properties', 'style:text-properties', 'style:ruby-properties', 'style:section-properties', 'style:table-properties', 'style:table-column-properties', 'style:table-row-properties', 'style:table-cell-properties', 'style:chart-properties', 'style:drawing-page-properties'];
const propsRank = (k) => { const i = PROPS_ORDER.indexOf(k); return i < 0 ? 100 : i; };
export const sortProps = (keys) => keys.sort((x, y) => propsRank(x) - propsRank(y) || (x < y ? -1 : x > y ? 1 : 0));

/** style:style tree → { parent, auto: {styleAttrs, props} | null } */
export function autoFromTree(tree) {
  const styleAttrs = {};
  for (const [k, v] of Object.entries(tree.a || {})) if (!STYLE_IDENTITY.has(k)) styleAttrs[k] = v;
  const found = {};
  const other = [];
  for (const c of tree.c || []) {
    if (typeof c === 'string') continue;
    if (c.n.endsWith('-properties')) found[c.n] = c.c ? { a: { ...c.a }, c: c.c } : { a: { ...c.a } };
    else other.push(c);
  }
  const props = {};
  for (const k of sortProps(Object.keys(found))) props[k] = found[k];
  if (other.length) props['#other'] = other;
  const auto = Object.keys(styleAttrs).length || Object.keys(props).length ? { styleAttrs, props } : null;
  return { parent: tree.a?.['style:parent-style-name'] || null, auto };
}

/** auto → style:style tree. */
export function treeFromAuto(name, family, parent, auto) {
  const a = { 'style:name': name, 'style:family': family };
  if (parent) a['style:parent-style-name'] = parent;
  Object.assign(a, auto?.styleAttrs || {});
  const c = [];
  const keys = sortProps(Object.keys(auto?.props || {}).filter((k) => k !== '#other'));
  for (const k of keys) {
    const p = auto.props[k];
    const t = { n: k, a: { ...p.a } };
    if (p.c?.length) t.c = p.c;
    c.push(t);
  }
  for (const o of auto?.props?.['#other'] || []) c.push(o);
  const tree = { n: 'style:style', a };
  if (c.length) tree.c = c;
  return tree;
}

/** Deterministic JSON (sorted keys) for de-duplication and comparisons. */
export function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

/** Merges two auto objects (b wins per attribute). */
export function mergeAuto(a, b) {
  if (!a) return b ? structuredClone(b) : null;
  if (!b) return structuredClone(a);
  const out = { styleAttrs: { ...a.styleAttrs, ...b.styleAttrs }, props: {} };
  for (const k of sortProps([...new Set([...Object.keys(a.props || {}), ...Object.keys(b.props || {})])])) {
    if (k === '#other') { out.props[k] = [...(a.props[k] || []), ...(b.props[k] || [])]; continue; }
    const pa = a.props?.[k];
    const pb = b.props?.[k];
    out.props[k] = { a: { ...pa?.a, ...pb?.a } };
    const c = pb?.c || pa?.c;
    if (c) out.props[k].c = c;
  }
  return out;
}

// ------------------------------------------------------------------ index

/**
 * Index over common styles (office:styles) and automatic styles.
 * @param {object} state DocumentState
 */
export function buildStyleIndex(state) {
  const families = new Map(); // family → Map(name → tree)
  const defaults = new Map(); // family → tree
  const lists = new Map(); // list style name → tree
  const fontFaces = new Map();
  const add = (tree) => {
    if (typeof tree === 'string') return;
    if (tree.n === 'style:style') {
      const fam = tree.a['style:family'];
      if (!families.has(fam)) families.set(fam, new Map());
      families.get(fam).set(tree.a['style:name'], tree);
    } else if (tree.n === 'style:default-style') defaults.set(tree.a['style:family'], tree);
    else if (tree.n === 'text:list-style') lists.set(tree.a['style:name'], tree);
  };
  (state.commonStyles?.c || []).forEach(add);
  for (const f of state.fontFaces || []) fontFaces.set(f.a['style:name'], f.a['svg:font-family'] || f.a['style:name']);
  const autos = new Map();
  for (const t of state.contentAutoStyles || []) {
    if (t.n === 'text:list-style') lists.set(t.a['style:name'], t);
    else if (t.n === 'style:style') autos.set(`${t.a['style:family']}:${t.a['style:name']}`, t);
  }

  /** Merged properties of a named style including its parents and the default style. */
  function effective(family, name, { includeDefault = true } = {}) {
    const chain = [];
    const seen = new Set();
    let cur = families.get(family)?.get(name);
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      chain.unshift(cur);
      const parent = cur.a['style:parent-style-name'];
      cur = parent ? families.get(family)?.get(parent) : null;
    }
    let auto = includeDefault && defaults.has(family) ? autoFromTree(defaults.get(family)).auto : null;
    for (const t of chain) auto = mergeAuto(auto, autoFromTree(t).auto);
    return auto;
  }

  const displayName = (family, name) => families.get(family)?.get(name)?.a['style:display-name'] || String(name).replace(/_20_/g, ' ');
  // Layout compatibility (settings.xml): Word's rules for documents read from Word.
  const cfg = (name) => getConfigItem(state.settingsXml, name);
  const compat = {
    wordLayout: cfg('ODTEditorWordLayout') === 'true',
    tabsRelativeToIndent: cfg('TabsRelativeToIndent') !== 'false',
    // Spacing between paragraphs adds up (LibreOffice's and Word's default) unless turned off.
    addSpacing: cfg('ParaSpaceMax') !== 'false',
  };
  return { families, defaults, lists, fontFaces, autos, effective, displayName, compat };
}

// ---------------------------------------------------------------- page

/** Page geometry (in ODF length strings) of a master page (default: Standard / first). */
export function pageLayout(state, masterName = 'Standard') {
  const masters = findChildren(state.masterStyles || { c: [] }, 'style:master-page');
  const master = masters.find((m) => m.a['style:name'] === masterName) || masters[0];
  const layoutName = master?.a['style:page-layout-name'];
  const layout = (state.stylesAutoStyles?.c || []).find((t) => t.n === 'style:page-layout' && t.a['style:name'] === layoutName);
  const p = layout ? findChild(layout, 'style:page-layout-properties')?.a || {} : {};
  return {
    width: p['fo:page-width'] || '21cm', height: p['fo:page-height'] || '29.7cm',
    marginTop: p['fo:margin-top'] || '2cm', marginBottom: p['fo:margin-bottom'] || '2cm',
    marginLeft: p['fo:margin-left'] || '2cm', marginRight: p['fo:margin-right'] || '2cm',
    background: p['fo:background-color'] && p['fo:background-color'] !== 'transparent' ? p['fo:background-color'] : null,
  };
}

// ---------------------------------------------------------------- CSS

const NUM_FORMAT = { '1': 'decimal', a: 'lower-alpha', A: 'upper-alpha', i: 'lower-roman', I: 'upper-roman' };
const cssString = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

function listLevelCss(levelTree) {
  if (levelTree.n === 'text:list-level-style-bullet') {
    const ch = levelTree.a['text:bullet-char'] || '•';
    return `content:${cssString(`${ch} `)}`;
  }
  if (levelTree.n === 'text:list-level-style-number') {
    const fmt = levelTree.a['style:num-format'];
    if (!fmt) return 'content:""';
    const type = NUM_FORMAT[fmt] || 'decimal';
    const pre = levelTree.a['style:num-prefix'] || '';
    const suf = levelTree.a['style:num-suffix'] || '';
    return `content:${cssString(pre)} counter(list-item, ${type}) ${cssString(`${suf} `)}`;
  }
  return 'content:""';
}

/** Is level 1 of a list style numbered? */
export function listIsOrdered(index, name) {
  const t = index.lists.get(name);
  const l1 = (t?.c || []).find((c) => typeof c !== 'string' && c.a?.['text:level'] === '1');
  return l1?.n === 'text:list-level-style-number' && !!l1.a['style:num-format'];
}

/** CSS rules for the document's styles, scoped to `.odt-doc`. */
export function buildDocumentCss(state, index = buildStyleIndex(state)) {
  const rules = [];
  const scope = '.odt-doc';
  const defPara = index.defaults.has('paragraph') ? autoFromTree(index.defaults.get('paragraph')).auto : null;
  const base = [];
  const defText = defPara?.props?.['style:text-properties']?.a || {};
  textPropsCss(defText, base);
  // Automatic text on a dark background is white; an explicit default colour stays.
  base.push(`--odt-dark-ink:${defText['fo:color'] && defText['style:use-window-font-color'] !== 'true' ? defText['fo:color'] : '#fff'}`);
  // Single-weight families ("Calibri Light") through their alias faces.
  const fonts = [...index.fontFaces.keys(), ...(state.fontFaces || []).map((f) => f.a?.['style:name'])].filter(Boolean);
  const alias = fontAliasCss(fonts);
  if (alias) rules.push(alias);
  rules.push(`${scope} :is(.ProseMirror, .odt-mirror){${base.join(';')}}`);
  // The default paragraph style's paragraph properties (spacing, alignment,
  // line height…) apply to every paragraph; named styles override them (D4).
  const defPP = [];
  paragraphPropsCss(defPara?.props?.['style:paragraph-properties']?.a, defPP);
  if (defPP.length) rules.push(`${scope} :is(.ProseMirror, .odt-mirror) :where(p, h1, h2, h3, h4, h5, h6){${defPP.join(';')}}`);

  for (const [name] of index.families.get('paragraph') || []) {
    const auto = index.effective('paragraph', name, { includeDefault: false });
    const decls = [];
    paragraphPropsCss(auto?.props?.['style:paragraph-properties']?.a, decls);
    textPropsCss(auto?.props?.['style:text-properties']?.a, decls);
    if (decls.length) rules.push(`${scope} .ps-${cssName(name)}{${decls.join(';')}}`);
  }
  for (const [name] of index.families.get('text') || []) {
    const auto = index.effective('text', name, { includeDefault: false });
    const decls = textPropsCss(auto?.props?.['style:text-properties']?.a);
    if (decls.length) rules.push(`${scope} .cs-${cssName(name)}{${decls.join(';')}}`);
  }
  // Automatic table / cell / section styles (kept verbatim in the model).
  for (const [key, t] of index.autos) {
    const [family, name] = key.split(/:(.*)/s);
    const props = autoFromTree(t).auto?.props || {};
    let decls = [];
    let cls = null;
    if (family === 'table') { cls = `ts-${cssName(name)}`; decls = tablePropsCss(props['style:table-properties']?.a); }
    else if (family === 'table-cell') { cls = `tc-${cssName(name)}`; decls = cellPropsCss(props['style:table-cell-properties']?.a); textPropsCss(props['style:text-properties']?.a, decls); }
    else if (family === 'section') { cls = `ss-${cssName(name)}`; decls = sectionPropsCss(props['style:section-properties']?.a, props['style:section-properties']?.c); }
    if (cls && decls.length) rules.push(`${scope} .${cls}{${decls.join(';')}}`);
  }
  // List levels: markers (where no label widget is drawn) and the text
  // position of each level. ODF's level indents are measured from the
  // container, CSS padding of nested lists adds up: each level gets the
  // difference to the level above.
  for (const [name, t] of index.lists) {
    const cls = `ls-${cssName(name)}`;
    let prev = 0;
    for (const lvl of (t.c || []).filter((c) => typeof c !== 'string' && c.a?.['text:level']).sort((a, b) => Number(a.a['text:level']) - Number(b.a['text:level']))) {
      const n = Number(lvl.a['text:level']);
      if (n > 10) continue;
      const path = `.${cls}${' > li > :is(ul,ol)'.repeat(n - 1)}`;
      rules.push(`${scope} ${path} > li::marker{${listLevelCss(lvl)}}`);
      const g = listLevelGeometry(lvl);
      if (g) {
        rules.push(`${scope} ${path}{padding-left:${+(g.margin - prev).toFixed(2)}px}`);
        prev = g.margin;
      }
    }
  }
  return rules.join('\n');
}

/**
 * Where a list level puts its label and text (px from the list's container):
 * { margin: text position, indent: label offset from it (≤ 0), tab: tab
 * stop after the label or null, follow: 'listtab' | 'space' | 'nothing',
 * align: label alignment }. ODF's label-alignment mode (the one Word and
 * current LibreOffice use) and the older label-width-and-position mode.
 */
export function listLevelGeometry(lvl) {
  const lp = lvl && findChild(lvl, 'style:list-level-properties');
  if (!lp) return null;
  const align = lp.a['fo:text-align'] || 'start';
  const lab = findChild(lp, 'style:list-level-label-alignment');
  if (lp.a['text:list-level-position-and-space-mode'] === 'label-alignment' && lab) {
    const margin = toPx(lab.a['fo:margin-left'] || '0cm') || 0;
    const indent = toPx(lab.a['fo:text-indent'] || '0cm') || 0;
    const follow = lab.a['text:label-followed-by'] || 'listtab';
    const tab = follow === 'listtab' && lab.a['text:list-tab-stop-position'] ? toPx(lab.a['text:list-tab-stop-position']) : null;
    return { margin, indent, tab, follow, align };
  }
  const before = toPx(lp.a['text:space-before'] || '0cm') || 0;
  const width = toPx(lp.a['text:min-label-width'] || '0cm') || 0;
  return { margin: before + width, indent: -width, tab: before + width, follow: 'listtab', align };
}

/** Plain text of a tree (used for opaque content previews). */
export { treeText };
