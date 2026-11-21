/**
 * Page geometry from the document's master pages and page layouts, and the
 * header/footer content of each master page rendered (read-only until M5)
 * as DOM templates that are cloned onto every page.
 *
 * All lengths are CSS px at 96 dpi (unzoomed).
 */
import { DOMSerializer } from 'prosemirror-model';
import { schema } from '../core/schema.js';
import { toPx } from './units.js';
import { findChild, findChildren, treeToXml, parseXml, createNsContext } from '../core/odt/xml.js';
import { nsDeclarations } from '../core/odt/xml.js';
import { ROOT_PREFIXES } from '../core/odt/namespaces.js';
import { createConverter } from '../core/odt/import.js';
import { sizeTabs, tabStopsOf, defaultTabInterval } from './tabs.js';

const px = (v, d = 0) => (v == null ? d : toPx(v) || d);

/** Page layout properties of a master page (falls back to A4 / 2 cm). */
function layoutOf(state, master) {
  const name = master?.a['style:page-layout-name'];
  const layout = (state.stylesAutoStyles?.c || []).find((t) => t.n === 'style:page-layout' && t.a['style:name'] === name);
  const p = layout ? findChild(layout, 'style:page-layout-properties')?.a || {} : {};
  const hs = layout && findChild(layout, 'style:header-style');
  const fs = layout && findChild(layout, 'style:footer-style');
  const hp = hs ? findChild(hs, 'style:header-footer-properties')?.a || {} : {};
  const fp = fs ? findChild(fs, 'style:header-footer-properties')?.a || {} : {};
  return { layout, p, hp, fp };
}

/** Is a header child a watermark (a fontwork shape or picture named like LibreOffice's)? */
export const isWatermark = (t) => typeof t !== 'string' && /^(draw:custom-shape|draw:frame)$/.test(t.n) && /^PowerPlusWaterMarkObject/.test(t.a?.['draw:name'] || '');

/** Watermark shapes inside a header part's paragraphs. */
function findWatermark(tree) {
  for (const p of tree?.c || []) {
    if (typeof p === 'string') continue;
    for (const c of p.c || []) if (isWatermark(c)) return c;
  }
  return null;
}

/** Header content without the watermark shapes. */
function withoutWatermark(tree) {
  return {
    ...tree,
    c: (tree.c || []).map((p) => (typeof p === 'string' ? p : { ...p, c: (p.c || []).filter((c) => !isWatermark(c)) })),
  };
}

/** Watermark description for rendering: { kind:'text', text, colour, opacity, font, angle } or { kind:'image', href, opacity }. */
function watermarkInfo(shape, state) {
  if (!shape) return null;
  const gs = (state.stylesAutoStyles?.c || []).find((t) => t.n === 'style:style' && t.a['style:family'] === 'graphic' && t.a['style:name'] === shape.a['draw:style-name']);
  const gp = gs ? findChild(gs, 'style:graphic-properties')?.a || {} : {};
  const op = gp['draw:image-opacity'] || gp['draw:opacity'];
  const opacity = op ? parseFloat(op) / 100 : 0.5;
  const m = /rotate\s*\(\s*(-?[\d.]+)\s*\)/.exec(shape.a['draw:transform'] || '');
  const angle = m ? -Number(m[1]) * 180 / Math.PI : 0;
  if (shape.n === 'draw:frame') {
    const img = findChild(shape, 'draw:image');
    return { kind: 'image', href: img?.a?.['xlink:href'] || '', opacity, angle, width: px(shape.a['svg:width'], 300), height: px(shape.a['svg:height'], 300) };
  }
  const text = (shape.c || []).filter((c) => typeof c !== 'string' && c.n === 'text:p').map((c) => (c.c || []).filter((x) => typeof x === 'string').join('')).join(' ');
  const ts = (state.stylesAutoStyles?.c || []).find((t) => t.n === 'style:style' && t.a['style:name'] === shape.a['draw:text-style-name']);
  const font = ts ? findChild(ts, 'style:text-properties')?.a?.['style:font-name'] : null;
  return {
    kind: 'text', text, colour: gp['draw:fill-color'] || '#c0c0c0', opacity, angle, font,
    width: px(shape.a['svg:width'], 600), height: px(shape.a['svg:height'], 150),
  };
}

