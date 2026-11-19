/**
 * App services for drawing objects: what the object node views need from the
 * app (style index, zoom, nested text editors, moving objects between
 * paragraphs, inserting picture files) and which object is selected, for the
 * Picture Format / Shape Format tabs and the Arrange commands.
 */
import { NodeSelection, TextSelection, Plugin } from 'prosemirror-state';
import { Fragment } from 'prosemirror-model';
import { schema } from '../core/schema.js';
import { imageAttrs, uniqueName, maxZ, withPosition, withRotation, withFrameAttrs, cm, sizeOf, wrapOf, originOf, rotationOf } from '../core/objects.js';
import { toPx } from '../layout/units.js';
import { findChildren } from '../core/odt/xml.js';

const TEXTBLOCK = 'p, h1, h2, h3, h4, h5, h6';

export function createObjectServices({ store, docArea, getSession, getMainEditor, createEditor, nestedEnv, toast, t, registry }) {
  let activeInner = null; // { editor, ov } while a text box / shape text has focus
  let selectedView = null;
  const renderers = {};
  const zoom = () => store.get().zoom / 100;

  /** Nested editor for the text of a text box or shape. */
  function createNested(mount, ov) {
    let syncing = false;
    const ed = createEditor(mount, nestedEnv({
      onTransaction: (v, tr) => {
        if (syncing || !tr.docChanged || tr.getMeta('load')) return;
        ov.setAttrs({ ...ov.node.attrs, body: v.state.doc.content.toJSON() });
      },
    }));
    const docOf = (body) => schema.node('doc', null, Fragment.fromJSON(schema, body?.length ? body : [{ type: 'paragraph', attrs: { styleName: ov.node.attrs.kind === 'textbox' ? 'Frame_20_contents' : 'Standard' } }]));
    syncing = true;
    ed.setDoc(docOf(ov.node.attrs.body));
    syncing = false;
    ed.view.dom.setAttribute('aria-label', ov.node.attrs.kind === 'textbox' ? t('obj.textBoxText') : t('obj.shapeText'));
    ed.view.dom.addEventListener('focus', () => { activeInner = { editor: ed, ov }; store.set({ objectText: true }); });
    return {
      view: ed.view,
      focus: () => ed.focus(),
      sync(body) {
        if (JSON.stringify(ed.view.state.doc.content.toJSON()) === JSON.stringify(body)) return;
        syncing = true;
        const sel = ed.view.state.selection;
        ed.setDoc(docOf(body));
        try { ed.view.dispatch(ed.view.state.tr.setSelection(TextSelection.create(ed.view.state.doc, Math.min(sel.from, ed.view.state.doc.content.size - 1))).setMeta('addToHistory', false)); } catch { /* keep default */ }
        syncing = false;
      },
      destroy() { if (activeInner?.editor === ed) { activeInner = null; store.set({ objectText: false }); } ed.view.destroy(); },
    };
  }

  function leaveInner() { if (activeInner) { activeInner = null; store.set({ objectText: false }); } }

  /** The paragraph DOM element anchoring an object view. */
  const anchorEl = (ov) => ov.dom.parentElement?.closest(TEXTBLOCK) || null;

  /** Width (px) of the paragraph an object floats in. */
  function anchorWidth(ov) {
    const p = anchorEl(ov);
    if (p) { const w = p.getBoundingClientRect().width / zoom(); if (w > 1) return w; }
    return docArea.model?.first?.bodyWidth || 600;
  }

  /**
   * Moves a floating object by (dx, dy) px. If its new top-left is over another
   * paragraph, it is re-anchored there (as Word does with "Move with text").
   */
  function moveObject(ov, { dx, dy, origin }) {
    const view = ov.view;
    const pos = ov.getPos();
    if (pos == null) return;
    const node = ov.node;
    const a = node.attrs;
    const z = zoom();
    const oldP = anchorEl(ov);
    if (!oldP) return;
    const pr = oldP.getBoundingClientRect();
    let ox; let oy;
    if (a.element === 'draw:line') {
      const fa = a.frameAttrs;
      ox = Math.min(toPx(fa['svg:x1'] || '0'), toPx(fa['svg:x2'] || '0'));
      oy = Math.min(toPx(fa['svg:y1'] || '0'), toPx(fa['svg:y2'] || '0'));
    } else { ox = origin.x; oy = origin.y; }
    // New top-left on screen.
    const sx = pr.left + (ox + dx) * z;
    const sy = pr.top + (oy + dy) * z;
    // The paragraph under that point (clamped into the page body horizontally).
    const probe = view.posAtCoords({ left: Math.max(pr.left + 2, Math.min(pr.right - 2, sx + 4)), top: sy + 2 });
    let targetPos = null;
    let targetEl = oldP;
    if (probe) {
      const $p = view.state.doc.resolve(probe.pos);
      for (let d = $p.depth; d > 0; d--) {
        if ($p.node(d).isTextblock) {
          const before = $p.before(d);
          const dom = view.nodeDOM(before);
          if (dom && dom !== oldP && dom.nodeType === 1) { targetPos = before; targetEl = dom; }
          break;
        }
      }
    }
    const tr0 = targetEl.getBoundingClientRect();
    const nx = (sx - tr0.left) / z;
    const ny = (sy - tr0.top) / z;
    let next;
    if (a.element === 'draw:line') {
      const fa = a.frameAttrs;
      const shift = (k, d) => cm(toPx(fa[k] || '0') + d);
      const ddx = nx - ox; const ddy = ny - oy;
      next = withFrameAttrs(a, { 'svg:x1': shift('svg:x1', ddx), 'svg:x2': shift('svg:x2', ddx), 'svg:y1': shift('svg:y1', ddy), 'svg:y2': shift('svg:y2', ddy) });
    } else if (a.frameAttrs['draw:transform']) next = withRotation(a, Number(/rotate\s*\(\s*(-?[\d.eE+-]+)/.exec(a.frameAttrs['draw:transform'])?.[1] || 0) * 180 / Math.PI, { x: nx, y: ny });
    else next = withPosition(a, { x: nx, y: ny, hrel: 'paragraph', vrel: 'paragraph' });
    const tr = view.state.tr;
    if (targetPos == null) {
      tr.setNodeMarkup(pos, null, next);
      tr.setSelection(NodeSelection.create(tr.doc, pos));
    } else {
      tr.delete(pos, pos + node.nodeSize);
      const at = tr.mapping.map(targetPos) + 1;
      tr.insert(at, node.type.create(next));
      tr.setSelection(NodeSelection.create(tr.doc, at));
    }
    view.dispatch(tr);
    view.focus();
  }

  /** Inserts picture files (in line with text) at pos or the selection, and selects the last one. */
  async function insertPictures(files, pos = null) {
    const ed = activeInner?.editor || getMainEditor();
    const view = ed.view;
    const body = docArea.model?.first;
    const maxW = body?.bodyWidth || 600;
    const maxH = (body ? (body.height - body.marginTop - body.marginBottom) : 900) * 0.9;
    let at = pos ?? view.state.selection.from;
    for (const file of files) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let type = file.type || 'image/png';
      if (!/^image\/(png|jpeg|gif|svg\+xml|webp|bmp)$/.test(type)) { toast?.(t('obj.unsupportedPicture', { name: file.name })); continue; }
      if (type === 'image/webp' || type === 'image/bmp') type = file.type;
      const size = await naturalSize(bytes, type);
      let w = size.w || 300; let h = size.h || 225;
      const k = Math.min(1, maxW / w, maxH / h);
      w *= k; h *= k;
      const path = getSession().state && nestedAddPicture(bytes, type);
      const doc = view.state.doc;
      const node = schema.nodes.frame.create(imageAttrs({ path, mime: type, w, h, name: uniqueName(doc, t('obj.pictureName')), z: maxZ(doc) + 1 }));
      const tr = view.state.tr;
      const $at = tr.doc.resolve(Math.min(at, tr.doc.content.size));
      if ($at.parent.inlineContent) tr.insert(at, node); else tr.replaceSelectionWith(node);
      const placed = $at.parent.inlineContent ? at : tr.selection.from - node.nodeSize;
      tr.setSelection(NodeSelection.create(tr.doc, placed));
      view.dispatch(tr.scrollIntoView());
      at = placed + 1;
    }
    view.focus();
    if (store.get().activeTab !== 'pictureFormat') store.set({ activeTab: 'pictureFormat' });
  }
  let nestedAddPicture = () => '';

  /** The object the Format tabs and Arrange commands act on. */
  function selected(editor) {
    const view = editor?.view;
    if (view) {
      const sel = view.state.selection;
      if (sel instanceof NodeSelection && sel.node.type.name === 'frame') return { view, pos: sel.from, node: sel.node, ov: selectedView?.node === sel.node ? selectedView : null };
    }
    if (activeInner) {
      const ov = activeInner.ov;
      const pos = ov.getPos();
      if (pos != null) return { view: ov.view, pos, node: ov.node, ov, inText: true };
    }
    return null;
  }

  /** stroke-dasharray for a named draw:stroke-dash. */
  function dashArray(name, sw) {
    const st = getSession()?.state;
    const dash = name && findChildren(st?.commonStyles || { c: [] }, 'draw:stroke-dash').find((d) => d.a['draw:name'] === name);
    if (!dash) return `${sw * 4} ${sw * 3}`;
    const len = (k, d) => { const v = dash.a[k]; if (!v) return d; return /%$/.test(v) ? (parseFloat(v) / 100) * sw : toPx(v) || d; };
    const out = [];
    for (let i = 0; i < Number(dash.a['draw:dots1'] || 1); i++) out.push(len('draw:dots1-length', sw), len('draw:distance', sw * 2));
    for (let i = 0; i < Number(dash.a['draw:dots2'] || 0); i++) out.push(len('draw:dots2-length', sw), len('draw:distance', sw * 2));
    return out.map((v) => v.toFixed(2)).join(' ');
  }

  /** Font of a WordArt shape: its graphic style's text properties, else its first text. */
  function wordArtFont(attrs) {
    const tp = attrs.auto?.props?.['style:text-properties']?.a || {};
    let name = tp['style:font-name'] || tp['fo:font-family'];
    if (!name) {
      const first = attrs.body?.[0]?.content?.find((c) => c.marks);
      const mk = first?.marks?.find((m) => m.type === 'textProps');
      name = mk?.attrs?.auto?.props?.['style:text-properties']?.a?.['style:font-name'];
    }
    return name ? `"${String(name).replace(/["']/g, '')}", Carlito, sans-serif` : 'Carlito, sans-serif';
  }

  const env = {
    styleIndex: () => docArea.styleIndex,
    zoom,
    anchorWidth,
    pageMarginLeft: () => docArea.model?.first?.marginLeft || 0,
    cropMode: () => !!store.get().cropMode,
    moveObject,
    onObjectSelected: (ov) => { selectedView = ov; if (!ov && store.get().cropMode) store.set({ cropMode: false }); },
    /** Double-click: edit the equation / the shape's text / the WordArt text. */
    onObjectDblClick: (ov) => {
      const k = ov.node.attrs.kind;
      if (k === 'equation') registry?.run('insert.editEquation');
      else if (k === 'chart') registry?.run('insert.editChart');
      else if (k === 'shape' || k === 'wordart') registry?.run('shapeFormat.editText');
    },
    /** Esc ends crop mode. */
    endCrop: () => { if (!store.get().cropMode) return false; store.set({ cropMode: false }); if (selectedView?.selected) selectedView.render(selectedView.node); return true; },
    createNested,
    insertPictures,
    renderObject: (attrs, w, h) => renderers[attrs.kind]?.(attrs, w, h) || null,
    dashArray,
    wordArtFont,
  };

  /** Arrow keys nudge a selected floating object (0.1 cm; Ctrl: 1 px). */
  const keyPlugin = new Plugin({
    props: {
      handleKeyDown(view, e) {
        const sel = view.state.selection;
        if (e.key === 'Escape' && env.endCrop()) return true;
        if (!(sel instanceof NodeSelection) || sel.node.type.name !== 'frame') return false;
        const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
        if (!d || e.altKey || e.shiftKey) return false;
        const a = sel.node.attrs;
        if (wrapOf(a, docArea.styleIndex) === 'inline') return false;
        const step = e.ctrlKey || e.metaKey ? 1 : 96 / 25.4;
        let next;
        if (a.element === 'draw:line') {
          const fa = a.frameAttrs;
          const sh = (k, v) => cm(toPx(fa[k] || '0') + v);
          next = withFrameAttrs(a, { 'svg:x1': sh('svg:x1', d[0] * step), 'svg:x2': sh('svg:x2', d[0] * step), 'svg:y1': sh('svg:y1', d[1] * step), 'svg:y2': sh('svg:y2', d[1] * step) });
        } else {
          const o = originOf(a);
          const p = { x: Math.max(0, o.x + d[0] * step), y: Math.max(0, o.y + d[1] * step) };
          next = a.frameAttrs['draw:transform'] ? withRotation(a, rotationOf(a), p) : withPosition(a, { ...p, hpos: 'from-left' });
        }
        const tr = view.state.tr.setNodeMarkup(sel.from, null, next);
        tr.setSelection(NodeSelection.create(tr.doc, sel.from));
        view.dispatch(tr);
        return true;
      },
    },
  });

  return {
    env,
    keyPlugin,
    renderers,
    activeEditor: () => (activeInner ? { view: activeInner.editor.view, focus: () => activeInner?.editor.focus(), getDoc: () => activeInner.editor.view.state.doc } : null),
    leaveInner,
    selected,
    insertPictures,
    setAddPicture(fn) { nestedAddPicture = fn; },
    sizeOf,
  };
}

/** Natural size (px) of picture bytes. */
export async function naturalSize(bytes, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { w: img.naturalWidth, h: img.naturalHeight };
  } catch {
    return { w: 0, h: 0 };
  } finally {
    URL.revokeObjectURL(url);
  }
}
