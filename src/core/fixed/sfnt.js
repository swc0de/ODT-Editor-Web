/**
 * A TrueType subset of a font for PDF and XPS embedding, from a fontkit font
 * (which reads the bundled WOFF2 files: their glyph tables are transformed,
 * so fontkit can't subset them itself).
 *
 * subsetTtf(font, gids, cmap) → { bytes, newGid: Map(old gid → new gid) }
 *   gids  original glyph ids to keep (.notdef is always glyph 0)
 *   cmap  Map(code point → original gid), written as a format 4 cmap
 *
 * Glyphs are written as simple glyphs from their outlines (composites
 * resolved, hinting dropped: PDF and XPS viewers don't need it). OS/2 and
 * name are copied from the font; head, hhea, maxp, hmtx, loca, glyf, cmap
 * and post (format 3) are written here.
 */

class Writer {
  constructor(size = 1024) { this.buf = new Uint8Array(size); this.view = new DataView(this.buf.buffer); this.pos = 0; }
  need(n) { if (this.pos + n <= this.buf.length) return; let s = this.buf.length * 2; while (s < this.pos + n) s *= 2; const b = new Uint8Array(s); b.set(this.buf); this.buf = b; this.view = new DataView(b.buffer); }
  u8(v) { this.need(1); this.view.setUint8(this.pos, v); this.pos += 1; }
  i8(v) { this.need(1); this.view.setInt8(this.pos, v); this.pos += 1; }
  u16(v) { this.need(2); this.view.setUint16(this.pos, v); this.pos += 2; }
  i16(v) { this.need(2); this.view.setInt16(this.pos, v); this.pos += 2; }
  u32(v) { this.need(4); this.view.setUint32(this.pos, v >>> 0); this.pos += 4; }
  i32(v) { this.need(4); this.view.setInt32(this.pos, v); this.pos += 4; }
  bytes(b) { this.need(b.length); this.buf.set(b, this.pos); this.pos += b.length; }
  pad4() { while (this.pos % 4) this.u8(0); }
  out() { return this.buf.slice(0, this.pos); }
}

/** One glyph's outline (fontkit path: moveTo / lineTo / quadraticCurveTo / closePath) → glyf data + bounds. */
function encodeGlyph(path) {
  const contours = [];
  let cur = null;
  for (const c of path.commands) {
    if (c.command === 'moveTo') { cur = [{ x: c.args[0], y: c.args[1], on: true }]; contours.push(cur); } else if (c.command === 'lineTo') cur?.push({ x: c.args[0], y: c.args[1], on: true });
    else if (c.command === 'quadraticCurveTo') { cur?.push({ x: c.args[0], y: c.args[1], on: false }, { x: c.args[2], y: c.args[3], on: true }); } else if (c.command === 'bezierCurveTo') {
      // A cubic (from CFF outlines): approximated by two quadratics through its midpoint.
      const [x1, y1, x2, y2, x, y] = c.args;
      const p0 = cur[cur.length - 1];
      const mx = (p0.x + 3 * x1 + 3 * x2 + x) / 8;
      const my = (p0.y + 3 * y1 + 3 * y2 + y) / 8;
      cur.push({ x: (p0.x + 3 * x1) / 4, y: (p0.y + 3 * y1) / 4, on: false }, { x: mx, y: my, on: true }, { x: (3 * x2 + x) / 4, y: (3 * y2 + y) / 4, on: false }, { x, y, on: true });
    }
  }
  // A closed contour repeats its start point: drop the duplicate.
  for (const ct of contours) {
    const a = ct[0];
    const b = ct[ct.length - 1];
    if (ct.length > 1 && b.on && Math.round(a.x) === Math.round(b.x) && Math.round(a.y) === Math.round(b.y)) ct.pop();
  }
  const pts = contours.flat().map((p) => ({ x: Math.round(p.x), y: Math.round(p.y), on: p.on }));
  if (!pts.length) return { data: new Uint8Array(0), xMin: 0, yMin: 0, xMax: 0, yMax: 0, points: 0, contours: 0 };
  const xMin = Math.min(...pts.map((p) => p.x));
  const yMin = Math.min(...pts.map((p) => p.y));
  const xMax = Math.max(...pts.map((p) => p.x));
  const yMax = Math.max(...pts.map((p) => p.y));
  const w = new Writer(64 + pts.length * 6);
  w.i16(contours.length); w.i16(xMin); w.i16(yMin); w.i16(xMax); w.i16(yMax);
  let end = -1;
  for (const ct of contours) { end += ct.length; w.u16(end); }
  w.u16(0); // no instructions
  for (const p of pts) w.u8(p.on ? 1 : 0);
  let lx = 0;
  for (const p of pts) { w.i16(p.x - lx); lx = p.x; }
  let ly = 0;
  for (const p of pts) { w.i16(p.y - ly); ly = p.y; }
  return { data: w.out(), xMin, yMin, xMax, yMax, points: pts.length, contours: contours.length };
}

