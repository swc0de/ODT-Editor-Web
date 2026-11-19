/** App-level commands that don't belong to one ribbon tab (ribbon, search, top-right buttons). */
import { defineCommands } from './define.js';
import { setTracking, refreshView } from './review/track.js';
import { openCommentsPane, closeCommentsPane } from './review/comments.js';

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
  commentsPane: {
    icon: 'comments', isEnabled: (ctx) => !!ctx.mainEditor, isChecked: (ctx) => ctx.state.commentsView === 'list',
    run: (ctx) => { if (ctx.state.commentsView === 'list') closeCommentsPane(ctx); else openCommentsPane(ctx); return true; },
  },
  editingMode: { icon: 'editing-mode', menuOnly: true },
  // Editing: change the document directly; Reviewing: Track Changes on; Viewing: read-only.
  modeEditing: { icon: 'editing-mode', isEnabled: (ctx) => !ctx.state.trackLock, run: (ctx) => { setTracking(ctx, false); ctx.store.set({ editingMode: 'editing' }); refreshView(ctx); }, isChecked: (ctx) => ctx.state.editingMode === 'editing' },
  modeReviewing: { icon: 'track-changes', run: (ctx) => setTracking(ctx, true), isChecked: (ctx) => ctx.state.editingMode === 'reviewing' },
  modeViewing: { icon: 'eye', run: (ctx) => { ctx.store.set({ editingMode: 'viewing' }); refreshView(ctx); }, isChecked: (ctx) => ctx.state.editingMode === 'viewing' },
  goBack: { shortcut: 'Shift-F5', run: (ctx) => ctx.ui.goBack() },
  extendSelection: { shortcut: 'F8', run: (ctx) => ctx.ui.extendSelection() },
  statusWordCount: { label: 'cmd.review.wordCount', hidden: true },
  setZoom: { hidden: true, label: 'cmd.view.zoomDialog', run: (ctx, pct) => ctx.ui.docArea.setZoom(pct) },
  recover: { icon: 'recover', label: 'cmd.file.recoverPage', hidden: true, run: (ctx) => ctx.store.set({ backstageOpen: true, backstagePage: 'recover' }) },
});

export function register(registry) { registry.register(commands); }
