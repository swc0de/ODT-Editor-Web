/**
 * PDF 1.7 from the fixed page model (display-list.js).
 *
 *   fonts    Type 0 / CIDFontType2, subset TrueType (FontFile2), Identity-H,
 *            widths, ToUnicode (text is searchable and copyable); synthetic
 *            bold (fill + stroke) and italic (skew) where the face is missing
 *   text     every glyph at its measured position (TJ adjustments)
 *   graphics rectangles, lines, vector paths, opacity (ExtGState)
 *   pictures JPEG as is (DCTDecode); others as Flate RGB with a soft mask
 *   outline  bookmarks from headings; link annotations (URI and GoTo);
 *            comments as note annotations ("Document showing markup")
 *   metadata Info dictionary and XMP
 *   tagged   structure tree (headings, paragraphs, lists, tables, figures
 *            with alt text) in reading order; headers / footers as artifacts
 *   PDF/A-2b sRGB output intent, XMP identification, embedded fonts,
 *            annotation appearance and print flags, document ID
 */
import { zlibSync, strToU8 } from 'fflate';
import { srgbIcc } from './icc.js';

const PT = 0.75; // CSS px → pt

// ------------------------------------------------------------ objects

class Ref { constructor(n) { this.n = n; } }
class Name { constructor(s) { this.s = s; } }
class Raw { constructor(s) { this.s = s; } }
const N = (s) => new Name(s);

const num = (v) => { if (!Number.isFinite(v)) return '0'; const s = (Math.round(v * 1000) / 1000).toString(); return s.includes('e') ? v.toFixed(6) : s; };
const nameStr = (s) => `/${String(s).replace(/[^!-~]|[#()<>[\]{}/%]/g, (c) => `#${c.charCodeAt(0).toString(16).padStart(2, '0')}`)}`;
/** A text string: literal for ASCII, UTF-16BE with a byte order mark otherwise. */
export function pdfString(s) {
  s = String(s ?? '');
  if (/^[\x20-\x7e]*$/.test(s)) return `(${s.replace(/[\\()]/g, '\\$&')})`;
  let h = 'FEFF';
  for (let i = 0; i < s.length; i++) h += s.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  return `<${h}>`;
}
class Str { constructor(s) { this.s = s; } }

function ser(v) {
  if (v instanceof Ref) return `${v.n} 0 R`;
  if (v instanceof Name) return nameStr(v.s);
  if (v instanceof Raw) return v.s;
  if (v instanceof Str) return pdfString(v.s);
  if (typeof v === 'number') return num(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v == null) return 'null';
  if (typeof v === 'string') return pdfString(v);
  if (Array.isArray(v)) return `[${v.map(ser).join(' ')}]`;
  return `<<${Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => `${nameStr(k)} ${ser(x)}`).join(' ')}>>`;
}

class PdfFile {
  constructor() { this.objs = [null]; }
  alloc() { this.objs.push(undefined); return new Ref(this.objs.length - 1); }
  set(ref, value) { this.objs[ref.n] = { value }; return ref; }
  add(value) { return this.set(this.alloc(), value); }
  stream(dict, data, { compress = true } = {}) {
    let bytes = typeof data === 'string' ? strToU8(data) : data;
    const d = { ...dict };
    if (compress && !d.Filter) { bytes = zlibSync(bytes, { level: 6 }); d.Filter = N('FlateDecode'); }
    d.Length = bytes.length;
    const ref = this.alloc();
    this.objs[ref.n] = { value: d, stream: bytes };
    return ref;
  }
  bytes(trailer) {
    const parts = [];
    let size = 0;
    const push = (x) => { const b = typeof x === 'string' ? strToU8(x) : x; parts.push(b); size += b.length; };
    // The header's comment line has binary bytes (> 127), as the specification recommends.
    push(Uint8Array.from([...'%PDF-1.7\n%'].map((c) => c.charCodeAt(0)).concat([0xe2, 0xe3, 0xcf, 0xd3, 0x0a])));
    const offsets = [];
    for (let i = 1; i < this.objs.length; i++) {
      offsets[i] = size;
      const o = this.objs[i] || { value: null };
      push(`${i} 0 obj\n${ser(o.value)}\n`);
      if (o.stream) { push('stream\n'); push(o.stream); push('\nendstream\n'); }
      push('endobj\n');
    }
    const xref = size;
    let x = `xref\n0 ${this.objs.length}\n0000000000 65535 f \n`;
    for (let i = 1; i < this.objs.length; i++) x += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    push(x);
    push(`trailer\n${ser({ Size: this.objs.length, ...trailer })}\nstartxref\n${xref}\n%%EOF\n`);
    const out = new Uint8Array(size);
    let p = 0;
    for (const b of parts) { out.set(b, p); p += b.length; }
    return out;
  }
}

