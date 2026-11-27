/**
 * Pictures for PDF / XPS: each picture once, with its original bytes when
 * it is a JPEG or PNG; anything else (and pictures drawn by the browser:
 * equations, canvases) as PNG. For PDF, PNG pixels are decoded (colour +
 * alpha as a soft mask); "Minimum size" scales pictures down to 150 dpi.
 */

const sniff = (b) => (b[0] === 0xff && b[1] === 0xd8 ? 'image/jpeg' : b[0] === 0x89 && b[1] === 0x50 ? 'image/png' : null);

/** JPEG size and components (SOF marker). */
export function jpegInfo(b) {
  for (let i = 2; i + 9 < b.length;) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    const len = (b[i + 2] << 8) | b[i + 3];
    if ((m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf)) {
      return { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8], components: b[i + 9] };
    }
    i += 2 + len;
  }
  return null;
}

async function blobOf(src) {
  if (src.startsWith('data:')) {
    const [head, data] = src.split(',');
    const bin = /;base64/.test(head) ? atob(data) : decodeURIComponent(data);
    const b = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    return b;
  }
  return null;
}

export class ImageBook {
  /** @param {(src: string) => { bytes, mediaType } | null} lookup package pictures by their URL */
  constructor(lookup) { this.lookup = lookup; this.list = []; this.bySrc = new Map(); }

  /** A picture element → its key (bytes are read by finish()). */
  imageOf(el) {
    const src = el.currentSrc || el.getAttribute('src') || '';
    if (!src) return null;
    if (this.bySrc.has(src)) return this.bySrc.get(src);
    const key = this.list.length;
    this.list.push({ key, src, el });
    this.bySrc.set(src, key);
    return key;
  }

  imageHref(href) {
    if (this.bySrc.has(href)) return this.bySrc.get(href);
    const img = new Image();
    img.src = href;
    const key = this.list.length;
    this.list.push({ key, src: href, el: img });
    this.bySrc.set(href, key);
    return key;
  }

  addPng(bytes, width, height) {
    const key = this.list.length;
    this.list.push({ key, bytes, mime: 'image/png', width, height });
    return key;
  }

  /** Reads every picture's bytes. */
  async finish() {
    for (const im of this.list) {
      if (im.bytes) continue;
      const pkg = this.lookup?.(im.src);
      let bytes = pkg?.bytes || (await blobOf(im.src));
      let mime = bytes ? sniff(bytes) : null;
      if (!bytes || !mime) {
        // Other formats (GIF, BMP, SVG, EMF/WMF previews…): drawn to PNG.
        try {
          if (!im.el.complete) await im.el.decode?.();
          const c = Object.assign(document.createElement('canvas'), { width: im.el.naturalWidth || im.el.width || 1, height: im.el.naturalHeight || im.el.height || 1 });
          c.getContext('2d').drawImage(im.el, 0, 0, c.width, c.height);
          bytes = new Uint8Array(await (await new Promise((r) => c.toBlob(r, 'image/png'))).arrayBuffer());
          mime = 'image/png';
        } catch { bytes = null; }
      }
      im.bytes = bytes;
      im.mime = mime;
      if (mime === 'image/jpeg') { const j = jpegInfo(bytes); if (j) Object.assign(im, j); }
    }
  }

  /**
   * Decoded pixels for PDF: { width, height, rgb (Uint8Array), alpha (Uint8Array|null), gray }.
   * maxPx: scale down to at most this size (Minimum size: 150 dpi).
   */
  async pixels(im, max = null) {
    const blob = new Blob([im.bytes], { type: im.mime });
    const bmp = await createImageBitmap(blob);
    let w = bmp.width; let h = bmp.height;
    if (max && (w > max.w || h > max.h)) { const f = Math.min(max.w / w, max.h / h); w = Math.max(1, Math.round(w * f)); h = Math.max(1, Math.round(h * f)); }
    const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
    const ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    const rgb = new Uint8Array(w * h * 3);
    const alpha = new Uint8Array(w * h);
    let opaque = true;
    for (let i = 0, j = 0, k = 0; i < d.length; i += 4, j += 3, k++) { rgb[j] = d[i]; rgb[j + 1] = d[i + 1]; rgb[j + 2] = d[i + 2]; alpha[k] = d[i + 3]; if (d[i + 3] !== 255) opaque = false; }
    return { width: w, height: h, rgb, alpha: opaque ? null : alpha };
  }

  /** Scaled-down JPEG (Minimum size), re-encoded. */
  async jpegScaled(im, max) {
    const bmp = await createImageBitmap(new Blob([im.bytes], { type: im.mime }));
    if (bmp.width <= max.w && bmp.height <= max.h) return null;
    const f = Math.min(max.w / bmp.width, max.h / bmp.height);
    const c = Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.round(bmp.width * f)), height: Math.max(1, Math.round(bmp.height * f)) });
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const bytes = new Uint8Array(await (await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85))).arrayBuffer());
    return { bytes, width: c.width, height: c.height, components: 3 };
  }
}
