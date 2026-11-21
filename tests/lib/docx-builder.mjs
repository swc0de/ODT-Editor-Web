/**
 * Builds small .docx packages from raw WordprocessingML strings, for tests
 * that exercise one OOXML feature at a time (M14 D-items).
 *
 *   buildDocx({ body, styles, numbering, settings, headers, footers, footnotes, comments, media, sectPr })
 *
 * `body` is the inner XML of <w:body> (without the final sectPr when `sectPr`
 * is given). Headers / footers are { rId: xml-body } maps; media is
 * { 'image1.png': Uint8Array }. Content types and relationships are made
 * automatically.
 */
import { zipSync, strToU8 } from 'fflate';
import { deflateSync } from 'node:zlib';

export const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"';
const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A paragraph: p('text', { pPr, rPr }) or p([runs], { pPr }). */
export function p(content, { pPr = '', style = null } = {}) {
  const ppr = (style ? `<w:pStyle w:val="${style}"/>` : '') + pPr;
  const inner = Array.isArray(content) ? content.join('') : content == null || content === '' ? '' : r(content);
  return `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${inner}</w:p>`;
}
/** A run of text (spaces preserved). */
export const r = (text, rPr = '') => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
export const tab = (rPr = '') => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:tab/></w:r>`;
export const pageBreak = () => '<w:r><w:br w:type="page"/></w:r>';
/** A complex field with an optional cached result. */
export const field = (instr, result = '') => `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${esc(instr)} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${result ? r(result) : ''}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;

/** A tiny solid-colour PNG (w × h). */
export function png(w, h, [cr, cg, cb] = [46, 117, 182]) {
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) { row[1 + x * 3] = cr; row[2 + x * 3] = cg; row[3 + x * 3] = cb; }
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

/** An inline or anchored picture run. */
export function picture(rId, { cx, cy, id = 1, name = 'Picture', descr = '', anchor = null } = {}) {
  const graphic = `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${esc(name)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>`;
  const docPr = `<wp:docPr id="${id}" name="${esc(name)}" descr="${esc(descr)}"/>`;
  if (!anchor) return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>${docPr}${graphic}</wp:inline></w:drawing></w:r>`;
  const a = { distT: 0, distB: 0, distL: 114300, distR: 114300, behindDoc: 0, relativeHeight: 251659264, ...anchor };
  const posH = a.alignH ? `<wp:align>${a.alignH}</wp:align>` : `<wp:posOffset>${a.x ?? 0}</wp:posOffset>`;
  const posV = a.alignV ? `<wp:align>${a.alignV}</wp:align>` : `<wp:posOffset>${a.y ?? 0}</wp:posOffset>`;
  const wrap = a.wrap || '<wp:wrapSquare wrapText="bothSides"/>';
  return `<w:r><w:drawing><wp:anchor distT="${a.distT}" distB="${a.distB}" distL="${a.distL}" distR="${a.distR}" simplePos="0" relativeHeight="${a.relativeHeight}" behindDoc="${a.behindDoc}" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="${a.relH || 'column'}">${posH}</wp:positionH><wp:positionV relativeFrom="${a.relV || 'paragraph'}">${posV}</wp:positionV><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>${wrap}${docPr}${graphic}</wp:anchor></w:drawing></w:r>`;
}

const CT = {
  document: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  styles: 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml',
  numbering: 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml',
  settings: 'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml',
  header: 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml',
  footer: 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml',
  footnotes: 'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml',
  comments: 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml',
  core: 'application/vnd.openxmlformats-package.core-properties+xml',
};

export function buildDocx({ body, sectPr = '', styles = '', docDefaults = '', numbering = '', settings = '', headers = {}, footers = {}, footnotes = '', comments = '', media = {}, links = {}, title = '' }) {
  const files = {};
  const rels = [];
  const overrides = [['/word/document.xml', CT.document]];
  const add = (path, xml, type, relType, id) => {
    files[path] = strToU8(DECL + xml);
    overrides.push([`/${path}`, type]);
    rels.push(`<Relationship Id="${id}" Type="${REL}/${relType}" Target="${path.replace('word/', '')}"/>`);
  };
  add('word/styles.xml', `<w:styles ${NS}>${docDefaults ? `<w:docDefaults>${docDefaults}</w:docDefaults>` : ''}${styles}</w:styles>`, CT.styles, 'styles', 'rIdStyles');
  if (numbering) add('word/numbering.xml', `<w:numbering ${NS}>${numbering}</w:numbering>`, CT.numbering, 'numbering', 'rIdNumbering');
  add('word/settings.xml', `<w:settings ${NS}>${settings}</w:settings>`, CT.settings, 'settings', 'rIdSettings');
  for (const [id, xml] of Object.entries(headers)) add(`word/${id}.xml`, `<w:hdr ${NS}>${xml}</w:hdr>`, CT.header, 'header', id);
  for (const [id, xml] of Object.entries(footers)) add(`word/${id}.xml`, `<w:ftr ${NS}>${xml}</w:ftr>`, CT.footer, 'footer', id);
  if (footnotes) add('word/footnotes.xml', `<w:footnotes ${NS}><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>${footnotes}</w:footnotes>`, CT.footnotes, 'footnotes', 'rIdFootnotes');
  if (comments) add('word/comments.xml', `<w:comments ${NS}>${comments}</w:comments>`, CT.comments, 'comments', 'rIdComments');
  for (const [name, bytes] of Object.entries(media)) {
    files[`word/media/${name}`] = bytes;
    rels.push(`<Relationship Id="${name.replace(/\.\w+$/, '')}" Type="${REL}/image" Target="media/${name}"/>`);
  }
  for (const [id, url] of Object.entries(links)) rels.push(`<Relationship Id="${id}" Type="${REL}/hyperlink" Target="${esc(url)}" TargetMode="External"/>`);
  files['word/document.xml'] = strToU8(`${DECL}<w:document ${NS}><w:body>${body}${sectPr}</w:body></w:document>`);
  files['word/_rels/document.xml.rels'] = strToU8(`${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`);
  files['docProps/core.xml'] = strToU8(`${DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dc:creator>Test</dc:creator></cp:coreProperties>`);
  overrides.push(['/docProps/core.xml', CT.core]);
  files['_rels/.rels'] = strToU8(`${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
  files['[Content_Types].xml'] = strToU8(`${DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/>${overrides.map(([pn, t]) => `<Override PartName="${pn}" ContentType="${t}"/>`).join('')}</Types>`);
  // [Content_Types].xml first, as Word writes it.
  const ordered = { '[Content_Types].xml': files['[Content_Types].xml'], ...files };
  return zipSync(ordered, { level: 6 });
}
