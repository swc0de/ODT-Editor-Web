/**
 * Page setup on the document state (pure helpers; callers record the result
 * with editState so it is undoable):
 *  - page layouts of master pages: size, orientation, margins, columns,
 *    page usage (left/right only), writing mode, background, borders
 *  - new master pages for section breaks (copies of the current one)
 *  - section automatic styles (columns of text:section)
 *  - line numbering configuration and automatic hyphenation
 *
 * Every function replaces the state fields it changes with new objects.
 */
import { findChild } from './odt/xml.js';
import { encodeStyleName } from './style-edit.js';
import { toPx } from '../layout/units.js';

const CM = 96 / 2.54;

const cm = (v) => `${+v.toFixed(3)}cm`;

export const PAGE_SIZES = {
  A4: [21, 29.7], A5: [14.8, 21], A3: [29.7, 42], Letter: [21.59, 27.94], Legal: [21.59, 35.56], B5: [17.6, 25],
};
export const MARGIN_PRESETS = {
  normal: { top: 2.54, bottom: 2.54, left: 2.54, right: 2.54 },
  narrow: { top: 1.27, bottom: 1.27, left: 1.27, right: 1.27 },
  moderate: { top: 2.54, bottom: 2.54, left: 1.91, right: 1.91 },
  wide: { top: 2.54, bottom: 2.54, left: 5.08, right: 5.08 },
  mirrored: { top: 2.54, bottom: 2.54, left: 3.18, right: 2.54, mirrored: true },
};

const masterList = (state) => (state.masterStyles?.c || []).filter((t) => typeof t !== 'string' && t.n === 'style:master-page');
export const findMaster = (state, name) => masterList(state).find((m) => m.a['style:name'] === name) || null;
const layoutList = (state) => (state.stylesAutoStyles?.c || []).filter((t) => typeof t !== 'string' && t.n === 'style:page-layout');
export const findLayout = (state, name) => layoutList(state).find((l) => l.a['style:name'] === name) || null;

/** Page layout properties (attributes) of a master page. */
export function pageProps(state, masterName) {
  const m = findMaster(state, masterName) || masterList(state)[0];
  const l = m && findLayout(state, m.a['style:page-layout-name']);
  const p = l && findChild(l, 'style:page-layout-properties');
  const cols = p && findChild(p, 'style:columns');
  return { ...(p?.a || {}), usage: l?.a['style:page-usage'] || 'all', columns: cols ? Number(cols.a['fo:column-count'] || 1) : 1 };
}

function uniqueName(taken, base) {
  let i = 1;
  while (taken.has(`${base}${i}`)) i++;
  return `${base}${i}`;
}

/**
 * Changes the page layouts of the given master pages. `fn(attrs, layout)`
 * returns { attrs?: {k: v|null}, columns?: {count, gap}|null, usage?: string|null, children?: [tree] }.
 * A layout shared with other master pages is copied first so only the given
 * ones change.
 */
export function updatePageLayouts(state, masterNames, fn) {
  const targets = new Set(masterNames);
  let autos = [...(state.stylesAutoStyles?.c || [])];
  let masters = [...(state.masterStyles?.c || [])];
  const taken = new Set(autos.map((t) => t.a?.['style:name']));
  const done = new Map(); // old layout name → new layout name (for these targets)
  masters = masters.map((m) => {
    if (typeof m === 'string' || m.n !== 'style:master-page' || !targets.has(m.a['style:name'])) return m;
    const ln = m.a['style:page-layout-name'];
    if (done.has(ln)) return done.get(ln) === ln ? m : { ...m, a: { ...m.a, 'style:page-layout-name': done.get(ln) } };
    const shared = masters.some((o) => typeof o !== 'string' && o.n === 'style:master-page' && !targets.has(o.a['style:name']) && o.a['style:page-layout-name'] === ln);
    const old = autos.find((t) => t.n === 'style:page-layout' && t.a['style:name'] === ln);
    const base = old ? structuredClone(old) : { n: 'style:page-layout', a: { 'style:name': ln || 'pm1' }, c: [{ n: 'style:page-layout-properties', a: {} }, { n: 'style:header-style', a: {} }, { n: 'style:footer-style', a: {} }] };
    let name = base.a['style:name'];
    if (shared || !old) { name = uniqueName(taken, 'pm'); taken.add(name); base.a['style:name'] = name; }
    const users = masters.filter((o) => typeof o !== 'string' && o.n === 'style:master-page' && targets.has(o.a['style:name']) && o.a['style:page-layout-name'] === ln);
    applyLayoutChange(base, fn, users);
    if (old && !shared) autos = autos.map((t) => (t === old ? base : t));
    else autos.push(base);
    done.set(ln, name);
    return name === ln ? m : { ...m, a: { ...m.a, 'style:page-layout-name': name } };
  });
  state.stylesAutoStyles = { ...(state.stylesAutoStyles || { n: 'office:automatic-styles', a: {} }), c: autos };
  state.masterStyles = { ...(state.masterStyles || { n: 'office:master-styles', a: {} }), c: masters };
}

