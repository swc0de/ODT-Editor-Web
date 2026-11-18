/**
 * ODF package (zip) reading and writing with fflate.
 * Writing follows ODF 1.3 §3: "mimetype" first, stored (uncompressed), with
 * no extra field; then META-INF/manifest.xml listing every other file.
 */
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { escAttr, XML_DECL } from './xml.js';

export class PackageError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

/** Reads a package → { mimetype, files: Map<path, Uint8Array>, manifest: [{path, mediaType, attrs}] } */
export function readPackage(bytes) {
  let files;
  try {
    files = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  } catch (e) {
    throw new PackageError('This file is not a valid OpenDocument package (it is not a zip archive).', 'not-zip');
  }
  const map = new Map(Object.entries(files).filter(([name]) => !name.endsWith('/')));
  const mimetype = map.has('mimetype') ? strFromU8(map.get('mimetype')).trim() : '';
  const manifest = [];
  if (map.has('META-INF/manifest.xml')) {
    const text = strFromU8(map.get('META-INF/manifest.xml'));
    if (/<manifest:encryption-data\b/.test(text)) throw new PackageError('This document is password-protected. Opening encrypted ODT files is not supported yet.', 'encrypted');
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    for (const el of doc.getElementsByTagNameNS('urn:oasis:names:tc:opendocument:xmlns:manifest:1.0', 'file-entry')) {
      const attrs = {};
      for (const a of el.attributes) if (a.prefix !== 'xmlns' && a.name !== 'xmlns') attrs[a.name.startsWith('manifest:') ? a.name : `manifest:${a.localName}`] = a.value;
      manifest.push({ path: attrs['manifest:full-path'], mediaType: attrs['manifest:media-type'] || '', attrs });
    }
  }
  return { mimetype, files: map, manifest };
}

/**
 * Writes a package.
 * @param {string} mimetype
 * @param {Array<[string, Uint8Array|string, {mediaType?:string, compress?:boolean}?]>} entries in order
 * @param {Array<{path, mediaType, attrs}>} [extraManifest] directory entries etc. to keep
 */
export function writePackage(mimetype, entries, extraManifest = []) {
  const manifestEntries = [
    { 'manifest:full-path': '/', 'manifest:version': '1.3', 'manifest:media-type': mimetype },
  ];
  const seen = new Set(['/']);
  for (const [path, , opts = {}] of entries) {
    if (seen.has(path)) continue;
    seen.add(path);
    manifestEntries.push({ 'manifest:full-path': path, 'manifest:media-type': opts.mediaType ?? mediaTypeFor(path) });
  }
  for (const e of extraManifest) {
    if (seen.has(e.path)) continue;
    seen.add(e.path);
    manifestEntries.push({ ...e.attrs, 'manifest:full-path': e.path, 'manifest:media-type': e.mediaType });
  }
  const manifest = `${XML_DECL}<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">\n${
    manifestEntries.map((a) => ` <manifest:file-entry${Object.entries(a).map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('')}/>`).join('\n')}\n</manifest:manifest>\n`;
  // Object key order is the zip entry order: mimetype MUST come first.
  const zip = { mimetype: [strToU8(mimetype), { level: 0 }] };
  zip['META-INF/manifest.xml'] = strToU8(manifest);
  for (const [path, data, opts = {}] of entries) {
    const bytes = typeof data === 'string' ? strToU8(data) : data;
    const store = opts.compress === false || /\.(png|jpe?g|gif|webp|zip)$/i.test(path);
    zip[path] = [bytes, { level: store ? 0 : 6 }];
  }
  return zipSync(zip, { mtime: new Date() });
}

export function mediaTypeFor(path) {
  const ext = path.split('.').pop().toLowerCase();
  return {
    xml: 'text/xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml',
    webp: 'image/webp', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff', wmf: 'image/x-wmf', emf: 'image/x-emf',
    rdf: 'application/rdf+xml',
  }[ext] || 'application/octet-stream';
}

export { strFromU8, strToU8 };
