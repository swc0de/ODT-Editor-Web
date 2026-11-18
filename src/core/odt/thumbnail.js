/**
 * Thumbnails/thumbnail.png: a small rendering of the first page — page
 * background, then the opening paragraphs as text at their relative sizes.
 */
import { toPx } from '../../layout/units.js';
import { pageLayout } from './styles.js';

export async function renderThumbnail(state, styleIndex) {
  const page = pageLayout(state);
  const pw = toPx(page.width) || 794;
  const ph = toPx(page.height) || 1123;
  const H = 256;
  const scale = H / ph;
  const W = Math.round(pw * scale);
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = page.background || '#ffffff';
  ctx.fillRect(0, 0, W, H);
  let y = (toPx(page.marginTop) || 72) * scale;
  const left = (toPx(page.marginLeft) || 72) * scale;
  const maxW = W - left - (toPx(page.marginRight) || 72) * scale;
  const bottom = H - (toPx(page.marginBottom) || 72) * scale;
  ctx.textBaseline = 'top';
  state.doc.descendants((node) => {
    if (y > bottom) return false;
    if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return true;
    const eff = styleIndex?.effective('paragraph', node.attrs.styleName);
    const tp = { ...eff?.props?.['style:text-properties']?.a, ...node.attrs.auto?.props?.['style:text-properties']?.a };
    const sizePx = (parseFloat(tp['fo:font-size']) || 12) * (96 / 72) * scale;
    ctx.font = `${tp['fo:font-weight'] === 'bold' ? 'bold ' : ''}${Math.max(2, sizePx)}px Carlito, sans-serif`;
    ctx.fillStyle = tp['fo:color'] || '#000';
    const words = node.textContent.split(/\s+/);
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, left, y); y += sizePx * 1.2; line = w; if (y > bottom) return false; } else line = test;
    }
    if (line) ctx.fillText(line, left, y);
    y += sizePx * 1.2 + 4 * scale;
    return false;
  });
  const blob = canvas.convertToBlob ? await canvas.convertToBlob({ type: 'image/png' }) : await new Promise((r) => canvas.toBlob(r, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}
