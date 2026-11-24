/**
 * Synchronous SHA-1 / SHA-256 / SHA-384 / SHA-512 for the password key
 * derivation of Office encryption: 100,000 chained hashes of 68 bytes are
 * about 20 times faster here than through WebCrypto's per-call promises.
 * Everything else (AES, HMAC) uses WebCrypto.
 */

const K512 = [
  0x428a2f98, 0xd728ae22, 0x71374491, 0x23ef65cd, 0xb5c0fbcf, 0xec4d3b2f, 0xe9b5dba5, 0x8189dbbc, 0x3956c25b, 0xf348b538,
  0x59f111f1, 0xb605d019, 0x923f82a4, 0xaf194f9b, 0xab1c5ed5, 0xda6d8118, 0xd807aa98, 0xa3030242, 0x12835b01, 0x45706fbe,
  0x243185be, 0x4ee4b28c, 0x550c7dc3, 0xd5ffb4e2, 0x72be5d74, 0xf27b896f, 0x80deb1fe, 0x3b1696b1, 0x9bdc06a7, 0x25c71235,
  0xc19bf174, 0xcf692694, 0xe49b69c1, 0x9ef14ad2, 0xefbe4786, 0x384f25e3, 0x0fc19dc6, 0x8b8cd5b5, 0x240ca1cc, 0x77ac9c65,
  0x2de92c6f, 0x592b0275, 0x4a7484aa, 0x6ea6e483, 0x5cb0a9dc, 0xbd41fbd4, 0x76f988da, 0x831153b5, 0x983e5152, 0xee66dfab,
  0xa831c66d, 0x2db43210, 0xb00327c8, 0x98fb213f, 0xbf597fc7, 0xbeef0ee4, 0xc6e00bf3, 0x3da88fc2, 0xd5a79147, 0x930aa725,
  0x06ca6351, 0xe003826f, 0x14292967, 0x0a0e6e70, 0x27b70a85, 0x46d22ffc, 0x2e1b2138, 0x5c26c926, 0x4d2c6dfc, 0x5ac42aed,
  0x53380d13, 0x9d95b3df, 0x650a7354, 0x8baf63de, 0x766a0abb, 0x3c77b2a8, 0x81c2c92e, 0x47edaee6, 0x92722c85, 0x1482353b,
  0xa2bfe8a1, 0x4cf10364, 0xa81a664b, 0xbc423001, 0xc24b8b70, 0xd0f89791, 0xc76c51a3, 0x0654be30, 0xd192e819, 0xd6ef5218,
  0xd6990624, 0x5565a910, 0xf40e3585, 0x5771202a, 0x106aa070, 0x32bbd1b8, 0x19a4c116, 0xb8d2d0c8, 0x1e376c08, 0x5141ab53,
  0x2748774c, 0xdf8eeb99, 0x34b0bcb5, 0xe19b48a8, 0x391c0cb3, 0xc5c95a63, 0x4ed8aa4a, 0xe3418acb, 0x5b9cca4f, 0x7763e373,
  0x682e6ff3, 0xd6b2b8a3, 0x748f82ee, 0x5defb2fc, 0x78a5636f, 0x43172f60, 0x84c87814, 0xa1f0ab72, 0x8cc70208, 0x1a6439ec,
  0x90befffa, 0x23631e28, 0xa4506ceb, 0xde82bde9, 0xbef9a3f7, 0xb2c67915, 0xc67178f2, 0xe372532b, 0xca273ece, 0xea26619c,
  0xd186b8c7, 0x21c0c207, 0xeada7dd6, 0xcde0eb1e, 0xf57d4f7f, 0xee6ed178, 0x06f067aa, 0x72176fba, 0x0a637dc5, 0xa2c898a6,
  0x113f9804, 0xbef90dae, 0x1b710b35, 0x131c471b, 0x28db77f5, 0x23047d84, 0x32caab7b, 0x40c72493, 0x3c9ebe0a, 0x15c9bebc,
  0x431d67c4, 0x9c100d4c, 0x4cc5d4be, 0xcb3e42b6, 0x597f299c, 0xfc657e2a, 0x5fcb6fab, 0x3ad6faec, 0x6c44198c, 0x4a475817,
];
const IV512 = [0x6a09e667, 0xf3bcc908, 0xbb67ae85, 0x84caa73b, 0x3c6ef372, 0xfe94f82b, 0xa54ff53a, 0x5f1d36f1, 0x510e527f, 0xade682d1, 0x9b05688c, 0x2b3e6c1f, 0x1f83d9ab, 0xfb41bd6b, 0x5be0cd19, 0x137e2179];
const IV384 = [0xcbbb9d5d, 0xc1059ed8, 0x629a292a, 0x367cd507, 0x9159015a, 0x3070dd17, 0x152fecd8, 0xf70e5939, 0x67332667, 0xffc00b31, 0x8eb44a87, 0x68581511, 0xdb0c2e0d, 0x64f98fa7, 0x47b5481d, 0xbefa4fa4];

