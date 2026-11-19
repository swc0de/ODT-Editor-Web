/** Insert tab: Pages, Tables, Illustrations, Links, Comments, Header & Footer, Text, Symbols. */
import { defineCommands } from '../define.js';
import { applyPreset, pageNumberAt, removePageNumbers, fields, insertInline, pageNumberFormat, setPageNumberFormat } from '../headerfooter/actions.js';
import { insertDateTime } from '../headerfooter/index.js';
import { pageNumberDialog } from '../../ui/layout-dialogs.js';
import { insertNewTable, convertSelectionToTable, insertQuickTable } from '../table/insert.js';
import { insertTableDialog } from '../../ui/table-dialogs.js';
import { startDraw, insertTextBox, insertWordArt, dropCapOf, setDropCap } from './objects.js';
import { dropCapDialog } from '../../ui/object-dialogs.js';

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
  pictures: { icon: 'pictures', isEnabled: canEdit, run: (c) => insertPictureFiles(c) },
  picturesFromDevice: { icon: 'pictures', isEnabled: canEdit, run: (c) => insertPictureFiles(c) },
  stockImages: {},
  onlinePictures: {},
  shapes: { icon: 'shapes', isEnabled: canEdit, menuOnly: true },
  insertShape: { label: 'cmd.insert.shapes', isEnabled: canEdit, isChecked: (c) => !!c.state.objectDraw && c.state.objectDraw !== 'textBox', run: (c, id) => { if (typeof id === 'string') startDraw(c, { shape: id }); } },
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
  textBox: { icon: 'text-box', isEnabled: canEdit, menuOnly: true },
  insertTextBox: { isEnabled: canEdit, run: (c, id) => insertTextBox(c, typeof id === 'string' ? id : 'simple') },
  textBoxSimple: { isEnabled: canEdit, run: (c) => insertTextBox(c, 'simple') },
  drawTextBox: { isEnabled: canEdit, isChecked: (c) => c.state.objectDraw === 'textBox', run: (c) => startDraw(c, { textBox: true }) },
  quickParts: { icon: 'quick-parts' },
  autoText: {},
  documentProperty: {},
  field: {},
  wordArt: { icon: 'wordart', isEnabled: canEdit, menuOnly: true },
  insertWordArt: { label: 'cmd.insert.wordArt', isEnabled: canEdit, run: (c, id) => insertWordArt(c, typeof id === 'string' ? id : 'blackShadow') },
  dropCap: { icon: 'drop-cap', isEnabled: canEdit, menuOnly: true },
  dropCapNone: { isEnabled: canEdit, isChecked: (c) => !dropCapOf(c.editor.view.state).lines, run: (c) => setDropCap(c, { lines: 0 }) },
  dropCapDropped: { isEnabled: canEdit, isChecked: (c) => dropCapOf(c.editor.view.state).lines > 1, run: (c) => setDropCap(c, { lines: 3, length: 1 }) },
  dropCapInMargin: {},
  dropCapOptions: { isEnabled: canEdit, run: async (c) => { const r = await dropCapDialog(dropCapOf(c.editor.view.state)); if (r) setDropCap(c, r); } },
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
        { t: 'large', cmd: 'pictures', menu: ['picturesFromDevice', 'stockImages', 'onlinePictures'] },
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
        { t: 'large', cmd: 'textBox', label: 'label.insert.textBox', menu: [{ custom: 'textBoxGallery' }, '-', 'drawTextBox'] },
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

/** Insert ▸ Pictures ▸ This Device: picks picture files and inserts them in line with text. */
async function insertPictureFiles(c) {
  const files = await c.ui.pickFile('image/png,image/jpeg,image/gif,image/svg+xml,image/webp,image/bmp', { multiple: true });
  if (files?.length) await c.ui.objects.insertPictures(files);
}

export function register(registry) { registry.register(commands); }
