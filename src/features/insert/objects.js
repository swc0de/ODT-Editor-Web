/**
 * Insert ▸ Illustrations and Text: pictures, shapes (drawn with the mouse or
 * clicked in at a default size), text boxes, WordArt and drop caps.
 */
import { NodeSelection } from 'prosemirror-state';
import { schema } from '../../core/schema.js';
import { SHAPES, fontworkGeometry } from '../../core/shapes.js';
import { cm, withGraphic, withFrameAttrs, withWrap, uniqueName, maxZ, textBoxAttrs } from '../../core/objects.js';
import { shapeStyleGraphic } from '../objects/format.js';
import { selectedTextblocks } from '../../core/commands/paragraph.js';

const CM = 96 / 2.54;
const A = (text, tp = null) => ({ type: 'text', text, ...(tp ? { marks: [{ type: 'textProps', attrs: { auto: { styleAttrs: {}, props: { 'style:text-properties': { a: tp } } } } }] } : {}) });
const para = (content, pp = null, styleName = 'Frame_20_contents') => ({ type: 'paragraph', attrs: { styleName, auto: pp ? { styleAttrs: {}, props: { 'style:paragraph-properties': { a: pp } } } : null, extra: null }, ...(content?.length ? { content } : {}) });

/** WordArt looks: fill, outline, shadow. */
export const WORDART_STYLES = {
  blackShadow: { fill: '#000000', shadow: true },
  blueFill: { fill: '#156082', shadow: true },
  whiteBlueOutline: { fill: '#ffffff', stroke: '#156082' },
  orangeFill: { fill: '#e97132', stroke: '#c04f15' },
  greenOutline: { fill: 'none', stroke: '#196b24' },
  greyFill: { fill: '#595959', stroke: '#262626' },
  purpleShadow: { fill: '#a02b93', shadow: true },
  lightBlueOutline: { fill: '#0f9ed5', stroke: '#0b5e7e', shadow: true },
};

/** Text box presets (original designs): size, look and starter text. */
export const TEXTBOX_PRESETS = {
  simple: {
    w: 8, h: 3, graphic: {}, preview: { border: '1px solid #000', background: '#fff' },
    body: () => [para([A('Type your text here. Drag the box by its edge to move it anywhere on the page.')])],
  },
  sidebar: {
    w: 5.5, h: 12, align: 'right',
    graphic: { 'fo:border': 'none', 'fo:background-color': '#c1e4f5', 'draw:fill': 'solid', 'draw:fill-color': '#c1e4f5', 'fo:padding': '0.35cm' },
    preview: { border: '0', background: '#c1e4f5' },
    body: () => [para([A('Sidebar title', { 'fo:font-size': '14pt', 'fo:font-weight': 'bold', 'fo:color': '#0f4761' })]), para([A('A sidebar is a good place for a short note, a list of key facts or a related story.')])],
  },
  quote: {
    w: 14, h: 2.5, align: 'center',
    graphic: { 'fo:border': 'none', 'fo:border-top': '2.25pt solid #156082', 'fo:border-bottom': '2.25pt solid #156082', 'fo:background-color': 'transparent', 'draw:fill': 'none', 'fo:padding': '0.25cm' },
    preview: { border: '0', borderTop: '2px solid #156082', borderBottom: '2px solid #156082', background: 'transparent' },
    body: () => [para([A('“Use a pull quote to make a key sentence stand out.”', { 'fo:font-size': '14pt', 'fo:font-style': 'italic', 'fo:color': '#156082' })], { 'fo:text-align': 'center' })],
  },
  banded: {
    w: 15.9, h: 2.2, align: 'center',
    graphic: { 'fo:border': 'none', 'fo:background-color': '#156082', 'draw:fill': 'solid', 'draw:fill-color': '#156082', 'fo:padding': '0.3cm' },
    preview: { border: '0', background: '#156082' },
    body: () => [para([A('Banner heading', { 'fo:font-size': '16pt', 'fo:font-weight': 'bold', 'fo:color': '#ffffff' })]), para([A('Add a short line of supporting text here.', { 'fo:color': '#ffffff' })])],
  },
};

