/**
 * Inking on the pages (Draw tab). While Pen, Pencil, Highlighter, Eraser or
 * Lasso is the tool, a transparent layer over the page stack takes the
 * pointer:
 *   pen tools  — each stroke becomes a draw:path object anchored to the
 *                paragraph beside it (or a part of the Drawing Canvas it
 *                starts in); with Ink to Shape on, recognised strokes become
 *                lines, arrows, rectangles, ellipses or triangles
 *   eraser     — removes whole strokes it touches
 *   lasso      — selects the strokes inside a loop; drag to move, Delete to delete
 * Ink Replay redraws every stroke in the order it was drawn.
 */
import { schema } from '../core/schema.js';
import { inkAttrs, canvasChild, recognise, CM, cm } from '../core/ink.js';
import { maxZ, uniqueName, withGraphic, withFrameAttrs } from '../core/objects.js';
import { shapeAttrs, anchorAtClient } from '../features/insert/objects.js';
import { getSetting, setSetting } from '../core/settings.js';

const PEN_TOOLS = new Set(['pen', 'pencil', 'highlighter']);
export const INK_TOOLS = new Set(['pen', 'pencil', 'highlighter', 'eraser', 'lasso']);
const DEFAULT_PENS = { pen: { colour: '#000000', width: 0.5 }, pencil: { colour: '#404040', width: 1 }, highlighter: { colour: '#ffff00', width: 5 } };

/** The colour and thickness (mm) of each pen tool, remembered in the settings. */
export const penSettings = () => ({ ...DEFAULT_PENS, ...(getSetting('inkPens') || {}) });
export function setPen(tool, change) {
  const all = penSettings();
  all[tool] = { ...all[tool], ...change };
  setSetting('inkPens', all);
}

const SVGNS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, String(v)); return e; };

