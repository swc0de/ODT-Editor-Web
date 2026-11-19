/**
 * Shape presets for Insert ▸ Shapes. Each has the ODF preset name LibreOffice
 * knows (draw:enhanced-geometry draw:type) and an SVG outline for a w×h box,
 * which the editor draws (and the gallery uses for its icons). Imported shapes
 * with another draw:type are drawn from their enhanced path when it has no
 * formulas, otherwise as a plain box.
 */

const P = (pts) => `M${pts.map(([x, y]) => `${r(x)} ${r(y)}`).join(' L')} Z`;
const r = (v) => Math.round(v * 100) / 100;
const ellipse = (cx, cy, rx, ry) => `M${r(cx - rx)} ${r(cy)} A${r(rx)} ${r(ry)} 0 1 0 ${r(cx + rx)} ${r(cy)} A${r(rx)} ${r(ry)} 0 1 0 ${r(cx - rx)} ${r(cy)} Z`;
const poly = (n, w, h, rot = -Math.PI / 2) => P([...Array(n)].map((_, i) => [w / 2 + (w / 2) * Math.cos(rot + (2 * Math.PI * i) / n), h / 2 + (h / 2) * Math.sin(rot + (2 * Math.PI * i) / n)]));
const star = (n, inner, w, h) => P([...Array(2 * n)].map((_, i) => {
  const a = -Math.PI / 2 + (Math.PI * i) / n;
  const k = i % 2 ? inner : 1;
  return [w / 2 + (w / 2) * k * Math.cos(a), h / 2 + (h / 2) * k * Math.sin(a)];
}));
const roundRect = (w, h, rad) => {
  const k = Math.min(rad, w / 2, h / 2);
  return `M${r(k)} 0 H${r(w - k)} A${r(k)} ${r(k)} 0 0 1 ${r(w)} ${r(k)} V${r(h - k)} A${r(k)} ${r(k)} 0 0 1 ${r(w - k)} ${r(h)} H${r(k)} A${r(k)} ${r(k)} 0 0 1 0 ${r(h - k)} V${r(k)} A${r(k)} ${r(k)} 0 0 1 ${r(k)} 0 Z`;
};

