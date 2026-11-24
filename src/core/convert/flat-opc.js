/**
 * Word XML Document (*.xml): Flat OPC, the whole DOCX package in one XML
 * file, exactly as Word writes it:
 *
 *   <?xml version="1.0" standalone="yes"?>
 *   <?mso-application progid="Word.Document"?>
 *   <pkg:package xmlns:pkg="http://schemas.microsoft.com/office/2006/xmlPackage">
 *     <pkg:part pkg:name="/_rels/.rels" pkg:contentType="…relationships+xml" pkg:padding="512">
 *       <pkg:xmlData><Relationships …/></pkg:xmlData></pkg:part>
 *     <pkg:part pkg:name="/word/media/image1.png" pkg:contentType="image/png" pkg:compression="store">
 *       <pkg:binaryData>base64…</pkg:binaryData></pkg:part>
 *   </pkg:package>
 *
 * Both directions work on a parts map ({ path: Uint8Array }, the unzipped
 * .docx), so DOCX and Word XML come from the same writer and can't drift
 * apart. [Content_Types].xml isn't a part of Flat OPC: each part carries its
 * content type, and reading rebuilds [Content_Types].xml.
 */
import { strFromU8, strToU8 } from 'fflate';

export const PKG_NS = 'http://schemas.microsoft.com/office/2006/xmlPackage';
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const DECL_RE = /^﻿?\s*<\?xml[^?]*\?>\s*/;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = (s) => String(s).replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&');

export function base64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function unbase64(text) {
  const clean = text.replace(/[^A-Za-z0-9+/=]/g, '');
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(clean, 'base64'));
  const s = atob(clean);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** [Content_Types].xml → (part path) → content type. */
export function contentTypes(files) {
  const xml = files['[Content_Types].xml'] ? strFromU8(files['[Content_Types].xml']) : '';
  const defaults = new Map();
  const overrides = new Map();
  for (const m of xml.matchAll(/<(?:\w+:)?Default\b([^>]*)\/?>/g)) {
    const ext = /Extension="([^"]*)"/.exec(m[1])?.[1];
    const ct = /ContentType="([^"]*)"/.exec(m[1])?.[1];
    if (ext != null && ct) defaults.set(ext.toLowerCase(), unesc(ct));
  }
  for (const m of xml.matchAll(/<(?:\w+:)?Override\b([^>]*)\/?>/g)) {
    const name = /PartName="([^"]*)"/.exec(m[1])?.[1];
    const ct = /ContentType="([^"]*)"/.exec(m[1])?.[1];
    if (name && ct) overrides.set(decodeURI(unesc(name)).replace(/^\//, '').toLowerCase(), unesc(ct));
  }
  return (path) => overrides.get(path.toLowerCase()) || defaults.get(path.split('.').pop().toLowerCase()) || 'application/octet-stream';
}

const isXmlType = (ct) => /[/+]xml$/.test(ct);

/** Word's part order: relationships first, then the main document, then the rest as in the package. */
function partOrder(paths) {
  const rank = (p) => (p === '_rels/.rels' ? 0 : p.endsWith('.rels') && p.startsWith('word/_rels/document') ? 1 : p === 'word/document.xml' ? 2 : 3);
  return [...paths].sort((a, b) => rank(a) - rank(b));
}

/**
 * A parts map (an unzipped DOCX) → Flat OPC text.
 * @param {Record<string, Uint8Array>} files
 * @param {{ progId?: string }} [opts]
 */
export function partsToFlatOpc(files, { progId = 'Word.Document' } = {}) {
  const typeOf = contentTypes(files);
  const out = [`<?xml version="1.0" standalone="yes"?>\r\n<?mso-application progid="${progId}"?>\r\n<pkg:package xmlns:pkg="${PKG_NS}">`];
  for (const path of partOrder(Object.keys(files))) {
    if (path === '[Content_Types].xml' || path.endsWith('/')) continue;
    const bytes = files[path];
    const ct = path.endsWith('.rels') ? 'application/vnd.openxmlformats-package.relationships+xml' : typeOf(path);
    const name = `/${path}`;
    if (isXmlType(ct)) {
      const text = strFromU8(bytes).replace(DECL_RE, '');
      const padding = path.endsWith('.rels') ? ` pkg:padding="${path === '_rels/.rels' ? 512 : 256}"` : '';
      out.push(`<pkg:part pkg:name="${esc(name)}" pkg:contentType="${esc(ct)}"${padding}><pkg:xmlData>${text}</pkg:xmlData></pkg:part>`);
    } else {
      const b64 = base64(bytes).replace(/.{76}(?=.)/g, '$&\r\n');
      out.push(`<pkg:part pkg:name="${esc(name)}" pkg:contentType="${esc(ct)}" pkg:compression="store"><pkg:binaryData>${b64}</pkg:binaryData></pkg:part>`);
    }
  }
  out.push('</pkg:package>');
  return out.join('');
}

