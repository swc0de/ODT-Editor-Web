/**
 * Print Layout pagination over a single ProseMirror flow.
 *
 * The browser lays the document out as one column. This module measures it
 * and inserts page gaps as decorations so content lands in each page's body:
 *   - 'block'  a widget before a block (or its nearest ancestor with a
 *              previous sibling) that moves to the next page,
 *   - 'inline' a display:block widget at a line start, splitting a paragraph,
 *   - 'rows'   translateY shifts on the rows after a table split, plus a
 *              spacer after the table.
 * Widows/orphans, keep-together, keep-with-next, page breaks before/after
 * and master-page changes are honoured.
 *
 * Measurements are made in "natural" coordinates (as if there were no gaps):
 * DOM position minus the gaps currently above it. A re-layout restarts at the
 * last clean page start before the first edited position and stops as soon
 * as a new page boundary coincides with the previous layout, so typing that
 * doesn't change a paragraph's height costs a single measurement. Long
 * re-layouts continue over several frames.
 */
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { bodyBox } from './page-model.js';
import { autoFromTree, mergeAuto } from '../core/odt/styles.js';

export const paginationKey = new PluginKey('pagination');
export const PAGE_GAP = 16;

const gapPos = (g) => (g.type === 'rows' ? g.tablePos : g.pos);

function gapWidget(h, inline) {
  const el = document.createElement(inline ? 'span' : 'div');
  el.className = inline ? 'pg-gap pg-gap-inline' : 'pg-gap';
  el.style.height = `${Math.max(0, h)}px`;
  el.contentEditable = 'false';
  el.setAttribute('aria-hidden', 'true');
  return el;
}

/** Decorations for a gap list. */
export function gapDecorations(doc, gaps) {
  const decos = [];
  for (const g of gaps) {
    if (g.type === 'block') decos.push(Decoration.widget(g.pos, () => gapWidget(g.h, false), { side: -1, key: `b:${g.h.toFixed(2)}`, ignoreSelection: true }));
    else if (g.type === 'inline') decos.push(Decoration.widget(g.pos, () => gapWidget(g.h, true), { side: -1, key: `i:${g.h.toFixed(2)}`, ignoreSelection: true, marks: [] }));
    else {
      for (const [rowPos, s] of g.shifts) {
        const row = doc.nodeAt(rowPos);
        if (row && Math.abs(s) > 0.01) decos.push(Decoration.node(rowPos, rowPos + row.nodeSize, { style: `transform:translateY(${s.toFixed(2)}px)`, class: 'pg-shifted' }));
      }
      if (g.h > 0.01) decos.push(Decoration.widget(g.tableEnd, () => gapWidget(g.h, false), { side: -1, key: `t:${g.h.toFixed(2)}`, ignoreSelection: true }));
      // Collapsed borders are painted by the table and wouldn't move with the rows.
      const table = doc.nodeAt(g.tablePos);
      if (table) decos.push(Decoration.node(g.tablePos, g.tablePos + table.nodeSize, { class: 'pg-split' }));
    }
  }
  return DecorationSet.create(doc, decos);
}

/**
 * Plugin state: { decos, gaps, pages, dirtyFrom }. Gaps and page starts are
 * mapped through every transaction so they always match the rendered DOM.
 */
