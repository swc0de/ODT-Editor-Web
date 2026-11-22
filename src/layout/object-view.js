/**
 * Node view for drawing objects (the frame node): pictures, text boxes,
 * shapes, lines, WordArt, equations, charts and other embedded objects.
 *
 * Wrapping is done with CSS on the paragraph that anchors the object:
 *   inline        inline-block in the line
 *   square/tight  a float (left or right, by position) pushed down by a
 *                 zero-width float of height y, so text flows beside it
 *   topBottom     a full-width float: no text beside it
 *   behind/front/through  absolutely positioned from the paragraph's top-left
 * Text boxes and shape text are edited in place by a nested editor
 * (env.createNested) whose changes are written back to the node's body.
 * Selection handles (resize, rotate, crop) are drawn by object-handles.js.
 */
import { NodeSelection } from 'prosemirror-state';
import { toPx } from './units.js';
import { graphicProps, sizeOf, wrapOf, positionOf, rotationOf, originOf } from '../core/objects.js';
import { shapePath, shapeTextInsets } from '../core/shapes.js';
import { attachHandles } from './object-handles.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const el = (tag, cls, style) => { const e = document.createElement(tag); if (cls) e.className = cls; if (style) Object.assign(e.style, style); return e; };
const svgEl = (tag, attrs = {}) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, String(v)); return e; };
const pct = (v) => (v ? parseFloat(v) || 0 : 0);
let filterSeq = 0;

/** "rect(0cm, 1cm, 0cm, 2cm)" → [t, r, b, l] px */
function parseClip(clip) {
  const m = /rect\(([^)]*)\)/.exec(clip || '');
  if (!m) return null;
  const v = m[1].split(/[\s,]+/).filter(Boolean).map((x) => (x === 'auto' ? 0 : toPx(x) || 0));
  return v.length === 4 && v.some((x) => x) ? v : null;
}

