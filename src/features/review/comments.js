/**
 * Review ▸ Comments: New Comment (Ctrl+Alt+M), Delete (this / all shown /
 * all), Previous / Next, Show Comments (Contextual balloons or the List in
 * the Comments pane), and the top-right Comments button.
 */
import { TextSelection } from 'prosemirror-state';
import { h } from '../../ui/dom.js';
import { t } from '../../i18n/index.js';
import { threadsOf, threadAt, deleteThread } from '../../core/comments.js';
import { authorKey } from '../../core/schema.js';

const docOf = (c) => c.mainEditor.view.state.doc;
export const hasComments = (c) => !!c.mainEditor && threadsOf(docOf(c)).length > 0;

/** The thread the caret or the focused balloon is in. */
export function currentThread(c) {
  const doc = docOf(c);
  const key = c.ui.comments?.active;
  const threads = threadsOf(doc);
  return threads.find((x) => c.ui.comments.keyOf(x.node, x.pos) === key) || threadAt(doc, c.mainEditor.view.state.selection.from);
}

export function newComment(c) {
  if (c.state.commentsView === 'list') openCommentsPane(c);
  return c.ui.comments.insert();
}

export function deleteCurrent(c) {
  const th = currentThread(c);
  if (!th) return;
  const view = c.mainEditor.view;
  view.dispatch(deleteThread(view.state.tr, th).setMeta('tcSkip', true));
  view.focus();
}

/** Deletes every comment (shown only: the reviewers filter applies). */
export function deleteAll(c, { shownOnly = false } = {}) {
  const view = c.mainEditor.view;
  const hidden = new Set(c.state.reviewHide?.authors || []);
  const list = threadsOf(view.state.doc).filter((x) => !shownOnly || !hidden.has(authorKey(x.node.attrs.creator)));
  const tr = view.state.tr;
  for (const th of list.reverse()) deleteThread(tr, th);
  view.dispatch(tr.setMeta('tcSkip', true));
}

/** Goes to the previous (-1) / next (1) comment and focuses it. */
export function gotoComment(c, dir) {
  const view = c.mainEditor.view;
  const threads = threadsOf(view.state.doc);
  if (!threads.length) return;
  const cur = currentThread(c);
  const i = cur ? threads.findIndex((x) => x.pos === cur.pos) : -1;
  const pos = view.state.selection.from;
  let target;
  if (i >= 0) target = threads[(i + dir + threads.length) % threads.length];
  else target = dir > 0 ? threads.find((x) => x.pos >= pos) || threads[0] : [...threads].reverse().find((x) => x.pos < pos) || threads[threads.length - 1];
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, target.pos + 1)).scrollIntoView());
  requestAnimationFrame(() => c.ui.comments.focusEntry(c.ui.comments.keyOf(target.node, target.pos)));
}

/** Comments pane (List view): every thread, with New Comment. */
export function openCommentsPane(c) {
  const dock = c.ui.rightDock;
  if (dock.isOpen('comments')) return;
  const list = h('div', { class: 'cmt-list' });
  const empty = h('div', { class: 'cmt-empty' }, t('cmt.none'));
  const add = h('button', { type: 'button', class: 'dlg-btn primary cmt-new', onclick: () => newComment(c) }, t('cmt.new'));
  const body = h('div', { class: 'cmt-pane' }, h('div', { class: 'cmt-pane-bar' }, add), list, empty);
  const observer = new MutationObserver(() => { empty.hidden = list.children.length > 0; });
  observer.observe(list, { childList: true });
  dock.open({
    id: 'comments', title: t('cmt.paneTitle'), body,
    onClose: () => { observer.disconnect(); c.store.set({ commentsView: 'contextual' }); c.ui.comments.setListHost(null); c.ui.docArea.relayout(); },
  });
  c.store.set({ commentsView: 'list' });
  c.ui.comments.setListHost(list);
  empty.hidden = list.children.length > 0;
}

export function closeCommentsPane(c) {
  if (c.ui.rightDock.isOpen('comments')) c.ui.rightDock.close('comments');
}