/** The raw bytes of an untransformed table of the font, or null. */
function rawTable(font, tag) {
  const e = font.directory?.tables?.[tag];
  if (!e || e.transformed) return null;
  try {
    const s = font._getTableStream(tag);
    return s ? new Uint8Array(s.buffer.buffer || s.buffer, (s.buffer.byteOffset || 0) + s.pos, e.length).slice() : null;
  } catch { return null; }
}

function checksum(b) {
  const p = new Uint8Array(Math.ceil(b.length / 4) * 4);
  p.set(b);
  const v = new DataView(p.buffer);
  let s = 0;
  for (let i = 0; i < p.length; i += 4) s = (s + v.getUint32(i)) >>> 0;
  return s;
}

/** cmap with one format 4 subtable (BMP code points → new glyph ids). */
function cmapTable(map) {
  const entries = [...map].filter(([cp]) => cp < 0xffff).sort((a, b) => a[0] - b[0]);
  const segs = [];
  for (const [cp, gid] of entries) {
    const last = segs[segs.length - 1];
    if (last && cp === last.end + 1 && gid === last.gid + (cp - last.start)) last.end = cp;
    else segs.push({ start: cp, end: cp, gid });
  }
  segs.push({ start: 0xffff, end: 0xffff, gid: 0, last: true });
  const n = segs.length;
  const w = new Writer();
  w.u16(0); w.u16(1); w.u16(3); w.u16(1); w.u32(12);
  const len = 16 + n * 8;
  w.u16(4); w.u16(len); w.u16(0);
  w.u16(n * 2);
  const sr = 2 * 2 ** Math.floor(Math.log2(n));
  w.u16(sr); w.u16(Math.log2(sr / 2)); w.u16(n * 2 - sr);
  for (const s of segs) w.u16(s.end);
  w.u16(0);
  for (const s of segs) w.u16(s.start);
  for (const s of segs) w.u16(s.last ? 1 : (s.gid - s.start) & 0xffff);
  for (let i = 0; i < n; i++) w.u16(0);
  return w.out();
}

/** A minimal name table (when the font's can't be copied). */
function nameTable(family) {
  const recs = [[1, family], [2, 'Regular'], [4, family], [6, family.replace(/[^A-Za-z0-9-]/g, '')]];
  const str = recs.map(([, s]) => { const b = new Uint8Array(s.length * 2); for (let i = 0; i < s.length; i++) { b[i * 2] = s.charCodeAt(i) >> 8; b[i * 2 + 1] = s.charCodeAt(i) & 255; } return b; });
  const w = new Writer();
  w.u16(0); w.u16(recs.length); w.u16(6 + recs.length * 12);
  let off = 0;
  recs.forEach(([id], i) => { w.u16(3); w.u16(1); w.u16(0x409); w.u16(id); w.u16(str[i].length); w.u16(off); off += str[i].length; });
  for (const s of str) w.bytes(s);
  return w.out();
}

