/**
 * Drawing objects (the `frame` node, see schema.js): creating pictures, text
 * boxes and shapes, and reading / changing their size, position, wrapping,
 * rotation and graphic properties in ODF terms.
 *
 * Wrapping (Word name → ODF):
 *   inline   text:anchor-type="as-char"
 *   square   style:wrap="parallel"
 *   tight    style:wrap="parallel" + style:wrap-contour="true"
 *   through  style:wrap="run-through" + style:run-through="foreground" + style:wrap-contour="true"
 *   topBottom style:wrap="none"
 *   behind   style:wrap="run-through" + style:run-through="background"
 *   front    style:wrap="run-through" + style:run-through="foreground"
 * Floating objects are anchored to their paragraph (text:anchor-type="paragraph"),
 * positioned with svg:x / svg:y from the paragraph's top-left ("move with text").
 */
import { mergeAuto, sortProps } from './odt/styles.js';
import { toPx } from '../layout/units.js';

export const GP = 'style:graphic-properties';
const CM = 96 / 2.54;
export const cm = (px) => `${(Math.round((px / CM) * 1000) / 1000)}cm`;

/** Effective graphic properties: named style chain + the object's own. */
export function graphicProps(attrs, index) {
  const named = attrs.styleName && index ? index.effective('graphic', attrs.styleName, { includeDefault: true }) : (index?.defaults?.has('graphic') ? index.effective('graphic', '__none__') : null);
  const merged = mergeAuto(named, attrs.auto);
  return merged?.props?.[GP]?.a || {};
}

/** The object's own graphic properties (automatic style only). */
export const ownGraphic = (attrs) => attrs.auto?.props?.[GP]?.a || {};

/** attrs with graphic properties changed (null/undefined values remove a property). */
export function withGraphic(attrs, change) {
  const auto = attrs.auto ? structuredClone(attrs.auto) : { styleAttrs: {}, props: {} };
  const p = auto.props[GP] || { a: {} };
  const a = { ...p.a };
  for (const [k, v] of Object.entries(change)) { if (v == null) delete a[k]; else a[k] = v; }
  auto.props[GP] = p.c ? { a, c: p.c } : { a };
  if (!Object.keys(a).length && !p.c) delete auto.props[GP];
  // Same property order as the importer gives (graphic, paragraph, text…).
  const sorted = {};
  for (const k of sortProps(Object.keys(auto.props).filter((k) => k !== '#other'))) sorted[k] = auto.props[k];
  if (auto.props['#other']) sorted['#other'] = auto.props['#other'];
  auto.props = sorted;
  const empty = !Object.keys(auto.props).length && !Object.keys(auto.styleAttrs || {}).length;
  return { ...attrs, auto: empty ? null : auto };
}

/** attrs with element attributes changed (null removes). */
export function withFrameAttrs(attrs, change) {
  const fa = { ...attrs.frameAttrs };
  for (const [k, v] of Object.entries(change)) { if (v == null) delete fa[k]; else fa[k] = v; }
  return { ...attrs, frameAttrs: fa };
}

/** Size in px (lines: their bounding box). */
export function sizeOf(attrs) {
  const fa = attrs.frameAttrs || {};
  if (attrs.element === 'draw:line') {
    return { w: Math.abs(toPx(fa['svg:x2'] || '0') - toPx(fa['svg:x1'] || '0')), h: Math.abs(toPx(fa['svg:y2'] || '0') - toPx(fa['svg:y1'] || '0')) };
  }
  const box = attrs.parts?.find((p) => p['#body']);
  const minH = box?.a?.['fo:min-height'];
  return { w: toPx(fa['svg:width'] || '') || 0, h: toPx(fa['svg:height'] || minH || '') || 0 };
}

export function withSize(attrs, w, h) {
  if (attrs.element === 'draw:line') {
    const fa = attrs.frameAttrs;
    const x1 = toPx(fa['svg:x1'] || '0'); const y1 = toPx(fa['svg:y1'] || '0');
    const sx = toPx(fa['svg:x2'] || '0') >= x1 ? 1 : -1; const sy = toPx(fa['svg:y2'] || '0') >= y1 ? 1 : -1;
    return withFrameAttrs(attrs, { 'svg:x2': cm(x1 + sx * w), 'svg:y2': cm(y1 + sy * h) });
  }
  let next = withFrameAttrs(attrs, { 'svg:width': cm(Math.max(1, w)), 'svg:height': cm(Math.max(1, h)), 'style:rel-width': null, 'style:rel-height': null });
  // A text box grows with its text from its minimum height.
  const i = next.parts.findIndex((p) => p['#body']);
  if (i >= 0 && next.parts[i].a?.['fo:min-height']) {
    const parts = next.parts.slice();
    parts[i] = { ...parts[i], a: { ...parts[i].a, 'fo:min-height': cm(Math.max(1, h)) } };
    next = { ...next, parts };
  }
  return next;
}

