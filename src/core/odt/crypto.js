/**
 * Password-protected ODT (ODF 1.2+ package encryption, as LibreOffice writes
 * it): every file except "mimetype" and the manifest is deflated, then
 * encrypted with AES-256-CBC; the key comes from PBKDF2-HMAC-SHA1 (100 000
 * iterations, random 16-byte salt) over the SHA-256 hash of the password.
 * The manifest records the algorithm, salt, IV and a SHA-256 checksum of the
 * first 1024 bytes of the compressed data, which detects a wrong password.
 * The thumbnail is left out, so the package doesn't show the first page.
 */
import { unzipSync, zipSync, deflateSync, inflateSync, strToU8, strFromU8 } from 'fflate';
import { escAttr, XML_DECL } from './xml.js';

const MANIFEST_NS = 'urn:oasis:names:tc:opendocument:xmlns:manifest:1.0';
const AES256 = 'http://www.w3.org/2001/04/xmlenc#aes256-cbc';
const SHA256 = 'http://www.w3.org/2000/09/xmldsig#sha256';
const SHA256_1K = 'urn:oasis:names:tc:opendocument:xmlns:manifest:1.0#sha256-1k';
const ITERATIONS = 100000;

export class WrongPasswordError extends Error {
  constructor() { super('The password is incorrect.'); this.code = 'wrong-password'; }
}

const b64 = (bytes) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const subtle = () => globalThis.crypto.subtle;