/** id → { type: ODF draw:type, group, path(w, h), line?, text?: text area inset [l,t,r,b] as fractions } */
export const SHAPES = {
  // Lines (draw:line)
  line: { group: 'lines', line: true },
  arrow: { group: 'lines', line: true, end: 'Arrow' },
  doubleArrow: { group: 'lines', line: true, start: 'Arrow', end: 'Arrow' },
  // Rectangles
  rectangle: { group: 'rectangles', type: 'rectangle', path: (w, h) => P([[0, 0], [w, 0], [w, h], [0, h]]) },
  roundRectangle: { group: 'rectangles', type: 'round-rectangle', path: (w, h) => roundRect(w, h, Math.min(w, h) * 0.18) },
  // Basic shapes
  ellipse: { group: 'basic', type: 'ellipse', path: (w, h) => ellipse(w / 2, h / 2, w / 2, h / 2), text: [0.15, 0.15, 0.15, 0.15] },
  triangle: { group: 'basic', type: 'isosceles-triangle', path: (w, h) => P([[w / 2, 0], [w, h], [0, h]]), text: [0.25, 0.5, 0.25, 0] },
  rightTriangle: { group: 'basic', type: 'right-triangle', path: (w, h) => P([[0, 0], [w, h], [0, h]]), text: [0.08, 0.5, 0.5, 0.08] },
  parallelogram: { group: 'basic', type: 'parallelogram', path: (w, h) => P([[w * 0.25, 0], [w, 0], [w * 0.75, h], [0, h]]), text: [0.2, 0.1, 0.2, 0.1] },
  trapezoid: { group: 'basic', type: 'trapezoid', path: (w, h) => P([[0, 0], [w, 0], [w * 0.75, h], [w * 0.25, h]]), text: [0.2, 0.1, 0.2, 0.1] },
  diamond: { group: 'basic', type: 'diamond', path: (w, h) => P([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]), text: [0.25, 0.25, 0.25, 0.25] },
  pentagon: { group: 'basic', type: 'pentagon', path: (w, h) => poly(5, w, h), text: [0.2, 0.2, 0.2, 0.15] },
  hexagon: { group: 'basic', type: 'hexagon', path: (w, h) => P([[w * 0.25, 0], [w * 0.75, 0], [w, h / 2], [w * 0.75, h], [w * 0.25, h], [0, h / 2]]), text: [0.2, 0.1, 0.2, 0.1] },
  octagon: { group: 'basic', type: 'octagon', path: (w, h) => P([[w * 0.29, 0], [w * 0.71, 0], [w, h * 0.29], [w, h * 0.71], [w * 0.71, h], [w * 0.29, h], [0, h * 0.71], [0, h * 0.29]]), text: [0.1, 0.1, 0.1, 0.1] },
  cross: { group: 'basic', type: 'cross', path: (w, h) => P([[w * 0.25, 0], [w * 0.75, 0], [w * 0.75, h * 0.25], [w, h * 0.25], [w, h * 0.75], [w * 0.75, h * 0.75], [w * 0.75, h], [w * 0.25, h], [w * 0.25, h * 0.75], [0, h * 0.75], [0, h * 0.25], [w * 0.25, h * 0.25]]), text: [0.25, 0.25, 0.25, 0.25] },
  can: {
    group: 'basic', type: 'can', text: [0, 0.25, 0, 0.1],
    path: (w, h) => { const e = h * 0.12; return `M0 ${r(e)} A${r(w / 2)} ${r(e)} 0 0 1 ${r(w)} ${r(e)} V${r(h - e)} A${r(w / 2)} ${r(e)} 0 0 1 0 ${r(h - e)} Z M0 ${r(e)} A${r(w / 2)} ${r(e)} 0 0 0 ${r(w)} ${r(e)}`; },
  },
  heart: {
    group: 'basic', type: 'heart', text: [0.2, 0.2, 0.2, 0.3],
    path: (w, h) => `M${r(w / 2)} ${r(h * 0.25)} C${r(w * 0.5)} ${r(h * 0.02)} ${r(w * 0.02)} ${r(-h * 0.05)} ${r(w * 0.02)} ${r(h * 0.3)} C${r(w * 0.02)} ${r(h * 0.6)} ${r(w * 0.35)} ${r(h * 0.75)} ${r(w / 2)} ${r(h)} C${r(w * 0.65)} ${r(h * 0.75)} ${r(w * 0.98)} ${r(h * 0.6)} ${r(w * 0.98)} ${r(h * 0.3)} C${r(w * 0.98)} ${r(-h * 0.05)} ${r(w * 0.5)} ${r(h * 0.02)} ${r(w / 2)} ${r(h * 0.25)} Z`,
  },
  lightning: { group: 'basic', type: 'lightning', path: (w, h) => P([[w * 0.39, 0], [w * 0.62, h * 0.3], [w * 0.53, h * 0.35], [w * 0.8, h * 0.6], [w * 0.7, h * 0.65], [w, h], [w * 0.45, h * 0.72], [w * 0.55, h * 0.67], [w * 0.2, h * 0.45], [w * 0.32, h * 0.39], [0, h * 0.17]]), text: [0.3, 0.3, 0.3, 0.3] },
  moon: {
    group: 'basic', type: 'moon', text: [0.1, 0.25, 0.5, 0.25],
    path: (w, h) => `M${r(w)} 0 A${r(w)} ${r(h / 2)} 0 0 0 ${r(w)} ${r(h)} A${r(w * 0.5)} ${r(h / 2)} 0 0 1 ${r(w)} 0 Z`,
  },
  smiley: {
    group: 'basic', type: 'smiley', text: [0.15, 0.15, 0.15, 0.15],
    path: (w, h) => `${ellipse(w / 2, h / 2, w / 2, h / 2)} ${ellipse(w * 0.33, h * 0.37, w * 0.06, h * 0.06)} ${ellipse(w * 0.67, h * 0.37, w * 0.06, h * 0.06)} M${r(w * 0.25)} ${r(h * 0.65)} Q${r(w / 2)} ${r(h * 0.85)} ${r(w * 0.75)} ${r(h * 0.65)}`,
  },
  // Block arrows
  rightArrow: { group: 'arrows', type: 'right-arrow', path: (w, h) => P([[0, h * 0.25], [w * 0.6, h * 0.25], [w * 0.6, 0], [w, h / 2], [w * 0.6, h], [w * 0.6, h * 0.75], [0, h * 0.75]]), text: [0, 0.25, 0.2, 0.25] },
  leftArrow: { group: 'arrows', type: 'left-arrow', path: (w, h) => P([[w, h * 0.25], [w * 0.4, h * 0.25], [w * 0.4, 0], [0, h / 2], [w * 0.4, h], [w * 0.4, h * 0.75], [w, h * 0.75]]), text: [0.2, 0.25, 0, 0.25] },
  upArrow: { group: 'arrows', type: 'up-arrow', path: (w, h) => P([[w * 0.25, h], [w * 0.25, h * 0.4], [0, h * 0.4], [w / 2, 0], [w, h * 0.4], [w * 0.75, h * 0.4], [w * 0.75, h]]), text: [0.25, 0.2, 0.25, 0] },
  downArrow: { group: 'arrows', type: 'down-arrow', path: (w, h) => P([[w * 0.25, 0], [w * 0.25, h * 0.6], [0, h * 0.6], [w / 2, h], [w, h * 0.6], [w * 0.75, h * 0.6], [w * 0.75, 0]]), text: [0.25, 0, 0.25, 0.2] },
  leftRightArrow: { group: 'arrows', type: 'left-right-arrow', path: (w, h) => P([[0, h / 2], [w * 0.2, 0], [w * 0.2, h * 0.25], [w * 0.8, h * 0.25], [w * 0.8, 0], [w, h / 2], [w * 0.8, h], [w * 0.8, h * 0.75], [w * 0.2, h * 0.75], [w * 0.2, h]]), text: [0.15, 0.25, 0.15, 0.25] },
  upDownArrow: { group: 'arrows', type: 'up-down-arrow', path: (w, h) => P([[w / 2, 0], [w, h * 0.2], [w * 0.75, h * 0.2], [w * 0.75, h * 0.8], [w, h * 0.8], [w / 2, h], [0, h * 0.8], [w * 0.25, h * 0.8], [w * 0.25, h * 0.2], [0, h * 0.2]]), text: [0.25, 0.15, 0.25, 0.15] },
  quadArrow: {
    group: 'arrows', type: 'quad-arrow', text: [0.3, 0.3, 0.3, 0.3],
    path: (w, h) => P([[w / 2, 0], [w * 0.65, h * 0.15], [w * 0.57, h * 0.15], [w * 0.57, h * 0.43], [w * 0.85, h * 0.43], [w * 0.85, h * 0.35], [w, h / 2], [w * 0.85, h * 0.65], [w * 0.85, h * 0.57], [w * 0.57, h * 0.57], [w * 0.57, h * 0.85], [w * 0.65, h * 0.85], [w / 2, h], [w * 0.35, h * 0.85], [w * 0.43, h * 0.85], [w * 0.43, h * 0.57], [w * 0.15, h * 0.57], [w * 0.15, h * 0.65], [0, h / 2], [w * 0.15, h * 0.35], [w * 0.15, h * 0.43], [w * 0.43, h * 0.43], [w * 0.43, h * 0.15], [w * 0.35, h * 0.15]]),
  },
  chevron: { group: 'arrows', type: 'chevron', path: (w, h) => P([[0, 0], [w * 0.75, 0], [w, h / 2], [w * 0.75, h], [0, h], [w * 0.25, h / 2]]), text: [0.25, 0.1, 0.25, 0.1] },
  homePlate: { group: 'arrows', type: 'pentagon-right', path: (w, h) => P([[0, 0], [w * 0.75, 0], [w, h / 2], [w * 0.75, h], [0, h]]), text: [0.05, 0.1, 0.25, 0.1] },
  notchedRightArrow: { group: 'arrows', type: 'notched-right-arrow', path: (w, h) => P([[0, h * 0.25], [w * 0.6, h * 0.25], [w * 0.6, 0], [w, h / 2], [w * 0.6, h], [w * 0.6, h * 0.75], [0, h * 0.75], [w * 0.15, h / 2]]), text: [0.15, 0.25, 0.2, 0.25] },
  // Stars
  star4: { group: 'stars', type: 'star4', path: (w, h) => star(4, 0.38, w, h), text: [0.3, 0.3, 0.3, 0.3] },
  star5: { group: 'stars', type: 'star5', path: (w, h) => star(5, 0.4, w, h), text: [0.3, 0.35, 0.3, 0.2] },
  star6: { group: 'stars', type: 'star6', path: (w, h) => star(6, 0.58, w, h), text: [0.25, 0.25, 0.25, 0.25] },
  star8: { group: 'stars', type: 'star8', path: (w, h) => star(8, 0.75, w, h), text: [0.2, 0.2, 0.2, 0.2] },
  star12: { group: 'stars', type: 'star12', path: (w, h) => star(12, 0.8, w, h), text: [0.2, 0.2, 0.2, 0.2] },
  // Callouts
  rectCallout: { group: 'callouts', type: 'rectangular-callout', path: (w, h) => P([[0, 0], [w, 0], [w, h * 0.75], [w * 0.42, h * 0.75], [w * 0.2, h], [w * 0.25, h * 0.75], [0, h * 0.75]]), text: [0.05, 0.05, 0.05, 0.3] },
  roundRectCallout: {
    group: 'callouts', type: 'round-rectangular-callout', text: [0.08, 0.08, 0.08, 0.3],
    path: (w, h) => { const k = Math.min(w, h) * 0.12; const b = h * 0.75; return `M${r(k)} 0 H${r(w - k)} Q${r(w)} 0 ${r(w)} ${r(k)} V${r(b - k)} Q${r(w)} ${r(b)} ${r(w - k)} ${r(b)} H${r(w * 0.42)} L${r(w * 0.2)} ${r(h)} L${r(w * 0.25)} ${r(b)} H${r(k)} Q0 ${r(b)} 0 ${r(b - k)} V${r(k)} Q0 0 ${r(k)} 0 Z`; },
  },
  ovalCallout: {
    group: 'callouts', type: 'round-callout', text: [0.15, 0.12, 0.15, 0.3],
    path: (w, h) => `M${r(w * 0.3)} ${r(h * 0.72)} A${r(w / 2)} ${r(h * 0.37)} 0 1 1 ${r(w * 0.42)} ${r(h * 0.74)} L${r(w * 0.2)} ${r(h)} Z`,
  },
  cloudCallout: {
    group: 'callouts', type: 'cloud-callout', text: [0.18, 0.18, 0.18, 0.3],
    path: (w, h) => {
      const bumps = [[0.25, 0.22, 0.2, 0.18], [0.5, 0.15, 0.2, 0.15], [0.75, 0.25, 0.2, 0.18], [0.82, 0.48, 0.17, 0.18], [0.65, 0.66, 0.22, 0.15], [0.35, 0.66, 0.22, 0.15], [0.17, 0.46, 0.17, 0.18], [0.5, 0.42, 0.32, 0.25]];
      return `${bumps.map(([x, y, rx, ry]) => ellipse(w * x, h * y, w * rx, h * ry)).join(' ')} ${ellipse(w * 0.2, h * 0.86, w * 0.05, h * 0.04)} ${ellipse(w * 0.12, h * 0.96, w * 0.03, h * 0.03)}`;
    },
  },
};

