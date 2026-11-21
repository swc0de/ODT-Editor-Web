/**
 * The fallback DOCX import (mammoth: Word → HTML, with Word's own paragraph
 * styles mapped to the document's styles), used when the native reader
 * (docx-reader.js) can't read a file. DOCX export: docx-writer.js.
 */
import { htmlToState } from './readers.js';

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
