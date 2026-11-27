/**
 * Pixel comparison for the PDF / XPS checks (Node, no dependencies).
 *
 *   decodePng(bytes) → { width, height, data (RGBA) }   8-bit, non-interlaced
 *   pixelDiff(a, b, { threshold = 40, radius = 1 }) → { ratio, count, total, heat (RGBA) }
 *     a pixel differs when some channel differs by more than `threshold` from
 *     every pixel of the other image within `radius` (antialiasing tolerance:
 *     edges a pixel apart don't count), checked both ways
 *   encodePng(width, height, rgba) → bytes
 */
import { inflateSync, deflateSync } from 'node:zlib';

export function decodePng(buf) {
  const b = Buffer.from(buf);
  let p = 8;
  let width = 0; let height = 0; let depth = 8; let type = 6; let palette = null; let trns = null;
  const idat = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p);
    const t = b.toString('ascii', p + 4, p + 8);
    const d = b.subarray(p + 8, p + 8 + len);
    if (t === 'IHDR') { width = d.readUInt32BE(0); height = d.readUInt32BE(4); depth = d[8]; type = d[9]; if (d[12]) throw new Error('interlaced PNG'); } else if (t === 'PLTE') palette = d; else if (t === 'tRNS') trns = d; else if (t === 'IDAT') idat.push(d); else if (t === 'IEND') break;
    p += 12 + len;
  }
  if (depth !== 8) throw new Error(`PNG bit depth ${depth}`);
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const out = Buffer.alloc(width * height * 4);
  const prev = Buffer.alloc(stride);
  const cur = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    raw.copy(cur, 0, y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0;
      const up = prev[x];
      const c = x >= ch ? prev[x - ch] : 0;
      let v = cur[x];
      if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1; else if (f === 4) { const pp = a + up - c; const pa = Math.abs(pp - a); const pb = Math.abs(pp - up); const pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      cur[x] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const s = x * ch;
      if (type === 6) { out[o] = cur[s]; out[o + 1] = cur[s + 1]; out[o + 2] = cur[s + 2]; out[o + 3] = cur[s + 3]; } else if (type === 2) { out[o] = cur[s]; out[o + 1] = cur[s + 1]; out[o + 2] = cur[s + 2]; out[o + 3] = 255; } else if (type === 0) { out[o] = out[o + 1] = out[o + 2] = cur[s]; out[o + 3] = 255; } else if (type === 4) { out[o] = out[o + 1] = out[o + 2] = cur[s]; out[o + 3] = cur[s + 1]; } else { const i = cur[s]; out[o] = palette[i * 3]; out[o + 1] = palette[i * 3 + 1]; out[o + 2] = palette[i * 3 + 2]; out[o + 3] = trns && i < trns.length ? trns[i] : 255; }
    }
    cur.copy(prev);
  }
  // Composite over white (screenshots and renderings are compared as seen).
  for (let i = 0; i < out.length; i += 4) { const a = out[i + 3] / 255; for (let k = 0; k < 3; k++) out[i + k] = Math.round(out[i + k] * a + 255 * (1 - a)); out[i + 3] = 255; }
  return { width, height, data: out };
}

export function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t, 'ascii'), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export function pixelDiff(a, b, { threshold = 40, radius = 1 } = {}) {
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);
  const near = (src, other, x, y) => {
    const o = (y * src.width + x) * 4;
    for (let dy = -radius; dy <= radius; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= h) continue;
      for (let dx = -radius; dx <= radius; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= w) continue;
        const q = (yy * other.width + xx) * 4;
        if (Math.abs(src.data[o] - other.data[q]) <= threshold && Math.abs(src.data[o + 1] - other.data[q + 1]) <= threshold && Math.abs(src.data[o + 2] - other.data[q + 2]) <= threshold) return true;
      }
    }
    return false;
  };
  const heat = new Uint8Array(w * h * 4);
  let count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const ia = (y * a.width + x) * 4;
      const g = Math.round((a.data[ia] + a.data[ia + 1] + a.data[ia + 2]) / 3);
      const bad = !near(a, b, x, y) || !near(b, a, x, y);
      if (bad) { count++; heat[o] = 230; heat[o + 1] = 30; heat[o + 2] = 30; } else { heat[o] = heat[o + 1] = heat[o + 2] = 128 + (g >> 1); }
      heat[o + 3] = 255;
    }
  }
  return { ratio: count / (w * h), count, total: w * h, heat, width: w, height: h };
}
