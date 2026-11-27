/**
 * XPS Document (Microsoft XPS 1.0, what Word's "XPS Document" writes; not
 * OpenXPS) from the fixed page model (display-list.js).
 *
 *   [Content_Types].xml, _rels/.rels → FixedDocumentSequence.fdseq →
 *   Documents/1/FixedDocument.fdoc → Documents/1/Pages/N.fpage (+ rels)
 *   Documents/1/Resources/Fonts/{GUID}.odttf  subset fonts, obfuscated (the
 *     first 32 bytes XORed with the GUID key)
 *   Documents/1/Resources/Images/N.png|jpg
 *   Documents/1/Structure/DocStructure.struct  the outline from headings
 *   docProps/core.xml
 *
 * Text is <Glyphs> with the glyph ids and advances (1/100 em) of every
 * character, so it lines up with the page as shown; graphics are <Path>s.
 * XPS units are 1/96 inch: the page model's CSS pixels.
 */
import { zipSync, strToU8 } from 'fflate';
import { jpegInfo } from './images.js';

const NS = 'http://schemas.microsoft.com/xps/2005/06';
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v) => { const s = (Math.round(v * 1000) / 1000).toString(); return s === '-0' ? '0' : s; };
const argb = (hex, a = 1) => `#${Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0').toUpperCase()}${String(hex || '#000000').slice(1).toUpperCase()}`;

function guid(seed) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const r = crypto.getRandomValues(new Uint8Array(16));
  r[0] = h & 255; r[1] = (h >> 8) & 255;
  r[6] = (r[6] & 0x0f) | 0x40; r[8] = (r[8] & 0x3f) | 0x80;
  const hx = [...r].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `${hx.slice(0, 8)}-${hx.slice(8, 12)}-${hx.slice(12, 16)}-${hx.slice(16, 20)}-${hx.slice(20)}`;
}

/** XPS font obfuscation: the first 32 bytes XORed with the GUID's bytes, last first. */
export function obfuscateFont(bytes, g) {
  const s = g.replace(/-/g, '');
  const key = [];
  for (let i = 0; i < 16; i++) key.push(parseInt(s.substr(30 - i * 2, 2), 16));
  const out = bytes.slice();
  for (let i = 0; i < 32 && i < out.length; i++) out[i] ^= key[i % 16];
  return out;
}

/** A picture's size in 1/96 inch (from its resolution). */
function size96(im) {
  let dpiX = 96; let dpiY = 96; let w = im.width; let h = im.height;
  const b = im.bytes;
  if (im.mime === 'image/png') {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    w = dv.getUint32(16); h = dv.getUint32(20);
    for (let p = 8; p + 8 < b.length;) {
      const len = dv.getUint32(p);
      const type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
      if (type === 'pHYs' && b[p + 16] === 1) { dpiX = dv.getUint32(p + 8) * 0.0254; dpiY = dv.getUint32(p + 12) * 0.0254; }
      if (type === 'IDAT') break;
      p += 12 + len;
    }
  } else if (im.mime === 'image/jpeg') {
    const j = jpegInfo(b);
    if (j) { w = j.width; h = j.height; }
    if (b[6] === 0x4a && b[7] === 0x46 && b[13] === 1) { dpiX = (b[14] << 8) | b[15]; dpiY = (b[16] << 8) | b[17]; }
  }
  if (!(dpiX > 1) || !(dpiY > 1)) { dpiX = 96; dpiY = 96; }
  return { w: (w * 96) / dpiX, h: (h * 96) / dpiY };
}

