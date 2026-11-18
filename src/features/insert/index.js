/** Insert tab: Pages, Tables, Illustrations, Links, Comments, Header & Footer, Text, Symbols. */
import { defineCommands } from '../define.js';
import { applyPreset, pageNumberAt, removePageNumbers, fields, insertInline, pageNumberFormat, setPageNumberFormat } from '../headerfooter/actions.js';
import { insertDateTime } from '../headerfooter/index.js';
import { pageNumberDialog } from '../../ui/layout-dialogs.js';
import { insertNewTable, convertSelectionToTable, insertQuickTable } from '../table/insert.js';
import { insertTableDialog } from '../../ui/table-dialogs.js';

const canEdit = (c) => !!c.editor && c.state.editingMode !== 'viewing';

export const commands = defineCommands('insert', {
  coverPage: { icon: 'cover-page' },
  removeCoverPage: {},
  blankPage: { icon: 'blank-page' },
  pageBreak: { icon: 'page-break', shortcut: 'Mod-Enter', isEnabled: (c) => canEdit(c) && !c.state.hfEditing, run: (c) => c.ui.registry.run('layout.breakPage') },
  table: { icon: 'table', menuOnly: true },
  tableGrid: { label: 'cmd.insert.table', isEnabled: canEdit, run: (c, size) => { if (size?.cols) insertNewTable(c, size.rows, size.cols); } },
  insertTableDialog: { icon: 'table', isEnabled: canEdit, run: async (c) => { const r = await insertTableDialog(); if (r) insertNewTable(c, r.rows, r.cols, r.fit); } },
  drawTable: { icon: 'draw-table', isEnabled: canEdit, isChecked: (c) => c.state.tableMode === 'draw', run: (c) => c.store.set({ tableMode: c.state.tableMode === 'draw' ? null : 'draw' }) },
  convertTextToTable: { isEnabled: (c) => canEdit(c) && !c.editor.view.state.selection.empty, run: convertSelectionToTable },
  quickTables: { isEnabled: canEdit, run: (c, id) => { if (typeof id === 'string') insertQuickTable(c, id); } },
  pictures: { icon: 'pictures' },
  picturesFromDevice: { icon: 'pictures' },
  shapes: { icon: 'shapes' },
  insertShape: { label: 'cmd.insert.shapes' },
  newDrawingCanvas: {},
  icons: { icon: 'icons' },
  smartArt: { icon: 'smartart' },
  chart: { icon: 'chart' },
  link: { icon: 'link', shortcut: 'Mod-k' },
  bookmark: { icon: 'bookmark' },
  crossReference: { icon: 'cross-reference' },
  comment: { icon: 'comment', shortcut: 'Mod-Alt-m' },
  header: { icon: 'header', isEnabled: canEdit, run: (c, preset) => (typeof preset === 'string' ? applyPreset(c, 'header', preset) : c.ui.hf.open({ part: 'header' })) },
  editHeader: { isEnabled: canEdit, run: (c) => c.ui.hf.open({ part: 'header' }) },
  removeHeader: { isEnabled: canEdit, run: (c) => c.ui.hf.remove('header') },
  footer: { icon: 'footer', isEnabled: canEdit, run: (c, preset) => (typeof preset === 'string' ? applyPreset(c, 'footer', preset) : c.ui.hf.open({ part: 'footer' })) },
  editFooter: { isEnabled: canEdit, run: (c) => c.ui.hf.open({ part: 'footer' }) },
  removeFooter: { isEnabled: canEdit, run: (c) => c.ui.hf.remove('footer') },
  pageNumber: { icon: 'page-number', menuOnly: true },
  pageNumberTop: { menuOnly: true },
  pageNumberTopLeft: { isEnabled: canEdit, run: (c) => pageNumberAt(c, 'header', 'start') },
  pageNumberTopCentre: { isEnabled: canEdit, run: (c) => pageNumberAt(c, 'header', 'center') },
  pageNumberTopRight: { isEnabled: canEdit, run: (c) => pageNumberAt(c, 'header', 'end') },
  pageNumberBottom: { menuOnly: true },
  pageNumberBottomLeft: { isEnabled: canEdit, run: (c) => pageNumberAt(c, 'footer', 'start') },
  pageNumberBottomCentre: { isEnabled: canEdit, run: (c) => pageNumberAt(c, 'footer', 'center') },
  pageNumberBottomRight: { isEnabled: canEdit, run: (c) => pageNumberAt(c, 'footer', 'end') },
  pageNumberMargins: {},
  pageNumberCurrent: { isEnabled: canEdit, run: (c) => insertInline(c, fields.pageNumber(c)) },
  pageNumberFormat: { isEnabled: canEdit, run: async (c) => { const r = await pageNumberDialog(pageNumberFormat(c)); if (r) setPageNumberFormat(c, r); } },
  removePageNumbers: { isEnabled: canEdit, run: removePageNumbers },
  textBox: { icon: 'text-box' },
  drawTextBox: {},
  quickParts: { icon: 'quick-parts' },
  autoText: {},
  documentProperty: {},
  field: {},
  wordArt: { icon: 'wordart' },
  dropCap: { icon: 'drop-cap' },
  dropCapNone: {},
  dropCapDropped: {},
  dropCapInMargin: {},
  dropCapOptions: {},
  signatureLine: { icon: 'signature-line' },
  dateTime: { icon: 'date-time', isEnabled: canEdit, run: insertDateTime },
  object: { icon: 'object' },
  textFromFile: {},
  equation: { icon: 'equation' },
  insertNewEquation: { shortcut: 'Alt-=' },
  inkEquation: {},
  symbol: { icon: 'symbol' },
  insertSymbol: { label: 'cmd.insert.symbol' },
  moreSymbols: { icon: 'symbol' },
  unicodeToggle: { shortcut: 'Alt-x' },
});

