/**
 * Importing other formats as a new document: HTML (also the route for
 * Markdown, DOCX and RTF), plain text and RTF.
 */
import { DOMParser as PMDOMParser, Fragment } from 'prosemirror-model';
import { schema } from '../schema.js';
import { createBlankState } from '../document.js';
import { cleanPastedHTML } from '../clipboard.js';
import { imageAttrs, uniqueName } from '../objects.js';

/** Turns data: URI pictures (frames parsed from <img>) into package pictures. */
function adoptPictures(doc, state) {
  let n = 0;
  const map = (fragment) => {
    const out = [];
    fragment.forEach((node) => {
      const src = node.type.name === 'frame' ? node.attrs.frameAttrs?.['#pastedSrc'] : null;
      if (src) {
        const m = src.match(/^data:(image\/[\w+.-]+);base64,(.*)$/);
        if (!m) return;
        const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
        const ext = (m[1].split('/')[1] || 'png').replace('svg+xml', 'svg').replace('jpeg', 'jpg');
        const path = `Pictures/import${++n}.${ext}`;
        state.pictures[path] = { bytes, mediaType: m[1] };
        const fa = node.attrs.frameAttrs;
        let w = Number(fa['#w']) || 0;
        let h = Number(fa['#h']) || 0;
        if (!w || !h) { const size = imageSize(bytes, m[1]); w = w || size.w; h = h || size.h || (w * 0.75); }
        // Fit the body width (about 16 cm).
        const max = 605;
        if (w > max) { h = (h * max) / w; w = max; }
        out.push(node.type.create(imageAttrs({ path, mime: m[1], w, h, name: `Picture ${n}`, title: fa['#alt'] || '', z: n })));
      } else if (node.content.size) out.push(node.copy(map(node.content)));
      else out.push(node);
    });
    return Fragment.fromArray(out);
  };
  return doc.copy(map(doc.content));
}

/** Pixel size of a PNG / JPEG / GIF (0 if unknown). */
export function imageSize(b, type) {
  try {
    if (/png/.test(type)) return { w: (b[16] << 24 | b[17] << 16 | b[18] << 8 | b[19]) >>> 0, h: (b[20] << 24 | b[21] << 16 | b[22] << 8 | b[23]) >>> 0 };
    if (/gif/.test(type)) return { w: b[6] | b[7] << 8, h: b[8] | b[9] << 8 };
    if (/jpe?g/.test(type)) {
      let i = 2;
      while (i < b.length) {
        if (b[i] !== 0xff) break;
        const marker = b[i + 1];
        const len = b[i + 2] << 8 | b[i + 3];
        if (marker >= 0xc0 && marker <= 0xc3) return { w: b[i + 7] << 8 | b[i + 8], h: b[i + 5] << 8 | b[i + 6] };
        i += 2 + len;
      }
    }
  } catch { /* unknown */ }
  return { w: 0, h: 0 };
}

/** HTML text → a new document state. */
export function htmlToState(html) {
  const state = createBlankState();
  const body = new DOMParser().parseFromString(cleanPastedHTML(String(html)), 'text/html').body;
  // Scripts and other active content never become part of the document.
  body.querySelectorAll('script, style, iframe, object, embed, noscript, template').forEach((n) => n.remove());
  let doc = PMDOMParser.fromSchema(schema).parse(body);
  if (!doc.childCount) doc = schema.node('doc', null, [schema.node('paragraph', { styleName: 'Standard' })]);
  state.doc = adoptPictures(doc, state);
  return state;
}

/** Plain text → paragraphs (blank lines kept as empty paragraphs). */
export function textToState(text) {
  const state = createBlankState();
  const lines = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const paras = lines.map((l) => {
    const content = [];
    l.split('\t').forEach((part, i) => { if (i) content.push(schema.nodes.tab.create()); if (part) content.push(schema.text(part)); });
    return schema.nodes.paragraph.create({ styleName: 'Standard' }, content);
  });
  state.doc = schema.node('doc', null, paras.length ? paras : [schema.nodes.paragraph.create({ styleName: 'Standard' })]);
  return state;
}

// ------------------------------------------------------------ RTF

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * RTF → HTML (paragraph alignment and indents, bold / italic / underline /
 * strike / sub / super, font, size, colour, highlight, line and page breaks,
 * tabs, Unicode, hyperlinks, tables, PNG / JPEG pictures, heading styles).
 */