/** Renders header/footer XML trees into DOM with the document's styles. */
function renderPart(tree, converter, nsExtra) {
  if (!tree || tree.a?.['style:display'] === 'false') return null;
  tree = withoutWatermark(tree);
  const xml = `<root${nsDeclarations(ROOT_PREFIXES, nsExtra)}>${(tree.c || []).map((c) => (typeof c === 'string' ? '' : treeToXml(c))).join('')}</root>`;
  const el = parseXml(xml).documentElement;
  const blocks = converter.blocks(el);
  if (!blocks.length) return null;
  const doc = schema.nodeFromJSON({ type: 'doc', content: blocks });
  const frag = DOMSerializer.fromSchema(schema).serializeFragment(doc.content);
  const wrap = document.createElement('div');
  wrap.className = 'odt-doc pg-hf-content';
  const inner = document.createElement('div');
  inner.className = 'ProseMirror';
  inner.append(frag);
  wrap.append(inner);
  // Top-level nodes with their DOM, for sizing tabs (measureMasters).
  wrap.hfBlocks = [];
  doc.forEach((node, _o, i) => { if (node.isTextblock && inner.children[i]) wrap.hfBlocks.push({ node, dom: inner.children[i] }); });
  return wrap;
}

/** Sizes the tabs of a rendered header / footer (while it is laid out). */
function sizePartTabs(wrap, index) {
  const interval = defaultTabInterval(index);
  for (const { node, dom } of wrap.hfBlocks || []) {
    let hasTab = false;
    node.forEach((c) => { if (c.type.name === 'tab') hasTab = true; });
    if (hasTab) sizeTabs(dom, tabStopsOf(node, index), interval, 1, index?.compat?.tabsRelativeToIndent !== false);
  }
}

/**
 * Builds the page model.
 * @returns {{ masters: Map<string, Master>, first: Master, width, marginLeft, marginRight }}
 *   Master = { name, height, marginTop, marginBottom, background, header: {first,left,right}, footer: {...}, headerProps, footerProps }
 */
export function buildPageModel(state, styleIndex) {
  const masterTrees = findChildren(state.masterStyles || { c: [] }, 'style:master-page');
  const autoIndex = new Map();
  for (const t of state.stylesAutoStyles?.c || []) if (t.n === 'style:style') autoIndex.set(`${t.a['style:family']}:${t.a['style:name']}`, t);
  const converter = createConverter({ ns: createNsContext(), autoIndex, styleIndex });
  const masters = new Map();
  for (const m of masterTrees) {
    const { layout, p, hp, fp } = layoutOf(state, m);
    const part = (name) => renderPart(findChild(m, name), converter, state.nsExtra);
    const header = { right: part('style:header'), left: part('style:header-left'), first: part('style:header-first') };
    const footer = { right: part('style:footer'), left: part('style:footer-left'), first: part('style:footer-first') };
    const cols = layout && findChild(findChild(layout, 'style:page-layout-properties') || {}, 'style:columns');
    const wm = findWatermark(findChild(m, 'style:header')) || findWatermark(findChild(m, 'style:header-first')) || findWatermark(findChild(m, 'style:header-left'));
    const border = {};
    for (const k of ['fo:border', 'fo:border-top', 'fo:border-bottom', 'fo:border-left', 'fo:border-right', 'fo:padding', 'fo:padding-top', 'fo:padding-bottom', 'fo:padding-left', 'fo:padding-right', 'style:shadow']) if (p[k]) border[k] = p[k];
    masters.set(m.a['style:name'], {
      name: m.a['style:name'],
      displayName: m.a['style:display-name'] || m.a['style:name'],
      layoutName: m.a['style:page-layout-name'] || null,
      next: m.a['style:next-style-name'] || null,
      usage: layout?.a?.['style:page-usage'] || 'all',
      numFormat: p['style:num-format'] ?? '1',
      columns: cols ? { count: Number(cols.a['fo:column-count'] || 1), gap: px(cols.a['fo:column-gap'], 0) } : { count: 1, gap: 0 },
      writingMode: p['style:writing-mode'] || 'lr-tb',
      border: Object.keys(border).length ? border : null,
      watermark: watermarkInfo(wm, state),
      width: px(p['fo:page-width'], 793.7),
      height: px(p['fo:page-height'], 1122.5),
      marginTop: px(p['fo:margin-top'], 75.6),
      marginBottom: px(p['fo:margin-bottom'], 75.6),
      marginLeft: px(p['fo:margin-left'], 75.6),
      marginRight: px(p['fo:margin-right'], 75.6),
      background: p['fo:background-color'] && p['fo:background-color'] !== 'transparent' ? p['fo:background-color'] : null,
      header, footer,
      headerMin: px(hp['fo:min-height'] ?? hp['svg:height'], 0), headerGap: px(hp['fo:margin-bottom'], 0),
      footerMin: px(fp['fo:min-height'] ?? fp['svg:height'], 0), footerGap: px(fp['fo:margin-top'], 0),
      // Filled in by measureMasters().
      headerH: { right: 0, left: 0, first: 0 }, footerH: { right: 0, left: 0, first: 0 },
    });
  }
  if (!masters.size) {
    masters.set('Standard', {
      name: 'Standard', width: 793.7, height: 1122.5, marginTop: 96, marginBottom: 96, marginLeft: 96, marginRight: 96,
      background: null, header: {}, footer: {}, headerMin: 0, headerGap: 0, footerMin: 0, footerGap: 0,
      displayName: 'Standard', layoutName: null, next: null, usage: 'all', numFormat: '1', columns: { count: 1, gap: 0 }, writingMode: 'lr-tb', border: null, watermark: null,
      headerH: { right: 0, left: 0, first: 0 }, footerH: { right: 0, left: 0, first: 0 },
    });
  }
  const first = masters.get('Standard') || masters.values().next().value;
  for (const m of masters.values()) {
    m.bodyWidth = m.width - m.marginLeft - m.marginRight;
  }
  // The page stack is as wide as the widest page; narrower pages are centred.
  const width = Math.max(...[...masters.values()].map((m) => m.width));
  for (const m of masters.values()) m.x = (width - m.width) / 2;
  const ln = findChild(state.commonStyles || { c: [] }, 'text:linenumbering-configuration');
  const lineNumbering = ln && ln.a['text:number-lines'] !== 'false' ? {
    increment: Number(ln.a['text:increment'] || 1), restartOnPage: ln.a['text:restart-on-page'] === 'true',
    offset: px(ln.a['text:offset'], 13), countEmpty: ln.a['text:count-empty-lines'] !== 'false', position: ln.a['text:number-position'] || 'left',
  } : null;
  return { masters, first, width, marginLeft: first.marginLeft, marginRight: first.marginRight, lineNumbering, styleIndex };
}