export async function writeXps(pages, o) {
  const files = {};
  const D = 'Documents/1';
  // Fonts.
  const fontUri = new Map();
  for (const face of o.fonts.faces.values()) {
    if (!face.cmap.size) continue;
    const sub = face.subset();
    const g = guid(face.key);
    const path = `${D}/Resources/Fonts/${g}.odttf`;
    files[path] = obfuscateFont(sub.bytes, g);
    fontUri.set(face.key, { uri: `/${path}`, face, sub });
  }
  // Pictures.
  const imgUri = new Map();
  for (const im of o.images.list) {
    if (!im.bytes) continue;
    const ext = im.mime === 'image/jpeg' ? 'jpg' : 'png';
    const path = `${D}/Resources/Images/${im.key + 1}.${ext}`;
    files[path] = im.bytes;
    imgUri.set(im.key, { uri: `/${path}`, ...size96(im) });
  }
  const outline = [];
  const fdoc = [];
  const targets = new Map(); // page index → [names]
  const nameFor = (pi, y, prefix) => { const nm = `${prefix}${pi + 1}_${Math.round(y)}`; if (!targets.has(pi)) targets.set(pi, new Set()); targets.get(pi).add(nm); return nm; };
  pages.forEach((page, pi) => {
    const used = new Set();
    const body = [];
    let pendingRaster = null;
    const flushRaster = () => {
      const r = pendingRaster;
      pendingRaster = null;
      if (!r) return;
      const text = r.chars.map((c) => c.ch).join('');
      const idx = r.chars.map((c, k) => { const next = r.chars[k + 1]; const adv = next ? next.x - c.x : c.w; return `${[...c.ch].length === 1 && c.ch.length > 1 ? `(${c.ch.length}:1)` : ''}0,${n((adv / r.size) * 100)}`; });
      r.sink[r.at] = `<Glyphs Fill="#00000000" FontUri="${r.fr.uri}" FontRenderingEmSize="${n(r.size)}" OriginX="${n(r.chars[0].x)}" OriginY="${n(r.baseline)}" UnicodeString="${esc(text.startsWith('{') ? `{}${text}` : text)}" Indices="${idx.join(';')}"/>`;
    };
    const emit = (items, sink) => {
      for (const it of items) {
        if (it.t === 'group') { const inner = []; emit(it.items, inner); flushRaster(); sink.push(`<Canvas RenderTransform="${it.matrix.map(n).join(',')}">${inner.join('')}</Canvas>`); } else if (it.t === 'rect') {
          sink.push(`<Path Fill="${argb(it.fill, it.alpha ?? 1)}" Data="M ${n(it.x)},${n(it.y)} L ${n(it.x + it.w)},${n(it.y)} ${n(it.x + it.w)},${n(it.y + it.h)} ${n(it.x)},${n(it.y + it.h)} Z"/>`);
        } else if (it.t === 'line') {
          const dash = it.dash ? ` StrokeDashArray="${it.dash.map((v) => n(v / it.width)).join(' ')}"` : '';
          sink.push(`<Path Stroke="${argb(it.color)}" StrokeThickness="${n(it.width)}"${dash} Data="M ${n(it.x1)},${n(it.y1)} L ${n(it.x2)},${n(it.y2)}"/>`);
        } else if (it.t === 'path') {
          const d = `${it.fill && !it.evenOdd ? 'F 1 ' : ''}${it.d.map((s) => (s[0] === 'Z' ? 'Z' : `${s[0]} ${s.slice(1).reduce((a, v, i) => a + (i % 2 ? `,${n(v)}` : `${i ? ' ' : ''}${n(v)}`), '')}`)).join(' ')}`;
          const fill = it.fill ? ` Fill="${argb(it.fill, it.fillAlpha ?? 1)}"` : '';
          const stroke = it.stroke ? ` Stroke="${argb(it.stroke, it.strokeAlpha ?? 1)}" StrokeThickness="${n(it.width)}"${it.dash ? ` StrokeDashArray="${it.dash.map((v) => n(v / it.width)).join(' ')}"` : ''}${it.cap === 'round' ? ' StrokeStartLineCap="Round" StrokeEndLineCap="Round"' : ''}${it.join === 'round' ? ' StrokeLineJoin="Round"' : ''}` : '';
          sink.push(`<Path${fill}${stroke} Data="${d}"/>`);
        } else if (it.t === 'image') {
          const im = imgUri.get(it.image);
          if (!im) continue;
          used.add(im.uri);
          sink.push(`<Path${it.alpha != null && it.alpha < 0.999 ? ` Opacity="${n(it.alpha)}"` : ''} Data="M ${n(it.x)},${n(it.y)} L ${n(it.x + it.w)},${n(it.y)} ${n(it.x + it.w)},${n(it.y + it.h)} ${n(it.x)},${n(it.y + it.h)} Z"${it.alt ? ` AutomationProperties.Name="${esc(it.alt)}"` : ''}><Path.Fill><ImageBrush ImageSource="${im.uri}" Viewbox="0,0,${n(im.w)},${n(im.h)}" ViewboxUnits="Absolute" Viewport="${n(it.x)},${n(it.y)},${n(it.w)},${n(it.h)}" ViewportUnits="Absolute" TileMode="None"/></Path.Fill></Path>`);
          // A character drawn as a picture: its text, invisible, for searching and copying.
          // Neighbours on the same line share one run, so the text reads as a word.
          const fr = it.actualText ? fontUri.get(it.face) : null;
          if (fr) {
            used.add(fr.uri);
            const last = pendingRaster;
            if (last && last.sink === sink && last.fr === fr && last.size === it.size && Math.abs(last.baseline - it.baseline) < 0.5 && Math.abs(last.end - it.x) < 1) {
              last.chars.push({ ch: it.actualText, x: it.x, w: it.w });
              last.end = it.x + it.w;
            } else {
              flushRaster();
              pendingRaster = { sink, fr, size: it.size, baseline: it.baseline, end: it.x + it.w, at: sink.length, chars: [{ ch: it.actualText, x: it.x, w: it.w }] };
              sink.push('');
            }
          }
        } else if (it.t === 'text') {
          const fr = fontUri.get(it.face);
          if (!fr || !it.glyphs.length) continue;
          used.add(fr.uri);
          const upm = fr.face.metrics.upm;
          const em = it.size;
          let uni = '';
          const idx = [];
          it.glyphs.forEach((g, i) => {
            const cid = fr.sub.newGid.get(g.gid) ?? 0;
            const next = it.glyphs[i + 1];
            const adv = next ? ((next.x - g.x) / em) * 100 : ((fr.sub.widths.get(cid) || 0) / upm) * 100;
            uni += g.ch;
            idx.push(`${g.ch.length > 1 ? `(${g.ch.length}:1)` : ''}${cid},${n(adv)}`);
          });
          const sim = fr.face.synthBold && fr.face.synthItalic ? ' StyleSimulations="BoldItalicSimulation"' : fr.face.synthBold ? ' StyleSimulations="BoldSimulation"' : fr.face.synthItalic ? ' StyleSimulations="ItalicSimulation"' : '';
          if (it.outline && !it.invisible) {
            // Outlined text: XPS Glyphs only fill, so the outlines become stroked paths (the text stays in the invisible Glyphs below).
            const k = em / upm;
            for (const g of it.glyphs) {
              let d = '';
              try { d = glyphPathData(fr.face.font.getGlyph(g.gid).path); } catch { d = ''; }
              if (d) sink.push(`<Path RenderTransform="${n(k)},0,0,${n(-k)},${n(g.x)},${n(it.y)}" Data="F 1 ${d}" Stroke="${argb(it.color, it.alpha ?? 1)}" StrokeThickness="${n(it.outline / k)}"/>`);
            }
          }
          const text = uni.startsWith('{') ? `{}${uni}` : uni;
          sink.push(`<Glyphs Fill="${argb(it.color, it.invisible || it.outline ? 0 : it.alpha ?? 1)}" FontUri="${fr.uri}" FontRenderingEmSize="${n(em)}" OriginX="${n(it.glyphs[0].x)}" OriginY="${n(it.y)}"${sim} UnicodeString="${esc(text)}" Indices="${idx.join(';')}"/>`);
        }
      }
    };
    emit(page.items, body);
    flushRaster();
    // Links: a transparent area that navigates.
    for (const a of page.annots) {
      if (a.t !== 'link') continue;
      let uri = null;
      if (/^#/.test(a.href)) { const d = o.resolveDest?.(a.href); if (d) uri = `../FixedDocument.fdoc#${nameFor(d.page, d.y, 'l')}`; } else if (/^[a-z][\w+.-]*:/i.test(a.href)) uri = a.href;
      if (uri) body.push(`<Path Fill="#00FFFFFF" FixedPage.NavigateUri="${esc(uri)}" Data="M ${n(a.x)},${n(a.y)} L ${n(a.x + a.w)},${n(a.y)} ${n(a.x + a.w)},${n(a.y + a.h)} ${n(a.x)},${n(a.y + a.h)} Z"/>`);
    }
    for (const h of page.outline) outline.push({ level: h.level, title: h.title, target: nameFor(pi, h.y, 'h') });
    page._body = body;
    page._used = used;
  });
  pages.forEach((page, pi) => {
    // Named elements for outline entries and link targets.
    const named = [...(targets.get(pi) || [])].map((nm) => { const y = Number(nm.split('_').pop()); return `<Canvas Name="${nm}" RenderTransform="1,0,0,1,0,${y}"/>`; }).join('');
    const path = `${D}/Pages/${pi + 1}.fpage`;
    files[path] = strToU8(`<FixedPage xmlns="${NS}" xmlns:x="http://schemas.microsoft.com/xps/2005/06/resourcedictionary-key" Width="${n(page.width)}" Height="${n(page.height)}" xml:lang="${esc(o.meta?.lang || 'en-GB')}">${named}${page._body.join('')}</FixedPage>`);
    files[`${D}/Pages/_rels/${pi + 1}.fpage.rels`] = strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${[...page._used].map((u, i) => `<Relationship Type="http://schemas.microsoft.com/xps/2005/06/required-resource" Target="${esc(u)}" Id="R${i + 1}"/>`).join('')}</Relationships>`);
    const t = targets.get(pi);
    fdoc.push(`<PageContent Source="/${path}" Width="${n(page.width)}" Height="${n(page.height)}">${t?.size ? `<PageContent.LinkTargets>${[...t].map((nm) => `<LinkTarget Name="${nm}"/>`).join('')}</PageContent.LinkTargets>` : ''}</PageContent>`);
  });
  files[`${D}/FixedDocument.fdoc`] = strToU8(`<FixedDocument xmlns="${NS}">${fdoc.join('')}</FixedDocument>`);
  if (outline.length) {
    files[`${D}/Structure/DocStructure.struct`] = strToU8(`<DocumentStructure xmlns="http://schemas.microsoft.com/xps/2005/06/documentstructure"><DocumentStructure.Outline><DocumentOutline xml:lang="${esc(o.meta?.lang || 'en-GB')}">${outline.map((e) => `<OutlineEntry OutlineLevel="${e.level}" OutlineTarget="../FixedDocument.fdoc#${e.target}" Description="${esc(e.title)}"/>`).join('')}</DocumentOutline></DocumentStructure.Outline></DocumentStructure>`);
    files[`${D}/_rels/FixedDocument.fdoc.rels`] = strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Type="http://schemas.microsoft.com/xps/2005/06/documentstructure" Target="Structure/DocStructure.struct" Id="R1"/></Relationships>');
  }
  files['FixedDocumentSequence.fdseq'] = strToU8(`<FixedDocumentSequence xmlns="${NS}"><DocumentReference Source="/${D}/FixedDocument.fdoc"/></FixedDocumentSequence>`);
  const m = o.meta || {};
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  files['docProps/core.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?><coreProperties xmlns="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${m.title ? `<dc:title>${esc(m.title)}</dc:title>` : ''}${m.author ? `<dc:creator>${esc(m.author)}</dc:creator>` : ''}${m.subject ? `<dc:subject>${esc(m.subject)}</dc:subject>` : ''}${m.keywords ? `<keywords>${esc(m.keywords)}</keywords>` : ''}<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></coreProperties>`);
  files['_rels/.rels'] = strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Type="http://schemas.microsoft.com/xps/2005/06/fixedrepresentation" Target="/FixedDocumentSequence.fdseq" Id="R0"/><Relationship Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="/docProps/core.xml" Id="R1"/></Relationships>');
  const ct = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="fdseq" ContentType="application/vnd.ms-package.xps-fixeddocumentsequence+xml"/><Default Extension="fdoc" ContentType="application/vnd.ms-package.xps-fixeddocument+xml"/><Default Extension="fpage" ContentType="application/vnd.ms-package.xps-fixedpage+xml"/><Default Extension="odttf" ContentType="application/vnd.ms-package.obfuscated-opentype"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="struct" ContentType="application/vnd.ms-package.xps-documentstructure+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
  // [Content_Types].xml first, as XPS consumers expect.
  return zipSync({ '[Content_Types].xml': strToU8(ct), ...files }, { level: 6 });
}

/** A glyph outline (fontkit path, font units) in XPS path syntax: points as x,y pairs. */
function glyphPathData(path) {
  const k = { moveTo: 'M', lineTo: 'L', quadraticCurveTo: 'Q', bezierCurveTo: 'C', closePath: 'Z' };
  let d = '';
  for (const c of path.commands) {
    const a = c.args.map((v) => +v.toFixed(2));
    const pts = [];
    for (let i = 0; i < a.length; i += 2) pts.push(`${a[i]},${a[i + 1]}`);
    d += `${k[c.command] || ''}${pts.length ? ` ${pts.join(' ')} ` : ' '}`;
  }
  return d.trim();
}
