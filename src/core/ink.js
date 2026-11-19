/**
 * Ink: pen strokes as ODF drawing objects.
 *
 * A stroke is a frame node of element draw:path (kind 'ink'), anchored to a
 * paragraph and floating in front of the text, with svg:x/y/width/height and
 * svg:viewBox in 1/100 mm. Strokes drawn with a pressure-sensitive pen are a
 * filled outline whose width follows the pressure (the outline has the same
 * number of points down each side, so the centre line can be recovered);
 * other strokes are a smooth line with the pen's width. The tool is kept in
 * draw:name ("Pen 3", "Pencil 1", "Highlighter 2"); a highlighter is 50 %
 * transparent. LibreOffice draws them all as ordinary paths.
 *
 * A Drawing Canvas is a draw:g group: a white rectangle and the strokes and
 * shapes drawn on it, as parts in the canvas's own coordinates (see
 * canvasToOdf / canvasFromOdf in the importer / exporter).
 */
import { withGraphic, withWrap, withFrameAttrs } from './objects.js';

export const CM = 96 / 2.54;
export const HMM = 96 / 2540; // px per 1/100 mm
const cm = (px) => `${(px / CM).toFixed(3)}cm`;
const r1 = (v) => Math.round(v * 10) / 10;

export const TOOLS = {
  pen: { colour: '#000000', width: 0.5 },
  pencil: { colour: '#404040', width: 1 },
  highlighter: { colour: '#ffff00', width: 5 },
};

// ------------------------------------------------------------------ geometry

/** Removes points closer than `min` px to the previous one. */
export function thin(points, min = 1.2) {
  const out = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= min) out.push(p);
  }
  if (points.length && out[out.length - 1] !== points[points.length - 1]) out.push(points[points.length - 1]);
  return out;
}

/** Ramer–Douglas–Peucker simplification. */
export function simplify(points, eps) {
  if (points.length < 3) return points.slice();
  const [a, b] = [points[0], points[points.length - 1]];
  let idx = -1;
  let max = 0;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const d = len < 1e-6 ? Math.hypot(p.x - a.x, p.y - a.y) : Math.abs((b.y - a.y) * p.x - (b.x - a.x) * p.y + b.x * a.y - b.y * a.x) / len;
    if (d > max) { max = d; idx = i; }
  }
  if (max <= eps) return [a, b];
  return [...simplify(points.slice(0, idx + 1), eps).slice(0, -1), ...simplify(points.slice(idx), eps)];
}

export function bounds(points) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const p of points) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