export function paginationPlugin() {
  return new Plugin({
    key: paginationKey,
    state: {
      init: () => ({ decos: DecorationSet.empty, gaps: [], pages: [], dirtyFrom: 0 }),
      apply(tr, prev) {
        const meta = tr.getMeta(paginationKey);
        if (meta) return { ...prev, ...meta };
        if (!tr.docChanged) return prev;
        const m = tr.mapping;
        let from = Infinity;
        for (const map of m.maps) map.forEach((_a, _b, newStart) => { from = Math.min(from, newStart); });
        // Mapping can shift positions by a step's own map; re-map each step range start through later steps.
        let acc = Infinity;
        m.maps.forEach((map, i) => map.forEach((_a, _b, s) => { acc = Math.min(acc, m.slice(i + 1).map(s, -1)); }));
        from = Math.min(from, acc);
        if (prev.dirtyFrom != null) from = Math.min(m.map(prev.dirtyFrom, -1), from);
        const gaps = [];
        for (const g of prev.gaps) {
          if (g.type === 'rows') {
            const tp = m.mapResult(g.tablePos, 1);
            const te = m.mapResult(g.tableEnd, -1);
            if (tp.deleted || te.deleted) continue;
            const shifts = new Map();
            for (const [p, s] of g.shifts) { const r = m.mapResult(p, 1); if (!r.deleted) shifts.set(r.pos, s); }
            gaps.push({ ...g, tablePos: tp.pos, tableEnd: te.pos, shifts });
          } else {
            const r = m.mapResult(g.pos, -1);
            if (!r.deleted) gaps.push({ ...g, pos: r.pos });
          }
        }
        const pages = prev.pages.map((p) => ({ ...p, startPos: m.map(p.startPos, -1) }));
        return { decos: prev.decos.map(m, tr.doc), gaps, pages, dirtyFrom: Number.isFinite(from) ? from : prev.dirtyFrom };
      },
    },
    props: { decorations: (state) => paginationKey.getState(state).decos },
  });
}

/** Layout-relevant paragraph properties (cached per style + auto). */
function createPropsCache(getIndex) {
  let cache = new Map();
  const get = (node) => {
    const a = node.attrs;
    const key = `${a.styleName}|${a.auto ? JSON.stringify(a.auto) : ''}`;
    let v = cache.get(key);
    if (v) return v;
    const index = getIndex();
    const auto = mergeAuto(index?.effective('paragraph', a.styleName) || null, a.auto);
    const pp = auto?.props?.['style:paragraph-properties']?.a || {};
    const master = a.auto?.styleAttrs?.['style:master-page-name'] || index?.families.get('paragraph')?.get(a.styleName)?.a['style:master-page-name'] || null;
    v = {
      widows: pp['fo:widows'] != null ? Number(pp['fo:widows']) : 2,
      orphans: pp['fo:orphans'] != null ? Number(pp['fo:orphans']) : 2,
      keepTogether: pp['fo:keep-together'] === 'always',
      keepWithNext: pp['fo:keep-with-next'] === 'always',
      breakBefore: pp['fo:break-before'] === 'page' || !!master,
      breakAfter: pp['fo:break-after'] === 'page',
      master,
      pageNumber: pp['style:page-number'] && pp['style:page-number'] !== 'auto' ? Number(pp['style:page-number']) : null,
    };
    cache.set(key, v);
    return v;
  };
  get.reset = () => { cache = new Map(); };
  return get;
}

function sectionHasColumns(node, getIndex) {
  const t = node.attrs.styleName && getIndex()?.autos.get(`section:${node.attrs.styleName}`);
  if (!t) return false;
  const sp = (t.c || []).find((c) => c.n === 'style:section-properties');
  const cols = sp && (sp.c || []).find((c) => c.n === 'style:columns');
  return Number(cols?.a?.['fo:column-count'] || 1) > 1;
}

function tableProps(node, getIndex) {
  const t = node.attrs.styleName && getIndex()?.autos.get(`table:${node.attrs.styleName}`);
  const tp = t ? autoFromTree(t).auto?.props?.['style:table-properties']?.a || {} : {};
  const master = t?.a?.['style:master-page-name'] || null;
  return { breakBefore: tp['fo:break-before'] === 'page' || !!master, master };
}

