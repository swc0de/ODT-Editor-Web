/** Review tab: Proofing, Speech, Accessibility, Language, Comments, Tracking, Changes, Compare, Protect (M9). */
import { defineCommands } from '../define.js';
import { setTracking, refreshView, resolveHere, resolveAll, gotoChange, reviewers, hasChanges, changesHere, userName, userInitials, setUser } from './track.js';
import { trackingOptionsDialog, reviewersDialog } from '../../ui/review-dialogs.js';
import { wordCount, setLanguage } from './proofing.js';
import { hasComments, deleteCurrent, deleteAll, gotoComment, openCommentsPane, closeCommentsPane, currentThread } from './comments.js';
import { authorKey } from '../../core/schema.js';

const canEdit = (c) => !!c.mainEditor && c.state.editingMode !== 'viewing';
const display = (mode) => ({ isChecked: (c) => c.state.reviewDisplay === mode, run: (c) => { c.store.set({ reviewDisplay: mode }); refreshView(c); } });
const hideToggle = (key) => ({
  isChecked: (c) => !c.state.reviewHide?.[key],
  run: (c) => { c.store.set((s) => ({ reviewHide: { ...s.reviewHide, [key]: !s.reviewHide?.[key] } })); refreshView(c); },
});
const accept = (on, o = {}) => ({ isEnabled: (c) => canEdit(c) && (o.here ? changesHere(c) : hasChanges(c)), run: (c) => (o.all ? resolveAll(c, on, o) : resolveHere(c, on, o)) });

