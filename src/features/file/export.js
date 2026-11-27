/**
 * File ▸ Export and Share: the document as ODT, PDF (print), DOCX, HTML,
 * Markdown, RTF or plain text, the current page as a PNG picture, Copy as
 * HTML, and the system share sheet (Web Share) where the browser has one.
 */
import { toText, toMarkdown, toRtf } from '../../core/convert/writers.js';
import { toHtml } from '../../core/convert/html-export.js';
import { writeDocxParts } from '../../core/convert/docx-writer.js';
import { SAVE_FORMATS, IMPORT_FORMATS, formatById } from '../../core/formats.js';
import { partToDoc } from '../../core/hf-content.js';
import { schema } from '../../core/schema.js';
import { pageToPng, elementToPng } from '../../core/convert/png.js';
import { DOCX_FRAME_KINDS } from '../../core/losses.js';
import { pageLayout } from '../../core/odt/styles.js';
import { toPx } from '../../layout/units.js';
import { APP_NAME, APP_VERSION } from '../../config.js';
import { t } from '../../i18n/index.js';
import { metaTitle } from '../../core/document.js';
import { exportFixed } from '../../core/fixed/index.js';
import { refreshView } from '../review/track.js';

/** Default options of the PDF and XPS writers (Word's Options for PDF / XPS). */
export const FIXED_DEFAULTS = {
  pdf: { range: 'all', markup: false, bookmarks: true, properties: true, tagged: true, pdfa: false, minimumSize: false },
  xps: { range: 'all', markup: false },
};

/**
 * File ▸ Export: the Save as type formats from core/formats.js (as copies:
 * the document stays attached to its file), then Markdown, RTF and the page
 * as a picture. PDF goes through the print dialog until M16.
 */
const EXPORT_IDS = { txt: 'text' }; // command ids kept from earlier versions (file.export_text)
export const EXPORTS = [
  ...SAVE_FORMATS.map((f) => ({ id: EXPORT_IDS[f.id] || f.id, format: f.id, ext: f.exts[0].slice(1), icon: f.icon, mime: f.mime })),
  ...IMPORT_FORMATS.map((f) => ({ id: f.id === 'md' ? 'markdown' : f.id, ext: f.exts[0].slice(1), icon: f.icon, mime: f.mime })),
  { id: 'png', ext: 'png', icon: 'image', mime: 'image/png' },
];

export function download(data, fileName, mime = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: fileName });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

