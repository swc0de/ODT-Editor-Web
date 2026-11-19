/**
 * References ▸ Footnotes: Insert Footnote / Endnote, Next / Previous,
 * Show Notes and the Footnote and Endnote dialog (location, number format,
 * custom mark, start at, numbering restart, convert). The note text is
 * edited in the note areas drawn by layout/notes-layer.js.
 */
import { TextSelection } from 'prosemirror-state';
import { schema } from '../../core/schema.js';
import { editState } from '../../core/state-step.js';
import { ensureStyles } from '../../core/style-edit.js';
import { newNote, notesOf, notesConfig, setNotesConfig, numberNotes } from '../../core/notes.js';
import { whenLaidOut } from './toc.js';

export const NOTE_STYLES = { paragraph: ['Footnote', 'Endnote', 'Endnote_20_Heading'], text: ['Footnote_20_anchor', 'Endnote_20_anchor'] };

const ensureConfig = (st) => {
  let changed = false;
  for (const cls of ['footnote', 'endnote']) {
    const has = (st.commonStyles?.c || []).some((t) => typeof t !== 'string' && t.n === 'text:notes-configuration' && t.a['text:note-class'] === cls);
    if (!has) { setNotesConfig(st, cls, cls === 'footnote' ? { 'style:num-format': '1', 'text:start-value': '0', 'text:footnotes-position': 'page', 'text:start-numbering-at': 'document' } : { 'style:num-format': 'i', 'text:start-value': '0' }); changed = true; }
  }
  return changed;
};

/** Inserts a footnote or endnote after the selection and puts the caret in its text. */
export function insertNote(c, cls = 'footnote', label = null) {
  const view = c.mainEditor.view;
  const at = view.state.selection.to;
  const note = newNote(view.state.doc, cls, label);
  const ready = label ? note.type.create({ ...note.attrs, citation: label }) : note;
  editState(view, c.session.state, ['commonStyles'], (st) => {
    const a = ensureStyles(st, 'paragraph', NOTE_STYLES.paragraph);
    const b = ensureStyles(st, 'text', NOTE_STYLES.text);
    const d = ensureConfig(st);
    return a || b || d;
  }, (tr) => {
    tr.insert(at, ready);
    tr.setSelection(TextSelection.create(tr.doc, at + 1)).scrollIntoView();
  });
  focusNoteSoon(c, at);
}

/** Focuses the note at pos once its area has been laid out. */
export function focusNoteSoon(c, pos) {
  whenLaidOut(c, () => { if (!c.ui.docArea.notes.focusNote(pos)) requestAnimationFrame(() => c.ui.docArea.notes.focusNote(pos)); });
}

/** The note whose text has focus: { node, pos } or null. */
export const focusedNote = (c) => c.ui.docArea?.notes.focused() || null;

/** Moves the caret to the next / previous note reference of a class. */
export function gotoNote(c, cls, dir) {
  const view = c.mainEditor.view;
  const here = focusedNote(c);
  const from = here ? here.pos + (dir > 0 ? 1 : 0) : (dir > 0 ? view.state.selection.to : view.state.selection.from - 1);
  const list = notesOf(view.state.doc, cls);
  const target = dir > 0 ? list.find((n) => n.pos >= from) : [...list].reverse().find((n) => n.pos < from);
  if (!target) return false;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, target.pos + 1)).scrollIntoView());
  view.focus();
  return true;
}

/** Show Notes: from the text to its note area, and from a note back to its reference. */
export function showNotes(c) {
  const view = c.mainEditor.view;
  const here = focusedNote(c);
  if (here) {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, here.pos + 1)).scrollIntoView());
    view.focus();
    return;
  }
  const list = notesOf(view.state.doc);
  if (!list.length) return;
  const sel = view.state.selection.from;
  const target = list.find((n) => n.pos >= sel - 1) || list[list.length - 1];
  c.ui.docArea.notes.focusNote(target.pos);
}

/** Applies dialog options: configuration, conversion; then renumbers and relays out. */
export function applyNoteOptions(c, r) {
  const view = c.mainEditor.view;
  const st = c.session.state;
  editState(view, st, ['commonStyles'], (s) => {
    ensureStyles(s, 'paragraph', NOTE_STYLES.paragraph);
    ensureStyles(s, 'text', NOTE_STYLES.text);
    ensureConfig(s);
    const change = { 'style:num-format': r.numFormat, 'text:start-value': String(Math.max(0, (r.startAt || 1) - 1)) };
    if (r.cls === 'footnote') Object.assign(change, { 'text:footnotes-position': r.position, 'text:start-numbering-at': r.restart });
    setNotesConfig(s, r.cls, change);
    return true;
  }, (tr) => {
    if (r.convert) convertNotes(tr, r.convert);
  });
  const tr = numberNotes(view.state, st, (pos) => c.ui.docArea.pageAt(pos));
  if (tr) view.dispatch(tr.setMeta('addToHistory', false));
  c.ui.docArea.notes.clearCache();
  c.ui.docArea.relayout();
}

/** Converts notes: 'toEndnotes' | 'toFootnotes' | 'swap'. */
function convertNotes(tr, mode) {
  tr.doc.descendants((n, pos) => {
    if (n.type.name !== 'note') return true;
    const cls = n.attrs.noteClass;
    const to = mode === 'swap' ? (cls === 'endnote' ? 'footnote' : 'endnote') : mode === 'toEndnotes' ? 'endnote' : 'footnote';
    if (to !== cls) {
      const from = cls === 'endnote' ? 'Endnote' : 'Footnote';
      const style = to === 'endnote' ? 'Endnote' : 'Footnote';
      const body = JSON.parse(JSON.stringify(n.attrs.body || []).replaceAll(`"styleName":"${from}"`, `"styleName":"${style}"`));
      const id = n.attrs.extra?.['text:id'];
      tr.setNodeMarkup(pos, null, { ...n.attrs, noteClass: to, body, extra: { ...n.attrs.extra, ...(id ? { 'text:id': id.replace(/^(ftn|edn)/, to === 'endnote' ? 'edn' : 'ftn') } : {}) } });
    }
    return false;
  });
}

/** Current options for the dialog. */
export function noteOptions(c, cls) {
  const cfg = notesConfig(c.session.state, cls);
  return { cls, numFormat: cfg.numFormat, startAt: cfg.startValue + 1, position: cfg.position, restart: cfg.restart };
}

export const hasNotes = (c, cls) => !!c.mainEditor && notesOf(c.mainEditor.view.state.doc, cls).length > 0;

export { schema };
