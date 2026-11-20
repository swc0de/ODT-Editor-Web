/**
 * HTML export: a standalone web page made from the rendered document (so
 * pictures, equations and charts appear as they do on screen), with the
 * document's styles and the content rules of the app's stylesheet, and
 * pictures embedded as data: URIs. Page gaps and editing widgets are left out.
 */
import { bytesToBase64 } from './format.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** CSS rules of the page that style document content (not the app's chrome). */
function contentCss() {
  const keep = /odt-|\.ProseMirror|\.ps-|\.cs-|\.ls-|\.ts-|\.tc-|\.ss-|obj-|\.cc|kind-/;
  const out = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const r of rules) {
      if (r.type === CSSRule.FONT_FACE_RULE) continue;
      if (r.selectorText && keep.test(r.selectorText) && !/hf-|pg-gap|comments-layer|notes-layer|repeat-layer|nav-|split-|rm-|sp-err|gr-err|ProseMirror-selectednode|ProseMirror-gapcursor/.test(r.selectorText)) out.push(r.cssText);
    }
  }
  return out.join('\n');
}

/**
 * o = { dom: the editor's root element, docCss, title, lang, pictures (path → {bytes, mediaType}),
 *       pictureUrlToPath: (blob URL) → package path, pageWidthPx, margins {top,right,bottom,left} }
 */
export async function toHtml(o) {
  const copy = o.dom.cloneNode(true);
  copy.removeAttribute('contenteditable');
  copy.removeAttribute('role');
  copy.removeAttribute('aria-label');
  copy.removeAttribute('aria-multiline');
  copy.removeAttribute('spellcheck');
  for (const n of copy.querySelectorAll('.pg-gap, .ol-mark, .ir-syl, .ProseMirror-separator, .ProseMirror-trailingBreak, .obj-handles, .obj-handle, [data-ink-layer]')) n.remove();
  for (const n of copy.querySelectorAll('.sp-err, .gr-err, .odt-find, .ra-word')) n.replaceWith(...n.childNodes);
  for (const n of copy.querySelectorAll('[contenteditable]')) n.removeAttribute('contenteditable');
  for (const n of copy.querySelectorAll('.pg-shifted')) { n.style.transform = ''; n.classList.remove('pg-shifted'); }
  // Bulky model attributes aren't needed in a web page.
  for (const n of copy.querySelectorAll('[data-frame], [data-auto], [data-columns], [data-extra], [data-text-auto], [data-note], [data-annotation], [data-cc]')) {
    for (const a of ['data-frame', 'data-auto', 'data-columns', 'data-extra', 'data-text-auto', 'data-note', 'data-annotation', 'data-cc']) n.removeAttribute(a);
  }
  // Pictures: blob: URLs → data: URIs.
  const cache = new Map();
  for (const img of copy.querySelectorAll('img')) {
    const src = img.getAttribute('src') || '';
    if (!src.startsWith('blob:')) continue;
    if (!cache.has(src)) {
      const path = o.pictureUrlToPath?.(src);
      const pic = path && o.pictures?.[path];
      let uri = '';
      if (pic) uri = `data:${pic.mediaType || 'image/png'};base64,${bytesToBase64(pic.bytes)}`;
      else {
        try { const b = new Uint8Array(await (await fetch(src)).arrayBuffer()); uri = `data:image/png;base64,${bytesToBase64(b)}`; } catch { uri = ''; }
      }
      cache.set(src, uri);
    }
    img.setAttribute('src', cache.get(src));
  }
  const m = o.margins || { top: 72, right: 72, bottom: 72, left: 72 };
  const css = `
body { margin: 0; background: #f3f3f3; }
.page { box-sizing: border-box; max-width: ${Math.round(o.pageWidthPx || 794)}px; margin: 24px auto; padding: ${m.top}px ${m.right}px ${m.bottom}px ${m.left}px; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.25); }
.odt-doc .ProseMirror { white-space: pre-wrap; outline: none; }
@media print { body { background: none; } .page { box-shadow: none; margin: 0; max-width: none; } }
${o.docCss || ''}
${contentCss()}`;
  return `<!doctype html>
<html lang="${esc(o.lang || 'en-GB')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="${esc(o.generator || '')}">
<title>${esc(o.title || 'Document')}</title>
<style>${css}</style>
</head>
<body>
<div class="page odt-doc">${copy.outerHTML}</div>
</body>
</html>
`;
}
