/**
 * DOCX export: writes WordprocessingML directly (string templates + fflate,
 * like the ODT writer), mirroring docx-reader.js so that every property the
 * reader understands is written back:
 *
 *   styles      docDefaults (from the default paragraph style), every
 *               paragraph and character style with basedOn / next /
 *               outline level, under Word's names (Normal, Heading 1…)
 *   sections    one w:sectPr per page-style change (size, orientation,
 *               margins with header / footer distances, columns with the
 *               separator, first-page / even headers, page number restarts,
 *               nextPage / continuous / evenPage / oddPage)
 *   headers     default / first / even parts per section with their full
 *               content; evenAndOddHeaders in settings.xml
 *   paragraphs  alignment, indents, spacing and line spacing, contextual
 *               spacing, keep options, widow control, page breaks, borders
 *               with their spacing, shading, tab stops with leaders,
 *               outline level, right-to-left
 *   runs        fonts, sizes, bold / italic, underline type and colour,
 *               strike / double strike, super / subscript, caps, small caps,
 *               hidden, letter spacing, colour (or automatic), highlight /
 *               shading, language, character style
 *   lists       numbering.xml from the list styles (formats, label text,
 *               start, indents, what follows the label, alignment, label
 *               formatting); continued and restarted lists
 *   tables      widths and grid, alignment and indent, cell borders,
 *               shading, margins, vertical alignment and text direction,
 *               merged cells both ways, row heights, header rows, rows that
 *               don't split, nested tables
 *   objects     inline and floating pictures (position, wrapping, distance
 *               from text, behind text), text boxes
 *   notes       footnotes / endnotes with their full content
 *   review      comments with their ranges, tracked insertions / deletions
 *   links       external hyperlinks, internal links to bookmarks, bookmarks
 *   fields      PAGE, NUMPAGES, DATE, TIME, REF and TOC as complex fields
 *               with their current results
 *   properties  title, subject, author, keywords, description, dates
 */
import { zipSync, strToU8 } from 'fflate';
import { mergeAuto, autoFromTree } from '../odt/styles.js';
import { findChild } from '../odt/xml.js';
import { toPx } from '../../layout/units.js';
import { tocOptions } from '../indexes.js';
import { wrapOf, positionOf, graphicProps, sizeOf } from '../objects.js';

const NS = 'xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:w10="urn:schemas-microsoft-com:office:word" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" mc:Ignorable="w14 w15 wp14"';
const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** An ODF length → twips (1/1440 in). */
const tw = (len) => Math.round((toPx(len) || 0) * 15);
const emu = (px) => Math.round(px * 9525);
const ptOf = (len) => (toPx(len) || 0) * 0.75;
const hex = (c) => String(c || '').replace('#', '').toUpperCase();
const isLen = (v) => v != null && v !== '' && /^-?[\d.]+(cm|mm|in|pt|pc|px)$/.test(String(v));

// ------------------------------------------------------------ style names

/** ODF style names → Word's (the inverse of the reader's mapping). */
const KNOWN_P = {
  Standard: ['Normal', 'Normal'], Title: ['Title', 'Title'], Subtitle: ['Subtitle', 'Subtitle'], Quote: ['Quote', 'Quote'], Intense_20_Quote: ['IntenseQuote', 'Intense Quote'],
  List_20_Paragraph: ['ListParagraph', 'List Paragraph'], Footnote: ['FootnoteText', 'footnote text'], Endnote: ['EndnoteText', 'endnote text'], Header: ['Header', 'header'],
  Footer: ['Footer', 'footer'], Caption: ['Caption', 'caption'], No_20_Spacing: ['NoSpacing', 'No Spacing'], Contents_20_Heading: ['TOCHeading', 'TOC Heading'],
};
const KNOWN_T = { Internet_20_link: ['Hyperlink', 'Hyperlink'], Strong_20_Emphasis: ['Strong', 'Strong'], Emphasis: ['Emphasis', 'Emphasis'], Subtle_20_Emphasis: ['SubtleEmphasis', 'Subtle Emphasis'], Intense_20_Emphasis: ['IntenseEmphasis', 'Intense Emphasis'] };

const decodeName = (n) => String(n).replace(/_([0-9a-f]{1,6})_/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));

function wordStyle(family, name, index) {
  const known = (family === 'paragraph' ? KNOWN_P : KNOWN_T)[name];
  if (known) return { id: known[0], name: known[1] };
  let m = /^Heading_20_(\d)$/.exec(name);
  if (m && family === 'paragraph') return { id: `Heading${m[1]}`, name: `heading ${m[1]}` };
  m = /^Contents_20_(\d)$/.exec(name);
  if (m && family === 'paragraph') return { id: `TOC${m[1]}`, name: `toc ${m[1]}` };
  const display = index?.families.get(family)?.get(name)?.a['style:display-name'] || decodeName(name);
  const id = display.replace(/[^A-Za-z0-9]/g, '') || `Style${Math.abs(hash(name))}`;
  return { id: family === 'text' && KNOWN_P[name.replace(/_20_Char$/, '')] ? `${KNOWN_P[name.replace(/_20_Char$/, '')][0]}Char` : id, name: display };
}
const hash = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7);

// ------------------------------------------------------------ properties

const ALIGN = { start: 'left', left: 'left', end: 'right', right: 'right', center: 'center', justify: 'both' };
const UNDERLINE = { solid: 'single', dotted: 'dotted', dash: 'dash', 'long-dash': 'dashLong', 'dot-dash': 'dotDash', 'dot-dot-dash': 'dotDotDash', wave: 'wave' };
const HIGHLIGHT = { '#ffff00': 'yellow', '#00ff00': 'green', '#00ffff': 'cyan', '#ff00ff': 'magenta', '#0000ff': 'blue', '#ff0000': 'red', '#000080': 'darkBlue', '#008080': 'darkCyan', '#008000': 'darkGreen', '#800080': 'darkMagenta', '#800000': 'darkRed', '#808000': 'darkYellow', '#808080': 'darkGray', '#c0c0c0': 'lightGray', '#000000': 'black', '#ffffff': 'white' };
const BORDER = { solid: 'single', double: 'double', dotted: 'dotted', dashed: 'dashed', groove: 'threeDEngrave', ridge: 'threeDEmboss', inset: 'inset', outset: 'outset' };
const LEADER = { '.': 'dot', '-': 'hyphen', _: 'underscore', '·': 'middleDot' };