export const ribbon = {
  id: 'insert',
  keytip: 'N',
  groups: [
    { id: 'pages', icon: 'blank-page', controls: [{ t: 'col', items: [{ cmd: 'coverPage', menu: [{ custom: 'coverPages' }, '-', 'removeCoverPage'] }, { cmd: 'blankPage' }, { cmd: 'pageBreak' }] }] },
    { id: 'tables', icon: 'table', controls: [{ t: 'large', cmd: 'table', menu: [{ custom: 'tableGrid' }, '-', 'insertTableDialog', 'drawTable', 'convertTextToTable', { cmd: 'quickTables', sub: [{ custom: 'quickTables' }] }] }] },
    {
      id: 'illustrations', icon: 'pictures',
      controls: [
        { t: 'large', cmd: 'pictures' },
        { t: 'large', cmd: 'shapes', menu: [{ custom: 'shapesGallery' }, '-', 'newDrawingCanvas'] },
        { t: 'col', items: [{ cmd: 'icons' }, { cmd: 'smartArt' }, { cmd: 'chart' }] },
      ],
    },
    { id: 'links', icon: 'link', controls: [{ t: 'col', items: [{ cmd: 'link' }, { cmd: 'bookmark' }, { cmd: 'crossReference' }] }] },
    { id: 'comments', icon: 'comment', controls: [{ t: 'large', cmd: 'comment' }] },
    {
      id: 'headerFooter', icon: 'header',
      controls: [
        { t: 'large', cmd: 'header', menu: [{ custom: 'headerGallery' }, '-', 'editHeader', 'removeHeader'] },
        { t: 'large', cmd: 'footer', menu: [{ custom: 'footerGallery' }, '-', 'editFooter', 'removeFooter'] },
        { t: 'large', cmd: 'pageNumber', label: 'label.insert.pageNumber', menu: [{ cmd: 'pageNumberTop', sub: ['pageNumberTopLeft', 'pageNumberTopCentre', 'pageNumberTopRight'] }, { cmd: 'pageNumberBottom', sub: ['pageNumberBottomLeft', 'pageNumberBottomCentre', 'pageNumberBottomRight'] }, 'pageNumberMargins', 'pageNumberCurrent', '-', 'pageNumberFormat', 'removePageNumbers'] },
      ],
    },
    {
      id: 'text', icon: 'text-box',
      controls: [
        { t: 'large', cmd: 'textBox', label: 'label.insert.textBox' },
        { t: 'col', items: [
          { cmd: 'quickParts', menu: ['autoText', 'documentProperty', 'field'] },
          { cmd: 'wordArt', menu: [{ custom: 'wordArtGallery' }] },
          { cmd: 'dropCap', menu: ['dropCapNone', 'dropCapDropped', 'dropCapInMargin', '-', 'dropCapOptions'] },
        ] },
        { t: 'col', items: [{ cmd: 'signatureLine', iconOnly: true }, { cmd: 'dateTime', iconOnly: true }, { cmd: 'object', iconOnly: true }] },
      ],
    },
    {
      id: 'symbols', icon: 'symbol',
      controls: [
        { t: 'large', cmd: 'equation', split: true, menu: [{ custom: 'equationGallery' }, '-', 'insertNewEquation', 'inkEquation'] },
        { t: 'large', cmd: 'symbol', menu: [{ custom: 'symbolGrid' }, '-', 'moreSymbols'] },
      ],
    },
  ],
};

export function register(registry) { registry.register(commands); }
