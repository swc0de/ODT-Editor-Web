/**
 * File ▸ Export and Share: the document as ODT, PDF (print), DOCX, HTML,
 * Markdown, RTF or plain text, the current page as a PNG picture, Copy as
 * HTML, and the system share sheet (Web Share) where the browser has one.
 */
import { toText, toMarkdown, toRtf } from '../../core/convert/writers.js';
import { toHtml } from '../../core/convert/html-export.js';
import { stateToDocx } from '../../core/convert/docx-io.js';
import { pageToPng } from '../../core/convert/png.js';
import { convertLib } from '../../core/convert/index.js';
import { pageLayout } from '../../core/odt/styles.js';
import { toPx } from '../../layout/units.js';
import { APP_NAME, APP_VERSION } from '../../config.js';
import { t } from '../../i18n/index.js';

export const EXPORTS = [
  { id: 'odt', ext: 'odt', icon: 'save', mime: 'application/vnd.oasis.opendocument.text' },
  { id: 'pdf', ext: 'pdf', icon: 'print' },
  { id: 'docx', ext: 'docx', icon: 'file-text', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  { id: 'html', ext: 'html', icon: 'web-layout', mime: 'text/html' },
  { id: 'markdown', ext: 'md', icon: 'file-text', mime: 'text/markdown' },
  { id: 'rtf', ext: 'rtf', icon: 'file-text', mime: 'application/rtf' },
  { id: 'text', ext: 'txt', icon: 'file-text', mime: 'text/plain' },
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

/** The document as a standalone web page. */
export async function documentHtml(c) {
  const st = c.session.state;
  const pl = pageLayout(st);
  const pictures = st.pictures || {};
  const byUrl = new Map(Object.keys(pictures).map((p) => [c.ui.pictureUrl(p), p]));
  return toHtml({
    dom: c.mainEditor.view.dom,
    docCss: document.getElementById('odt-doc-css')?.textContent || '',
    title: c.session.info.name,
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
  switch (id) {
    case 'odt': return c.session.serialize();
    case 'docx': return stateToDocx(state, index, await convertLib());
    case 'html': return documentHtml(c);
    case 'markdown': return toMarkdown(state, index);
    case 'rtf': return toRtf(state, index);
    case 'text': return toText(state);
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
  if (id === 'pdf') { c.ui.print?.run({ pdf: true }); return true; }
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
  try { return typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File(['x'], 'x.odt', { type: 'application/vnd.oasis.opendocument.text' })] }); } catch { return false; }
};

/** The system share sheet with the .odt file. */
export async function shareNative(c) {
  const bytes = await c.session.serialize();
  const file = new File([bytes], `${baseName(c)}.odt`, { type: 'application/vnd.oasis.opendocument.text' });
  try { await navigator.share({ files: [file], title: c.session.info.name }); } catch (e) { if (e.name !== 'AbortError') c.ui.toast(t('export.failed', { reason: e.message })); }
}