/** Breakable units in document order, starting with the unit at/after `fromPos`. */
function* units(doc, getIndex, props, fromPos) {
  function* walk(parent, base, path) {
    let offset = 0;
    for (let i = 0; i < parent.childCount; i++) {
      const node = parent.child(i);
      const pos = base + offset;
      offset += node.nodeSize;
      if (pos + node.nodeSize <= fromPos) continue;
      const p = [...path, { pos, node, index: i, parent }];
      const name = node.type.name;
      if (name === 'paragraph' || name === 'heading') { if (pos >= fromPos) yield { kind: 'para', pos, node, path: p, props: props(node) }; }
      else if (name === 'list' || name === 'list_item' || (name === 'section' && !sectionHasColumns(node, getIndex))) yield* walk(node, pos + 1, p);
      else if (name === 'table') {
        const tp = tableProps(node, getIndex);
        let rpos = pos + 1;
        for (let r = 0; r < node.childCount; r++) {
          const row = node.child(r);
          if (rpos >= fromPos) yield { kind: 'row', pos: rpos, node: row, path: [...p, { pos: rpos, node: row, index: r, parent: node }], table: { pos, node, props: tp }, rowIndex: r };
          rpos += row.nodeSize;
        }
      } else if (pos >= fromPos) yield { kind: 'block', pos, node, path: p };
    }
  }
  yield* walk(doc, 0, []);
}

/**
 * @param {object} o
 * @param {import('prosemirror-view').EditorView} o.view
 * @param {() => object} o.getModel    page model (page-model.js)
 * @param {() => object} o.getIndex    style index
 * @param {() => {zoom:number, hideWhiteSpace:boolean, enabled:boolean}} o.getOptions
 * @param {() => HTMLElement} o.origin element whose top edge is page 1's top edge
 * @param {(view) => void} [o.beforeMeasure] e.g. tab-stop widths for the range
 * @param {(pages) => void} o.onLayout
 */