/** A smooth path through points (quadratic curves through midpoints). */
export function smoothPath(pts, f = (v) => v) {
  if (!pts.length) return '';
  if (pts.length === 1) return `M${f(pts[0].x)} ${f(pts[0].y)}L${f(pts[0].x + 0.01)} ${f(pts[0].y)}`;
  let d = `M${f(pts[0].x)} ${f(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    d += `Q${f(pts[i].x)} ${f(pts[i].y)} ${f(mx)} ${f(my)}`;
  }
  const last = pts[pts.length - 1];
  return `${d}L${f(last.x)} ${f(last.y)}`;
}

/** The two sides of a variable-width stroke: left points, then right points reversed. */
export function outline(pts, width) {
  const left = [];
  const right = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    let nx = -(b.y - a.y);
    let ny = b.x - a.x;
    const l = Math.hypot(nx, ny) || 1;
    nx /= l; ny /= l;
    const p = pts[i].p ?? 0.5;
    // Pressure 0.5 = the nominal width; thinner at the ends.
    const taper = Math.min(1, (i + 1) / 4, (pts.length - i) / 4);
    const hw = Math.max(0.35, (width / 2) * (0.35 + p * 1.3) * (0.55 + 0.45 * taper));
    left.push({ x: pts[i].x + nx * hw, y: pts[i].y + ny * hw });
    right.push({ x: pts[i].x - nx * hw, y: pts[i].y - ny * hw });
  }
  return [...left, ...right.reverse()];
}

/** A closed polygon path. */
const polygonPath = (pts, f) => `M${pts.map((p) => `${f(p.x)} ${f(p.y)}`).join('L')}Z`;

/** Whether a stroke's pressure varies enough to be drawn as an outline. */
export const hasPressure = (pts) => pts.some((p) => p.p != null && Math.abs(p.p - 0.5) > 0.02 && p.p > 0);

// ------------------------------------------------------------------ strokes ↔ attrs

/**
 * Frame attrs for a stroke. points in px relative to the anchor paragraph;
 * o = { tool, colour, width (px), name, z }.
 */
export function inkAttrs(points, o) {
  const pts = thin(points);
  const pressure = o.tool === 'pen' && hasPressure(pts);
  const pad = o.width / 2 + 1;
  const b = bounds(pts);
  const x = b.x - pad;
  const y = b.y - pad;
  const w = b.w + pad * 2;
  const h = b.h + pad * 2;
  // Path coordinates in 1/100 mm from the object's top-left.
  const f = (v) => r1(v / HMM);
  const local = pts.map((p) => ({ x: p.x - x, y: p.y - y, p: p.p }));
  const d = pressure ? polygonPath(outline(local, o.width), f) : smoothPath(local, f);
  const g = pressure
    ? { 'draw:stroke': 'none', 'draw:fill': 'solid', 'draw:fill-color': o.colour }
    : { 'draw:stroke': 'solid', 'svg:stroke-color': o.colour, 'svg:stroke-width': cm(o.width), 'draw:stroke-linejoin': 'round', 'svg:stroke-linecap': 'round', 'draw:fill': 'none' };
  if (o.tool === 'highlighter') { g['svg:stroke-opacity'] = '50%'; g['draw:opacity'] = '50%'; }
  const attrs = {
    element: 'draw:path', styleName: null, auto: null, kind: 'ink', href: '', body: [], parts: [],
    frameAttrs: {
      'draw:name': o.name, 'text:anchor-type': 'paragraph', 'draw:z-index': String(o.z),
      'svg:x': cm(x), 'svg:y': cm(y), 'svg:width': cm(w), 'svg:height': cm(h),
      'svg:viewBox': `0 0 ${Math.round(w / HMM)} ${Math.round(h / HMM)}`, 'svg:d': d,
    },
  };
  return withGraphic(withWrap(attrs, 'front', { x, y }), g);
}

/** Parses an svg:d made of M / L / Q / Z commands into points (on-curve and control points). */
export function pathPoints(d) {
  const out = [];
  const re = /([MLQZ])([^MLQZ]*)/gi;
  for (const m of String(d || '').matchAll(re)) {
    const nums = m[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
    for (let i = 0; i + 1 < nums.length; i += 2) out.push({ x: nums[i], y: nums[i + 1] });
  }
  return out;
}

/** The centre line of a stroke (in the object's 1/100 mm space). */
export function centreLine(frameAttrs) {
  const pts = pathPoints(frameAttrs['svg:d']);
  if (/Z\s*$/i.test(frameAttrs['svg:d'] || '') && pts.length >= 4 && pts.length % 2 === 0) {
    const n = pts.length / 2;
    return pts.slice(0, n).map((p, i) => ({ x: (p.x + pts[pts.length - 1 - i].x) / 2, y: (p.y + pts[pts.length - 1 - i].y) / 2 }));
  }
  // Quadratic: every other point is a control point; keep the on-curve ones (and the controls, which lie near the line).
  return pts;
}

/** The tool a stroke was drawn with (from its name). */
export const toolOf = (attrs) => (/^Pencil/i.test(attrs.frameAttrs?.['draw:name'] || '') ? 'pencil' : /^Highlighter/i.test(attrs.frameAttrs?.['draw:name'] || '') ? 'highlighter' : 'pen');

// ------------------------------------------------------------------ Ink to Shape

/**
 * Recognises a stroke (points in px): { type: 'line' | 'arrow' | 'rectangle' |
 * 'ellipse' | 'triangle', box, from, to } or null.
 */
export function recognise(points) {
  const pts = thin(points, 2);
  if (pts.length < 2) return null;
  const b = bounds(pts);
  const diag = Math.hypot(b.w, b.h);
  if (diag < 12) return null;
  let length = 0;
  for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  const first = pts[0];
  const last = pts[pts.length - 1];
  const gap = Math.hypot(last.x - first.x, last.y - first.y);
  const closed = gap < Math.max(18, length * 0.18);
  const simple = simplify(pts, Math.max(4, diag * 0.06));
  if (!closed) {
    if (simple.length === 2) return { type: 'line', box: b, from: first, to: last };
    // A long line ending in a short "V" (a hand-drawn arrow head).
    const seg = (i) => Math.hypot(simple[i + 1].x - simple[i].x, simple[i + 1].y - simple[i].y);
    let longest = 0;
    let li = 0;
    for (let i = 0; i < simple.length - 1; i++) if (seg(i) > longest) { longest = seg(i); li = i; }
    const tip = simple[li + 1];
    const rest = simple.slice(li + 1);
    if (longest > length * 0.5 && rest.length >= 3 && rest.every((p) => Math.hypot(p.x - tip.x, p.y - tip.y) < longest * 0.4)) {
      return { type: 'arrow', box: bounds([simple[li], tip]), from: simple[li], to: tip };
    }
    return null;
  }
  // A closed loop: simplify the two halves either side of the point farthest from the start.
  let far = 0;
  pts.forEach((p, i) => { if (Math.hypot(p.x - first.x, p.y - first.y) > Math.hypot(pts[far].x - first.x, pts[far].y - first.y)) far = i; });
  const eps = Math.max(5, diag * 0.09);
  const corners = [...simplify(pts.slice(0, far + 1), eps).slice(0, -1), ...simplify(pts.slice(far), eps)];
  const n = corners.length - (Math.hypot(corners[0].x - corners[corners.length - 1].x, corners[0].y - corners[corners.length - 1].y) < diag * 0.2 ? 1 : 0);
  // Round shapes: the distance from the centre hardly changes relative to the ellipse.
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const dev = pts.reduce((a, p) => a + Math.abs(Math.hypot((p.x - cx) / (b.w / 2), (p.y - cy) / (b.h / 2)) - 1), 0) / pts.length;
  if (n === 3) return { type: 'triangle', box: b, corners: corners.slice(0, 3) };
  if (n === 4 && dev > 0.1) return { type: 'rectangle', box: b };
  if (dev < 0.16 || n > 4) return { type: 'ellipse', box: b };
  return { type: 'rectangle', box: b };
}

// ------------------------------------------------------------------ canvas

/** Attrs for an empty Drawing Canvas (w × h px) at x, y relative to the anchor: a group whose first shape is its white background. */
export function canvasAttrs({ x, y, w, h, name, z }) {
  const attrs = {
    element: 'draw:g', styleName: null, auto: null, kind: 'canvas', href: '', body: [],
    frameAttrs: { 'draw:name': name, 'text:anchor-type': 'paragraph', 'draw:z-index': String(z), 'svg:x': cm(x), 'svg:y': cm(y), 'svg:width': cm(w), 'svg:height': cm(h) },
    parts: [{
      n: 'draw:rect', a: { 'draw:name': 'Canvas background', 'svg:x': '0.000cm', 'svg:y': '0.000cm', 'svg:width': cm(w), 'svg:height': cm(h) },
      '#graphic': { 'draw:stroke': 'solid', 'svg:stroke-color': '#a6a6a6', 'svg:stroke-width': '0.018cm', 'draw:fill': 'solid', 'draw:fill-color': '#ffffff' },
    }],
  };
  return withWrap(attrs, 'square', { x, y });
}

/** A stroke as a child of a canvas: a draw:path tree in canvas coordinates (cm). */
export function canvasChild(stroke) {
  const fa = stroke.frameAttrs;
  const gp = stroke.auto?.props?.['style:graphic-properties']?.a || {};
  return { n: 'draw:path', a: { 'draw:name': fa['draw:name'], 'svg:x': fa['svg:x'], 'svg:y': fa['svg:y'], 'svg:width': fa['svg:width'], 'svg:height': fa['svg:height'], 'svg:viewBox': fa['svg:viewBox'], 'svg:d': fa['svg:d'] }, '#graphic': { ...gp } };
}

export { withFrameAttrs, cm };
