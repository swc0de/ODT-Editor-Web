/**
 * Review ▸ Tracking and Changes: Track Changes (and the Editing ▾ Reviewing
 * mode), Display for Review, Show Markup filters, Accept / Reject, Previous
 * / Next, the user name the changes are recorded under.
 */
import { TextSelection } from 'prosemirror-state';
import { getSetting, setSetting } from '../../core/settings.js';
import { changesOf, changesAt, resolveChanges } from '../../core/track-recording.js';
import { authorKey } from '../../core/schema.js';

/** The name changes and comments are recorded under. */
export const userName = () => getSetting('userName') || 'Author';
export function userInitials() {
  const set = getSetting('userInitials');
  if (set) return set;
  return userName().split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase()).join('').slice(0, 3) || 'A';
}
export function setUser(name, initials) {
  setSetting('userName', name);
  setSetting('userInitials', initials);
}

/** Turns recording on or off (the document remembers it; Editing ▾ follows). */
export function setTracking(c, on) {
  if (c.state.trackLock && !on) return;
  c.store.set((s) => ({ trackChanges: on, editingMode: on ? 'reviewing' : (s.editingMode === 'reviewing' ? 'editing' : s.editingMode) }));
  if (c.session?.state) c.session.state.trackChanges = on;
  refreshView(c);
}

/** Re-renders the editor's markup classes and lays the pages out again (hidden text changes heights). */
export function refreshView(c) {
  const view = c.mainEditor?.view;
  if (!view) return;
  view.dispatch(view.state.tr.setMeta('tcView', true).setMeta('addToHistory', false));
  c.ui.docArea?.relayout();
  c.ui.reviewingPane?.render(true);
}

/** Changes shown under the current Show Markup filters. */
export function shownChanges(c) {
  const h = c.state.reviewHide || {};
  return changesOf(c.mainEditor.view.state.doc).filter((x) => {
    if (h.authors?.includes(authorKey(x.author))) return false;
    if (x.type === 'formatChange') return !h.fmt;
    return !h.insdel;
  });
}

const tcTr = (view) => view.state.tr.setMeta('tcSkip', true);

/** Accept / reject the change(s) at the selection; moveNext goes on to the next one. */
export function resolveHere(c, accept, { moveNext = false } = {}) {
  const view = c.mainEditor.view;
  const here = changesAt(view.state);
  if (!here.length) { if (moveNext) gotoChange(c, 1); return false; }
  const end = Math.max(...here.map((x) => x.to));
  const tr = resolveChanges(tcTr(view), here, accept);
  const after = tr.mapping.map(end);
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(after, tr.doc.content.size))));
  view.dispatch(tr.scrollIntoView());
  if (moveNext) gotoChange(c, 1);
  view.focus();
  return true;
}

/** Accept / reject every change (shown only: the filters apply). */
export function resolveAll(c, accept, { shownOnly = false } = {}) {
  const view = c.mainEditor.view;
  const list = shownOnly ? shownChanges(c) : changesOf(view.state.doc);
  if (!list.length) return;
  view.dispatch(resolveChanges(tcTr(view), list, accept));
  view.focus();
}

/** Selects the next (dir 1) or previous (-1) change. */
export function gotoChange(c, dir) {
  const view = c.mainEditor.view;
  const list = shownChanges(c);
  if (!list.length) return false;
  const { from, to } = view.state.selection;
  const target = dir > 0 ? list.find((x) => x.from >= to && !(x.from === from && x.to === to)) || list.find((x) => x.from > from) : [...list].reverse().find((x) => x.to <= from || x.from < from);
  if (!target) return false;
  const a = target.from;
  const b = Math.min(target.to, view.state.doc.content.size);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, a, Math.max(a, b))).scrollIntoView());
  view.focus();
  return true;
}

/** Authors with changes or comments in the document. */
export function reviewers(c) {
  const names = new Set(changesOf(c.mainEditor.view.state.doc).map((x) => x.author));
  c.mainEditor.view.state.doc.descendants((n) => { if (n.type.name === 'annotation' && n.attrs.creator) names.add(n.attrs.creator); return true; });
  return [...names].sort();
}

export const hasChanges = (c) => !!c.mainEditor && changesOf(c.mainEditor.view.state.doc).length > 0;
export const changesHere = (c) => !!c.mainEditor && changesAt(c.mainEditor.view.state).length > 0;
