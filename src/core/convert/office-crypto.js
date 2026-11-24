/**
 * Password-protected Office documents ([MS-OFFCRYPTO] / ECMA-376 Part 2):
 * a compound file with EncryptionInfo, EncryptedPackage and the
 * \u0006DataSpaces storage.
 *
 *   isOfficeEncrypted(bytes)        a compound file with an EncryptedPackage
 *   decryptOffice(bytes, password)  → the .docx package bytes; Agile
 *                                   encryption (AES-128/192/256-CBC with
 *                                   SHA-1/256/384/512, spin count, the
 *                                   data-integrity HMAC checked) and Standard
 *                                   encryption (AES-ECB, SHA-1, Office 2007)
 *   encryptOffice(bytes, password)  → compound file bytes; Agile, as Word
 *                                   writes it: AES-256, SHA-512, 100,000
 *                                   spins, HMAC, the DataSpaces streams
 *
 * AES and HMAC use WebCrypto; the spin-count hashing uses ./sha.js.
 */
import { isCfb, readCfb, writeCfb } from './cfb.js';
import { hash, hashSize } from './sha.js';
import { base64, unbase64 } from './flat-opc.js';

export class OfficeCryptoError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

const subtle = () => globalThis.crypto.subtle;
const random = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
const concat = (...arrs) => { const out = new Uint8Array(arrs.reduce((a, x) => a + x.length, 0)); let p = 0; for (const a of arrs) { out.set(a, p); p += a.length; } return out; };
const le32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
const utf16 = (s) => { const b = new Uint8Array(s.length * 2); for (let i = 0; i < s.length; i++) { b[i * 2] = s.charCodeAt(i) & 0xff; b[i * 2 + 1] = s.charCodeAt(i) >> 8; } return b; };
/** Truncates or pads (with `fill`) to `len` bytes. */
const fit = (b, len, fill = 0x36) => { if (b.length >= len) return b.slice(0, len); const out = new Uint8Array(len).fill(fill); out.set(b); return out; };
const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

const BLOCK = {
  verifierInput: Uint8Array.from([0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79]),
  verifierValue: Uint8Array.from([0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e]),
  key: Uint8Array.from([0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6]),
  hmacKey: Uint8Array.from([0x5f, 0xb2, 0xad, 0x01, 0x0c, 0xb9, 0xe1, 0xf6]),
  hmacValue: Uint8Array.from([0xa0, 0x67, 0x7f, 0x02, 0xb2, 0x2c, 0x84, 0x33]),
};

export function isOfficeEncrypted(bytes) {
  if (!isCfb(bytes)) return false;
  try { const s = readCfb(bytes); return s.has('EncryptionInfo') && s.has('EncryptedPackage'); } catch { return false; }
}

// ------------------------------------------------------------ AES without padding

const importAes = (key) => subtle().importKey('raw', key, { name: 'AES-CBC' }, false, ['encrypt', 'decrypt']);

/** AES-CBC encryption of data whose length is a multiple of 16 (no padding). */
async function cbcEncrypt(key, iv, data) {
  const k = await importAes(key);
  const out = new Uint8Array(await subtle().encrypt({ name: 'AES-CBC', iv }, k, data));
  return out.subarray(0, data.length);
}

/**
 * AES-CBC decryption without padding: WebCrypto insists on PKCS#7, so a block
 * that decrypts to a full padding block is appended.
 */
async function cbcDecrypt(key, iv, data) {
  if (!data.length) return new Uint8Array(0);
  if (data.length % 16) throw new OfficeCryptoError('The encrypted data is damaged.', 'damaged');
  const k = await importAes(key);
  const last = data.subarray(data.length - 16);
  const padBlock = new Uint8Array(16).fill(16);
  const extra = new Uint8Array(await subtle().encrypt({ name: 'AES-CBC', iv: last }, k, padBlock)).subarray(0, 16);
  const out = new Uint8Array(await subtle().decrypt({ name: 'AES-CBC', iv }, k, concat(data, extra)));
  return out;
}

/** AES-ECB decryption (Standard encryption): CBC with a zero IV, then undo the chaining. */
async function ecbDecrypt(key, data) {
  const out = await cbcDecrypt(key, new Uint8Array(16), data);
  for (let i = data.length - 16; i >= 16; i -= 16) for (let j = 0; j < 16; j++) out[i + j] ^= data[i - 16 + j];
  return out;
}

