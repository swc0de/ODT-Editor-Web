/**
 * File tab: opens the Backstage. File commands (New/Open/Save…) are wired up
 * in M2; Backstage navigation is built now.
 */
import { defineCommands } from '../define.js';

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
  optionsPage: { icon: 'options', run: openPage('options') },
  aboutPage: { icon: 'about', run: openPage('about'), hidden: true },
  // Actions (M2+)
  new: { icon: 'new', shortcut: 'Mod-n' },
  open: { icon: 'open', shortcut: 'Mod-o' },
  save: { icon: 'save', shortcut: 'Mod-s' },
  saveAs: { icon: 'save-as', shortcut: 'F12' },
  print: { icon: 'print', shortcut: 'Mod-p' },
  close: { icon: 'close', shortcut: 'Mod-w' },
  undo: { icon: 'undo', shortcutHint: 'Mod-z' },
  redo: { icon: 'redo', shortcutHint: 'Mod-y' },
  repeat: { shortcut: 'F4' },
  share: { icon: 'share' },
  shareDownload: { icon: 'download' },
  shareExportPdf: { icon: 'export' },
  shareCopyHtml: { icon: 'copy' },
});

export const ribbon = { id: 'file', keytip: 'F', backstage: true, groups: [] };

export function register(registry) { registry.register(commands); }
