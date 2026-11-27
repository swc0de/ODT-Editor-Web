/**
 * PDF and XPS from the laid-out document (M16): picks the pages, switches
 * the markup display for "Document" / "Document showing markup", builds the
 * shared page model (display-list.js) and hands it to the writer.
 *
 * exportFixed(env, 'pdf' | 'xps', options) → { bytes, substitutions: [[requested, used]] }
 *   env = { docArea, view (main editor view), store, refreshView, pictureLookup(src), meta, producer, currentPage }
 *   options = { range: 'all' | 'current' | 'selection' | 'pages', from, to, markup: boolean,
 *               bookmarks, properties, tagged, pdfa, minimumSize }
 */
import { loadChunk } from '../chunk-loader.js';
import { FontBook } from './fonts.js';
import { ImageBook } from './images.js';
import { buildPages } from './display-list.js';
import { writePdf, structTagOf } from './pdf.js';
import { writeXps } from './xps.js';
import { elementToPng } from '../convert/png.js';

export const fixedLib = () => loadChunk('odt-fixed', 'The PDF and XPS writers are not included in this build.');

const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

/** Indexes of the pages to write. */
export function pageSelection(total, o, { current = 1, selectionPages = null } = {}) {
  const all = [...Array(total).keys()];
  if (o.range === 'current') return [Math.min(total, Math.max(1, current)) - 1];
  if (o.range === 'selection' && selectionPages?.length) return selectionPages;
  if (o.range === 'pages') {
    const from = Math.max(1, Math.min(total, Number(o.from) || 1));
    const to = Math.max(from, Math.min(total, Number(o.to) || total));
    return all.slice(from - 1, to);
  }
  return all;
}

export async function exportFixed(env, kind, options = {}) {
  const fk = await fixedLib();
  const da = env.docArea;
  const stack = da.view.stack;
  // Markup: "Document" shows the final text without comments; "showing markup" all markup.
  const before = env.store.get().reviewDisplay;
  const want = options.markup ? (before === 'none' || before === 'original' ? 'all' : before) : 'none';
  const switched = want !== before;
  if (switched) { env.store.set({ reviewDisplay: want }); env.refreshView?.(); await frame(); }
  // A fresh layout: the pages written are the pages the screen shows from then on.
  da.relayout?.();
  await frame();
  await new Promise((r) => setTimeout(r, 50));
  // Screen-only aids (field shading…) aren't part of the page.
  stack.classList.add('png-export');
  try {
    const total = da.pages.length;
    // The pages the selection is on.
    let selectionPages = null;
    if (options.range === 'selection') {
      const sel = env.view.state.selection;
      const ys = [sel.from, sel.to].map((p) => { try { return env.view.coordsAtPos(p).top; } catch { return null; } }).filter((y) => y != null);
      const hit = [];
      for (let i = 0; i < total; i++) { const r = da.view.pageElement(i)?.getBoundingClientRect(); if (r && ys.length && r.bottom >= Math.min(...ys) && r.top <= Math.max(...ys)) hit.push(i); }
      selectionPages = hit;
    }
    const indexes = pageSelection(total, options, { current: env.currentPage, selectionPages });
    const pageEls = indexes.map((i) => da.view.pageElement(i)).filter(Boolean);
    const fonts = new FontBook(fk);
    await fonts.useLocalFonts();
    if (fonts.local.size) {
      const fams = new Set();
      for (const el of stack.querySelectorAll('*')) { fams.add(getComputedStyle(el).fontFamily.split(',')[0].replace(/["']/g, '').trim()); if (fams.size > 50) break; }
      await fonts.preloadLocal(fams);
    }
    const images = new ImageBook(env.pictureLookup);
    // Structure (tagged PDF): one node per heading, paragraph, list, item, table, row, cell and figure.
    const nodes = new Map();
    const structFor = (el) => {
      if (!(options.tagged || options.pdfa) || kind !== 'pdf') return null;
      if (nodes.has(el)) return nodes.get(el);
      const tag = el.closest('.pg-header, .pg-footer') ? null : structTagOf(el);
      let node = null;
      if (tag) {
        let parent = null;
        for (let a = el.parentElement; a && a !== stack; a = a.parentElement) { const n = structFor(a); if (n) { parent = n; break; } }
        node = { tag, parent, alt: el.localName === 'img' ? el.getAttribute('alt') || '' : undefined };
      }
      nodes.set(el, node);
      return node;
    };
    const t0 = performance.now();
    const pages = await buildPages({
      stack, pages: pageEls, fonts, imageOf: (el) => images.imageOf(el), imageHref: (h) => images.imageHref(h), structFor, markup: !!options.markup,
      addPng: (bytes, w, h) => images.addPng(bytes, w, h),
      rasterise: async (el, scale) => { const p = await elementToPng(el, { scale }); return images.addPng(p.bytes, p.width, p.height); },
    });
    await images.finish();
    // Internal links (#bookmark, headings, notes): the page and height of their target.
    const pageBoxes = pageEls.map((el) => el.getBoundingClientRect());
    const sc = pageBoxes[0] ? pageBoxes[0].width / (pageEls[0].offsetWidth || 1) : 1;
    const resolveDest = (href) => {
      const name = decodeURIComponent(href.slice(1)).replace(/\|outline$/, '');
      let target = null;
      for (const a of stack.querySelectorAll('.odt-anchor')) { if ((a.getAttribute('data-bookmark') || '').includes(`"name":${JSON.stringify(name)}`)) { target = a; break; } }
      if (!target) target = [...stack.querySelectorAll('.page-flow h1, .page-flow h2, .page-flow h3, .page-flow h4, .page-flow h5, .page-flow h6')].find((h) => h.textContent.trim() === name) || null;
      if (!target) return null;
      const r = target.getBoundingClientRect();
      const i = pageBoxes.findIndex((b) => r.top >= b.top - 1 && r.top <= b.bottom);
      return i < 0 ? null : { page: i, y: (r.top - pageBoxes[i].top) / sc };
    };
    const common = { fonts, images, meta: env.meta, producer: env.producer, resolveDest };
    const bytes = kind === 'pdf' ? await writePdf(pages, { ...common, ...options }) : await writeXps(pages, { ...common, ...options });
    return { bytes, substitutions: [...fonts.substitutions], pages: pages.length, ms: performance.now() - t0 };
  } finally {
    stack.classList.remove('png-export');
    if (switched) { env.store.set({ reviewDisplay: before }); env.refreshView?.(); }
  }
}