export function rtfToHtml(rtf) {
  const fonts = {};
  const colours = [];
  const styles = {};
  const out = [];
  let para = [];
  let rows = null;
  let row = null;
  let cell = null;
  let pageBreak = false;
  const fresh = () => ({ b: false, i: false, ul: false, strike: false, sub: false, sup: false, f: null, fs: 24, cf: 0, hl: 0, uc: 1, skip: 0, dest: null });
  let st = fresh();
  const stack = [];
  let pp = { align: null, li: 0, ri: 0, fi: 0, sb: null, sa: null, style: null, intbl: false };
  const resetPara = () => { pp = { align: null, li: 0, ri: 0, fi: 0, sb: null, sa: null, style: null, intbl: false }; };
  let destText = '';
  let pict = null;
  let field = null;

  const runHtml = (text) => {
    const css = [];
    if (st.b) css.push('font-weight:bold');
    if (st.i) css.push('font-style:italic');
    if (st.ul) css.push('text-decoration:underline');
    if (st.strike) css.push('text-decoration:line-through');
    if (st.f != null && fonts[st.f]) css.push(`font-family:'${fonts[st.f].replace(/'/g, '')}'`);
    if (st.fs && st.fs !== 24) css.push(`font-size:${st.fs / 2}pt`);
    if (st.cf && colours[st.cf]) css.push(`color:${colours[st.cf]}`);
    if (st.hl && colours[st.hl]) css.push(`background-color:${colours[st.hl]}`);
    let h = esc(text);
    if (st.sub) h = `<sub>${h}</sub>`;
    if (st.sup) h = `<sup>${h}</sup>`;
    return css.length ? `<span style="${css.join(';')}">${h}</span>` : h;
  };
  const emit = (text) => {
    if (!text) return;
    const h = runHtml(text);
    if (field?.inResult) field.html += h; else (cell || para).push(h);
  };
  const target = () => cell || para;
  const endPara = () => {
    const content = target().join('') || '';
    const css = [];
    if (pp.align) css.push(`text-align:${pp.align}`);
    if (pp.li) css.push(`margin-left:${pp.li / 20}pt`);
    if (pp.ri) css.push(`margin-right:${pp.ri / 20}pt`);
    if (pp.fi) css.push(`text-indent:${pp.fi / 20}pt`);
    if (pp.sb != null) css.push(`margin-top:${pp.sb / 20}pt`);
    if (pp.sa != null) css.push(`margin-bottom:${pp.sa / 20}pt`);
    if (pageBreak) { css.push('page-break-before:always'); pageBreak = false; }
    const styleName = pp.style != null ? styles[pp.style] || '' : '';
    const hm = styleName.match(/^heading\s*(\d)/i);
    const tag = hm ? `h${Math.min(6, Number(hm[1]))}` : 'p';
    const html = `<${tag}${css.length ? ` style="${css.join(';')}"` : ''}>${content || '<br>'}</${tag}>`;
    if (cell) { cell.paras = (cell.paras || []); cell.paras.push(html); cell.length = 0; } else { out.push(html); para = []; }
  };

  const n = rtf.length;
  let i = 0;
  let ucSkip = 0;
  while (i < n) {
    const ch = rtf[i];
    if (ch === '{') {
      stack.push({ ...st });
      if (st.dest) st.skip++;
      i++;
      continue;
    }
    if (ch === '}') {
      const was = st;
      st = stack.pop() || fresh();
      // Leaving a destination group.
      if (was.dest && was.dest !== st.dest) {
        if (was.dest === 'font' && destText.trim()) fonts[was.fontId] = destText.replace(/;\s*$/, '').trim();
        if (was.dest === 'style' && was.styleId != null && destText.trim()) styles[was.styleId] = destText.replace(/;\s*$/, '').trim();
        if (was.dest === 'pict' && pict?.hex && pict.type !== 'unsupported') {
          const hex = pict.hex.replace(/[^0-9a-f]/gi, '');
          const bytes = new Uint8Array(hex.length / 2);
          for (let k = 0; k < bytes.length; k++) bytes[k] = parseInt(hex.substr(k * 2, 2), 16);
          let bin = '';
          for (let k = 0; k < bytes.length; k += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(k, k + 0x8000));
          const w = pict.w ? Math.round(pict.w / 15) : '';
          const h = pict.h ? Math.round(pict.h / 15) : '';
          target().push(`<img src="data:${pict.type};base64,${btoa(bin)}"${w ? ` width="${w}"` : ''}${h ? ` height="${h}"` : ''}>`);
          pict = null;
        }
        if (was.dest === 'fldinst' && field) { const m = destText.match(/HYPERLINK\s+"([^"]+)"/i); field.href = m ? m[1] : null; }
        destText = '';
      }
      if (field && was.fldrslt && !st.fldrslt) { field.inResult = false; const a = field.href ? `<a href="${esc(field.href)}">${field.html}</a>` : field.html; target().push(a); field = null; }
      i++;
      continue;
    }
    if (ch === '\\') {
      const next = rtf[i + 1];
      if (next === '\\' || next === '{' || next === '}') { if (!st.dest) emit(next); else destText += next; i += 2; continue; }
      if (next === '\'') {
        if (ucSkip > 0) { ucSkip--; i += 4; continue; }
        const c = parseInt(rtf.substr(i + 2, 2), 16);
        const text = String.fromCharCode(c < 128 ? c : (CP1252[c] || c));
        if (st.dest) destText += text; else emit(text);
        i += 4;
        continue;
      }
      if (next === '~') { emit('\u00a0'); i += 2; continue; }
      if (next === '-' || next === '_') { i += 2; continue; }
      if (next === '*') { st.dest = st.dest || 'skip'; i += 2; continue; }
      if (next === '\n' || next === '\r') { if (!st.dest) endPara(); i += 2; continue; }
      const m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(rtf.slice(i, i + 40));
      if (!m) { i++; continue; }
      i += m[0].length;
      const word = m[1];
      const arg = m[2] != null ? Number(m[2]) : null;
      // Font, colour and style tables.
      if ((st.dest === 'fonttbl' || st.dest === 'font') && word === 'f') { st.dest = 'font'; st.fontId = arg; destText = ''; continue; }
      if ((st.dest === 'stylesheet' || st.dest === 'style') && word === 's') { st.dest = 'style'; st.styleId = arg; destText = ''; continue; }
      if (st.dest === 'colortbl' && (word === 'red' || word === 'green' || word === 'blue')) { colours.cur = { ...(colours.cur || {}), [word[0]]: arg }; continue; }
      // Ignorable destinations (\*) that matter here: hyperlink targets and pictures.
      if (st.dest === 'skip' && word === 'fldinst' && field) { st.dest = 'fldinst'; destText = ''; continue; }
      if (st.dest === 'skip' && word === 'pict') { st.dest = 'pict'; pict = { hex: '', type: 'image/png' }; continue; }
      if (st.dest && !['pict', 'fldinst'].includes(st.dest)) {
        if (word === 'u' && arg != null) destText += String.fromCharCode(arg < 0 ? arg + 65536 : arg);
        continue;
      }
      switch (word) {
        case 'fonttbl': case 'colortbl': case 'stylesheet': case 'info': case 'header': case 'footer': case 'headerl': case 'headerr': case 'headerf': case 'footerl': case 'footerr': case 'footerf': case 'footnote': case 'annotation': case 'xmlnstbl': case 'listtable': case 'listoverridetable': case 'rsidtbl': case 'generator': case 'themedata': case 'colorschememapping': case 'latentstyles': case 'datastore': case 'pgdsctbl': case 'object':
          st.dest = word === 'fonttbl' ? 'fonttbl' : word === 'colortbl' ? 'colortbl' : word === 'stylesheet' ? 'stylesheet' : 'skip';
          if (word === 'colortbl') { colours.length = 0; colours.push(null); }
          break;
        case 'pict': st.dest = 'pict'; pict = { hex: '', type: 'image/png' }; break;
        case 'pngblip': if (pict) pict.type = 'image/png'; break;
        case 'jpegblip': if (pict) pict.type = 'image/jpeg'; break;
        case 'emfblip': case 'wmetafile': case 'macpict': if (pict) pict.type = 'unsupported'; break;
        case 'picwgoal': if (pict) pict.w = arg; break;
        case 'pichgoal': if (pict) pict.h = arg; break;
        case 'field': field = { html: '', href: null }; break;
        case 'fldinst': st.dest = 'fldinst'; destText = ''; break;
        case 'fldrslt': if (field) { field.inResult = true; st.fldrslt = true; } break;
        case 'par': endPara(); break;
        case 'line': if (field?.inResult) field.html += '<br>'; else target().push('<br>'); break;
        case 'tab': emit('\t'); break;
        case 'page': pageBreak = true; break;
        case 'pard': resetPara(); break;
        case 'plain': Object.assign(st, { b: false, i: false, ul: false, strike: false, sub: false, sup: false, fs: 24, cf: 0, hl: 0 }); break;
        case 'b': st.b = arg !== 0; break;
        case 'i': st.i = arg !== 0; break;
        case 'ul': st.ul = arg !== 0; break;
        case 'ulnone': st.ul = false; break;
        case 'strike': st.strike = arg !== 0; break;
        case 'sub': st.sub = true; st.sup = false; break;
        case 'super': st.sup = true; st.sub = false; break;
        case 'nosupersub': st.sub = false; st.sup = false; break;
        case 'f': st.f = arg; break;
        case 'fs': st.fs = arg; break;
        case 'cf': st.cf = arg; break;
        case 'highlight': case 'cb': st.hl = arg; break;
        case 'qc': pp.align = 'center'; break;
        case 'qr': pp.align = 'right'; break;
        case 'qj': pp.align = 'justify'; break;
        case 'ql': pp.align = null; break;
        case 'li': pp.li = arg; break;
        case 'ri': pp.ri = arg; break;
        case 'fi': pp.fi = arg; break;
        case 'sb': pp.sb = arg; break;
        case 'sa': pp.sa = arg; break;
        case 's': pp.style = arg; break;
        case 'uc': st.uc = arg; break;
        case 'u': { const c = arg < 0 ? arg + 65536 : arg; emit(String.fromCharCode(c)); ucSkip = st.uc; break; }
        case 'trowd': if (!rows) rows = []; row = []; break;
        case 'intbl': pp.intbl = true; if (!cell) { cell = []; cell.paras = []; } break;
        case 'cell': {
          if (!cell) { cell = []; cell.paras = []; }
          if (cell.length || !cell.paras.length) endPara();
          (row || (row = [])).push(cell.paras.join(''));
          cell = null;
          break;
        }
        case 'row': if (rows && row) rows.push(row); row = null; break;
        case 'lquote': emit('\u2018'); break;
        case 'rquote': emit('\u2019'); break;
        case 'ldblquote': emit('\u201c'); break;
        case 'rdblquote': emit('\u201d'); break;
        case 'emdash': emit('\u2014'); break;
        case 'endash': emit('\u2013'); break;
        case 'bullet': emit('\u2022'); break;
        default: break;
      }
      continue;
    }
    // Plain text.
    if (ch === '\r' || ch === '\n') { i++; continue; }
    if (ucSkip > 0) { ucSkip--; i++; continue; }
    if (st.dest === 'colortbl') {
      if (ch === ';') { const c = colours.cur; colours.push(c ? `#${[c.r || 0, c.g || 0, c.b || 0].map((x) => x.toString(16).padStart(2, '0')).join('')}` : null); colours.cur = null; }
      i++;
      continue;
    }
    if (st.dest === 'pict') { pict.hex += ch; i++; continue; }
    // Font or style entries without their own group end at ';'.
    if ((st.dest === 'font' || st.dest === 'style') && ch === ';') {
      if (st.dest === 'font') fonts[st.fontId] = destText.trim(); else styles[st.styleId] = destText.trim();
      destText = '';
      st.dest = st.dest === 'font' ? 'fonttbl' : 'stylesheet';
      i++;
      continue;
    }
    if (st.dest) { destText += ch; i++; continue; }
    // Text after a table that has ended: close the table first.
    if (rows && !pp.intbl && !row) { out.push(tableHtml(rows)); rows = null; }
    let j = i;
    while (j < n && !'\\{}\r\n'.includes(rtf[j])) j++;
    emit(rtf.slice(i, j));
    i = j;
  }
  if (rows?.length) out.push(tableHtml(rows));
  if (para.length) endPara();
  return out.join('\n');
}

const tableHtml = (rows) => `<table>${rows.map((r) => `<tr>${r.map((c) => `<td>${c || '<p><br></p>'}</td>`).join('')}</tr>`).join('')}</table>`;

/** Windows-1252 code points 0x80–0x9F. */
const CP1252 = { 128: 0x20ac, 130: 0x201a, 131: 0x192, 132: 0x201e, 133: 0x2026, 134: 0x2020, 135: 0x2021, 136: 0x2c6, 137: 0x2030, 138: 0x160, 139: 0x2039, 140: 0x152, 142: 0x17d, 145: 0x2018, 146: 0x2019, 147: 0x201c, 148: 0x201d, 149: 0x2022, 150: 0x2013, 151: 0x2014, 152: 0x2dc, 153: 0x2122, 154: 0x161, 155: 0x203a, 156: 0x153, 158: 0x17e, 159: 0x178 };

export const rtfToState = (rtf) => htmlToState(rtfToHtml(rtf));
export { uniqueName };