async function hmac(alg, key, data) {
  const name = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA384: 'SHA-384', SHA512: 'SHA-512' }[alg.toUpperCase().replace('-', '')];
  const k = await subtle().importKey('raw', key, { name: 'HMAC', hash: name }, false, ['sign']);
  return new Uint8Array(await subtle().sign('HMAC', k, data));
}

// ------------------------------------------------------------ Agile

/** H(salt + password), then `spin` times H(iterator + H). */
function spinHash(alg, salt, password, spin) {
  let h = hash(alg, concat(salt, utf16(password)));
  const buf = new Uint8Array(4 + h.length);
  const dv = new DataView(buf.buffer);
  for (let i = 0; i < spin; i++) {
    dv.setUint32(0, i, true);
    buf.set(h, 4);
    h = hash(alg, buf);
  }
  return h;
}
const agileKey = (alg, h, block, keyBytes) => fit(hash(alg, concat(h, block)), keyBytes);
const agileIv = (alg, salt, block, blockSize) => fit(block ? hash(alg, concat(salt, block)) : salt, blockSize);

function parseAgileInfo(xml) {
  const attrs = (tag) => {
    const m = new RegExp(`<(?:\\w+:)?${tag}\\b([^>]*)>`).exec(xml);
    if (!m) return null;
    const o = {};
    for (const a of m[1].matchAll(/([\w:]+)="([^"]*)"/g)) o[a[1].replace(/^\w+:/, '')] = a[2];
    return o;
  };
  const keyData = attrs('keyData');
  const integrity = attrs('dataIntegrity');
  const enc = attrs('encryptedKey');
  if (!keyData || !enc) throw new OfficeCryptoError('This document uses an encryption method that isn\'t supported (only password encryption is).', 'unsupported');
  return { keyData, integrity, enc };
}

async function decryptAgile(info, pkg, password) {
  const { keyData, integrity, enc } = parseAgileInfo(info);
  if (enc.cipherAlgorithm && enc.cipherAlgorithm !== 'AES') throw new OfficeCryptoError(`Unsupported cipher ${enc.cipherAlgorithm}.`, 'unsupported');
  if ((keyData.cipherChaining || 'ChainingModeCBC') !== 'ChainingModeCBC') throw new OfficeCryptoError(`Unsupported chaining ${keyData.cipherChaining}.`, 'unsupported');
  const alg = enc.hashAlgorithm;
  const keyBytes = Number(enc.keyBits) / 8;
  const blockSize = Number(enc.blockSize) || 16;
  const salt = unbase64(enc.saltValue);
  const h = spinHash(alg, salt, password, Number(enc.spinCount));
  const iv = fit(salt, blockSize);
  const input = await cbcDecrypt(agileKey(alg, h, BLOCK.verifierInput, keyBytes), iv, unbase64(enc.encryptedVerifierHashInput));
  const value = await cbcDecrypt(agileKey(alg, h, BLOCK.verifierValue, keyBytes), iv, unbase64(enc.encryptedVerifierHashValue));
  const saltSize = Number(enc.saltSize) || 16;
  if (!eq(hash(alg, input.subarray(0, saltSize)), value.subarray(0, hashSize(alg)))) throw new OfficeCryptoError('The password is incorrect.', 'wrong-password');
  const secret = (await cbcDecrypt(agileKey(alg, h, BLOCK.key, keyBytes), iv, unbase64(enc.encryptedKeyValue))).subarray(0, Number(keyData.keyBits) / 8);
  const dAlg = keyData.hashAlgorithm;
  const dSalt = unbase64(keyData.saltValue);
  const dBlock = Number(keyData.blockSize) || 16;
  // Data integrity: HMAC of the whole EncryptedPackage stream.
  if (integrity?.encryptedHmacKey) {
    const hk = (await cbcDecrypt(secret, agileIv(dAlg, dSalt, BLOCK.hmacKey, dBlock), unbase64(integrity.encryptedHmacKey))).subarray(0, hashSize(dAlg));
    const hv = (await cbcDecrypt(secret, agileIv(dAlg, dSalt, BLOCK.hmacValue, dBlock), unbase64(integrity.encryptedHmacValue))).subarray(0, hashSize(dAlg));
    if (!eq(await hmac(dAlg, hk, pkg), hv)) throw new OfficeCryptoError('The document has been changed or damaged since it was encrypted (its integrity check failed).', 'integrity');
  }
  const size = Number(new DataView(pkg.buffer, pkg.byteOffset, 8).getBigUint64(0, true));
  const out = new Uint8Array(size);
  const SEG = 4096;
  for (let i = 0, pos = 8; pos < pkg.length && i * SEG < size; i++, pos += SEG) {
    const chunk = pkg.subarray(pos, Math.min(pos + SEG, pkg.length));
    const usable = chunk.subarray(0, chunk.length - (chunk.length % 16));
    const plain = await cbcDecrypt(secret, agileIv(dAlg, dSalt, le32(i), dBlock), usable);
    out.set(plain.subarray(0, Math.min(plain.length, size - i * SEG)), i * SEG);
  }
  return out;
}

