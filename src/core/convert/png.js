/**
 * "Export page as PNG": draws one page exactly as shown (header, footer,
 * text, pictures) by putting a copy of it in an SVG <foreignObject> with the
 * page's styles and the bundled fonts it uses, then onto a canvas.
 */
import { bytesToBase64 } from './format.js';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

async function inlineImages(root) {
  for (const img of root.querySelectorAll('img')) {
    const src = img.getAttribute('src') || '';
    if (!src.startsWith('blob:')) continue;
    try {
      const blob = await (await fetch(src)).blob();
      img.setAttribute('src', `data:${blob.type || 'image/png'};base64,${bytesToBase64(new Uint8Array(await blob.arrayBuffer()))}`);
    } catch { img.remove(); }
  }
}

/** The page's CSS: every rule except @font-face, plus the @font-face rules of the families in use. */
function pageCss(families) {
  const out = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const r of rules) {
      if (r.type === CSSRule.FONT_FACE_RULE) {
        const fam = r.style.getPropertyValue('font-family').replace(/['"]/g, '').trim();
        if (families.has(fam.toLowerCase())) out.push(r.cssText);
      } else out.push(r.cssText);
    }
  }
  return out.join('\n');
}

/**
 * o = { stack: the page stack element, pageEl: the page's background element,
 *       scale: device pixels per CSS pixel (default 2) } → Promise<Blob>
 */
export async function pageToPng({ stack, pageEl, scale = 2 }) {
  const w = pageEl.offsetWidth;
  const h = pageEl.offsetHeight;
  const copy = stack.cloneNode(true);
  copy.style.zoom = '1';
  copy.style.position = 'absolute';
  copy.style.left = `${-pageEl.offsetLeft}px`;
  copy.style.top = `${-pageEl.offsetTop}px`;
  copy.style.margin = '0';
  for (const n of copy.querySelectorAll('[contenteditable]')) n.removeAttribute('contenteditable');
  for (const n of copy.querySelectorAll('.comments-layer, .ProseMirror-separator, .obj-handles')) n.remove();
  // Spelling squiggles and search highlights aren't part of the page.
  for (const n of copy.querySelectorAll('.sp-err, .gr-err, .odt-find, .ra-word')) n.replaceWith(...n.childNodes);
  copy.classList.remove('with-comments');
  // Screen-only aids (field shading) are not part of the exported page (D13).
  copy.classList.add('png-export');
  await inlineImages(copy);
  // Fonts used on the page.
  const families = new Set();
  for (const el of stack.querySelectorAll('*')) {
    const f = getComputedStyle(el).fontFamily.split(',')[0].replace(/['"]/g, '').trim().toLowerCase();
    if (f) families.add(f);
    if (families.size > 12) break;
  }
  const theme = document.documentElement.getAttribute('data-theme') || 'light';
  const html = `<div xmlns="http://www.w3.org/1999/xhtml" data-theme="${theme}" style="position:relative;width:${w}px;height:${h}px;overflow:hidden;background:#fff">${new XMLSerializer().serializeToString(copy)}</div>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w * scale}" height="${h * scale}" viewBox="0 0 ${w} ${h}"><foreignObject x="0" y="0" width="${w}" height="${h}"><style>${esc(pageCss(families))}</style>${html}</foreignObject></svg>`;
  // A data: URL (not blob:) so the canvas stays readable.
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  {
    const img = new Image();
    img.decoding = 'sync';
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('The page could not be drawn.')); img.src = url; });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('The page could not be drawn.'))), 'image/png'));
  }
}

/**
 * One element (a drawing object in the document) as a transparent PNG, the
 * same way: a copy in an SVG <foreignObject>, onto a canvas. Used for the
 * picture Word shows of objects DOCX has no equivalent for.
 * → Promise<{ bytes: Uint8Array, width, height }> (CSS pixels)
 */
export async function elementToPng(el, { scale = 2 } = {}) {
  const r = el.getBoundingClientRect();
  const zoom = el.closest('[style*="zoom"]') ? parseFloat(getComputedStyle(el.closest('[style*="zoom"]')).zoom) || 1 : 1;
  const w = Math.max(1, Math.round(r.width / zoom));
  const h = Math.max(1, Math.round(r.height / zoom));
  const copy = el.cloneNode(true);
  for (const n of copy.querySelectorAll('[contenteditable]')) n.removeAttribute('contenteditable');
  for (const n of copy.querySelectorAll('.obj-handles, .ProseMirror-selectednode')) n.classList?.remove('ProseMirror-selectednode');
  copy.style.position = 'absolute';
  copy.style.left = '0';
  copy.style.top = '0';
  copy.style.margin = '0';
  copy.style.transform = 'none';
  await inlineImages(copy);
  const families = new Set();
  for (const x of [el, ...el.querySelectorAll('*')]) {
    const f = getComputedStyle(x).fontFamily.split(',')[0].replace(/['"]/g, '').trim().toLowerCase();
    if (f) families.add(f);
    if (families.size > 6) break;
  }
  const html = `<div xmlns="http://www.w3.org/1999/xhtml" class="odt-doc" style="position:relative;width:${w}px;height:${h}px;overflow:visible">${new XMLSerializer().serializeToString(copy)}</div>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w * scale}" height="${h * scale}" viewBox="0 0 ${w} ${h}"><foreignObject x="0" y="0" width="${w}" height="${h}"><style>${esc(pageCss(families))}</style>${html}</foreignObject></svg>`;
  const img = new Image();
  img.decoding = 'sync';
  await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('The object could not be drawn.')); img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('The object could not be drawn.'))), 'image/png'));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width: w, height: h };
}