function applyLayoutChange(layout, fn, users = []) {
  layout.c = layout.c || [];
  let p = layout.c.find((c) => typeof c !== 'string' && c.n === 'style:page-layout-properties');
  if (!p) { p = { n: 'style:page-layout-properties', a: {} }; layout.c.unshift(p); }
  const change = fn(p.a, layout, users) || {};
  for (const part of ['header', 'footer']) {
    if (!change[part]) continue;
    let st = layout.c.find((c) => typeof c !== 'string' && c.n === `style:${part}-style`);
    if (!st) { st = { n: `style:${part}-style`, a: {} }; layout.c.push(st); }
    st.c = st.c || [];
    let hp = st.c.find((c) => typeof c !== 'string' && c.n === 'style:header-footer-properties');
    if (!hp) { hp = { n: 'style:header-footer-properties', a: {} }; st.c.push(hp); }
    for (const [k, v] of Object.entries(change[part])) { if (v == null) delete hp.a[k]; else hp.a[k] = v; }
  }
  for (const [k, v] of Object.entries(change.attrs || {})) { if (v == null) delete p.a[k]; else p.a[k] = v; }
  if (change.usage !== undefined) { if (!change.usage || change.usage === 'all') delete layout.a['style:page-usage']; else layout.a['style:page-usage'] = change.usage; }
  if (change.columns !== undefined) {
    p.c = (p.c || []).filter((c) => typeof c === 'string' || c.n !== 'style:columns');
    if (change.columns && change.columns.count > 1) p.c.push(columnsTree(change.columns));
    if (!p.c.length) delete p.c;
  }
}

/** A style:columns element: { count, gap (cm), widths?: [relative], separator? }. */
export function columnsTree({ count, gap = 1.25, widths = null, separator = false }) {
  const c = [];
  if (separator) c.push({ n: 'style:column-sep', a: { 'style:width': '0.018cm', 'style:color': '#000000', 'style:height': '100%', 'style:vertical-align': 'top' } });
  if (widths) {
    const total = widths.reduce((a, b) => a + b, 0);
    widths.forEach((w, i) => c.push({
      n: 'style:column',
      a: { 'style:rel-width': `${Math.round((w / total) * 10000)}*`, 'fo:start-indent': cm(i === 0 ? 0 : gap / 2), 'fo:end-indent': cm(i === widths.length - 1 ? 0 : gap / 2) },
    }));
  }
  return { n: 'style:columns', a: { 'fo:column-count': String(count), 'fo:column-gap': cm(gap) }, ...(c.length ? { c } : {}) };
}

/** Columns of a section style tree: { count, gap, separator }. */
export function sectionColumnInfo(tree) {
  const sp = tree && (tree.c || []).find((c) => c.n === 'style:section-properties');
  const cols = sp && (sp.c || []).find((c) => c.n === 'style:columns');
  return { count: Number(cols?.a?.['fo:column-count'] || 1), gap: cols?.a?.['fo:column-gap'] || null, separator: !!(cols?.c || []).some((c) => c.n === 'style:column-sep'), widths: (cols?.c || []).filter((c) => c.n === 'style:column').map((c) => parseFloat(c.a['style:rel-width'])) };
}

/**
 * Adds (or replaces, if `name` given) a section automatic style with these
 * columns; returns its name. With `copy` (the style is shared by other
 * sections) a new style is made instead.
 */
export function setSectionStyle(state, name, columns, { copy = false } = {}) {
  const autos = [...state.contentAutoStyles];
  const taken = new Set(autos.map((t) => t.a?.['style:name']));
  const target = name && autos.find((t) => t.n === 'style:style' && t.a['style:family'] === 'section' && t.a['style:name'] === name);
  const newName = target && !copy ? name : uniqueName(taken, 'Sect');
  const props = { n: 'style:section-properties', a: { 'text:dont-balance-text-columns': 'false', 'style:editable': 'false' }, c: [columnsTree(columns)] };
  if (target) {
    const sp = (target.c || []).find((c) => c.n === 'style:section-properties');
    if (sp) props.a = { ...sp.a };
    props.c = [...(sp?.c || []).filter((c) => typeof c === 'string' || c.n !== 'style:columns'), columnsTree(columns)];
  }
  const tree = { n: 'style:style', a: { 'style:name': newName, 'style:family': 'section' }, c: [props] };
  state.contentAutoStyles = newName === name ? autos.map((t) => (t === target ? tree : t)) : [...autos, tree];
  return newName;
}