export const SHAPE_GROUPS = ['lines', 'rectangles', 'basic', 'arrows', 'stars', 'callouts'];

/** ODF preset name → our preset id. */
export const BY_TYPE = new Map(Object.entries(SHAPES).filter(([, s]) => s.type).map(([id, s]) => [s.type, id]));

/** Icon path for a 20×20 gallery tile. */
export function shapeIconPath(id) {
  const s = SHAPES[id];
  if (s.line) return 'M2 18 L18 2';
  const w = 18; const h = id === 'rectangle' || id === 'roundRectangle' || id.endsWith('Callout') || id === 'leftRightArrow' || id === 'rightArrow' || id === 'leftArrow' || id === 'chevron' || id === 'homePlate' || id === 'notchedRightArrow' ? 13 : 18;
  return s.path(w, h);
}

/**
 * An enhanced-path without formulas (only numbers and commands M L C Z N F S Q A…)
 * scaled into the w×h box; null when it can't be drawn that way.
 */
export function enhancedPathToSvg(geometry, w, h) {
  const a = geometry?.a || {};
  const d = a['draw:enhanced-path'];
  if (!d || /[?$]/.test(d)) return null;
  const vb = (a['svg:viewBox'] || '0 0 21600 21600').split(/[\s,]+/).map(Number);
  const [vx, vy, vw, vh] = vb.length === 4 ? vb : [0, 0, 21600, 21600];
  const sx = w / (vw || 1);
  const sy = h / (vh || 1);
  const toks = d.match(/[A-Za-z]|-?[\d.]+(?:e-?\d+)?/g) || [];
  let out = '';
  let cmd = '';
  const nums = [];
  const flush = () => {
    if (!cmd) return;
    const xy = (i) => `${r((nums[i] - vx) * sx)} ${r((nums[i + 1] - vy) * sy)}`;
    const group = (letter, n) => { for (let i = 0; i + 1 < nums.length; i += 2) out += `${(i / 2) % n === 0 ? ` ${letter}` : ''} ${xy(i)}`; };
    switch (cmd) {
      case 'M': out += ` M ${xy(0)}`; for (let i = 2; i + 1 < nums.length; i += 2) out += ` L ${xy(i)}`; break;
      case 'L': group('L', 1); break;
      case 'C': group('C', 3); break;
      case 'Q': group('Q', 2); break;
      case 'Z': out += ' Z'; break;
      case 'N': case 'F': case 'S': break;
      default: throw new Error('unsupported');
    }
    nums.length = 0;
  };
  try {
    for (const t of toks) {
      if (/^[A-Za-z]$/.test(t)) { flush(); cmd = t; if (cmd === 'Z') { out += ' Z'; cmd = ''; } } else nums.push(Number(t));
    }
    flush();
  } catch { return null; }
  return out.trim() || null;
}

/** SVG path for a shape node (custom-shape / rect / ellipse), w×h px. */
export function shapePath(attrs, w, h) {
  if (attrs.element === 'draw:rect') return SHAPES.rectangle.path(w, h);
  if (attrs.element === 'draw:ellipse') return SHAPES.ellipse.path(w, h);
  const geo = (attrs.parts || []).find((p) => p.n === 'draw:enhanced-geometry');
  const type = geo?.a?.['draw:type'];
  const id = BY_TYPE.get(type);
  if (id) return SHAPES[id].path(w, h);
  return enhancedPathToSvg(geo, w, h) || SHAPES.rectangle.path(w, h);
}

/** Text area insets (fractions) of a shape. */
export function shapeTextInsets(attrs) {
  const geo = (attrs.parts || []).find((p) => p.n === 'draw:enhanced-geometry');
  const id = BY_TYPE.get(geo?.a?.['draw:type']);
  return (id && SHAPES[id].text) || [0, 0, 0, 0];
}
