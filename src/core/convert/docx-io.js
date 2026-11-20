/**
 * DOCX import (mammoth: Word → HTML, with Word's own paragraph styles mapped
 * to the document's styles) and DOCX export (the `docx` library): headings
 * and paragraph styles, alignment, indents and spacing, character formatting,
 * links, lists, tables (merged cells), pictures, footnotes, page breaks,
 * page size and margins, and plain-text headers and footers with page numbers.
 */
import { htmlToState } from './readers.js';
import { runFormat, paraFormat, framePicture, lengthPt } from './format.js';
import { pageLayout } from '../odt/styles.js';
import { findPart } from '../hf-content.js';

// ------------------------------------------------------------ import

const STYLE_MAP = [
  "p[style-name='Title'] => p.odt-s-Title:fresh",
  "p[style-name='Subtitle'] => p.odt-s-Subtitle:fresh",
  "p[style-name='Quote'] => p.odt-s-Quotations:fresh",
  "p[style-name='Intense Quote'] => p.odt-s-Quotations:fresh",
  "p[style-name='No Spacing'] => p.odt-s-No_20_Spacing:fresh",
  "p[style-name='Caption'] => p.odt-s-Caption:fresh",
  "r[style-name='Strong'] => strong",
  "r[style-name='Emphasis'] => em",
  'u => u',
  'strike => s',
];

export async function docxToState(bytes, lib) {
  const result = await lib.mammoth.convertToHtml({ arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }, { styleMap: STYLE_MAP, includeDefaultStyleMap: true });
  // Word paragraph styles → this document's styles.
  const html = result.value.replace(/<p class="odt-s-([\w]+)"/g, (_m, name) => `<p data-style="${name}"`)
    // Tables get the usual thin borders (mammoth leaves formatting out).
    .replace(/<table>/g, '<table border="1">');
  const state = htmlToState(html);
  return { state, messages: result.messages || [] };
}

// ------------------------------------------------------------ export

const halfPoints = (ptv) => Math.round(ptv * 2);
const twip = (ptv) => Math.round(ptv * 20);
const hex = (c) => String(c || '').replace('#', '').toUpperCase() || undefined;
const HIGHLIGHTS = { '#ffff00': 'yellow', '#00ff00': 'green', '#00ffff': 'cyan', '#ff00ff': 'magenta', '#0000ff': 'blue', '#ff0000': 'red', '#000080': 'darkBlue', '#008080': 'darkCyan', '#008000': 'darkGreen', '#800080': 'darkMagenta', '#800000': 'darkRed', '#808000': 'darkYellow', '#808080': 'darkGray', '#c0c0c0': 'lightGray', '#000000': 'black' };

