/**
 * The fixed-layout page model shared by the PDF and XPS writers: what the
 * screen shows, page by page, read from the laid-out document (the page
 * stack: page boxes with headers, footers and watermarks, the text flow,
 * repeated table headings, footnotes, line numbers).
 *
 * buildPages(o) → [{ width, height, items, outline, annots }]   (CSS px, origin top-left)
 *   items:
 *     { t: 'rect', x, y, w, h, fill, alpha }
 *     { t: 'line', x1, y1, x2, y2, width, color, dash }
 *     { t: 'path', d: [['M', x, y] | ['L', x, y] | ['C', x1, y1, x2, y2, x, y] | ['Z']], fill, stroke, width, fillAlpha, strokeAlpha, dash, evenOdd }
 *     { t: 'text', face, size, color, glyphs: [{ gid, ch, x }], y (baseline), invisible, struct, artifact }
 *     { t: 'image', image, x, y, w, h, struct }
 *     { t: 'group', matrix: [a, b, c, d, e, f], items }   (a CSS transform about the page origin)
 *   outline: [{ level, title, y }]    annots: [{ t: 'link', x, y, w, h, uri | dest }, { t: 'note', x, y, author, text }]
 *
 * Text positions are the browser's own (each character's box, so
 * justification, letter spacing and tabs are exact); the baseline is the
 * box top plus the font's ascent, as the browser places it.
 */

const SKIP_CLASSES = ['ProseMirror-separator', 'ProseMirror-gapcursor', 'obj-handles', 'notes-measure', 'pg-gap', 'cmt-lines', 'ProseMirror-trailingBreak'];
const SCREEN_DECORATION = ['sp-err', 'gr-err', 'odt-find', 'ra-word'];

function rgba(css) {
  const m = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)/.exec(css || '');
  if (!m) return null;
  let a = m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  if (!Number.isFinite(a)) a = 1;
  const hex = (v) => Math.round(Math.min(255, Math.max(0, +v))).toString(16).padStart(2, '0');
  return { hex: `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`, a };
}

// ------------------------------------------------------------ SVG geometry

function parsePathD(d) {
  const toks = String(d).match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) || [];
  const out = [];
  let i = 0;
  let cmd = '';
  let x = 0; let y = 0; let sx = 0; let sy = 0; let lcx = 0; let lcy = 0; let lqx = 0; let lqy = 0;
  const num = () => parseFloat(toks[i++]);
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    if (C === 'M') { x = ox + num(); y = oy + num(); sx = x; sy = y; out.push(['M', x, y]); cmd = rel ? 'l' : 'L'; } else if (C === 'L') { x = ox + num(); y = oy + num(); out.push(['L', x, y]); } else if (C === 'H') { x = (rel ? x : 0) + num(); out.push(['L', x, y]); } else if (C === 'V') { y = (rel ? y : 0) + num(); out.push(['L', x, y]); } else if (C === 'C') {
      const a = [ox + num(), oy + num(), ox + num(), oy + num(), ox + num(), oy + num()];
      out.push(['C', ...a]); [lcx, lcy, x, y] = [a[2], a[3], a[4], a[5]];
    } else if (C === 'S') {
      const p = out[out.length - 1];
      const r1 = p?.[0] === 'C' ? [2 * x - lcx, 2 * y - lcy] : [x, y];
      const a = [ox + num(), oy + num(), ox + num(), oy + num()];
      out.push(['C', ...r1, ...a]); [lcx, lcy, x, y] = a;
    } else if (C === 'Q' || C === 'T') {
      let qx; let qy;
      if (C === 'Q') { qx = ox + num(); qy = oy + num(); } else { const p = out[out.length - 1]; [qx, qy] = p?.q ? [2 * x - lqx, 2 * y - lqy] : [x, y]; }
      const ex = ox + num();
      const ey = oy + num();
      const c = ['C', x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), ex + (2 / 3) * (qx - ex), ey + (2 / 3) * (qy - ey), ex, ey];
      c.q = true;
      out.push(c); [lqx, lqy, x, y] = [qx, qy, ex, ey];
    } else if (C === 'A') {
      const rx = num(); const ry = num(); const rot = num(); const large = num(); const sweep = num();
      const ex = ox + num(); const ey = oy + num();
      out.push(...arcToCurves(x, y, rx, ry, rot, large, sweep, ex, ey)); x = ex; y = ey;
    } else if (C === 'Z') { out.push(['Z']); x = sx; y = sy; } else i++;
  }
  return out;
}

/** An SVG arc as cubic curves. */
function arcToCurves(x1, y1, rx, ry, phiDeg, fa, fs, x2, y2) {
  if (!rx || !ry) return [['L', x2, y2]];
  const phi = (phiDeg * Math.PI) / 180;
  const cos = Math.cos(phi); const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2; const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy; const y1p = -sin * dx + cos * dy;
  rx = Math.abs(rx); ry = Math.abs(ry);
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const sgn = fa === fs ? -1 : 1;
  const co = sgn * Math.sqrt(Math.max(0, (rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p) / (rx * rx * y1p * y1p + ry * ry * x1p * x1p)));
  const cxp = (co * rx * y1p) / ry; const cyp = (-co * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2; const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => { const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); return a; };
  let t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!fs && dt > 0) dt -= 2 * Math.PI; else if (fs && dt < 0) dt += 2 * Math.PI;
  const n = Math.ceil(Math.abs(dt) / (Math.PI / 2));
  const out = [];
  const pt = (t) => [cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos];
  const der = (t) => [-rx * Math.sin(t) * cos - ry * Math.cos(t) * sin, -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos];
  for (let k = 0; k < n; k++) {
    const a = t1 + (dt * k) / n; const b = t1 + (dt * (k + 1)) / n;
    const al = (4 / 3) * Math.tan((b - a) / 4);
    const [px, py] = pt(a); const [qx, qy] = pt(b); const [dax, day] = der(a); const [dbx, dby] = der(b);
    out.push(['C', px + al * dax, py + al * day, qx - al * dbx, qy - al * dby, qx, qy]);
  }
  void t1;
  return out;
}

