/** Lazily loaded conversion libraries: mammoth (DOCX → HTML), docx (DOCX writer), marked (Markdown → HTML). */
import mammoth from 'mammoth/mammoth.browser.js';
import * as docx from 'docx';
import { marked } from 'marked';

export { mammoth, docx, marked };
