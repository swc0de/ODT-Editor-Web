/**
 * Arrange: Position, Wrap Text, Bring Forward / Send Backward, Align, Rotate,
 * flips and the Layout dialog — shared by Layout ▸ Arrange and the Picture /
 * Shape Format tabs.
 */
import { NodeSelection } from 'prosemirror-state';
import { wrapOf, withWrap, withPosition, withRotation, rotationOf, withGraphic, withFrameAttrs, withSize, sizeOf, originOf, positionOf, graphicProps, cm } from '../../core/objects.js';
import { sel, hasObj, update, setWrap, styleIndex, allObjects, zOf, screenOffset, canEdit } from './shared.js';
import { layoutOptionsDialog } from '../../ui/object-dialogs.js';

const wrapCmd = (wrap) => ({
  isEnabled: hasObj,
  isChecked: (c) => { const s = sel(c); return !!s && wrapOf(s.node.attrs, styleIndex(c)) === wrap; },
  run: (c) => setWrap(c, wrap),
});

/** Re-numbers z-indexes 0…n-1 in the given order and writes them in one step. */
function reorder(c, mutate) {
  const s = sel(c);
  if (!s) return;
  const view = s.view;
  const items = allObjects(view.state.doc).sort((x, y) => zOf(x.node) - zOf(y.node) || x.pos - y.pos);
  const i = items.findIndex((x) => x.pos === s.pos);
  if (i < 0) return;
  mutate(items, i);
  const tr = view.state.tr;
  items.forEach((it, z) => {
    if (zOf(it.node) !== z || it.node.attrs.frameAttrs['draw:z-index'] == null) tr.setNodeMarkup(it.pos, null, withFrameAttrs(it.node.attrs, { 'draw:z-index': String(z) }));
  });
  if (!s.inText) tr.setSelection(NodeSelection.create(tr.doc, s.pos));
  view.dispatch(tr);
}
const move = (items, i, j) => { const [x] = items.splice(i, 1); items.splice(Math.max(0, Math.min(items.length, j)), 0, x); };

/** Rotates by deg (ODF: counter-clockwise). */
const rotateBy = (c, deg) => update(c, (a) => {
  const floating = wrapOf(a, styleIndex(c)) !== 'inline';
  return withRotation(a, rotationOf(a) + deg, floating ? originOf(a) : { x: 0, y: 0 });
});

function flip(c, dir) {
  update(c, (a) => {
    if (a.element === 'draw:frame') {
      const cur = new Set(String(graphicProps(a, styleIndex(c))['style:mirror'] || '').split(/\s+/).filter((x) => x && x !== 'none'));
      if (dir === 'horizontal') { if (cur.has('horizontal')) cur.delete('horizontal'); else cur.add('horizontal'); } else if (cur.has('vertical')) cur.delete('vertical'); else cur.add('vertical');
      return withGraphic(a, { 'style:mirror': cur.size ? [...cur].join(' ') : 'none' });
    }
    if (a.element === 'draw:line') {
      const fa = a.frameAttrs;
      return withFrameAttrs(a, dir === 'horizontal' ? { 'svg:x1': fa['svg:x2'], 'svg:x2': fa['svg:x1'] } : { 'svg:y1': fa['svg:y2'], 'svg:y2': fa['svg:y1'] });
    }
    const parts = a.parts.map((p) => {
      if (p.n !== 'draw:enhanced-geometry') return p;
      const k = `draw:mirror-${dir}`;
      const on = p.a[k] === 'true';
      const na = { ...p.a };
      if (on) delete na[k]; else na[k] = 'true';
      return { ...p, a: na };
    });
    return { ...a, parts };
  });
}

/** Page body geometry around the selected object: { body: {top, left, width, height} (screen px), z }. */
function pageBody(c, s) {
  const da = c.ui.docArea;
  const i = da.pageAt(s.pos);
  const page = da.pages[i];
  const pel = da.view.pageElement(i);
  if (!page || !pel) return null;
  const z = c.state.zoom / 100;
  const m = da.model.masters.get(page.master) || da.model.first;
  const r = pel.getBoundingClientRect();
  return { z, left: r.left + m.marginLeft * z, top: r.top + page.box.top * z, width: m.bodyWidth * z, height: (page.box.bottom - page.box.top) * z };
}

/**
 * Puts a floating object at a vertical place on its page (top / middle /
 * bottom of the body, or a pixel offset): re-anchors it to the paragraph at
 * that height so it can be positioned below its anchor.
 */
function placeVertically(c, s, where, next) {
  const b = pageBody(c, s);
  if (!b) return { anchorPos: null, attrs: next };
  const { h } = sizeOf(next);
  const targetTop = where === 'top' ? b.top : where === 'middle' ? b.top + (b.height - h * b.z) / 2 : where === 'bottom' ? b.top + b.height - h * b.z : b.top + where * b.z;
  const view = s.view;
  const hit = view.posAtCoords({ left: b.left + 4, top: Math.max(b.top + 1, targetTop + 1) });
  let anchorPos = view.state.doc.resolve(s.pos).before();
  if (hit) {
    const $h = view.state.doc.resolve(hit.pos);
    for (let d = $h.depth; d > 0; d--) if ($h.node(d).isTextblock) { anchorPos = $h.before(d); break; }
  }
  const dom = view.nodeDOM(anchorPos);
  const pr = dom?.getBoundingClientRect?.();
  const y = pr ? Math.max(0, (targetTop - pr.top) / b.z) : 0;
  return { anchorPos, attrs: withPosition(next, { y }) };
}