/** Attrs for a new shape of preset `id` in the box (px, relative to the anchor paragraph). */
export function shapeAttrs(id, { x, y, w, h, name, z, dir = { x: 1, y: 1 } }) {
  const s = SHAPES[id];
  if (s.line) {
    const x1 = dir.x > 0 ? x : x + w; const x2 = dir.x > 0 ? x + w : x;
    const y1 = dir.y > 0 ? y : y + h; const y2 = dir.y > 0 ? y + h : y;
    const g = {
      'draw:stroke': 'solid', 'svg:stroke-color': '#156082', 'svg:stroke-width': '0.026cm', 'draw:fill': 'none',
      ...(s.end ? { 'draw:marker-end': 'Arrow', 'draw:marker-end-width': '0.25cm' } : {}),
      ...(s.start ? { 'draw:marker-start': 'Arrow', 'draw:marker-start-width': '0.25cm' } : {}),
    };
    const attrs = {
      element: 'draw:line', styleName: null, auto: null, kind: 'line', href: '', body: [], parts: [],
      frameAttrs: { 'draw:name': name, 'text:anchor-type': 'paragraph', 'draw:z-index': String(z), 'svg:x1': cm(x1), 'svg:y1': cm(y1), 'svg:x2': cm(x2), 'svg:y2': cm(y2) },
    };
    return withFrameAttrs(withGraphic(withWrap(attrs, 'front', { x, y }), g), { 'svg:x': null, 'svg:y': null });
  }
  const attrs = {
    element: 'draw:custom-shape', styleName: null, auto: null, kind: 'shape', href: '', body: [],
    frameAttrs: { 'draw:name': name, 'text:anchor-type': 'paragraph', 'svg:x': cm(x), 'svg:y': cm(y), 'svg:width': cm(Math.max(4, w)), 'svg:height': cm(Math.max(4, h)), 'draw:z-index': String(z) },
    parts: [{ n: 'draw:enhanced-geometry', a: { 'svg:viewBox': '0 0 21600 21600', 'draw:type': s.type } }],
  };
  return withGraphic(withWrap(attrs, 'front', { x, y }), { ...shapeStyleGraphic('fill1'), 'draw:textarea-horizontal-align': 'justify', 'draw:textarea-vertical-align': 'middle', 'draw:auto-grow-height': 'false', 'fo:padding-top': '0.127cm', 'fo:padding-bottom': '0.127cm', 'fo:padding-left': '0.254cm', 'fo:padding-right': '0.254cm' });
}

/** Attrs for WordArt text. */
export function wordArtAttrs(styleId, { x, y, name, z, text = 'Your text here' }) {
  const s = WORDART_STYLES[styleId] || WORDART_STYLES.blackShadow;
  const w = Math.max(4, text.length * 0.75) * CM;
  const h = 2.4 * CM;
  const tp = { 'style:font-name': 'Carlito', 'fo:font-weight': 'bold', 'fo:font-size': '36pt' };
  const attrs = {
    element: 'draw:custom-shape', styleName: null, kind: 'wordart', href: '',
    auto: { styleAttrs: {}, props: { 'style:text-properties': { a: tp } } },
    frameAttrs: { 'draw:name': name, 'text:anchor-type': 'paragraph', 'svg:x': cm(x), 'svg:y': cm(y), 'svg:width': cm(w), 'svg:height': cm(h), 'draw:z-index': String(z) },
    parts: [{ n: '#body' }, fontworkGeometry('shape')],
    body: [{ type: 'paragraph', attrs: { styleName: 'Standard', auto: null, extra: null }, content: [A(text, tp)] }],
  };
  return withGraphic(withWrap(attrs, 'square', { x, y }), {
    'draw:fill': s.fill === 'none' ? 'none' : 'solid', 'draw:fill-color': s.fill === 'none' ? null : s.fill,
    'draw:stroke': s.stroke ? 'solid' : 'none', 'svg:stroke-color': s.stroke || null, 'svg:stroke-width': s.stroke ? '0.03cm' : null,
    'draw:shadow': s.shadow ? 'visible' : 'hidden', 'draw:shadow-offset-x': s.shadow ? '0.08cm' : null, 'draw:shadow-offset-y': s.shadow ? '0.08cm' : null, 'draw:shadow-color': s.shadow ? '#808080' : null,
    'draw:auto-grow-height': 'false', 'draw:auto-grow-width': 'false',
  });
}

