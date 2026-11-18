/**
 * Helpers for building and inspecting ODT packages in tests and the fixture
 * generator (Node only). The app has its own writer in src/core (M2); this
 * one is deliberately independent so the fixtures don't depend on the code
 * under test.
 */
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { deflateSync } from 'node:zlib';

export const NS = {
  office: 'urn:oasis:names:tc:opendocument:xmlns:office:1.0',
  style: 'urn:oasis:names:tc:opendocument:xmlns:style:1.0',
  text: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
  table: 'urn:oasis:names:tc:opendocument:xmlns:table:1.0',
  draw: 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0',
  fo: 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0',
  xlink: 'http://www.w3.org/1999/xlink',
  dc: 'http://purl.org/dc/elements/1.1/',
  meta: 'urn:oasis:names:tc:opendocument:xmlns:meta:1.0',
  number: 'urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0',
  svg: 'urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0',
  math: 'http://www.w3.org/1998/Math/MathML',
  form: 'urn:oasis:names:tc:opendocument:xmlns:form:1.0',
  script: 'urn:oasis:names:tc:opendocument:xmlns:script:1.0',
  config: 'urn:oasis:names:tc:opendocument:xmlns:config:1.0',
  loext: 'urn:org:documentfoundation:names:experimental:office:xmlns:loext:1.0',
  ooo: 'http://openoffice.org/2004/office',
  ooow: 'http://openoffice.org/2004/writer',
};

export const nsAttrs = (...names) => names.map((n) => `xmlns:${n}="${NS[n]}"`).join(' ');
const ALL_NS = nsAttrs(...Object.keys(NS).filter((n) => n !== 'config'));

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>\n';

