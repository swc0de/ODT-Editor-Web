/**
 * Draw tab: Drawing Tools (Select, Lasso, Eraser, Pen, Pencil, Highlighter,
 * Add Pen, colour and thickness), Convert (Ink to Shape; Ink to Math stays
 * unavailable), Insert (Drawing Canvas), Replay (Ink Replay).
 */
import { defineCommands } from '../define.js';
import { t } from '../../i18n/index.js';
import { penSettings, setPen } from '../../ui/ink.js';
import { canvasAttrs, centreLine, recognise, CM } from '../../core/ink.js';
import { maxZ, uniqueName, withGraphic } from '../../core/objects.js';
import { insertObject, shapeAttrs } from '../insert/objects.js';
import { getSetting, setSetting } from '../../core/settings.js';
import { schema } from '../../core/schema.js';

const canEdit = (c) => !!c.mainEditor && c.state.editingMode !== 'viewing';
const PENS = ['pen', 'pencil', 'highlighter'];
/** The pen the colour and thickness apply to: the current one, or the pen. */
const currentPen = (c) => (PENS.includes(c.state.drawTool) ? c.state.drawTool : 'pen');

const tool = (id) => ({
  isEnabled: id === 'select' ? () => true : canEdit,
  isChecked: (c) => c.state.drawTool === id,
  run: (c) => { c.store.set({ drawTool: id }); if (id === 'select') c.mainEditor?.focus(); },
});

/** Saved pens (Add Pen): [{ tool, colour, width }]. */
export const savedPens = () => getSetting('inkPresets') || [];
const addPen = (kind) => ({
  isEnabled: canEdit,
  run: (c) => {
    const p = penSettings()[kind];
    setSetting('inkPresets', [...savedPens(), { tool: kind, colour: p.colour, width: p.width }].slice(-12));
    c.store.set({ drawTool: kind });
    c.ui.toast?.(t('ink.penAdded'));
  },
});

/** Ink to Shape on the lasso selection: each stroke that looks like a shape becomes one. */
function convertSelection(c) {
  const sel = c.ui.ink?.selection || [];
  if (!sel.length) return false;
  const view = c.mainEditor.view;
  const tr = view.state.tr;
  let converted = 0;
  for (const s of [...sel].sort((a, b) => b.pos - a.pos)) {
    const n = tr.doc.nodeAt(s.pos);
    if (!n || n.attrs.kind !== 'ink') continue;
    const fa = n.attrs.frameAttrs;
    const vb = String(fa['svg:viewBox'] || '').split(/\s+/).map(Number);
    const w = (parseFloat(fa['svg:width']) || 0) * CM;
    const h = (parseFloat(fa['svg:height']) || 0) * CM;
    const ox = (parseFloat(fa['svg:x']) || 0) * CM;
    const oy = (parseFloat(fa['svg:y']) || 0) * CM;
    const pts = centreLine(fa).map((p) => ({ x: ox + (p.x * w) / (vb[2] || 1), y: oy + (p.y * h) / (vb[3] || 1) }));
    const shape = recognise(pts);
    if (!shape) continue;
    const gp = n.attrs.auto?.props?.['style:graphic-properties']?.a || {};
    const colour = gp['svg:stroke-color'] || gp['draw:fill-color'] || '#000000';
    const box = shape.from ? { x: Math.min(shape.from.x, shape.to.x), y: Math.min(shape.from.y, shape.to.y), w: Math.abs(shape.to.x - shape.from.x), h: Math.abs(shape.to.y - shape.from.y) } : shape.box;
    let attrs = shapeAttrs({ line: 'line', arrow: 'arrow', rectangle: 'rectangle', ellipse: 'ellipse', triangle: 'triangle' }[shape.type], { ...box, name: uniqueName(tr.doc, 'Shape'), z: Number(fa['draw:z-index'] || maxZ(tr.doc) + 1), dir: shape.from ? { x: shape.to.x >= shape.from.x ? 1 : -1, y: shape.to.y >= shape.from.y ? 1 : -1 } : undefined });
    attrs = withGraphic(attrs, { 'draw:fill': 'none', 'draw:stroke': 'solid', 'svg:stroke-color': colour, 'svg:stroke-width': gp['svg:stroke-width'] || '0.05cm' });
    tr.replaceWith(s.pos, s.pos + n.nodeSize, schema.nodes.frame.create(attrs));
    converted++;
  }
  if (converted) view.dispatch(tr);
  c.ui.ink.clearLasso();
  return converted > 0;
}