export const commands = defineCommands('review', {
  spelling: { icon: 'spelling', shortcut: 'F7', isEnabled: (c) => !!c.mainEditor, run: (c) => c.ui.editorPane.open() },
  thesaurus: { icon: 'thesaurus', shortcut: 'Shift-F7' },
  wordCount: { icon: 'word-count', shortcut: 'Mod-Shift-g', isEnabled: (c) => !!c.mainEditor, run: wordCount },
  readAloud: { icon: 'read-aloud' },
  checkAccessibility: { icon: 'accessibility' },
  translate: { icon: 'translate' },
  language: { icon: 'language', isEnabled: (c) => !!c.editor && canEdit(c), run: setLanguage },
  setProofingLanguage: { isEnabled: (c) => !!c.editor && canEdit(c), run: setLanguage },
  languagePreferences: {},
  deleteComment: { icon: 'delete-comment', isEnabled: (c) => canEdit(c) && hasComments(c) && !!currentThread(c), run: deleteCurrent },
  deleteAllShown: { isEnabled: (c) => canEdit(c) && hasComments(c), run: (c) => deleteAll(c, { shownOnly: true }) },
  deleteAllComments: { isEnabled: (c) => canEdit(c) && hasComments(c), run: (c) => deleteAll(c) },
  previousComment: { icon: 'previous', isEnabled: hasComments, run: (c) => gotoComment(c, -1) },
  nextComment: { icon: 'next', isEnabled: hasComments, run: (c) => gotoComment(c, 1) },
  showComments: { icon: 'show-comments', isEnabled: (c) => !!c.mainEditor, menuOnly: true },
  commentsContextual: { isEnabled: (c) => !!c.mainEditor, isChecked: (c) => c.state.commentsView !== 'list', run: (c) => { closeCommentsPane(c); c.store.set((s) => ({ commentsView: 'contextual', reviewHide: { ...s.reviewHide, comments: false } })); refreshView(c); } },
  commentsList: { isEnabled: (c) => !!c.mainEditor, isChecked: (c) => c.state.commentsView === 'list', run: openCommentsPane },
  trackChanges: {
    icon: 'track-changes', shortcut: 'Mod-Shift-e', isEnabled: (c) => canEdit(c) && !c.state.trackLock,
    isChecked: (c) => !!c.state.trackChanges, run: (c) => setTracking(c, !c.state.trackChanges),
  },
  trackChangesEveryone: { isEnabled: (c) => canEdit(c) && !c.state.trackLock, isChecked: (c) => !!c.state.trackChanges, run: (c) => setTracking(c, true) },
  trackChangesJustMine: {},
  trackChangesLock: {
    isEnabled: canEdit, isChecked: (c) => !!c.state.trackLock,
    // Lock Tracking keeps Track Changes on until it is unlocked.
    run: (c) => { const lock = !c.state.trackLock; if (lock) setTracking(c, true); c.store.set({ trackLock: lock }); },
  },
  displayForReview: { icon: 'display-review', menuOnly: true },
  displaySimple: display('simple'),
  displayAll: display('all'),
  displayNone: display('none'),
  displayOriginal: display('original'),
  showMarkup: { icon: 'show-markup', menuOnly: true },
  markupComments: hideToggle('comments'),
  markupInk: {},
  markupInsertionsDeletions: hideToggle('insdel'),
  markupFormatting: hideToggle('fmt'),
  markupBalloons: {},
  markupPeople: {
    isEnabled: (c) => !!c.mainEditor,
    run: async (c) => {
      const names = reviewers(c);
      const hidden = new Set(c.state.reviewHide?.authors || []);
      const shown = await reviewersDialog(names, new Set(names.filter((n) => !hidden.has(authorKey(n)))));
      if (!shown) return;
      c.store.set((s) => ({ reviewHide: { ...s.reviewHide, authors: names.filter((n) => !shown.has(n)).map(authorKey) } }));
      refreshView(c);
    },
  },
  reviewingPane: { icon: 'reviewing-pane', isEnabled: (c) => !!c.mainEditor, isChecked: (c) => !!c.state.reviewingPane, run: (c) => c.store.set((s) => ({ reviewingPane: s.reviewingPane ? null : 'vertical' })) },
  reviewingPaneVertical: { isEnabled: (c) => !!c.mainEditor, isChecked: (c) => c.state.reviewingPane === 'vertical', run: (c) => c.store.set({ reviewingPane: 'vertical' }) },
  reviewingPaneHorizontal: { isEnabled: (c) => !!c.mainEditor, isChecked: (c) => c.state.reviewingPane === 'horizontal', run: (c) => c.store.set({ reviewingPane: 'horizontal' }) },
  trackingOptions: {
    icon: 'track-changes', isEnabled: (c) => !!c.mainEditor,
    run: async (c) => {
      const h = c.state.reviewHide || {};
      const r = await trackingOptionsDialog({ name: userName(), initials: userInitials(), comments: !h.comments, insdel: !h.insdel, fmt: !h.fmt });
      if (!r) return;
      setUser(r.name, r.initials);
      c.store.set((s) => ({ reviewHide: { ...s.reviewHide, comments: !r.comments, insdel: !r.insdel, fmt: !r.fmt } }));
      refreshView(c);
    },
  },
  accept: { icon: 'accept', ...accept(true, { here: true, moveNext: true }) },
  acceptAndMove: accept(true, { here: true, moveNext: true }),
  acceptThis: accept(true, { here: true }),
  acceptAllShown: accept(true, { all: true, shownOnly: true }),
  acceptAll: accept(true, { all: true }),
  acceptAllAndStop: { isEnabled: (c) => canEdit(c) && (hasChanges(c) || !!c.state.trackChanges), run: (c) => { resolveAll(c, true); setTracking(c, false); } },
  reject: { icon: 'reject', ...accept(false, { here: true, moveNext: true }) },
  rejectAndMove: accept(false, { here: true, moveNext: true }),
  rejectThis: accept(false, { here: true }),
  rejectAllShown: accept(false, { all: true, shownOnly: true }),
  rejectAll: accept(false, { all: true }),
  rejectAllAndStop: { isEnabled: (c) => canEdit(c) && (hasChanges(c) || !!c.state.trackChanges), run: (c) => { resolveAll(c, false); setTracking(c, false); } },
  previousChange: { icon: 'previous', isEnabled: hasChanges, run: (c) => gotoChange(c, -1) },
  nextChange: { icon: 'next', isEnabled: hasChanges, run: (c) => gotoChange(c, 1) },
  compare: { icon: 'compare' },
  compareDocuments: {},
  combineDocuments: {},
  restrictEditing: { icon: 'restrict' },
});