/** An ODF border value ("0.75pt solid #2e75b6") → a Word border element, or null. */
function borderEl(tag, value, space = 0) {
  if (!value) return '';
  if (value === 'none') return `<w:${tag} w:val="nil"/>`;
  const parts = String(value).trim().split(/\s+/);
  const width = parts.find(isLen);
  const style = parts.find((p) => BORDER[p] || p === 'none' || p === 'hidden') || 'solid';
  const colour = parts.find((p) => /^#[0-9a-f]{3,6}$/i.test(p)) || '#000000';
  if (style === 'none' || style === 'hidden') return `<w:${tag} w:val="nil"/>`;
  // w:sz is the width of one line (eighths of a point): a double border is three times as wide.
  const lines = style === 'double' ? 3 : 1;
  const sz = Math.max(2, Math.min(96, Math.round((ptOf(width || '0.75pt') / lines) * 8)));
  return `<w:${tag} w:val="${BORDER[style] || 'single'}" w:sz="${sz}" w:space="${Math.round(space)}" w:color="${hex(colour)}"/>`;
}
const borderPt = (value) => { if (!value || value === 'none') return 0; const w = String(value).split(/\s+/).find(isLen); return w ? ptOf(w) : 0; };

/** style:text-properties attributes → w:rPr children (in schema order). */
function rPrXml(a = {}, { rStyle = null } = {}) {
  const o = [];
  if (rStyle) o.push(`<w:rStyle w:val="${esc(rStyle)}"/>`);
  const font = a['style:font-name'] || a['fo:font-family'];
  const fa = a['style:font-name-asian'];
  const fc = a['style:font-name-complex'];
  if (font || fa || fc) {
    const clean = (f) => esc(String(f).replace(/^['"]|['"]$/g, ''));
    o.push(`<w:rFonts${font ? ` w:ascii="${clean(font)}" w:hAnsi="${clean(font)}"` : ''}${fa ? ` w:eastAsia="${clean(fa)}"` : ''}${fc ? ` w:cs="${clean(fc)}"` : ''}/>`);
  }
  const w = a['fo:font-weight'];
  if (w) o.push(w === 'bold' || Number(w) >= 600 ? '<w:b/><w:bCs/>' : '<w:b w:val="0"/><w:bCs w:val="0"/>');
  const st = a['fo:font-style'];
  if (st) o.push(st === 'italic' || st === 'oblique' ? '<w:i/><w:iCs/>' : '<w:i w:val="0"/><w:iCs w:val="0"/>');
  if (a['fo:text-transform'] === 'uppercase') o.push('<w:caps/>');
  if (a['fo:font-variant'] === 'small-caps') o.push('<w:smallCaps/>');
  const lt = a['style:text-line-through-style'];
  if (lt) o.push(lt === 'none' ? '<w:strike w:val="0"/>' : a['style:text-line-through-type'] === 'double' ? '<w:dstrike/>' : '<w:strike/>');
  if (a['style:text-outline'] === 'true') o.push('<w:outline/>');
  if (a['fo:text-shadow'] && a['fo:text-shadow'] !== 'none') o.push('<w:shadow/>');
  if (a['text:display'] === 'none') o.push('<w:vanish/>');
  if (a['fo:color']) o.push(`<w:color w:val="${hex(a['fo:color'])}"/>`);
  else if (a['style:use-window-font-color'] === 'true') o.push('<w:color w:val="auto"/>');
  if (a['fo:letter-spacing'] && a['fo:letter-spacing'] !== 'normal') o.push(`<w:spacing w:val="${tw(a['fo:letter-spacing'])}"/>`);
  if (a['fo:font-size'] && /pt$/.test(a['fo:font-size'])) o.push(`<w:sz w:val="${Math.round(parseFloat(a['fo:font-size']) * 2)}"/>`);
  if (a['style:font-size-complex'] && /pt$/.test(a['style:font-size-complex'])) o.push(`<w:szCs w:val="${Math.round(parseFloat(a['style:font-size-complex']) * 2)}"/>`);
  const bg = a['fo:background-color'];
  const hl = bg && bg !== 'transparent' ? HIGHLIGHT[bg.toLowerCase()] : null;
  if (hl) o.push(`<w:highlight w:val="${hl}"/>`);
  const ul = a['style:text-underline-style'];
  if (ul) {
    if (ul === 'none') o.push('<w:u w:val="none"/>');
    else {
      let v = a['style:text-underline-type'] === 'double' ? 'double' : UNDERLINE[ul] || 'single';
      if (a['style:text-underline-width'] === 'bold' && v === 'single') v = 'thick';
      const c = a['style:text-underline-color'];
      o.push(`<w:u w:val="${v}"${c && c !== 'font-color' ? ` w:color="${hex(c)}"` : ''}/>`);
    }
  }
  if (bg && bg !== 'transparent' && !hl) o.push(`<w:shd w:val="clear" w:color="auto" w:fill="${hex(bg)}"/>`);
  const pos = String(a['style:text-position'] || '');
  if (/^(super|[1-9])/.test(pos)) o.push('<w:vertAlign w:val="superscript"/>');
  else if (/^(sub|-)/.test(pos)) o.push('<w:vertAlign w:val="subscript"/>');
  if (a['fo:language'] && a['fo:country']) o.push(`<w:lang w:val="${esc(a['fo:language'])}-${esc(a['fo:country'])}"/>`);
  return o.join('');
}

/**
 * style:paragraph-properties { a, c } → w:pPr children (schema order).
 * `x`: { style, numPr, outline, keepSect } extra parts.
 */
function pPrXml(a = {}, c = [], x = {}) {
  const o = [];
  if (x.style) o.push(`<w:pStyle w:val="${esc(x.style)}"/>`);
  if (a['fo:keep-with-next'] === 'always') o.push('<w:keepNext/>');
  if (a['fo:keep-together'] === 'always') o.push('<w:keepLines/>');
  if (a['fo:break-before'] === 'page') o.push('<w:pageBreakBefore/>');
  if (a['fo:widows'] != null || a['fo:orphans'] != null) o.push(Number(a['fo:widows'] ?? a['fo:orphans']) > 0 ? '<w:widowControl/>' : '<w:widowControl w:val="0"/>');
  if (x.numPr) o.push(x.numPr);
  // Borders: w:space from the padding; left / right borders sit outside the indent.
  const pad = (side) => a[`fo:padding-${side}`] ?? a['fo:padding'];
  const bd = (side) => a[`fo:border-${side}`] ?? a['fo:border'];
  const sides = ['top', 'left', 'bottom', 'right'].map((s) => borderEl(s, bd(s), pad(s) ? ptOf(pad(s)) : 0)).join('');
  if (sides) o.push(`<w:pBdr>${sides}</w:pBdr>`);
  const bg = a['fo:background-color'];
  if (bg && bg !== 'transparent') o.push(`<w:shd w:val="clear" w:color="auto" w:fill="${hex(bg)}"/>`);
  const ts = (c || []).find((t) => typeof t !== 'string' && t.n === 'style:tab-stops');
  if (ts) {
    const stops = (ts.c || []).filter((t) => typeof t !== 'string' && t.n === 'style:tab-stop').map((t) => {
      const type = { right: 'right', center: 'center', char: 'decimal' }[t.a['style:type']] || 'left';
      const lead = t.a['style:leader-style'] && t.a['style:leader-style'] !== 'none' ? LEADER[t.a['style:leader-text'] || '.'] || 'dot' : null;
      return `<w:tab w:val="${type}"${lead ? ` w:leader="${lead}"` : ''} w:pos="${tw(t.a['style:position'] || '0cm')}"/>`;
    });
    if (stops.length) o.push(`<w:tabs>${stops.join('')}</w:tabs>`);
  }
  if (a['style:writing-mode'] === 'rl-tb') o.push('<w:bidi/>');
  const sp = [];
  if (isLen(a['fo:margin-top'])) sp.push(`w:before="${tw(a['fo:margin-top'])}"`);
  if (isLen(a['fo:margin-bottom'])) sp.push(`w:after="${tw(a['fo:margin-bottom'])}"`);
  const lh = a['fo:line-height'];
  if (lh && /%$/.test(lh)) sp.push(`w:line="${Math.round(parseFloat(lh) * 2.4)}" w:lineRule="auto"`);
  else if (isLen(lh)) sp.push(`w:line="${tw(lh)}" w:lineRule="exact"`);
  else if (isLen(a['style:line-height-at-least'])) sp.push(`w:line="${tw(a['style:line-height-at-least'])}" w:lineRule="atLeast"`);
  if (sp.length) o.push(`<w:spacing ${sp.join(' ')}/>`);
  const ind = [];
  const borderSpace = (side) => (bd(side) && bd(side) !== 'none' ? ((pad(side) ? ptOf(pad(side)) : 0) + borderPt(bd(side))) * 20 : 0);
  if (isLen(a['fo:margin-left'])) ind.push(`w:left="${Math.round(tw(a['fo:margin-left']) + borderSpace('left'))}"`);
  if (isLen(a['fo:margin-right'])) ind.push(`w:right="${Math.round(tw(a['fo:margin-right']) + borderSpace('right'))}"`);
  if (isLen(a['fo:text-indent'])) { const v = tw(a['fo:text-indent']); ind.push(v < 0 ? `w:hanging="${-v}"` : `w:firstLine="${v}"`); }
  if (ind.length) o.push(`<w:ind ${ind.join(' ')}/>`);
  if (a['style:contextual-spacing'] === 'true') o.push('<w:contextualSpacing/>');
  if (a['fo:text-align']) o.push(`<w:jc w:val="${ALIGN[a['fo:text-align']] || 'left'}"/>`);
  if (x.outline) o.push(`<w:outlineLvl w:val="${x.outline - 1}"/>`);
  if (x.rPr) o.push(`<w:rPr>${x.rPr}</w:rPr>`);
  if (x.sectPr) o.push(x.sectPr);
  return o.join('');
}

// ------------------------------------------------------------ writer

function createDocxWriter(state, index) {
  const files = {};
  const overrides = [];
  const media = new Map(); // picture path → media name
  const parts = []; // { path, rels: [], type }
  const notes = { footnote: [], endnote: [] };
  const comments = [];
  const numbering = createNumbering(index);
  const bookmarks = new Map();
  let bookmarkId = 0;
  let drawingId = 0;
  let changeId = 0;

  /** A story (document, header, note…) with its own relationships. */
  function story(path) {
    const rels = [];
    const rel = (type, target, external = false) => {
      const key = `${type}|${target}|${external}`;
      const found = rels.find((r) => r.key === key);
      if (found) return found.id;
      const id = `rId${rels.length + 1}`;
      rels.push({ key, id, type, target, external });
      return id;
    };
    const s = { path, rels, rel };
    parts.push(s);
    return s;
  }

  function mediaRel(st, path) {
    const pic = state.pictures?.[path] || state.extraFiles?.[path];
    if (!pic) return null;
    if (!media.has(path)) {
      const ext = (path.split('.').pop() || 'png').toLowerCase();
      // The picture keeps its file name where it can.
      const own = path.split('/').pop();
      const name = /^[\w.-]+$/.test(own) && ![...media.values()].includes(own) ? own : `image${media.size + 1}.${ext}`;
      media.set(path, name);
      files[`word/media/${name}`] = pic.bytes;
    }
    return st.rel('image', `media/${media.get(path)}`);
  }

  // ---------------------------------------------------------------- inline

  const effText = (node) => node.marks.find((m) => m.type.name === 'textProps')?.attrs.auto?.props?.['style:text-properties']?.a || {};
  const charStyle = (node) => node.marks.find((m) => m.type.name === 'charStyle')?.attrs.name || null;

  let paraText = {}; // text properties of the paragraph being written (they apply to all of its text in ODF)
  function runXml(node, inner, extraRPr = '') {
    const cs = charStyle(node);
    const rPr = rPrXml({ ...paraText, ...effText(node) }, { rStyle: cs ? wordStyle('text', cs, index).id : null }) + extraRPr;
    return `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}${inner}</w:r>`;
  }

  const textRun = (node, text, deleted) => {
    const tag = deleted ? 'w:delText' : 'w:t';
    return runXml(node, text.split(/(\n)/).map((t) => (t === '\n' ? '<w:br/>' : t ? `<${tag} xml:space="preserve">${esc(t)}</${tag}>` : '')).join(''));
  };

  function fieldXml(st, node, ctxNode) {
    const f = node.attrs;
    const fa = f.fieldAttrs || {};
    let instr = null;
    switch (f.element) {
      case 'text:page-number': instr = 'PAGE'; break;
      case 'text:page-count': instr = 'NUMPAGES'; break;
      case 'text:date': instr = 'DATE \\@ "d MMMM yyyy"'; break;
      case 'text:time': instr = 'TIME \\@ "HH:mm"'; break;
      case 'text:bookmark-ref': case 'text:reference-ref': instr = `REF ${fa['text:ref-name'] || ''} \\h`; break;
      case 'text:title': instr = 'TITLE'; break;
      case 'text:author-name': case 'text:initial-creator': instr = 'AUTHOR'; break;
      case 'text:file-name': instr = 'FILENAME'; break;
      default: break;
    }
    const result = f.text || '';
    if (!instr) return result ? textRun(ctxNode || node, result) : '';
    return complexField(node, instr, result ? textRun(node, result) : '');
  }

  const complexField = (node, instr, resultRuns) => `${runXml(node, '<w:fldChar w:fldCharType="begin"/>')}${runXml(node, `<w:instrText xml:space="preserve"> ${esc(instr)} </w:instrText>`)}${runXml(node, '<w:fldChar w:fldCharType="separate"/>')}${resultRuns}${runXml(node, '<w:fldChar w:fldCharType="end"/>')}`;

  function frameXml(st, node, inPara = true) {
    const a = node.attrs;
    const { w, h } = sizeOf(a);
    const cx = emu(w || 100);
    const cy = emu(h || 100);
    const id = ++drawingId;
    const name = esc(a.frameAttrs?.['draw:name'] || `Picture ${id}`);
    const title = a.parts?.find((p) => p.n === 'svg:title')?.c?.[0];
    const desc = a.parts?.find((p) => p.n === 'svg:desc')?.c?.[0];
    const descr = esc(typeof desc === 'string' ? desc : typeof title === 'string' ? title : '');
    let graphic = null;
    if (a.kind === 'image') {
      const img = a.parts?.find((p) => p.n === 'draw:image');
      const path = String(img?.a?.['xlink:href'] || a.href || '').replace(/^\.\//, '');
      const rid = mediaRel(st, path);
      if (!rid) return '';
      graphic = `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="${name}"${descr ? ` descr="${descr}"` : ''}/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>`;
    } else if (a.kind === 'textbox') {
      const gp = graphicProps(a, index);
      const fill = gp['draw:fill'] === 'none' ? '<a:noFill/>' : `<a:solidFill><a:srgbClr val="${hex(gp['draw:fill-color'] || gp['fo:background-color'] || '#ffffff')}"/></a:solidFill>`;
      const bw = borderPt(gp['fo:border']);
      const ln = gp['fo:border'] && gp['fo:border'] !== 'none' ? `<a:ln w="${Math.round(bw * 12700)}"><a:solidFill><a:srgbClr val="${hex(String(gp['fo:border']).split(/\s+/).find((p) => /^#/.test(p)) || '#000000')}"/></a:solidFill></a:ln>` : '<a:ln><a:noFill/></a:ln>';
      const body = blocksXml(st, a.body || [], { inBox: true });
      graphic = `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fill}${ln}</wps:spPr><wps:txbx><w:txbxContent>${body || '<w:p/>'}</w:txbxContent></wps:txbx><wps:bodyPr rot="0" vert="horz" wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720" anchor="t" anchorCtr="0"><a:noAutofit/></wps:bodyPr></wps:wsp></a:graphicData></a:graphic>`;
    } else return '';
    const docPr = `<wp:docPr id="${id}" name="${name}"${descr ? ` descr="${descr}"` : ''}/>`;
    const wrap = wrapOf(a, index);
    let drawing;
    if (wrap === 'inline' || !inPara) {
      drawing = `<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>${docPr}<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>${graphic}</wp:inline>`;
    } else drawing = anchorXml(a, cx, cy, docPr, graphic, wrap);
    const run = `<w:r><w:drawing>${drawing}</w:drawing></w:r>`;
    return a.kind === 'textbox' ? `<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing>${drawing}</w:drawing></mc:Choice></mc:AlternateContent></w:r>` : run;
  }

  /** A floating object's wp:anchor: position (posOffset or align, relativeFrom), wrapping, distances, behind text. */
  function anchorXml(a, cx, cy, docPr, graphic, wrap) {
    const pos = positionOf(a, index);
    const gp = graphicProps(a, index);
    const HREL = { page: 'page', 'page-content': 'margin', paragraph: 'column', 'paragraph-content': 'column', char: 'character', 'page-start-margin': 'leftMargin', 'page-end-margin': 'rightMargin', frame: 'column' };
    const VREL = { page: 'page', 'page-content': 'margin', paragraph: 'paragraph', 'paragraph-content': 'paragraph', line: 'line', char: 'line', frame: 'paragraph' };
    const HA = { left: 'left', center: 'center', right: 'right', inside: 'inside', outside: 'outside' };
    const VA = { top: 'top', middle: 'center', bottom: 'bottom' };
    const posH = HA[pos.hpos] ? `<wp:align>${HA[pos.hpos]}</wp:align>` : `<wp:posOffset>${emu(pos.x)}</wp:posOffset>`;
    const posV = VA[pos.vpos] ? `<wp:align>${VA[pos.vpos]}</wp:align>` : `<wp:posOffset>${emu(pos.y)}</wp:posOffset>`;
    const dist = (k) => emu(toPx(gp[`fo:margin-${k}`] || '0cm') || 0);
    const side = { left: 'left', right: 'right', biggest: 'largest' }[gp['style:wrap']] || 'bothSides';
    const wrapEl = { square: `<wp:wrapSquare wrapText="${side}"/>`, tight: `<wp:wrapTight wrapText="${side}"><wp:wrapPolygon edited="0"><wp:start x="0" y="0"/><wp:lineTo x="0" y="21600"/><wp:lineTo x="21600" y="21600"/><wp:lineTo x="21600" y="0"/><wp:lineTo x="0" y="0"/></wp:wrapPolygon></wp:wrapTight>`, through: `<wp:wrapThrough wrapText="${side}"><wp:wrapPolygon edited="0"><wp:start x="0" y="0"/><wp:lineTo x="0" y="21600"/><wp:lineTo x="21600" y="21600"/><wp:lineTo x="21600" y="0"/><wp:lineTo x="0" y="0"/></wp:wrapPolygon></wp:wrapThrough>`, topBottom: '<wp:wrapTopAndBottom/>' }[wrap] || '<wp:wrapNone/>';
    const z = 251658240 + (Number(a.frameAttrs?.['draw:z-index']) || 0);
    return `<wp:anchor distT="${dist('top')}" distB="${dist('bottom')}" distL="${dist('left')}" distR="${dist('right')}" simplePos="0" relativeHeight="${z}" behindDoc="${wrap === 'behind' ? 1 : 0}" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="${HREL[pos.hrel] || 'column'}">${posH}</wp:positionH><wp:positionV relativeFrom="${VREL[pos.vrel] || 'paragraph'}">${posV}</wp:positionV><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>${wrapEl}${docPr}<wp:cNvGraphicFramePr/>${graphic}</wp:anchor>`;
  }

  /** Inline content of a textblock → runs (hyperlinks and tracked changes grouped). */
  function inlineXml(st, para, opts = {}) {
    const out = [];
    let group = null; // { kind: 'link' | 'ins' | 'del', key, open, items }
    const flush = () => { if (group) { out.push(group.open + group.items.join('') + group.close); group = null; } };
    const wrapIn = (node, xml) => {
      // Tracked change, then link (a link inside a change).
      const change = node.marks?.find((m) => m.type.name === 'insertion' || m.type.name === 'deletion');
      const link = node.marks?.find((m) => m.type.name === 'link');
      const key = `${change ? `${change.type.name}:${change.attrs.author}:${change.attrs.date}` : ''}|${link ? link.attrs.href : ''}`;
      if (!change && !link) { flush(); out.push(xml); return; }
      if (group?.key !== key) {
        flush();
        let open = '';
        let close = '';
        if (change) {
          const tag = change.type.name === 'insertion' ? 'w:ins' : 'w:del';
          const known = /^ct(\d+)$/.exec(change.attrs.cid || '');
          open += `<${tag} w:id="${known ? known[1] : 100000 + ++changeId}" w:author="${esc(change.attrs.author || 'Unknown')}"${change.attrs.date ? ` w:date="${esc(/Z$|[+-]\d\d:\d\d$/.test(change.attrs.date) ? change.attrs.date : `${change.attrs.date.replace(/\.\d+$/, '')}Z`)}"` : ''}>`;
          close = `</${tag}>${close}`;
        }
        if (link) {
          const href = link.attrs.href || '';
          if (href.startsWith('#')) open += `<w:hyperlink w:anchor="${esc(href.slice(1))}" w:history="1">`;
          else open += `<w:hyperlink r:id="${st.rel('hyperlink', href, true)}" w:history="1">`;
          close = `</w:hyperlink>${close}`;
        }
        group = { key, open, close, items: [] };
      }
      group.items.push(xml);
    };
    para.forEach((node) => {
      const deleted = node.marks?.some((m) => m.type.name === 'deletion');
      switch (node.type.name) {
        case 'text': wrapIn(node, textRun(node, node.text, deleted)); break;
        case 'tab': {
          const pt = node.attrs.ptab;
          wrapIn(node, runXml(node, pt ? `<w:ptab w:relativeTo="${pt.relativeTo || 'margin'}" w:alignment="${pt.alignment || 'left'}" w:leader="${pt.leader || 'none'}"/>` : '<w:tab/>'));
          break;
        }
        case 'hard_break': wrapIn(node, runXml(node, '<w:br/>')); break;
        case 'field': wrapIn(node, fieldXml(st, node)); break;
        case 'note': {
          const cls = node.attrs.noteClass === 'endnote' ? 'endnote' : 'footnote';
          const id = notes[cls].length + 1;
          notes[cls].push({ id, body: node.attrs.body || [] });
          wrapIn(node, `<w:r><w:rPr><w:rStyle w:val="${cls === 'footnote' ? 'FootnoteReference' : 'EndnoteReference'}"/></w:rPr><w:${cls}Reference w:id="${id}"/></w:r>`);
          break;
        }
        case 'annotation': {
          flush();
          const id = comments.length;
          comments.push({ id, attrs: node.attrs });
          commentIds.set(node.attrs.name, id);
          // A comment without a range ends where it starts.
          if (!hasEnd(node.attrs.name)) out.push(`<w:commentRangeStart w:id="${id}"/><w:commentRangeEnd w:id="${id}"/><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="${id}"/></w:r>`);
          else out.push(`<w:commentRangeStart w:id="${id}"/>`);
          break;
        }
        case 'annotation_end': {
          flush();
          const id = commentIds.get(node.attrs.name);
          if (id != null) out.push(`<w:commentRangeEnd w:id="${id}"/><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="${id}"/></w:r>`);
          break;
        }
        case 'bookmark': {
          flush();
          const nm = node.attrs.name;
          if (node.attrs.element === 'text:bookmark-end') { const id = bookmarks.get(nm); if (id != null) out.push(`<w:bookmarkEnd w:id="${id}"/>`); break; }
          const id = bookmarkId++;
          bookmarks.set(nm, id);
          out.push(`<w:bookmarkStart w:id="${id}" w:name="${esc(nm)}"/>`);
          if (node.attrs.element !== 'text:bookmark-start') out.push(`<w:bookmarkEnd w:id="${id}"/>`);
          break;
        }
        case 'frame': wrapIn(node, frameXml(st, node)); break;
        default: if (node.isText || node.isLeaf) { const t = node.textContent; if (t) wrapIn(node, textRun(node, t, deleted)); }
      }
    });
    flush();
    return out.join('');
  }

  // Comment ids by annotation name (so the end finds its start).
  const commentIds = new Map();
  const ends = new Set();
  const collectEnds = (doc) => doc.descendants((n) => { if (n.type.name === 'annotation_end') ends.add(n.attrs.name); return true; });
  const hasEnd = (name) => ends.has(name);

  // ---------------------------------------------------------------- blocks

  /** Word's pPr for a paragraph node (its style, direct formatting, list numbering). */
  function paraXml(st, node, extra = {}) {
    const style = wordStyle('paragraph', node.attrs.styleName || 'Standard', index);
    const pp = node.attrs.auto?.props?.['style:paragraph-properties'] || {};
    const a = { ...(pp.a || {}) };
    delete a['style:page-number'];
    // A paragraph with numbering: the list gives the indents.
    if (extra.numPr) { delete a['fo:margin-left']; delete a['fo:text-indent']; }
    const sectPr = extra.sectPr || (pendingSect?.node === node ? pendingSect.xml : null);
    if (sectPr && pendingSect?.node === node) pendingSect = null;
    const ppr = pPrXml(a, pp.c || [], { style: style.id === 'Normal' ? null : style.id, numPr: extra.numPr, sectPr, rPr: rPrXml(node.attrs.auto?.props?.['style:text-properties']?.a || {}) });
    const prefix = extra.prefix || '';
    const suffix = extra.suffix || '';
    const saved = paraText;
    paraText = node.attrs.auto?.props?.['style:text-properties']?.a || {};
    const runs = inlineXml(st, node);
    paraText = saved;
    return `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${prefix}${runs}${suffix}</w:p>`;
  }

  /** Blocks (JSON or nodes) → XML. */
  function blocksXml(st, blocks, opts = {}) {
    const nodes = Array.isArray(blocks) ? blocks.map((b) => (b?.type?.name ? b : schemaNode(b))).filter(Boolean) : [];
    return seqXml(st, nodes, opts);
  }

  /**
   * Sibling blocks → XML. A paragraph that only differs from the one before
   * it by starting on a new page is the rest of that paragraph after a page
   * break (the reader splits paragraphs there): they are written back as one
   * paragraph with <w:br w:type="page"/>.
   */
  function seqXml(st, nodes, opts = {}) {
    const groups = [];
    const sameBut = (a, b) => {
      if (!a?.isTextblock || !b?.isTextblock || a.type !== b.type || a.attrs.styleName !== b.attrs.styleName) return false;
      const pb = b.attrs.auto?.props?.['style:paragraph-properties']?.a || {};
      if (pb['fo:break-before'] !== 'page' || b.attrs.auto?.styleAttrs?.['style:master-page-name']) return false;
      const strip = (auto) => {
        const x = structuredClone(auto || { styleAttrs: {}, props: {} });
        x.styleAttrs ||= {};
        x.props ||= {};
        const pp = x.props['style:paragraph-properties'];
        if (pp?.a) { delete pp.a['fo:break-before']; delete pp.a['style:page-number']; if (!Object.keys(pp.a).length && !pp.c?.length) delete x.props['style:paragraph-properties']; }
        delete x.styleAttrs['style:master-page-name'];
        return JSON.stringify(x);
      };
      return strip(a.attrs.auto) === strip(b.attrs.auto);
    };
    for (const n of nodes) {
      const last = groups[groups.length - 1];
      if (last && sameBut(last[last.length - 1], n)) last.push(n); else groups.push([n]);
    }
    return groups.map((g) => (g.length === 1 ? blockXml(st, g[0], opts) : paraGroupXml(st, g))).join('');
  }

  /** Paragraphs joined by page breaks, written as one. */
  function paraGroupXml(st, nodes) {
    const carrier = nodes.find((n) => pendingSect?.node === n);
    const extra = carrier ? { sectPr: pendingSect.xml } : {};
    if (carrier) pendingSect = null;
    const first = paraXml(st, nodes[0], extra);
    const rest = nodes.slice(1).map((n) => {
      const saved = paraText;
      paraText = n.attrs.auto?.props?.['style:text-properties']?.a || {};
      const runs = inlineXml(st, n);
      paraText = saved;
      return `<w:r><w:br w:type="page"/></w:r>${runs}`;
    }).join('');
    return first.replace(/<\/w:p>$/, `${rest}</w:p>`);
  }

  function blockXml(st, node, opts = {}) {
    switch (node.type.name) {
      case 'paragraph': case 'heading': return paraXml(st, node, opts.paraExtra?.(node) || {});
      case 'list': return listXml(st, node, 0, null, opts);
      case 'table': return tableXml(st, node);
      case 'section': return seqXml(st, childrenOf(node), opts);
      case 'index': return indexXml(st, node, opts);
      default: {
        // Unknown blocks: their paragraphs.
        let s = '';
        node.forEach((c) => { if (c.isBlock) s += blockXml(st, c, opts); });
        return s;
      }
    }
  }

  function listXml(st, list, depth, numId, opts) {
    const styleName = list.attrs.styleName || opts.listStyle;
    // A nested list of the same style is a deeper level of the same numbering.
    if (depth === 0 || (list.attrs.styleName && list.attrs.styleName !== opts.listStyle)) numId = numbering.instance(list, styleName, null);
    let s = '';
    list.forEach((item) => {
      let first = true;
      item.forEach((child) => {
        if (child.type.name === 'list') { s += listXml(st, child, depth + 1, numId, { ...opts, listStyle: styleName }); return; }
        if (child.isTextblock) {
          const numPr = first && !item.attrs.header && numId ? `<w:numPr><w:ilvl w:val="${Math.min(8, depth)}"/><w:numId w:val="${numId}"/></w:numPr>` : null;
          s += paraXml(st, child, { numPr });
          first = false;
        } else s += blockXml(st, child, opts);
      });
    });
    return s;
  }

  function tableXml(st, table) {
    const ta = table.attrs.auto?.props?.['style:table-properties']?.a || {};
    const cols = (table.attrs.columns || []).flatMap((c) => Array.from({ length: Number(c.repeat) || 1 }, () => c));
    const widths = cols.map((c) => Math.round((toPx(String(c.width || '')) || toPx(c.auto?.props?.['style:table-column-properties']?.a?.['style:column-width'] || '') || 96) * 15));
    const total = widths.reduce((x, y) => x + y, 0) || tw(ta['style:width'] || '16cm');
    const jc = { center: 'center', right: 'right' }[ta['table:align']];
    const ind = ta['table:align'] === 'left' && isLen(ta['fo:margin-left']) ? tw(ta['fo:margin-left']) : 0;
    // Table borders (the cells' own borders, written on every cell, win): outer edges and inside lines from the corner cells.
    const ca = (cell) => cell?.attrs.auto?.props?.['style:table-cell-properties']?.a || {};
    const side = (cell, s) => ca(cell)[`fo:border-${s}`] ?? ca(cell)['fo:border'];
    const r0 = table.firstChild;
    const rN = table.lastChild;
    const tb = [['top', side(r0?.firstChild, 'top')], ['left', side(r0?.firstChild, 'left')], ['bottom', side(rN?.firstChild, 'bottom')], ['right', side(r0?.lastChild, 'right')],
      ['insideH', table.childCount > 1 ? side(r0?.firstChild, 'bottom') : null], ['insideV', r0?.childCount > 1 ? side(r0?.firstChild, 'right') : null]].map(([k, v]) => borderEl(k, v)).join('');
    const tblPr = `<w:tblPr><w:tblW w:w="${total}" w:type="dxa"/>${jc ? `<w:jc w:val="${jc}"/>` : ''}${ind ? `<w:tblInd w:w="${ind}" w:type="dxa"/>` : ''}${tb ? `<w:tblBorders>${tb}</w:tblBorders>` : ''}<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>`;
    const grid = `<w:tblGrid>${(widths.length ? widths : [total]).map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`;
    // Merged cells: a cell spanning rows is continued (w:vMerge) in the rows below.
    const spans = []; // column → remaining rows of a vertical merge { left, cell }
    let rowsXml = '';
    table.forEach((row) => {
      const ra = row.attrs.auto?.props?.['style:table-row-properties']?.a || {};
      const trPr = [];
      if (ra['fo:keep-together'] === 'always') trPr.push('<w:cantSplit/>');
      if (isLen(ra['style:row-height'])) trPr.push(`<w:trHeight w:val="${tw(ra['style:row-height'])}" w:hRule="exact"/>`);
      else if (isLen(ra['style:min-row-height'])) trPr.push(`<w:trHeight w:val="${tw(ra['style:min-row-height'])}"/>`);
      if (row.attrs.header) trPr.push('<w:tblHeader/>');
      let cells = '';
      let col = 0;
      const continuation = (c) => {
        const sp = spans[c];
        const span = sp.cell.attrs.colspan || 1;
        cells += cellXml(st, sp.cell, widths.slice(c, c + span).reduce((x, y) => x + y, 0), '<w:vMerge/>', true);
        sp.left--;
        if (!sp.left) for (let k = 0; k < span; k++) spans[c + k] = null;
        return span;
      };
      row.forEach((cell) => {
        while (spans[col]) col += continuation(col);
        const span = cell.attrs.colspan || 1;
        const rows = cell.attrs.rowspan || 1;
        cells += cellXml(st, cell, widths.slice(col, col + span).reduce((x, y) => x + y, 0), rows > 1 ? '<w:vMerge w:val="restart"/>' : '');
        if (rows > 1) for (let k = 0; k < span; k++) spans[col + k] = { left: rows - 1, cell };
        col += span;
      });
      while (col < spans.length) { if (spans[col]) col += continuation(col); else col++; }
      rowsXml += `<w:tr>${trPr.length ? `<w:trPr>${trPr.join('')}</w:trPr>` : ''}${cells}</w:tr>`;
    });
    // A paragraph must follow a table in a cell or before a section break: the caller adds one where needed.
    return `<w:tbl>${tblPr}${grid}${rowsXml}</w:tbl>`;
  }

  function cellXml(st, cell, width, vMerge, empty = false) {
    const ca = cell.attrs.auto?.props?.['style:table-cell-properties']?.a || {};
    const tcPr = [`<w:tcW w:w="${width || 1440}" w:type="dxa"/>`];
    if ((cell.attrs.colspan || 1) > 1) tcPr.push(`<w:gridSpan w:val="${cell.attrs.colspan}"/>`);
    if (vMerge) tcPr.push(vMerge);
    const b = ['top', 'left', 'bottom', 'right'].map((s) => borderEl(s, ca[`fo:border-${s}`] ?? ca['fo:border'])).join('');
    if (b) tcPr.push(`<w:tcBorders>${b}</w:tcBorders>`);
    const bg = ca['fo:background-color'];
    if (bg && bg !== 'transparent') tcPr.push(`<w:shd w:val="clear" w:color="auto" w:fill="${hex(bg)}"/>`);
    const mar = ['top', 'left', 'bottom', 'right'].map((s) => { const v = ca[`fo:padding-${s}`] ?? ca['fo:padding']; return v ? `<w:${s} w:w="${tw(v)}" w:type="dxa"/>` : ''; }).join('');
    if (mar) tcPr.push(`<w:tcMar>${mar}</w:tcMar>`);
    const wm = ca['style:writing-mode'];
    if (wm === 'tb-rl') tcPr.push('<w:textDirection w:val="tbRl"/>');
    else if (wm === 'bt-lr') tcPr.push('<w:textDirection w:val="btLr"/>');
    const va = { middle: 'center', bottom: 'bottom', top: 'top' }[ca['style:vertical-align']];
    if (va) tcPr.push(`<w:vAlign w:val="${va}"/>`);
    let body = empty ? '<w:p/>' : '';
    if (!empty) {
      body += seqXml(st, childrenOf(cell));
      // A cell ends with a paragraph.
      if (!cell.lastChild || cell.lastChild.type.name === 'table') body += '<w:p/>';
    }
    return `<w:tc><w:tcPr>${tcPr.join('')}</w:tcPr>${body}</w:tc>`;
  }

  /** A table of contents: a TOC field around its entries (their text is the field's result). */
  function indexXml(st, node, opts) {
    if (node.attrs.element !== 'text:table-of-content') { let s = ''; node.forEach((c) => { s += blockXml(st, c, opts); }); return s; }
    const o = tocOptions(node.attrs.source);
    const instr = `TOC \\o "1-${o.levels}"${o.links ? ' \\h' : ''} \\z \\u${o.pageNumbers ? '' : ' \\n'}`;
    const children = [];
    node.forEach((c) => children.push(c));
    const title = node.attrs.titleCount ? children.slice(0, node.attrs.titleCount) : [];
    const entries = children.slice(title.length);
    let s = title.map((c) => blockXml(st, c, opts)).join('');
    const begin = `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${esc(instr)} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>`;
    const end = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
    if (!entries.length) return `${s}<w:p>${begin}${end}</w:p>`;
    entries.forEach((c, i) => {
      if (!c.isTextblock) { s += blockXml(st, c, opts); return; }
      s += paraXml(st, c, { prefix: i === 0 ? begin : '', suffix: i === entries.length - 1 ? end : '' });
    });
    return `<w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="Table of Contents"/><w:docPartUnique/></w:docPartObj></w:sdtPr><w:sdtContent>${s}</w:sdtContent></w:sdt>`;
  }

  let schemaNode = null; // set below (schema from the document)
  let pendingSect = null; // { node, xml }: the paragraph that carries a section break
  /** The last paragraph of some blocks, outside tables, notes and text boxes. */
  const lastParagraph = (blocks) => {
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i];
      if (b.isTextblock) return b;
      if (b.type.name === 'table') return null;
      const kids = childrenOf(b).filter((c) => c.isBlock);
      const f = lastParagraph(kids);
      if (f) return f;
      if (kids.length) return null;
    }
    return null;
  };

  // ---------------------------------------------------------------- sections

  const masters = new Map((state.masterStyles?.c || []).filter((m) => typeof m !== 'string' && m.n === 'style:master-page').map((m) => [m.a['style:name'], m]));
  const layoutOf = (m) => (state.stylesAutoStyles?.c || []).find((t) => t.n === 'style:page-layout' && t.a['style:name'] === m?.a['style:page-layout-name']);
  const masterOfNode = (node) => {
    if (!node?.isTextblock) {
      if (node?.type.name === 'table') return node.attrs.auto?.styleAttrs?.['style:master-page-name'] || null;
      return null;
    }
    return node.attrs.auto?.styleAttrs?.['style:master-page-name'] || index?.families.get('paragraph')?.get(node.attrs.styleName)?.a['style:master-page-name'] || null;
  };
  const firstTextblock = (node) => { if (!node) return null; if (node.isTextblock || node.type.name === 'table') return node; for (let i = 0; i < node.childCount; i++) { const f = firstTextblock(node.child(i)); if (f) return f; } return null; };

  /** Word sections: [{ blocks, master, cols, type, start }] from page-style changes and column sections. */
  function wordSections(doc) {
    const out = [];
    const firstMaster = masterOfNode(firstTextblock(doc)) || (masters.has('Standard') ? 'Standard' : [...masters.keys()][0] || 'Standard');
    let cur = { blocks: [], master: firstMaster, cols: null, type: 'nextPage' };
    const startOf = (node) => { const pn = firstTextblock(node)?.attrs.auto?.props?.['style:paragraph-properties']?.a?.['style:page-number']; return pn && pn !== 'auto' ? Number(pn) : null; };
    doc.forEach((node) => {
      const m = masterOfNode(firstTextblock(node));
      const cols = node.type.name === 'section' ? sectionCols(node) : null;
      if (cols && cols.count > 1) {
        if (cur.blocks.length) out.push(cur);
        const sec = { blocks: [...childrenOf(node)], master: m || cur.master, cols, type: m && cur.blocks.length ? 'nextPage' : (out.length || cur.blocks.length ? 'continuous' : 'nextPage'), start: startOf(node) };
        if (m && !cur.blocks.length && !out.length) sec.type = 'nextPage';
        out.push(sec);
        cur = { blocks: [], master: sec.master, cols: null, type: 'continuous' };
        return;
      }
      if (m && (cur.blocks.length || out.length)) {
        if (cur.blocks.length) out.push(cur);
        cur = { blocks: [node], master: m, cols: null, type: 'nextPage', start: startOf(node) };
        return;
      }
      if (m) cur.master = m;
      if (!cur.blocks.length && cur.start == null) cur.start = startOf(node);
      cur.blocks.push(node);
    });
    if (cur.blocks.length || !out.length) out.push(cur);
    for (const s of out) {
      const usage = layoutOf(masters.get(s.master))?.a?.['style:page-usage'];
      if (s.type === 'nextPage' && usage === 'left') s.type = 'evenPage';
      if (s.type === 'nextPage' && usage === 'right') s.type = 'oddPage';
    }
    return out;
  }
  const childrenOf = (node) => { const a = []; node.forEach((c) => a.push(c)); return a; };
  function sectionCols(node) {
    const t = index?.autos.get(`section:${node.attrs.styleName}`) || (state.contentAutoStyles || []).find((x) => x.n === 'style:style' && x.a['style:family'] === 'section' && x.a['style:name'] === node.attrs.styleName);
    const sp = t && findChild(t, 'style:section-properties');
    const cols = sp && findChild(sp, 'style:columns');
    if (!cols) return null;
    return { count: Number(cols.a['fo:column-count'] || 1), gap: cols.a['fo:column-gap'] || '1.27cm', sep: !!findChild(cols, 'style:column-sep') };
  }

  /** Header / footer parts already in effect (Word inherits them into sections that have none). */
  const written = { header: {}, footer: {} };
  let anyEven = false;
  let hfCount = 0;

  function partXml(part, tree) {
    hfCount++;
    const path = `word/${part}${hfCount}.xml`;
    const st = story(path);
    let body = '';
    if (tree) {
      const doc = partDoc(tree);
      body = doc ? blocksXml(st, childrenOf(doc)) : '';
    }
    files[path] = strToU8(`${DECL}<w:${part === 'header' ? 'hdr' : 'ftr'} ${NS}>${body || `<w:p><w:pPr><w:pStyle w:val="${part === 'header' ? 'Header' : 'Footer'}"/></w:pPr></w:p>`}</w:${part === 'header' ? 'hdr' : 'ftr'}>`);
    overrides.push([`/${path}`, `${CT}.${part}+xml`]);
    return path;
  }
  let partDoc = () => null; // set by the caller (needs the ODF converter)

  function sectPrXml(sec) {
    const m = masters.get(sec.master) || [...masters.values()][0];
    const layout = layoutOf(m);
    const p = layout ? findChild(layout, 'style:page-layout-properties')?.a || {} : {};
    const hs = layout && findChild(layout, 'style:header-style');
    const fs = layout && findChild(layout, 'style:footer-style');
    const hp = hs ? findChild(hs, 'style:header-footer-properties')?.a || {} : {};
    const fp = fs ? findChild(fs, 'style:header-footer-properties')?.a || {} : {};
    const kids = (m?.c || []).filter((c) => typeof c !== 'string');
    const has = (n) => kids.find((c) => c.n === n && c.a?.['style:display'] !== 'false');
    const refs = [];
    const titlePg = !!(has('style:header-first') || has('style:footer-first'));
    for (const part of ['header', 'footer']) {
      const variants = { default: has(`style:${part}`), first: has(`style:${part}-first`), even: has(`style:${part}-left`) };
      if (variants.even) anyEven = true;
      for (const type of ['default', 'even', 'first']) {
        const tree = variants[type];
        // A part this section doesn't have but an earlier one wrote would be inherited: write an empty one.
        if (!tree && !written[part][type]) continue;
        const path = partXml(part, tree || null);
        written[part][type] = path;
        refs.push(`<w:${part}Reference w:type="${type}" r:id="${docStory.rel(part, path.replace('word/', ''))}"/>`);
      }
    }
    const hasHeader = !!has('style:header') || !!has('style:header-first');
    const hasFooter = !!has('style:footer') || !!has('style:footer-first');
    const w = tw(p['fo:page-width'] || '21cm');
    const h = tw(p['fo:page-height'] || '29.7cm');
    const landscape = p['style:print-orientation'] === 'landscape' || w > h;
    const mt = tw(p['fo:margin-top'] || '2cm');
    const mb = tw(p['fo:margin-bottom'] || '2cm');
    // ODF's top margin reaches the header; Word's reaches the body.
    const top = hasHeader ? mt + tw(hp['fo:min-height'] || hp['svg:height'] || '0cm') + tw(hp['fo:margin-bottom'] || '0cm') : mt;
    const bottom = hasFooter ? mb + tw(fp['fo:min-height'] || fp['svg:height'] || '0cm') + tw(fp['fo:margin-top'] || '0cm') : mb;
    const cols = sec.cols && sec.cols.count > 1 ? `<w:cols w:num="${sec.cols.count}" w:space="${tw(sec.cols.gap)}"${sec.cols.sep ? ' w:sep="1"' : ''}/>` : '<w:cols w:space="720"/>';
    return `<w:sectPr>${refs.join('')}<w:type w:val="${sec.type}"/><w:pgSz w:w="${w}" w:h="${h}"${landscape ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="${top}" w:right="${tw(p['fo:margin-right'] || '2cm')}" w:bottom="${bottom}" w:left="${tw(p['fo:margin-left'] || '2cm')}" w:header="${hasHeader ? mt : 708}" w:footer="${hasFooter ? mb : 708}" w:gutter="0"/>${sec.start != null ? `<w:pgNumType w:start="${sec.start}"/>` : ''}${cols}${titlePg ? '<w:titlePg/>' : ''}<w:docGrid w:linePitch="360"/></w:sectPr>`;
  }

  // ---------------------------------------------------------------- document

  const docStory = story('word/document.xml');
  return {
    files, overrides, parts, media, notes, comments, numbering, commentIds, ends,
    setSchemaNode: (fn) => { schemaNode = fn; },
    setPartDoc: (fn) => { partDoc = fn; },
    build(doc) {
      collectEnds(doc);
      const sections = wordSections(doc);
      let body = '';
      sections.forEach((sec, i) => {
        const last = i === sections.length - 1;
        const sp = sectPrXml(sec);
        // The section break goes in the section's last paragraph (not one inside a table).
        const carrier = last ? null : lastParagraph(sec.blocks);
        pendingSect = carrier ? { node: carrier, xml: sp } : null;
        let xml = seqXml(docStory, sec.blocks);
        // No paragraph to carry it: one of its own.
        if (!last && pendingSect) xml += `<w:p><w:pPr>${sp}</w:pPr></w:p>`;
        if (!last && !carrier) xml += `<w:p><w:pPr>${sp}</w:pPr></w:p>`;
        pendingSect = null;
        body += xml;
        if (last) body += sp;
      });
      return { body, anyEven };
    },
    docStory, story, blocksXml, inlineXml,
  };
}

// ------------------------------------------------------------ numbering

const NUM_FMT = { '1': 'decimal', a: 'lowerLetter', A: 'upperLetter', i: 'lowerRoman', I: 'upperRoman', '': 'none' };

/** numbering.xml: one abstractNum per list style, one w:num per list (with a start override; a continued list reuses its num). */
function createNumbering(index) {
  const abstracts = new Map(); // style name → { id, xml }
  const nums = []; // { id, abstractId, override }
  const lastNum = new Map(); // style → numId of its last list
  // Numbers of WWNum<n> styles are kept for them.
  const reserved = new Set([...(index?.lists?.keys() || [])].map((k) => /^WWNum(\d+)$/.exec(k)?.[1]).filter(Boolean).map(Number));
  const levelXml = (lvl, i) => {
    const lp = findChild(lvl, 'style:list-level-properties');
    const lab = lp && findChild(lp, 'style:list-level-label-alignment');
    const tp = findChild(lvl, 'style:text-properties');
    let fmt;
    let text;
    if (lvl.n === 'text:list-level-style-bullet') { fmt = 'bullet'; text = lvl.a['text:bullet-char'] || '•'; } else if (lvl.n === 'text:list-level-style-number') {
      fmt = NUM_FMT[lvl.a['style:num-format'] ?? '1'] || 'decimal';
      const shown = Math.min(i + 1, Number(lvl.a['text:display-levels'] || 1));
      const parts = [];
      for (let k = i + 1 - shown; k <= i; k++) parts.push(`%${k + 1}`);
      text = fmt === 'none' ? '' : `${lvl.a['style:num-prefix'] || ''}${parts.join('.')}${lvl.a['style:num-suffix'] || ''}`;
    } else { fmt = 'none'; text = ''; }
    const start = Number(lvl.a['text:start-value'] || 1);
    const follow = lab?.a?.['text:label-followed-by'] || 'listtab';
    const jc = { end: 'right', right: 'right', center: 'center' }[lp?.a?.['fo:text-align']] || 'left';
    let ind = '';
    if (lab && isLen(lab.a['fo:margin-left'])) {
      const left = tw(lab.a['fo:margin-left']);
      const ti = tw(lab.a['fo:text-indent'] || '0cm');
      ind = `<w:pPr><w:ind w:left="${left}" ${ti < 0 ? `w:hanging="${-ti}"` : `w:firstLine="${ti}"`}/></w:pPr>`;
    } else if (lp) {
      const before = tw(lp.a['text:space-before'] || '0cm');
      const width = tw(lp.a['text:min-label-width'] || '0cm');
      ind = `<w:pPr><w:ind w:left="${before + width}" w:hanging="${width}"/></w:pPr>`;
    }
    const rPr = tp ? rPrXml(tp.a) : '';
    return `<w:lvl w:ilvl="${i}"><w:start w:val="${start}"/><w:numFmt w:val="${fmt}"/>${follow !== 'listtab' ? `<w:suff w:val="${follow === 'space' ? 'space' : 'nothing'}"/>` : ''}<w:lvlText w:val="${esc(text)}"/><w:lvlJc w:val="${jc}"/>${ind}${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}</w:lvl>`;
  };
  const abstractFor = (name) => {
    if (abstracts.has(name)) return abstracts.get(name);
    const tree = index?.lists.get(name);
    const levels = (tree?.c || []).filter((c) => typeof c !== 'string' && c.a?.['text:level']).sort((x, y) => Number(x.a['text:level']) - Number(y.a['text:level'])).slice(0, 9);
    const id = abstracts.size;
    const xml = `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="${levels.length > 1 ? 'multilevel' : 'singleLevel'}"/>${levels.map((l, i) => levelXml(l, i)).join('') || levelXml({ n: 'text:list-level-style-bullet', a: { 'text:bullet-char': '•' }, c: [] }, 0)}</w:abstractNum>`;
    const a = { id, xml, levels };
    abstracts.set(name, a);
    return a;
  };
  return {
    /** The numId of a (top-level) list: continuing lists reuse the last one of their style. */
    instance(list, styleName, parentNum) {
      if (!styleName) return parentNum || null;
      const a = abstractFor(styleName);
      const ex = list.attrs.extra || {};
      if (parentNum && !list.attrs.styleName) return parentNum;
      if ((ex['text:continue-numbering'] === 'true' || ex['text:continue-list']) && lastNum.has(styleName)) return lastNum.get(styleName);
      // Lists read from Word keep their numbers (WWNum<n> ↔ numId n).
      const want = /^WWNum(\d+)$/.exec(styleName);
      const taken = new Set(nums.map((n) => n.id));
      let id = want && !taken.has(Number(want[1])) ? Number(want[1]) : 1;
      while (!want && (taken.has(id) || reserved.has(id))) id++;
      if (want && taken.has(id)) { id = 1; while (taken.has(id) || reserved.has(id)) id++; }
      const start = Number(a.levels[0]?.a?.['text:start-value'] || 1);
      // A new list starts its numbering again (even the first of its kind says so).
      nums.push({ id, abstractId: a.id, override: start });
      lastNum.set(styleName, id);
      return id;
    },
    get empty() { return !nums.length; },
    xml() {
      return `${DECL}<w:numbering ${NS}>${[...abstracts.values()].map((a) => a.xml).join('')}${nums.map((n) => `<w:num w:numId="${n.id}"><w:abstractNumId w:val="${n.abstractId}"/>${n.override != null ? `<w:lvlOverride w:ilvl="0"><w:startOverride w:val="${n.override}"/></w:lvlOverride>` : ''}</w:num>`).join('')}</w:numbering>`;
    },
  };
}

// ------------------------------------------------------------ styles.xml

export function stylesXml(state, index) {
  const defTree = (state.commonStyles?.c || []).find((t) => typeof t !== 'string' && t.n === 'style:default-style' && t.a['style:family'] === 'paragraph');
  const def = defTree ? autoFromTree(defTree).auto : null;
  const dpp = def?.props?.['style:paragraph-properties'] || {};
  const dtp = { ...(def?.props?.['style:text-properties']?.a || {}) };
  const out = [];
  out.push(`<w:docDefaults><w:rPrDefault><w:rPr>${rPrXml(dtp)}</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr>${pPrXml(dpp.a || {}, dpp.c || [])}</w:pPr></w:pPrDefault></w:docDefaults>`);
  const seen = new Set();
  const styleXml = (family, tree) => {
    const name = tree.a['style:name'];
    const ws = wordStyle(family, name, index);
    if (seen.has(`${family}:${ws.id}`)) return '';
    seen.add(`${family}:${ws.id}`);
    const auto = autoFromTree(tree).auto;
    const parent = tree.a['style:parent-style-name'];
    const next = tree.a['style:next-style-name'];
    const pp = auto?.props?.['style:paragraph-properties'] || {};
    const tp = auto?.props?.['style:text-properties']?.a || {};
    const level = Number(tree.a['style:default-outline-level']) || 0;
    const based = parent ? wordStyle(family, parent, index).id : null;
    const ppr = family === 'paragraph' ? pPrXml(pp.a || {}, pp.c || [], { outline: level && level <= 9 ? level : 0 }) : '';
    const rpr = rPrXml(tp);
    return `<w:style w:type="${family === 'paragraph' ? 'paragraph' : 'character'}"${ws.id === 'Normal' ? ' w:default="1"' : ''} w:styleId="${esc(ws.id)}"><w:name w:val="${esc(ws.name)}"/>${based && based !== ws.id ? `<w:basedOn w:val="${esc(based)}"/>` : ''}${next && family === 'paragraph' ? `<w:next w:val="${esc(wordStyle('paragraph', next, index).id)}"/>` : ''}<w:qFormat/>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}</w:style>`;
  };
  // Normal first (Word's default paragraph style).
  const named = (state.commonStyles?.c || []).filter((t) => typeof t !== 'string' && t.n === 'style:style' && (t.a['style:family'] === 'paragraph' || t.a['style:family'] === 'text'));
  const std = named.find((t) => t.a['style:family'] === 'paragraph' && t.a['style:name'] === 'Standard');
  out.push(std ? styleXml('paragraph', std) : '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>');
  out.push('<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style>');
  out.push('<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>');
  for (const t of named) if (t !== std) out.push(styleXml(t.a['style:family'], t));
  // Styles the writer refers to.
  const need = [['character', 'FootnoteReference', 'footnote reference', '<w:rPr><w:vertAlign w:val="superscript"/></w:rPr>'], ['character', 'EndnoteReference', 'endnote reference', '<w:rPr><w:vertAlign w:val="superscript"/></w:rPr>'], ['character', 'CommentReference', 'annotation reference', '<w:rPr><w:sz w:val="16"/></w:rPr>'], ['paragraph', 'Header', 'header', '<w:pPr><w:tabs><w:tab w:val="center" w:pos="4513"/><w:tab w:val="right" w:pos="9026"/></w:tabs><w:spacing w:after="0"/></w:pPr>'], ['paragraph', 'Footer', 'footer', '<w:pPr><w:tabs><w:tab w:val="center" w:pos="4513"/><w:tab w:val="right" w:pos="9026"/></w:tabs><w:spacing w:after="0"/></w:pPr>'], ['paragraph', 'FootnoteText', 'footnote text', '<w:pPr><w:spacing w:after="0"/></w:pPr><w:rPr><w:sz w:val="20"/></w:rPr>'], ['paragraph', 'EndnoteText', 'endnote text', '<w:pPr><w:spacing w:after="0"/></w:pPr><w:rPr><w:sz w:val="20"/></w:rPr>']];
  for (const [type, id, name, body] of need) {
    const fam = type === 'character' ? 'text' : 'paragraph';
    if (seen.has(`${fam}:${id}`)) continue;
    seen.add(`${fam}:${id}`);
    out.push(`<w:style w:type="${type}" w:styleId="${id}"><w:name w:val="${name}"/>${type === 'paragraph' ? '<w:basedOn w:val="Normal"/>' : ''}${body}</w:style>`);
  }
  return `${DECL}<w:styles ${NS}>${out.join('')}</w:styles>`;
}

// ------------------------------------------------------------ package

/**
 * The complete .docx for a document state.
 * @param {object} state DocumentState
 * @param {object} index style index
 * @param {{ nodeFromJSON: Function, partDoc: Function }} helpers schema JSON → node; header/footer tree → document node
 */
export function writeDocx(state, index, helpers) {
  const w = createDocxWriter(state, index);
  w.setSchemaNode(helpers.nodeFromJSON);
  w.setPartDoc(helpers.partDoc);
  const { files, overrides } = w;
  const { body, anyEven } = w.build(state.doc);
  files['word/document.xml'] = strToU8(`${DECL}<w:document ${NS}><w:body>${body}</w:body></w:document>`);
  overrides.push(['/word/document.xml', `${CT}.document.main+xml`]);
  const ds = w.docStory;
  // Notes (after the body, which numbers them).
  for (const cls of ['footnote', 'endnote']) {
    const list = w.notes[cls];
    if (!list.length) continue;
    const path = `word/${cls}s.xml`;
    const st = w.story(path);
    const sep = `<w:${cls} w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:${cls}><w:${cls} w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:${cls}>`;
    const items = list.map((n) => {
      const nodes = (n.body || []).map((b) => helpers.nodeFromJSON(b)).filter(Boolean);
      const ref = `<w:r><w:rPr><w:rStyle w:val="${cls === 'footnote' ? 'FootnoteReference' : 'EndnoteReference'}"/></w:rPr><w:${cls}Ref/></w:r>`;
      let xml = '';
      nodes.forEach((node, i) => { xml += node.isTextblock && i === 0 ? w.blocksXml(st, [node]).replace(/(<w:p>(?:<w:pPr>.*?<\/w:pPr>)?)/, `$1${ref}`) : w.blocksXml(st, [node]); });
      return `<w:${cls} w:id="${n.id}">${xml || `<w:p>${ref}</w:p>`}</w:${cls}>`;
    });
    files[path] = strToU8(`${DECL}<w:${cls}s ${NS}>${sep}${items.join('')}</w:${cls}s>`);
    overrides.push([`/${path}`, `${CT}.${cls}s+xml`]);
    ds.rel(`${cls}s`, `${cls}s.xml`);
  }
  // Comments.
  if (w.comments.length) {
    const st = w.story('word/comments.xml');
    const items = w.comments.map((c) => {
      const nodes = (c.attrs.body || []).map((b) => helpers.nodeFromJSON(b)).filter(Boolean);
      const date = c.attrs.date ? ` w:date="${esc(/Z$/.test(c.attrs.date) ? c.attrs.date : `${c.attrs.date.replace(/\.\d+$/, '')}Z`)}"` : '';
      return `<w:comment w:id="${c.id}" w:author="${esc(c.attrs.creator || 'Unknown')}"${date} w:initials="${esc(c.attrs.initials || '')}">${w.blocksXml(st, nodes) || '<w:p/>'}</w:comment>`;
    });
    files['word/comments.xml'] = strToU8(`${DECL}<w:comments ${NS}>${items.join('')}</w:comments>`);
    overrides.push(['/word/comments.xml', `${CT}.comments+xml`]);
    ds.rel('comments', 'comments.xml');
  }
  if (!w.numbering.empty) {
    files['word/numbering.xml'] = strToU8(w.numbering.xml());
    overrides.push(['/word/numbering.xml', `${CT}.numbering+xml`]);
    ds.rel('numbering', 'numbering.xml');
  }
  files['word/styles.xml'] = strToU8(stylesXml(state, index));
  overrides.push(['/word/styles.xml', `${CT}.styles+xml`]);
  ds.rel('styles', 'styles.xml');
  // Settings: the default tab interval, even / odd headers.
  const defTree = (state.commonStyles?.c || []).find((t) => typeof t !== 'string' && t.n === 'style:default-style' && t.a['style:family'] === 'paragraph');
  const tabDist = defTree && findChild(defTree, 'style:paragraph-properties')?.a?.['style:tab-stop-distance'];
  files['word/settings.xml'] = strToU8(`${DECL}<w:settings ${NS}>${anyEven ? '<w:evenAndOddHeaders/>' : ''}<w:defaultTabStop w:val="${tabDist ? tw(tabDist) : 720}"/><w:characterSpacingControl w:val="doNotCompress"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`);
  overrides.push(['/word/settings.xml', `${CT}.settings+xml`]);
  ds.rel('settings', 'settings.xml');
  // Relationships of every story.
  for (const st of w.parts) {
    if (!st.rels.length) continue;
    const dir = st.path.slice(0, st.path.lastIndexOf('/') + 1);
    const name = st.path.slice(st.path.lastIndexOf('/') + 1);
    files[`${dir}_rels/${name}.rels`] = strToU8(`${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${st.rels.map((r) => `<Relationship Id="${r.id}" Type="${REL}/${r.type}" Target="${esc(r.target)}"${r.external ? ' TargetMode="External"' : ''}/>`).join('')}</Relationships>`);
  }
  // Properties.
  const meta = (n) => (state.meta?.c || []).filter((t) => typeof t !== 'string' && t.n === n).map((t) => (t.c || []).filter((x) => typeof x === 'string').join(''));
  const dt = (v) => (v ? `${v.replace(/\.\d+$/, '').replace(/Z?$/, 'Z')}` : '');
  const created = dt(meta('meta:creation-date')[0]);
  const modified = dt(meta('dc:date')[0]);
  files['docProps/core.xml'] = strToU8(`${DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${meta('dc:title')[0] ? `<dc:title>${esc(meta('dc:title')[0])}</dc:title>` : ''}${meta('dc:subject')[0] ? `<dc:subject>${esc(meta('dc:subject')[0])}</dc:subject>` : ''}${meta('meta:initial-creator')[0] ? `<dc:creator>${esc(meta('meta:initial-creator')[0])}</dc:creator>` : ''}${meta('meta:keyword').length ? `<cp:keywords>${esc(meta('meta:keyword').join(', '))}</cp:keywords>` : ''}${meta('dc:description')[0] ? `<dc:description>${esc(meta('dc:description')[0])}</dc:description>` : ''}${meta('dc:creator')[0] ? `<cp:lastModifiedBy>${esc(meta('dc:creator')[0])}</cp:lastModifiedBy>` : ''}${created ? `<dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created>` : ''}${modified ? `<dcterms:modified xsi:type="dcterms:W3CDTF">${modified}</dcterms:modified>` : ''}</cp:coreProperties>`);
  overrides.push(['/docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml']);
  files['docProps/app.xml'] = strToU8(`${DECL}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>${esc(helpers.generator || 'ODT Editor')}</Application></Properties>`);
  overrides.push(['/docProps/app.xml', 'application/vnd.openxmlformats-officedocument.extended-properties+xml']);
  files['_rels/.rels'] = strToU8(`${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/></Relationships>`);
  const exts = new Set([...w.media.values()].map((n) => n.split('.').pop()));
  const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff', emf: 'image/x-emf', wmf: 'image/x-wmf' };
  const ct = `${DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${[...exts].map((e) => `<Default Extension="${e}" ContentType="${MIME[e] || 'application/octet-stream'}"/>`).join('')}${overrides.map(([p, t]) => `<Override PartName="${p}" ContentType="${t}"/>`).join('')}</Types>`;
  return zipSync({ '[Content_Types].xml': strToU8(ct), ...files }, { level: 6 });
}
