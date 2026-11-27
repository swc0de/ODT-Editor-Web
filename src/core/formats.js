/**
 * Every file format, defined once: the Save as type list (Word for Windows
 * order), templates, import-only formats, their extensions, MIME types,
 * picker entries, readers and writers.
 *
 *   kind     'native'  full fidelity, Save writes back to it
 *            'lossy'   Save writes back to it after warning what is lost
 *            'fixed'   an export (PDF, XPS): Save As writes a copy and the
 *                      document stays attached to its previous file
 *            'import'  opens as a new document (RTF, Markdown)
 *            'template' opens as a new untitled document
 *
 * Readers turn bytes into { state, format, options, asNew }. Writers get an
 * environment from the app (`env`) for what needs the live editor: the style
 * index, header/footer documents, the rendered HTML and the thumbnail.
 */
import { strToU8, strFromU8, zipSync, unzipSync } from 'fflate';
import { importOdt } from './odt/import.js';
import { exportOdt } from './odt/export.js';
import { isEncrypted as isOdtEncrypted, decryptPackage, encryptPackage } from './odt/crypto.js';
import { flatOdtToPackage, packageToFlatOdt } from './odt/flat.js';
import { partsToFlatOpc, flatOpcToParts, sniffXml } from './convert/flat-opc.js';
import { decodeText, encodeText } from './convert/text-encoding.js';
import { isCfb } from './convert/cfb.js';
import { isOfficeEncrypted, decryptOffice, encryptOffice } from './convert/office-crypto.js';
import { htmlToState, textToState, rtfToState } from './convert/readers.js';
import { toText } from './convert/writers.js';
import { docxPartsToState } from './convert/docx-reader.js';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** The Save as type list, in order. */
export const SAVE_FORMATS = [
  { id: 'docx', labelKey: 'fmt.docx', exts: ['.docx'], mime: DOCX_MIME, kind: 'native', encrypts: true, icon: 'fmt-docx' },
  { id: 'odt', labelKey: 'fmt.odt', exts: ['.odt'], mime: 'application/vnd.oasis.opendocument.text', kind: 'native', encrypts: true, icon: 'fmt-odt' },
  { id: 'xml', labelKey: 'fmt.xml', exts: ['.xml'], mime: 'application/xml', kind: 'native', icon: 'fmt-xml', statusKey: 'fmt.status.xml' },
  { id: 'html', labelKey: 'fmt.html', exts: ['.html', '.htm'], mime: 'text/html', kind: 'lossy', options: 'html', icon: 'fmt-html', statusKey: 'fmt.status.html' },
  { id: 'txt', labelKey: 'fmt.txt', exts: ['.txt'], mime: 'text/plain', kind: 'lossy', options: 'txt', icon: 'fmt-txt', statusKey: 'fmt.status.txt' },
  { id: 'pdf', labelKey: 'fmt.pdf', exts: ['.pdf'], mime: 'application/pdf', kind: 'fixed', options: 'pdf', icon: 'fmt-pdf' },
  { id: 'xps', labelKey: 'fmt.xps', exts: ['.xps'], mime: 'application/vnd.ms-xpsdocument', kind: 'fixed', options: 'xps', icon: 'fmt-xps' },
];