/** CSS box-shadow from style:shadow="#808080 0.18cm 0.18cm". */
function cssShadow(s) {
  if (!s || s === 'none') return '';
  const m = /(#[0-9a-f]{3,8}|\w+)\s+(-?[\d.]+\w+)\s+(-?[\d.]+\w+)(?:\s+(-?[\d.]+\w+))?/i.exec(s);
  return m ? `${toPx(m[2])}px ${toPx(m[3])}px ${m[4] ? toPx(m[4]) : 0}px ${m[1]}` : '';
}

/** CSS border shorthand from an ODF one ("0.75pt solid #000000"). */
const cssBorder = (b) => (b && b !== 'none' ? b.replace(/([\d.]+)(pt|cm|mm|in)/, (_, n, u) => `${Math.max(1, toPx(`${n}${u}`)).toFixed(2)}px`) : '');

export class ObjectView {
  constructor(node, view, getPos, env) {
    this.view = view;
    this.getPos = getPos;
    this.env = env;
    this.inner = null;
    this.dom = el('span', 'odt-obj');
    this.dom.contentEditable = 'false';
    this.dom.addEventListener('dblclick', (e) => { if (!e.target.closest('.obj-text, .obj-handle')) { e.preventDefault(); env.onObjectDblClick?.(this); } });
    this.render(node);
  }

  get attrs() { return this.node.attrs; }

  render(node) {
    this.node = node;
    const a = node.attrs;
    const index = this.env.styleIndex?.();
    const gp = graphicProps(a, index);
    const wrap = wrapOf(a, index);
    const { w, h } = sizeOf(a);
    this.wrap = wrap;
    this.gp = gp;
    this.size = { w, h };
    const hidden = a.frameAttrs?.['draw:display'] === 'none';
    this.dom.className = `odt-obj kind-${a.kind} wrap-${wrap}${hidden ? ' obj-hidden' : ''}${this.selected ? ' ProseMirror-selectednode' : ''}`;
    this.dom.dataset.name = a.frameAttrs?.['draw:name'] || '';
    this.dom.replaceChildren();
    this.dom.removeAttribute('style');

    const box = el('span', 'obj-box');
    this.box = box;
    box.style.width = `${w}px`;
    if (a.kind === 'textbox') box.style.minHeight = `${h}px`; else box.style.height = `${h}px`;
    const rot = rotationOf(a);
    const transforms = [];
    if (rot) transforms.push(`rotate(${-rot}deg)`);
    if (transforms.length) box.style.transform = transforms.join(' ');

    // Frame decoration (pictures, text boxes): border, padding, background, shadow.
    if (a.element === 'draw:frame') {
      for (const side of ['', '-top', '-right', '-bottom', '-left']) {
        const b = gp[`fo:border${side}`];
        if (b) box.style[`border${side ? side[1].toUpperCase() + side.slice(2) : ''}`] = cssBorder(b) || 'none';
      }
      if (gp['fo:padding'] && a.kind === 'textbox') box.style.padding = `${toPx(gp['fo:padding'])}px`;
      for (const side of ['top', 'right', 'bottom', 'left']) if (gp[`fo:padding-${side}`] && a.kind === 'textbox') box.style[`padding${side[0].toUpperCase()}${side.slice(1)}`] = `${toPx(gp[`fo:padding-${side}`])}px`;
      const bg = gp['fo:background-color'] && gp['fo:background-color'] !== 'transparent' ? gp['fo:background-color'] : (gp['draw:fill'] === 'solid' ? gp['draw:fill-color'] : null);
      if (bg && a.kind !== 'image') box.style.background = bg;
      const sh = cssShadow(gp['style:shadow']);
      if (sh) box.style.boxShadow = sh;
      box.style.boxSizing = 'border-box';
    }

    switch (a.kind) {
      case 'image': this.renderImage(box, gp, w, h); break;
      case 'textbox': this.renderText(box, gp, null); break;
      case 'shape': this.renderShape(box, gp, w, h); break;
      case 'wordart': this.renderWordArt(box, gp, w, h); break;
      case 'line': this.renderLine(box, gp); break;
      case 'ink': this.renderInk(box, gp, w, h); break;
      case 'canvas': case 'group': this.renderGroup(box, w, h); break;
      default: this.renderObject(box, w, h);
    }

    this.place(a, gp, wrap, w, h);
    if (this.selected) this.handles = attachHandles(this);
  }

  /** Puts the box in the paragraph according to the wrapping. */
  place(a, gp, wrap, w, h) {
    const dom = this.dom;
    const pos = positionOf(a, this.env.styleIndex?.());
    const m = (k) => (gp[k] ? toPx(gp[k]) : 0);
    const margins = { l: m('fo:margin-left'), r: m('fo:margin-right'), t: m('fo:margin-top'), b: m('fo:margin-bottom') };
    let { x, y } = a.frameAttrs?.['draw:transform'] ? originOf(a) : pos;
    if (a.element === 'draw:line') { const fa = a.frameAttrs; x = Math.min(toPx(fa['svg:x1'] || '0'), toPx(fa['svg:x2'] || '0')); y = Math.min(toPx(fa['svg:y1'] || '0'), toPx(fa['svg:y2'] || '0')); }
    if (pos.hrel === 'page' || pos.hrel === 'page-start-margin') x -= this.env.pageMarginLeft?.() || 0;
    if (wrap === 'inline') {
      dom.append(this.box);
      // As-char objects sit on the baseline (or centred / at the top of the line).
      const vpos = pos.vpos;
      dom.style.verticalAlign = vpos === 'middle' ? 'middle' : (vpos === 'top' && pos.vrel === 'line' ? 'top' : 'bottom');
      return;
    }
    if (wrap === 'behind' || wrap === 'front' || wrap === 'through') {
      dom.style.left = `${x}px`;
      dom.style.top = `${y}px`;
      dom.append(this.box);
      return;
    }
    const container = this.env.anchorWidth?.(this) || 0;
    // Which side the object floats to: by alignment, else by where its middle is.
    let side = 'left';
    if (pos.hpos === 'right' || pos.hpos === 'outside') side = 'right';
    else if (pos.hpos === 'from-left' && container && x + w / 2 > container / 2 + 1) side = 'right';
    // Too little room beside it for text (under 1.5 cm): text goes above and below, as in Writer and Word.
    const leftEdge = pos.hpos === 'center' ? (container - w) / 2 : (side === 'right' && pos.hpos !== 'from-left' ? container - w : Math.max(0, x));
    const room = side === 'left' ? container - leftEdge - w : leftEdge;
    const narrow = container && wrap !== 'topBottom' && pos.hpos !== 'center' && room < 57;
    if (wrap === 'topBottom' || narrow) {
      const row = el('span', 'obj-row');
      row.style.marginTop = `${Math.max(0, y)}px`;
      row.style.paddingTop = `${margins.t}px`;
      row.style.paddingBottom = `${margins.b}px`;
      const left = pos.hpos === 'center' ? `calc(50% - ${w / 2}px)` : (pos.hpos === 'right' || pos.hpos === 'outside' ? `calc(100% - ${w}px)` : `${Math.max(0, x)}px`);
      this.box.style.marginLeft = left;
      row.append(this.box);
      if (y > 0) dom.append(el('span', 'obj-spacer', { height: `${y}px` }));
      dom.append(row);
      return;
    }
    // Square / tight. A rotated object takes the space of its rotated bounding box.
    const rot = rotationOf(a) * Math.PI / 180;
    if (rot) {
      const bw = Math.abs(w * Math.cos(rot)) + Math.abs(h * Math.sin(rot));
      const bh = Math.abs(w * Math.sin(rot)) + Math.abs(h * Math.cos(rot));
      x += (w - bw) / 2; y += (h - bh) / 2;
      Object.assign(this.box.style, { marginLeft: `${(bw - w) / 2}px`, marginRight: `${(bw - w) / 2}px`, marginTop: `${(bh - h) / 2}px`, marginBottom: `${(bh - h) / 2}px` });
      w = bw;
    }
    if (y > 0) dom.append(el('span', `obj-spacer ${side}`, { height: `${y}px` }));
    const fl = el('span', `obj-float ${side}`);
    fl.style.paddingTop = `${margins.t}px`;
    fl.style.paddingBottom = `${margins.b}px`;
    if (side === 'left') {
      const left = pos.hpos === 'center' ? `calc(50% - ${w / 2}px)` : `${Math.max(0, x)}px`;
      fl.style.marginLeft = left;
      fl.style.paddingRight = `${margins.r}px`;
    } else {
      fl.style.marginRight = pos.hpos === 'right' || pos.hpos === 'outside' || !container ? '0px' : `${Math.max(0, container - x - w)}px`;
      fl.style.paddingLeft = `${margins.l}px`;
    }
    fl.append(this.box);
    dom.append(fl);
  }

  // ------------------------------------------------------------ kinds

  renderImage(box, gp, w, h) {
    const a = this.attrs;
    const url = this.env.pictureUrl(a.href) || a.frameAttrs?.['#pastedSrc'] || '';
    const crop = el('span', 'obj-crop');
    const img = el('img');
    img.alt = (a.parts || []).find((p) => p.n === 'svg:title')?.c?.[0] || '';
    img.draggable = false;
    if (url) img.src = url;
    const clip = parseClip(gp['fo:clip']);
    const layout = () => {
      if (!clip || !img.naturalWidth) { Object.assign(img.style, { left: '0', top: '0', width: '100%', height: '100%' }); return; }
      // fo:clip is measured on the picture's own size (pixels at 96 dpi).
      const nw = img.naturalWidth; const nh = img.naturalHeight;
      const [t, r, b, l] = clip;
      const sx = w / Math.max(1, nw - l - r);
      const sy = h / Math.max(1, nh - t - b);
      Object.assign(img.style, { left: `${-l * sx}px`, top: `${-t * sy}px`, width: `${nw * sx}px`, height: `${nh * sy}px` });
    };
    img.addEventListener('load', () => { layout(); this.natural = { w: img.naturalWidth, h: img.naturalHeight }; this.env.onImageLoad?.(); }, { once: true });
    layout();
    // Picture corrections.
    const f = [];
    const lum = pct(gp['draw:luminance']);
    const con = pct(gp['draw:contrast']);
    if (lum) f.push(`brightness(${(1 + lum / 100).toFixed(3)})`);
    if (con) f.push(`contrast(${Math.max(0, 1 + con / 100).toFixed(3)})`);
    const mode = gp['draw:color-mode'];
    if (mode === 'greyscale') f.push('grayscale(1)');
    if (mode === 'mono') f.push('grayscale(1) contrast(12)');
    if (mode === 'watermark') f.push('brightness(1.5) contrast(0.3)');
    const rgb = ['draw:red', 'draw:green', 'draw:blue'].map((k) => pct(gp[k]));
    if (rgb.some((v) => v)) {
      const id = `odt-tint-${++filterSeq}`;
      const s = svgEl('svg', { width: 0, height: 0, class: 'obj-defs', 'aria-hidden': 'true' });
      const flt = svgEl('filter', { id, 'color-interpolation-filters': 'sRGB' });
      const ct = svgEl('feComponentTransfer');
      ['R', 'G', 'B'].forEach((c, i) => ct.append(svgEl(`feFunc${c}`, { type: 'linear', slope: 1, intercept: rgb[i] / 100 })));
      flt.append(ct);
      s.append(flt);
      crop.append(s);
      f.push(`url(#${id})`);
    }
    if (f.length) img.style.filter = f.join(' ');
    const op = gp['draw:image-opacity'];
    if (op && op !== '100%') img.style.opacity = String(pct(op) / 100);
    const mirror = gp['style:mirror'] || '';
    const sx = /horizontal/.test(mirror) ? -1 : 1;
    const sy = /vertical/.test(mirror) ? -1 : 1;
    if (sx < 0 || sy < 0) crop.style.transform = `scale(${sx}, ${sy})`;
    crop.append(img);
    box.append(crop);
  }

  /** Shape outline from its preset / path, filled and stroked from the graphic style. */
  renderShape(box, gp, w, h) {
    const a = this.attrs;
    const svg = svgEl('svg', { class: 'obj-svg', width: w, height: h, viewBox: `0 0 ${w} ${h}`, overflow: 'visible' });
    const d = shapePath(a, w, h);
    svg.append(svgEl('path', { d, ...this.paint(gp), 'fill-rule': 'evenodd' }));
    const geo = (a.parts || []).find((p) => p.n === 'draw:enhanced-geometry');
    const mh = geo?.a?.['draw:mirror-horizontal'] === 'true';
    const mv = geo?.a?.['draw:mirror-vertical'] === 'true';
    if (mh || mv) svg.style.transform = `scale(${mh ? -1 : 1}, ${mv ? -1 : 1})`;
    this.shadow(svg, gp);
    box.append(svg);
    if (a.body?.length || this.editingText) this.renderText(box, gp, shapeTextInsets(a));
  }

  /** A pen stroke (draw:path / polyline / polygon), scaled from its viewBox. */
  renderInk(box, gp, w, h) {
    const svg = svgEl('svg', { class: 'obj-svg ink-svg', width: w, height: h, overflow: 'visible' });
    svg.append(inkShape(this.attrs.element, this.attrs.frameAttrs, gp, w, h, this.paint(gp), this.dom.dataset.name));
    box.append(svg);
  }

  /** A Drawing Canvas or other group: its shapes in the group's coordinates. */
  renderGroup(box, w, h) {
    const svg = svgEl('svg', { class: 'obj-svg group-svg', width: w, height: h, overflow: 'visible' });
    (this.attrs.parts || []).forEach((p, i) => {
      const g = p['#graphic'] || {};
      const node = groupChild(p, g, this.paint(g), this.env);
      if (node) { node.dataset.child = String(i); svg.append(node); }
    });
    box.append(svg);
  }

  renderWordArt(box, gp, w, h) {
    const svg = svgEl('svg', { class: 'obj-svg', width: w, height: h, viewBox: `0 0 ${w} ${h}`, overflow: 'visible' });
    const text = (this.attrs.body || []).map((b) => (b.content || []).map((c) => c.text || '').join('')).join(' ') || ' ';
    const font = this.env.wordArtFont?.(this.attrs) || 'Carlito, sans-serif';
    const t = svgEl('text', { x: 0, y: h * 0.82, 'font-size': h * 0.95, 'font-family': font, textLength: w, lengthAdjust: 'spacingAndGlyphs', ...this.paint(gp, true) });
    t.textContent = text;
    svg.append(t);
    this.shadow(svg, gp);
    box.append(svg);
  }

  renderLine(box, gp) {
    const fa = this.attrs.frameAttrs;
    const x1 = toPx(fa['svg:x1'] || '0'); const y1 = toPx(fa['svg:y1'] || '0');
    const x2 = toPx(fa['svg:x2'] || '0'); const y2 = toPx(fa['svg:y2'] || '0');
    const ox = Math.min(x1, x2); const oy = Math.min(y1, y2);
    const w = Math.max(1, Math.abs(x2 - x1)); const h = Math.max(1, Math.abs(y2 - y1));
    box.style.width = `${w}px`;
    box.style.height = `${h}px`;
    const svg = svgEl('svg', { class: 'obj-svg', width: w, height: h, overflow: 'visible' });
    const p = this.paint(gp);
    svg.append(svgEl('line', { x1: x1 - ox, y1: y1 - oy, x2: x2 - ox, y2: y2 - oy, stroke: p.stroke === 'none' ? '#000' : p.stroke, 'stroke-width': p['stroke-width'], 'stroke-dasharray': p['stroke-dasharray'] }));
    const head = (fx, fy, tx, ty) => {
      const ang = Math.atan2(ty - fy, tx - fx);
      const sw = Number(p['stroke-width']) || 1;
      const len = Math.max(6, (toPx(gp['draw:marker-end-width'] || '') || 0) || sw * 4);
      const pts = [[tx, ty], [tx - len * Math.cos(ang - 0.4), ty - len * Math.sin(ang - 0.4)], [tx - len * Math.cos(ang + 0.4), ty - len * Math.sin(ang + 0.4)]];
      svg.append(svgEl('path', { d: `M${pts.map((q) => q.join(' ')).join(' L')} Z`, fill: p.stroke === 'none' ? '#000' : p.stroke }));
    };
    if (gp['draw:marker-end']) head(x1 - ox, y1 - oy, x2 - ox, y2 - oy);
    if (gp['draw:marker-start']) head(x2 - ox, y2 - oy, x1 - ox, y1 - oy);
    this.shadow(svg, gp);
    box.append(svg);
  }

  /** Equations and charts are drawn by their renderers; other objects by their replacement picture. */
  renderObject(box, w, h) {
    const custom = this.env.renderObject?.(this.attrs, w, h);
    if (custom) { box.append(custom); return; }
    const repl = (this.attrs.parts || []).filter((p) => p.n === 'draw:image').map((p) => p.a['xlink:href']).find(Boolean);
    const url = repl && this.env.pictureUrl(repl);
    if (url) {
      const img = el('img', 'obj-replacement');
      img.src = url;
      img.draggable = false;
      box.append(img);
    } else box.append(el('span', 'obj-placeholder'));
  }

  /** Fill / stroke attributes for SVG. */
  paint(gp, text = false) {
    const fill = gp['draw:fill'] || (text ? 'solid' : 'solid');
    const out = {};
    out.fill = fill === 'none' ? 'none' : (gp['draw:fill-color'] || '#156082');
    if (gp['draw:opacity'] && gp['draw:opacity'] !== '100%') out['fill-opacity'] = pct(gp['draw:opacity']) / 100;
    const stroke = gp['draw:stroke'] || 'solid';
    out.stroke = stroke === 'none' ? 'none' : (gp['svg:stroke-color'] || '#000000');
    const sw = toPx(gp['svg:stroke-width'] || '') || 1;
    out['stroke-width'] = sw.toFixed(2);
    if (stroke === 'dash') out['stroke-dasharray'] = this.env.dashArray?.(gp['draw:stroke-dash'], sw) || `${sw * 4} ${sw * 3}`;
    if (gp['svg:stroke-opacity'] && gp['svg:stroke-opacity'] !== '100%') out['stroke-opacity'] = pct(gp['svg:stroke-opacity']) / 100;
    out['stroke-linejoin'] = gp['draw:stroke-linejoin'] || 'miter';
    return out;
  }

  shadow(svg, gp) {
    if (gp['draw:shadow'] !== 'visible') return;
    const dx = toPx(gp['draw:shadow-offset-x'] || '0.2cm');
    const dy = toPx(gp['draw:shadow-offset-y'] || '0.2cm');
    const col = gp['draw:shadow-color'] || '#808080';
    const op = gp['draw:shadow-opacity'] ? pct(gp['draw:shadow-opacity']) / 100 : 1;
    const blur = toPx(gp['loext:shadow-blur'] || '0') || 0;
    const hex = col.replace('#', '');
    const rgb = hex.length === 6 ? [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(',') : '128,128,128';
    svg.style.filter = `drop-shadow(${dx}px ${dy}px ${blur / 2}px rgba(${rgb},${op}))`;
  }

  /** Text of a text box / shape, edited by a nested editor. */
  renderText(box, gp, insets) {
    const host = el('div', 'obj-text odt-doc');
    if (insets) {
      const { w, h } = this.size;
      const pad = (k, d) => (gp[k] ? toPx(gp[k]) : d);
      const [l, t, r, b] = insets;
      Object.assign(host.style, {
        position: 'absolute', left: `${l * w + pad('fo:padding-left', 4)}px`, right: `${r * w + pad('fo:padding-right', 4)}px`,
        top: `${t * h + pad('fo:padding-top', 2)}px`, bottom: `${b * h + pad('fo:padding-bottom', 2)}px`,
        display: 'flex', flexDirection: 'column',
        justifyContent: { top: 'flex-start', bottom: 'flex-end' }[gp['draw:textarea-vertical-align']] || 'center',
      });
    }
    const mount = el('div', 'obj-text-mount');
    host.append(mount);
    box.append(host);
    if (this.inner) { this.inner.destroy(); this.inner = null; }
    this.inner = this.env.createNested?.(mount, this);
  }

  // ------------------------------------------------------------ ProseMirror

  update(node) {
    if (node.type !== this.node.type) return false;
    const before = this.node.attrs;
    const after = node.attrs;
    if (before === after) { this.node = node; return true; }
    // Only the text changed (typed in the nested editor): keep the editor.
    const same = (k) => JSON.stringify(before[k]) === JSON.stringify(after[k]);
    if (this.inner && ['element', 'styleName', 'auto', 'frameAttrs', 'parts', 'kind', 'href'].every(same)) {
      this.node = node;
      this.inner.sync(after.body);
      if (after.kind === 'wordart') this.render(node);
      return true;
    }
    if (this.inner) { this.inner.destroy(); this.inner = null; }
    this.render(node);
    return true;
  }

  selectNode() { this.selected = true; this.dom.classList.add('ProseMirror-selectednode'); this.handles?.remove(); this.handles = attachHandles(this); this.env.onObjectSelected?.(this); }
  deselectNode() { this.selected = false; this.dom.classList.remove('ProseMirror-selectednode'); this.handles?.remove(); this.handles = null; this.env.onObjectSelected?.(null); }

  /** Events inside the nested editor and on handles belong to them. */
  stopEvent(e) {
    if (e.target.closest?.('.obj-text') && this.inner) return true;
    if (e.target.closest?.('.obj-handle')) return true;
    return false;
  }

  ignoreMutation() { return true; }

  destroy() { this.inner?.destroy(); this.inner = null; this.handles?.remove(); }

  /** Writes new attrs for this node (one undoable step). */
  setAttrs(attrs, { addToHistory = true } = {}) {
    const pos = this.getPos();
    if (pos == null) return;
    const tr = this.view.state.tr.setNodeMarkup(pos, null, attrs);
    // Keep the object selected (unless its text is being edited).
    if (this.selected && !this.inner?.view.hasFocus()) tr.setSelection(NodeSelection.create(tr.doc, pos));
    if (!addToHistory) tr.setMeta('addToHistory', false);
    this.view.dispatch(tr);
  }
}

// ------------------------------------------------------------------ ink and groups

/** The grainy look of pencil strokes (an SVG filter defined once in the page). */
function ensurePencilFilter() {
  if (typeof document === 'undefined' || document.getElementById('odt-pencil')) return;
  const svg = svgEl('svg', { width: 0, height: 0, style: 'position:absolute;width:0;height:0', 'aria-hidden': 'true' });
  const f = svgEl('filter', { id: 'odt-pencil', x: '-10%', y: '-10%', width: '120%', height: '120%' });
  f.append(svgEl('feTurbulence', { type: 'fractalNoise', baseFrequency: '1.6', numOctaves: '2', seed: '3', result: 'noise' }));
  f.append(svgEl('feColorMatrix', { in: 'noise', type: 'matrix', values: '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.6 1.25', result: 'grain' }));
  f.append(svgEl('feComposite', { in: 'SourceGraphic', in2: 'grain', operator: 'in' }));
  svg.append(f);
  document.body.append(svg);
}

/** The SVG for a path-like element (frame attrs) in a w × h box. */
export function inkShape(element, fa, gp, w, h, paint, name = '') {
  const vb = String(fa['svg:viewBox'] || `0 0 ${w} ${h}`).split(/[\s,]+/).map(Number);
  const sx = w / (vb[2] || w);
  const sy = h / (vb[3] || h);
  const g = svgEl('g', { transform: `scale(${sx} ${sy}) translate(${-vb[0]} ${-vb[1]})` });
  let shape;
  if (element === 'draw:path') shape = svgEl('path', { d: fa['svg:d'] || '' });
  else shape = svgEl(element === 'draw:polygon' ? 'polygon' : 'polyline', { points: fa['draw:points'] || '' });
  const p = { ...paint };
  // Stroke widths are page lengths: undo the scale for them.
  const sw = Number(p['stroke-width']) || 1;
  p['stroke-width'] = (sw / Math.max(1e-6, (sx + sy) / 2)).toFixed(3);
  if (gp['svg:stroke-linecap']) p['stroke-linecap'] = gp['svg:stroke-linecap'];
  for (const [k, v] of Object.entries(p)) shape.setAttribute(k, v);
  shape.setAttribute('class', `ink-stroke${/^Pencil/i.test(name) ? ' ink-pencil' : ''}`);
  if (/^Pencil/i.test(name)) { ensurePencilFilter(); shape.setAttribute('filter', 'url(#odt-pencil)'); }
  g.append(shape);
  return g;
}

/** One shape of a group as SVG (positions in cm, relative to the group). */
function groupChild(p, gp, paint, env) {
  const a = p.a || {};
  const x = toPx(a['svg:x'] || '0');
  const y = toPx(a['svg:y'] || '0');
  const w = toPx(a['svg:width'] || '0') || 1;
  const h = toPx(a['svg:height'] || '0') || 1;
  let node;
  if (p.n === 'draw:rect') node = svgEl('rect', { x, y, width: w, height: h, ...paint });
  else if (p.n === 'draw:ellipse') node = svgEl('ellipse', { cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2, ...paint });
  else if (p.n === 'draw:line') node = svgEl('line', { x1: toPx(a['svg:x1'] || '0'), y1: toPx(a['svg:y1'] || '0'), x2: toPx(a['svg:x2'] || '0'), y2: toPx(a['svg:y2'] || '0'), ...paint, fill: 'none' });
  else if (p.n === 'draw:custom-shape') {
    const geo = (p.c || []).find((c) => typeof c !== 'string' && c.n === 'draw:enhanced-geometry');
    node = svgEl('path', { d: shapePath({ parts: geo ? [geo] : [], frameAttrs: a }, w, h), transform: `translate(${x} ${y})`, ...paint });
  } else {
    node = svgEl('g', { transform: `translate(${x} ${y})` });
    node.append(inkShape(p.n, a, gp, w, h, paint, a['draw:name'] || ''));
  }
  void env;
  node.dataset.name = a['draw:name'] || '';
  // A shape's own text (text:p children), centred in it.
  const lines = (p.c || []).filter((c) => typeof c !== 'string' && c.n === 'text:p').map((c) => (c.c || []).map((x) => (typeof x === 'string' ? x : (x.c || []).filter((y) => typeof y === 'string').join(''))).join(''));
  if (lines.length && p.n !== 'draw:line') {
    const g = svgEl('g', {});
    g.append(node);
    const lh = 15;
    lines.forEach((line, i) => {
      const t = svgEl('text', { x: x + w / 2, y: y + h / 2 + (i - (lines.length - 1) / 2) * lh, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-family': 'Carlito, Calibri, sans-serif', 'font-size': '14.67px', fill: gp['fo:color'] || '#000000' });
      t.textContent = line;
      g.append(t);
    });
    g.dataset.name = node.dataset.name;
    return g;
  }
  return node;
}