const K = 0.5522847498;
function ellipsePath(cx, cy, rx, ry) {
  return [['M', cx + rx, cy], ['C', cx + rx, cy + K * ry, cx + K * rx, cy + ry, cx, cy + ry], ['C', cx - K * rx, cy + ry, cx - rx, cy + K * ry, cx - rx, cy], ['C', cx - rx, cy - K * ry, cx - K * rx, cy - ry, cx, cy - ry], ['C', cx + K * rx, cy - ry, cx + rx, cy - K * ry, cx + rx, cy], ['Z']];
}

function shapePath(el) {
  const n = (a) => el[a]?.baseVal?.value ?? parseFloat(el.getAttribute(a) || 0);
  switch (el.localName) {
    case 'path': return parsePathD(el.getAttribute('d') || '');
    case 'rect': {
      const x = n('x'); const y = n('y'); const w = n('width'); const h = n('height');
      if (!w || !h) return [];
      return [['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']];
    }
    case 'circle': return ellipsePath(n('cx'), n('cy'), n('r'), n('r'));
    case 'ellipse': return ellipsePath(n('cx'), n('cy'), n('rx'), n('ry'));
    case 'line': return [['M', n('x1'), n('y1')], ['L', n('x2'), n('y2')]];
    case 'polyline': case 'polygon': {
      const p = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number);
      const out = [];
      for (let i = 0; i + 1 < p.length; i += 2) out.push([i ? 'L' : 'M', p[i], p[i + 1]]);
      if (el.localName === 'polygon') out.push(['Z']);
      return out;
    }
    default: return [];
  }
}

// ------------------------------------------------------------ main

/**
 * @param {object} o
 *   stack       the page stack element
 *   pages       page elements (.pg) to output
 *   fonts       FontBook (fonts.js)
 *   imageOf     (img element) → { key } registered image
 *   rasterise   (element, scale) → Promise<{ key }> (equations, canvases)
 *   markup      include comments as note annotations
 */
