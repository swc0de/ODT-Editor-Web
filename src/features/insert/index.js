/** Insert tab: Pages, Tables, Illustrations, Links, Comments, Header & Footer, Text, Symbols. */
import { defineCommands } from '../define.js';
import { applyPreset, pageNumberAt, removePageNumbers, fields, insertInline, pageNumberFormat, setPageNumberFormat } from '../headerfooter/actions.js';
import { insertDateTime } from '../headerfooter/index.js';
import { pageNumberDialog } from '../../ui/layout-dialogs.js';
import { insertNewTable, convertSelectionToTable, insertQuickTable } from '../table/insert.js';
import { insertTableDialog } from '../../ui/table-dialogs.js';
import { startDraw, insertTextBox, insertWordArt, dropCapOf, setDropCap, insertEquation, insertChart } from './objects.js';
import { EQUATION_PRESETS } from '../../core/equations.js';
import { dropCapDialog } from '../../ui/object-dialogs.js';
import { iconsDialog, iconSvgText } from '../../ui/icons-dialog.js';
import { symbolDialog, rememberSymbol } from '../../ui/symbol-dialog.js';
import { TextSelection } from 'prosemirror-state';
import { editLink, linkAt, bookmarks, DOC_PROPERTIES, fieldDialogRun, saveAutoText, insertAutoText, signatureLine, textFromFile, insertCoverPage, removeCoverPage, hasCoverPage, blankPage } from './text-parts.js';

const canEdit = (c) => !!c.editor && c.state.editingMode !== 'viewing';
const isKind = (c, k) => { const s = c.ui.objects?.selected(c.editor) || c.ui.objects?.selected(c.mainEditor); return s?.node.attrs.kind === k; };
const isEquation = (c) => { const s = c.ui.objects?.selected(c.editor) || c.ui.objects?.selected(c.mainEditor); return s?.node.attrs.kind === 'equation'; };

export const commands = defineCommands('insert', {
  coverPage: { icon: 'cover-page', isEnabled: canEdit, menuOnly: true },
  insertCoverPage: { label: 'cmd.insert.coverPage', isEnabled: canEdit, run: (c, id) => { if (typeof id === 'string') insertCoverPage(c, id); } },
  removeCoverPage: { isEnabled: (c) => canEdit(c) && hasCoverPage(c), run: removeCoverPage },
  blankPage: { icon: 'blank-page', isEnabled: (c) => canEdit(c) && !c.state.hfEditing, run: blankPage },
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
  icons: { icon: 'icons', isEnabled: canEdit, run: insertIcons },
  smartArt: { icon: 'smartart' },
  chart: { icon: 'chart', isEnabled: canEdit, run: (c) => insertChart(c, { edit: isKind(c, 'chart') }) },
  editChart: { icon: 'chart', isEnabled: (c) => canEdit(c) && isKind(c, 'chart'), run: (c) => insertChart(c, { edit: true }) },
  link: { icon: 'link', shortcut: 'Mod-k', isEnabled: canEdit, run: editLink },
  removeLink: { icon: 'unlink', isEnabled: (c) => canEdit(c) && !!linkAt(c.editor.view.state), run: (c) => { const l = linkAt(c.editor.view.state); if (l) { const v = c.editor.view; v.dispatch(v.state.tr.removeMark(l.from, l.to, v.state.schema.marks.link)); c.editor.focus(); } } },
  bookmark: { icon: 'bookmark', isEnabled: canEdit, run: bookmarks },
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
  quickParts: { icon: 'quick-parts', isEnabled: canEdit, menuOnly: true },
  autoText: { isEnabled: canEdit, menuOnly: true },
  autoTextEntry: { label: 'cmd.insert.autoText', isEnabled: canEdit, run: (c, name) => { if (typeof name === 'string') insertAutoText(c, name); } },
  saveAutoText: { isEnabled: (c) => canEdit(c) && !c.editor.view.state.selection.empty, run: saveAutoText },
  documentProperty: { isEnabled: canEdit, menuOnly: true },
  ...Object.fromEntries(Object.keys(DOC_PROPERTIES).map((k) => [`docProp${k[0].toUpperCase()}${k.slice(1)}`, { isEnabled: canEdit, run: (c) => insertInline(c, DOC_PROPERTIES[k](c)) }])),
  field: { isEnabled: canEdit, run: fieldDialogRun },
  wordArt: { icon: 'wordart', isEnabled: canEdit, menuOnly: true },
  insertWordArt: { label: 'cmd.insert.wordArt', isEnabled: canEdit, run: (c, id) => insertWordArt(c, typeof id === 'string' ? id : 'blackShadow') },
  dropCap: { icon: 'drop-cap', isEnabled: canEdit, menuOnly: true },
  dropCapNone: { isEnabled: canEdit, isChecked: (c) => !dropCapOf(c.editor.view.state).lines, run: (c) => setDropCap(c, { lines: 0 }) },
  dropCapDropped: { isEnabled: canEdit, isChecked: (c) => dropCapOf(c.editor.view.state).lines > 1, run: (c) => setDropCap(c, { lines: 3, length: 1 }) },
  dropCapInMargin: {},
  dropCapOptions: { isEnabled: canEdit, run: async (c) => { const r = await dropCapDialog(dropCapOf(c.editor.view.state)); if (r) setDropCap(c, r); } },
  signatureLine: { icon: 'signature-line', isEnabled: canEdit, run: signatureLine },
  dateTime: { icon: 'date-time', isEnabled: canEdit, run: insertDateTime },
  object: { icon: 'object', isEnabled: canEdit, menuOnly: true },
  objectEmbed: {},
  textFromFile: { isEnabled: canEdit, run: textFromFile },
  equation: { icon: 'equation', isEnabled: canEdit, run: (c) => insertEquation(c, { edit: isEquation(c) }) },
  insertNewEquation: { shortcut: 'Alt-=', isEnabled: canEdit, run: (c) => insertEquation(c, { edit: isEquation(c) }) },
  insertEquationPreset: { label: 'cmd.insert.equation', isEnabled: canEdit, run: (c, id) => { if (EQUATION_PRESETS[id]) insertEquation(c, { latex: EQUATION_PRESETS[id] }); } },
  editEquation: { icon: 'equation', isEnabled: (c) => canEdit(c) && isEquation(c), run: (c) => insertEquation(c, { edit: true }) },
  inkEquation: {},
  symbol: { icon: 'symbol', isEnabled: canEdit, menuOnly: true },
  insertSymbol: { label: 'cmd.insert.symbol', isEnabled: canEdit, run: (c, ch) => { if (typeof ch === 'string') insertSymbol(c, ch); } },
  moreSymbols: { icon: 'symbol', isEnabled: canEdit, run: async (c) => { const r = await symbolDialog(); if (r) insertSymbol(c, r.char, r.font); } },
  unicodeToggle: { shortcut: 'Alt-x', isEnabled: canEdit, run: unicodeToggle },
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
          { cmd: 'quickParts', menu: [{ cmd: 'autoText', sub: [{ custom: 'autoTextGallery' }, '-', 'saveAutoText'] }, { cmd: 'documentProperty', sub: Object.keys(DOC_PROPERTIES).map((k) => `docProp${k[0].toUpperCase()}${k.slice(1)}`) }, 'field', '-', 'saveAutoText'] },
          { cmd: 'wordArt', menu: [{ custom: 'wordArtGallery' }] },
          { cmd: 'dropCap', menu: ['dropCapNone', 'dropCapDropped', 'dropCapInMargin', '-', 'dropCapOptions'] },
        ] },
        { t: 'col', items: [{ cmd: 'signatureLine', iconOnly: true }, { cmd: 'dateTime', iconOnly: true }, { cmd: 'object', iconOnly: true, menu: ['objectEmbed', 'textFromFile'] }] },
      ],
    },
    {
      id: 'symbols', icon: 'symbol',
      controls: [
        { t: 'large', cmd: 'equation', split: true, menu: [{ custom: 'equationGallery' }, '-', 'insertNewEquation', 'editEquation', 'inkEquation'] },
        { t: 'large', cmd: 'symbol', menu: [{ custom: 'symbolGrid' }, '-', 'moreSymbols'] },
      ],
    },
  ],
};

