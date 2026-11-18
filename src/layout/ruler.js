/**
 * Rulers. The horizontal ruler spans the page width under the ribbon: cm
 * ticks numbered from the left margin, shaded margins (drag their edges to
 * change page margins), the paragraph's indent markers (first-line, hanging,
 * left, right — drag them), and its tab stops (click to add one of the tab
 * selector's type, drag to move, drag off the ruler to remove). The vertical
 * ruler follows the current page with draggable top/bottom margins. The tab
 * selector in the corner cycles left / centre / right / decimal tabs and the
 * first-line / hanging indent tools.
 */
import { h } from '../ui/dom.js';
import { iconSvg } from '../ui/icons.js';
import { t } from '../i18n/index.js';
import { PX_PER_CM } from './units.js';

const TAB_TYPES = ['left', 'centre', 'right', 'decimal', 'firstLine', 'hanging'];
const TAB_ICON = { left: 'tab-left', centre: 'tab-centre', right: 'tab-right', decimal: 'tab-decimal', firstLine: 'tab-first-line', hanging: 'tab-hanging' };
const ODF_TYPE = { left: 'left', centre: 'center', right: 'right', decimal: 'char' };
const TYPE_ICON = { left: 'tab-left', center: 'tab-centre', right: 'tab-right', char: 'tab-decimal' };
const SNAP = PX_PER_CM / 4;

/**
 * Tick marks for a ruler of `lengthPx` (unzoomed) whose text area runs from
 * `startPx` to `endPx`. Whole centimetres are numbered inside the text area,
 * plain lines in the margins (as in the reference).
 */
export function rulerTicks(lengthPx, startPx, endPx = lengthPx) {
  const out = [];
  const first = -Math.floor(startPx / SNAP);
  const last = Math.floor((lengthPx - startPx) / SNAP);
  for (let i = first; i <= last; i++) {
    if (i === 0) continue;
    const pos = startPx + i * SNAP;
    if (pos < 2 || pos > lengthPx - 2) continue;
    const q = ((i % 4) + 4) % 4;
    if (q === 0 && pos > startPx && pos < endPx - 1) out.push({ pos, kind: 'num', n: i / 4 });
    else if (q === 0 || q === 2) out.push({ pos, kind: 'half' });
    else out.push({ pos, kind: 'quarter' });
  }
  return out;
}

function drawTicks(container, ticks, vertical, key, scale) {
  if (container._key === key) return;
  container._key = key;
  const frag = document.createDocumentFragment();
  for (const tk of ticks) {
    const el = tk.kind === 'num' ? h('span', { class: 'rt-num' }, String(tk.n)) : h('span', { class: `rt-tick ${tk.kind}` });
    el.style[vertical ? 'top' : 'left'] = `${tk.pos * scale}px`;
    frag.append(el);
  }
  container.replaceChildren(frag);
}

/**
 * @param {object} o
 * @param {object} o.store
 * @param {(change) => void} o.onIndents  { left?, right?, firstLine? } px
 * @param {(stops) => void} o.onTabs      [{ pos, type, char }] px
 * @param {(margins) => void} o.onMargins { left?, right?, top?, bottom? } px
 * @param {() => HTMLElement} o.guideHost element to draw the drag guide line in
 */