/** Inserts an object node at the start of the paragraph holding `at` (default: the selection) and selects it. */
export function insertObject(c, attrs, at = null) {
  // Floating objects always go in the body; while editing a text box or shape's
  // text, the new object is anchored next to that object.
  const view = c.mainEditor.view;
  const inner = c.ui.objects?.activeEditor() ? c.ui.objects.selected(c.editor) : null;
  const tr = view.state.tr;
  const $p = tr.doc.resolve(at ?? inner?.pos ?? tr.selection.from);
  let pos;
  if ($p.parent.inlineContent) pos = attrs.frameAttrs['text:anchor-type'] === 'as-char' ? $p.pos : $p.start();
  else {
    // Not in a paragraph (e.g. a node selection): use the next textblock.
    let found = null;
    tr.doc.nodesBetween($p.pos, tr.doc.content.size, (n, p) => { if (found == null && n.isTextblock) found = p + 1; return found == null; });
    pos = found ?? 1;
  }
  const node = schema.nodes.frame.create(attrs);
  tr.insert(pos, node);
  tr.setSelection(NodeSelection.create(tr.doc, pos));
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return pos;
}

/** Where a new floating object goes: x centred or at the right, y just below the paragraph's first line. */
function defaultPlace(c, w, align = 'left') {
  const bodyW = c.ui.docArea.model?.first?.bodyWidth || 600;
  const x = align === 'center' ? Math.max(0, (bodyW - w) / 2) : align === 'right' ? Math.max(0, bodyW - w) : 0;
  return { x, y: 0 };
}

export function insertTextBox(c, presetId = 'simple') {
  const p = TEXTBOX_PRESETS[presetId] || TEXTBOX_PRESETS.simple;
  const doc = c.mainEditor.view.state.doc;
  const w = p.w * CM;
  const { x, y } = defaultPlace(c, w, p.align);
  let attrs = textBoxAttrs({ w, h: p.h * CM, name: uniqueName(doc, c.t?.('obj.textBoxName') || 'Text Box'), z: maxZ(doc) + 1, body: p.body(), x, y });
  if (Object.keys(p.graphic).length) attrs = withGraphic(attrs, p.graphic);
  insertObject(c, attrs);
  c.store.set({ activeTab: 'shapeFormat' });
}

export function insertWordArt(c, styleId) {
  const view = c.editor.view;
  const doc = c.mainEditor.view.state.doc;
  const { from, to, empty } = view.state.selection;
  const text = empty ? 'Your text here' : view.state.doc.textBetween(from, to, ' ').slice(0, 200) || 'Your text here';
  const bodyW = c.ui.docArea.model?.first?.bodyWidth || 600;
  const w = Math.max(4, text.length * 0.75) * CM;
  const attrs = wordArtAttrs(styleId, { x: Math.max(0, (bodyW - Math.min(w, bodyW)) / 2), y: 0, name: uniqueName(doc, 'WordArt'), z: maxZ(doc) + 1, text });
  insertObject(c, attrs);
  c.store.set({ activeTab: 'shapeFormat' });
}

// ------------------------------------------------------------ drop cap

const DC = 'style:paragraph-properties';

