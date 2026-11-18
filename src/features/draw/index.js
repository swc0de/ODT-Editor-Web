/** Draw tab: Drawing Tools, Convert, Insert, Replay. Inking itself arrives in M10. */
import { defineCommands } from '../define.js';

export const commands = defineCommands('draw', {
  // Select = ordinary text selection, the default tool. It is real now.
  select: {
    icon: 'draw-select',
    run: (ctx) => ctx.store.set({ drawTool: 'select' }),
    isChecked: (ctx) => ctx.state.drawTool === 'select',
  },
  lasso: { icon: 'lasso' },
  eraser: { icon: 'eraser' },
  pen: { icon: 'pen' },
  pencil: { icon: 'pencil' },
  highlighter: { icon: 'highlighter-pen' },
  addPen: { icon: 'add-pen' },
  addPenPen: {},
  addPenPencil: {},
  addPenHighlighter: {},
  penColour: { icon: 'pen-colour' },
  penThickness: { icon: 'pen-thickness' },
  inkToShape: { icon: 'ink-to-shape' },
  inkToMath: { icon: 'ink-to-math', isEnabled: () => false, comingSoon: false, unavailable: true, run: () => false },
  drawingCanvas: { icon: 'drawing-canvas' },
  inkReplay: { icon: 'ink-replay' },
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
        { t: 'large', cmd: 'addPen', label: 'label.draw.addPen', menu: ['addPenPen', 'addPenPencil', 'addPenHighlighter'] },
        { t: 'col', items: [{ cmd: 'penColour', iconOnly: true, menu: [{ custom: 'colourPalette' }] }, { cmd: 'penThickness', iconOnly: true, menu: [{ custom: 'thicknessList' }] }] },
      ],
    },
    { id: 'convert', icon: 'ink-to-shape', controls: [{ t: 'large', cmd: 'inkToShape', label: 'label.draw.inkToShape' }, { t: 'large', cmd: 'inkToMath', label: 'label.draw.inkToMath' }] },
    { id: 'insert', icon: 'drawing-canvas', controls: [{ t: 'large', cmd: 'drawingCanvas', label: 'label.draw.drawingCanvas' }] },
    { id: 'replay', icon: 'ink-replay', controls: [{ t: 'large', cmd: 'inkReplay', label: 'label.draw.inkReplay' }] },
  ],
};

export function register(registry) { registry.register(commands); }
