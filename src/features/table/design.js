/**
 * Table Design contextual tab: Table Style Options, Table Styles (gallery,
 * Shading) and Borders (border styles, line style / weight, pen colour,
 * Borders ▾, Border Painter).
 */
import { defineCommands } from '../define.js';
import {
  tableAt, applyTableStyle, tableStyleOptions, setCellProps, applyBorders,
} from '../../core/commands/tables.js';
import { inTable, V, docState, runCmd } from './shared.js';

const opt = (key) => ({
  isEnabled: inTable,
  isChecked: (c) => inTable(c) && tableStyleOptions(tableAt(V(c).state).table)[key],
  run: (c) => {
    const tt = tableAt(V(c).state);
    const o = tableStyleOptions(tt.table);
    runCmd(c, applyTableStyle, docState(c), o.style || 'grid', { [key]: !o[key] });
  },
});

const pen = (c) => { const p = c.state.tablePen; return `${p.width} ${p.style} ${p.colour}`; };
const setPen = (c, change) => c.store.set({ tablePen: { ...c.state.tablePen, ...change } });

const border = (kind, icon) => ({
  icon, isEnabled: inTable,
  run: (c) => { c.store.set({ lastTableBorder: kind }); runCmd(c, applyBorders, docState(c), kind, pen(c)); },
});

export const LINE_STYLES = [['solid', 'lineSolid'], ['dotted', 'lineDotted'], ['dashed', 'lineDashed'], ['double', 'lineDouble']];
export const LINE_WEIGHTS = ['0.25pt', '0.5pt', '0.75pt', '1pt', '1.5pt', '2.25pt', '3pt', '4.5pt', '6pt'];
const BORDER_STYLES = [
  ['0.5pt', 'solid', '#000000'], ['1.5pt', 'solid', '#000000'], ['0.5pt', 'double', '#000000'], ['0.5pt', 'dashed', '#000000'],
  ['0.75pt', 'solid', '#156082'], ['2.25pt', 'solid', '#156082'], ['0.75pt', 'solid', '#e97132'], ['0.5pt', 'dotted', '#7f7f7f'],
];

export const commands = defineCommands('tableDesign', {
  headerRow: opt('header'),
  totalRow: opt('total'),
  bandedRows: opt('bandedRows'),
  firstColumn: opt('firstCol'),
  lastColumn: opt('lastCol'),
  bandedColumns: opt('bandedCols'),
  tableStyle: {
    keywords: ['table style'], isEnabled: inTable,
    run: (c, id) => { if (typeof id === 'string') runCmd(c, applyTableStyle, docState(c), id); },
  },
  shading: {
    icon: 'shading', isEnabled: inTable,
    run: (c, colour) => { const col = typeof colour === 'string' ? colour : c.state.lastTableShading; c.store.set({ lastTableShading: col }); runCmd(c, setCellProps, docState(c), { 'fo:background-color': col }); },
  },
  shadingNone: { isEnabled: inTable, run: (c) => runCmd(c, setCellProps, docState(c), { 'fo:background-color': null }) },
  borderStyles: { icon: 'border-styles', menuOnly: true },
  ...Object.fromEntries(BORDER_STYLES.map(([w, s, col], i) => [`borderStyle${i + 1}`, { isEnabled: () => true, isChecked: (c) => c.state.tablePen.width === w && c.state.tablePen.style === s && c.state.tablePen.colour === col, run: (c) => { setPen(c, { width: w, style: s, colour: col }); c.store.set({ tableMode: 'paint' }); } }])),
  lineStyle: { icon: 'line-style', menuOnly: true },
  ...Object.fromEntries(LINE_STYLES.map(([s, id]) => [id, { isChecked: (c) => c.state.tablePen.style === s, run: (c) => setPen(c, { style: s }) }])),
  lineWeight: { icon: 'line-weight', menuOnly: true },
  ...Object.fromEntries(LINE_WEIGHTS.map((w) => [`weight${w.replace('.', '_').replace('pt', '')}`, { isChecked: (c) => c.state.tablePen.width === w, run: (c) => setPen(c, { width: w }) }])),
  penColour: { icon: 'pen-colour', run: (c, colour) => { if (typeof colour === 'string') setPen(c, { colour }); } },
  borders: { icon: 'borders', isEnabled: inTable, run: (c) => c.ui.registry.run(`tableDesign.border${c.state.lastTableBorder[0].toUpperCase()}${c.state.lastTableBorder.slice(1)}`) },
  borderBottom: border('bottom', 'border-bottom'),
  borderTop: border('top', 'border-top'),
  borderLeft: border('left', 'border-left'),
  borderRight: border('right', 'border-right'),
  borderNone: border('none', 'border-none'),
  borderAll: border('all', 'borders'),
  borderOutside: border('outside', 'border-outside'),
  borderInside: border('inside', 'border-inside'),
  borderInsideH: border('insideH', 'border-inside-h'),
  borderInsideV: border('insideV', 'border-inside-v'),
  borderPainter: { icon: 'border-painter', isEnabled: (c) => !!c.editor, isChecked: (c) => c.state.tableMode === 'paint', run: (c) => c.store.set({ tableMode: c.state.tableMode === 'paint' ? null : 'paint' }) },
});

export const ribbon = {
  id: 'tableDesign',
  keytip: 'JT',
  contextual: 'table',
  groups: [
    {
      id: 'styleOptions', icon: 'set-default',
      controls: [
        { t: 'col', items: [{ t: 'check', cmd: 'headerRow' }, { t: 'check', cmd: 'totalRow' }, { t: 'check', cmd: 'bandedRows' }] },
        { t: 'col', items: [{ t: 'check', cmd: 'firstColumn' }, { t: 'check', cmd: 'lastColumn' }, { t: 'check', cmd: 'bandedColumns' }] },
      ],
    },
    {
      id: 'tableStyles', icon: 'table',
      controls: [
        { t: 'gallery', id: 'tableStyles', cmd: 'tableStyle' },
        { t: 'large', cmd: 'shading', split: true, menu: [{ custom: 'colourPalette', cmd: 'shading' }, '-', 'shadingNone'] },
      ],
    },
    {
      id: 'borders', icon: 'borders',
      controls: [
        { t: 'large', cmd: 'borderStyles', menu: [{ custom: 'borderStyleGallery' }] },
        { t: 'col', items: [
          { cmd: 'lineStyle', menu: LINE_STYLES.map(([, id]) => id) },
          { cmd: 'lineWeight', menu: LINE_WEIGHTS.map((w) => `weight${w.replace('.', '_').replace('pt', '')}`) },
          { cmd: 'penColour', menu: [{ custom: 'colourPalette', cmd: 'penColour' }] },
        ] },
        { t: 'large', cmd: 'borders', split: true, menu: ['borderBottom', 'borderTop', 'borderLeft', 'borderRight', '-', 'borderNone', 'borderAll', 'borderOutside', 'borderInside', 'borderInsideH', 'borderInsideV'] },
        { t: 'large', cmd: 'borderPainter', label: 'label.tableDesign.borderPainter' },
      ],
    },
  ],
};

export { BORDER_STYLES };
export function register(registry) { registry.register(commands); }