export async function stateToDocx(state, index, lib) {
  const D = lib.docx;
  const footnotes = {};
  let noteId = 0;
  const HEAD = [null, D.HeadingLevel.HEADING_1, D.HeadingLevel.HEADING_2, D.HeadingLevel.HEADING_3, D.HeadingLevel.HEADING_4, D.HeadingLevel.HEADING_5, D.HeadingLevel.HEADING_6, D.HeadingLevel.HEADING_6, D.HeadingLevel.HEADING_6, D.HeadingLevel.HEADING_6];
  const ALIGN = { left: D.AlignmentType.LEFT, center: D.AlignmentType.CENTER, right: D.AlignmentType.RIGHT, justify: D.AlignmentType.JUSTIFIED };

  const imageType = (mt) => (/png/.test(mt) ? 'png' : /jpe?g/.test(mt) ? 'jpg' : /gif/.test(mt) ? 'gif' : /bmp/.test(mt) ? 'bmp' : null);

  function runs(node) {
    const out = [];
    node.forEach((ch) => {
      if (ch.isText) {
        if (ch.marks.some((m) => m.type.name === 'deletion')) return;
        const f = runFormat(ch, node, index);
        const opts = {
          text: ch.text, bold: f.bold || undefined, italics: f.italic || undefined, underline: f.underline ? {} : undefined, strike: f.strike || undefined,
          subScript: f.sub || undefined, superScript: f.sup || undefined, size: f.sizePt ? halfPoints(f.sizePt) : undefined, color: f.colour ? hex(f.colour) : undefined,
          font: f.font || undefined, highlight: f.highlight ? HIGHLIGHTS[f.highlight.toLowerCase()] : undefined,
          shading: f.highlight && !HIGHLIGHTS[f.highlight.toLowerCase()] ? { type: D.ShadingType.CLEAR, fill: hex(f.highlight), color: 'auto' } : undefined,
        };
        if (f.link) out.push(new D.ExternalHyperlink({ link: f.link, children: [new D.TextRun({ ...opts, style: 'Hyperlink' })] }));
        else out.push(new D.TextRun(opts));
      } else if (ch.type.name === 'hard_break') out.push(new D.TextRun({ break: 1 }));
      else if (ch.type.name === 'tab') out.push(new D.TextRun({ children: [new D.Tab()] }));
      else if (ch.type.name === 'field') out.push(new D.TextRun({ text: ch.attrs.text || ch.textContent || '' }));
      else if (ch.type.name === 'frame') {
        const pic = framePicture(ch, state);
        const type = pic && imageType(pic.mediaType);
        if (type) out.push(new D.ImageRun({ type, data: pic.bytes, transformation: { width: Math.round(pic.widthPt * 96 / 72), height: Math.round(pic.heightPt * 96 / 72) }, altText: pic.alt ? { name: pic.alt, title: pic.alt, description: pic.alt } : undefined }));
      } else if (ch.type.name === 'note') {
        const id = ++noteId;
        const body = (ch.attrs.body || []).map((b) => new D.Paragraph({ children: [new D.TextRun({ text: textOfJson(b) })] }));
        footnotes[id] = { children: body.length ? body : [new D.Paragraph('')] };
        out.push(new D.FootnoteReferenceRun(id));
      }
    });
    return out;
  }

  function paragraph(node, extra = {}) {
    const f = paraFormat(node, index);
    return new D.Paragraph({
      children: runs(node),
      heading: f.title ? D.HeadingLevel.TITLE : (f.level ? HEAD[f.level] : undefined),
      alignment: ALIGN[f.align],
      indent: (f.indentLeftPt || f.indentRightPt || f.firstLinePt) && !extra.numbering ? { left: twip(f.indentLeftPt), right: twip(f.indentRightPt), firstLine: f.firstLinePt > 0 ? twip(f.firstLinePt) : undefined, hanging: f.firstLinePt < 0 ? twip(-f.firstLinePt) : undefined } : undefined,
      spacing: f.beforePt != null || f.afterPt != null ? { before: f.beforePt != null ? twip(f.beforePt) : undefined, after: f.afterPt != null ? twip(f.afterPt) : undefined } : undefined,
      pageBreakBefore: f.pageBreak || undefined,
      ...extra,
    });
  }

  function blocks(fragment, level = -1, ordered = false) {
    const out = [];
    fragment.forEach((node) => {
      const name = node.type.name;
      if (node.isTextblock) out.push(level >= 0 ? paragraph(node, { numbering: { reference: ordered ? 'numbers' : 'bullets', level: Math.min(8, level) } }) : paragraph(node));
      else if (name === 'list') node.forEach((item) => item.forEach((child) => { out.push(...(child.type.name === 'list' ? blocks(item.type.schema.nodes.doc.create(null, child).content, level + 1, child.attrs.ordered) : blocks(item.type.schema.nodes.doc.create(null, child).content, level + 1, node.attrs.ordered))); }));
      else if (name === 'table') out.push(table(node));
      else if (name === 'section' || name === 'index') out.push(...blocks(node.content, level, ordered));
    });
    return out;
  }

  function table(node) {
    const rows = [];
    node.forEach((row) => {
      const cells = [];
      row.forEach((cell) => {
        const content = blocks(cell.content);
        cells.push(new D.TableCell({ children: content.length ? content : [new D.Paragraph('')], columnSpan: cell.attrs.colspan > 1 ? cell.attrs.colspan : undefined, rowSpan: cell.attrs.rowspan > 1 ? cell.attrs.rowspan : undefined }));
      });
      rows.push(new D.TableRow({ children: cells, tableHeader: row.attrs.header || undefined }));
    });
    return new D.Table({ rows, width: { size: 100, type: D.WidthType.PERCENTAGE } });
  }

  // Headers / footers of the first page style, as text with page numbers.
  const pl = pageLayout(state);
  const master = (state.masterStyles?.c || []).find((m) => typeof m !== 'string' && m.n === 'style:master-page');
  const partParagraphs = (part) => {
    const { tree } = findPart(state, master?.a['style:name'], part, 'right');
    if (!tree) return null;
    const paras = [];
    const walk = (t) => {
      if (typeof t === 'string') return;
      if (t.n === 'text:p' || t.n === 'text:h') {
        const children = [];
        const inline = (x) => {
          if (typeof x === 'string') { children.push(new D.TextRun(x)); return; }
          if (x.n === 'text:page-number') children.push(new D.TextRun({ children: [D.PageNumber.CURRENT] }));
          else if (x.n === 'text:page-count') children.push(new D.TextRun({ children: [D.PageNumber.TOTAL_PAGES] }));
          else if (x.n === 'text:tab') children.push(new D.TextRun({ children: [new D.Tab()] }));
          else (x.c || []).forEach(inline);
        };
        (t.c || []).forEach(inline);
        paras.push(new D.Paragraph({ children }));
        return;
      }
      (t.c || []).forEach(walk);
    };
    walk(tree);
    return paras.length ? paras : null;
  };
  const header = partParagraphs('header');
  const footer = partParagraphs('footer');

  const numberingLevels = (format) => Array.from({ length: 9 }, (_, i) => ({
    level: i, format, text: format === D.LevelFormat.BULLET ? ['•', '◦', '▪'][i % 3] : `%${i + 1}.`, alignment: D.AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 720 * (i + 1), hanging: 360 } } },
  }));

  const doc = new D.Document({
    creator: 'ODT Editor',
    footnotes,
    numbering: { config: [{ reference: 'bullets', levels: numberingLevels(D.LevelFormat.BULLET) }, { reference: 'numbers', levels: numberingLevels(D.LevelFormat.DECIMAL) }] },
    sections: [{
      properties: {
        page: {
          size: { width: twip(lengthPt(pl.width) || 595), height: twip(lengthPt(pl.height) || 842) },
          margin: { top: twip(lengthPt(pl.marginTop) || 56.7), bottom: twip(lengthPt(pl.marginBottom) || 56.7), left: twip(lengthPt(pl.marginLeft) || 56.7), right: twip(lengthPt(pl.marginRight) || 56.7) },
        },
      },
      headers: header ? { default: new D.Header({ children: header }) } : undefined,
      footers: footer ? { default: new D.Footer({ children: footer }) } : undefined,
      children: blocks(state.doc.content),
    }],
  });
  return new Uint8Array(await (await D.Packer.toBlob(doc)).arrayBuffer());
}

/** Plain text of a JSON block (note bodies). */
function textOfJson(b) {
  if (!b) return '';
  if (b.text) return b.text;
  return (b.content || []).map(textOfJson).join('');
}