/** Writes attrs and, if needed, moves the object to the start of another paragraph. */
function placeAt(s, attrs, anchorPos) {
  const view = s.view;
  const tr = view.state.tr;
  const $cur = tr.doc.resolve(s.pos);
  const curPara = $cur.before();
  if (anchorPos == null || anchorPos === curPara) {
    const start = $cur.start();
    if (s.pos !== start) {
      tr.delete(s.pos, s.pos + s.node.nodeSize);
      tr.insert(start, s.node.type.create(attrs));
      tr.setSelection(NodeSelection.create(tr.doc, start));
    } else {
      tr.setNodeMarkup(s.pos, null, attrs);
      tr.setSelection(NodeSelection.create(tr.doc, s.pos));
    }
  } else {
    tr.delete(s.pos, s.pos + s.node.nodeSize);
    const at = tr.mapping.map(anchorPos) + 1;
    tr.insert(at, s.node.type.create(attrs));
    tr.setSelection(NodeSelection.create(tr.doc, at));
  }
  view.dispatch(tr);
  view.focus();
}

/** "With Text Wrapping" positions: [horizontal, vertical]. */
export const POSITIONS = {
  topLeft: ['left', 'top'], topCentre: ['center', 'top'], topRight: ['right', 'top'],
  middleLeft: ['left', 'middle'], middleCentre: ['center', 'middle'], middleRight: ['right', 'middle'],
  bottomLeft: ['left', 'bottom'], bottomCentre: ['center', 'bottom'], bottomRight: ['right', 'bottom'],
};

function positionPreset(c, id) {
  const s = sel(c);
  if (!s || s.inText) return;
  const [hpos, vpos] = POSITIONS[id];
  let next = s.node.attrs;
  const wrap = wrapOf(next, styleIndex(c));
  if (wrap === 'inline' || wrap === 'topBottom') next = withWrap(next, 'square', screenOffset(c, s));
  next = withGraphic(withPosition(next, { x: 0 }), { 'style:horizontal-pos': hpos, 'style:horizontal-rel': 'paragraph' });
  const r = placeVertically(c, s, vpos, next);
  placeAt(s, r.attrs, r.anchorPos);
}

function align(c, how) {
  const s = sel(c);
  if (!s || s.inText) return;
  let a = s.node.attrs;
  if (wrapOf(a, styleIndex(c)) === 'inline') {
    // In line with text: align the paragraph instead, as Word does.
    const para = { left: 'start', center: 'center', right: 'end' }[how];
    if (para) c.ui.registry.run({ start: 'home.alignLeft', center: 'home.alignCentre', end: 'home.alignRight' }[para]);
    return;
  }
  if (['left', 'center', 'right'].includes(how)) {
    a = withGraphic(withPosition(a, { x: 0 }), { 'style:horizontal-pos': how, 'style:horizontal-rel': 'paragraph' });
    placeAt(s, a, null);
    return;
  }
  const r = placeVertically(c, s, how, a);
  placeAt(s, r.attrs, r.anchorPos);
}

export async function moreLayoutOptions(c, tab = 0) {
  const s = sel(c);
  if (!s) return;
  const a = s.node.attrs;
  const index = styleIndex(c);
  const gp = graphicProps(a, index);
  const pos = positionOf(a, index);
  const o = a.frameAttrs['draw:transform'] ? originOf(a) : pos;
  const { w, h } = sizeOf(a);
  const r = await layoutOptionsDialog({
    wrap: wrapOf(a, index), hpos: pos.hpos, vpos: pos.vpos, x: o.x, y: o.y, w, h, rotation: rotationOf(a),
    lockAspect: a.kind === 'image', natural: s.ov?.natural || null,
    distance: { t: gp['fo:margin-top'], b: gp['fo:margin-bottom'], l: gp['fo:margin-left'], r: gp['fo:margin-right'] },
  }, tab);
  if (!r) return;
  setWrap(c, r.wrap);
  update(c, (cur) => {
    let next = withSize(cur, r.w, r.h);
    if (r.wrap !== 'inline') {
      next = withPosition(next, { x: r.hpos === 'from-left' ? r.x : 0, y: r.y });
      next = withGraphic(next, { 'style:horizontal-pos': r.hpos, 'style:horizontal-rel': 'paragraph', 'fo:margin-top': cm(r.distance.t), 'fo:margin-bottom': cm(r.distance.b), 'fo:margin-left': cm(r.distance.l), 'fo:margin-right': cm(r.distance.r) });
    }
    if (r.rotation !== rotationOf(next)) next = withRotation(next, r.rotation, r.wrap !== 'inline' ? originOf(next) : { x: 0, y: 0 });
    return next;
  });
}