/** Drop cap of the paragraph at the selection: { lines, length, distance (px) } or { lines: 0 }. */
export function dropCapOf(state) {
  const node = selectedTextblocks(state)[0]?.node;
  const el = node?.attrs.auto?.props?.[DC]?.c?.find((x) => x.n === 'style:drop-cap');
  if (!el) return { lines: 0 };
  return { lines: Number(el.a['style:lines'] || 1), length: el.a['style:length'] === 'word' ? 1 : Number(el.a['style:length'] || 1), distance: el.a['style:distance'] ? parseFloat(el.a['style:distance']) * CM : 0 };
}

export function setDropCap(c, spec) {
  const view = c.editor.view;
  const tr = view.state.tr;
  for (const { node, pos } of selectedTextblocks(view.state)) {
    const auto = structuredClone(node.attrs.auto || { styleAttrs: {}, props: {} });
    const pp = auto.props[DC] || { a: {} };
    const children = (pp.c || []).filter((x) => x.n !== 'style:drop-cap');
    if (spec.lines) children.push({ n: 'style:drop-cap', a: { 'style:lines': String(spec.lines), 'style:length': String(spec.length || 1), 'style:distance': cm(spec.distance || 0.1 * CM) } });
    const next = { a: pp.a || {} };
    if (children.length) next.c = children;
    auto.props[DC] = next;
    if (!Object.keys(next.a).length && !next.c) delete auto.props[DC];
    const empty = !Object.keys(auto.props).length && !Object.keys(auto.styleAttrs || {}).length;
    tr.setNodeMarkup(pos, null, { ...node.attrs, auto: empty ? null : auto });
  }
  view.dispatch(tr);
  view.focus();
}

// ------------------------------------------------------------ drawing with the mouse

let drawing = null;

/** Ends draw mode (Esc, or after one object). */
export function cancelDraw(c) {
  if (!drawing) return;
  document.removeEventListener('pointerdown', drawing.down, true);
  document.removeEventListener('keydown', drawing.key, true);
  drawing.canvas.classList.remove('draw-mode');
  drawing.box?.remove();
  drawing = null;
  c.store.set({ objectDraw: null });
}

/**
 * Draw mode: the next drag on the page draws the shape (or text box); a
 * click inserts it at its default size (2.54 cm). spec = { shape: id } | { textBox: true }.
 */
export function startDraw(c, spec) {
  cancelDraw(c);
  const view = c.mainEditor.view;
  const canvas = c.ui.docArea.canvas;
  canvas.classList.add('draw-mode');
  c.store.set({ objectDraw: spec.shape || 'textBox' });
  const down = (e) => {
    if (e.button !== 0 || !canvas.contains(e.target) || e.target.closest('.hruler-strip, .vruler-strip, .ruler-corner')) return;
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX; const sy = e.clientY;
    const box = document.createElement('div');
    box.className = 'table-draw-box obj-draw-box';
    document.body.append(box);
    drawing.box = box;
    const move = (ev) => { box.style.cssText = `left:${Math.min(sx, ev.clientX)}px;top:${Math.min(sy, ev.clientY)}px;width:${Math.abs(ev.clientX - sx)}px;height:${Math.abs(ev.clientY - sy)}px`; };
    const up = (ev) => {
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', up, true);
      box.remove();
      finish(c, spec, view, sx, sy, ev.clientX, ev.clientY, ev.shiftKey);
    };
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', up, true);
  };
  const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); cancelDraw(c); } };
  drawing = { down, key, canvas, box: null };
  document.addEventListener('pointerdown', down, true);
  document.addEventListener('keydown', key, true);
}