/** Wrapping style (Word's names). */
export function wrapOf(attrs, index) {
  const fa = attrs.frameAttrs || {};
  const gp = graphicProps(attrs, index);
  const anchor = fa['text:anchor-type'] || gp['text:anchor-type'] || 'paragraph';
  if (anchor === 'as-char') return 'inline';
  const wrap = gp['style:wrap'] || 'none';
  if (wrap === 'run-through') {
    if (gp['style:wrap-contour'] === 'true') return 'through';
    return gp['style:run-through'] === 'background' ? 'behind' : 'front';
  }
  if (wrap === 'none') return 'topBottom';
  if (gp['style:wrap-contour'] === 'true') return 'tight';
  return 'square';
}

export const WRAPS = ['inline', 'square', 'tight', 'through', 'topBottom', 'behind', 'front'];

/**
 * Changes the wrapping. `pos` = { x, y } (px from the anchor paragraph's
 * top-left) is used when the object starts floating.
 */
export function withWrap(attrs, wrap, pos = { x: 0, y: 0 }) {
  if (wrap === 'inline') {
    const next = withFrameAttrs(attrs, { 'text:anchor-type': 'as-char', 'svg:x': null, 'svg:y': null });
    return withGraphic(next, {
      'style:wrap': null, 'style:run-through': null, 'style:wrap-contour': null, 'style:wrap-contour-mode': null, 'style:number-wrapped-paragraphs': null,
      'style:vertical-pos': 'top', 'style:vertical-rel': 'baseline', 'style:horizontal-pos': 'center', 'style:horizontal-rel': 'paragraph',
    });
  }
  const wasInline = (attrs.frameAttrs['text:anchor-type'] || 'paragraph') === 'as-char';
  let next = withFrameAttrs(attrs, {
    'text:anchor-type': wasInline || attrs.frameAttrs['text:anchor-type'] === 'char' || !attrs.frameAttrs['text:anchor-type'] ? 'paragraph' : attrs.frameAttrs['text:anchor-type'],
    'svg:x': wasInline || attrs.frameAttrs['svg:x'] == null ? cm(pos.x) : attrs.frameAttrs['svg:x'],
    'svg:y': wasInline || attrs.frameAttrs['svg:y'] == null ? cm(pos.y) : attrs.frameAttrs['svg:y'],
  });
  const g = {
    square: { 'style:wrap': 'parallel', 'style:run-through': null, 'style:wrap-contour': 'false', 'style:wrap-contour-mode': null },
    tight: { 'style:wrap': 'parallel', 'style:run-through': null, 'style:wrap-contour': 'true', 'style:wrap-contour-mode': 'outside' },
    through: { 'style:wrap': 'run-through', 'style:run-through': 'foreground', 'style:wrap-contour': 'true', 'style:wrap-contour-mode': 'full' },
    topBottom: { 'style:wrap': 'none', 'style:run-through': null, 'style:wrap-contour': 'false', 'style:wrap-contour-mode': null },
    behind: { 'style:wrap': 'run-through', 'style:run-through': 'background', 'style:wrap-contour': 'false', 'style:wrap-contour-mode': null },
    front: { 'style:wrap': 'run-through', 'style:run-through': 'foreground', 'style:wrap-contour': 'false', 'style:wrap-contour-mode': null },
  }[wrap];
  const gp = ownGraphic(next);
  const keepPos = !wasInline && gp['style:horizontal-pos'] && gp['style:horizontal-rel'] !== 'baseline' && gp['style:vertical-rel'] !== 'baseline';
  next = withGraphic(next, {
    ...g, 'style:number-wrapped-paragraphs': 'no-limit',
    ...(keepPos ? {} : { 'style:horizontal-pos': 'from-left', 'style:horizontal-rel': 'paragraph', 'style:vertical-pos': 'from-top', 'style:vertical-rel': 'paragraph' }),
  });
  return next;
}