function pad(msg, blockLen, lenBytes) {
  const l = msg.length;
  const total = Math.ceil((l + 1 + lenBytes) / blockLen) * blockLen;
  const out = new Uint8Array(total);
  out.set(msg);
  out[l] = 0x80;
  const bits = l * 8;
  const dv = new DataView(out.buffer);
  dv.setUint32(total - 4, bits >>> 0);
  dv.setUint32(total - 8, Math.floor(bits / 2 ** 32));
  return out;
}

function sha512core(msg, iv, outLen) {
  const m = pad(msg, 128, 16);
  const H = Int32Array.from(iv);
  const W = new Int32Array(160);
  const dv = new DataView(m.buffer);
  for (let off = 0; off < m.length; off += 128) {
    for (let i = 0; i < 32; i++) W[i] = dv.getInt32(off + i * 4);
    for (let i = 16; i < 80; i++) {
      // σ0(W[i-15]), σ1(W[i-2]) on hi/lo pairs.
      let xh = W[(i - 15) * 2];
      let xl = W[(i - 15) * 2 + 1];
      const s0h = ((xh >>> 1) | (xl << 31)) ^ ((xh >>> 8) | (xl << 24)) ^ (xh >>> 7);
      const s0l = ((xl >>> 1) | (xh << 31)) ^ ((xl >>> 8) | (xh << 24)) ^ ((xl >>> 7) | (xh << 25));
      xh = W[(i - 2) * 2];
      xl = W[(i - 2) * 2 + 1];
      const s1h = ((xh >>> 19) | (xl << 13)) ^ ((xl >>> 29) | (xh << 3)) ^ (xh >>> 6);
      const s1l = ((xl >>> 19) | (xh << 13)) ^ ((xh >>> 29) | (xl << 3)) ^ ((xl >>> 6) | (xh << 26));
      let lo = (s0l >>> 0) + (s1l >>> 0) + (W[(i - 7) * 2 + 1] >>> 0) + (W[(i - 16) * 2 + 1] >>> 0);
      const hi = s0h + s1h + W[(i - 7) * 2] + W[(i - 16) * 2] + Math.floor(lo / 2 ** 32);
      W[i * 2] = hi;
      W[i * 2 + 1] = lo >>> 0;
      lo = 0;
    }
    let [ah, al, bh, bl, ch, cl, dh, dl, eh, el, fh, fl, gh, gl, hh, hl] = H;
    for (let i = 0; i < 80; i++) {
      const S1h = ((eh >>> 14) | (el << 18)) ^ ((eh >>> 18) | (el << 14)) ^ ((el >>> 9) | (eh << 23));
      const S1l = ((el >>> 14) | (eh << 18)) ^ ((el >>> 18) | (eh << 14)) ^ ((eh >>> 9) | (el << 23));
      const chh = (eh & fh) ^ (~eh & gh);
      const chl = (el & fl) ^ (~el & gl);
      let t1l = (hl >>> 0) + (S1l >>> 0) + (chl >>> 0) + K512[i * 2 + 1] + (W[i * 2 + 1] >>> 0);
      const t1h = hh + S1h + chh + K512[i * 2] + W[i * 2] + Math.floor(t1l / 2 ** 32);
      t1l >>>= 0;
      const S0h = ((ah >>> 28) | (al << 4)) ^ ((al >>> 2) | (ah << 30)) ^ ((al >>> 7) | (ah << 25));
      const S0l = ((al >>> 28) | (ah << 4)) ^ ((ah >>> 2) | (al << 30)) ^ ((ah >>> 7) | (al << 25));
      const mjh = (ah & bh) ^ (ah & ch) ^ (bh & ch);
      const mjl = (al & bl) ^ (al & cl) ^ (bl & cl);
      const t2l = (S0l >>> 0) + (mjl >>> 0);
      const t2h = S0h + mjh + Math.floor(t2l / 2 ** 32);
      hh = gh; hl = gl; gh = fh; gl = fl; fh = eh; fl = el;
      let x = (dl >>> 0) + t1l;
      eh = (dh + t1h + Math.floor(x / 2 ** 32)) | 0; el = x | 0;
      dh = ch; dl = cl; ch = bh; cl = bl; bh = ah; bl = al;
      x = t1l + (t2l >>> 0);
      ah = (t1h + t2h + Math.floor(x / 2 ** 32)) | 0; al = x | 0;
    }
    const add = (k, vh, vl) => { const x = (H[k + 1] >>> 0) + (vl >>> 0); H[k] = (H[k] + vh + Math.floor(x / 2 ** 32)) | 0; H[k + 1] = x | 0; };
    add(0, ah, al); add(2, bh, bl); add(4, ch, cl); add(6, dh, dl); add(8, eh, el); add(10, fh, fl); add(12, gh, gl); add(14, hh, hl);
  }
  const out = new Uint8Array(64);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 16; i++) odv.setInt32(i * 4, H[i]);
  return out.subarray(0, outLen);
}