/** Inserts a character (optionally in a font) and remembers it as recently used. */
function insertSymbol(c, ch, font = null) {
  const v = c.editor.view;
  const from = v.state.selection.from;
  v.dispatch(v.state.tr.insertText(ch).scrollIntoView());
  if (font) {
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, from, from + ch.length)));
    c.ui.registry.run('home.fontName', font);
    const v2 = c.editor.view;
    v2.dispatch(v2.state.tr.setSelection(TextSelection.create(v2.state.doc, from + ch.length)));
  }
  rememberSymbol(ch);
  c.editor.focus();
}

/**
 * Alt+X: hex digits before the caret (or U+hex) become that character;
 * otherwise the character before the caret becomes its code.
 */
function unicodeToggle(c) {
  const v = c.editor.view;
  const { $from, empty, from, to } = v.state.selection;
  if (!$from.parent.isTextblock) return;
  if (!empty) {
    const txt = v.state.doc.textBetween(from, to);
    const cp = txt.codePointAt(0);
    if (/^(u\+)?[0-9a-f]{2,6}$/i.test(txt)) { const n = parseInt(txt.replace(/^u\+/i, ''), 16); if (n > 31 && n < 0x110000) v.dispatch(v.state.tr.insertText(String.fromCodePoint(n), from, to)); } else if (cp != null && txt.length === String.fromCodePoint(cp).length) v.dispatch(v.state.tr.insertText(cp.toString(16).toUpperCase().padStart(4, '0'), from, to));
    return;
  }
  const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 8), $from.parentOffset, '\ufffc', '\ufffc');
  const m = /(?:u\+)?([0-9a-fA-F]{2,6})$/i.exec(before);
  if (m) {
    const n = parseInt(m[1], 16);
    if (n > 31 && n < 0x110000 && !(n >= 0xd800 && n < 0xe000)) { v.dispatch(v.state.tr.insertText(String.fromCodePoint(n), from - m[0].length, from)); return; }
  }
  const tail = [...before].pop();
  if (!tail || tail === '\ufffc') return;
  v.dispatch(v.state.tr.insertText(tail.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'), from - tail.length, from));
}

/** Insert ▸ Icons: chosen icons as SVG pictures (2.54 cm). */
async function insertIcons(c) {
  const names = await iconsDialog();
  if (!names?.length) return;
  const files = names.map((n) => new File([iconSvgText(n)], `${n}.svg`, { type: 'image/svg+xml' }));
  await c.ui.objects.insertPictures(files);
}

/** Insert ▸ Pictures ▸ This Device: picks picture files and inserts them in line with text. */
async function insertPictureFiles(c) {
  const files = await c.ui.pickFile('image/png,image/jpeg,image/gif,image/svg+xml,image/webp,image/bmp', { multiple: true });
  if (files?.length) await c.ui.objects.insertPictures(files);
}

export function register(registry) { registry.register(commands); }
