/**
 * Compound File Binary format ([MS-CFB]), the OLE container that holds a
 * password-protected Office document (EncryptionInfo, EncryptedPackage and
 * the \u0006DataSpaces storage).
 *
 *   isCfb(bytes)            the D0 CF 11 E0 signature
 *   readCfb(bytes)          → Map(path → Uint8Array), storages separated by "/"
 *   writeCfb(streams)       { path: Uint8Array } → bytes; version 3, 512-byte
 *                           sectors, FAT (+ DIFAT for large files), directory
 *                           as a red-black tree, mini stream for streams under
 *                           4096 bytes
 */

const SIG = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const FREESECT = 0xffffffff;
const ENDOFCHAIN = 0xfffffffe;
const FATSECT = 0xfffffffd;
const DIFSECT = 0xfffffffc;
const NOSTREAM = 0xffffffff;
const MINI_CUTOFF = 4096;

export const isCfb = (b) => b && b.length >= 512 && SIG.every((x, i) => b[i] === x);

export class CfbError extends Error {}

// ------------------------------------------------------------ reading

export function readCfb(bytes) {
  if (!isCfb(bytes)) throw new CfbError('Not a compound file.');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (o) => dv.getUint32(o, true);
  const sectorSize = 1 << dv.getUint16(0x1e, true);
  const miniSize = 1 << dv.getUint16(0x20, true);
  const nFat = u32(0x2c);
  const firstDir = u32(0x30);
  const cutoff = u32(0x38) || MINI_CUTOFF;
  const firstMiniFat = u32(0x3c);
  const nMiniFat = u32(0x40);
  let difatSector = u32(0x44);
  const sectorOffset = (s) => (s + 1) * sectorSize;
  // FAT sector list: 109 in the header, the rest in DIFAT sectors.
  const fatSectors = [];
  for (let i = 0; i < 109 && fatSectors.length < nFat; i++) { const s = u32(0x4c + i * 4); if (s !== FREESECT) fatSectors.push(s); }
  for (let guard = 0; difatSector !== ENDOFCHAIN && difatSector !== FREESECT && fatSectors.length < nFat && guard < 1e6; guard++) {
    const off = sectorOffset(difatSector);
    const per = sectorSize / 4 - 1;
    for (let i = 0; i < per && fatSectors.length < nFat; i++) { const s = u32(off + i * 4); if (s !== FREESECT) fatSectors.push(s); }
    difatSector = u32(off + per * 4);
  }
  const fat = new Uint32Array(fatSectors.length * (sectorSize / 4));
  fatSectors.forEach((s, k) => { const off = sectorOffset(s); for (let i = 0; i < sectorSize / 4; i++) fat[k * (sectorSize / 4) + i] = off + i * 4 + 4 <= bytes.length ? u32(off + i * 4) : FREESECT; });
  const chain = (start, table) => {
    const out = [];
    const seen = new Set();
    for (let s = start; s !== ENDOFCHAIN && s !== FREESECT && s < table.length; s = table[s]) {
      if (seen.has(s)) throw new CfbError('The compound file has a loop in its sector chain.');
      seen.add(s);
      out.push(s);
    }
    return out;
  };
  const readChain = (start, size) => {
    const sectors = chain(start, fat);
    const out = new Uint8Array(size ?? sectors.length * sectorSize);
    let pos = 0;
    for (const s of sectors) {
      const off = sectorOffset(s);
      const n = Math.min(sectorSize, out.length - pos);
      if (n <= 0) break;
      out.set(bytes.subarray(off, off + n), pos);
      pos += n;
    }
    return out;
  };
  // Directory.
  const dir = readChain(firstDir);
  const ddv = new DataView(dir.buffer);
  const entries = [];
  for (let off = 0; off + 128 <= dir.length; off += 128) {
    const nameLen = ddv.getUint16(off + 0x40, true);
    let name = '';
    for (let i = 0; i < Math.max(0, nameLen / 2 - 1); i++) name += String.fromCharCode(ddv.getUint16(off + i * 2, true));
    entries.push({
      name,
      type: dir[off + 0x42],
      left: ddv.getUint32(off + 0x44, true),
      right: ddv.getUint32(off + 0x48, true),
      child: ddv.getUint32(off + 0x4c, true),
      start: ddv.getUint32(off + 0x74, true),
      size: ddv.getUint32(off + 0x78, true) + ddv.getUint32(off + 0x7c, true) * 2 ** 32,
    });
  }
  const root = entries[0];
  if (!root || root.type !== 5) throw new CfbError('The compound file has no root entry.');
  const miniStream = root.start !== ENDOFCHAIN ? readChain(root.start, root.size) : new Uint8Array(0);
  const miniFatBytes = nMiniFat ? readChain(firstMiniFat) : new Uint8Array(0);
  const miniFat = new Uint32Array(miniFatBytes.buffer, 0, Math.floor(miniFatBytes.length / 4));
  const readMini = (start, size) => {
    const out = new Uint8Array(size);
    let pos = 0;
    for (const s of chain(start, miniFat)) {
      const n = Math.min(miniSize, size - pos);
      if (n <= 0) break;
      out.set(miniStream.subarray(s * miniSize, s * miniSize + n), pos);
      pos += n;
    }
    return out;
  };
  const out = new Map();
  const walk = (id, prefix, depth) => {
    if (id === NOSTREAM || id >= entries.length || depth > 64) return;
    const e = entries[id];
    walk(e.left, prefix, depth + 1);
    walk(e.right, prefix, depth + 1);
    const path = prefix + e.name;
    if (e.type === 2) out.set(path, e.size < cutoff ? readMini(e.start, e.size) : readChain(e.start, e.size));
    else if (e.type === 1) walk(e.child, `${path}/`, depth + 1);
  };
  walk(root.child, '', 0);
  return out;
}

