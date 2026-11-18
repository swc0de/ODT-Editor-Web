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

/** Renders header/footer XML trees into DOM with the document's styles. */
function renderPart(tree, converter, nsExtra) {
  if (!tree || tree.a?.['style:display'] === 'false') return null;
  const xml = `<root${nsDeclarations(ROOT_PREFIXES, nsExtra)}>${(tree.c || []).map((c) => (typeof c === 'string' ? '' : treeToXml(c))).join('')}</root>`;
  const el = parseXml(xml).documentElement;
  const blocks = converter.blocks(el);
  if (!blocks.length) return null;
  const frag = DOMSerializer.fromSchema(schema).serializeFragment(schema.nodeFromJSON({ type: 'doc', content: blocks }).content);
  const wrap = document.createElement('div');
  wrap.className = 'odt-doc pg-hf-content';
  const inner = document.createElement('div');
  inner.className = 'ProseMirror';
  inner.append(frag);
  wrap.append(inner);
  return wrap;
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
    const { p, hp, fp } = layoutOf(state, m);
    const part = (name) => renderPart(findChild(m, name), converter, state.nsExtra);
    const header = { right: part('style:header'), left: part('style:header-left'), first: part('style:header-first') };
    const footer = { right: part('style:footer'), left: part('style:footer-left'), first: part('style:footer-first') };
    masters.set(m.a['style:name'], {
      name: m.a['style:name'],
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
      headerH: { right: 0, left: 0, first: 0 }, footerH: { right: 0, left: 0, first: 0 },
    });
  }
  const first = masters.get('Standard') || masters.values().next().value;
  return { masters, first, width: first.width, marginLeft: first.marginLeft, marginRight: first.marginRight };
}

/** Measures header/footer heights by rendering them off-screen at the body width. */
export function measureMasters(model, host) {
  const probe = document.createElement('div');
  probe.style.cssText = `position:absolute;visibility:hidden;left:-10000px;top:0;width:${model.width - model.marginLeft - model.marginRight}px`;
  host.append(probe);
  for (const m of model.masters.values()) {
    for (const kind of ['right', 'left', 'first']) {
      for (const [part, store] of [['header', 'headerH'], ['footer', 'footerH']]) {
        const el = m[part][kind];
        if (!el) { m[store][kind] = 0; continue; }
        probe.replaceChildren(el.cloneNode(true));
        m[store][kind] = probe.firstChild.getBoundingClientRect().height;
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