const objOnly = (run) => ({ isEnabled: (c) => hasObj(c), run });

export const arrangeCommands = {
  position: { icon: 'position', isEnabled: hasObj, menuOnly: false, run: (c, id) => (typeof id === 'string' ? positionPreset(c, id) : moreLayoutOptions(c, 0)) },
  positionInline: wrapCmd('inline'),
  moreLayoutOptions: objOnly((c) => moreLayoutOptions(c, 0)),
  wrapText: { icon: 'wrap-text', isEnabled: hasObj, menuOnly: true },
  wrapInline: wrapCmd('inline'),
  wrapSquare: wrapCmd('square'),
  wrapTight: wrapCmd('tight'),
  wrapThrough: wrapCmd('through'),
  wrapTopBottom: wrapCmd('topBottom'),
  wrapBehind: wrapCmd('behind'),
  wrapInFront: wrapCmd('front'),
  editWrapPoints: {},
  wrapMoreOptions: objOnly((c) => moreLayoutOptions(c, 1)),
  bringForward: { icon: 'bring-forward', isEnabled: hasObj, run: (c) => reorder(c, (it, i) => move(it, i, i + 1)) },
  bringToFront: objOnly((c) => reorder(c, (it, i) => move(it, i, it.length))),
  bringInFrontOfText: objOnly((c) => setWrap(c, 'front')),
  sendBackward: { icon: 'send-backward', isEnabled: hasObj, run: (c) => reorder(c, (it, i) => move(it, i, i - 1)) },
  sendToBack: objOnly((c) => reorder(c, (it, i) => move(it, i, 0))),
  sendBehindText: objOnly((c) => setWrap(c, 'behind')),
  selectionPane: { icon: 'selection-pane', isEnabled: canEdit, isChecked: (c) => !!c.state.selectionPaneOpen, run: (c) => c.store.set({ selectionPaneOpen: !c.state.selectionPaneOpen }) },
  align: { icon: 'align-objects', isEnabled: hasObj, menuOnly: true },
  alignLeft: objOnly((c) => align(c, 'left')),
  alignCentre: objOnly((c) => align(c, 'center')),
  alignRight: objOnly((c) => align(c, 'right')),
  alignTop: objOnly((c) => align(c, 'top')),
  alignMiddle: objOnly((c) => align(c, 'middle')),
  alignBottom: objOnly((c) => align(c, 'bottom')),
  group: { icon: 'group', menuOnly: true },
  groupObjects: {},
  ungroup: {},
  rotate: { icon: 'rotate', isEnabled: hasObj, menuOnly: true },
  rotateRight: objOnly((c) => rotateBy(c, -90)),
  rotateLeft: objOnly((c) => rotateBy(c, 90)),
  flipVertical: objOnly((c) => flip(c, 'vertical')),
  flipHorizontal: objOnly((c) => flip(c, 'horizontal')),
  rotationOptions: objOnly((c) => moreLayoutOptions(c, 2)),
};

/** The Arrange group as used on Layout and the Format tabs (commands are layout.*). */
export const arrangeGroup = (prefix = '') => ({
  id: 'arrange', icon: 'bring-forward',
  controls: [
    { t: 'large', cmd: `${prefix}position`, menu: [{ custom: 'positionGallery', cmd: `${prefix || 'layout.'}position` }, '-', `${prefix}moreLayoutOptions`] },
    { t: 'large', cmd: `${prefix}wrapText`, label: 'label.layout.wrapText', menu: [`${prefix}wrapInline`, '-', `${prefix}wrapSquare`, `${prefix}wrapTight`, `${prefix}wrapThrough`, `${prefix}wrapTopBottom`, '-', `${prefix}wrapBehind`, `${prefix}wrapInFront`, '-', `${prefix}editWrapPoints`, `${prefix}wrapMoreOptions`] },
    { t: 'col', items: [{ cmd: `${prefix}bringForward`, split: true, menu: [`${prefix}bringForward`, `${prefix}bringToFront`, `${prefix}bringInFrontOfText`] }, { cmd: `${prefix}sendBackward`, split: true, menu: [`${prefix}sendBackward`, `${prefix}sendToBack`, `${prefix}sendBehindText`] }, { cmd: `${prefix}selectionPane` }] },
    { t: 'col', items: [
      { cmd: `${prefix}align`, iconOnly: true, menu: [`${prefix}alignLeft`, `${prefix}alignCentre`, `${prefix}alignRight`, '-', `${prefix}alignTop`, `${prefix}alignMiddle`, `${prefix}alignBottom`] },
      { cmd: `${prefix}group`, iconOnly: true, menu: [`${prefix}groupObjects`, `${prefix}ungroup`] },
      { cmd: `${prefix}rotate`, iconOnly: true, menu: [`${prefix}rotateRight`, `${prefix}rotateLeft`, `${prefix}flipVertical`, `${prefix}flipHorizontal`, '-', `${prefix}rotationOptions`] },
    ] },
  ],
});