// ------------------------------------------------------------ writing

/** CFB name order: shorter first, then by upper-case UTF-16 code units. */
function compareNames(a, b) {
  if (a.length !== b.length) return a.length - b.length;
  const A = a.toUpperCase();
  const B = b.toUpperCase();
  return A < B ? -1 : A > B ? 1 : 0;
}

/**
 * @param {Record<string, Uint8Array>} streams paths like "EncryptionInfo" or
 *   "\u0006DataSpaces/Version"; storages are created from the paths
 * @returns {Uint8Array}
 */
export function writeCfb(streams) {
  const SS = 512;
  // Directory tree.
  const root = { name: 'Root Entry', type: 5, children: [] };
  const nodes = [root];
  for (const [path, data] of Object.entries(streams)) {
    const parts = path.split('/');
    let cur = root;
    parts.forEach((p, i) => {
      let next = cur.children.find((c) => c.name === p);
      if (!next) {
        next = i === parts.length - 1 ? { name: p, type: 2, data, children: [] } : { name: p, type: 1, children: [] };
        if (p.length > 31) throw new CfbError(`Stream name too long: ${p}`);
        cur.children.push(next);
        nodes.push(next);
      }
      cur = next;
    });
  }
  nodes.forEach((n, i) => { n.id = i; n.left = NOSTREAM; n.right = NOSTREAM; n.child = NOSTREAM; n.color = 1; });
  // Each storage's children as a balanced red-black tree.
  for (const n of nodes) {
    if (!n.children.length) continue;
    const sorted = [...n.children].sort((a, b) => compareNames(a.name, b.name));
    const nullDepths = [];
    const build = (lo, hi, depth) => {
      if (lo > hi) { nullDepths.push(depth); return null; }
      const mid = (lo + hi) >> 1;
      const node = sorted[mid];
      node.depth = depth;
      const l = build(lo, mid - 1, depth + 1);
      const r = build(mid + 1, hi, depth + 1);
      node.left = l ? l.id : NOSTREAM;
      node.right = r ? r.id : NOSTREAM;
      return node;
    };
    const top = build(0, sorted.length - 1, 0);
    n.child = top.id;
    const maxDepth = Math.max(...sorted.map((x) => x.depth));
    const minNull = Math.min(...nullDepths);
    // Leaves on the deepest level are red when that level isn't full: equal black heights.
    for (const x of sorted) x.color = x.depth === maxDepth && minNull <= maxDepth && maxDepth > 0 ? 0 : 1;
  }
  // Streams: small ones in the mini stream.
  const mini = [];
  const big = [];
  for (const n of nodes) if (n.type === 2) (n.data.length < MINI_CUTOFF ? mini : big).push(n);
  let miniLen = 0;
  for (const n of mini) { n.miniStart = n.data.length ? miniLen / 64 : ENDOFCHAIN; miniLen += Math.ceil(n.data.length / 64) * 64; }
  const miniSectors = miniLen / 64;
  const miniFatSectors = Math.ceil((miniSectors * 4) / SS);
  const miniStreamSectors = Math.ceil(miniLen / SS);
  const dirSectors = Math.ceil((nodes.length * 128) / SS);
  const bigSectors = big.reduce((a, n) => a + Math.ceil(n.data.length / SS), 0);
  const dataSectors = miniFatSectors + dirSectors + miniStreamSectors + bigSectors;
  let fatSectors = 1;
  let difatSectors = 0;
  for (;;) {
    difatSectors = fatSectors > 109 ? Math.ceil((fatSectors - 109) / (SS / 4 - 1)) : 0;
    const need = Math.ceil((dataSectors + fatSectors + difatSectors) / (SS / 4));
    if (need <= fatSectors) break;
    fatSectors = need;
  }
  const total = fatSectors + difatSectors + dataSectors;
  const fat = new Uint32Array(fatSectors * (SS / 4)).fill(FREESECT);
  let next = 0;
  const fatIds = [];
  for (let i = 0; i < fatSectors; i++) { fatIds.push(next); fat[next++] = FATSECT; }
  const difatIds = [];
  for (let i = 0; i < difatSectors; i++) { difatIds.push(next); fat[next++] = DIFSECT; }
  const alloc = (count) => {
    if (!count) return ENDOFCHAIN;
    const start = next;
    for (let i = 0; i < count; i++) { fat[next] = i === count - 1 ? ENDOFCHAIN : next + 1; next++; }
    return start;
  };
  const miniFatStart = alloc(miniFatSectors);
  const dirStart = alloc(dirSectors);
  const miniStreamStart = alloc(miniStreamSectors);
  for (const n of big) n.start = alloc(Math.ceil(n.data.length / SS));
  if (next !== total) throw new CfbError('Compound file layout error.');
  const out = new Uint8Array((total + 1) * SS);
  const dv = new DataView(out.buffer);
  const sec = (s) => (s + 1) * SS;
  // Header.
  out.set(SIG, 0);
  dv.setUint16(0x18, 0x003e, true);
  dv.setUint16(0x1a, 3, true);
  dv.setUint16(0x1c, 0xfffe, true);
  dv.setUint16(0x1e, 9, true);
  dv.setUint16(0x20, 6, true);
  dv.setUint32(0x2c, fatSectors, true);
  dv.setUint32(0x30, dirStart, true);
  dv.setUint32(0x38, MINI_CUTOFF, true);
  dv.setUint32(0x3c, miniFatStart, true);
  dv.setUint32(0x40, miniFatSectors, true);
  dv.setUint32(0x44, difatSectors ? difatIds[0] : ENDOFCHAIN, true);
  dv.setUint32(0x48, difatSectors, true);
  for (let i = 0; i < 109; i++) dv.setUint32(0x4c + i * 4, i < fatIds.length ? fatIds[i] : FREESECT, true);
  // DIFAT sectors.
  difatIds.forEach((s, k) => {
    const per = SS / 4 - 1;
    for (let i = 0; i < per; i++) { const idx = 109 + k * per + i; dv.setUint32(sec(s) + i * 4, idx < fatIds.length ? fatIds[idx] : FREESECT, true); }
    dv.setUint32(sec(s) + per * 4, k + 1 < difatIds.length ? difatIds[k + 1] : ENDOFCHAIN, true);
  });
  // FAT.
  fatIds.forEach((s, k) => { for (let i = 0; i < SS / 4; i++) dv.setUint32(sec(s) + i * 4, fat[k * (SS / 4) + i], true); });
  // Mini FAT and mini stream.
  const miniFat = new Uint32Array(miniFatSectors * (SS / 4)).fill(FREESECT);
  for (const n of mini) {
    if (!n.data.length) continue;
    const count = Math.ceil(n.data.length / 64);
    for (let i = 0; i < count; i++) miniFat[n.miniStart + i] = i === count - 1 ? ENDOFCHAIN : n.miniStart + i + 1;
  }
  for (let i = 0; i < miniFatSectors; i++) for (let j = 0; j < SS / 4; j++) dv.setUint32(sec(miniFatStart + i) + j * 4, miniFat[i * (SS / 4) + j], true);
  const miniStream = new Uint8Array(miniStreamSectors * SS);
  for (const n of mini) if (n.data.length) miniStream.set(n.data, n.miniStart * 64);
  for (let i = 0; i < miniStreamSectors; i++) out.set(miniStream.subarray(i * SS, (i + 1) * SS), sec(miniStreamStart + i));
  for (const n of big) for (let i = 0; i * SS < n.data.length; i++) out.set(n.data.subarray(i * SS, (i + 1) * SS), sec(n.start + i));
  // Directory.
  const dir = new Uint8Array(dirSectors * SS);
  const ddv = new DataView(dir.buffer);
  for (let i = nodes.length; i < dirSectors * 4; i++) { ddv.setUint32(i * 128 + 0x44, NOSTREAM, true); ddv.setUint32(i * 128 + 0x48, NOSTREAM, true); ddv.setUint32(i * 128 + 0x4c, NOSTREAM, true); }
  for (const n of nodes) {
    const o = n.id * 128;
    for (let i = 0; i < n.name.length; i++) ddv.setUint16(o + i * 2, n.name.charCodeAt(i), true);
    ddv.setUint16(o + 0x40, (n.name.length + 1) * 2, true);
    dir[o + 0x42] = n.type;
    dir[o + 0x43] = n === root ? 1 : n.color;
    ddv.setUint32(o + 0x44, n.left, true);
    ddv.setUint32(o + 0x48, n.right, true);
    ddv.setUint32(o + 0x4c, n.child, true);
    if (n === root) {
      ddv.setUint32(o + 0x74, miniStreamSectors ? miniStreamStart : ENDOFCHAIN, true);
      ddv.setUint32(o + 0x78, miniLen, true);
    } else if (n.type === 2) {
      ddv.setUint32(o + 0x74, n.data.length < MINI_CUTOFF ? (n.data.length ? n.miniStart : ENDOFCHAIN) : n.start, true);
      ddv.setUint32(o + 0x78, n.data.length % 2 ** 32, true);
      ddv.setUint32(o + 0x7c, Math.floor(n.data.length / 2 ** 32), true);
    }
  }
  for (let i = 0; i < dirSectors; i++) out.set(dir.subarray(i * SS, (i + 1) * SS), sec(dirStart + i));
  return out;
}
