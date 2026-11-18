/**
 * The document area: the scrolling canvas with the paginated page view, the
 * rulers, zoom (Ctrl+wheel, presets, fit page / page width), page movement
 * (Vertical / Side to Side), gridlines and Hide White Space. It owns the
 * paginator and keeps rulers and the status bar's page numbers in step.
 */
import { h } from '../ui/dom.js';
import { t } from '../i18n/index.js';
import { createPageView } from './page-view.js';
import { createPaginator, paginationPlugin, PAGE_GAP } from './paginator.js';
import { createRulers } from './ruler.js';
import { buildPageModel, measureMasters } from './page-model.js';
import { layoutTabs, tabStopsOf, defaultTabInterval } from './tabs.js';
import { buildStyleIndex, buildDocumentCss } from '../core/odt/styles.js';
import { findChild } from '../core/odt/xml.js';
import { pxToLength } from './units.js';
import { paragraphIndents, setIndents, setTabStops, selectedTextblocks } from '../core/commands/paragraph.js';

export const ZOOM_MIN = 10;
export const ZOOM_MAX = 500;

export function createDocumentArea({ store, getEditor, getSession, onPagesChange }) {
  const docStyle = h('style', { id: 'odt-doc-css' });
  document.head.append(docStyle);
  const view = createPageView();
  const canvas = h('div', { class: 'canvas', 'aria-label': t('region.document'), 'data-region': 'document' }, view.el);
  let styleIndex = null;
  let model = null;
  let paginator = null;
  let pages = [];

  const options = () => {
    const s = store.get();
    return { zoom: s.zoom / 100, hideWhiteSpace: s.hideWhiteSpace && s.pageMovement === 'vertical', enabled: s.pageMovement === 'vertical', gridlines: s.gridlines };
  };

  const rulers = createRulers({
    store,
    guideHost: () => canvas,
    onIndents: (change) => { const ed = getEditor(); setIndents(ed.view.state, ed.view.dispatch, styleIndex, change); ed.focus(); },
    onTabs: (stops) => { const ed = getEditor(); setTabStops(ed.view.state, ed.view.dispatch, styleIndex, stops); ed.focus(); },
    onMargins: (change) => setPageMargins(change),
  });
  const area = h('main', { class: 'doc-area' }, canvas, rulers.hstrip, rulers.vstrip, rulers.corner);

  // ------------------------------------------------------------ rulers

  function currentPageIndex() {
    const ed = getEditor();
    if (!ed || !pages.length) return 0;
    if (store.get().pageMovement === 'side') {
      try {
        const c = ed.view.coordsAtPos(ed.view.state.selection.head);
        const r = view.stack.getBoundingClientRect();
        return Math.max(0, Math.min(pages.length - 1, Math.floor((c.left - r.left) / ((model.width + PAGE_GAP) * options().zoom))));
      } catch { return 0; }
    }
    return paginator.pageAt(ed.view.state.selection.head);
  }

  function syncRulers() {
    const ed = getEditor();
    if (!model || !ed) return;
    const i = currentPageIndex();
    const page = pages[i];
    const el = view.pageElement(i);
    if (!page || !el) return;
    const r = el.getBoundingClientRect();
    const node = selectedTextblocks(ed.view.state)[0]?.node;
    rulers.update({
      left: r.left, top: r.top, scale: options().zoom,
      page: { width: model.width, height: page.box.pageHeight, marginLeft: model.marginLeft, marginRight: model.marginRight, bodyTop: page.box.top, bodyBottom: page.box.bottom },
      indents: node ? paragraphIndents(node, styleIndex) : { left: 0, right: 0, firstLine: 0 },
      tabs: node ? tabStopsOf(node, styleIndex).map((s) => ({ pos: s.pos, type: s.type, char: s.char })) : [],
      interval: defaultTabInterval(styleIndex),
    });
    store.set({ page: i + 1, pageCount: pages.length });
  }

  // ------------------------------------------------------------ layout

  function handleLayout(newPages) {
    if (store.get().pageMovement === 'side') {
      view.leaveSide();
      pages = view.renderSide();
    } else {
      pages = newPages;
      view.renderPages(pages);
    }
    syncRulers();
    onPagesChange?.(pages);
  }

  /** Called once the editor exists. */
  function attach(editor) {
    paginator = createPaginator({
      view: editor.view,
      getModel: () => model,
      getIndex: () => styleIndex,
      getOptions: options,
      origin: () => view.stack,
      beforeMeasure: (from) => layoutTabs(editor.view, styleIndex, options().zoom, from),
      onLayout: handleLayout,
    });
  }

  /** Applies a document's styles and page setup and lays it out from scratch. */
  function applyDocument(state) {
    styleIndex = buildStyleIndex(state);
    docStyle.textContent = buildDocumentCss(state, styleIndex);
    model = buildPageModel(state, styleIndex);
    measureMasters(model, view.bgs);
    view.setModel(model);
    view.setOptions(options());
    paginator?.relayout();
    return styleIndex;
  }

  /** Page margins dragged on a ruler: updates the current page's page layout. */
  function setPageMargins(change) {
    const session = getSession();
    const state = session?.state;
    if (!state || !pages.length) return;
    const masterName = pages[currentPageIndex()].master;
    const master = (state.masterStyles?.c || []).find((m) => m.n === 'style:master-page' && m.a['style:name'] === masterName);
    const layoutName = master?.a['style:page-layout-name'];
    const autos = structuredClone(state.stylesAutoStyles);
    const layout = (autos.c || []).find((x) => x.n === 'style:page-layout' && x.a['style:name'] === layoutName);
    const props = layout && findChild(layout, 'style:page-layout-properties');
    if (!props) return;
    // Top/bottom from the ruler are body edges: convert back to page margins.
    const m = model.masters.get(masterName) || model.first;
    const page = pages[currentPageIndex()];
    const map = {
      left: change.left, right: change.right,
      top: change.top != null ? change.top - (page.box.top - m.marginTop) : undefined,
      bottom: change.bottom != null ? change.bottom - (m.height - page.box.bottom - m.marginBottom) : undefined,
    };
    for (const side of ['left', 'right', 'top', 'bottom']) {
      if (map[side] == null) continue;
      props.a[`fo:margin-${side}`] = pxToLength(Math.max(0, map[side]), 'cm', 3);
    }
    state.stylesAutoStyles = autos;
    session.markDirty();
    applyDocument(state);
  }

  // ------------------------------------------------------------ zoom

  function setZoom(pct, { keepCenter = true } = {}) {
    const z = Math.round(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, pct)));
    const prev = store.get().zoom;
    if (z === prev) return;
    const ratioY = (canvas.scrollTop + canvas.clientHeight / 2) / Math.max(1, canvas.scrollHeight);
    const ratioX = (canvas.scrollLeft + canvas.clientWidth / 2) / Math.max(1, canvas.scrollWidth);
    store.set({ zoom: z });
    view.setOptions(options());
    if (keepCenter) {
      canvas.scrollTop = ratioY * canvas.scrollHeight - canvas.clientHeight / 2;
      canvas.scrollLeft = ratioX * canvas.scrollWidth - canvas.clientWidth / 2;
    }
    requestAnimationFrame(syncRulers);
  }

  const fitWidth = (n = 1) => ((canvas.clientWidth - 48) / (n * (model?.width || 794) + (n - 1) * PAGE_GAP)) * 100;
  const fitPage = () => Math.min(((canvas.clientHeight - 64) / (pages[currentPageIndex()]?.box.pageHeight || model?.first.height || 1123)) * 100, fitWidth());

  canvas.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setZoom(store.get().zoom + (e.deltaY < 0 ? 10 : -10));
  }, { passive: false });

  // Clicking the canvas or a page margin puts the caret in the document, like Word.
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest('.ProseMirror')) return;
    if (!e.target.closest('.canvas')) return;
    e.preventDefault();
    const ed = getEditor();
    const v = ed.view;
    const hit = v.posAtCoords({ left: e.clientX, top: e.clientY });
    const pos = hit ? hit.pos : v.state.doc.content.size;
    ed.focusAt(pos);
  });

  canvas.addEventListener('scroll', () => syncRulers(), { passive: true });
  new ResizeObserver(() => syncRulers()).observe(canvas);
  store.subscribe((s, changed) => {
    if (changed.includes('showRuler') || changed.includes('ribbonCollapsed') || changed.includes('ribbonPeek')) requestAnimationFrame(syncRulers);
    if (changed.includes('pageMovement') || changed.includes('hideWhiteSpace') || changed.includes('gridlines')) {
      view.setOptions({ ...options(), side: s.pageMovement === 'side' });
      if (changed.includes('pageMovement') && s.pageMovement !== 'side') view.leaveSide();
      paginator?.relayout();
    }
  });

  return {
    el: area,
    canvas,
    view,
    rulers,
    attach,
    applyDocument,
    plugin: paginationPlugin,
    /** After a document change. */
    update: () => paginator?.update(),
    relayout: () => paginator?.relayout(),
    syncRulers,
    setZoom,
    zoomIn: () => setZoom(Math.floor(store.get().zoom / 10) * 10 + 10),
    zoomOut: () => setZoom(Math.ceil(store.get().zoom / 10) * 10 - 10),
    onePage: () => { store.set({ pageMovement: 'vertical' }); setZoom(fitPage()); },
    pageWidth: () => setZoom(fitWidth()),
    multiplePages: () => { store.set({ pageMovement: 'side' }); setZoom(fitWidth(2)); },
    fitWidth, fitPage,
    get pages() { return pages; },
    get styleIndex() { return styleIndex; },
    get model() { return model; },
    pageAt: (pos) => paginator?.pageAt(pos) ?? 0,
  };
}