/**
 * A new master page copied from `fromName` (with its own page layout) for a
 * section break. usage: 'left' / 'right' for even / odd page breaks; such a
 * page style continues with a normal copy (style:next-style-name).
 */
export function newSectionMaster(state, fromName, { usage = null } = {}) {
  const masters = masterList(state);
  const from = findMaster(state, fromName) || masters[0];
  const takenM = new Set(masters.map((m) => m.a['style:name']));
  let n = 2;
  while (takenM.has(encodeStyleName(`Section ${n}`))) n++;
  const make = (label, layoutUsage, next) => {
    const name = encodeStyleName(label);
    takenM.add(name);
    const layoutName = uniqueName(new Set((state.stylesAutoStyles?.c || []).map((t) => t.a?.['style:name'])), 'pm');
    const old = findLayout(state, from?.a['style:page-layout-name']);
    const layout = old ? structuredClone(old) : { n: 'style:page-layout', a: {}, c: [{ n: 'style:page-layout-properties', a: {} }] };
    layout.a = { ...layout.a, 'style:name': layoutName };
    if (layoutUsage) layout.a['style:page-usage'] = layoutUsage; else delete layout.a['style:page-usage'];
    state.stylesAutoStyles = { ...state.stylesAutoStyles, c: [...(state.stylesAutoStyles?.c || []), layout] };
    const m = structuredClone(from || { n: 'style:master-page', a: {} });
    m.a = { ...m.a, 'style:name': name, 'style:display-name': label, 'style:page-layout-name': layoutName };
    if (next) m.a['style:next-style-name'] = next; else delete m.a['style:next-style-name'];
    state.masterStyles = { ...state.masterStyles, c: [...(state.masterStyles?.c || []), m] };
    return name;
  };
  if (!usage) return make(`Section ${n}`, null, null);
  const follow = make(`Section ${n}`, null, null);
  return make(`Section ${n} ${usage === 'left' ? 'Even' : 'Odd'} Start`, usage, follow);
}

// ------------------------------------------------------------ office:styles items

function updateCommon(state, fn) {
  const c = [...(state.commonStyles?.c || [])];
  fn(c);
  state.commonStyles = { ...(state.commonStyles || { n: 'office:styles', a: {} }), c };
}

/** Line numbering configuration: null = off; else { increment, restartOnPage, offset (cm), countEmpty, start }. */
export function lineNumbering(state) {
  const t = findChild(state.commonStyles || { c: [] }, 'text:linenumbering-configuration');
  if (!t || t.a['text:number-lines'] === 'false') return null;
  return { increment: Number(t.a['text:increment'] || 1), restartOnPage: t.a['text:restart-on-page'] === 'true', offset: t.a['text:offset'] || '0.499cm', countEmpty: t.a['text:count-empty-lines'] !== 'false' };
}

export function setLineNumbering(state, cfg) {
  updateCommon(state, (c) => {
    const i = c.findIndex((t) => typeof t !== 'string' && t.n === 'text:linenumbering-configuration');
    const old = i >= 0 ? c[i] : { n: 'text:linenumbering-configuration', a: { 'text:offset': '0.499cm', 'style:num-format': '1', 'text:number-position': 'left', 'text:increment': '5' } };
    const a = { ...old.a, 'text:number-lines': cfg ? 'true' : 'false' };
    if (cfg) {
      a['text:increment'] = String(cfg.increment || 1);
      a['text:restart-on-page'] = cfg.restartOnPage ? 'true' : 'false';
      if (cfg.offset) a['text:offset'] = cfg.offset;
      a['text:count-empty-lines'] = cfg.countEmpty === false ? 'false' : 'true';
      a['style:num-format'] = '1';
      a['text:number-position'] = 'left';
    }
    const tree = { ...old, a };
    if (i >= 0) c[i] = tree; else c.push(tree);
  });
}

/** Automatic hyphenation (the default paragraph style's text properties). */
export function hyphenation(state) {
  const d = (state.commonStyles?.c || []).find((t) => typeof t !== 'string' && t.n === 'style:default-style' && t.a['style:family'] === 'paragraph');
  const tp = d && findChild(d, 'style:text-properties');
  return { on: tp?.a['fo:hyphenate'] === 'true', caps: tp?.a['loext:hyphenation-no-caps'] !== 'true', ladder: tp?.a['fo:hyphenation-ladder-count'] && tp.a['fo:hyphenation-ladder-count'] !== 'no-limit' ? Number(tp.a['fo:hyphenation-ladder-count']) : 0 };
}