const baseName = (c) => (c.session.info.name || 'Document').replace(/[\\/:*?"<>|]+/g, '_');

/** What core/formats.js writers need from the live editor. */
export function formatEnv(c) {
  return {
    docxParts: async (state, o = {}) => {
      const index = c.ui.docArea.styleIndex;
      // Objects DOCX has no equivalent for are written with a picture of them, drawn from the page.
      const pictures = new Map();
      const view = c.mainEditor.view;
      const need = [];
      if (view.state.doc === state.doc) state.doc.descendants((n, pos) => { if (n.type.name === 'frame' && !DOCX_FRAME_KINDS.has(n.attrs.kind)) need.push([n, pos]); return true; });
      for (const [n, pos] of need) {
        const dom = view.nodeDOM(pos);
        if (dom?.getBoundingClientRect) { try { pictures.set(n, await elementToPng(dom)); } catch (e) { console.warn('Object picture failed:', e); } }
      }
      return writeDocxParts(state, index, { nodeFromJSON: (j) => schema.nodeFromJSON(j), partDoc: (tree) => partToDoc(state, index, tree), generator: `${APP_NAME} ${APP_VERSION}`, asTemplate: !!o.asTemplate, framePicture: (n) => pictures.get(n) });
    },
    html: (state, o = {}) => documentHtml(c, o),
    fixed: async (id, o = {}) => {
      const st = c.session.state;
      const meta = (n) => (st.meta?.c || []).filter((t) => typeof t !== 'string' && t.n === n).map((t) => (t.c || []).filter((x) => typeof x === 'string').join(''));
      const pictures = { ...(st.extraFiles || {}), ...(st.pictures || {}) };
      const byUrl = new Map(Object.keys(pictures).filter((p) => /^Pictures\/|\.(png|jpe?g|gif|svg|webp|bmp)$/i.test(p)).map((p) => [c.ui.pictureUrl(p), pictures[p]]));
      const r = await exportFixed({
        docArea: c.ui.docArea, view: c.mainEditor.view, store: c.store, refreshView: () => refreshView(c), currentPage: c.state.page || 1,
        pictureLookup: (src) => byUrl.get(src) || null, producer: `${APP_NAME} ${APP_VERSION}`,
        meta: { title: meta('dc:title')[0] || c.session.info.name, author: meta('meta:initial-creator')[0] || meta('dc:creator')[0] || '', subject: meta('dc:subject')[0] || '', keywords: meta('meta:keyword').join(', '), lang: document.documentElement.lang || 'en-GB' },
      }, id, { ...FIXED_DEFAULTS[id], ...o });
      // A font that had to be replaced is reported ("Calibri was replaced by Carlito").
      if (r.substitutions.length) c.ui.toast(t('fixed.substituted', { list: r.substitutions.map(([a, b]) => t('fixed.replacedBy', { requested: a, used: b })).join(', ') }));
      return r.bytes;
    },
  };
}

/** The document as a standalone web page. */
export async function documentHtml(c, o = {}) {
  const st = c.session.state;
  const pl = pageLayout(st);
  const isImage = ([p, f]) => /^image\//.test(f.mediaType || '') || /\.(png|jpe?g|gif|svg|webp|bmp)$/i.test(p);
  const pictures = { ...Object.fromEntries(Object.entries(st.extraFiles || {}).filter(isImage)), ...(st.pictures || {}) };
  const byUrl = new Map(Object.keys(pictures).map((p) => [c.ui.pictureUrl(p), p]));
  return toHtml({
    dom: c.mainEditor.view.dom,
    docCss: document.getElementById('odt-doc-css')?.textContent || '',
    title: o.title || metaTitle(c.session.state) || c.session.info.name,
    lang: document.documentElement.lang,
    pictures,
    pictureUrlToPath: (u) => byUrl.get(u),
    pageWidthPx: toPx(pl.width),
    margins: { top: toPx(pl.marginTop), right: toPx(pl.marginRight), bottom: toPx(pl.marginBottom), left: toPx(pl.marginLeft) },
    generator: `${APP_NAME} ${APP_VERSION}`,
  });
}

/** Bytes (or a Blob) of the document in a format. */
export async function exportData(c, id) {
  const state = c.session.currentState();
  const index = c.ui.docArea.styleIndex;
  const fmt = EXPORTS.find((f) => f.id === id);
  if (fmt?.format) return c.session.serializeAs(fmt.format, fmt.format === 'txt' ? { encoding: 'utf-8', lineEnding: 'crlf' } : {});
  switch (id) {
    case 'markdown': return toMarkdown(state, index);
    case 'rtf': return toRtf(state, index);
    case 'png': {
      const da = c.ui.docArea;
      const i = Math.max(0, (c.state.page || 1) - 1);
      return pageToPng({ stack: da.view.stack, pageEl: da.view.pageElement(i) });
    }
    default: throw new Error(`Unknown format ${id}`);
  }
}

export async function exportAs(c, id) {
  const fmt = EXPORTS.find((f) => f.id === id);
  try {
    const data = await exportData(c, id);
    const suffix = id === 'png' ? `-page${c.state.page || 1}` : '';
    const name = `${baseName(c)}${suffix}.${fmt.ext}`;
    download(data, name, fmt.mime);
    c.ui.toast(t('file.downloaded', { name }));
    return true;
  } catch (e) {
    console.warn('Export failed:', e);
    c.ui.toast(t('export.failed', { reason: e.message || String(e) }));
    return false;
  }
}

/** Share ▸ Copy as HTML: the document on the clipboard as formatted text. */
export async function copyAsHtml(c) {
  const html = await documentHtml(c);
  const text = toText(c.session.currentState());
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
    c.ui.toast(t('export.copied'));
  } catch {
    // Without clipboard access, select the text so the user can copy it.
    c.ui.toast(t('export.copyBlocked'));
  }
}

export const canShareFiles = () => {
  try { return typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File(['x'], 'x.docx', { type: formatById('docx').mime })] }); } catch { return false; }
};

/** The system share sheet with the document's file in its current format (the default one for an unsaved document). */
export async function shareNative(c) {
  const fmt = formatById(c.session.currentFormat());
  const info = c.session.info;
  const bytes = await c.session.serializeAs(fmt.id, info.format === fmt.id ? info.options : {});
  const file = new File([bytes], `${baseName(c)}${fmt.exts[0]}`, { type: fmt.mime });
  try { await navigator.share({ files: [file], title: c.session.info.name }); } catch (e) { if (e.name !== 'AbortError') c.ui.toast(t('export.failed', { reason: e.message })); }
}
