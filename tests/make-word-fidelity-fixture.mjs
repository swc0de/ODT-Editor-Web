/**
 * Writes tests/fixtures/word-fidelity/synthetic-fidelity.docx: a Word-style
 * document built from raw OOXML that has every structure described in
 * reference/docx/DOCX-Fidelity-Reference.docx (three sections with
 * first-page / default / inherited headers and footers, a positional tab, a
 * two-column landscape section with a separator, an anchored picture with
 * square wrap, docDefaults spacing, Calibri Light bold headings, tab stops,
 * paragraph borders with spacing, cell margins, vertical cell text, double /
 * dotted / dashed / thick cell borders, a green ✓ list, a dark header row
 * with automatic text colour, PAGE / NUMPAGES fields and an empty TOC field
 * with updateFields).
 *
 * It is NOT the user's docx-editor-test.docx: the paragraph texts follow the
 * reference's Appendix A but the lorem-ipsum lengths are our own, so page
 * starts differ. Tests on the real fixture live in tests/e2e/docx-fidelity.spec.js.
 *
 * Run: node tests/make-word-fidelity-fixture.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDocx, p, r, tab, pageBreak, field, picture, png, esc } from './lib/docx-builder.mjs';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'word-fidelity', 'synthetic-fidelity.docx');
const LOREM = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.';
const LIGHT = '<w:rFonts w:ascii="Calibri Light" w:hAnsi="Calibri Light" w:cs="Calibri Light"/>';

export const docDefaults = '<w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault>';

export const styles = [
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>',
  '<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/></w:style>',
  `<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:jc w:val="center"/></w:pPr><w:rPr>${LIGHT}<w:color w:val="1F3864"/><w:sz w:val="52"/></w:rPr></w:style>`,
  `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr>${LIGHT}<w:b/><w:bCs/><w:color w:val="2E75B6"/><w:sz w:val="32"/></w:rPr></w:style>`,
  `<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr>${LIGHT}<w:b/><w:bCs/><w:color w:val="2E75B6"/><w:sz w:val="26"/></w:rPr></w:style>`,
  '<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:i/><w:color w:val="1F3864"/><w:sz w:val="24"/></w:rPr></w:style>',
  '<w:style w:type="paragraph" w:customStyle="1" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="A6A6A6"/></w:pBdr><w:ind w:left="720" w:right="720"/></w:pPr><w:rPr><w:i/><w:color w:val="595959"/></w:rPr></w:style>',
  '<w:style w:type="paragraph" w:customStyle="1" w:styleId="CodeBlock"><w:name w:val="Code Block"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/><w:spacing w:before="120" w:after="120"/></w:pPr><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/><w:sz w:val="18"/></w:rPr></w:style>',
  '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="720"/></w:pPr></w:style>',
  '<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/><w:pPr><w:tabs><w:tab w:val="center" w:pos="4680"/><w:tab w:val="right" w:pos="9360"/></w:tabs><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:style>',
  '<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:tabs><w:tab w:val="center" w:pos="4680"/><w:tab w:val="right" w:pos="9360"/></w:tabs><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:style>',
  '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>',
  '<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0"/></w:pPr><w:rPr><w:sz w:val="20"/></w:rPr></w:style>',
  '<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>',
  '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>',
  '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr></w:style>',
].join('');

const lvl = (i, fmt, text, rPr = '') => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${esc(text)}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (i + 1)}" w:hanging="360"/></w:pPr>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}</w:lvl>`;
export const numbering = [
  `<w:abstractNum w:abstractNumId="1">${lvl(0, 'bullet', '•', '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>')}${lvl(1, 'bullet', '◦')}${lvl(2, 'bullet', '▪')}</w:abstractNum>`,
  `<w:abstractNum w:abstractNumId="2">${lvl(0, 'decimal', '%1.')}${lvl(1, 'lowerLetter', '%2.')}${lvl(2, 'lowerRoman', '%3.')}</w:abstractNum>`,
  `<w:abstractNum w:abstractNumId="3">${lvl(0, 'upperRoman', '%1.')}</w:abstractNum>`,
  `<w:abstractNum w:abstractNumId="4">${lvl(0, 'upperLetter', '%1.')}</w:abstractNum>`,
  `<w:abstractNum w:abstractNumId="5">${lvl(0, 'bullet', '✓', '<w:color w:val="00B050"/>')}</w:abstractNum>`,
  '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>',
  '<w:num w:numId="3"><w:abstractNumId w:val="2"/></w:num>',
  '<w:num w:numId="4"><w:abstractNumId w:val="2"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>',
  '<w:num w:numId="5"><w:abstractNumId w:val="3"/></w:num>',
  '<w:num w:numId="6"><w:abstractNumId w:val="4"/></w:num>',
  '<w:num w:numId="7"><w:abstractNumId w:val="5"/></w:num>',
].join('');

const H1 = (t) => p(t, { style: 'Heading1' });
const H2 = (t) => p(t, { style: 'Heading2' });
const li = (t, numId, ilvl = 0, runs = null) => p(runs || t, { style: 'ListParagraph', pPr: `<w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr>` });
const cell = (content, { w, tcPr = '', mar = true } = {}) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${mar ? '<w:tcMar><w:top w:w="80" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tcMar>' : ''}${tcPr}</w:tcPr>${Array.isArray(content) ? content.join('') : content}</w:tc>`;
const tbl = (widths, rows, tblPr = '') => `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/>${tblPr}<w:tblLook w:val="04A0"/></w:tblPr><w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${rows.join('')}</w:tbl>`;
const tr = (cells, trPr = '') => `<w:tr>${trPr ? `<w:trPr>${trPr}</w:trPr>` : ''}${cells.join('')}</w:tr>`;
const right = (t) => p(t, { pPr: '<w:jc w:val="right"/>' });

const sect1 = '<w:sectPr><w:headerReference w:type="default" r:id="rIdH1"/><w:headerReference w:type="first" r:id="rIdH2"/><w:footerReference w:type="default" r:id="rIdF1"/><w:footerReference w:type="first" r:id="rIdF2"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/><w:pgNumType w:start="1"/><w:cols w:space="720"/><w:titlePg/><w:docGrid w:linePitch="360"/></w:sectPr>';
const sect2 = '<w:sectPr><w:headerReference w:type="default" r:id="rIdH3"/><w:footerReference w:type="default" r:id="rIdF3"/><w:type w:val="nextPage"/><w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="708" w:footer="708" w:gutter="0"/><w:cols w:space="720" w:num="2" w:sep="1"/><w:docGrid w:linePitch="360"/></w:sectPr>';
const sect3 = '<w:sectPr><w:type w:val="nextPage"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/><w:cols w:space="720"/><w:docGrid w:linePitch="360"/></w:sectPr>';

const toc = `<w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="Table of Contents"/><w:docPartUnique/></w:docPartObj></w:sdtPr><w:sdtContent>${p([field('TOC \\o "1-3" \\h \\z \\u')])}</w:sdtContent></w:sdt>`;

const body = [
  p('DOCX Round-Trip Test Document', { style: 'Title' }),
  p('Exercises formatting, structure and objects for converter testing.', { pPr: '<w:spacing w:after="240"/><w:jc w:val="center"/>' }),
  toc,
  p(''),
  p([pageBreak()]),
  H1('1. Character Formatting'),
  p([r('Plain, '), r('bold', '<w:b/>'), r(', '), r('italic', '<w:i/>'), r(', '), r('bold italic', '<w:b/><w:i/>'), r(', '), r('underline', '<w:u w:val="single"/>'), r(', '), r('double underline', '<w:u w:val="double"/>'), r(', '), r('wavy', '<w:u w:val="wave" w:color="FF0000"/>'), r(', '), r('strike', '<w:strike/>'), r('.')]),
  p([r('E = mc'), r('2', '<w:vertAlign w:val="superscript"/>'), r(' and H'), r('2', '<w:vertAlign w:val="subscript"/>'), r('O. '), r('Small Caps', '<w:smallCaps/>'), r(', '), r('All Caps', '<w:caps/>'), r(', hidden text'), r(' (hidden)', '<w:vanish/>'), r('.')]),
  p([r('Red', '<w:color w:val="FF0000"/>'), r(' '), r('Green', '<w:color w:val="00B050"/>'), r(' '), r('Blue', '<w:color w:val="0070C0"/>'), r(' '), r('yellow highlight', '<w:highlight w:val="yellow"/>'), r(' '), r('cyan highlight', '<w:highlight w:val="cyan"/>'), r(' '), r('custom shading', '<w:shd w:val="clear" w:color="auto" w:fill="FCE4D6"/>')]),
  p([r('Arial 8pt ', '<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="16"/>'), r('Times 12pt ', '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="24"/>'), r('Courier 14pt ', '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="28"/>'), r('Georgia 20pt', '<w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:sz w:val="40"/>')]),
  p('Unicode: café, naïve, Straße, Ελληνικά, Русский, עברית, 日本語, emoji 😀.'),
  p('Special chars: < > & " \' and a non-breaking space.'),
  p([r('Line one of a paragraph'), '<w:r><w:br/></w:r>', r('line two after a manual line break.')]),
  H1('2. Paragraph Formatting'),
  H2('2.1 Alignment'),
  p('Left-aligned paragraph.', { pPr: '<w:jc w:val="left"/>' }),
  p('Center-aligned paragraph.', { pPr: '<w:jc w:val="center"/>' }),
  p('Right-aligned paragraph.', { pPr: '<w:jc w:val="right"/>' }),
  p(`Justified paragraph. ${LOREM} ${LOREM}`, { pPr: '<w:jc w:val="both"/>' }),
  H2('2.2 Indentation'),
  p(`Left indent 0.5 inch. ${LOREM}`, { pPr: '<w:ind w:left="720"/>' }),
  p(`First-line indent 0.5 inch. ${LOREM}`, { pPr: '<w:ind w:firstLine="720"/>' }),
  p(`Hanging indent 0.5 inch. ${LOREM}`, { pPr: '<w:ind w:left="720" w:hanging="720"/>' }),
  p(`Right indent 1 inch. ${LOREM}`, { pPr: '<w:ind w:right="1440"/>' }),
  H2('2.3 Spacing'),
  p(`Single line spacing. ${LOREM}`, { pPr: '<w:spacing w:line="240" w:lineRule="auto"/>' }),
  p(`1.5 line spacing. ${LOREM}`, { pPr: '<w:spacing w:line="360" w:lineRule="auto"/>' }),
  p(`Double line spacing. ${LOREM}`, { pPr: '<w:spacing w:line="480" w:lineRule="auto"/>' }),
  p(`Exactly 18pt line spacing, 24pt before, 24pt after. ${LOREM}`, { pPr: '<w:spacing w:before="480" w:after="480" w:line="360" w:lineRule="exact"/>' }),
  H2('2.4 Borders, Shading and Tab Stops'),
  p('Boxed paragraph with blue border and light-blue shading.', { pPr: '<w:pBdr><w:top w:val="single" w:sz="6" w:space="4" w:color="2E75B6"/><w:left w:val="single" w:sz="6" w:space="4" w:color="2E75B6"/><w:bottom w:val="single" w:sz="6" w:space="4" w:color="2E75B6"/><w:right w:val="single" w:sz="6" w:space="4" w:color="2E75B6"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="DEEAF6"/>' }),
  p('', { pPr: '<w:pBdr><w:bottom w:val="single" w:sz="12" w:space="1" w:color="000000"/></w:pBdr>' }),
  p([r('Start'), tab(), r('Left@2000'), tab(), r('Center'), tab(), r('Right')], { pPr: '<w:tabs><w:tab w:val="left" w:pos="2000"/><w:tab w:val="center" w:pos="4680"/><w:tab w:val="right" w:pos="9360"/></w:tabs>' }),
  p([r('Chapter 1 Introduction'), '<w:r><w:ptab w:relativeTo="margin" w:alignment="right" w:leader="dot"/></w:r>', r('42')]),
  H2('2.5 Built-in Paragraph Styles'),
  p('This paragraph uses the custom "Quote" style. It is indented on both sides and has a grey bar on the left.', { style: 'Quote' }),
  p('function hello() { return "monospace code style"; }', { style: 'CodeBlock' }),
  p('2.5.1 A Heading 3', { style: 'Heading3' }),
  p('Body text under a level-3 heading.'),
  p(''),
  H1('3. Lists'),
  H2('3.1 Bulleted (multi-level)'),
  li('Bullet level 0', 2, 0), li('Bullet level 1', 2, 1), li('Bullet level 2', 2, 2), li('Back to level 1', 2, 1),
  li(null, 2, 0, [r('Bold item', '<w:b/>'), r(' with '), r('mixed', '<w:i/>'), r(' formatting')]),
  H2('3.2 Numbered (multi-level: 1. / a. / i.)'),
  li('First item', 3, 0), li('Sub-item a', 3, 1), li('Sub-item b', 3, 1), li('Sub-sub-item i', 3, 2), li('Sub-sub-item ii', 3, 2), li('Second item', 3, 0),
  p('An interrupting non-list paragraph (numbering should continue after it).'),
  li('Third item (continues at 3)', 3, 0),
  H2('3.3 Restarted list (separate instance)'),
  li('Should restart at 1', 4, 0), li('Then 2', 4, 0),
  H2('3.4 Other formats'),
  li('Upper Roman I', 5, 0), li('Upper Roman II', 5, 0), li('Upper letter A', 6, 0), li('Upper letter B', 6, 0), li('Custom bullet glyph ✓', 7, 0),
  H1('4. Tables'),
  H2('4.1 Simple table with header row'),
  tbl([3120, 3120, 3120], [
    tr(['Product', 'Qty', 'Price'].map((t) => cell(p(t), { w: 3120, tcPr: '<w:shd w:val="clear" w:color="auto" w:fill="2E75B6"/>' })), '<w:tblHeader/>'),
    ...[['Apples', '10', '£4.50'], ['Bananas', '6', '£1.20'], ['Cherries', '250', '£7.99']].map(([a, b, c]) => tr([cell(p(a), { w: 3120 }), cell(right(b), { w: 3120 }), cell(right(c), { w: 3120 })])),
  ]),
  p(''),
  H2('4.2 Merged cells (horizontal and vertical)'),
  tbl([2340, 2340, 2340, 2340], [
    tr([cell(p('Spans 2 columns', { pPr: '<w:jc w:val="center"/>' }), { w: 4680, tcPr: '<w:gridSpan w:val="2"/>', mar: false }), cell(p('C'), { w: 2340, mar: false }), cell(p('D'), { w: 2340, mar: false })]),
    tr([cell(p('Spans 2 rows'), { w: 2340, tcPr: '<w:vMerge w:val="restart"/>', mar: false }), cell(p('B2'), { w: 2340, mar: false }), cell(p('2×2 block', { pPr: '<w:jc w:val="center"/>' }), { w: 4680, tcPr: '<w:gridSpan w:val="2"/><w:vMerge w:val="restart"/>', mar: false })]),
    tr([cell(p(''), { w: 2340, tcPr: '<w:vMerge/>', mar: false }), cell(p('B3'), { w: 2340, mar: false }), cell(p(''), { w: 4680, tcPr: '<w:gridSpan w:val="2"/><w:vMerge/>', mar: false })]),
    tr([cell(p('A4'), { w: 2340, mar: false }), cell(p('B4'), { w: 2340, mar: false }), cell(p(''), { w: 2340, mar: false }), cell(p(''), { w: 2340, mar: false })]),
  ]),
  p(''),
  H2('4.3 Nested table, vertical text, varied borders'),
  tbl([1200, 4560, 3600], [
    tr([
      cell(p('Vertical'), { w: 1200, tcPr: '<w:textDirection w:val="btLr"/><w:vAlign w:val="center"/>' }),
      cell([p('Cell containing a nested table:'), tbl([2160, 2160], [tr([cell(p('n1'), { w: 2160, mar: false }), cell(p('n2'), { w: 2160, mar: false })]), tr([cell(p('n3'), { w: 2160, mar: false }), cell(p('n4'), { w: 2160, mar: false })])]), p('')], { w: 4560, tcPr: '<w:tcBorders><w:right w:val="single" w:sz="4" w:space="0" w:color="808080"/></w:tcBorders>' }),
      cell([p('Bottom-aligned cell with double/dashed/dotted/thick borders.'), li('List inside a cell', 2, 0)], { w: 3600, tcPr: '<w:tcBorders><w:top w:val="double" w:sz="6" w:space="0" w:color="C00000"/><w:left w:val="dotted" w:sz="8" w:space="0" w:color="0070C0"/><w:bottom w:val="dashed" w:sz="8" w:space="0" w:color="00B050"/><w:right w:val="thick" w:sz="18" w:space="0" w:color="7030A0"/></w:tcBorders><w:vAlign w:val="bottom"/>' }),
    ], '<w:trHeight w:val="1800"/>'),
  ]),
  p(''),
  H1('5. Images'),
  p('Inline image (400×200 px scaled to 300×150):'),
  p([picture('image1', { cx: 2857500, cy: 1428750, id: 1, name: 'Picture 1', descr: 'A blue rectangle' })], { pPr: '<w:jc w:val="center"/>' }),
  p('Figure 1: Inline centered image with alt text', { pPr: '<w:jc w:val="center"/>' }),
  p([r('Small image '), picture('image2', { cx: 304800, cy: 304800, id: 2, name: 'Picture 2' }), r(' inline with text continues after it.')]),
  p([picture('image3', { cx: 1524000, cy: 762000, id: 3, name: 'Picture 3', anchor: { x: 4600000, relH: 'page', y: 0, relV: 'paragraph', distT: 0, distB: 114300, distL: 114300, distR: 0 } }), r(`Floating image anchored right with square text wrapping. ${LOREM} ${LOREM}`)]),
  H1('6. Links, Bookmarks and Footnotes'),
  p([r('External hyperlink: '), `<w:hyperlink r:id="rIdLink1">${r('example.com', '<w:rStyle w:val="Hyperlink"/>')}</w:hyperlink>`]),
  p([r('Mailto link: '), `<w:hyperlink r:id="rIdLink2">${r('test@example.com', '<w:rStyle w:val="Hyperlink"/>')}</w:hyperlink>`]),
  p([r('Internal link to the '), `<w:hyperlink w:anchor="target_bookmark">${r('bookmark in section 8', '<w:rStyle w:val="Hyperlink"/>')}</w:hyperlink>`, r('.')]),
  p([r('Sentence with a footnote'), '<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="1"/></w:r>', r(' and another one.'), '<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="2"/></w:r>']),
  H1('7. Comments and Tracked Changes'),
  p([r('This sentence has a '), '<w:commentRangeStart w:id="0"/>', r('commented phrase'), '<w:commentRangeEnd w:id="0"/>', '<w:r><w:commentReference w:id="0"/></w:r>', r(' in it.')]),
  p([r('Tracked changes: the quick '), `<w:del w:id="10" w:author="Alice" w:date="2026-01-01T10:00:00Z"><w:r><w:delText>brown</w:delText></w:r></w:del>`, `<w:ins w:id="11" w:author="Bob" w:date="2026-01-02T10:00:00Z">${r('red')}</w:ins>`, r(' fox jumps over the lazy dog.')]),
  H1('8. Fields and Bookmark Target'),
  p([r('Current page: '), field('PAGE', '1'), r(' of '), field('NUMPAGES', '8')]),
  p(['<w:bookmarkStart w:id="20" w:name="target_bookmark"/>', r('This text is the bookmark target.'), '<w:bookmarkEnd w:id="20"/>']),
  p('A keep-with-next and keep-lines paragraph follows.', { pPr: '<w:keepNext/><w:keepLines/>' }),
  p('Widow/orphan-controlled paragraph.', { pPr: '<w:widowControl/>' }),
  p('', { pPr: sect1 }),
  H1('9. Landscape Section with Two Columns'),
  p('This section is landscape, uses a two-column layout with a separator line, and has its own header and footer.'),
  ...[1, 2, 3, 4, 5, 6].map((i) => p(`${i}. ${LOREM} ${LOREM}`, { pPr: '<w:jc w:val="both"/>' })),
  p('', { pPr: sect2 }),
  H1('10. Back to Portrait'),
  p('Final section, portrait again, continuing page numbering. It has no header or footer of its own, so it inherits the landscape section\'s.'),
].join('');

export const headers = {
  rIdH1: p([r('DOCX Test — Portrait Header'), '<w:r><w:ptab w:relativeTo="margin" w:alignment="right" w:leader="none"/></w:r>', r('Section 1')], { style: 'Header' }),
  rIdH2: p('FIRST PAGE HEADER', { style: 'Header', pPr: '<w:jc w:val="center"/>' }),
  rIdH3: p('LANDSCAPE SECTION HEADER', { style: 'Header', pPr: '<w:jc w:val="center"/>' }),
};
export const footers = {
  rIdF1: p([r('Page '), '<w:fldSimple w:instr=" PAGE "><w:r><w:t>2</w:t></w:r></w:fldSimple>', r(' of '), '<w:fldSimple w:instr=" NUMPAGES "><w:r><w:t>8</w:t></w:r></w:fldSimple>'], { style: 'Footer', pPr: '<w:jc w:val="center"/>' }),
  rIdF2: p('First page footer', { style: 'Footer', pPr: '<w:jc w:val="center"/>' }),
  rIdF3: p([r('Landscape page '), '<w:fldSimple w:instr=" PAGE "><w:r><w:t>7</w:t></w:r></w:fldSimple>'], { style: 'Footer', pPr: '<w:jc w:val="center"/>' }),
};

export function makeSyntheticFidelityDocx() {
  return buildDocx({
    body, sectPr: sect3, styles, docDefaults, numbering, headers, footers,
    settings: '<w:evenAndOddHeaders w:val="false"/><w:updateFields w:val="true"/><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>',
    footnotes: '<w:footnote w:id="1">' + p([r('', ''), r('First footnote text.')], { style: 'FootnoteText' }) + '</w:footnote><w:footnote w:id="2">' + p('Second footnote text.', { style: 'FootnoteText' }) + '</w:footnote>',
    comments: `<w:comment w:id="0" w:author="Alice" w:date="2026-01-01T09:00:00Z" w:initials="A">${p('A comment on the phrase.')}</w:comment>`,
    media: { 'image1.png': png(400, 200), 'image2.png': png(32, 32, [192, 0, 0]), 'image3.png': png(160, 80, [0, 176, 80]) },
    links: { rIdLink1: 'https://example.com/', rIdLink2: 'mailto:test@example.com' },
    title: 'DOCX Round-Trip Test Document',
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, makeSyntheticFidelityDocx());
  console.log(`wrote ${path.relative(process.cwd(), OUT)}`);
}