const K256 = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function sha256(msg) {
  const m = pad(msg, 64, 8);
  const H = Int32Array.from([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Int32Array(64);
  const dv = new DataView(m.buffer);
  const rot = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < m.length; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getInt32(off + i * 4);
    for (let i = 16; i < 64; i++) W[i] = (W[i - 16] + (rot(W[i - 15], 7) ^ rot(W[i - 15], 18) ^ (W[i - 15] >>> 3)) + W[i - 7] + (rot(W[i - 2], 17) ^ rot(W[i - 2], 19) ^ (W[i - 2] >>> 10))) | 0;
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + W[i]) | 0;
      const t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) odv.setInt32(i * 4, H[i]);
  return out;
}

function sha1(msg) {
  const m = pad(msg, 64, 8);
  const H = Int32Array.from([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0]);
  const W = new Int32Array(80);
  const dv = new DataView(m.buffer);
  const rol = (x, n) => (x << n) | (x >>> (32 - n));
  for (let off = 0; off < m.length; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getInt32(off + i * 4);
    for (let i = 16; i < 80; i++) W[i] = rol(W[i - 3] ^ W[i - 8] ^ W[i - 14] ^ W[i - 16], 1);
    let [a, b, c, d, e] = H;
    for (let i = 0; i < 80; i++) {
      const f = i < 20 ? (b & c) | (~b & d) : i < 40 ? b ^ c ^ d : i < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d;
      const k = i < 20 ? 0x5a827999 : i < 40 ? 0x6ed9eba1 : i < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const t = (rol(a, 5) + f + e + k + W[i]) | 0;
      e = d; d = c; c = rol(b, 30); b = a; a = t;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e;
  }
  const out = new Uint8Array(20);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 5; i++) odv.setInt32(i * 4, H[i]);
  return out;
}

/** Hash bytes with 'SHA1' | 'SHA256' | 'SHA384' | 'SHA512' (Office's names; "SHA-1" etc. also accepted). */
export function hash(alg, bytes) {
  switch (String(alg).toUpperCase().replace('-', '')) {
    case 'SHA1': return sha1(bytes);
    case 'SHA256': return sha256(bytes);
    case 'SHA384': return sha512core(bytes, IV384, 48);
    case 'SHA512': return sha512core(bytes, IV512, 64);
    default: throw new Error(`Unsupported hash algorithm ${alg}`);
  }
}
export const hashSize = (alg) => ({ SHA1: 20, SHA256: 32, SHA384: 48, SHA512: 64 })[String(alg).toUpperCase().replace('-', '')];