export const commands = defineCommands('draw', {
  select: { icon: 'draw-select', ...tool('select') },
  lasso: { icon: 'lasso', ...tool('lasso') },
  eraser: { icon: 'eraser', ...tool('eraser') },
  pen: { icon: 'pen', ...tool('pen') },
  pencil: { icon: 'pencil', ...tool('pencil') },
  highlighter: { icon: 'highlighter-pen', ...tool('highlighter') },
  addPen: { icon: 'add-pen', isEnabled: canEdit, menuOnly: true },
  addPenPen: addPen('pen'),
  addPenPencil: addPen('pencil'),
  addPenHighlighter: addPen('highlighter'),
  /** A saved pen (index into the saved pens). */
  usePen: {
    isEnabled: (c) => canEdit(c) && savedPens().length > 0,
    // Without an index: the most recently saved pen.
    run: (c, i) => { const list = savedPens(); const p = list[typeof i === 'number' ? i : list.length - 1]; if (!p) return; setPen(p.tool, { colour: p.colour, width: p.width }); c.store.set({ drawTool: p.tool }); c.ui.refreshRibbon?.(); },
  },
  penColour: { icon: 'pen-colour', isEnabled: canEdit, run: (c, colour) => { if (typeof colour !== 'string') return; setPen(currentPen(c), { colour }); if (!PENS.includes(c.state.drawTool)) c.store.set({ drawTool: 'pen' }); c.ui.refreshRibbon?.(); } },
  penThickness: { icon: 'pen-thickness', isEnabled: canEdit, run: (c, mm) => { if (typeof mm !== 'number') return; setPen(currentPen(c), { width: mm }); if (!PENS.includes(c.state.drawTool)) c.store.set({ drawTool: 'pen' }); } },
  inkToShape: {
    icon: 'ink-to-shape', isEnabled: canEdit, isChecked: (c) => !!c.state.inkToShape,
    // With strokes selected by the lasso: convert them. Otherwise: new strokes become shapes.
    run: (c) => { if (!convertSelection(c)) c.store.set((s) => ({ inkToShape: !s.inkToShape, drawTool: !s.inkToShape && !PENS.includes(s.drawTool) ? 'pen' : s.drawTool })); },
  },
  inkToMath: { icon: 'ink-to-math', isEnabled: () => false, comingSoon: false, unavailable: true, run: () => false },
  drawingCanvas: {
    icon: 'drawing-canvas', isEnabled: canEdit,
    run: (c) => {
      const doc = c.mainEditor.view.state.doc;
      const w = Math.min(15.24 * CM, c.ui.docArea.model?.first?.bodyWidth || 15.24 * CM);
      insertObject(c, canvasAttrs({ x: 0, y: 0, w, h: 7.62 * CM, name: uniqueName(doc, 'Drawing Canvas'), z: maxZ(doc) + 1 }));
      c.store.set({ drawTool: 'pen' });
    },
  },
  inkReplay: { icon: 'ink-replay', isEnabled: (c) => !!c.mainEditor, isChecked: (c) => !!c.state.inkReplaying, run: (c) => (c.state.inkReplaying ? c.ui.ink.stopReplay() : c.ui.ink.replay()) },
});

export const ribbon = {
  id: 'draw',
  keytip: 'JI',
  groups: [
    {
      id: 'drawingTools', icon: 'pen',
      controls: [
        { t: 'large', cmd: 'select', oneLine: true },
        { t: 'large', cmd: 'lasso', oneLine: true },
        { t: 'large', cmd: 'eraser', oneLine: true },
        { t: 'large', cmd: 'pen', oneLine: true },
        { t: 'large', cmd: 'pencil', oneLine: true },
        { t: 'large', cmd: 'highlighter', oneLine: true },
        { t: 'large', cmd: 'addPen', label: 'label.draw.addPen', menu: [{ custom: 'savedPens' }, 'addPenPen', 'addPenPencil', 'addPenHighlighter'] },
        { t: 'col', items: [{ cmd: 'penColour', iconOnly: true, menu: [{ custom: 'colourPalette', cmd: 'penColour' }] }, { cmd: 'penThickness', iconOnly: true, menu: [{ custom: 'thicknessList', cmd: 'penThickness' }] }] },
      ],
    },
    { id: 'convert', icon: 'ink-to-shape', controls: [{ t: 'large', cmd: 'inkToShape', label: 'label.draw.inkToShape' }, { t: 'large', cmd: 'inkToMath', label: 'label.draw.inkToMath' }] },
    { id: 'insert', icon: 'drawing-canvas', controls: [{ t: 'large', cmd: 'drawingCanvas', label: 'label.draw.drawingCanvas' }] },
    { id: 'replay', icon: 'ink-replay', controls: [{ t: 'large', cmd: 'inkReplay', label: 'label.draw.inkReplay' }] },
  ],
};

export function register(registry) { registry.register(commands); }
