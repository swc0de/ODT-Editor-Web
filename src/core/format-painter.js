/**
 * Format Painter: copies character formatting (and paragraph formatting when
 * the source is a caret or whole paragraphs) and applies it to the next
 * selection made with the mouse. Double-clicking the button locks it for
 * repeated use; Esc (or clicking the button again) turns it off.
 */
import { TextSelection } from 'prosemirror-state';
import { schema } from './schema.js';
import { selectedTextblocks } from './commands/paragraph.js';

const PAINTED = [schema.marks.textProps, schema.marks.charStyle];

function wordAt(state, pos) {
  const $p = state.doc.resolve(pos);
  const text = $p.parent.textContent;
  let a = $p.parentOffset;
  let b = a;
  while (a > 0 && /[\p{L}\p{N}_'’]/u.test(text[a - 1])) a--;
  while (b < text.length && /[\p{L}\p{N}_'’]/u.test(text[b])) b++;
  return a === b ? null : [$p.start() + a, $p.start() + b];
}

export function createFormatPainter({ editor, store }) {
  let picked = null;
  let locked = false;
  let startedAt = 0;

  const setActive = (on) => {
    editor.view.dom.classList.toggle('painter', on);
    store.set({ formatPainter: on ? (locked ? 'locked' : 'on') : false });
  };

  function pick() {
    const state = editor.view.state;
    const { $from, empty } = state.selection;
    const marks = empty ? (state.storedMarks || $from.marks()) : state.doc.resolve(Math.min($from.pos + 1, state.selection.to)).marks();
    const blocks = selectedTextblocks(state);
    const whole = !empty && blocks.length && state.selection.from <= blocks[0].pos + 1 && state.selection.to >= blocks.at(-1).pos + blocks.at(-1).node.nodeSize - 1;
    const para = (empty || whole) && blocks[0] ? { type: blocks[0].node.type, attrs: blocks[0].node.attrs } : null;
    return { marks: marks.filter((m) => PAINTED.includes(m.type)), para };
  }

  function stop() {
    picked = null;
    locked = false;
    setActive(false);
  }

  function start(lock) {
    picked = pick();
    locked = lock;
    startedAt = Date.now();
    setActive(true);
  }

  /** Ribbon button / Ctrl+Shift+C: first click arms it, a quick second click locks it. */
  function toggle() {
    if (picked) {
      if (!locked && Date.now() - startedAt < 450) { locked = true; setActive(true); return; }
      stop();
      return;
    }
    start(false);
  }

  function apply() {
    const view = editor.view;
    const state = view.state;
    let { from, to, empty } = state.selection;
    if (empty) {
      const w = wordAt(state, from);
      if (!w && !picked.para) return;
      if (w) [from, to] = w;
    }
    const tr = state.tr;
    if (to > from) {
      for (const type of PAINTED) tr.removeMark(from, to, type);
      for (const m of picked.marks) tr.addMark(from, to, m);
    }
    if (picked.para) {
      state.doc.nodesBetween(from, Math.max(from + 1, to), (node, pos) => {
        if (!node.isTextblock) return true;
        const attrs = { ...node.attrs, styleName: picked.para.attrs.styleName, auto: picked.para.attrs.auto };
        if (picked.para.type === schema.nodes.heading) attrs.level = picked.para.attrs.level;
        try { tr.setNodeMarkup(pos, picked.para.type, attrs); } catch { /* incompatible parent */ }
        return false;
      });
    }
    if (!tr.docChanged) return;
    tr.setSelection(TextSelection.create(tr.doc, from, to));
    view.dispatch(tr.setMeta('formatPainter', true));
  }

  editor.view.dom.addEventListener('mouseup', () => {
    if (!picked) return;
    // After ProseMirror has turned the mouse gesture into a selection.
    setTimeout(() => {
      if (!picked) return;
      apply();
      if (!locked) stop();
    }, 0);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && picked) { e.preventDefault(); stop(); } }, true);

  return { toggle, stop, isActive: () => !!picked, isLocked: () => locked };
}