export const TEMPLATE_FORMATS = [
  { id: 'dotx', labelKey: 'fmt.dotx', exts: ['.dotx'], mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.template', kind: 'template', base: 'docx', icon: 'fmt-docx' },
  { id: 'ott', labelKey: 'fmt.ott', exts: ['.ott'], mime: 'application/vnd.oasis.opendocument.text-template', kind: 'template', base: 'odt', icon: 'fmt-odt' },
];

export const IMPORT_FORMATS = [
  { id: 'rtf', labelKey: 'fmt.rtf', exts: ['.rtf'], mime: 'application/rtf', kind: 'import', icon: 'fmt-txt' },
  { id: 'md', labelKey: 'fmt.md', exts: ['.md', '.markdown'], mime: 'text/markdown', kind: 'import', icon: 'fmt-txt' },
];

export const ALL_FORMATS = [...SAVE_FORMATS, ...TEMPLATE_FORMATS, ...IMPORT_FORMATS];

/** The formats a new document can be saved in by default (Options ▸ Save). */
export const DEFAULT_FORMAT_CHOICES = ['docx', 'odt'];

export const formatById = (id) => ALL_FORMATS.find((f) => f.id === id) || null;
export const extOf = (name) => (/\.[^./\\]+$/.exec(name || '')?.[0] || '').toLowerCase();
export const formatForName = (name) => ALL_FORMATS.find((f) => f.exts.includes(extOf(name))) || null;
/** A name without its extension, when the extension is one of ours. */
export const stripExt = (name) => (formatForName(name) ? name.slice(0, -extOf(name).length) : name);
export const isWritable = (f) => !!f && f.kind !== 'import' && f.available !== false;
/** Formats whose open document Save writes back to (everything but import-only and fixed ones). */
export const canWriteBack = (id) => { const f = formatById(id); return !!f && (f.kind === 'native' || f.kind === 'lossy'); };

/** A showSaveFilePicker / showOpenFilePicker types entry. */
export function pickerType(f, label = f.id) {
  return { description: label, accept: { [f.mime]: f.exts } };
}

/** Save picker types with `firstId` first (only writable formats). */
export function saveTypes(firstId, label = (f) => f.id) {
  const list = SAVE_FORMATS.filter(isWritable);
  const first = list.find((f) => f.id === firstId);
  return [...(first ? [first] : []), ...list.filter((f) => f !== first)].map((f) => pickerType(f, label(f)));
}

/** The Open picker's types: "All documents" first. */
export function openTypes(label = (f) => f.id, allLabel = 'All documents') {
  const exts = ['.docx', '.dotx', '.xml', '.odt', '.ott', '.htm', '.html', '.txt', '.rtf', '.md'];
  return [
    { description: allLabel, accept: { 'application/octet-stream': exts } },
    ...[...SAVE_FORMATS.filter((f) => f.kind !== 'fixed'), ...TEMPLATE_FORMATS, ...IMPORT_FORMATS].map((f) => pickerType(f, label(f))),
  ];
}
export const OPEN_ACCEPT = ['.docx', '.dotx', '.xml', '.odt', '.ott', '.fodt', '.htm', '.html', '.txt', '.rtf', '.md', '.markdown'];

// ------------------------------------------------------------ reading

const EMBED_RE = /<script\b[^>]*\bid=["']odte-source["'][^>]*>([\s\S]*?)<\/script>/i;
const decodeUtf8 = (bytes) => new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '');

/** A loaded .docx package: its parts are kept on the state (Save copies what the editor doesn't own). */
async function readDocxParts(files) {
  return docxPartsToState(files);
}

export class FormatError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

/**
 * Reads a file.
 * @param {string} name
 * @param {Uint8Array} bytes
 * @param {{ askPassword: (error: string) => Promise<string|null>, convertLib?: () => Promise<any> }} hooks
 * @returns {Promise<null|{ state, format: string, options: object, asNew: boolean, password: string|null, warnings: string[] }>} null when cancelled
 */
export async function readFile(name, bytes, hooks = {}) {
  let ext = extOf(name);
  let password = null;
  const ask = async (decrypt) => {
    let error = '';
    for (;;) {
      const pw = await hooks.askPassword?.(error);
      if (pw == null) return null;
      try { const out = await decrypt(pw); password = pw; return out; } catch (e) {
        if (e.code !== 'wrong-password') throw e;
        error = 'wrong';
      }
    }
  };
  // Password-protected Word documents are compound files whatever their extension.
  if (isCfb(bytes)) {
    if (!isOfficeEncrypted(bytes)) throw new FormatError('This is an older binary document (.doc), which can\'t be opened. Save it as .docx in a word processor first.', 'unsupported');
    const plain = await ask((pw) => decryptOffice(bytes, pw));
    if (!plain) return null;
    bytes = plain;
    if (!['.docx', '.dotx'].includes(ext)) ext = '.docx';
  }
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (zip && ['.odt', '.ott', '.fodt', '.xml', '.htm', '.html', '.txt', '.md', '.rtf', ''].includes(ext)) {
    // A zip: an ODF or OOXML package with an unexpected extension.
    const names = Object.keys(unzipSync(bytes, { filter: (f) => f.name === 'mimetype' || f.name === '[Content_Types].xml' }));
    if (names.includes('[Content_Types].xml')) ext = '.docx';
    else if (!['.odt', '.ott'].includes(ext)) ext = '.odt';
  }
  const done = (state, format, extra = {}) => ({ state, format, options: extra.options || {}, asNew: !!extra.asNew, password, warnings: extra.warnings || [] });
  switch (ext) {
    case '.docx': case '.docm': case '.dotx': case '.dotm': {
      const files = unzipSync(bytes);
      if (!files['[Content_Types].xml']) throw new FormatError('This is not a Word document.', 'not-docx');
      const { state, warnings } = await readDocxParts(files);
      const tpl = ext.startsWith('.dot') || /wordprocessingml\.template/.test(strFromU8(files['[Content_Types].xml']));
      return done(state, 'docx', { asNew: tpl, warnings });
    }
    case '.odt': case '.ott': {
      if (isOdtEncrypted(bytes)) {
        const plain = await ask((pw) => decryptPackage(bytes, pw));
        if (!plain) return null;
        bytes = plain;
      }
      const state = importOdt(bytes);
      const tpl = state.mime === 'template' || ext === '.ott';
      if (tpl) state.mime = 'text';
      return done(state, 'odt', { asNew: tpl });
    }
    case '.fodt': return done(importOdt(flatOdtToPackage(bytes)), 'xml', { options: { flavour: 'flat-odt' } });
    case '.xml': {
      const kind = sniffXml(bytes);
      if (kind === 'flat-opc') {
        const { state, warnings } = await readDocxParts(flatOpcToParts(bytes));
        return done(state, 'xml', { options: { flavour: 'flat-opc' }, warnings });
      }
      if (kind === 'flat-odt') return done(importOdt(flatOdtToPackage(bytes)), 'xml', { options: { flavour: 'flat-odt' } });
      throw new FormatError('This XML file is neither a Word XML document nor an OpenDocument flat XML file.', 'not-document-xml');
    }
    case '.htm': case '.html': {
      const text = decodeUtf8(bytes);
      const embedded = EMBED_RE.exec(text);
      if (embedded) {
        // The document as Flat OPC, kept for lossless reopening.
        try {
          const { state, warnings } = await readDocxParts(flatOpcToParts(embedded[1].trim()));
          return done(state, 'html', { options: { keepSource: true }, warnings });
        } catch (e) { console.warn('Embedded source unreadable, reading the HTML:', e); }
      }
      return done(htmlToState(text), 'html', { options: { keepSource: false } });
    }
    case '.txt': {
      const d = decodeText(bytes);
      return done(textToState(d.text), 'txt', { options: { encoding: d.encoding, lineEnding: d.lineEnding, substitute: false } });
    }
    case '.rtf': return done(rtfToState(new TextDecoder('latin1').decode(bytes)), 'rtf', { asNew: true });
    case '.md': case '.markdown': {
      const { marked } = await hooks.convertLib();
      return done(htmlToState(marked.parse(decodeUtf8(bytes), { gfm: true })), 'md', { asNew: true });
    }
    default: throw new FormatError(`Files of type ${ext || '(none)'} can't be opened.`, 'unsupported');
  }
}

// ------------------------------------------------------------ writing

/**
 * The bytes of a document in a format.
 * @param {string} id format id (SAVE_FORMATS / TEMPLATE_FORMATS)
 * @param {object} env from the app:
 *   state            the current DocumentState
 *   docxParts(state, { asTemplate }) → parts map (unzipped .docx)
 *   odt(state, { asTemplate }) → ODT package bytes (with thumbnail)
 *   html(state, { title }) → a standalone web page
 * @param {object} [options] the format's options (encoding, keepSource…), password
 */
export async function writeFile(id, env, options = {}) {
  const { state } = env;
  const zipParts = (parts) => zipSync(Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, [v, { level: /\.(png|jpe?g|gif|webp)$/i.test(k) ? 0 : 6 }]])));
  let bytes;
  switch (id) {
    case 'docx': case 'dotx': {
      bytes = zipParts(await env.docxParts(state, { asTemplate: id === 'dotx' }));
      if (options.password) bytes = await encryptOffice(bytes, options.password);
      return bytes;
    }
    case 'odt': case 'ott': {
      bytes = await env.odt(state, { asTemplate: id === 'ott' });
      if (options.password) bytes = await encryptPackage(bytes, options.password);
      return bytes;
    }
    case 'xml': {
      if (options.flavour === 'flat-odt') return strToU8(packageToFlatOdt(exportOdt(state).bytes));
      return strToU8(partsToFlatOpc(await env.docxParts(state, {})));
    }
    case 'html': {
      let html = await env.html(state, { title: options.title });
      if (options.keepSource !== false) {
        const flat = partsToFlatOpc(await env.docxParts(state, {}));
        // Script data ends at "</script": such a document (text can't contain it raw in XML, but be safe) isn't embedded.
        if (!/<\/script/i.test(flat)) html = html.replace(/<\/body>/i, () => `<script type="application/x-odte-flatopc+xml" id="odte-source">\n${flat}\n</script>\n</body>`);
      }
      return strToU8(html);
    }
    case 'txt': return encodeText(toText(state), options).bytes;
    // PDF and XPS: drawn from the laid-out pages (core/fixed).
    case 'pdf': case 'xps': return env.fixed(id, options);
    default: throw new FormatError(`Saving as ${id} isn't available yet.`, 'unavailable');
  }
}
