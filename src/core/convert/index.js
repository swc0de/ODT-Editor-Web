/**
 * Formats ODT Editor opens besides ODT/OTT: DOCX, HTML, Markdown, RTF, TXT.
 * Each becomes a new, unsaved document (saving writes ODT).
 */
import { loadChunk } from '../chunk-loader.js';
import { htmlToState, textToState, rtfToState } from './readers.js';
import { docxToState } from './docx-io.js';
import { docxToStateNative } from './docx-reader.js';

export const convertLib = () => loadChunk('odt-convert', 'The document converters are not included in this build.');

export const IMPORT_EXTENSIONS = ['.docx', '.htm', '.html', '.md', '.markdown', '.rtf', '.txt'];
export const isImportable = (name) => IMPORT_EXTENSIONS.some((e) => name.toLowerCase().endsWith(e));

const decode = (bytes) => {
  const t = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  return t.replace(/^﻿/, '');
};

/** bytes of a file named `name` → { state, warnings } */
export async function importFile(name, bytes) {
  const ext = name.toLowerCase().replace(/^.*(\.[^.]+)$/, '$1');
  if (ext === '.docx') {
    // ODT Editor's own reader (styles, fonts, page setup, sections…); mammoth if it can't read the file.
    try {
      return docxToStateNative(bytes);
    } catch (e) {
      console.warn('DOCX reader failed, using the simpler converter:', e);
      const { state, messages } = await docxToState(bytes, await convertLib());
      return { state, warnings: messages.filter((m) => m.type === 'error').map((m) => m.message) };
    }
  }
  if (ext === '.htm' || ext === '.html') return { state: htmlToState(decode(bytes)), warnings: [] };
  if (ext === '.md' || ext === '.markdown') {
    const { marked } = await convertLib();
    return { state: htmlToState(marked.parse(decode(bytes), { gfm: true })), warnings: [] };
  }
  if (ext === '.rtf') return { state: rtfToState(new TextDecoder('latin1').decode(bytes)), warnings: [] };
  if (ext === '.txt') return { state: textToState(decode(bytes)), warnings: [] };
  throw new Error(`Unsupported file type ${ext}`);
}
