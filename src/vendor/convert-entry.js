/** Lazily loaded conversion libraries: mammoth (DOCX → HTML, the fallback reader) and marked (Markdown → HTML). DOCX is written by core/convert/docx-writer.js. */
import mammoth from 'mammoth/mammoth.browser.js';
import { marked } from 'marked';

export { mammoth, marked };