// ------------------------------------------------------------ Standard

async function decryptStandard(info, pkg, password) {
  const dv = new DataView(info.buffer, info.byteOffset, info.byteLength);
  const headerSize = dv.getUint32(8, true);
  const h = 12;
  const algId = dv.getUint32(h + 8, true);
  const keyBits = dv.getUint32(h + 16, true) || 128;
  if (![0x660e, 0x660f, 0x6610].includes(algId)) throw new OfficeCryptoError('This document uses RC4 encryption, which isn\'t supported.', 'unsupported');
  const v = h + headerSize;
  const saltSize = dv.getUint32(v, true);
  const salt = info.subarray(v + 4, v + 4 + saltSize);
  const encVerifier = info.subarray(v + 4 + saltSize, v + 20 + saltSize);
  const verifierHashSize = dv.getUint32(v + 20 + saltSize, true);
  const encVerifierHash = info.subarray(v + 24 + saltSize, v + 24 + saltSize + 32);
  const hn = spinHash('SHA1', salt, password, 50000);
  const hfinal = hash('SHA1', concat(hn, le32(0)));
  const x1 = hash('SHA1', new Uint8Array(64).fill(0x36).map((b, i) => b ^ (hfinal[i] || 0)));
  const x2 = hash('SHA1', new Uint8Array(64).fill(0x5c).map((b, i) => b ^ (hfinal[i] || 0)));
  const key = concat(x1, x2).subarray(0, keyBits / 8);
  const verifier = await ecbDecrypt(key, encVerifier);
  const verifierHash = await ecbDecrypt(key, encVerifierHash);
  if (!eq(hash('SHA1', verifier), verifierHash.subarray(0, verifierHashSize))) throw new OfficeCryptoError('The password is incorrect.', 'wrong-password');
  const size = Number(new DataView(pkg.buffer, pkg.byteOffset, 8).getBigUint64(0, true));
  const data = pkg.subarray(8, 8 + Math.floor((pkg.length - 8) / 16) * 16);
  return (await ecbDecrypt(key, data)).subarray(0, size);
}

/** The decrypted package (.docx bytes). Throws OfficeCryptoError ('wrong-password', 'integrity', 'unsupported', 'damaged'). */
export async function decryptOffice(bytes, password) {
  const streams = readCfb(bytes);
  const info = streams.get('EncryptionInfo');
  const pkg = streams.get('EncryptedPackage');
  if (!info || !pkg) throw new OfficeCryptoError('This file is not an encrypted Office document.', 'damaged');
  const major = info[0] | (info[1] << 8);
  const minor = info[2] | (info[3] << 8);
  if (major === 4 && minor === 4) return decryptAgile(new TextDecoder().decode(info.subarray(8)), pkg, password);
  if ((major === 3 || major === 4) && minor === 2) return decryptStandard(info, pkg, password);
  if (minor === 3) throw new OfficeCryptoError('This document uses Extensible encryption, which isn\'t supported.', 'unsupported');
  throw new OfficeCryptoError('This document uses RC4 encryption, which isn\'t supported.', 'unsupported');
}

// ------------------------------------------------------------ writing (Agile)

/** A UTF-16 string with its byte length first, padded to 4 bytes ([MS-OFFCRYPTO] 2.1.2). */
function lpString(s) {
  const b = utf16(s);
  const pad = (4 - (b.length % 4)) % 4;
  return concat(le32(b.length), b, new Uint8Array(pad));
}

/** The \u0006DataSpaces streams Word writes for an encrypted package. */
export function dataSpaces() {
  // Reader, updater and writer versions 1.0 (major, minor as 16-bit values).
  const version = concat(lpString('Microsoft.Container.DataSpaces'), Uint8Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]));
  // DataSpaceMap: one entry mapping the EncryptedPackage stream to StrongEncryptionDataSpace.
  const entryBody = concat(le32(1), le32(0), lpString('EncryptedPackage'), lpString('StrongEncryptionDataSpace'));
  const map = concat(le32(8), le32(1), le32(entryBody.length + 4), entryBody);
  const info = concat(le32(8), le32(1), lpString('StrongEncryptionTransform'));
  // TransformInfoHeader: its length counts itself, the type and the ID (not the name).
  const id = lpString('{FF9A3F03-56EF-4613-BDD5-5A41C1D07246}');
  const primary = concat(le32(8 + id.length), le32(1), id, lpString('Microsoft.Container.EncryptionTransform'), Uint8Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), le32(0), le32(0), le32(0), le32(4));
  return {
    '\u0006DataSpaces/Version': version,
    '\u0006DataSpaces/DataSpaceMap': map,
    '\u0006DataSpaces/DataSpaceInfo/StrongEncryptionDataSpace': info,
    '\u0006DataSpaces/TransformInfo/StrongEncryptionTransform/\u0006Primary': primary,
  };
}

