/**
 * A small sRGB ICC profile (version 2, display class: sRGB primaries
 * adapted to D50 and an sRGB tone curve) for the PDF/A output intent.
 */
export function srgbIcc() {
  const tags = [];
  const s15 = (v) => Math.round(v * 65536) | 0;
  const xyz = (x, y, z) => { const b = new DataView(new ArrayBuffer(20)); b.setUint32(0, 0x58595a20); b.setInt32(8, s15(x)); b.setInt32(12, s15(y)); b.setInt32(16, s15(z)); return new Uint8Array(b.buffer); };
  const text = (s) => { const b = new Uint8Array(8 + s.length + 1); new DataView(b.buffer).setUint32(0, 0x74657874); for (let i = 0; i < s.length; i++) b[8 + i] = s.charCodeAt(i); return b; };
  const desc = (s) => {
    const b = new Uint8Array(12 + s.length + 1 + 4 + 4 + 2 + 1 + 67);
    const v = new DataView(b.buffer);
    v.setUint32(0, 0x64657363);
    v.setUint32(8, s.length + 1);
    for (let i = 0; i < s.length; i++) b[12 + i] = s.charCodeAt(i);
    return b;
  };
  // The sRGB curve, sampled.
  const curve = () => {
    const n = 1024;
    const b = new Uint8Array(12 + n * 2);
    const v = new DataView(b.buffer);
    v.setUint32(0, 0x63757276);
    v.setUint32(8, n);
    for (let i = 0; i < n; i++) {
      const x = i / (n - 1);
      const y = x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      v.setUint16(12 + i * 2, Math.round(y * 65535));
    }
    return b;
  };
  const trc = curve();
  tags.push(['desc', desc('sRGB IEC61966-2.1')], ['cprt', text('No copyright, use freely')], ['wtpt', xyz(0.9642, 1, 0.8249)],
    ['rXYZ', xyz(0.4361, 0.2225, 0.0139)], ['gXYZ', xyz(0.3851, 0.7169, 0.0971)], ['bXYZ', xyz(0.1431, 0.0606, 0.7141)],
    ['rTRC', trc], ['gTRC', trc], ['bTRC', trc]);
  const pad = (n) => (n + 3) & ~3;
  let off = 128 + 4 + tags.length * 12;
  const placed = new Map();
  const entries = tags.map(([sig, data]) => {
    if (placed.has(data)) return { sig, ...placed.get(data) };
    const e = { off, len: data.length, data };
    placed.set(data, { off, len: data.length, data: null });
    off = pad(off + data.length);
    return { sig, ...e };
  });
  const size = off;
  const b = new Uint8Array(size);
  const v = new DataView(b.buffer);
  v.setUint32(0, size);
  v.setUint32(8, 0x02100000);
  v.setUint32(12, 0x6d6e7472); // mntr
  v.setUint32(16, 0x52474220); // 'RGB '
  v.setUint32(20, 0x58595a20); // 'XYZ '
  v.setUint16(24, 2026); v.setUint16(26, 1); v.setUint16(28, 1);
  v.setUint32(36, 0x61637370); // acsp
  v.setInt32(68, s15(0.9642)); v.setInt32(72, s15(1)); v.setInt32(76, s15(0.8249));
  v.setUint32(128, tags.length);
  entries.forEach((e, i) => {
    const p = 132 + i * 12;
    for (let k = 0; k < 4; k++) b[p + k] = e.sig.charCodeAt(k);
    v.setUint32(p + 4, e.off);
    v.setUint32(p + 8, e.len);
    if (e.data) b.set(e.data, e.off);
  });
  return b;
}