/** Namespace declarations on an element's start tag ({ prefix: uri }, '' for the default). */
function declarations(startTag) {
  const out = {};
  for (const m of startTag.matchAll(/\sxmlns(?::([\w.-]+))?\s*=\s*("([^"]*)"|'([^']*)')/g)) out[m[1] || ''] = m[3] ?? m[4];
  return out;
}

/**
 * Flat OPC text → a parts map with [Content_Types].xml rebuilt. Throws when
 * the text isn't a Flat OPC package.
 */
export function flatOpcToParts(text) {
  const src = typeof text === 'string' ? text : strFromU8(text);
  const root = /<([\w.-]+:)?package\b[^>]*>/.exec(src);
  if (!root || !src.includes(PKG_NS)) throw new Error('This is not a Word XML document.');
  const rootDecls = declarations(root[0]);
  const pkgPrefix = Object.entries(rootDecls).find(([, uri]) => uri === PKG_NS)?.[0] ?? 'pkg';
  const p = pkgPrefix ? `${pkgPrefix}:` : '';
  const files = {};
  const overrides = [];
  const partRe = new RegExp(`<${p}part\\b([^>]*)>([\\s\\S]*?)</${p}part>`, 'g');
  const attr = (s, n) => { const m = new RegExp(`${p}${n}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(s); return m ? unesc(m[2] ?? m[3]) : null; };
  for (const m of src.matchAll(partRe)) {
    const name = attr(m[1], 'name');
    const ct = attr(m[1], 'contentType') || 'application/octet-stream';
    if (!name) continue;
    const path = name.replace(/^\//, '');
    const body = m[2];
    const xmlData = new RegExp(`<${p}xmlData\\b[^>]*>([\\s\\S]*)</${p}xmlData>`).exec(body);
    if (xmlData) {
      let inner = xmlData[1].trim();
      // Namespaces declared on the package (not on the part's root) move onto the root.
      const start = /^<[^>]+>/.exec(inner)?.[0] || '';
      const own = declarations(start);
      const add = Object.entries(rootDecls).filter(([pre, uri]) => uri !== PKG_NS && !(pre in own) && new RegExp(`[<\\s]${pre ? `${pre}:` : ''}`).test(inner));
      if (add.length && start) {
        const close = start.endsWith('/>') ? start.length - 2 : start.length - 1;
        inner = start.slice(0, close) + add.map(([pre, uri]) => ` xmlns${pre ? `:${pre}` : ''}="${esc(uri)}"`).join('') + start.slice(close) + inner.slice(start.length);
      }
      files[path] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n${inner}`);
    } else {
      const bin = new RegExp(`<${p}binaryData\\b[^>]*>([\\s\\S]*?)</${p}binaryData>`).exec(body);
      files[path] = bin ? unbase64(bin[1]) : new Uint8Array(0);
    }
    if (!path.endsWith('.rels')) overrides.push([path, ct]);
  }
  if (!Object.keys(files).length) throw new Error('The Word XML document has no parts.');
  files['[Content_Types].xml'] = strToU8(buildContentTypes(overrides));
  return files;
}

/** [Content_Types].xml for [path, contentType] pairs (rels and xml as defaults, every part as an override). */
export function buildContentTypes(pairs) {
  const parts = pairs.map(([path, ct]) => `<Override PartName="/${esc(encodeURI(path).replace(/%5B/g, '[').replace(/%5D/g, ']'))}" ContentType="${esc(ct)}"/>`);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Types xmlns="${CT_NS}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${parts.join('')}</Types>`;
}

/** What an .xml file is: 'flat-opc' (Word XML), 'flat-odt' (OpenDocument flat XML) or null. */
export function sniffXml(bytes) {
  const head = strFromU8(bytes.subarray(0, Math.min(bytes.length, 4096))).replace(/^﻿/, '');
  // The root element (after the declaration, processing instructions and comments).
  const rootM = /<(?![?!])([\w.-]+:)?([\w.-]+)\b/.exec(head);
  if (!rootM) return null;
  if (rootM[2] === 'package' && head.includes(PKG_NS)) return 'flat-opc';
  if (rootM[2] === 'document' && head.includes('urn:oasis:names:tc:opendocument:xmlns:office:1.0')) return 'flat-odt';
  return null;
}