// ---------------------------------------------------------------- PNG encoder

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** Encodes an RGBA PNG. pixel(x, y) → [r, g, b, a]. */
export function makePng(width, height, pixel) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a = 255] = pixel(x, y);
      const o = y * (width * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

/** A small generic page-like thumbnail. */
export function makeThumbnail() {
  return makePng(64, 90, (x, y) => {
    if (x < 1 || y < 1 || x > 62 || y > 88) return [180, 180, 180, 255];
    if (x > 8 && x < 56 && y > 10 && y < 80 && y % 6 < 2 && !(y > 60 && x > 40)) return [120, 120, 120, 255];
    return [255, 255, 255, 255];
  });
}

// ------------------------------------------------------------ package builder

/**
 * Default styles.xml pieces shared by the fixtures: font faces, a default
 * paragraph style, the usual LibreOffice-named styles and an A4 page.
 */
export const BASE_FONT_DECLS = `
  <style:font-face style:name="Carlito" svg:font-family="Carlito" style:font-family-generic="swiss" style:font-pitch="variable"/>
  <style:font-face style:name="Caladea" svg:font-family="Caladea" style:font-family-generic="roman" style:font-pitch="variable"/>
  <style:font-face style:name="Liberation Serif" svg:font-family="'Liberation Serif'" style:font-family-generic="roman" style:font-pitch="variable"/>
  <style:font-face style:name="Liberation Sans" svg:font-family="'Liberation Sans'" style:font-family-generic="swiss" style:font-pitch="variable"/>
  <style:font-face style:name="Liberation Mono" svg:font-family="'Liberation Mono'" style:font-family-generic="modern" style:font-pitch="fixed"/>`;

export const BASE_STYLES = `
  <style:default-style style:family="paragraph">
    <style:paragraph-properties fo:hyphenation-ladder-count="no-limit" style:text-autospace="ideograph-alpha" style:punctuation-wrap="hanging" style:line-break="strict" style:tab-stop-distance="1.25cm" style:writing-mode="page"/>
    <style:text-properties style:font-name="Carlito" fo:font-size="12pt" fo:language="en" fo:country="GB" fo:hyphenate="false"/>
  </style:default-style>
  <style:default-style style:family="table">
    <style:table-properties table:border-model="collapsing"/>
  </style:default-style>
  <style:default-style style:family="table-row">
    <style:table-row-properties fo:keep-together="auto"/>
  </style:default-style>
  <style:style style:name="Standard" style:family="paragraph" style:class="text">
    <style:paragraph-properties fo:margin-top="0cm" fo:margin-bottom="0.282cm" fo:line-height="108%"/>
  </style:style>
  <style:style style:name="Heading" style:family="paragraph" style:parent-style-name="Standard" style:next-style-name="Text_20_body" style:class="text">
    <style:paragraph-properties fo:margin-top="0.423cm" fo:margin-bottom="0.212cm" fo:keep-with-next="always"/>
    <style:text-properties style:font-name="Carlito" fo:font-size="14pt" fo:color="#1f3864"/>
  </style:style>
  <style:style style:name="Text_20_body" style:display-name="Text body" style:family="paragraph" style:parent-style-name="Standard" style:class="text">
    <style:paragraph-properties fo:margin-top="0cm" fo:margin-bottom="0.247cm" fo:line-height="115%"/>
  </style:style>
  <style:style style:name="Heading_20_1" style:display-name="Heading 1" style:family="paragraph" style:parent-style-name="Heading" style:next-style-name="Text_20_body" style:default-outline-level="1" style:class="text">
    <style:text-properties fo:font-size="20pt" fo:font-weight="bold"/>
  </style:style>
  <style:style style:name="Heading_20_2" style:display-name="Heading 2" style:family="paragraph" style:parent-style-name="Heading" style:next-style-name="Text_20_body" style:default-outline-level="2" style:class="text">
    <style:text-properties fo:font-size="16pt" fo:font-weight="bold"/>
  </style:style>
  <style:style style:name="Heading_20_3" style:display-name="Heading 3" style:family="paragraph" style:parent-style-name="Heading" style:next-style-name="Text_20_body" style:default-outline-level="3" style:class="text">
    <style:text-properties fo:font-size="13pt" fo:font-weight="bold" fo:font-style="italic"/>
  </style:style>
  <style:style style:name="Title" style:family="paragraph" style:parent-style-name="Heading" style:next-style-name="Subtitle" style:class="chapter">
    <style:paragraph-properties fo:text-align="center"/>
    <style:text-properties fo:font-size="28pt" fo:font-weight="bold"/>
  </style:style>
  <style:style style:name="Subtitle" style:family="paragraph" style:parent-style-name="Heading" style:next-style-name="Text_20_body" style:class="chapter">
    <style:paragraph-properties fo:text-align="center" fo:margin-top="0.106cm"/>
    <style:text-properties fo:font-size="16pt" fo:color="#595959"/>
  </style:style>
  <style:style style:name="Header" style:family="paragraph" style:parent-style-name="Standard" style:class="extra"/>
  <style:style style:name="Footer" style:family="paragraph" style:parent-style-name="Standard" style:class="extra"/>
  <style:style style:name="Table_20_Contents" style:display-name="Table Contents" style:family="paragraph" style:parent-style-name="Standard" style:class="extra"/>
  <style:style style:name="Footnote" style:family="paragraph" style:parent-style-name="Standard" style:class="extra">
    <style:paragraph-properties fo:margin-left="0.598cm" fo:text-indent="-0.598cm"/>
    <style:text-properties fo:font-size="10pt"/>
  </style:style>
  <style:style style:name="Endnote" style:family="paragraph" style:parent-style-name="Standard" style:class="extra">
    <style:text-properties fo:font-size="10pt"/>
  </style:style>
  <style:style style:name="Emphasis" style:family="text">
    <style:text-properties fo:font-style="italic"/>
  </style:style>
  <style:style style:name="Strong_20_Emphasis" style:display-name="Strong Emphasis" style:family="text">
    <style:text-properties fo:font-weight="bold"/>
  </style:style>
  <style:style style:name="Internet_20_link" style:display-name="Internet link" style:family="text">
    <style:text-properties fo:color="#000080" style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"/>
  </style:style>
  <style:style style:name="Footnote_20_Symbol" style:display-name="Footnote Symbol" style:family="text"/>
  <style:style style:name="Footnote_20_anchor" style:display-name="Footnote anchor" style:family="text">
    <style:text-properties style:text-position="super 58%"/>
  </style:style>
  <text:outline-style style:name="Outline">
    ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((l) => `<text:outline-level-style text:level="${l}" style:num-format=""><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab"/></style:list-level-properties></text:outline-level-style>`).join('\n    ')}
  </text:outline-style>
  <text:notes-configuration text:note-class="footnote" style:num-format="1" text:start-value="0" text:footnotes-position="page" text:start-numbering-at="document"/>
  <text:notes-configuration text:note-class="endnote" style:num-format="i" text:start-value="0"/>`;

export const A4_PAGE_LAYOUT = (name = 'pm1', extra = '', inner = '') => `
  <style:page-layout style:name="${name}">
    <style:page-layout-properties fo:page-width="21cm" fo:page-height="29.7cm" style:print-orientation="portrait" fo:margin-top="2.54cm" fo:margin-bottom="2.54cm" fo:margin-left="2.54cm" fo:margin-right="2.54cm" style:writing-mode="lr-tb"${extra}/>
    ${inner}
  </style:page-layout>`;

/**
 * Builds an ODT package (Uint8Array).
 * @param {object} p
 * @param {string} p.body              content inside <office:text>
 * @param {string} [p.contentAutoStyles] automatic styles for content.xml
 * @param {string} [p.extraStyles]     extra common styles for styles.xml
 * @param {string} [p.stylesAutoStyles] automatic styles in styles.xml (page layouts)
 * @param {string} [p.masterStyles]    <office:master-styles> content
 * @param {string} [p.textPrefix]      elements at the start of office:text (tracked changes, decls)
 * @param {string} [p.title]
 * @param {Record<string, Uint8Array>} [p.pictures] Pictures/<name> → bytes
 * @param {string} [p.mime]            package mimetype
 */
export function buildOdt(p) {
  const mime = p.mime || 'application/vnd.oasis.opendocument.text';
  const content = `${XML_DECL}<office:document-content ${ALL_NS} office:version="1.3">
<office:scripts/>
<office:font-face-decls>${BASE_FONT_DECLS}
</office:font-face-decls>
<office:automatic-styles>${p.contentAutoStyles || ''}
</office:automatic-styles>
<office:body>
<office:text>
${p.textPrefix || ''}<text:sequence-decls>
  <text:sequence-decl text:display-outline-level="0" text:name="Illustration"/>
  <text:sequence-decl text:display-outline-level="0" text:name="Table"/>
  <text:sequence-decl text:display-outline-level="0" text:name="Text"/>
  <text:sequence-decl text:display-outline-level="0" text:name="Drawing"/>
  <text:sequence-decl text:display-outline-level="0" text:name="Figure"/>
</text:sequence-decls>
${p.body}
</office:text>
</office:body>
</office:document-content>
`;
  const styles = `${XML_DECL}<office:document-styles ${ALL_NS} office:version="1.3">
<office:font-face-decls>${BASE_FONT_DECLS}
</office:font-face-decls>
<office:styles>${BASE_STYLES}${p.extraStyles || ''}
</office:styles>
<office:automatic-styles>${p.stylesAutoStyles ?? A4_PAGE_LAYOUT()}
</office:automatic-styles>
<office:master-styles>${p.masterStyles ?? '\n  <style:master-page style:name="Standard" style:page-layout-name="pm1"/>'}
</office:master-styles>
</office:document-styles>
`;
  const meta = `${XML_DECL}<office:document-meta ${nsAttrs('office', 'meta', 'dc', 'xlink')} office:version="1.3">
<office:meta>
  <meta:generator>odt-editor-fixtures/1.0</meta:generator>
  <dc:title>${esc(p.title || 'Fixture')}</dc:title>
  <dc:creator>Fixture Generator</dc:creator>
  <meta:initial-creator>Fixture Generator</meta:initial-creator>
  <meta:creation-date>2026-01-15T10:00:00</meta:creation-date>
  <dc:date>2026-01-15T10:30:00</dc:date>
  <dc:language>en-GB</dc:language>
  <meta:editing-cycles>1</meta:editing-cycles>
</office:meta>
</office:document-meta>
`;
  const settings = `${XML_DECL}<office:document-settings ${nsAttrs('office', 'config')} office:version="1.3">
<office:settings>
  <config:config-item-set config:name="ooo:view-settings">
    <config:config-item config:name="ViewAreaTop" config:type="long">0</config:config-item>
  </config:config-item-set>
</office:settings>
</office:document-settings>
`;
  const pictures = p.pictures || {};
  const extraFiles = p.extraFiles || {};
  const fileEntries = [
    ['content.xml', 'text/xml'],
    ['styles.xml', 'text/xml'],
    ['meta.xml', 'text/xml'],
    ['settings.xml', 'text/xml'],
    ['Thumbnails/thumbnail.png', 'image/png'],
    ...Object.keys(pictures).map((n) => [`Pictures/${n}`, n.endsWith('.png') ? 'image/png' : n.endsWith('.svg') ? 'image/svg+xml' : 'image/jpeg']),
    ...Object.entries(extraFiles).map(([n, f]) => [n, f.mediaType]),
  ];
  const manifest = `${XML_DECL}<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">
  <manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="${mime}"/>
${fileEntries.map(([path, type]) => `  <manifest:file-entry manifest:full-path="${path}" manifest:media-type="${type}"/>`).join('\n')}
</manifest:manifest>
`;
  // Object key order = zip entry order; mimetype MUST be first and stored.
  const files = {
    mimetype: [strToU8(mime), { level: 0 }],
    'META-INF/manifest.xml': strToU8(manifest),
    'content.xml': strToU8(content),
    'styles.xml': strToU8(styles),
    'meta.xml': strToU8(meta),
    'settings.xml': strToU8(settings),
    'Thumbnails/thumbnail.png': [makeThumbnail(), { level: 0 }],
  };
  for (const [n, bytes] of Object.entries(pictures)) files[`Pictures/${n}`] = [bytes, { level: 0 }];
  for (const [n, f] of Object.entries(extraFiles)) files[n] = strToU8(f.content);
  return zipSync(files, { level: 6, mtime: new Date('2026-01-15T10:30:00Z') });
}

// ------------------------------------------------------------------ inspection

/** Lists zip entries in archive order with their compression method. */
export function listZipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = [];
  let off = 0;
  while (off + 30 <= bytes.length && view.getUint32(off, true) === 0x04034b50) {
    const method = view.getUint16(off + 8, true);
    const flags = view.getUint16(off + 6, true);
    const compSize = view.getUint32(off + 18, true);
    const nameLen = view.getUint16(off + 26, true);
    const extraLen = view.getUint16(off + 28, true);
    const name = strFromU8(bytes.subarray(off + 30, off + 30 + nameLen));
    const dataStart = off + 30 + nameLen + extraLen;
    entries.push({ name, method, flags, extraLen, dataStart, compSize });
    off = dataStart + compSize + (flags & 0x08 ? 16 : 0);
  }
  return entries;
}

export function readZipText(bytes) {
  const files = unzipSync(bytes);
  const out = {};
  for (const [name, data] of Object.entries(files)) out[name] = /\.(xml|rdf)$|^mimetype$/.test(name) ? strFromU8(data) : data;
  return out;
}

/**
 * Minimal XML well-formedness check (tags balanced, attributes quoted,
 * entities valid, single root). Returns null if OK, else an error message.
 */
export function checkWellFormed(xml) {
  const stack = [];
  let roots = 0;
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[A-Za-z_][\w.:-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>|<|&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g;
  let m;
  while ((m = re.exec(xml))) {
    const tok = m[0];
    if (tok === '<') return `Malformed tag at offset ${m.index}: ${xml.slice(m.index, m.index + 60)}`;
    if (tok[0] === '&') return `Bad entity at offset ${m.index}: ${xml.slice(m.index, m.index + 20)}`;
    if (!m[2]) continue;
    const [, close, name, , selfClose] = m;
    if (close) {
      const open = stack.pop();
      if (open !== name) return `Mismatched </${name}> (open: ${open}) at offset ${m.index}`;
    } else {
      if (stack.length === 0) roots++;
      if (!selfClose) stack.push(name);
    }
  }
  if (stack.length) return `Unclosed <${stack.at(-1)}>`;
  if (roots !== 1) return `Expected exactly one root element, found ${roots}`;
  return null;
}