export function createInk({ store, docArea, getView, ctx, toast, t }) {
  const stack = docArea.view.stack;
  const layer = document.createElement('div');
  layer.className = 'ink-layer';
  layer.hidden = true;
  const live = svgEl('svg', { class: 'ink-live' });
  layer.append(live);
  stack.append(layer);
  let lassoSel = []; // [{ pos }] selected frames
  let selBox = null;

  const zoom = () => store.get().zoom / 100;
  const local = (e) => {
    const r = stack.getBoundingClientRect();
    return { x: (e.clientX - r.left) / zoom(), y: (e.clientY - r.top) / zoom(), p: e.pointerType === 'pen' ? e.pressure : undefined };
  };

  /** Frames (pos) of a kind, with their DOM. */
  function framesOf(kinds) {
    const view = getView();
    const out = [];
    view.state.doc.descendants((n, pos) => {
      if (n.type.name === 'frame' && (!kinds || kinds.includes(n.attrs.kind))) out.push({ node: n, pos, dom: view.nodeDOM(pos) });
      return true;
    });
    return out;
  }

  // ------------------------------------------------------------ drawing a stroke

  function startStroke(e) {
    const tool = store.get().drawTool;
    const pen = penSettings()[tool];
    const width = Math.max(0.5, (pen.width / 25.4) * 96);
    const pts = [local(e)];
    const line = svgEl('polyline', { fill: 'none', stroke: pen.colour, 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-opacity': tool === 'highlighter' ? 0.5 : 1 });
    live.append(line);
    const draw = () => line.setAttribute('points', pts.map((p) => `${p.x},${p.y}`).join(' '));
    draw();
    const move = (ev) => {
      const list = ev.getCoalescedEvents?.();
      for (const ce of list?.length ? list : [ev]) pts.push(local(ce));
      draw();
    };
    const up = (ev) => {
      layer.removeEventListener('pointermove', move);
      layer.removeEventListener('pointerup', up);
      layer.removeEventListener('pointercancel', up);
      line.remove();
      if (ev.type === 'pointerup') commitStroke(pts, { tool, colour: pen.colour, width }, ev);
    };
    layer.addEventListener('pointermove', move);
    layer.addEventListener('pointerup', up);
    layer.addEventListener('pointercancel', up);
  }

  /** The Drawing Canvas a stack point is on, if any. */
  function canvasAt(p) {
    const sr = stack.getBoundingClientRect();
    for (const f of framesOf(['canvas'])) {
      const r = f.dom?.querySelector?.('.obj-box')?.getBoundingClientRect();
      if (!r) continue;
      const x = (r.left - sr.left) / zoom();
      const y = (r.top - sr.top) / zoom();
      if (p.x >= x && p.y >= y && p.x <= x + r.width / zoom() && p.y <= y + r.height / zoom()) return { ...f, x, y, w: r.width / zoom(), h: r.height / zoom() };
    }
    return null;
  }

  function commitStroke(pts, pen) {
    const view = getView();
    const doc = view.state.doc;
    const shape = store.get().inkToShape ? recognise(pts) : null;
    const canvas = canvasAt(pts[0]);
    // In a Drawing Canvas: the stroke (or shape) is part of the canvas.
    if (canvas) {
      const rel = pts.map((p) => ({ ...p, x: Math.min(canvas.w, Math.max(0, p.x - canvas.x)), y: Math.min(canvas.h, Math.max(0, p.y - canvas.y)) }));
      const relShape = shape ? recognise(rel) : null;
      const part = relShape ? shapePart(relShape, rel, pen) : canvasChild(inkAttrs(rel, { ...pen, name: `${title(pen.tool)} ${(canvas.node.attrs.parts || []).length}`, z: 0 }));
      const attrs = { ...canvas.node.attrs, parts: [...(canvas.node.attrs.parts || []), part] };
      view.dispatch(view.state.tr.setNodeMarkup(canvas.pos, null, attrs));
      return;
    }
    // Anywhere else: an object anchored to the paragraph beside the stroke.
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const sr = stack.getBoundingClientRect();
    const left = sr.left + Math.min(...xs) * zoom();
    const top = sr.top + Math.min(...ys) * zoom();
    const at = anchorAtClient(ctx(), view, left, top, sr.left + pts[0].x * zoom(), sr.top + pts[0].y * zoom());
    const ox = (at.paraLeft - sr.left) / zoom();
    const oy = (at.paraTop - sr.top) / zoom();
    const rel = pts.map((p) => ({ ...p, x: p.x - ox, y: p.y - oy }));
    const z = maxZ(doc) + 1;
    let attrs;
    if (shape) {
      const box = shape.type === 'line' || shape.type === 'arrow'
        ? { x: Math.min(shape.from.x, shape.to.x) - ox, y: Math.min(shape.from.y, shape.to.y) - oy, w: Math.abs(shape.to.x - shape.from.x), h: Math.abs(shape.to.y - shape.from.y) }
        : { x: shape.box.x - ox, y: shape.box.y - oy, w: shape.box.w, h: shape.box.h };
      const id = { line: 'line', arrow: 'arrow', rectangle: 'rectangle', ellipse: 'ellipse', triangle: 'triangle' }[shape.type];
      attrs = shapeAttrs(id, { ...box, name: uniqueName(doc, 'Shape'), z, dir: shape.from ? { x: shape.to.x >= shape.from.x ? 1 : -1, y: shape.to.y >= shape.from.y ? 1 : -1 } : undefined });
      attrs = withGraphic(attrs, { 'draw:fill': 'none', 'svg:stroke-color': pen.colour, 'svg:stroke-width': cm(pen.width), 'draw:stroke': 'solid' });
    } else {
      attrs = inkAttrs(rel, { ...pen, name: uniqueName(doc, title(pen.tool)), z });
    }
    const pos = at.anchor + 1;
    view.dispatch(view.state.tr.insert(pos, schema.nodes.frame.create(attrs)));
  }

  const title = (tool) => ({ pen: 'Pen', pencil: 'Pencil', highlighter: 'Highlighter' }[tool] || 'Ink');

  /** A recognised shape as a canvas part (rect / ellipse / line / polygon), in canvas px. */
  function shapePart(s, _pts, pen) {
    const g = { 'draw:stroke': 'solid', 'svg:stroke-color': pen.colour, 'svg:stroke-width': cm(pen.width), 'draw:fill': 'none' };
    const b = s.box;
    if (s.type === 'line' || s.type === 'arrow') {
      return { n: 'draw:line', a: { 'draw:name': s.type === 'arrow' ? 'Arrow' : 'Line', 'svg:x1': cm(s.from.x), 'svg:y1': cm(s.from.y), 'svg:x2': cm(s.to.x), 'svg:y2': cm(s.to.y) }, '#graphic': s.type === 'arrow' ? { ...g, 'draw:marker-end': 'Arrow', 'draw:marker-end-width': '0.25cm' } : g };
    }
    if (s.type === 'ellipse') return { n: 'draw:ellipse', a: { 'draw:name': 'Ellipse', 'svg:x': cm(b.x), 'svg:y': cm(b.y), 'svg:width': cm(b.w), 'svg:height': cm(b.h) }, '#graphic': g };
    if (s.type === 'triangle') {
      const vb = (v) => Math.round(v / (96 / 2540));
      const pts = s.corners.map((p) => `${vb(p.x - b.x)},${vb(p.y - b.y)}`).join(' ');
      return { n: 'draw:polygon', a: { 'draw:name': 'Triangle', 'svg:x': cm(b.x), 'svg:y': cm(b.y), 'svg:width': cm(b.w), 'svg:height': cm(b.h), 'svg:viewBox': `0 0 ${vb(b.w)} ${vb(b.h)}`, 'draw:points': pts }, '#graphic': g };
    }
    return { n: 'draw:rect', a: { 'draw:name': 'Rectangle', 'svg:x': cm(b.x), 'svg:y': cm(b.y), 'svg:width': cm(b.w), 'svg:height': cm(b.h) }, '#graphic': g };
  }

  // ------------------------------------------------------------ eraser

  /** Removes the stroke under a screen point (an ink object, or a stroke in a canvas). */
  function eraseAt(clientX, clientY) {
    const view = getView();
    for (const [dx, dy] of [[0, 0], [-4, 0], [4, 0], [0, -4], [0, 4], [-3, -3], [3, 3], [-3, 3], [3, -3]]) {
      for (const el of document.elementsFromPoint(clientX + dx, clientY + dy)) {
        const obj = el.closest?.('.odt-obj');
        if (!obj || !(el instanceof SVGElement)) continue;
        const f = framesOf(['ink', 'canvas', 'group']).find((x) => x.dom === obj);
        if (!f) continue;
        if (f.node.attrs.kind === 'ink') { view.dispatch(view.state.tr.delete(f.pos, f.pos + f.node.nodeSize)); return true; }
        const child = el.closest('[data-child]');
        const i = child ? Number(child.dataset.child) : -1;
        // The canvas's own background stays.
        if (i < 0 || (f.node.attrs.kind === 'canvas' && i === 0)) continue;
        const parts = f.node.attrs.parts.filter((_, k) => k !== i);
        view.dispatch(view.state.tr.setNodeMarkup(f.pos, null, { ...f.node.attrs, parts }));
        return true;
      }
    }
    return false;
  }

  function startErase(e) {
    eraseAt(e.clientX, e.clientY);
    const move = (ev) => eraseAt(ev.clientX, ev.clientY);
    const up = () => { layer.removeEventListener('pointermove', move); layer.removeEventListener('pointerup', up); };
    layer.addEventListener('pointermove', move);
    layer.addEventListener('pointerup', up);
  }

  // ------------------------------------------------------------ lasso

  const inside = (poly, x, y) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      if ((poly[i].y > y) !== (poly[j].y > y) && x < ((poly[j].x - poly[i].x) * (y - poly[i].y)) / (poly[j].y - poly[i].y) + poly[i].x) c = !c;
    }
    return c;
  };

  function clearLasso() { lassoSel = []; selBox?.remove(); selBox = null; }

  function startLasso(e) {
    // Dragging inside the current selection moves it.
    if (selBox && e.target === selBox) { startMove(e); return; }
    clearLasso();
    const pts = [local(e)];
    const path = svgEl('polygon', { class: 'ink-lasso', points: '' });
    live.append(path);
    const move = (ev) => { pts.push(local(ev)); path.setAttribute('points', pts.map((p) => `${p.x},${p.y}`).join(' ')); };
    const up = () => {
      layer.removeEventListener('pointermove', move);
      layer.removeEventListener('pointerup', up);
      path.remove();
      if (pts.length < 3) return;
      const sr = stack.getBoundingClientRect();
      for (const f of framesOf(['ink', 'shape', 'line'])) {
        const r = f.dom?.querySelector?.('.obj-box')?.getBoundingClientRect();
        if (!r) continue;
        const cx = (r.left + r.width / 2 - sr.left) / zoom();
        const cy = (r.top + r.height / 2 - sr.top) / zoom();
        if (inside(pts, cx, cy)) lassoSel.push({ pos: f.pos, rect: r });
      }
      drawSelection();
    };
    layer.addEventListener('pointermove', move);
    layer.addEventListener('pointerup', up);
  }

  function drawSelection() {
    selBox?.remove();
    selBox = null;
    if (!lassoSel.length) return;
    const sr = stack.getBoundingClientRect();
    const view = getView();
    const rects = lassoSel.map((s) => view.nodeDOM(s.pos)?.querySelector?.('.obj-box')?.getBoundingClientRect()).filter(Boolean);
    if (!rects.length) { lassoSel = []; return; }
    const x0 = Math.min(...rects.map((r) => r.left));
    const y0 = Math.min(...rects.map((r) => r.top));
    const x1 = Math.max(...rects.map((r) => r.right));
    const y1 = Math.max(...rects.map((r) => r.bottom));
    selBox = document.createElement('div');
    selBox.className = 'ink-selection';
    selBox.style.cssText = `left:${(x0 - sr.left) / zoom() - 3}px;top:${(y0 - sr.top) / zoom() - 3}px;width:${(x1 - x0) / zoom() + 6}px;height:${(y1 - y0) / zoom() + 6}px`;
    selBox.setAttribute('aria-label', t('ink.selection', { n: lassoSel.length }));
    layer.append(selBox);
  }

  function startMove(e) {
    const start = local(e);
    const box0 = { left: parseFloat(selBox.style.left), top: parseFloat(selBox.style.top) };
    const move = (ev) => {
      const p = local(ev);
      selBox.style.left = `${box0.left + p.x - start.x}px`;
      selBox.style.top = `${box0.top + p.y - start.y}px`;
    };
    const up = (ev) => {
      layer.removeEventListener('pointermove', move);
      layer.removeEventListener('pointerup', up);
      const p = local(ev);
      moveSelection(p.x - start.x, p.y - start.y);
    };
    layer.addEventListener('pointermove', move);
    layer.addEventListener('pointerup', up);
  }

  /** Moves the lasso selection by (dx, dy) px. */
  function moveSelection(dx, dy) {
    const view = getView();
    const tr = view.state.tr;
    const shift = (v, d) => cm((parseFloat(v) || 0) * CM + d);
    for (const s of lassoSel) {
      const n = tr.doc.nodeAt(s.pos);
      if (!n) continue;
      const fa = n.attrs.frameAttrs;
      const change = n.attrs.element === 'draw:line'
        ? { 'svg:x1': shift(fa['svg:x1'], dx), 'svg:x2': shift(fa['svg:x2'], dx), 'svg:y1': shift(fa['svg:y1'], dy), 'svg:y2': shift(fa['svg:y2'], dy) }
        : { 'svg:x': shift(fa['svg:x'], dx), 'svg:y': shift(fa['svg:y'], dy) };
      tr.setNodeMarkup(s.pos, null, withFrameAttrs(n.attrs, change));
    }
    view.dispatch(tr);
    requestAnimationFrame(drawSelection);
  }

  function deleteSelection() {
    if (!lassoSel.length) return false;
    const view = getView();
    const tr = view.state.tr;
    for (const s of [...lassoSel].sort((a, b) => b.pos - a.pos)) {
      const n = tr.doc.nodeAt(s.pos);
      if (n) tr.delete(s.pos, s.pos + n.nodeSize);
    }
    view.dispatch(tr);
    clearLasso();
    return true;
  }

  // ------------------------------------------------------------ the layer

  layer.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    try { layer.setPointerCapture?.(e.pointerId); } catch { /* a synthetic or ended pointer */ }
    const tool = store.get().drawTool;
    if (PEN_TOOLS.has(tool)) startStroke(e);
    else if (tool === 'eraser') startErase(e);
    else if (tool === 'lasso') startLasso(e);
  });
  document.addEventListener('keydown', (e) => {
    if (layer.hidden) return;
    // Esc puts the pen down (back to Select).
    if (e.key === 'Escape' && !lassoSel.length && !document.querySelector('.dlg, .menu')) { e.preventDefault(); store.set({ drawTool: 'select' }); return; }
    if (!lassoSel.length) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); }
    if (e.key === 'Escape') { e.preventDefault(); clearLasso(); }
  });

  function sync() {
    const s = store.get();
    const on = INK_TOOLS.has(s.drawTool) && s.pageMovement !== 'side';
    layer.hidden = !on;
    layer.dataset.tool = s.drawTool;
    if (!on || s.drawTool !== 'lasso') clearLasso();
  }
  store.subscribe((s, changed) => { if (changed.includes('drawTool') || changed.includes('pageMovement')) sync(); });
  sync();

  // ------------------------------------------------------------ replay

  let replaying = null;
  function replay() {
    stopReplay();
    const strokes = [...stack.querySelectorAll('.odt-obj .ink-stroke, .odt-obj .group-svg > [data-child]')]
      .filter((el) => !(el.closest('.kind-canvas') && el.dataset?.child === '0'));
    if (!strokes.length) { toast?.(t('ink.nothingToReplay')); return; }
    // In drawing order: by object z-index, then by position within a canvas.
    const order = (el) => { const o = el.closest('.odt-obj'); const f = framesOf(null).find((x) => x.dom === o); return Number(f?.node.attrs.frameAttrs['draw:z-index'] || 0) * 1000 + Number(el.dataset?.child || el.closest('[data-child]')?.dataset.child || 0); };
    strokes.sort((a, b) => order(a) - order(b));
    for (const s of strokes) s.style.visibility = 'hidden';
    const bar = document.createElement('div');
    bar.className = 'ink-replay-bar';
    const stopBtn = document.createElement('button');
    stopBtn.type = 'button';
    stopBtn.className = 'dlg-btn';
    stopBtn.textContent = t('ink.stopReplay');
    stopBtn.addEventListener('click', stopReplay);
    const progress = document.createElement('progress');
    progress.max = strokes.length;
    bar.append(progress, stopBtn);
    docArea.el.append(bar);
    store.set({ inkReplaying: true });
    let i = 0;
    const next = () => {
      if (!replaying) return;
      if (i >= strokes.length) { stopReplay(); return; }
      const el = strokes[i++];
      progress.value = i;
      el.style.visibility = '';
      const path = el.matches('path, polyline, polygon, line') ? el : el.querySelector('path, polyline, polygon, line, rect, ellipse');
      const len = path?.getTotalLength?.() || 0;
      const stroked = path && getComputedStyle(path).fill === 'none' && len > 0;
      const dur = Math.max(160, Math.min(900, len * 2));
      if (stroked) {
        path.style.strokeDasharray = `${len}`;
        path.style.strokeDashoffset = `${len}`;
        path.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: dur, easing: 'linear' }).onfinish = () => { path.style.strokeDasharray = ''; path.style.strokeDashoffset = ''; replaying?.step(); };
      } else {
        el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: dur }).onfinish = () => replaying?.step();
      }
    };
    replaying = { strokes, bar, step: () => setTimeout(next, 60) };
    next();
  }
  function stopReplay() {
    if (!replaying) return;
    for (const s of replaying.strokes) { s.style.visibility = ''; s.getAnimations?.().forEach((a) => a.cancel()); s.querySelectorAll?.('*').forEach((x) => { x.style.strokeDasharray = ''; x.style.strokeDashoffset = ''; }); s.style.strokeDasharray = ''; s.style.strokeDashoffset = ''; }
    replaying.bar.remove();
    replaying = null;
    store.set({ inkReplaying: false });
  }

  return { replay, stopReplay, deleteSelection, clearLasso, get selection() { return lassoSel; }, get replaying() { return !!replaying; } };
}
