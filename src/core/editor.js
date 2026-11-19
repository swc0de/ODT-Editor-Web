/**
 * The editing surface: a ProseMirror view over the document body, in a
 * continuous (not yet paginated) page. Typing, selection, IME, clipboard
 * (rich and plain paste), undo/redo with grouping, and node views for
 * images, notes and comments.
 */
import { EditorState, Plugin, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { history, undo, redo, undoDepth, redoDepth } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, chainCommands, selectAll } from 'prosemirror-commands';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { Slice, Fragment } from 'prosemirror-model';
import { schema } from './schema.js';
import { cleanPastedHTML } from './clipboard.js';
import { ObjectView } from '../layout/object-view.js';
import { imageAttrs, uniqueName, maxZ } from './objects.js';
import { sliceForMode } from './paste-modes.js';

const insertNode = (type) => (state, dispatch) => {
  if (dispatch) dispatch(state.tr.replaceSelectionWith(type.create()).scrollIntoView());
  return true;
};

const shiftEnter = chainCommands((state, dispatch) => insertNode(schema.nodes.hard_break)(state, dispatch));

/** Splitting a heading continues with a normal paragraph (like Word's "next style"). */
function splitHeadingToParagraph(state, dispatch) {
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.type !== schema.nodes.heading || $from.parentOffset !== $from.parent.content.size) return false;
  if (dispatch) {
    const tr = state.tr.split($from.pos, 1, [{ type: schema.nodes.paragraph, attrs: { styleName: 'Standard' } }]);
    dispatch(tr.scrollIntoView());
  }
  return true;
}

/**
 * Creates the editor.
 * @param {HTMLElement} mount
 * @param {object} env  { onTransaction(view, tr), pictureUrl(path), graphicPos(styleName), addPicture(bytes, mime) → path, openFiles(files) }
 */
