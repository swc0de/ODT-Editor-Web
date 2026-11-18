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
import { toPx } from '../layout/units.js';
import { escAttr } from './odt/xml.js';

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

/** Node view for frames: images (with blob URLs from the package), text boxes, objects. */
class FrameView {
  constructor(node, env) {
    this.env = env;
    this.dom = document.createElement('span');
    this.update(node);
  }

  update(node) {
    if (node.type.name !== 'frame') return false;
    this.node = node;
    const a = node.attrs;
    const fa = a.frameAttrs || {};
    const w = fa['svg:width'] ? toPx(fa['svg:width']) : null;
    const h = fa['svg:height'] ? toPx(fa['svg:height']) : null;
    const anchor = fa['text:anchor-type'] || 'paragraph';
    const pos = this.env.graphicPos(fa['draw:style-name']);
    this.dom.className = `odt-frame kind-${a.kind} anchor-${anchor}${anchor !== 'as-char' ? ` float-${pos}` : ''}`;
    this.dom.contentEditable = 'false';
    this.dom.replaceChildren();
    if (a.kind === 'image') {
      const img = document.createElement('img');
      img.alt = fa['svg:title'] || '';
      img.draggable = false;
      const url = this.env.pictureUrl(a.href) || fa['#pastedSrc'] || '';
      if (url) img.src = url;
      if (w) img.style.width = `${w}px`;
      if (h) img.style.height = `${h}px`;
      this.dom.append(img);
    } else {
      const box = document.createElement('span');
      box.className = 'odt-frame-box';
      box.textContent = a.text || (a.kind === 'object' ? '⧉' : '');
      if (w) box.style.width = `${w}px`;
      if (h) box.style.minHeight = `${h}px`;
      this.dom.append(box);
    }
    return true;
  }

  stopEvent() { return false; }
  ignoreMutation() { return true; }
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
          const wpx = Number(fa['#w']) || 0;
          const hpx = Number(fa['#h']) || 0;
          const toCm = (px) => `${(px / 37.795).toFixed(3)}cm`;
          const frameAttrs = { 'draw:name': `Image${Date.now() % 100000}`, 'text:anchor-type': 'as-char', 'svg:width': wpx ? toCm(wpx) : '8cm', 'svg:height': hpx ? toCm(hpx) : '6cm', 'draw:z-index': '0' };
          const title = fa['svg:title'] ? `<svg:title>${escAttr(fa['svg:title'])}</svg:title>` : '';
          const innerXml = `<draw:image xlink:href="${path}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad" draw:mime-type="${m[1]}"/>${title}`;
          out.push(node.type.create({ ...node.attrs, frameAttrs, innerXml, href: path }));
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
      plugins: [history({ newGroupDelay: 500 }), editorKeymap, keymap(baseKeymap), dropCursor({ color: '#7a93f0' }), gapCursor(), notifyPlugin],
    });
  }

  view = new EditorView(mount, {
    state: makeState(schema.node('doc', null, [schema.node('paragraph')])),
    attributes: { class: 'odt-body', spellcheck: 'true', 'aria-label': 'Document', role: 'textbox', 'aria-multiline': 'true' },
    nodeViews: { frame: (node) => new FrameView(node, env) },
    transformPastedHTML: cleanPastedHTML,
    transformPasted: adoptPastedImages,
    handleDrop: (_v, event) => (event.dataTransfer?.files?.length ? handleFilesDrop(event.dataTransfer.files) : false),
    // Pasting into an empty paragraph takes the pasted paragraph's style
    // (ProseMirror would otherwise keep the empty paragraph's).
    handlePaste(v, _event, slice) {
      const { $from, empty } = v.state.selection;
      const first = slice.content.firstChild;
      if (!empty || !$from.parent.isTextblock || $from.parent.content.size || slice.openStart < 1 || !first?.isTextblock) return false;
      const before = $from.before();
      const tr = v.state.tr.replaceSelection(slice);
      const pos = tr.mapping.map(before, -1);
      const target = tr.doc.nodeAt(pos);
      if (target?.isTextblock && (target.type !== first.type || JSON.stringify(target.attrs) !== JSON.stringify(first.attrs))) {
        try { tr.setNodeMarkup(pos, first.type, first.attrs); } catch { /* incompatible: keep */ }
      }
      v.dispatch(tr.scrollIntoView().setMeta('paste', true).setMeta('uiEvent', 'paste'));
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