export const ribbon = {
  id: 'review',
  keytip: 'R',
  groups: [
    {
      id: 'proofing', icon: 'spelling',
      controls: [
        { t: 'large', cmd: 'spelling', label: 'label.review.spelling' },
        { t: 'col', items: [{ cmd: 'thesaurus' }, { cmd: 'wordCount' }] },
      ],
    },
    { id: 'speech', icon: 'read-aloud', controls: [{ t: 'large', cmd: 'readAloud', label: 'label.review.readAloud' }] },
    { id: 'accessibility', icon: 'accessibility', controls: [{ t: 'large', cmd: 'checkAccessibility', label: 'label.review.checkAccessibility' }] },
    {
      id: 'language', icon: 'language',
      controls: [
        { t: 'large', cmd: 'translate' },
        { t: 'large', cmd: 'language', menu: ['setProofingLanguage', 'languagePreferences'] },
      ],
    },
    {
      id: 'comments', icon: 'comment',
      controls: [
        { t: 'large', cmd: 'insert.comment', label: 'label.review.newComment' },
        { t: 'large', cmd: 'deleteComment', label: 'label.review.delete', split: true, menu: ['deleteComment', 'deleteAllShown', 'deleteAllComments'] },
        { t: 'col', items: [{ cmd: 'previousComment', label: 'label.review.previous' }, { cmd: 'nextComment', label: 'label.review.next' }] },
        { t: 'large', cmd: 'showComments', label: 'label.review.showComments', menu: ['commentsContextual', 'commentsList'] },
      ],
    },
    {
      id: 'tracking', icon: 'track-changes', launcher: 'trackingOptions',
      controls: [
        { t: 'large', cmd: 'trackChanges', label: 'label.review.trackChanges', split: true, menu: ['trackChangesEveryone', 'trackChangesJustMine', 'trackChangesLock'] },
        { t: 'col', items: [
          { t: 'select', cmd: 'displayForReview', width: 128, options: ['displaySimple', 'displayAll', 'displayNone', 'displayOriginal'], value: 'displayAll' },
          { cmd: 'showMarkup', menu: ['markupComments', 'markupInk', 'markupInsertionsDeletions', 'markupFormatting', '-', 'markupBalloons', 'markupPeople'] },
          { cmd: 'reviewingPane', split: true, menu: ['reviewingPaneVertical', 'reviewingPaneHorizontal'] },
        ] },
      ],
    },
    {
      id: 'changes', icon: 'accept',
      controls: [
        { t: 'large', cmd: 'accept', split: true, menu: ['acceptAndMove', 'acceptThis', 'acceptAllShown', 'acceptAll', 'acceptAllAndStop'] },
        { t: 'large', cmd: 'reject', split: true, menu: ['rejectAndMove', 'rejectThis', 'rejectAllShown', 'rejectAll', 'rejectAllAndStop'] },
        { t: 'col', items: [{ cmd: 'previousChange', label: 'label.review.previous' }, { cmd: 'nextChange', label: 'label.review.next' }] },
      ],
    },
    { id: 'compare', icon: 'compare', controls: [{ t: 'large', cmd: 'compare', menu: ['compareDocuments', 'combineDocuments'] }] },
    { id: 'protect', icon: 'restrict', controls: [{ t: 'large', cmd: 'restrictEditing', label: 'label.review.restrictEditing' }] },
  ],
};

export function register(registry) { registry.register(commands); }