async function deriveKey(password, salt, iterations, keySize, startHash = 'SHA-256') {
  const start = new Uint8Array(await subtle().digest(startHash, strToU8(password)));
  const base = await subtle().importKey('raw', start, 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-1' }, base, { name: 'AES-CBC', length: keySize * 8 }, false, ['encrypt', 'decrypt']);
}

/**
 * AES-CBC decryption with XML Encryption padding (only the last byte says how
 * many bytes to drop), which WebCrypto's PKCS#7 check rejects. One extra block
 * is appended that decrypts to a full PKCS#7 padding block, then the real
 * padding is removed by its last byte.
 */
async function decryptW3c(key, iv, data) {
  if (!data.length || data.length % 16) throw new WrongPasswordError();
  const last = data.subarray(data.length - 16);
  const pad = new Uint8Array(16).fill(16);
  const extra = new Uint8Array(await subtle().encrypt({ name: 'AES-CBC', iv: last }, key, pad)).subarray(0, 16);
  const joined = new Uint8Array(data.length + 16);
  joined.set(data);
  joined.set(extra, data.length);
  const plain = new Uint8Array(await subtle().decrypt({ name: 'AES-CBC', iv }, key, joined));
  const n = plain[plain.length - 1];
  if (n < 1 || n > 16) throw new WrongPasswordError();
  return plain.subarray(0, plain.length - n);
}

async function checksum(compressed) {
  return new Uint8Array(await subtle().digest('SHA-256', compressed.subarray(0, 1024)));
}

/** True if the package's manifest says it is encrypted. */
export function isEncrypted(bytes) {
  try {
    const files = unzipSync(bytes, { filter: (f) => f.name === 'META-INF/manifest.xml' });
    const m = files['META-INF/manifest.xml'];
    return !!m && /<manifest:encryption-data\b/.test(strFromU8(m));
  } catch { return false; }
}

/** An encrypted package → the same package unencrypted (throws WrongPasswordError). */
export async function decryptPackage(bytes, password) {
  const files = unzipSync(bytes);
  const manifestText = strFromU8(files['META-INF/manifest.xml']);
  const doc = new DOMParser().parseFromString(manifestText, 'application/xml');
  const out = { mimetype: [files.mimetype, { level: 0 }] };
  const keyCache = new Map();
  const plainManifest = doc.cloneNode(true);
  for (const entry of [...plainManifest.getElementsByTagNameNS(MANIFEST_NS, 'encryption-data')]) entry.remove();
  for (const el of [...plainManifest.getElementsByTagNameNS(MANIFEST_NS, 'file-entry')]) el.removeAttributeNS(MANIFEST_NS, 'size');
  out['META-INF/manifest.xml'] = strToU8(new XMLSerializer().serializeToString(plainManifest));
  const entries = new Map([...doc.getElementsByTagNameNS(MANIFEST_NS, 'file-entry')].map((e) => [e.getAttributeNS(MANIFEST_NS, 'full-path'), e]));
  for (const [path, data] of Object.entries(files)) {
    if (path === 'mimetype' || path === 'META-INF/manifest.xml' || path.endsWith('/')) continue;
    const enc = entries.get(path)?.getElementsByTagNameNS(MANIFEST_NS, 'encryption-data')[0];
    if (!enc) { out[path] = data; continue; }
    const alg = enc.getElementsByTagNameNS(MANIFEST_NS, 'algorithm')[0];
    const kd = enc.getElementsByTagNameNS(MANIFEST_NS, 'key-derivation')[0];
    const sk = enc.getElementsByTagNameNS(MANIFEST_NS, 'start-key-generation')[0];
    if (alg.getAttributeNS(MANIFEST_NS, 'algorithm-name') !== AES256 || kd.getAttributeNS(MANIFEST_NS, 'key-derivation-name') !== 'PBKDF2') {
      throw new Error('This document uses an older kind of encryption that ODT Editor can’t open. Re-save it with AES-256 in LibreOffice.');
    }
    const salt = unb64(kd.getAttributeNS(MANIFEST_NS, 'salt'));
    const iterations = Number(kd.getAttributeNS(MANIFEST_NS, 'iteration-count')) || 1024;
    const size = Number(kd.getAttributeNS(MANIFEST_NS, 'key-size')) || 32;
    const startHash = sk && sk.getAttributeNS(MANIFEST_NS, 'start-key-generation-name') !== SHA256 ? 'SHA-1' : 'SHA-256';
    const k = `${b64(salt)}|${iterations}|${size}|${startHash}`;
    if (!keyCache.has(k)) keyCache.set(k, await deriveKey(password, salt, iterations, size, startHash));
    const iv = unb64(alg.getAttributeNS(MANIFEST_NS, 'initialisation-vector'));
    let compressed;
    try {
      compressed = await decryptW3c(keyCache.get(k), iv, data);
    } catch { throw new WrongPasswordError(); }
    const want = enc.getAttributeNS(MANIFEST_NS, 'checksum');
    if (want && enc.getAttributeNS(MANIFEST_NS, 'checksum-type') === SHA256_1K && b64(await checksum(compressed)) !== want) throw new WrongPasswordError();
    try { out[path] = inflateSync(compressed); } catch { throw new WrongPasswordError(); }
  }
  return zipSync(out);
}

/** A package → the same package encrypted with `password`. */
export async function encryptPackage(bytes, password) {
  const files = unzipSync(bytes);
  const doc = new DOMParser().parseFromString(strFromU8(files['META-INF/manifest.xml']), 'application/xml');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt, ITERATIONS, 32);
  const zip = { mimetype: [files.mimetype, { level: 0 }], 'META-INF/manifest.xml': null };
  const extra = new Map();
  for (const [path, data] of Object.entries(files)) {
    if (path === 'mimetype' || path === 'META-INF/manifest.xml' || path.endsWith('/') || path.startsWith('Thumbnails/')) continue;
    const compressed = deflateSync(data, { level: 6 });
    const iv = crypto.getRandomValues(new Uint8Array(16));
    const encrypted = new Uint8Array(await subtle().encrypt({ name: 'AES-CBC', iv }, key, compressed));
    zip[path] = [encrypted, { level: 0 }];
    extra.set(path, { size: data.length, iv: b64(iv), sum: b64(await checksum(compressed)) });
  }
  const lines = [];
  for (const el of doc.getElementsByTagNameNS(MANIFEST_NS, 'file-entry')) {
    const path = el.getAttributeNS(MANIFEST_NS, 'full-path');
    if (path.startsWith('Thumbnails/')) continue;
    const attrs = [...el.attributes].filter((a) => a.prefix !== 'xmlns' && a.localName !== 'size').map((a) => ` manifest:${a.localName}="${escAttr(a.value)}"`).join('');
    const e = extra.get(path);
    if (!e) { lines.push(` <manifest:file-entry${attrs}/>`); continue; }
    lines.push(` <manifest:file-entry${attrs} manifest:size="${e.size}">
  <manifest:encryption-data manifest:checksum-type="${SHA256_1K}" manifest:checksum="${e.sum}">
   <manifest:algorithm manifest:algorithm-name="${AES256}" manifest:initialisation-vector="${e.iv}"/>
   <manifest:start-key-generation manifest:start-key-generation-name="${SHA256}" manifest:key-size="32"/>
   <manifest:key-derivation manifest:key-derivation-name="PBKDF2" manifest:key-size="32" manifest:iteration-count="${ITERATIONS}" manifest:salt="${b64(salt)}"/>
  </manifest:encryption-data>
 </manifest:file-entry>`);
  }
  zip['META-INF/manifest.xml'] = strToU8(`${XML_DECL}<manifest:manifest xmlns:manifest="${MANIFEST_NS}" manifest:version="1.3">\n${lines.join('\n')}\n</manifest:manifest>\n`);
  return zipSync(zip, { mtime: new Date() });
}