function finish(c, spec, view, sx, sy, ex, ey, square) {
  const z = c.state.zoom / 100;
  let w = Math.abs(ex - sx) / z;
  let h = Math.abs(ey - sy) / z;
  const isLine = spec.shape && SHAPES[spec.shape].line;
  const clicked = w < 4 && h < 4;
  if (clicked) { w = CM * 2.54; h = isLine ? 0 : (spec.textBox ? CM * 2.54 : CM * 2.54); }
  if (square && !isLine) { const m = Math.max(w, h); w = m; h = m; }
  const left = Math.min(sx, clicked ? sx : ex);
  const top = Math.min(sy, clicked ? sy : ey);
  // The paragraph under the top-left corner anchors the object.
  const da = c.ui.docArea;
  const i = da.pageAt(view.posAtCoords({ left: sx, top: sy })?.pos ?? view.state.selection.from);
  const pel = da.view.pageElement(i);
  const m = da.model.masters.get(da.pages[i]?.master) || da.model.first;
  const pr0 = pel?.getBoundingClientRect();
  const probeX = pr0 ? pr0.left + (m.marginLeft + 4) * z : left;
  const hit = view.posAtCoords({ left: probeX, top: top + 1 }) || view.posAtCoords({ left: probeX, top: top + 20 });
  let anchor = null;
  if (hit) {
    const $h = view.state.doc.resolve(hit.pos);
    for (let d = $h.depth; d > 0; d--) if ($h.node(d).isTextblock) { anchor = $h.before(d); break; }
  }
  if (anchor == null) anchor = view.state.selection.$from.before(1);
  const pdom = view.nodeDOM(anchor);
  const pr = pdom?.getBoundingClientRect?.() || { left: probeX, top };
  const x = (left - pr.left) / z;
  const y = Math.max(0, (top - pr.top) / z);
  const doc = view.state.doc;
  const ctx = { x, y, w, h, z: maxZ(doc) + 1 };
  let attrs;
  if (spec.textBox) attrs = textBoxAttrs({ ...ctx, name: uniqueName(doc, 'Text Box'), body: [para([])] });
  else attrs = shapeAttrs(spec.shape, { ...ctx, name: uniqueName(doc, 'Shape'), dir: { x: ex >= sx ? 1 : -1, y: ey >= sy ? 1 : -1 } });
  cancelDraw(c);
  insertObject(c, attrs, anchor + 1);
  c.store.set({ activeTab: 'shapeFormat' });
  if (spec.textBox) requestAnimationFrame(() => view.nodeDOM(view.state.selection.from)?.querySelector?.('.obj-text .ProseMirror')?.focus());
}

// ------------------------------------------------------------ equations

/** Insert ▸ Equation: a preset (latex) or the editor; with `edit`, changes the selected equation. */
export async function insertEquation(c, { latex = null, edit = false } = {}) {
  const { loadMathLive } = await import('../../core/mathlive-loader.js');
  const { equationDialog, measureMath } = await import('../../ui/equation-editor.js');
  const { formulaXml, equationAttrs, withFormula, objectPart, latexOf } = await import('../../core/equations.js');
  const sel = edit ? c.ui.objects.selected(c.editor) || c.ui.objects.selected(c.mainEditor) : null;
  let xml;
  if (latex != null) {
    try { const ml = await loadMathLive(); xml = formulaXml(ml.convertLatexToMathMl(latex), latex); } catch (e) { c.ui.toast?.(e.message); return; }
  } else {
    const r = await equationDialog(sel ? latexOf(objectPart(sel.node.attrs)?.['#files']?.['content.xml']) : '');
    if (!r) return;
    if (r.error) { c.ui.toast?.(r.error); return; }
    xml = r.xml;
  }
  const { w, h } = measureMath(xml);
  if (sel && sel.node.attrs.kind === 'equation') {
    const view = sel.view;
    const tr = view.state.tr.setNodeMarkup(sel.pos, null, withFormula(sel.node.attrs, xml, w, h));
    view.dispatch(tr);
    view.focus();
    return;
  }
  const doc = c.mainEditor.view.state.doc;
  const view = c.editor.view;
  const node = schema.nodes.frame.create(equationAttrs({ doc, state: c.session.state, xml, w, h }));
  view.dispatch(view.state.tr.replaceSelectionWith(node, false).scrollIntoView());
  view.focus();
}