/** Measures header/footer heights by rendering them off-screen at the body width. */
export function measureMasters(model, host) {
  const probe = document.createElement('div');
  host.append(probe);
  for (const m of model.masters.values()) {
    probe.style.cssText = `position:absolute;visibility:hidden;left:-10000px;top:0;width:${m.bodyWidth}px`;
    for (const kind of ['right', 'left', 'first']) {
      for (const [part, store] of [['header', 'headerH'], ['footer', 'footerH']]) {
        const el = m[part][kind];
        if (!el) { m[store][kind] = 0; continue; }
        // The template itself is laid out here, so its tab widths are kept in the copies on the pages.
        probe.replaceChildren(el);
        sizePartTabs(el, model.styleIndex);
        m[store][kind] = el.getBoundingClientRect().height;
        el.remove();
      }
    }
  }
  probe.remove();
}

/** Which header/footer variant a page uses. */
export function pageKind(master, indexInMaster, pageNumber, part) {
  const variants = master[part];
  if (indexInMaster === 0 && variants.first) return 'first';
  if (pageNumber % 2 === 0 && variants.left) return 'left';
  return variants.right ? 'right' : null;
}

/** Body area of a page: { top, bottom } in page coordinates. */
export function bodyBox(master, indexInMaster, pageNumber, { hideWhiteSpace = false } = {}) {
  const hk = pageKind(master, indexInMaster, pageNumber, 'header');
  const fk = pageKind(master, indexInMaster, pageNumber, 'footer');
  const head = hk ? Math.max(master.headerMin, master.headerH[hk]) + master.headerGap : 0;
  const foot = fk ? Math.max(master.footerMin, master.footerH[fk]) + master.footerGap : 0;
  if (hideWhiteSpace) {
    const h = master.height - master.marginTop - master.marginBottom - head - foot;
    return { top: 0, bottom: h, height: h, pageHeight: h, headerKind: null, footerKind: null };
  }
  const top = master.marginTop + head;
  const bottom = master.height - master.marginBottom - foot;
  return { top, bottom, height: bottom - top, pageHeight: master.height, headerKind: hk, footerKind: fk };
}