export function createRulers(o) {
  let tabType = 0;
  let geo = null; // last geometry
  const selector = h('button', { type: 'button', class: 'tab-selector' });
  const updateSelector = () => {
    const type = TAB_TYPES[tabType];
    selector.innerHTML = iconSvg(TAB_ICON[type], { size: 10, strokeWidth: 2 });
    const label = t('ruler.tabSelector', { type: t(`ruler.tab.${type}`) });
    selector.setAttribute('aria-label', label);
    selector.dataset.tip = label;
  };
  selector.addEventListener('click', () => { tabType = (tabType + 1) % TAB_TYPES.length; updateSelector(); });
  updateSelector();

  const marker = (cls, tip) => h('span', { class: `ruler-marker ${cls}`, 'data-tip': t(tip) });
  const firstLine = marker('first-line', 'ruler.firstLineIndent');
  const hanging = marker('hanging', 'ruler.hangingIndent');
  const leftIndent = marker('left-indent', 'ruler.leftIndent');
  const rightIndent = marker('right-indent', 'ruler.rightIndent');
  const hBody = h('div', { class: 'hruler-body' });
  const hTicks = h('div', { class: 'hruler-ticks' });
  const hTabs = h('div', { class: 'hruler-tabs' });
  const mLeft = h('div', { class: 'hruler-margin left' });
  const mRight = h('div', { class: 'hruler-margin right' });
  const edgeL = h('span', { class: 'ruler-edge h left', 'data-tip': t('ruler.leftMargin') });
  const edgeR = h('span', { class: 'ruler-edge h right', 'data-tip': t('ruler.rightMargin') });
  const hCols = h('div', { class: 'hruler-cols' });
  const hruler = h('div', { class: 'hruler', role: 'group', 'aria-label': t('ruler.horizontal') }, mLeft, hBody, mRight, hTicks, hCols, hTabs, edgeL, edgeR, firstLine, hanging, leftIndent, rightIndent);
  const hstrip = h('div', { class: 'hruler-strip' }, hruler);

  const vBody = h('div', { class: 'vruler-body' });
  const vTicks = h('div', { class: 'vruler-ticks' });
  const mTop = h('div', { class: 'vruler-margin top' });
  const mBottom = h('div', { class: 'vruler-margin bottom' });
  const edgeT = h('span', { class: 'ruler-edge v', 'data-tip': t('ruler.topMargin') });
  const edgeB = h('span', { class: 'ruler-edge v', 'data-tip': t('ruler.bottomMargin') });
  const vruler = h('div', { class: 'vruler', role: 'group', 'aria-label': t('ruler.vertical') }, mTop, vBody, mBottom, vTicks, edgeT, edgeB);
  const vstrip = h('div', { class: 'vruler-strip' }, vruler);
  const corner = h('div', { class: 'ruler-corner' }, selector);

  // ------------------------------------------------------------ drawing

  /**
   * @param {object} g { left, top, width, height (visual px of the page), scale,
   *   page: {width, height, marginLeft, marginRight, bodyTop, bodyBottom} (unzoomed px),
   *   indents: {left,right,firstLine}, tabs: [{pos,type}], interval }
   */
  function update(g) {
    if (!g) return;
    geo = g;
    const s = g.scale;
    const sr = hstrip.getBoundingClientRect();
    const P = g.page;
    hruler.style.left = `${g.left - sr.left}px`;
    hruler.style.width = `${P.width * s}px`;
    mLeft.style.width = `${P.marginLeft * s}px`;
    mRight.style.width = `${P.marginRight * s}px`;
    hBody.style.left = `${P.marginLeft * s}px`;
    hBody.style.right = `${P.marginRight * s}px`;
    edgeL.style.left = `${P.marginLeft * s}px`;
    edgeR.style.left = `${(P.width - P.marginRight) * s}px`;
    drawTicks(hTicks, rulerTicks(P.width, P.marginLeft, P.width - P.marginRight), false, `${P.width}|${P.marginLeft}|${P.marginRight}|${s}`, s);
    const ind = g.indents || { left: 0, right: 0, firstLine: 0 };
    // Indents are measured from the text area: the page body, or the table cell.
    g.x0 = g.x0 ?? P.marginLeft;
    g.x1 = g.x1 ?? P.width - P.marginRight;
    const x0 = g.x0;
    firstLine.style.left = `${(x0 + ind.left + ind.firstLine) * s}px`;
    hanging.style.left = `${(x0 + ind.left) * s}px`;
    leftIndent.style.left = `${(x0 + ind.left) * s}px`;
    rightIndent.style.left = `${(g.x1 - ind.right) * s}px`;
    const colKey = JSON.stringify([g.tableCols, s]);
    if (hCols._key !== colKey) {
      hCols._key = colKey;
      hCols.replaceChildren(...(g.tableCols || []).map((x, i) => {
        const el = h('span', { class: 'ruler-tcol', 'data-index': String(i), 'data-tip': t('ruler.tableColumn') });
        el.style.left = `${x * s}px`;
        return el;
      }));
    }
    const tabKey = JSON.stringify([g.tabs, ind.left, s, x0]);
    if (hTabs._key !== tabKey) {
      hTabs._key = tabKey;
      hTabs.replaceChildren(...(g.tabs || []).map((tab, i) => {
        const el = h('span', { class: 'ruler-tab', 'data-index': String(i), 'data-tip': t(`ruler.tab.${{ left: 'left', center: 'centre', right: 'right', char: 'decimal' }[tab.type] || 'left'}`), html: iconSvg(TYPE_ICON[tab.type] || 'tab-left', { size: 9, strokeWidth: 2.2 }) });
        el.style.left = `${(x0 + ind.left + tab.pos) * s}px`;
        return el;
      }));
    }
    // Vertical: the current page.
    const vr = vstrip.getBoundingClientRect();
    vruler.style.top = `${g.top - vr.top}px`;
    vruler.style.height = `${P.height * s}px`;
    mTop.style.height = `${P.bodyTop * s}px`;
    mBottom.style.height = `${(P.height - P.bodyBottom) * s}px`;
    vBody.style.top = `${P.bodyTop * s}px`;
    vBody.style.bottom = `${(P.height - P.bodyBottom) * s}px`;
    edgeT.style.top = `${P.bodyTop * s}px`;
    edgeB.style.top = `${P.bodyBottom * s}px`;
    drawTicks(vTicks, rulerTicks(P.height, P.bodyTop, P.bodyBottom), true, `${P.height}|${P.bodyTop}|${P.bodyBottom}|${s}`, s);
  }

  // ------------------------------------------------------------ dragging

  let guide = null;
  const showGuide = (clientX, clientY, vertical) => {
    if (!guide) { guide = h('div', { class: 'ruler-guide' }); document.body.append(guide); }
    const host = o.guideHost().getBoundingClientRect();
    guide.className = `ruler-guide${vertical ? ' v' : ''}`;
    if (vertical) { guide.style.cssText = `left:${host.left}px;width:${host.width}px;top:${clientY}px;height:0`; } else { guide.style.cssText = `top:${host.top}px;height:${host.height}px;left:${clientX}px;width:0`; }
  };
  const hideGuide = () => { guide?.remove(); guide = null; };
  const snap = (v, e) => (e.altKey ? v : Math.round(v / SNAP) * SNAP);
  /** Snaps a position measured from the page edge on the grid that starts at the left margin. */
  const snapRel = (abs, e) => geo.x0 + snap(abs - geo.x0, e);

  /** Generic drag helper: onMove(dxPx, dyPx, event) in unzoomed px; onEnd(...) commits. */
  function drag(e, { vertical = false, onMove, onEnd }) {
    e.preventDefault();
    e.stopPropagation();
    const s = geo?.scale || 1;
    const sx = e.clientX;
    const sy = e.clientY;
    const target = e.currentTarget;
    target.setPointerCapture?.(e.pointerId);
    showGuide(sx, sy, vertical);
    const move = (ev) => { showGuide(ev.clientX, ev.clientY, vertical); onMove?.((ev.clientX - sx) / s, (ev.clientY - sy) / s, ev); };
    const up = (ev) => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      hideGuide();
      onEnd?.((ev.clientX - sx) / s, (ev.clientY - sy) / s, ev);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  }

  const preview = (el, prop, basePx, deltaPx) => { el.style[prop] = `${(basePx + deltaPx) * (geo?.scale || 1)}px`; };

  firstLine.addEventListener('pointerdown', (e) => {
    const ind = { ...geo.indents };
    const base = geo.x0 + ind.left + ind.firstLine;
    drag(e, {
      onMove: (dx, _dy, ev) => preview(firstLine, 'left', base, snapRel(base + dx, ev) - base),
      onEnd: (dx, _dy, ev) => o.onIndents({ firstLine: snapRel(base + dx, ev) - geo.x0 - ind.left }),
    });
  });
  hanging.addEventListener('pointerdown', (e) => {
    // Moves the left indent but keeps the first line where it is.
    const ind = { ...geo.indents };
    const base = geo.x0 + ind.left;
    drag(e, {
      onMove: (dx, _dy, ev) => { const v = snapRel(base + dx, ev) - base; preview(hanging, 'left', base, v); preview(leftIndent, 'left', base, v); },
      onEnd: (dx, _dy, ev) => { const left = snapRel(base + dx, ev) - geo.x0; o.onIndents({ left, firstLine: ind.left + ind.firstLine - left }); },
    });
  });
  leftIndent.addEventListener('pointerdown', (e) => {
    // Moves the left indent and the first line together.
    const ind = { ...geo.indents };
    const base = geo.x0 + ind.left;
    drag(e, {
      onMove: (dx, _dy, ev) => { const v = snapRel(base + dx, ev) - base; for (const el of [hanging, leftIndent]) preview(el, 'left', base, v); preview(firstLine, 'left', base + ind.firstLine, v); },
      onEnd: (dx, _dy, ev) => o.onIndents({ left: snapRel(base + dx, ev) - geo.x0 }),
    });
  });
  rightIndent.addEventListener('pointerdown', (e) => {
    const ind = { ...geo.indents };
    const base = geo.x1 - ind.right;
    drag(e, {
      onMove: (dx, _dy, ev) => preview(rightIndent, 'left', base, snapRel(base + dx, ev) - base),
      onEnd: (dx, _dy, ev) => o.onIndents({ right: geo.x1 - snapRel(base + dx, ev) }),
    });
  });
  const marginDrag = (edge, side) => edge.addEventListener('pointerdown', (e) => {
    const P = { ...geo.page };
    const vertical = side === 'top' || side === 'bottom';
    const base = { left: P.marginLeft, right: P.width - P.marginRight, top: P.bodyTop, bottom: P.bodyBottom }[side];
    const prop = vertical ? 'top' : 'left';
    drag(e, {
      vertical,
      onMove: (dx, dy, ev) => preview(edge, prop, base, snap(base + (vertical ? dy : dx), ev) - base),
      onEnd: (dx, dy, ev) => {
        const v = snap(base + (vertical ? dy : dx), ev);
        const change = { left: { left: v }, right: { right: P.width - v }, top: { top: v }, bottom: { bottom: P.height - v } }[side];
        o.onMargins(change);
      },
    });
  });
  marginDrag(edgeL, 'left');
  marginDrag(edgeR, 'right');
  marginDrag(edgeT, 'top');
  marginDrag(edgeB, 'bottom');

  // Tab stops: drag to move, drag off to remove.
  hTabs.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.ruler-tab');
    if (!el) return;
    const i = Number(el.dataset.index);
    const tabs = geo.tabs.map((x) => ({ ...x }));
    const base = tabs[i].pos;
    const origin = geo.x0 + geo.indents.left;
    drag(e, {
      onMove: (dx, dy, ev) => { el.style.left = `${(origin + snap(base + dx, ev)) * geo.scale}px`; el.classList.toggle('removing', Math.abs(dy) > 24); },
      onEnd: (dx, dy, ev) => {
        if (Math.abs(dy) > 24) tabs.splice(i, 1); else tabs[i].pos = Math.max(0, snap(base + dx, ev));
        o.onTabs(tabs);
      },
    });
  });

  // Click on the ruler body: add a tab stop, or place the first-line / hanging indent.
  hruler.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.ruler-marker, .ruler-tab, .ruler-edge, .ruler-tcol') || !geo) return;
    const r = hruler.getBoundingClientRect();
    const x = (e.clientX - r.left) / geo.scale;
    if (x < geo.x0 || x > geo.x1) return;
    e.preventDefault();
    const type = TAB_TYPES[tabType];
    const rel = snap(x - geo.x0, e);
    if (type === 'firstLine') { o.onIndents({ firstLine: rel - geo.indents.left }); return; }
    if (type === 'hanging') { o.onIndents({ left: rel, firstLine: geo.indents.left + geo.indents.firstLine - rel }); return; }
    const pos = rel - geo.indents.left;
    if (pos <= 0) return;
    const tabs = [...(geo.tabs || []).map((x2) => ({ ...x2 })), { pos, type: ODF_TYPE[type], char: '.' }];
    o.onTabs(tabs);
  });

  // Table column markers: drag to resize the columns either side (Alt: no snapping).
  hCols.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.ruler-tcol');
    if (!el || !geo.tableCols) return;
    const i = Number(el.dataset.index);
    const xs = geo.tableCols;
    const base = xs[i];
    const lo = i > 0 ? xs[i - 1] + 10 : -Infinity;
    const hi = i < xs.length - 1 ? xs[i + 1] - 10 : Infinity;
    const at = (dx, ev) => Math.max(lo, Math.min(hi, snapRel(base + dx, ev)));
    drag(e, {
      onMove: (dx, _dy, ev) => { el.style.left = `${at(dx, ev) * geo.scale}px`; },
      onEnd: (dx, _dy, ev) => {
        const v = at(dx, ev);
        if (Math.abs(v - base) < 0.5) return;
        const next = xs.slice();
        next[i] = v;
        o.onTableColumns?.(next);
      },
    });
  });

  function setVisible(show) {
    hstrip.hidden = !show;
    vstrip.hidden = !show;
    corner.hidden = !show;
  }
  o.store.subscribe((s, changed) => { if (changed.includes('showRuler')) setVisible(s.showRuler); });
  setVisible(o.store.get().showRuler);

  return { hstrip, vstrip, corner, update, get tabType() { return TAB_TYPES[tabType]; } };
}
