/**
 * Keyboard navigation helpers: F4 repeats the last repeatable command,
 * Shift+F5 goes back to the previous editing locations, F8 extends the
 * selection (word → sentence → paragraph → document).
 */
import { TextSelection } from 'prosemirror-state';

/** Wraps registry.run to remember the last repeatable command (with its arguments). */
export function createRepeat(registry) {
  let last = null;
  const run = registry.run.bind(registry);
  registry.run = (id, ...args) => {
    const r = run(id, ...args);
    if (r && registry.get(id)?.repeatable) last = { id, args };
    return r;
  };
  return {
    can: () => !!last,
    run: () => (last ? run(last.id, ...last.args) : false),
  };
}

/** Remembers the last few places edited; Shift+F5 cycles back through them. */
export function createGoBack(editor) {
  let spots = [];
  let cursor = -1;
  return {
    track(tr, state) {
      if (tr.getMeta('load')) { spots = []; cursor = -1; return; }
      if (!tr.docChanged) return;
      spots = spots.map((p) => tr.mapping.map(p));
      const head = state.selection.head;
      const last = spots.at(-1);
      if (last == null || Math.abs(last - head) > 40) spots.push(head); else spots[spots.length - 1] = head;
      if (spots.length > 4) spots.shift();
      cursor = -1;
    },
    run() {
      if (!spots.length) return false;
      const head = editor.view.state.selection.head;
      if (cursor < 0) cursor = spots.length - 1;
      // Skip the spot we are already at.
      if (Math.abs(spots[cursor] - head) <= 1 && spots.length > 1) cursor = (cursor - 1 + spots.length) % spots.length;
      editor.focusAt(Math.min(spots[cursor], editor.view.state.doc.content.size));
      editor.view.dispatch(editor.view.state.tr.scrollIntoView());
      cursor = (cursor - 1 + spots.length) % spots.length;
      return true;
    },
  };
}

/** F8: each press selects a larger unit around the selection. */
export function extendSelection(editor) {
  const view = editor.view;
  const { state } = view;
  const { from, to, $from } = state.selection;
  if (!$from.parent.isTextblock) { editor.selectAll(); return; }
  const start = $from.start();
  const text = $from.parent.textBetween(0, $from.parent.content.size, '￼', '￼');
  const a0 = from - start;
  const b0 = to - start;
  const sel = (a, b) => view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, start + a, start + b)));
  // Word
  let a = a0;
  let b = b0;
  while (a > 0 && /[\p{L}\p{N}_'’]/u.test(text[a - 1])) a--;
  while (b < text.length && /[\p{L}\p{N}_'’]/u.test(text[b])) b++;
  if ((a < a0 || b > b0) && a < b) return sel(a, b);
  // Sentence
  const before = text.slice(0, a0);
  const sa = Math.max(0, ...[...before.matchAll(/[.!?]\s+/g)].map((m) => m.index + m[0].length));
  const m = /[.!?](\s|$)/.exec(text.slice(b0));
  const sb = m ? b0 + m.index + 1 : text.length;
  if (sa < a0 || sb > b0) return sel(sa, sb);
  // Paragraph, then document
  if (a0 > 0 || b0 < text.length) return sel(0, text.length);
  editor.selectAll();
}
