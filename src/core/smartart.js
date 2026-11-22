/**
 * Insert ▸ SmartArt: simple diagrams from a list of items, made as a drawing
 * canvas (draw:g) of rounded boxes with their text (text:p inside the
 * shapes, which LibreOffice shows and edits) and connectors:
 *   process  boxes in a row joined by arrows
 *   list     boxes stacked under each other
 *   cycle    boxes round a circle with arrows between them
 */
import { canvasAttrs, CM } from './ink.js';

export const SMARTART_LAYOUTS = ['process', 'list', 'cycle'];

const ACCENT = '#4472c4';
const cm = (px) => `${(px / CM).toFixed(3)}cm`;

function box(name, x, y, w, h, text) {
  return {
    n: 'draw:custom-shape',
    a: { 'draw:name': name, 'svg:x': cm(x), 'svg:y': cm(y), 'svg:width': cm(w), 'svg:height': cm(h) },
    '#graphic': { 'draw:fill': 'solid', 'draw:fill-color': '#dae3f3', 'draw:stroke': 'solid', 'svg:stroke-color': ACCENT, 'svg:stroke-width': '0.035cm' },
    c: [
      { n: 'text:p', a: {}, c: [text] },
      { n: 'draw:enhanced-geometry', a: { 'svg:viewBox': '0 0 21600 21600', 'draw:type': 'round-rectangle', 'draw:enhanced-path': 'M 3600 0 X 0 3600 L 0 18000 Y 3600 21600 L 18000 21600 X 21600 18000 L 21600 3600 Y 18000 0 Z N' } },
    ],
  };
}

function arrow(name, x1, y1, x2, y2) {
  return {
    n: 'draw:line', a: { 'draw:name': name, 'svg:x1': cm(x1), 'svg:y1': cm(y1), 'svg:x2': cm(x2), 'svg:y2': cm(y2) },
    '#graphic': { 'draw:stroke': 'solid', 'svg:stroke-color': '#a5a5a5', 'svg:stroke-width': '0.07cm', 'draw:marker-end': 'Arrow', 'draw:marker-end-width': '0.3cm' },
  };
}

/** A SmartArt canvas for `items` (strings), `width` px wide, as frame attrs. */
export function smartArtAttrs(layout, items, { width = 576, name = 'SmartArt', z = 0 } = {}) {
  const list = items.map((s) => String(s).trim()).filter(Boolean);
  if (!list.length) list.push('Text');
  const n = list.length;
  const parts = [];
  let h;
  if (layout === 'list') {
    const bh = 44;
    const gap = 10;
    h = n * bh + (n - 1) * gap + 20;
    list.forEach((t, i) => parts.push(box(`Item ${i + 1}`, 10, 10 + i * (bh + gap), width - 20, bh, t)));
  } else if (layout === 'cycle') {
    h = Math.min(width, 380);
    const r = h / 2 - 40;
    const cx = width / 2;
    const cy = h / 2;
    const bw = 110;
    const bh = 44;
    const pts = list.map((_, i) => { const a = -Math.PI / 2 + (2 * Math.PI * i) / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
    pts.forEach(([x, y], i) => parts.push(box(`Item ${i + 1}`, x - bw / 2, y - bh / 2, bw, bh, list[i])));
    if (n > 1) {
      pts.forEach(([x, y], i) => {
        const [x2, y2] = pts[(i + 1) % n];
        const k = 0.3;
        parts.push(arrow(`Arrow ${i + 1}`, x + (x2 - x) * k, y + (y2 - y) * k, x + (x2 - x) * (1 - k), y + (y2 - y) * (1 - k)));
      });
    }
  } else {
    const gap = 36;
    const bw = (width - 20 - (n - 1) * gap) / n;
    const bh = Math.min(90, Math.max(50, bw * 0.6));
    h = bh + 20;
    list.forEach((t, i) => {
      const x = 10 + i * (bw + gap);
      parts.push(box(`Item ${i + 1}`, x, 10, bw, bh, t));
      if (i < n - 1) parts.push(arrow(`Arrow ${i + 1}`, x + bw + 6, 10 + bh / 2, x + bw + gap - 6, 10 + bh / 2));
    });
  }
  const attrs = canvasAttrs({ x: 0, y: 0, w: width, h, name, z });
  // No canvas background: the diagram stands on the page.
  attrs.parts = parts;
  return attrs;
}