export function createPaginator(o) {
  const { view } = o;
  const props = createPropsCache(o.getIndex);
  let frame = 0;
  let job = null;

  const st = () => paginationKey.getState(view.state);
  const zoom = () => o.getOptions().zoom || 1;

  function makePage(prev, unit, forcedMaster) {
    const model = o.getModel();
    const name = forcedMaster && model.masters.has(forcedMaster) ? forcedMaster : (prev?.master || model.first.name);
    const master = model.masters.get(name) || model.first;
    const continues = prev && prev.master === master.name && !forcedMaster;
    const indexInMaster = continues ? prev.indexInMaster + 1 : 0;
    const restart = unit?.kind === 'para' ? unit.props.pageNumber : null;
    const number = restart || (prev ? prev.number + 1 : 1);
    const box = bodyBox(master, indexInMaster, number, o.getOptions());
    const gap = o.getOptions().hideWhiteSpace ? 1 : PAGE_GAP;
    const top = prev ? prev.top + prev.box.pageHeight + gap : 0;
    return { index: prev ? prev.index + 1 : 0, master: master.name, indexInMaster, number, box, top, startPos: unit ? unit.pos : 0, clean: true, D: 0 };
  }

  /** Lays out from `startIndex`; yields periodically. Uses the gaps currently rendered for measuring. */
  function* layout(startIndex) {
    const cur = st();
    const gaps = cur.gaps; // matches the DOM throughout this run
    const oldPages = cur.pages;
    const t0 = () => o.origin().getBoundingClientRect().top;
    const k = zoom();

    const prefix = (pos, end = false) => {
      let s = 0;
      for (const g of gaps) {
        const p = g.type === 'rows' ? g.tableEnd : g.pos;
        if (end ? p < pos : p <= pos) s += g.h;
      }
      return s;
    };
    const rowShift = (rowPos) => { for (const g of gaps) if (g.type === 'rows' && g.shifts.has(rowPos)) return g.shifts.get(rowPos); return 0; };
    const measure = (pos, node, kind) => {
      const dom = view.nodeDOM(pos);
      if (!dom || dom.nodeType !== 1) return null;
      const r = dom.getBoundingClientRect();
      const top0 = t0();
      let top = (r.top - top0) / k - prefix(pos);
      let bottom = (r.bottom - top0) / k - prefix(pos + node.nodeSize, true);
      if (kind === 'row') { const s = rowShift(pos); top -= s; bottom -= s; }
      return { top, bottom, dom };
    };
    const margins = (dom) => { const cs = getComputedStyle(dom); return { mt: parseFloat(cs.marginTop) || 0, mb: parseFloat(cs.marginBottom) || 0 }; };
    /**
     * Lines of a paragraph in natural coordinates: one getClientRects() over
     * the whole paragraph, grouped by line; the document position of a line
     * start is resolved only when a split needs it (line.pos()).
     */
    const lines = (u, dom) => {
      const top0 = t0();
      const range = document.createRange();
      range.selectNodeContents(dom);
      const all = [...range.getClientRects()].filter((r) => r.height > 0 && r.width > 0);
      // Ignore gap widgets (they are as wide as the paragraph and much taller than a line).
      const gapEls = [...dom.querySelectorAll(':scope > .pg-gap')].map((g) => g.getBoundingClientRect());
      const rects = all.filter((r) => !gapEls.some((g) => Math.abs(g.top - r.top) < 0.5 && Math.abs(g.height - r.height) < 0.5));
      rects.sort((a, b) => a.top - b.top || a.left - b.left);
      const out = [];
      for (const r of rects) {
        const last = out[out.length - 1];
        if (last && r.top < last.b - Math.min(4, (last.b - last.t) / 2)) { last.b = Math.max(last.b, r.bottom); last.left = Math.min(last.left, r.left); continue; }
        out.push({ t: r.top, b: r.bottom, left: r.left, mid: r.top + Math.min(r.height / 2, 6) });
      }
      const end = u.pos + u.node.nodeSize - 1;
      // Line tops below an existing inline gap are shifted by it: subtract the
      // gaps inside this paragraph that lie above each line.
      const inner = gaps.filter((g) => g.type === 'inline' && g.pos > u.pos && g.pos < end + 1);
      const gapTops = inner.length ? [...dom.querySelectorAll(':scope > .pg-gap')].map((g) => g.getBoundingClientRect().top) : [];
      const base = prefix(u.pos + 1);
      return out.map((l, i) => {
        let shift = base;
        for (let j = 0; j < inner.length && j < gapTops.length; j++) if (gapTops[j] < l.t) shift += inner[j].h;
        let cached = null;
        return {
          top: (l.t - top0) / k - shift,
          bottom: (l.b - top0) / k - shift,
          pos() {
            if (cached != null) return cached;
            if (i === 0) { cached = u.pos + 1; return cached; }
            const hit = view.posAtCoords({ left: l.left + 1, top: l.mid });
            cached = hit ? Math.max(u.pos + 1, Math.min(end, hit.pos)) : u.pos + 1;
            return cached;
          },
        };
      });
    };

    // Restart state.
    const pages = startIndex === 0 ? [] : oldPages.slice(0, startIndex + 1).map((p) => ({ ...p }));
    let page = startIndex === 0 ? makePage(null, null, null) : pages[startIndex];
    if (startIndex === 0) pages.push(page);
    const restartPos = page.startPos;
    const newGaps = gaps.filter((g) => gapPos(g) < restartPos && (g.type !== 'rows' || g.tableEnd <= restartPos));
    const bodyTop = (p) => p.top + p.box.top;
    const bodyBottom = (p) => p.top + p.box.bottom;
    let first = startIndex === 0;
    let prevUnit = null;
    let breakAfterPending = false;
    let rows = null; // open table split
    let count = 0;

    o.beforeMeasure?.(restartPos);

    const newPage = (unit, forcedMaster) => {
      page = makePage(page, unit, forcedMaster);
      pages.push(page);
      first = true;
      return page;
    };

    /** Has the layout caught up with the previous one at this boundary? */
    const caughtUp = (pos) => {
      const old = oldPages[page.index];
      if (!old || old.startPos !== pos || Math.abs(old.D - page.D) > 0.5 || old.master !== page.master || old.number !== page.number || Math.abs(old.top - page.top) > 0.5 || !old.clean || !page.clean) return false;
      // The boundary's own gap is already in newGaps; reuse everything after it.
      for (const g of gaps) if (gapPos(g) > pos) newGaps.push(g);
      for (let i = page.index + 1; i < oldPages.length; i++) pages.push({ ...oldPages[i] });
      return true;
    };

    /** Moves unit `u` (natural top `natTop`) to the top of a new page. */
    const moveToNewPage = (u, natTop, forcedMaster) => {
      const before = page;
      newPage(u, forcedMaster);
      if (u.kind === 'row') {
        if (!rows || rows.tablePos !== u.table.pos) {
          rows = { type: 'rows', tablePos: u.table.pos, tableEnd: u.table.pos + u.table.node.nodeSize, shifts: new Map(), h: 0, base: before.D };
          newGaps.push(rows);
        }
        page.D = bodyTop(page) - natTop;
        page.clean = false;
        return;
      }
      let level = u.path.length - 1;
      while (level > 0 && u.path[level].index === 0) level--;
      const target = u.path[level];
      page.D = bodyTop(page) - natTop;
      if (target.index === 0) return;
      const prevNode = target.parent.child(target.index - 1);
      const prevPos = target.pos - prevNode.nodeSize;
      const pm = measure(prevPos, prevNode, 'block');
      const targetTop = target.pos === u.pos ? natTop : (measure(target.pos, target.node, 'block')?.top ?? natTop);
      const tdom = view.nodeDOM(target.pos);
      const tm = tdom?.nodeType === 1 ? margins(tdom) : { mt: 0 };
      const pmM = pm ? margins(pm.dom) : { mb: 0 };
      const prevBottomVis = (pm ? pm.bottom : targetTop) + before.D;
      const h = bodyTop(page) - (natTop - targetTop) - prevBottomVis - pmM.mb - tm.mt;
      newGaps.push({ type: 'block', pos: target.pos, h });

    };

    for (const u of units(view.state.doc, o.getIndex, props, restartPos)) {
      if (++count % 30 === 0) yield;
      const m = measure(u.pos, u.node, u.kind);
      if (!m) continue;

      if (u.kind === 'row' && rows && rows.tablePos === u.table.pos) { rows.shifts.set(u.pos, page.D - rows.base); rows.h = page.D - rows.base; } else if (u.kind !== 'row') rows = null;

      // First paragraph chooses the first page's master page.
      if (page.index === 0 && first && u.kind === 'para' && u.props.master && u.props.master !== page.master && o.getModel().masters.has(u.props.master)) {
        page = makePage(null, u, u.props.master);
        pages[0] = page;
      }

      const forced = !first && (breakAfterPending || (u.kind === 'para' && u.props.breakBefore) || (u.kind === 'row' && u.rowIndex === 0 && u.table.props.breakBefore));
      breakAfterPending = false;
      if (forced) {
        const master = u.kind === 'para' ? u.props.master : (u.kind === 'row' ? u.table.props.master : null);
        moveToNewPage(u, m.top, master);
        if (u.kind === 'row') { rows.shifts.set(u.pos, page.D - rows.base); rows.h = page.D - rows.base; } else if (caughtUp(u.pos)) return { pages, gaps: newGaps };
      }

      const fits = m.bottom + page.D <= bodyBottom(page) + 0.5;
      if (!fits) {
        let handled = false;
        if (u.kind === 'para' && (!u.props.keepTogether || first)) {
          const ls = lines(u, m.dom);
          const n = ls.length;
          const limit = bodyBottom(page) - page.D;
          let kk = 0;
          while (kk < n && ls[kk].bottom <= limit + 0.5) kk++;
          if (kk >= n) handled = true; // only padding/border overflows: keep it here
          else {
            if (n - kk < u.props.widows) kk = n - u.props.widows;
            if (kk > 0 && kk < u.props.orphans) kk = 0;
            if (kk <= 0 && first) kk = Math.max(1, Math.min(n - 1, ls.findIndex((l) => l.bottom > limit)));
            if (kk > 0 && kk < n) {
              let j = kk;
              while (j < n) {
                const before = page;
                newPage(u, null);
                page.startPos = ls[j].pos();
                page.clean = false;
                newGaps.push({ type: 'inline', pos: ls[j].pos(), h: bodyTop(page) - (ls[j].top + before.D) });
                page.D = bodyTop(page) - ls[j].top;
                const lim = bodyBottom(page) - page.D;
                let next = j;
                while (next < n && ls[next].bottom <= lim + 0.5) next++;
                if (next >= n || next === j) break;
                j = next;
              }
              first = false;
              handled = true;
            }
          }
        }
        if (!handled && !first) {
          // Keep-with-next: a paragraph that must stay with this one moves along.
          let mover = u;
          let moverTop = m.top;
          if (u.kind !== 'row' && prevUnit?.kind === 'para' && prevUnit.props.keepWithNext && prevUnit.pos > page.startPos) {
            const pm = measure(prevUnit.pos, prevUnit.node, 'para');
            if (pm) { mover = prevUnit; moverTop = pm.top; }
          }
          moveToNewPage(mover, moverTop, null);
          if (u.kind === 'row') { rows.shifts.set(u.pos, page.D - rows.base); rows.h = page.D - rows.base; } else if (caughtUp(mover.pos)) return { pages, gaps: newGaps };
        }
      }
      first = false;
      prevUnit = u;
      if (u.kind === 'para' && u.props.breakAfter) breakAfterPending = true;
    }
    if (rows) rows.h = page.D - rows.base;
    return { pages, gaps: newGaps };
  }

  function finish(pages, newGaps) {
    newGaps.sort((a, b) => gapPos(a) - gapPos(b));
    const decos = gapDecorations(view.state.doc, newGaps);
    view.dispatch(view.state.tr.setMeta(paginationKey, { decos, gaps: newGaps, pages, dirtyFrom: null }).setMeta('addToHistory', false).setMeta('pagination', true));
    o.onLayout?.(pages);
  }

  /** Starts (or restarts) a layout from the page containing `fromPos` (null = everything). */
  function run(fromPos) {
    cancelAnimationFrame(frame);
    if (!o.getModel()) return; // no document loaded yet
    const cur = st();
    if (!o.getOptions().enabled) {
      const page = makePage(null, null, null);
      if (cur.gaps.length || cur.pages.length !== 1) finish([page], []);
      else o.onLayout?.([page]);
      return;
    }
    let startIndex = 0;
    if (fromPos != null && cur.pages.length) {
      for (let i = cur.pages.length - 1; i >= 0; i--) if (cur.pages[i].startPos <= fromPos) { startIndex = i; break; }
      startIndex = Math.max(0, startIndex - 1); // an edit can pull content back onto the previous page
      while (startIndex > 0 && !cur.pages[startIndex].clean) startIndex--;
    }
    const gen = layout(startIndex);
    job = gen;
    const step = () => {
      if (job !== gen) return;
      const start = performance.now();
      let r = gen.next();
      while (!r.done && performance.now() - start < 6) r = gen.next();
      if (!r.done) { frame = requestAnimationFrame(step); return; }
      job = null;
      finish(r.value.pages, r.value.gaps);
    };
    step();
  }

  return {
    /** Re-layout after a document change (from the first changed position). */
    update() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { const d = st().dirtyFrom; if (d != null) run(d); });
    },
    /** Full re-layout (styles, page setup, zoom, fonts, images changed). */
    relayout() { props.reset(); cancelAnimationFrame(frame); frame = requestAnimationFrame(() => run(null)); },
    relayoutNow() { props.reset(); run(null); },
    get pages() { return st().pages; },
    pageAt(pos) {
      const pages = st().pages;
      for (let i = pages.length - 1; i >= 0; i--) if (pages[i].startPos <= pos) return i;
      return 0;
    },
  };
}