export function setHyphenation(state, { on, caps = true, ladder = 0 }) {
  updateCommon(state, (c) => {
    let i = c.findIndex((t) => typeof t !== 'string' && t.n === 'style:default-style' && t.a['style:family'] === 'paragraph');
    if (i < 0) { c.unshift({ n: 'style:default-style', a: { 'style:family': 'paragraph' }, c: [] }); i = 0; }
    const d = structuredClone(c[i]);
    d.c = d.c || [];
    let tp = d.c.find((x) => typeof x !== 'string' && x.n === 'style:text-properties');
    if (!tp) { tp = { n: 'style:text-properties', a: {} }; d.c.push(tp); }
    tp.a['fo:hyphenate'] = on ? 'true' : 'false';
    tp.a['fo:hyphenation-remain-char-count'] = '2';
    tp.a['fo:hyphenation-push-char-count'] = '2';
    tp.a['fo:hyphenation-ladder-count'] = ladder ? String(ladder) : 'no-limit';
    if (caps) delete tp.a['loext:hyphenation-no-caps']; else tp.a['loext:hyphenation-no-caps'] = 'true';
    c[i] = d;
  });
}

/** Header/footer extent from a layout: { headerMin, headerGap, footerMin, footerGap } in cm. */
export function hfExtent(layout) {
  const get = (part) => {
    const st = (layout?.c || []).find((c) => typeof c !== 'string' && c.n === `style:${part}-style`);
    const hp = st && (st.c || []).find((c) => typeof c !== 'string' && c.n === 'style:header-footer-properties');
    const a = hp?.a || {};
    return { min: (toPx(a['fo:min-height'] || a['svg:height'] || '0cm') || 0) / CM, gap: (toPx(a[part === 'header' ? 'fo:margin-bottom' : 'fo:margin-top'] || '0cm') || 0) / CM };
  };
  const hh = get('header');
  const ff = get('footer');
  return { headerMin: hh.min, headerGap: hh.gap, footerMin: ff.min, footerGap: ff.gap };
}

/** Does a master page show a header / footer? */
export const hasPart = (master, part) => !!(master?.c || []).some((c) => typeof c !== 'string' && (c.n === `style:${part}` || c.n === `style:${part}-left` || c.n === `style:${part}-first`) && c.a?.['style:display'] !== 'false');

/**
 * Word-style margins (distance to the body) → ODF page margins, which in ODF
 * are measured to the header / footer when there is one.
 */
export function bodyMargins(layout, users, { top, bottom }) {
  const e = hfExtent(layout);
  const header = users.some((m) => hasPart(m, 'header'));
  const footer = users.some((m) => hasPart(m, 'footer'));
  const out = {};
  if (top != null) out['fo:margin-top'] = cm(Math.max(0, header ? top - e.headerMin - e.headerGap : top));
  if (bottom != null) out['fo:margin-bottom'] = cm(Math.max(0, footer ? bottom - e.footerMin - e.footerGap : bottom));
  return out;
}

/** Header/footer options of a master page: { firstPage, oddEven }. */
export function partOptions(master) {
  const has = (n) => (master?.c || []).some((c) => typeof c !== 'string' && c.n === n);
  return { firstPage: has('style:header-first') || has('style:footer-first'), oddEven: has('style:header-left') || has('style:footer-left') };
}

const emptyPart = (n, part) => ({ n, a: {}, c: [{ n: 'text:p', a: { 'text:style-name': part === 'header' ? 'Header' : 'Footer' } }] });

/** Turns "Different First Page" / "Different Odd & Even Pages" on or off for master pages. */
export function setPartOptions(state, masterNames, { firstPage, oddEven }) {
  const targets = new Set(masterNames);
  state.masterStyles = {
    ...state.masterStyles,
    c: (state.masterStyles?.c || []).map((m) => {
      if (typeof m === 'string' || m.n !== 'style:master-page' || !targets.has(m.a['style:name'])) return m;
      let c = [...(m.c || [])];
      for (const part of ['header', 'footer']) {
        if (!c.some((x) => typeof x !== 'string' && x.n === `style:${part}`)) continue;
        for (const [variant, on] of [['first', firstPage], ['left', oddEven]]) {
          if (on === undefined) continue;
          const n = `style:${part}-${variant}`;
          const has = c.some((x) => typeof x !== 'string' && x.n === n);
          if (on && !has) {
            // Keep ODF element order: header, header-left, header-first, footer, footer-left, footer-first.
            const after = c.findIndex((x) => typeof x !== 'string' && x.n === (variant === 'first' && c.some((y) => y.n === `style:${part}-left`) ? `style:${part}-left` : `style:${part}`));
            c.splice(after + 1, 0, emptyPart(n, part));
          }
          if (!on && has) c = c.filter((x) => typeof x === 'string' || x.n !== n);
        }
      }
      return { ...m, c };
    }),
  };
}