export function subsetTtf(font, gids, cmap = new Map()) {
  const order = [0, ...[...new Set(gids)].filter((g) => g !== 0).sort((a, b) => a - b)];
  const newGid = new Map(order.map((g, i) => [g, i]));
  const glyphs = order.map((g) => {
    const glyph = font.getGlyph(g);
    let enc;
    try { enc = encodeGlyph(glyph.path); } catch { enc = encodeGlyph({ commands: [] }); }
    return { ...enc, advance: Math.round(glyph.advanceWidth || 0) };
  });
  // glyf + loca (long offsets).
  const glyf = new Writer(4096);
  const loca = new Writer();
  for (const g of glyphs) { loca.u32(glyf.pos); glyf.bytes(g.data); glyf.pad4(); }
  loca.u32(glyf.pos);
  const nonEmpty = glyphs.filter((g) => g.points);
  const bbox = nonEmpty.length ? [Math.min(...nonEmpty.map((g) => g.xMin)), Math.min(...nonEmpty.map((g) => g.yMin)), Math.max(...nonEmpty.map((g) => g.xMax)), Math.max(...nonEmpty.map((g) => g.yMax))] : [0, 0, 0, 0];
  const upm = font.unitsPerEm;
  const head = new Writer();
  head.u32(0x00010000); head.u32(font.head?.fontRevision ? Math.round(font.head.fontRevision * 65536) : 0x00010000); head.u32(0); head.u32(0x5f0f3cf5);
  head.u16(font.head?.flags ? (typeof font.head.flags === 'number' ? font.head.flags : 0x000b) : 0x000b); head.u16(upm);
  head.u32(0); head.u32(0); head.u32(0); head.u32(0); // created / modified
  for (const v of bbox) head.i16(v);
  const ms = font.head?.macStyle;
  head.u16(typeof ms === 'number' ? ms : (ms?.bold ? 1 : 0) | (ms?.italic ? 2 : 0)); head.u16(font.head?.lowestRecPPEM || 8); head.i16(2); head.i16(1); head.i16(0);
  // The font's own head (revision, flags, style, dates) with this subset's bounds and long loca offsets.
  const headBytes = () => {
    const raw = rawTable(font, 'head');
    if (!raw || raw.length < 54) return head.out();
    const hv = new DataView(raw.buffer, raw.byteOffset, raw.length);
    hv.setUint32(8, 0);
    hv.setUint16(16, hv.getUint16(16) & ~0x0800); // not "processed by a WOFF2 transform"
    bbox.forEach((x, i) => hv.setInt16(36 + i * 2, x));
    hv.setInt16(50, 1);
    return raw;
  };
  const hm = new Writer();
  for (const g of glyphs) { hm.u16(g.advance); hm.i16(g.points ? g.xMin : 0); }
  const hhea = new Writer();
  hhea.u32(0x00010000); hhea.i16(font.hhea?.ascent ?? font.ascent); hhea.i16(font.hhea?.descent ?? font.descent); hhea.i16(font.hhea?.lineGap ?? 0);
  hhea.u16(Math.max(...glyphs.map((g) => g.advance))); hhea.i16(Math.min(0, ...nonEmpty.map((g) => g.xMin)));
  hhea.i16(Math.min(0, ...nonEmpty.map((g) => g.advance - g.xMax))); hhea.i16(Math.max(0, ...nonEmpty.map((g) => g.xMax)));
  hhea.i16(1); hhea.i16(0); hhea.i16(0); for (let i = 0; i < 5; i++) hhea.i16(0); hhea.u16(glyphs.length);
  const maxp = new Writer();
  maxp.u32(0x00010000); maxp.u16(glyphs.length); maxp.u16(Math.max(0, ...glyphs.map((g) => g.points))); maxp.u16(Math.max(0, ...glyphs.map((g) => g.contours)));
  maxp.u16(0); maxp.u16(0); maxp.u16(2); for (let i = 0; i < 8; i++) maxp.u16(0);
  const post = new Writer();
  post.u32(0x00030000); post.i32(Math.round((font.italicAngle || 0) * 65536)); post.i16(font.underlinePosition ?? -100); post.i16(font.underlineThickness ?? 50); post.u32(font.post?.isFixedPitch ? 1 : 0); post.u32(0); post.u32(0); post.u32(0); post.u32(0);
  const cm = new Map();
  for (const [cp, g] of cmap) if (newGid.has(g)) cm.set(cp, newGid.get(g));
  const tables = {
    'OS/2': rawTable(font, 'OS/2'), cmap: cmapTable(cm), glyf: glyf.out(), head: headBytes(), hhea: hhea.out(), hmtx: hm.out(), loca: loca.out(), maxp: maxp.out(),
    name: rawTable(font, 'name') || nameTable(font.familyName || 'Font'), post: post.out(),
  };
  const tags = Object.keys(tables).filter((t) => tables[t]).sort();
  const n = tags.length;
  const out = new Writer(1024 + Object.values(tables).reduce((a, t) => a + (t ? t.length + 4 : 0), 0));
  const sr = 16 * 2 ** Math.floor(Math.log2(n));
  out.u32(0x00010000); out.u16(n); out.u16(sr); out.u16(Math.floor(Math.log2(n))); out.u16(n * 16 - sr);
  let off = 12 + n * 16;
  const dirPos = out.pos;
  for (const t of tags) { out.u32(0); out.u32(0); out.u32(0); out.u32(0); }
  const offsets = {};
  for (const t of tags) { offsets[t] = out.pos; out.bytes(tables[t]); out.pad4(); }
  void off;
  const bytes = out.out();
  const v = new DataView(bytes.buffer);
  tags.forEach((t, i) => {
    const p = dirPos + i * 16;
    for (let k = 0; k < 4; k++) v.setUint8(p + k, t.charCodeAt(k));
    v.setUint32(p + 4, checksum(tables[t]));
    v.setUint32(p + 8, offsets[t]);
    v.setUint32(p + 12, tables[t].length);
  });
  // checkSumAdjustment in head.
  v.setUint32(offsets.head + 8, (0xb1b0afba - checksum(bytes)) >>> 0);
  return { bytes, newGid };
}