/** Position of a floating object (px), relative to its anchor paragraph. */
export function positionOf(attrs, index) {
  const fa = attrs.frameAttrs || {};
  const gp = graphicProps(attrs, index);
  return {
    x: toPx(fa['svg:x'] || '0') || 0, y: toPx(fa['svg:y'] || '0') || 0,
    hpos: gp['style:horizontal-pos'] || 'from-left', hrel: gp['style:horizontal-rel'] || 'paragraph',
    vpos: gp['style:vertical-pos'] || 'from-top', vrel: gp['style:vertical-rel'] || 'paragraph',
  };
}

export function withPosition(attrs, { x, y, hpos, hrel, vpos, vrel }) {
  let next = attrs;
  const fa = {};
  if (x != null) fa['svg:x'] = cm(x);
  if (y != null) fa['svg:y'] = cm(y);
  next = withFrameAttrs(next, fa);
  const g = {};
  if (hpos) g['style:horizontal-pos'] = hpos;
  if (hrel) g['style:horizontal-rel'] = hrel;
  if (vpos) g['style:vertical-pos'] = vpos;
  if (vrel) g['style:vertical-rel'] = vrel;
  if (x != null && !hpos) g['style:horizontal-pos'] = 'from-left';
  if (y != null && !vpos) g['style:vertical-pos'] = 'from-top';
  return Object.keys(g).length ? withGraphic(next, g) : next;
}

// ---------------------------------------------------------------- rotation

/** Rotation in degrees (counter-clockwise, as ODF) from draw:transform or draw:rotation. */
export function rotationOf(attrs) {
  const fa = attrs.frameAttrs || {};
  const m = /rotate\s*\(\s*(-?[\d.eE+-]+)\s*\)/.exec(fa['draw:transform'] || '');
  if (m) return normDeg((Number(m[1]) * 180) / Math.PI);
  return 0;
}
const normDeg = (d) => { let v = Math.round(d * 100) / 100 % 360; if (v < 0) v += 360; return v; };

/**
 * Sets the rotation (degrees, counter-clockwise). ODF rotates shapes about
 * their top-left corner and then translates; the translation keeps the
 * centre where the unrotated object's centre was.
 */
export function withRotation(attrs, deg, origin = null) {
  deg = normDeg(deg);
  const fa = attrs.frameAttrs || {};
  const { w, h } = sizeOf(attrs);
  // Where the unrotated box sits (px): from svg:x/y, or the old transform's origin.
  let x0 = toPx(fa['svg:x'] || '0') || 0;
  let y0 = toPx(fa['svg:y'] || '0') || 0;
  if (fa['draw:transform'] && origin) { x0 = origin.x; y0 = origin.y; } else if (fa['draw:transform']) {
    const old = rotationOf(attrs) * Math.PI / 180;
    const t = /translate\s*\(\s*(-?[\d.]+\w*)\s+(-?[\d.]+\w*)\s*\)/.exec(fa['draw:transform']);
    if (t) {
      const tx = toPx(t[1]); const ty = toPx(t[2]);
      // The unrotated top-left that gives this translation.
      const cx = tx + (w / 2) * Math.cos(old) + (h / 2) * Math.sin(old);
      const cy = ty - (w / 2) * Math.sin(old) + (h / 2) * Math.cos(old);
      x0 = cx - w / 2; y0 = cy - h / 2;
    }
  }
  if (!deg) return withFrameAttrs(attrs, { 'draw:transform': null, 'svg:x': cm(x0), 'svg:y': cm(y0) });
  const r = (deg * Math.PI) / 180;
  const cx = x0 + w / 2; const cy = y0 + h / 2;
  // Rotating the box about its top-left by r (counter-clockwise, y down) moves the centre to:
  const rx = (w / 2) * Math.cos(r) + (h / 2) * Math.sin(r);
  const ry = -(w / 2) * Math.sin(r) + (h / 2) * Math.cos(r);
  const tx = cx - rx; const ty = cy - ry;
  return withFrameAttrs(attrs, { 'draw:transform': `rotate (${+r.toFixed(10)}) translate (${cm(tx)} ${cm(ty)})`, 'svg:x': null, 'svg:y': null, '#x0': null });
}