/**
 * Encrypts a package (.docx bytes) with a password.
 * @param {{ spinCount?: number, hashAlgorithm?: string, keyBits?: number }} [opts]
 */
export async function encryptOffice(bytes, password, { spinCount = 100000, hashAlgorithm = 'SHA512', keyBits = 256 } = {}) {
  const alg = hashAlgorithm;
  const hs = hashSize(alg);
  const keyBytes = keyBits / 8;
  const secret = random(keyBytes);
  const dSalt = random(16);
  // EncryptedPackage: size, then 4096-byte segments, each with its own IV.
  const SEG = 4096;
  const parts = [new Uint8Array(8)];
  new DataView(parts[0].buffer).setBigUint64(0, BigInt(bytes.length), true);
  for (let i = 0; i * SEG < bytes.length; i++) {
    const chunk = bytes.subarray(i * SEG, Math.min((i + 1) * SEG, bytes.length));
    const padded = chunk.length % 16 ? fit(chunk, Math.ceil(chunk.length / 16) * 16, 0) : chunk;
    parts.push(await cbcEncrypt(secret, agileIv(alg, dSalt, le32(i), 16), padded));
  }
  const pkg = concat(...parts);
  // Data integrity.
  const hmacKey = random(hs);
  const encHmacKey = await cbcEncrypt(secret, agileIv(alg, dSalt, BLOCK.hmacKey, 16), fit(hmacKey, Math.ceil(hs / 16) * 16, 0));
  const encHmacValue = await cbcEncrypt(secret, agileIv(alg, dSalt, BLOCK.hmacValue, 16), fit(await hmac(alg, hmacKey, pkg), Math.ceil(hs / 16) * 16, 0));
  // Password key encryptor.
  const pSalt = random(16);
  const h = spinHash(alg, pSalt, password, spinCount);
  const iv = fit(pSalt, 16);
  const verifierInput = random(16);
  const encVerifierInput = await cbcEncrypt(agileKey(alg, h, BLOCK.verifierInput, keyBytes), iv, verifierInput);
  const encVerifierValue = await cbcEncrypt(agileKey(alg, h, BLOCK.verifierValue, keyBytes), iv, fit(hash(alg, verifierInput), Math.ceil(hs / 16) * 16, 0));
  const encKey = await cbcEncrypt(agileKey(alg, h, BLOCK.key, keyBytes), iv, secret);
  const common = `saltSize="16" blockSize="16" keyBits="${keyBits}" hashSize="${hs}" cipherAlgorithm="AES" cipherChaining="ChainingModeCBC" hashAlgorithm="${alg}"`;
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'
    + '<encryption xmlns="http://schemas.microsoft.com/office/2006/encryption" xmlns:p="http://schemas.microsoft.com/office/2006/keyEncryptor/password" xmlns:c="http://schemas.microsoft.com/office/2006/keyEncryptor/certificate">'
    + `<keyData ${common} saltValue="${base64(dSalt)}"/>`
    + `<dataIntegrity encryptedHmacKey="${base64(encHmacKey)}" encryptedHmacValue="${base64(encHmacValue)}"/>`
    + '<keyEncryptors><keyEncryptor uri="http://schemas.microsoft.com/office/2006/keyEncryptor/password">'
    + `<p:encryptedKey spinCount="${spinCount}" ${common} saltValue="${base64(pSalt)}" encryptedVerifierHashInput="${base64(encVerifierInput)}" encryptedVerifierHashValue="${base64(encVerifierValue)}" encryptedKeyValue="${base64(encKey)}"/>`
    + '</keyEncryptor></keyEncryptors></encryption>';
  const info = concat(Uint8Array.from([4, 0, 4, 0, 0x40, 0, 0, 0]), new TextEncoder().encode(xml));
  return writeCfb({ ...dataSpaces(), EncryptionInfo: info, EncryptedPackage: pkg });
}
