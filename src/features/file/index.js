/**
 * File tab: opens the Backstage. File commands (New/Open/Save…) are wired up
 * in M2; Backstage navigation is built now.
 */
import { defineCommands } from '../define.js';
import { EXPORTS, exportAs, copyAsHtml, canShareFiles, shareNative } from './export.js';
import { compatibilityDialog } from '../../ui/save-dialogs.js';
import { showDialog } from '../../ui/dialog.js';
import { formatById, TEMPLATE_FORMATS } from '../../core/formats.js';
import { t } from '../../i18n/index.js';

/** File ▸ Save as Template: Word Template (*.dotx, the default) or OpenDocument Template (*.ott). */
async function saveAsTemplate(ctx) {
  const id = await showDialog({
    title: t('tpl.title'), message: t('tpl.message'),
    buttons: [...TEMPLATE_FORMATS.map((f, i) => ({ label: t(f.labelKey), value: f.id, primary: i === 0 })), { label: t('common.cancel'), value: null }],
    cancelValue: null,
  });
  if (id) return ctx.session.saveAs({ format: id, direct: true });
  return false;
}

const openPage = (page) => (ctx) => ctx.store.set({ backstageOpen: true, backstagePage: page, ribbonPeek: false });

export const commands = defineCommands('file', {
  backstage: { icon: 'file', run: openPage('home'), keywords: ['file menu', 'backstage'] },
  closeBackstage: { icon: 'back', run: (ctx) => ctx.store.set({ backstageOpen: false }), isEnabled: (ctx) => ctx.state.backstageOpen, hidden: true },
  homePage: { icon: 'home', run: openPage('home'), hidden: true },
  newPage: { icon: 'new', run: openPage('new'), hidden: true },
  openPage: { icon: 'open', run: openPage('open'), hidden: true },
  infoPage: { icon: 'info', run: openPage('info') },
  recoverPage: { icon: 'recover', run: openPage('recover') },
  saveAsPage: { icon: 'save-as', run: openPage('saveAs'), hidden: true },
  printPage: { icon: 'print', run: openPage('print'), hidden: true },
  exportPage: { icon: 'export', run: openPage('export') },
  optionsPage: { icon: 'options', run: (ctx) => ctx.ui.openOptions() },
  options: { icon: 'options', keywords: ['settings', 'preferences'], run: (ctx) => ctx.ui.openOptions() },
  aboutPage: { icon: 'about', run: openPage('about'), hidden: true },
  // Actions
  new: { icon: 'new', shortcut: 'Mod-n', run: (ctx) => { ctx.store.set({ backstageOpen: false }); ctx.session.newDocument(); } },
  open: { icon: 'open', shortcut: 'Mod-o', run: (ctx) => { ctx.session.openDialog().then((ok) => { if (ok) ctx.store.set({ backstageOpen: false }); }); } },
  save: { icon: 'save', shortcut: ['Mod-s', 'Shift-F12'], run: (ctx) => { ctx.session.save(); } },
  saveAs: { icon: 'save-as', shortcut: 'F12', run: (ctx) => { ctx.session.saveAs(); } },
  saveAsTemplate: { icon: 'save-template', run: (ctx) => saveAsTemplate(ctx) },
  checkCompatibility: { icon: 'badge-check', keywords: ['compatibility', 'check for issues'], run: (ctx) => compatibilityDialog({ state: ctx.session.currentState(), name: ctx.session.info.name, format: ctx.session.currentFormat() }) },
  // Create PDF/XPS Document: opens Save As with PDF selected (the writers arrive in M16).
  createPdfXps: { icon: 'fmt-pdf', isEnabled: () => formatById('pdf').available !== false, run: (ctx) => ctx.session.saveAs({ format: 'pdf' }) },
  print: { icon: 'print', shortcut: 'Mod-p', run: openPage('print') },
  printNow: { icon: 'print', run: (ctx) => ctx.ui.print.run({ range: 'all' }) },
  close: { icon: 'close', shortcut: 'Mod-w', run: (ctx) => { ctx.session.close().then((ok) => { if (ok) ctx.store.set({ backstageOpen: false }); }); } },
  undo: { icon: 'undo', shortcutHint: 'Mod-z', run: (ctx) => ctx.editor.undo(), isEnabled: (ctx) => ctx.editor.canUndo() },
  redo: { icon: 'redo', shortcutHint: 'Mod-y', run: (ctx) => ctx.editor.redo(), isEnabled: (ctx) => ctx.editor.canRedo() },
  repeat: { shortcut: 'F4', isEnabled: (ctx) => !!ctx.ui.canRepeat?.(), run: (ctx) => ctx.ui.repeat() },
  share: { icon: 'share', menuOnly: true },
  shareNative: { icon: 'share2', isEnabled: () => canShareFiles(), run: (ctx) => shareNative(ctx) },
  shareDownload: { icon: 'download', run: (ctx) => { ctx.session.downloadCopy(); } },
  shareExportPdf: { icon: 'export', run: (ctx) => exportAs(ctx, 'pdf') },
  shareCopyHtml: { icon: 'copy', run: (ctx) => copyAsHtml(ctx) },
  // File ▸ Export
  ...Object.fromEntries(EXPORTS.map((f) => [`export_${f.id}`, { icon: f.icon, run: (ctx) => exportAs(ctx, f.id) }])),
});

export const ribbon = { id: 'file', keytip: 'F', backstage: true, groups: [] };

export function register(registry) { registry.register(commands); }