export function createEditor(mount, env) {
  let view;
  const handleFilesDrop = (files) => {
    const docs = [...files].filter((f) => /\.(odt|ott)$/i.test(f.name));
    if (docs.length) { env.openFiles?.(docs); return true; }
    return false;
  };

  /** Turns pasted data: images into package pictures. */
  function adoptPastedImages(slice) {
    let changed = false;
    const map = (fragment) => {
      const out = [];
      fragment.forEach((node) => {
        if (node.type.name === 'frame' && node.attrs.frameAttrs?.['#pastedSrc']) {
          const fa = node.attrs.frameAttrs;
          const m = fa['#pastedSrc'].match(/^data:(image\/[\w+.-]+);base64,(.*)$/);
          if (!m) return;
          const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
          const path = env.addPicture(bytes, m[1]);
          const w = Number(fa['#w']) || 300;
          const h = Number(fa['#h']) || 225;
          const doc = view.state.doc;
          out.push(node.type.create(imageAttrs({ path, mime: m[1], w, h, name: uniqueName(doc, 'Picture'), title: fa['#alt'] || '', z: maxZ(doc) + 1 })));
          changed = true;
        } else if (node.content.size) out.push(node.copy(map(node.content)));
        else out.push(node);
      });
      return Fragment.fromArray(out);
    };
    const content = map(slice.content);
    return changed ? new Slice(content, slice.openStart, slice.openEnd) : slice;
  }

  const editorKeymap = keymap({
    'Mod-z': undo,
    'Mod-y': redo,
    'Mod-Shift-z': redo,
    'Shift-Enter': shiftEnter,
    Enter: splitHeadingToParagraph,
    Tab: insertNode(schema.nodes.tab),
    'Mod-a': selectAll,
  });

  const notifyPlugin = new Plugin({
    view: () => ({ update: (v, prev) => env.onUpdate?.(v, prev) }),
  });

  function makeState(doc) {
    return EditorState.create({
      doc,
      plugins: [history({ newGroupDelay: 500 }), ...(env.priorityPlugins?.() || []), editorKeymap, keymap(baseKeymap), dropCursor({ color: '#7a93f0' }), gapCursor(), notifyPlugin, ...(env.extraPlugins?.() || [])],
    });
  }

  view = new EditorView(mount, {
    state: makeState(schema.node('doc', null, [schema.node('paragraph')])),
    attributes: { class: 'odt-body', spellcheck: 'true', 'aria-label': 'Document', role: 'textbox', 'aria-multiline': 'true' },
    nodeViews: { frame: (node, v, getPos) => new ObjectView(node, v, getPos, env) },
    transformPastedHTML: cleanPastedHTML,
    transformPasted: adoptPastedImages,
    handleDrop: (v, event) => {
      const files = event.dataTransfer?.files;
      if (!files?.length) return false;
      if (handleFilesDrop(files)) return true;
      const pics = [...files].filter((f) => f.type.startsWith('image/'));
      if (!pics.length || !env.insertPictures) return false;
      const at = v.posAtCoords({ left: event.clientX, top: event.clientY });
      env.insertPictures(pics, at?.pos);
      return true;
    },
    handleDOMEvents: {
      // Pasting a picture file (a screenshot, an image copied from a browser without HTML).
      paste(v, event) {
        const items = [...(event.clipboardData?.items || [])];
        const html = event.clipboardData?.getData?.('text/html');
        const pics = items.filter((it) => it.kind === 'file' && it.type.startsWith('image/')).map((it) => it.getAsFile()).filter(Boolean);
        if (!pics.length || html || !env.insertPictures) return false;
        event.preventDefault();
        env.insertPictures(pics, v.state.selection.from);
        return true;
      },
    },
    // Paste options apply here. Pasting into an empty paragraph takes the
    // pasted paragraph's style (ProseMirror would otherwise keep the empty one's).
    handlePaste(v, event, rawSlice) {
      const mode = env.pasteMode?.(event) || 'keep';
      const { slice, adoptStyle } = sliceForMode(rawSlice, mode, v.state);
      const { $from, empty } = v.state.selection;
      const start = v.state.selection.from;
      const first = slice.content.firstChild;
      const tr = v.state.tr.replaceSelection(slice);
      if (adoptStyle && empty && $from.parent.isTextblock && !$from.parent.content.size && slice.openStart >= 1 && first?.isTextblock) {
        const pos = tr.mapping.map($from.before(), -1);
        const target = tr.doc.nodeAt(pos);
        if (target?.isTextblock && (target.type !== first.type || JSON.stringify(target.attrs) !== JSON.stringify(first.attrs))) {
          try { tr.setNodeMarkup(pos, first.type, first.attrs); } catch { /* incompatible: keep */ }
        }
      }
      v.dispatch(tr.scrollIntoView().setMeta('paste', true).setMeta('uiEvent', 'paste'));
      env.onPasted?.({ from: tr.mapping.map(start, -1), to: v.state.selection.to, slice: rawSlice, mode });
      return true;
    },
    dispatchTransaction(tr) {
      const next = view.state.apply(tr);
      view.updateState(next);
      env.onTransaction?.(view, tr);
    },
  });

  return {
    view,
    /** Replaces the whole document (new history). */
    setDoc(doc) {
      view.updateState(makeState(doc));
      const sel = TextSelection.atStart(view.state.doc);
      view.dispatch(view.state.tr.setSelection(sel).setMeta('addToHistory', false).setMeta('load', true));
    },
    getDoc: () => view.state.doc,
    focus: () => view.focus(),
    /** Puts the caret near a document position and focuses the editor. */
    focusAt(pos) {
      const $p = view.state.doc.resolve(Math.max(0, Math.min(pos, view.state.doc.content.size)));
      view.dispatch(view.state.tr.setSelection(TextSelection.near($p)));
      view.focus();
    },
    undo: () => undo(view.state, view.dispatch),
    redo: () => redo(view.state, view.dispatch),
    canUndo: () => undoDepth(view.state) > 0,
    canRedo: () => redoDepth(view.state) > 0,
    selectAll: () => selectAll(view.state, view.dispatch),
    hasSelection: () => !view.state.selection.empty,
    /** Re-renders node views (e.g. after pictures change). */
    refresh: () => view.dispatch(view.state.tr.setMeta('addToHistory', false)),
  };
}