export async function buildPages(o) {
  const { stack, fonts } = o;
  const pageBoxes = o.pages.map((el) => { const r = el.getBoundingClientRect(); return { el, r, scale: r.width / (el.offsetWidth || r.width) }; });
  const scale = pageBoxes[0]?.scale || 1;
  const out = pageBoxes.map((p) => ({ width: p.el.offsetWidth, height: p.el.offsetHeight, items: [], outline: [], annots: [] }));
  // The page a point (screen coordinates) is on, and the point in its coordinates.
  const pageOf = (sx, sy) => {
    for (let i = 0; i < pageBoxes.length; i++) {
      const r = pageBoxes[i].r;
      if (sy >= r.top - 0.5 && sy <= r.bottom + 0.5 && sx >= r.left - 40 && sx <= r.right + 40) return i;
    }
    return -1;
  };
  const local = (i, sx, sy) => [(sx - pageBoxes[i].r.left) / scale, (sy - pageBoxes[i].r.top) / scale];
  const add = (i, item) => { if (i >= 0) out[i].items.push(item); };
  const styleCache = new Map();
  const cs = (el) => { let s = styleCache.get(el); if (!s) { s = getComputedStyle(el); styleCache.set(el, s); } return s; };
  const range = document.createRange();

  // Text decorations reach inline descendants without being inherited: collect them up to the block.
  const decoCache = new Map();
  function decorationsOf(el) {
    if (decoCache.has(el)) return decoCache.get(el);
    const s = cs(el);
    let list = [];
    const inline = /^inline/.test(s.display) || s.display === 'contents';
    if (inline && el.parentElement && el.parentElement !== stack) list = [...decorationsOf(el.parentElement)];
    const lines = s.textDecorationLine;
    if (lines && lines !== 'none' && !SCREEN_DECORATION.some((c) => el.classList.contains(c))) {
      for (const l of lines.split(/\s+/)) if (l === 'underline' || l === 'line-through' || l === 'overline') list.push({ line: l, color: rgba(s.textDecorationColor || s.color), style: s.textDecorationStyle, thickness: /px$/.test(s.textDecorationThickness || '') ? parseFloat(s.textDecorationThickness) : 0 });
    }
    decoCache.set(el, list);
    return list;
  }

  /** The nearest ancestor with a CSS transform (rotated frames, the diagonal watermark), or null. */
  const transformCache = new Map();
  function transformOf(el) {
    if (!el || el === stack) return null;
    if (transformCache.has(el)) return transformCache.get(el);
    const s = cs(el);
    let t = null;
    if (s.transform && s.transform !== 'none' && !/^matrix\(1, 0, 0, 1,/.test(s.transform)) {
      const m = new DOMMatrix(s.transform);
      if (Math.abs(m.b) > 1e-4 || Math.abs(m.c) > 1e-4) {
        const r = el.getBoundingClientRect();
        // Rotation about the box centre (the transform origin of rotated objects): the centre stays put.
        const cx = (r.left + r.right) / 2; const cy = (r.top + r.bottom) / 2;
        const lin = new DOMMatrix([m.a, m.b, m.c, m.d, 0, 0]);
        t = { el, cx, cy, lin, inv: lin.inverse() };
      }
    }
    if (!t) t = transformOf(el.parentElement);
    transformCache.set(el, t);
    return t;
  }
  const groups = new Map(); // transform → { page, items }
  /** Where an item measured in screen coordinates under a transform goes: { page, sink, map(sx, sy) → local }. */
  function placeFor(el, sx, sy) {
    const t = transformOf(el);
    if (!t) { const p = pageOf(sx, sy); return p < 0 ? null : { page: p, sink: out[p].items, map: (x, y) => local(p, x, y) }; }
    let g = groups.get(t);
    if (!g) {
      const p = pageOf(t.cx, t.cy);
      if (p < 0) return null;
      const [lx, ly] = local(p, t.cx, t.cy);
      // matrix = translate(centre) · rotation · translate(-centre), in page coordinates.
      const L = t.lin;
      g = { page: p, items: [], matrix: [L.a, L.b, L.c, L.d, lx - L.a * lx - L.c * ly, ly - L.b * lx - L.d * ly] };
      groups.set(t, g);
      out[p].items.push({ t: 'group', matrix: g.matrix, items: g.items });
    }
    // Screen points under the rotation → unrotated (about the centre), then page coordinates.
    return { page: g.page, sink: g.items, map: (x, y) => { const q = t.inv.transformPoint(new DOMPoint(x - t.cx, y - t.cy)); return local(g.page, q.x + t.cx, q.y + t.cy); } };
  }

  /** Effective opacity (the element's and its ancestors'). */
  const opCache = new Map();
  function opacityOf(el) {
    if (!el || el === stack || el.nodeType !== 1) return 1;
    if (opCache.has(el)) return opCache.get(el);
    const v = (parseFloat(cs(el).opacity) || 0) * opacityOf(el.parentElement);
    opCache.set(el, v);
    return v;
  }

  // ---------------------------------------------------------- text

  /** The first shadow of a computed text-shadow: { color, x, y } (page units = CSS px). */
  function parseShadow(v) {
    const m = v.match(/^(rgba?\([^)]*\))\s+(-?[\d.]+)px\s+(-?[\d.]+)px/);
    if (!m) return null;
    const color = rgba(m[1]);
    return color ? { color, x: parseFloat(m[2]), y: parseFloat(m[3]) } : null;
  }

  /** A character no embeddable font draws: the browser's rendering at 300 dpi, carrying its text. */
  function rasterChar(place, ch, x, y, w, h, baseline, s, size, face, opts) {
    const k = 300 / 96;
    const cw = Math.max(1, Math.ceil(w * k)); const chh = Math.max(1, Math.ceil(h * k));
    const cv = document.createElement('canvas');
    cv.width = cw; cv.height = chh;
    const ctx = cv.getContext('2d');
    ctx.font = `${s.fontStyle} ${s.fontWeight} ${size * k}px ${s.fontFamily}`;
    ctx.fillStyle = s.color;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(ch, 0, (baseline - y) * k);
    const slot = { t: 'image', image: null, x, y, w: cw / k, h: chh / k, alt: ch, actualText: ch, face: face.key, size, baseline, struct: opts.struct, artifact: opts.artifact };
    place.sink.push(slot);
    pending.push(new Promise((res) => cv.toBlob(res, 'image/png')).then(async (blob) => { slot.image = o.addPng(new Uint8Array(await blob.arrayBuffer()), cw, chh); }).catch(() => { slot.image = null; }));
  }

  /**
   * Vertical text (table cells rotated 90° / 270°): each column of characters is a horizontal
   * run inside a rotated group. vertical-rl turns the glyphs clockwise (read top to bottom),
   * sideways-lr anticlockwise (read bottom to top).
   */
  function emitVertical(el, chars, s, opts, face, size, color) {
    const up = s.writingMode === 'sideways-lr';
    const asc = (face.metrics.ascent * size) / face.metrics.upm;
    let g = null;
    for (const c of chars) {
      const p = pageOf((c.left + c.right) / 2, (c.top + c.bottom) / 2);
      if (p < 0) continue;
      const [l, t] = local(p, c.left, c.top);
      const [r, b] = local(p, c.right, c.bottom);
      const bx = up ? l + asc : r - asc;
      if (!g || g.page !== p || Math.abs(g.bx - bx) > 0.6) {
        const oy = up ? b : t;
        g = { page: p, bx, oy, text: { t: 'text', face: face.key, size, color: color.hex, alpha: color.a * opacityOf(el), y: 0, glyphs: [], struct: opts.struct, artifact: opts.artifact, invisible: !!opts.invisible } };
        out[p].items.push({ t: 'group', matrix: up ? [0, -1, 1, 0, bx, oy] : [0, 1, -1, 0, bx, oy], items: [g.text] });
      }
      const along = up ? g.oy - b : t - g.oy;
      g.text.glyphs.push({ ch: c.ch, gid: face.use(c.ch), x: along, w: Math.abs(b - t) });
    }
  }

  function emitText(el, chars, s, opts = {}) {
    // chars: [{ ch, left, right, top, bottom }] in screen coordinates, in order.
    const face = fonts.resolve(s);
    if (!face) return;
    const size = parseFloat(s.fontSize) * 1; // CSS px (the page is laid out at scale 1 inside the zoom)
    let color = rgba(s.color);
    // Outlined text (-webkit-text-stroke): drawn as stroked glyph outlines in the stroke colour.
    const strokeW = parseFloat(s.webkitTextStrokeWidth) || 0;
    const strokeC = strokeW > 0 ? rgba(s.webkitTextStrokeColor) : null;
    const outline = strokeC && strokeC.a > 0 ? strokeW : 0;
    if (outline) color = strokeC;
    if (!color || color.a === 0 || s.visibility === 'hidden') return;
    if (/^(vertical|sideways)/.test(s.writingMode || '')) { emitVertical(el, chars, s, opts, face, size, color); return; }
    const deco = opts.noDecoration ? [] : decorationsOf(el);
    // text-shadow (the first shadow; blur isn't reproduced): a copy of the run, offset, underneath.
    const shadow = !opts.invisible && s.textShadow && s.textShadow !== 'none' ? parseShadow(s.textShadow) : null;
    // text-transform and small capitals, as the browser draws them.
    const tt = s.textTransform;
    const smallCaps = s.fontVariantCaps === 'small-caps' || /small-caps/.test(s.fontVariant || '');
    let prevCh = ' ';
    const shape = (ch) => {
      let out = ch;
      if (tt === 'uppercase') out = ch.toUpperCase();
      else if (tt === 'lowercase') out = ch.toLowerCase();
      else if (tt === 'capitalize' && /[\s([{"'«“‘\-–—]/.test(prevCh)) out = ch.toUpperCase();
      prevCh = ch;
      if ([...out].length !== 1) out = ch;
      let k = 1;
      if (smallCaps && out !== out.toUpperCase() && [...out.toUpperCase()].length === 1) { out = out.toUpperCase(); k = 0.7; }
      return [out, k];
    };
    let run = null;
    const flush = () => {
      if (!run || !run.glyphs.length) { run = null; return; }
      if (shadow && shadow.color.a > 0) {
        const dx = shadow.x; const dy = shadow.y;
        run.sink.push({ ...run.item, color: shadow.color.hex, alpha: shadow.color.a * opacityOf(el), outline: 0, y: run.item.y + dy, glyphs: run.glyphs.map((g) => ({ ...g, x: g.x + dx })), struct: undefined, artifact: true });
      }
      run.sink.push(run.item);
      // Underline / strike-through along the run.
      const first = run.glyphs[0];
      const last = run.glyphs[run.glyphs.length - 1];
      const x1 = first.x;
      const x2 = last.x + last.w;
      for (const d of deco) {
        const m = face.metrics;
        // text-decoration-thickness when set, else the font's underline thickness.
        const width = d.thickness || Math.max(0.5, (m.underlineThickness * size) / m.upm);
        // The font's underline position is the line's top edge: the thickness hangs below it.
        const y = d.line === 'underline' ? run.item.y - (m.underlinePosition * size) / m.upm + width / 2 : d.line === 'line-through' ? run.item.y - (m.strikePosition * size) / m.upm : run.item.y - (m.ascent * size) / m.upm;
        const dash = d.style === 'dotted' ? [width, width] : d.style === 'dashed' ? [width * 3, width * 2] : null;
        const c = d.color?.hex || color.hex;
        if (d.style === 'wavy') {
          // A wave of half-periods 2 × thickness, as the browser draws it.
          // Chrome's wave: about 2.5 px from crest to trough per px of thickness, hanging below the underline position.
          const amp = Math.max(1, width) * 1.1; const half = Math.max(2, width * 2.2);
          const wy = y + amp * 0.75 + size * 0.12;
          const dd = [['M', x1, wy]];
          for (let x = x1, up = true; x < x2; x += half, up = !up) { const xe = Math.min(x2, x + half); dd.push(['C', x + (xe - x) / 2, wy + (up ? -amp : amp), x + (xe - x) / 2, wy + (up ? -amp : amp), xe, wy]); }
          run.sink.push({ t: 'path', d: dd, fill: null, fillAlpha: 0, stroke: c, strokeAlpha: 1, width });
          continue;
        }
        run.sink.push({ t: 'line', x1, y1: y, x2, y2: y, width, color: c, dash });
        if (d.style === 'double') run.sink.push({ t: 'line', x1, y1: y + width * 2, x2, y2: y + width * 2, width, color: c });
      }
      run = null;
    };
    for (const c of chars) {
      const cy = (c.top + c.bottom) / 2;
      const place = placeFor(el, (c.left + c.right) / 2, cy);
      if (!place) { flush(); continue; }
      const [lx0, ly0] = place.map(c.left, c.top);
      const [lx1] = place.map(c.right, c.top);
      // Under a rotation the box is the rotated glyph's bounds: its centre is still the glyph's.
      const [mx, my] = place.map((c.left + c.right) / 2, cy);
      const w = Math.abs(lx1 - lx0) || 0;
      const half = (c.right - c.left) / 2 / scale;
      const gx = place.sink === out[place.page].items ? lx0 : mx - (face.advance(c.ch) * size) / 2;
      const baseline = (place.sink === out[place.page].items ? ly0 : my - (c.bottom - c.top) / 2 / scale) + (face.metrics.ascent * size) / face.metrics.upm;
      const [ch, k] = shape(c.ch);
      // A character the font hasn't: another embeddable font that has it, else a 300 dpi picture of
      // what the browser draws (colour emoji, scripts no bundled font covers) with the text kept.
      let f = face;
      if (!/\s/.test(ch) && !face.has(ch)) {
        f = fonts.fallback(s, ch);
        if (!f) {
          flush();
          if (!opts.invisible && o.addPng) rasterChar(place, ch, lx0, Math.min(ly0, baseline - (face.metrics.ascent * size) / face.metrics.upm), w || (c.right - c.left) / scale, (c.bottom - c.top) / scale, baseline, s, size * k, face, opts);
          continue;
        }
      }
      if (!run || run.sink !== place.sink || Math.abs(run.item.y - baseline) > 0.6 || run.item.size !== size * k || run.item.face !== f.key) {
        flush();
        run = { sink: place.sink, glyphs: [], item: { t: 'text', face: f.key, size: size * k, color: color.hex, alpha: color.a * opacityOf(el), y: baseline, glyphs: null, struct: opts.struct, artifact: opts.artifact, invisible: !!opts.invisible, outline } };
        run.item.glyphs = run.glyphs;
      }
      void half;
      // A glyph from another font than the browser's: centred in the browser's box (the widths differ).
      const fx = f !== face && w ? gx + (w - f.advance(ch) * size * k) / 2 : gx;
      run.glyphs.push({ ch, gid: f.use(ch), x: fx, w: w || (f.advance(ch) * size * k) });
    }
    flush();
  }

  /** Characters of a text node with their boxes (screen coordinates). */
  function charsOf(node) {
    const text = node.data;
    const chars = [];
    for (let i = 0; i < text.length;) {
      const cp = text.codePointAt(i);
      const n = cp > 0xffff ? 2 : 1;
      const ch = text.slice(i, i + n);
      if (ch !== '\n' && ch !== '​' && ch !== '﻿') {
        range.setStart(node, i);
        range.setEnd(node, i + n);
        const rects = range.getClientRects();
        const r = rects[0];
        if (r && (r.width > 0 || (ch === ' ' && r.height > 0))) chars.push({ ch: ch === ' ' || ch === '\t' ? ' ' : ch, left: r.left, right: r.right, top: r.top, bottom: r.bottom });
      }
      i += n;
    }
    return chars;
  }

  /** ::before / ::after text (field results, labels): placed at the element's start / end, measured with the font. */
  function pseudoText(el, which, struct, artifact) {
    const ps = getComputedStyle(el, which);
    const content = ps.content;
    if (!content || content === 'none' || content === 'normal' || !/^["']/.test(content)) return;
    const text = content.slice(1, -1).replace(/\\(.)/g, '$1');
    if (!text.trim() || ps.display === 'none') return;
    const face = fonts.resolve(ps);
    if (!face) return;
    const rects = el.getClientRects();
    const r = which === '::before' ? rects[0] : rects[rects.length - 1];
    if (!r) return;
    const size = parseFloat(ps.fontSize);
    const total = [...text].reduce((a, ch) => a + face.advance(ch) * size, 0) * scale;
    let x = which === '::before' ? r.left : r.right - total;
    const ascent = (face.metrics.ascent * size) / face.metrics.upm;
    const chars = [];
    for (const ch of text) { const w = face.advance(ch) * size * scale; chars.push({ ch, left: x, right: x + w, top: r.top + (r.height - ((face.metrics.ascent - face.metrics.descent) * size * scale) / face.metrics.upm) / 2, bottom: 0 }); x += w; }
    for (const c of chars) c.bottom = c.top + ((face.metrics.ascent - face.metrics.descent) * size * scale) / face.metrics.upm;
    void ascent;
    emitText(el, chars, ps, { struct, artifact, noDecoration: true });
  }

  // ---------------------------------------------------------- boxes

  const sharedBorders = new Set();
  function boxes(el, s, struct) {
    const bg = rgba(s.backgroundColor);
    const bw = ['Top', 'Right', 'Bottom', 'Left'].map((k) => (s[`border${k}Style`] !== 'none' && s[`border${k}Style`] !== 'hidden' ? parseFloat(s[`border${k}Width`]) || 0 : 0));
    columnRules(el, s);
    if (el.classList?.contains('odt-tab') && el.dataset.leader) tabLeader(el, s);
    if ((!bg || bg.a === 0) && !bw.some((w) => w > 0)) return;
    const rects = /^inline/.test(s.display) ? [...el.getClientRects()] : [el.getBoundingClientRect()];
    // Collapsed table borders straddle the cell edge and are shared by neighbouring cells: drawn once, on the edge.
    const collapse = /^(td|th|table)$/.test(el.localName) && cs(el.localName === 'table' ? el : el.closest('table') || el).borderCollapse === 'collapse';
    for (const r of rects) {
      if (r.width <= 0 || r.height <= 0) continue;
      const place = placeFor(el, (r.left + r.right) / 2, Math.max(r.top, Math.min(r.bottom, (r.top + r.bottom) / 2)));
      // A block spanning pages (a split paragraph): each page gets its part.
      const pagesHit = place && place.sink === out[place.page].items ? pageBoxes.map((p, i) => (r.bottom > p.r.top && r.top < p.r.bottom && r.right > p.r.left - 40 && r.left < p.r.right + 40 ? i : -1)).filter((i) => i >= 0) : place ? [place.page] : [];
      for (const pi of pagesHit) {
        const sink = place.sink === out[place.page].items ? out[pi].items : place.sink;
        const map = place.sink === out[place.page].items ? (x, y) => local(pi, x, y) : place.map;
        const [x, y] = map(r.left, r.top);
        const [x2, y2] = map(r.right, r.bottom);
        const box = { x: Math.min(x, x2), y: Math.min(y, y2), w: Math.abs(x2 - x), h: Math.abs(y2 - y) };
        if (place.sink !== out[place.page].items) { box.w = el.offsetWidth || box.w; box.h = el.offsetHeight || box.h; const [mx, my] = map((r.left + r.right) / 2, (r.top + r.bottom) / 2); box.x = mx - box.w / 2; box.y = my - box.h / 2; }
        if (bg && bg.a > 0) sink.push({ t: 'rect', ...box, fill: bg.hex, alpha: bg.a * opacityOf(el), struct });
        const sides = [['Top', box.x, box.y, box.x + box.w, box.y], ['Right', box.x + box.w, box.y, box.x + box.w, box.y + box.h], ['Bottom', box.x, box.y + box.h, box.x + box.w, box.y + box.h], ['Left', box.x, box.y, box.x, box.y + box.h]];
        sides.forEach(([k, a, b, c, d], i) => {
          const w = bw[i];
          if (!w) return;
          const col = rgba(s[`border${k}Color`]);
          if (!col || col.a === 0) return;
          const st = s[`border${k}Style`];
          // The line runs through the middle of the border.
          const inset = collapse ? 0 : w / 2;
          if (collapse) {
            const key = `${pi}|${Math.round(a * 4)}|${Math.round(b * 4)}|${Math.round(c * 4)}|${Math.round(d * 4)}`;
            if (sharedBorders.has(key)) return;
            sharedBorders.add(key);
          }
          const off = { Top: [0, inset], Bottom: [0, -inset], Left: [inset, 0], Right: [-inset, 0] }[k];
          const dash = st === 'dotted' ? [w, w * 1.5] : st === 'dashed' ? [w * 3, w * 2] : null;
          if (st === 'double' && w >= 3) {
            const t3 = w / 3;
            const o1 = { Top: [0, t3 / 2], Bottom: [0, -t3 / 2], Left: [t3 / 2, 0], Right: [-t3 / 2, 0] }[k];
            const o2 = { Top: [0, w - t3 / 2], Bottom: [0, -(w - t3 / 2)], Left: [w - t3 / 2, 0], Right: [-(w - t3 / 2), 0] }[k];
            sink.push({ t: 'line', x1: a + o1[0], y1: b + o1[1], x2: c + o1[0], y2: d + o1[1], width: t3, color: col.hex });
            sink.push({ t: 'line', x1: a + o2[0], y1: b + o2[1], x2: c + o2[0], y2: d + o2[1], width: t3, color: col.hex });
          } else sink.push({ t: 'line', x1: a + off[0], y1: b + off[1], x2: c + off[0], y2: d + off[1], width: w, color: col.hex, dash });
        });
      }
    }
  }

  /** Tab leaders (content.css draws them as background gradients): dots, dashes or a rule along the tab. */
  function tabLeader(el, s) {
    const col = rgba(s.color);
    if (!col || col.a === 0) return;
    const kind = el.dataset.leader;
    for (const r of el.getClientRects()) {
      if (r.width < 1) continue;
      const place = placeFor(el, (r.left + r.right) / 2, (r.top + r.bottom) / 2);
      if (!place) continue;
      const [x1, y1] = place.map(r.left, r.top);
      const [x2, y2] = place.map(r.right, r.bottom);
      const h = y2 - y1;
      if (kind === 'dotted') {
        // 4 px tiles at 92 %, a dot in the middle of each whole tile: the gradient's dot fills
        // about 2 × 1 px (that is how the browser draws it at 100 %).
        // The browser snaps background tiles to whole pixels: so do the dots (≤ ½ px).
        const y = Math.round(y1 + (h - 3) * 0.92 + 1) + 0.5;
        const d = [];
        for (let x = Math.round(x1); x + 4 <= x2 + 0.51; x += 4) d.push(['M', x + 1, y - 0.5], ['L', x + 3, y - 0.5], ['L', x + 3, y + 0.5], ['L', x + 1, y + 0.5], ['Z']);
        if (d.length) place.sink.push({ t: 'path', d, fill: col.hex, fillAlpha: col.a, stroke: null, artifact: true });
      } else {
        const y = y1 + (h - 1) * 0.92 + 0.5;
        place.sink.push({ t: 'line', x1, y1: y, x2, y2: y, width: 1, color: col.hex, dash: kind === 'dash' ? [3.6, 2.4] : null, artifact: true });
      }
    }
  }

  /** column-rule: a line in the middle of each gap of a multi-column block (sections with a separator). */
  function columnRules(el, s) {
    const n = parseInt(s.columnCount, 10);
    if (!(n > 1) || s.columnRuleStyle === 'none' || s.columnRuleStyle === 'hidden') return;
    const w = parseFloat(s.columnRuleWidth) || 0;
    const col = rgba(s.columnRuleColor);
    if (!w || !col || col.a === 0) return;
    const r = el.getBoundingClientRect();
    const pl = parseFloat(s.paddingLeft) + parseFloat(s.borderLeftWidth || 0);
    const pr = parseFloat(s.paddingRight) + parseFloat(s.borderRightWidth || 0);
    const inner = (r.width / scale) - pl - pr;
    const gap = s.columnGap === 'normal' ? parseFloat(s.fontSize) : parseFloat(s.columnGap) || 0;
    const cw = (inner - (n - 1) * gap) / n;
    const dash = s.columnRuleStyle === 'dotted' ? [w, w * 1.5] : s.columnRuleStyle === 'dashed' ? [w * 3, w * 2] : null;
    pageBoxes.forEach((p, pi) => {
      const top = Math.max(r.top, p.r.top); const bottom = Math.min(r.bottom, p.r.bottom);
      if (bottom <= top || r.right < p.r.left || r.left > p.r.right) return;
      for (let i = 1; i < n; i++) {
        const sx = r.left + (pl + i * cw + (i - 0.5) * gap) * scale;
        const [x, y1] = local(pi, sx, top); const [, y2] = local(pi, sx, bottom);
        out[pi].items.push({ t: 'line', x1: x, y1, x2: x, y2, width: w, color: col.hex, dash });
      }
    });
  }

  // ---------------------------------------------------------- SVG

  function svg(root, struct) {
    const walk = (el) => {
      const s = cs(el);
      if (s.display === 'none' || s.visibility === 'hidden') return;
      if (el.localName === 'text') { svgText(el, s, struct); return; }
      if (el.localName === 'foreignObject') { for (const c of el.children) visit(c, struct); return; }
      if (el.localName === 'image') {
        const href = el.getAttribute('href') || el.getAttribute('xlink:href');
        const key = href ? o.imageHref?.(href) : null;
        if (key != null) {
          const m = el.getScreenCTM();
          const b = el.getBBox();
          const p1 = new DOMPoint(b.x, b.y).matrixTransform(m);
          const p2 = new DOMPoint(b.x + b.width, b.y + b.height).matrixTransform(m);
          const pg = pageOf((p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
          if (pg >= 0) { const [x, y] = local(pg, p1.x, p1.y); const [x2, y2] = local(pg, p2.x, p2.y); add(pg, { t: 'image', image: key, x: Math.min(x, x2), y: Math.min(y, y2), w: Math.abs(x2 - x), h: Math.abs(y2 - y), struct }); }
        }
        return;
      }
      if (['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon'].includes(el.localName)) {
        const d = shapePath(el);
        if (!d.length) return;
        const m = el.getScreenCTM();
        if (!m) return;
        const fill = rgba(s.fill);
        const stroke = rgba(s.stroke);
        const op = (parseFloat(s.opacity) || 1) * opacityOf(root.parentElement);
        const fillAlpha = fill ? fill.a * (parseFloat(s.fillOpacity) || 1) * op : 0;
        const strokeAlpha = stroke ? stroke.a * (parseFloat(s.strokeOpacity) || 1) * op : 0;
        // Gradients and patterns: their first colour.
        const grad = !fill && /url\(/.test(s.fill) ? firstStop(s.fill) : null;
        if (!fill && !grad && !stroke) return;
        const pts = [];
        const tr = (x, y) => { const p = new DOMPoint(x, y).matrixTransform(m); pts.push(p); return p; };
        const mapped = d.map((c) => {
          if (c[0] === 'Z') return ['Z'];
          const res = [c[0]];
          for (let k = 1; k < c.length; k += 2) { const p = tr(c[k], c[k + 1]); res.push(p.x, p.y); }
          return res;
        });
        if (!pts.length) return;
        const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
        const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
        const pg = pageOf(cx, cy);
        if (pg < 0) return;
        const loc = mapped.map((c) => { if (c[0] === 'Z') return c; const res = [c[0]]; for (let k = 1; k < c.length; k += 2) { const [x, y] = local(pg, c[k], c[k + 1]); res.push(x, y); } return res; });
        const scaleW = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) / scale;
        const dashArr = s.strokeDasharray && s.strokeDasharray !== 'none' ? s.strokeDasharray.split(/[\s,]+/).map((v) => parseFloat(v) * scaleW).filter((v) => v > 0) : null;
        add(pg, {
          t: 'path', d: loc, fill: fill?.hex || grad || null, fillAlpha: fill ? fillAlpha : grad ? op : 0, stroke: stroke && s.stroke !== 'none' ? stroke.hex : null,
          strokeAlpha, width: (parseFloat(s.strokeWidth) || 1) * scaleW, dash: dashArr?.length ? dashArr : null, evenOdd: s.fillRule === 'evenodd', cap: s.strokeLinecap, join: s.strokeLinejoin, struct,
        });
        return;
      }
      for (const c of el.children) walk(c);
    };
    const firstStop = (url) => {
      const id = /url\(["']?#([^"')]+)/.exec(url)?.[1];
      const g = id && root.ownerDocument.getElementById(id);
      const stop = g?.querySelector('stop');
      return stop ? rgba(getComputedStyle(stop).stopColor)?.hex || null : null;
    };
    walk(root);
  }

  function svgText(el, s, struct) {
    const m = el.getScreenCTM();
    const n = el.getNumberOfChars?.() || 0;
    if (!m || !n) return;
    const face = fonts.resolve(s);
    const color = rgba(s.fill);
    if (!face || !color) return;
    const text = el.textContent;
    const size = parseFloat(s.fontSize) * Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) / scale;
    const glyphs = [];
    let pg = -1;
    let base = 0;
    const rot = Math.atan2(m.b, m.a);
    let ox = 0; let oy = 0;
    for (let i = 0; i < n && i < text.length; i++) {
      let p;
      try { p = el.getStartPositionOfChar(i); } catch { continue; }
      const q = new DOMPoint(p.x, p.y).matrixTransform(m);
      if (pg < 0) { pg = pageOf(q.x, q.y); if (pg < 0) return; [ox, oy] = local(pg, q.x, q.y); base = oy; }
      const [lx, ly] = local(pg, q.x, q.y);
      // Along the (possibly rotated) baseline: distance from the first character.
      const dist = Math.hypot(lx - ox, ly - oy);
      const ch = text[i];
      glyphs.push({ ch, gid: face.use(ch), x: ox + dist, w: face.advance(ch) * size });
    }
    if (!glyphs.length) return;
    const item = { t: 'text', face: face.key, size, color: color.hex, alpha: color.a, y: base, glyphs, struct };
    if (Math.abs(rot) > 1e-3) add(pg, { t: 'group', matrix: [Math.cos(rot), Math.sin(rot), -Math.sin(rot), Math.cos(rot), ox - Math.cos(rot) * ox + Math.sin(rot) * oy, oy - Math.sin(rot) * ox - Math.cos(rot) * oy], items: [item] });
    else add(pg, item);
  }

  // ---------------------------------------------------------- walk

  const pending = []; // async work (rasterised equations / canvases)
  const structOf = (el) => o.structFor?.(el) || null;
  const isArtifact = (el) => !!el.closest('.pg-header, .pg-footer, .pg-watermark, .ln-layer, .notes-layer .odt-note-sep');

  function visit(el, struct) {
    if (el.nodeType === 3) {
      if (!el.data.trim() && !/\S| /.test(el.data) && el.data.length > 0 && el.parentElement && /^(pre|pre-wrap|break-spaces)/.test(cs(el.parentElement).whiteSpace) === false) {
        // Collapsible whitespace still separates words: kept (its boxes say where).
      }
      const parent = el.parentElement;
      emitText(parent, charsOf(el), cs(parent), { struct, artifact: isArtifact(parent) });
      return;
    }
    if (el.nodeType !== 1) return;
    if (SKIP_CLASSES.some((c) => el.classList?.contains(c))) return;
    if (el.classList?.contains('comments-layer')) {
      if (o.markup) for (const c of el.querySelectorAll('.cmt-card, [data-comment-name]')) { void c; }
      return;
    }
    const s = cs(el);
    if (s.display === 'none' || s.visibility === 'hidden' && !el.children.length) return;
    if (parseFloat(s.opacity) === 0) return;
    const st = structOf(el) || struct;
    boxes(el, s, st);
    pseudoText(el, '::before', st, isArtifact(el));
    if (el.localName === 'a' && el.getAttribute('href')) {
      for (const r of el.getClientRects()) {
        const pg = pageOf((r.left + r.right) / 2, (r.top + r.bottom) / 2);
        if (pg < 0) continue;
        const [x, y] = local(pg, r.left, r.top);
        out[pg].annots.push({ t: 'link', x, y, w: r.width / scale, h: r.height / scale, href: el.getAttribute('href') });
      }
    }
    if (/^h[1-6]$/.test(el.localName) && el.closest('.page-flow') && el.textContent.trim()) {
      const r = el.getClientRects()[0];
      const pg = r ? pageOf(r.left + 1, (r.top + r.bottom) / 2) : -1;
      if (pg >= 0) out[pg].outline.push({ level: Number(el.localName[1]), title: el.textContent.replace(/\s+/g, ' ').trim(), y: local(pg, r.left, r.top)[1] });
    }
    if (el.localName === 'img') {
      const r = el.getBoundingClientRect();
      const place = placeFor(el, (r.left + r.right) / 2, (r.top + r.bottom) / 2);
      const key = place ? o.imageOf?.(el) : null;
      if (key != null) {
        let box;
        if (place.sink === out[place.page].items) { const [x, y] = place.map(r.left, r.top); box = { x, y, w: r.width / scale, h: r.height / scale }; } else { const [mx, my] = place.map((r.left + r.right) / 2, (r.top + r.bottom) / 2); box = { x: mx - el.offsetWidth / 2, y: my - el.offsetHeight / 2, w: el.offsetWidth, h: el.offsetHeight }; }
        place.sink.push({ t: 'image', image: key, ...box, alt: el.getAttribute('alt') || '', alpha: opacityOf(el), struct: st });
      }
      return;
    }
    if (el.localName === 'svg') { svg(el, st); return; }
    if (el.localName === 'math' || el.localName === 'canvas') {
      // Browser-drawn (equations, canvases): a picture at 300 dpi, with the text underneath for searching.
      const r = el.getBoundingClientRect();
      const pg = pageOf((r.left + r.right) / 2, (r.top + r.bottom) / 2);
      if (pg >= 0 && r.width > 0) {
        const [x, y] = local(pg, r.left, r.top);
        const slot = { t: 'image', image: null, x, y, w: r.width / scale, h: r.height / scale, alt: el.textContent || '', struct: st };
        out[pg].items.push(slot);
        pending.push(o.rasterise(el, 300 / 96).then((key) => { slot.image = key; }).catch(() => { slot.image = null; }));
        if (el.localName === 'math') {
          const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          for (let n = tw.nextNode(); n; n = tw.nextNode()) emitText(n.parentElement, charsOf(n), cs(n.parentElement), { struct: st, invisible: true, noDecoration: true });
        }
      }
      return;
    }
    for (let c = el.firstChild; c; c = c.nextSibling) visit(c, st);
    pseudoText(el, '::after', st, isArtifact(el));
  }

  // Comments (Document showing markup): a note annotation where each comment is anchored.
  if (o.markup) {
    for (const a of stack.querySelectorAll('.page-flow .odt-annotation')) {
      let data = null;
      try { data = JSON.parse(a.getAttribute('data-annotation') || 'null'); } catch { data = null; }
      const r = a.getBoundingClientRect();
      const pg = pageOf(r.left, (r.top + r.bottom) / 2);
      if (!data || pg < 0) continue;
      const text = (data.body || []).map((b) => JSON.stringify(b).match(/"text":"((?:[^"\\]|\\.)*)"/g)?.map((t) => JSON.parse(`{${t}}`).text).join('') || '').join('\n');
      const [x, y] = local(pg, r.left, r.top);
      out[pg].annots.push({ t: 'note', x, y, author: data.creator || '', text, date: data.date || '' });
    }
  }

  for (let c = stack.firstChild; c; c = c.nextSibling) visit(c, null);
  await Promise.all(pending);
  // Pages keep only the items on them; outlines in reading order.
  for (const p of out) {
    p.items = p.items.filter((it) => it.t !== 'image' || it.image != null);
    p.outline.sort((a, b) => a.y - b.y);
  }

  return out;
}
