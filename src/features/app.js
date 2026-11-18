/** App-level commands that don't belong to one ribbon tab (ribbon, search, top-right buttons). */
import { defineCommands } from './define.js';

export const commands = defineCommands('app', {
  toggleRibbon: {
    icon: 'chevron-up', shortcut: 'Mod-F1', keywords: ['collapse ribbon', 'expand ribbon'],
    run: (ctx) => ctx.store.set((s) => ({ ribbonCollapsed: !s.ribbonCollapsed, ribbonPeek: false })),
    isChecked: (ctx) => !ctx.state.ribbonCollapsed,
  },
  commandSearch: { icon: 'search', shortcut: 'Alt-q', keywords: ['tell me', 'search commands'], run: (ctx) => ctx.ui.openCommandSearch() },
  keyTips: { icon: 'keyboard', run: (ctx) => ctx.ui.showKeyTips(), hidden: true },
  nextRegion: { shortcut: 'F6', run: (ctx) => ctx.ui.cycleRegion(1), hidden: true },
  previousRegion: { shortcut: 'Shift-F6', run: (ctx) => ctx.ui.cycleRegion(-1), hidden: true },
  commentsPane: { icon: 'comments' },
  editingMode: { icon: 'editing-mode', menuOnly: true },
  modeEditing: { icon: 'editing-mode', run: (ctx) => ctx.store.set({ editingMode: 'editing' }), isChecked: (ctx) => ctx.state.editingMode === 'editing' },
  modeReviewing: { icon: 'track-changes' },
  modeViewing: { icon: 'eye' },
  goBack: { shortcut: 'Shift-F5' },
  extendSelection: { shortcut: 'F8' },
  statusWordCount: { label: 'cmd.review.wordCount', hidden: true },
  setZoom: { hidden: true, label: 'cmd.view.zoomDialog', run: (ctx, pct) => ctx.ui.docArea.setZoom(pct) },
  recover: { icon: 'recover', label: 'cmd.file.recoverPage', hidden: true, run: (ctx) => ctx.store.set({ backstageOpen: true, backstagePage: 'recover' }) },
});

export function register(registry) { registry.register(commands); }
