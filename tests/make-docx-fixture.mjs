#!/usr/bin/env node
/**
 * Writes tests/fixtures/word-features.docx, a Word document with the things
 * the DOCX reader handles: custom styles and fonts, document defaults, page
 * size / margins, a landscape section, header and footer with page fields,
 * a first-page header, numbered and bulleted lists (nested), a table with
 * merged cells, shading and a header row, a picture, a footnote, a comment,
 * tracked changes, a hyperlink, a page break and document properties.
 *
 *   node tests/make-docx-fixture.mjs
 */
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import * as D from 'docx';

/** A 40×20 px PNG (solid blue). */
function png() {
  const w = 40;
  const h = 20;
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = 0x2b; raw[o + 1] = 0x57; raw[o + 2] = 0x9a; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const doc = new D.Document({
  title: 'Word Features Sample',
  subject: 'Import test',
  creator: 'Ada Example',
  keywords: 'docx, import',
  description: 'Made by tests/make-docx-fixture.mjs',
  features: { updateFields: false },
  styles: {
    default: { document: { run: { font: 'Georgia', size: 22 }, paragraph: { spacing: { after: 160, line: 276 } } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: 'Verdana', size: 36, bold: true, color: '1F4E79' }, paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 0, keepNext: true } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: 'Verdana', size: 28, bold: true, color: '2E75B6' }, paragraph: { spacing: { before: 200, after: 80 }, outlineLevel: 1 } },
      { id: 'Callout', name: 'Callout Text', basedOn: 'Normal', run: { italics: true, color: 'C00000', font: 'Courier New' }, paragraph: { indent: { left: 720, right: 720 }, alignment: D.AlignmentType.CENTER, shading: { type: D.ShadingType.CLEAR, fill: 'FFF2CC', color: 'auto' } } },
    ],
    characterStyles: [
      { id: 'Highlighted', name: 'Highlighted Term', run: { bold: true, color: '7030A0', underline: { type: D.UnderlineType.DOUBLE } } },
    ],
  },
  numbering: {
    config: [
      { reference: 'steps', levels: [{ level: 0, format: D.LevelFormat.DECIMAL, text: '%1.', alignment: D.AlignmentType.START, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }, { level: 1, format: D.LevelFormat.LOWER_LETTER, text: '(%2)', alignment: D.AlignmentType.START, style: { paragraph: { indent: { left: 1440, hanging: 360 } } } }] },
      { reference: 'dots', levels: [{ level: 0, format: D.LevelFormat.BULLET, text: '•', alignment: D.AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
    ],
  },
  footnotes: { 1: { children: [new D.Paragraph('Footnote text from Word.')] } },
  comments: { children: [{ id: 0, author: 'Reviewer Bee', initials: 'RB', date: new Date('2026-01-02T03:04:05Z'), children: [new D.Paragraph('Check this sentence.')] }] },
  sections: [
    {
      properties: {
        page: { size: { width: 8391, height: 11906 }, margin: { top: 1134, bottom: 1134, left: 1418, right: 1134, header: 567, footer: 567 } },
        titlePage: true,
      },
      headers: {
        default: new D.Header({ children: [new D.Paragraph({ alignment: D.AlignmentType.RIGHT, children: [new D.TextRun('Running header – page '), new D.TextRun({ children: [D.PageNumber.CURRENT] })] })] }),
        first: new D.Header({ children: [new D.Paragraph('First page header')] }),
      },
      footers: {
        default: new D.Footer({ children: [new D.Paragraph({ alignment: D.AlignmentType.CENTER, children: [new D.TextRun({ children: ['Page ', D.PageNumber.CURRENT, ' of ', D.PageNumber.TOTAL_PAGES] })] })] }),
      },
      children: [
        new D.Paragraph({ heading: D.HeadingLevel.HEADING_1, children: [new D.TextRun('Imported from Word')] }),
        new D.Paragraph({ children: [
          new D.TextRun('Plain, '), new D.TextRun({ text: 'bold', bold: true }), new D.TextRun(', '), new D.TextRun({ text: 'italic', italics: true }), new D.TextRun(', '),
          new D.TextRun({ text: 'Arial 14 red', font: 'Arial', size: 28, color: 'FF0000' }), new D.TextRun(', '), new D.TextRun({ text: 'highlighted', highlight: 'yellow' }), new D.TextRun(', x'),
          new D.TextRun({ text: '2', superScript: true }), new D.TextRun(' and a '), new D.TextRun({ text: 'styled term', style: 'Highlighted' }), new D.TextRun('.'),
          new D.FootnoteReferenceRun(1),
        ] }),
        new D.Paragraph({ alignment: D.AlignmentType.JUSTIFIED, indent: { left: 567, firstLine: 283 }, spacing: { before: 120, after: 240, line: 360 }, children: [
          new D.CommentRangeStart(0), new D.TextRun('A justified paragraph with a first-line indent and one-and-a-half line spacing.'), new D.CommentRangeEnd(0), new D.TextRun({ children: [new D.CommentReference(0)] }),
          new D.TextRun(' Visit '), new D.ExternalHyperlink({ link: 'https://example.org/', children: [new D.TextRun({ text: 'the example site', style: 'Hyperlink' })] }), new D.TextRun('.'),
        ] }),
        new D.Paragraph({ style: 'Callout', children: [new D.TextRun('A paragraph in a custom style.')] }),
        new D.Paragraph({ heading: D.HeadingLevel.HEADING_2, children: [new D.TextRun('Lists')] }),
        new D.Paragraph({ numbering: { reference: 'steps', level: 0 }, children: [new D.TextRun('First step')] }),
        new D.Paragraph({ numbering: { reference: 'steps', level: 1 }, children: [new D.TextRun('Sub-step a')] }),
        new D.Paragraph({ numbering: { reference: 'steps', level: 0 }, children: [new D.TextRun('Second step')] }),
        new D.Paragraph({ numbering: { reference: 'dots', level: 0 }, children: [new D.TextRun('A bullet')] }),
        new D.Paragraph({ heading: D.HeadingLevel.HEADING_2, children: [new D.TextRun('Table')] }),
        new D.Table({
          columnWidths: [2000, 2000, 2000],
          rows: [
            new D.TableRow({ tableHeader: true, children: ['Name', 'Kind', 'Size'].map((t) => new D.TableCell({ shading: { fill: 'D9E2F3', type: D.ShadingType.CLEAR, color: 'auto' }, children: [new D.Paragraph({ children: [new D.TextRun({ text: t, bold: true })] })] })) }),
            new D.TableRow({ children: [new D.TableCell({ rowSpan: 2, children: [new D.Paragraph('Merged down')] }), new D.TableCell({ columnSpan: 2, children: [new D.Paragraph('Merged across')] })] }),
            new D.TableRow({ children: [new D.TableCell({ children: [new D.Paragraph('B3')] }), new D.TableCell({ verticalAlign: D.VerticalAlign.CENTER, children: [new D.Paragraph('C3')] })] }),
          ],
        }),
        new D.Paragraph({ children: [new D.ImageRun({ type: 'png', data: png(), transformation: { width: 120, height: 60 }, altText: { name: 'Blue box', title: 'Blue box', description: 'A blue box' } })] }),
        new D.Paragraph({ children: [new D.InsertedTextRun({ text: 'Inserted text.', id: 1, author: 'Editor', date: '2026-02-01T10:00:00Z' }), new D.DeletedTextRun({ text: ' Deleted text.', id: 2, author: 'Editor', date: '2026-02-01T10:00:00Z' })] }),
        new D.Paragraph({ children: [new D.TextRun('Before the break'), new D.PageBreak(), new D.TextRun('After the break')] }),
      ],
    },
    {
      properties: { page: { size: { orientation: D.PageOrientation.LANDSCAPE, width: 11906, height: 16838 }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } }, column: { count: 2, space: 708 } },
      children: [
        new D.Paragraph({ heading: D.HeadingLevel.HEADING_1, children: [new D.TextRun('Landscape section')] }),
        new D.Paragraph('Text in a landscape section with two columns.'),
      ],
    },
  ],
});

const buf = await D.Packer.toBuffer(doc);
writeFileSync(new URL('./fixtures/word-features.docx', import.meta.url), buf);
console.log('wrote tests/fixtures/word-features.docx', buf.length, 'bytes');
