/**
 * Footnote and endnote areas. The paginator asks for the height of the
 * footnotes referenced in each paragraph (heights()) and of all endnotes
 * (endnotesHeight()), reserves that room, and after each layout render()
 * draws every page's footnotes at the bottom of its body (below a short
 * separator) and the endnotes after the last paragraph. Each note's text is
 * edited in place by a nested editor (createNested); edits go back into the
 * note node's body.
 */
import { DOMSerializer, Fragment } from 'prosemirror-model';
import { Plugin, TextSelection } from 'prosemirror-state';
import { schema } from '../core/schema.js';
import { NOTE_SEP } from './paginator.js';

const keyOf = (node, pos) => node.attrs.extra?.['text:id'] || `@${pos}`;

export function createNotesLayer({ layer, getView, getModel, getZoom, isEndnoteMode, createNested, labelOf = () => '' }) {
  const host = layer.firstChild;
  const measurer = document.createElement('div');
  measurer.className = 'notes-measure';
  layer.append(measurer);
  const heightCache = new Map();
  const rows = new Map(); // key → { row, num, editor, mount }
  let serializer = null;

  const width = () => getModel()?.first?.bodyWidth || 600;

  function staticBody(node) {
    serializer ??= DOMSerializer.fromSchema(schema);
    const frag = Fragment.fromJSON(schema, node.attrs.body?.length ? node.attrs.body : [{ type: 'paragraph', attrs: { styleName: 'Footnote' } }]);
    const div = document.createElement('div');
    div.className = 'odt-mirror fn-text';
    div.append(serializer.serializeFragment(frag));
    return div;
  }

  /** Height (px) of a note as drawn in its area. */
  function noteHeight(node) {
    const key = `${width()}|${node.attrs.citation}|${JSON.stringify(node.attrs.body)}`;
    let h = heightCache.get(key);
    if (h == null) {
      const row = document.createElement('div');
      row.className = 'fn-row';
      const num = document.createElement('span');
      num.className = 'fn-num';
      num.textContent = node.attrs.citation || '';
      row.append(num, staticBody(node));
      measurer.style.width = `${width()}px`;
      measurer.replaceChildren(row);
      h = row.getBoundingClientRect().height / (getZoom() || 1);
      if (heightCache.size > 2000) heightCache.clear();
      heightCache.set(key, h);
    }
    return h;
  }

  /** Footnotes referenced inside a block at pos: [{ pos, h, key }]. */
  function heights(pos, node) {
    const out = [];
    node.descendants((n, off) => {
      if (n.type.name === 'note' && n.attrs.noteClass !== 'endnote' && !isEndnoteMode()) out.push({ pos: pos + 1 + off, h: noteHeight(n), key: keyOf(n, pos + 1 + off) });
      return n.type.name !== 'note';
    });
    return out;
  }

  /** The endnotes (and footnotes collected at the end of the document) in order. */
  function endnotes() {
    const out = [];
    getView()?.state.doc.descendants((n, pos) => {
      if (n.type.name === 'note' && (n.attrs.noteClass === 'endnote' || isEndnoteMode())) out.push({ node: n, pos });
      return true;
    });
    return out;
  }

  function endnotesHeight() {
    const list = endnotes();
    return list.length ? list.reduce((a, x) => a + noteHeight(x.node), 0) + NOTE_SEP : 0;
  }

  /** An adapter so the nested editor can read and write the note. */
  function adapter(key) {
    const find = () => {
      let found = null;
      getView().state.doc.descendants((n, pos) => { if (found) return false; if (n.type.name === 'note' && keyOf(n, pos) === key) found = { node: n, pos }; return true; });
      return found;
    };
    return {
      isNote: true,
      get defaultStyle() { return find()?.node.attrs.noteClass === 'endnote' ? 'Endnote' : 'Footnote'; },
      get label() { return labelOf(find()?.node); },
      get node() { return find()?.node || schema.nodes.note.create(); },
      getPos: () => find()?.pos ?? null,
      setAttrs(attrs) {
        const f = find();
        if (!f) return;
        const view = getView();
        view.dispatch(view.state.tr.setNodeMarkup(f.pos, null, attrs).setMeta('noteEdit', true));
      },
    };
  }

  function rowFor(node, pos) {
    const key = keyOf(node, pos);
    let r = rows.get(key);
    if (!r) {
      const row = document.createElement('div');
      row.className = 'fn-row';
      row.dataset.key = key;
      const num = document.createElement('span');
      num.className = 'fn-num';
      const ad = adapter(key);
      // Double-click the number: back to the reference in the text.
      num.addEventListener('dblclick', () => {
        const pos = ad.getPos();
        const view = getView();
        if (pos == null || !view) return;
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos + 1)).scrollIntoView());
        view.focus();
      });
      const mount = document.createElement('div');
      mount.className = 'fn-text';
      row.append(num, mount);
      const editor = createNested(mount, ad);
      r = { row, num, mount, editor, key, adapter: ad };
      rows.set(key, r);
    } else if (!r.editor.view.hasFocus()) r.editor.sync(node.attrs.body);
    r.num.textContent = node.attrs.citation || '';
    r.row.dataset.cls = node.attrs.noteClass;
    r.used = true;
    return r.row;
  }

  const areas = new Map(); // `${page}|${kind}` → element (kept, so a focused note editor isn't detached)

  function area(id, x, y, w, kind) {
    let a = areas.get(id);
    if (!a) {
      a = document.createElement('div');
      a.className = `fn-area ${kind}`;
      const sep = document.createElement('div');
      sep.className = 'fn-sep';
      a.append(sep);
      areas.set(id, a);
    }
    a.style.left = `${x}px`;
    a.style.top = `${y}px`;
    a.style.width = `${w}px`;
    a.used = true;
    return a;
  }

  function fill(a, list) {
    const kids = [...a.children].slice(1);
    if (kids.length === list.length && kids.every((k, i) => k === list[i])) return;
    a.replaceChildren(a.firstChild, ...list);
  }

  /** Draws the note areas of all pages. */
  function render(pages) {
    const view = getView();
    const model = getModel();
    if (!view || !model) return;
    if (!createNested) { host.replaceChildren(); return; }
    // Moving a row to another page's area blurs its editor: focus it again after.
    const hadFocus = [...rows.values()].find((r) => r.editor.view.hasFocus());
    for (const r of rows.values()) r.used = false;
    for (const a of areas.values()) a.used = false;
    const order = [];
    for (const p of pages) {
      const m = model.masters.get(p.master) || model.first;
      const x = m.x + m.marginLeft;
      if (p.notes?.length) {
        const a = area(`${p.index}|f`, x, p.top + p.box.bottom - p.notesH - NOTE_SEP, m.bodyWidth, 'footnotes');
        const list = [];
        for (const n of p.notes) {
          const node = view.state.doc.nodeAt(n.pos);
          if (node?.type.name === 'note') list.push(rowFor(node, n.pos));
        }
        fill(a, list);
        order.push(a);
      }
      if (p.endnotes) {
        const a = area(`${p.index}|e`, x, p.endnotes.y - NOTE_SEP, m.bodyWidth, 'endnotes');
        fill(a, endnotes().map(({ node, pos }) => rowFor(node, pos)));
        order.push(a);
      }
    }
    for (const [id, a] of areas) if (!a.used) { a.remove(); areas.delete(id); }
    order.forEach((a, i) => { if (host.children[i] !== a) host.insertBefore(a, host.children[i] || null); });
    for (const [k, r] of rows) if (!r.used) { r.editor.destroy(); r.row.remove(); rows.delete(k); }
    if (hadFocus?.used && !hadFocus.editor.view.hasFocus()) hadFocus.editor.focus();
  }

  /** Focuses the text of the note at pos (in the main document). */
  function focusNote(pos) {
    const view = getView();
    const node = view.state.doc.nodeAt(pos);
    if (!node) return false;
    const r = rows.get(keyOf(node, pos));
    if (!r) return false;
    r.row.scrollIntoView({ block: 'nearest' });
    r.editor.focus();
    return true;
  }

  // Double-click a reference in the text: edit its note.
  const plugin = new Plugin({
    props: {
      handleDoubleClickOn(_view, _pos, node, nodePos) {
        if (node.type.name !== 'note') return false;
        return focusNote(nodePos);
      },
    },
  });

  return {
    plugin,
    heights, endnotesHeight, render, focusNote, keyOf, rowFor,
    setCreateNested(fn) { createNested = fn; },
    clearCache() { heightCache.clear(); },
    /** The note whose text editor has focus: { node, pos } or null. */
    focused() {
      for (const r of rows.values()) {
        if (r.editor.view.hasFocus()) { const pos = r.adapter.getPos(); return pos == null ? null : { node: getView().state.doc.nodeAt(pos), pos, editor: r.editor }; }
      }
      return null;
    },
  };
}