// ------------------------------------------------------------ helpers

const rgb = (hex) => { const n = parseInt(String(hex || '#000000').slice(1), 16) || 0; return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map((v) => num(v)).join(' '); };
const pdfDate = (d = new Date()) => { const p = (n) => String(n).padStart(2, '0'); return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`; };
const isoDate = (d = new Date()) => d.toISOString().replace(/\.\d+Z$/, 'Z');
const xmlEsc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const hex4 = (n) => n.toString(16).toUpperCase().padStart(4, '0');
const subsetTag = (key) => { let h = 0; for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0; let s = ''; for (let i = 0; i < 6; i++) { s += String.fromCharCode(65 + (h % 26)); h = Math.floor(h / 26) + i * 7; } return s; };

function toUnicodeCMap(face, sub) {
  const pairs = [];
  const seen = new Set();
  for (const [cp, gid] of face.cmap) {
    const cid = sub.newGid.get(gid);
    if (cid == null || seen.has(cid)) continue;
    seen.add(cid);
    const s = String.fromCodePoint(cp);
    let u = '';
    for (let i = 0; i < s.length; i++) u += hex4(s.charCodeAt(i));
    pairs.push(`<${hex4(cid)}> <${u}>`);
  }
  const chunks = [];
  for (let i = 0; i < pairs.length; i += 100) chunks.push(`${Math.min(100, pairs.length - i)} beginbfchar\n${pairs.slice(i, i + 100).join('\n')}\nendbfchar`);
  return `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${chunks.join('\n')}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n`;
}

// Structure tags of the editor's elements.
export function structTagOf(el) {
  const n = el.localName;
  if (/^h[1-6]$/.test(n)) return n.toUpperCase();
  if (n === 'p') return el.closest('li') ? 'LBody' : 'P';
  return { li: 'LI', ul: 'L', ol: 'L', table: 'Table', tr: 'TR', td: 'TD', th: 'TH', img: 'Figure' }[n] || null;
}

// ------------------------------------------------------------ writer

/**
 * @param {Array} pages display-list pages
 * @param {object} o { fonts: FontBook, images: ImageBook, meta: { title, author, subject, keywords, lang }, producer,
 *   bookmarks, properties, tagged, pdfa, minimumSize, resolveDest(href) → { page, y } | null }
 */
export async function writePdf(pages, o) {
  const f = new PdfFile();
  const catalog = f.alloc();
  const pagesRef = f.alloc();
  const pageRefs = pages.map(() => f.alloc());
  const tagged = !!(o.tagged || o.pdfa);
  // Fonts (subset after the pages registered every glyph).
  const fontRefs = new Map();
  let fi = 0;
  for (const face of o.fonts.faces.values()) {
    if (!face.cmap.size) continue;
    const sub = face.subset();
    const upm = face.metrics.upm;
    const k = 1000 / upm;
    const tag = `${subsetTag(face.key)}+${face.postscriptName || 'Font'}`;
    const file = f.stream({ Length1: sub.bytes.length }, sub.bytes);
    const bb = face.metrics.bbox || { minX: 0, minY: face.metrics.descent, maxX: upm, maxY: face.metrics.ascent };
    const desc = f.add({
      Type: N('FontDescriptor'), FontName: N(tag), Flags: 32 + (face.italic || face.synthItalic ? 64 : 0),
      FontBBox: [bb.minX * k, bb.minY * k, bb.maxX * k, bb.maxY * k], ItalicAngle: face.metrics.italicAngle || 0,
      Ascent: face.metrics.ascent * k, Descent: face.metrics.descent * k, CapHeight: face.metrics.capHeight * k, StemV: face.bold || face.synthBold ? 120 : 80, FontFile2: file,
    });
    const W = [];
    for (const [cid, w] of [...sub.widths].sort((a, b) => a[0] - b[0])) W.push(cid, [Math.round(w * k)]);
    const cid = f.add({ Type: N('Font'), Subtype: N('CIDFontType2'), BaseFont: N(tag), CIDSystemInfo: { Registry: new Str('Adobe'), Ordering: new Str('Identity'), Supplement: 0 }, FontDescriptor: desc, DW: 1000, W, CIDToGIDMap: N('Identity') });
    const tu = f.stream({}, toUnicodeCMap(face, sub));
    const ref = f.add({ Type: N('Font'), Subtype: N('Type0'), BaseFont: N(tag), Encoding: N('Identity-H'), DescendantFonts: [cid], ToUnicode: tu });
    fontRefs.set(face.key, { name: `F${++fi}`, ref, face, sub });
  }
  // Pictures.
  const imageRefs = new Map();
  const imgSizes = new Map(); // key → largest drawn size (pt), for Minimum size
  for (const p of pages) for (const it of flat(p.items)) if (it.t === 'image') { const s = imgSizes.get(it.image) || { w: 0, h: 0 }; imgSizes.set(it.image, { w: Math.max(s.w, it.w * PT), h: Math.max(s.h, it.h * PT) }); }
  for (const im of o.images.list) {
    if (!imgSizes.has(im.key) || !im.bytes) continue;
    const drawn = imgSizes.get(im.key);
    const max = o.minimumSize ? { w: Math.max(1, Math.round((drawn.w / 72) * 150)), h: Math.max(1, Math.round((drawn.h / 72) * 150)) } : null;
    let ref;
    if (im.mime === 'image/jpeg' && im.width) {
      const scaled = max ? await o.images.jpegScaled(im, max) : null;
      const j = scaled || im;
      ref = f.stream({ Type: N('XObject'), Subtype: N('Image'), Width: j.width, Height: j.height, ColorSpace: N(j.components === 1 ? 'DeviceGray' : j.components === 4 ? 'DeviceCMYK' : 'DeviceRGB'), BitsPerComponent: 8, Filter: N('DCTDecode'), ...(j.components === 4 ? { Decode: [1, 0, 1, 0, 1, 0, 1, 0] } : {}) }, scaled ? scaled.bytes : im.bytes, { compress: false });
    } else {
      const px = await o.images.pixels(im, max);
      const smask = px.alpha ? f.stream({ Type: N('XObject'), Subtype: N('Image'), Width: px.width, Height: px.height, ColorSpace: N('DeviceGray'), BitsPerComponent: 8 }, px.alpha) : undefined;
      ref = f.stream({ Type: N('XObject'), Subtype: N('Image'), Width: px.width, Height: px.height, ColorSpace: N('DeviceRGB'), BitsPerComponent: 8, SMask: smask }, px.rgb);
    }
    imageRefs.set(im.key, { name: `Im${imageRefs.size + 1}`, ref });
  }
  // Structure tree.
  const structRoot = tagged ? f.alloc() : null;
  const docElem = tagged ? f.alloc() : null;
  const elems = new Map(); // struct node → { ref, kids: [], node }
  const parentTree = [];
  const elemOf = (node) => {
    if (!node) return null;
    if (elems.has(node)) return elems.get(node);
    const parent = node.parent ? elemOf(node.parent) : null;
    const e = { ref: f.alloc(), kids: [], node, parent };
    elems.set(node, e);
    (parent ? parent.kids : docKids).push({ elem: e });
    return e;
  };
  const docKids = [];
  // Annotation appearance (PDF/A: every annotation has one).
  const noteAp = f.stream({ Type: N('XObject'), Subtype: N('Form'), BBox: [0, 0, 14, 14], Resources: {} }, '1 0.85 0.2 rg 0 0 14 14 re f 0.5 0.4 0 RG 1 w 0.5 0.5 13 13 re S');

  const outlineItems = [];
  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];
    const W = page.width * PT;
    const H = page.height * PT;
    const T = (x, y) => [x * PT, H - y * PT];
    const res = { Font: {}, XObject: {}, ExtGState: {} };
    const gs = new Map();
    const alphaGs = (fa, sa = fa) => {
      const k = `${num(fa)}/${num(sa)}`;
      if (!gs.has(k)) { const nm = `GS${gs.size + 1}`; gs.set(k, nm); res.ExtGState[nm] = { Type: N('ExtGState'), ca: fa, CA: sa }; }
      return gs.get(k);
    };
    const mcids = [];
    const c = [];
    const withAlpha = (a, body) => { if (a != null && a < 0.999) { c.push(`q /${alphaGs(a)} gs`); body(); c.push('Q'); } else body(); };
    const mark = (it, body) => {
      if (!tagged) { if (it.actualText) { c.push(`/Span <</ActualText ${pdfString(it.actualText)}>> BDC`); body(); c.push('EMC'); return undefined; } return body(); }
      if (it.artifact) { c.push('/Artifact BMC'); body(); c.push('EMC'); return undefined; }
      const e = elemOf(it.struct);
      if (!e) { c.push('/Artifact BMC'); body(); c.push('EMC'); return undefined; }
      const mcid = mcids.length;
      mcids.push(e.ref);
      e.kids.push({ mcid, page: pi });
      c.push(`/${it.t === 'image' && !it.actualText ? 'Figure' : 'Span'} <</MCID ${mcid}${it.actualText ? ` /ActualText ${pdfString(it.actualText)}` : ''}>> BDC`);
      body();
      c.push('EMC');
      return undefined;
    };
    const pathOps = (d) => d.map((s) => {
      if (s[0] === 'Z') return 'h';
      const pts = [];
      for (let k = 1; k < s.length; k += 2) pts.push(...T(s[k], s[k + 1]));
      return `${pts.map(num).join(' ')} ${s[0] === 'M' ? 'm' : s[0] === 'L' ? 'l' : 'c'}`;
    }).join('\n');
    const draw = (items) => {
      for (const it of items) {
        if (it.t === 'group') {
          // cm = T · M · T⁻¹ (the CSS transform in PDF space).
          const Tm = [PT, 0, 0, -PT, 0, H];
          const Ti = [1 / PT, 0, 0, -1 / PT, 0, H / PT];
          c.push(`q ${compose(Tm, compose(it.matrix, Ti)).map(num).join(' ')} cm`);
          draw(it.items);
          c.push('Q');
        } else if (it.t === 'rect') {
          mark({ ...it, artifact: true }, () => withAlpha(it.alpha, () => { const [x, y] = T(it.x, it.y + it.h); c.push(`${rgb(it.fill)} rg ${num(x)} ${num(y)} ${num(it.w * PT)} ${num(it.h * PT)} re f`); }));
        } else if (it.t === 'line') {
          mark({ ...it, artifact: true }, () => {
            const [x1, y1] = T(it.x1, it.y1);
            const [x2, y2] = T(it.x2, it.y2);
            c.push(`${num(it.width * PT)} w ${rgb(it.color)} RG ${it.dash ? `[${it.dash.map((v) => num(v * PT)).join(' ')}] 0 d` : '[] 0 d'} ${num(x1)} ${num(y1)} m ${num(x2)} ${num(y2)} l S`);
          });
        } else if (it.t === 'path') {
          mark({ ...it, artifact: !it.struct }, () => withAlpha(it.fill ? it.fillAlpha : it.strokeAlpha, () => {
            const ops = [];
            if (it.fill) ops.push(`${rgb(it.fill)} rg`);
            if (it.stroke) ops.push(`${rgb(it.stroke)} RG ${num(it.width * PT)} w ${it.dash ? `[${it.dash.map((v) => num(v * PT)).join(' ')}] 0 d` : '[] 0 d'} ${{ round: 1, square: 2 }[it.cap] ?? 0} J ${{ round: 1, bevel: 2 }[it.join] ?? 0} j`);
            ops.push(pathOps(it.d));
            ops.push(it.fill && it.stroke ? (it.evenOdd ? 'B*' : 'B') : it.fill ? (it.evenOdd ? 'f*' : 'f') : 'S');
            c.push(ops.join('\n'));
          }));
        } else if (it.t === 'image') {
          const im = imageRefs.get(it.image);
          if (!im) continue;
          res.XObject[im.name] = im.ref;
          mark(it, () => withAlpha(it.alpha, () => { const [x, y] = T(it.x, it.y + it.h); c.push(`q ${num(it.w * PT)} 0 0 ${num(it.h * PT)} ${num(x)} ${num(y)} cm /${im.name} Do Q`);
            // A character drawn as a picture: an invisible glyph the span's ActualText replaces.
            const fr = it.actualText ? fontRefs.get(it.face) : null;
            if (fr) { res.Font[fr.name] = fr.ref; const [tx, ty] = T(it.x, it.baseline); c.push(`BT /${fr.name} ${num(it.size * PT)} Tf 3 Tr ${num(tx)} ${num(ty)} Td <0000> Tj ET`); }
          }));
          if (tagged && it.struct && it.alt && !it.actualText) { const e = elemOf(it.struct); if (e) e.alt = it.alt; }
        } else if (it.t === 'text') {
          const fr = fontRefs.get(it.face);
          if (!fr || !it.glyphs.length) continue;
          res.Font[fr.name] = fr.ref;
          const size = it.size * PT;
          const upm = fr.face.metrics.upm;
          const [x0, y0] = T(it.glyphs[0].x, it.y);
          const tj = [];
          let pen = it.glyphs[0].x * PT;
          for (const g of it.glyphs) {
            const gx = g.x * PT;
            const adj = ((gx - pen) * 1000) / size;
            if (Math.abs(adj) > 0.05) tj.push(num(-adj));
            const cidN = fr.sub.newGid.get(g.gid) ?? 0;
            tj.push(`<${hex4(cidN)}>`);
            pen = gx + ((fr.sub.widths.get(cidN) || 0) / upm) * size;
          }
          const skew = fr.face.synthItalic ? 0.2126 : 0;
          const tr = it.invisible ? '3 Tr' : it.outline ? `1 Tr ${num(it.outline * PT)} w ${rgb(it.color)} RG` : fr.face.synthBold ? `2 Tr ${num(size * 0.03)} w ${rgb(it.color)} RG` : '0 Tr';
          mark(it, () => withAlpha(it.alpha, () => c.push(`BT /${fr.name} ${num(size)} Tf ${rgb(it.color)} rg ${tr} 1 0 ${num(skew)} 1 ${num(x0)} ${num(y0)} Tm [${tj.join(' ')}] TJ ET`)));
        }
      }
    };
    draw(page.items);
    // Annotations.
    const annots = [];
    for (const a of page.annots) {
      const [x1, y2] = T(a.x, a.y);
      const [x2, y1] = T(a.x + (a.w || 0), a.y + (a.h || 0));
      if (a.t === 'link') {
        let action = null;
        if (/^#/.test(a.href)) {
          const d = o.resolveDest?.(a.href);
          if (d) action = { Dest: [pageRefs[d.page], N('XYZ'), 0, pages[d.page].height * PT - d.y * PT, 0] };
        } else if (/^[a-z][\w+.-]*:/i.test(a.href)) action = { A: { S: N('URI'), URI: new Raw(`(${a.href.replace(/[\\()]/g, '\\$&')})`) } };
        if (!action) continue;
        annots.push(f.add({ Type: N('Annot'), Subtype: N('Link'), Rect: [x1, y1, x2, y2], Border: [0, 0, 0], F: 4, ...action, ...(tagged ? { StructParent: undefined } : {}) }));
      } else if (a.t === 'note') {
        annots.push(f.add({ Type: N('Annot'), Subtype: N('Text'), Rect: [x1, y2 - 14, x1 + 14, y2], Contents: new Str(a.text), T: new Str(a.author), Name: N('Comment'), F: 4, Open: false, AP: { N: noteAp }, ...(a.date ? { M: new Str(pdfDate(new Date(`${a.date.replace(/Z?$/, 'Z')}`))) } : {}) }));
      }
    }
    const contents = f.stream({}, c.join('\n'));
    f.set(pageRefs[pi], {
      Type: N('Page'), Parent: pagesRef, MediaBox: [0, 0, W, H], Resources: res, Contents: contents,
      ...(annots.length ? { Annots: annots } : {}), ...(tagged ? { StructParents: pi, Tabs: N('S') } : {}),
      ...(o.pdfa ? {} : {}),
    });
    parentTree.push(mcids);
    for (const h of page.outline) outlineItems.push({ ...h, page: pi, top: H - h.y * PT });
  }
  f.set(pagesRef, { Type: N('Pages'), Kids: pageRefs, Count: pageRefs.length });

  // Bookmarks from headings.
  let outlines;
  if (o.bookmarks !== false && outlineItems.length) {
    outlines = f.alloc();
    const root = { kids: [], ref: outlines, level: 0 };
    const stack = [root];
    for (const h of outlineItems) {
      while (stack.length > 1 && stack[stack.length - 1].level >= h.level) stack.pop();
      const node = { ...h, kids: [], ref: f.alloc() };
      stack[stack.length - 1].kids.push(node);
      stack.push(node);
    }
    const count = (n) => n.kids.reduce((a, k) => a + 1 + count(k), 0);
    const emit = (n, parent) => {
      n.kids.forEach((k, i) => {
        f.set(k.ref, { Title: new Str(k.title), Parent: parent.ref, ...(i ? { Prev: n.kids[i - 1].ref } : {}), ...(i < n.kids.length - 1 ? { Next: n.kids[i + 1].ref } : {}), ...(k.kids.length ? { First: k.kids[0].ref, Last: k.kids[k.kids.length - 1].ref, Count: -count(k) } : {}), Dest: [pageRefs[k.page], N('XYZ'), 0, k.top, 0] });
        emit(k, k);
      });
    };
    emit(root, root);
    f.set(outlines, { Type: N('Outlines'), First: root.kids[0].ref, Last: root.kids[root.kids.length - 1].ref, Count: count(root) });
  }

  // Structure tree objects.
  if (tagged) {
    const emitElem = (e, parentRef) => {
      const K = e.kids.map((k) => (k.elem ? k.elem.ref : { Type: N('MCR'), Pg: pageRefs[k.page], MCID: k.mcid }));
      f.set(e.ref, { Type: N('StructElem'), S: N(e.node.tag), P: parentRef, K, ...(e.alt || e.node.alt ? { Alt: new Str(e.alt || e.node.alt) } : {}), ...(e.kids.find((k) => !k.elem) ? { Pg: pageRefs[e.kids.find((k) => !k.elem).page] } : {}) });
      for (const k of e.kids) if (k.elem) emitElem(k.elem, e.ref);
    };
    for (const k of docKids) emitElem(k.elem, docElem);
    f.set(docElem, { Type: N('StructElem'), S: N('Document'), P: structRoot, K: docKids.map((k) => k.elem.ref) });
    const nums = [];
    parentTree.forEach((refs, i) => nums.push(i, refs));
    f.set(structRoot, { Type: N('StructTreeRoot'), K: [docElem], ParentTree: f.add({ Nums: nums }), ParentTreeNextKey: pages.length });
  }

  // Metadata: Info and XMP.
  const m = o.meta || {};
  const now = new Date();
  const info = f.add({
    ...(o.properties !== false && m.title ? { Title: new Str(m.title) } : {}), ...(o.properties !== false && m.author ? { Author: new Str(m.author) } : {}),
    ...(o.properties !== false && m.subject ? { Subject: new Str(m.subject) } : {}), ...(o.properties !== false && m.keywords ? { Keywords: new Str(m.keywords) } : {}),
    Creator: new Str(o.producer || 'ODT Editor'), Producer: new Str(o.producer || 'ODT Editor'), CreationDate: new Str(pdfDate(now)), ModDate: new Str(pdfDate(now)),
  });
  const xmp = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/"${o.pdfa ? ' xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"' : ''}>
<dc:format>application/pdf</dc:format>
${o.properties !== false && m.title ? `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlEsc(m.title)}</rdf:li></rdf:Alt></dc:title>` : ''}
${o.properties !== false && m.author ? `<dc:creator><rdf:Seq><rdf:li>${xmlEsc(m.author)}</rdf:li></rdf:Seq></dc:creator>` : ''}
${o.properties !== false && m.subject ? `<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${xmlEsc(m.subject)}</rdf:li></rdf:Alt></dc:description>` : ''}
${o.properties !== false && m.keywords ? `<pdf:Keywords>${xmlEsc(m.keywords)}</pdf:Keywords>` : ''}
<pdf:Producer>${xmlEsc(o.producer || 'ODT Editor')}</pdf:Producer>
<xmp:CreatorTool>${xmlEsc(o.producer || 'ODT Editor')}</xmp:CreatorTool>
<xmp:CreateDate>${isoDate(now)}</xmp:CreateDate>
<xmp:ModifyDate>${isoDate(now)}</xmp:ModifyDate>
<xmp:MetadataDate>${isoDate(now)}</xmp:MetadataDate>
${o.pdfa ? '<pdfaid:part>2</pdfaid:part><pdfaid:conformance>B</pdfaid:conformance>' : ''}
</rdf:Description></rdf:RDF></x:xmpmeta>
<?xpacket end="w"?>`;
  const metadata = f.stream({ Type: N('Metadata'), Subtype: N('XML') }, strToU8(xmp), { compress: false });
  const intents = o.pdfa ? [f.add({ Type: N('OutputIntent'), S: N('GTS_PDFA1'), OutputConditionIdentifier: new Str('sRGB IEC61966-2.1'), Info: new Str('sRGB IEC61966-2.1'), DestOutputProfile: f.stream({ N: 3 }, srgbIcc()) })] : null;
  f.set(catalog, {
    Type: N('Catalog'), Pages: pagesRef, Metadata: metadata,
    ...(outlines ? { Outlines: outlines, PageMode: N('UseOutlines') } : {}),
    ...(tagged ? { StructTreeRoot: structRoot, MarkInfo: { Marked: true } } : {}),
    Lang: new Str(m.lang || 'en-GB'), ViewerPreferences: { DisplayDocTitle: !!m.title },
    ...(intents ? { OutputIntents: intents } : {}),
  });
  const id = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
  return f.bytes({ Root: catalog, Info: info, ID: [new Raw(`<${id}>`), new Raw(`<${id}>`)] });
}

/** P ∘ Q (Q applied first), PDF / DOMMatrix order [a b c d e f]. */
function compose(P, Q) {
  return [P[0] * Q[0] + P[2] * Q[1], P[1] * Q[0] + P[3] * Q[1], P[0] * Q[2] + P[2] * Q[3], P[1] * Q[2] + P[3] * Q[3], P[0] * Q[4] + P[2] * Q[5] + P[4], P[1] * Q[4] + P[3] * Q[5] + P[5]];
}

function flat(items) { const out = []; for (const it of items) { if (it.t === 'group') out.push(...flat(it.items)); else out.push(it); } return out; }