/** Unrotated top-left (px) of an object, for objects positioned by draw:transform. */
export function originOf(attrs) {
  const fa = attrs.frameAttrs || {};
  if (!fa['draw:transform']) return { x: toPx(fa['svg:x'] || '0') || 0, y: toPx(fa['svg:y'] || '0') || 0 };
  const { w, h } = sizeOf(attrs);
  const r = rotationOf(attrs) * Math.PI / 180;
  const t = /translate\s*\(\s*(-?[\d.]+\w*)\s+(-?[\d.]+\w*)\s*\)/.exec(fa['draw:transform']);
  if (!t) return { x: 0, y: 0 };
  const tx = toPx(t[1]); const ty = toPx(t[2]);
  const cx = tx + (w / 2) * Math.cos(r) + (h / 2) * Math.sin(r);
  const cy = ty - (w / 2) * Math.sin(r) + (h / 2) * Math.cos(r);
  return { x: cx - w / 2, y: cy - h / 2 };
}

// ---------------------------------------------------------------- titles

/** Alt text: svg:title / svg:desc children. */
export function altTextOf(attrs) {
  const text = (n) => { const t = attrs.parts?.find((p) => p.n === n); return t ? (t.c || []).filter((c) => typeof c === 'string').join('') : ''; };
  return { title: text('svg:title'), desc: text('svg:desc') };
}

export function withAltText(attrs, { title, desc }) {
  let parts = (attrs.parts || []).filter((p) => p.n !== 'svg:title' && p.n !== 'svg:desc');
  const add = [];
  if (title) add.push({ n: 'svg:title', a: {}, c: [title] });
  if (desc) add.push({ n: 'svg:desc', a: {}, c: [desc] });
  // Frames: after the content; shapes: first.
  if (attrs.element === 'draw:frame') {
    const at = parts.findIndex((p) => p.n === 'draw:contour-polygon' || p.n === 'draw:contour-path');
    parts = at < 0 ? [...parts, ...add] : [...parts.slice(0, at), ...add, ...parts.slice(at)];
  } else parts = [...add, ...parts];
  return { ...attrs, parts };
}

// ---------------------------------------------------------------- names

/** A name not used by any object in the document ("Picture 3"). */
export function uniqueName(doc, base) {
  const used = new Set();
  doc.descendants((n) => { if (n.type.name === 'frame' && n.attrs.frameAttrs?.['draw:name']) used.add(n.attrs.frameAttrs['draw:name']); });
  let i = 1;
  while (used.has(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}

/** Largest z-index in the document. */
export function maxZ(doc) {
  let z = -1;
  doc.descendants((n) => { if (n.type.name === 'frame') z = Math.max(z, Number(n.attrs.frameAttrs?.['draw:z-index'] ?? -1)); });
  return z;
}

// ---------------------------------------------------------------- creation

/** A picture frame for a package path, in line with text. */
export function imageAttrs({ path, mime, w, h, name, title = '', z = 0 }) {
  let attrs = {
    element: 'draw:frame', styleName: 'Graphics', auto: null, kind: 'image', href: path, body: [],
    frameAttrs: { 'draw:name': name, 'text:anchor-type': 'as-char', 'svg:width': cm(w), 'svg:height': cm(h), 'draw:z-index': String(z) },
    parts: [{ n: 'draw:image', a: { 'xlink:href': path, 'xlink:type': 'simple', 'xlink:show': 'embed', 'xlink:actuate': 'onLoad', ...(mime ? { 'draw:mime-type': mime } : {}) } }],
  };
  attrs = withWrap(attrs, 'inline');
  if (title) attrs = withAltText(attrs, { title });
  return attrs;
}

/** A text box (draw:frame + draw:text-box) floating with square wrapping. */
export function textBoxAttrs({ w, h, name, z = 0, body, x = 0, y = 0 }) {
  const attrs = {
    element: 'draw:frame', styleName: 'Frame', auto: null, kind: 'textbox', href: '',
    frameAttrs: { 'draw:name': name, 'text:anchor-type': 'paragraph', 'svg:x': cm(x), 'svg:y': cm(y), 'svg:width': cm(w), 'draw:z-index': String(z) },
    parts: [{ n: 'draw:text-box', a: { 'fo:min-height': cm(h) }, '#body': true }],
    body: body || [{ type: 'paragraph', attrs: { styleName: 'Frame_20_contents' } }],
  };
  return withGraphic(withWrap(attrs, 'square', { x, y }), {
    'fo:border': '0.75pt solid #000000', 'fo:padding': '0.127cm', 'fo:background-color': '#ffffff', 'draw:fill': 'solid', 'draw:fill-color': '#ffffff',
    'fo:margin-left': '0.318cm', 'fo:margin-right': '0.318cm', 'fo:margin-top': '0cm', 'fo:margin-bottom': '0cm',
  });
}
