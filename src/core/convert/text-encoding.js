/**
 * Plain text encodings for Save as Plain Text (Word's File Conversion
 * dialog) and for opening .txt files.
 *
 *   detectEncoding(bytes)  BOM (UTF-8 / UTF-16 LE / UTF-16 BE), else UTF-8
 *                          when the bytes are valid UTF-8, else Windows-1252
 *   decodeText(bytes)      → { text, encoding, lineEnding }
 *   encodeText(text, opts) → { bytes, unencodable } in any of ENCODINGS,
 *                          with CR/LF, LF or CR line endings and optional
 *                          character substitution (smart quotes, dashes,
 *                          ellipsis → ASCII) for single-byte encodings
 *
 * TextEncoder only writes UTF-8, so the UTF-16 and single-byte encoders are
 * written here.
 */

export const ENCODINGS = [
  { id: 'utf-8', labelKey: 'enc.utf8', bom: false, single: false },
  { id: 'utf-8-bom', labelKey: 'enc.utf8bom', bom: true, single: false },
  { id: 'utf-16le', labelKey: 'enc.utf16le', bom: true, single: false },
  { id: 'utf-16be', labelKey: 'enc.utf16be', bom: true, single: false },
  { id: 'windows-1252', labelKey: 'enc.cp1252', bom: false, single: true },
  { id: 'iso-8859-1', labelKey: 'enc.latin1', bom: false, single: true },
  { id: 'us-ascii', labelKey: 'enc.ascii', bom: false, single: true },
];

export const LINE_ENDINGS = [
  { id: 'crlf', labelKey: 'enc.crlf', chars: '\r\n' },
  { id: 'lf', labelKey: 'enc.lf', chars: '\n' },
  { id: 'cr', labelKey: 'enc.cr', chars: '\r' },
];

/** Windows-1252 bytes 0x80–0x9F (undefined positions are null). */
const CP1252_HIGH = [
  0x20ac, null, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, null, 0x017d, null,
  null, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, null, 0x017e, 0x0178,
];
const CP1252_ENCODE = new Map(CP1252_HIGH.map((cp, i) => [cp, 0x80 + i]).filter(([cp]) => cp != null));

/** Character substitution (Word's "Allow character substitution"). */
export const SUBSTITUTIONS = {
  '‘': "'", '’': "'", '‚': "'", '‛': "'", '′': "'",
  '“': '"', '”': '"', '„': '"', '‟': '"', '″': '"',
  '–': '-', '—': '--', '―': '--', '‒': '-', '‐': '-', '‑': '-', '−': '-',
  '…': '...', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ',
  '•': '*', '·': '*', '­': '', '™': '(TM)', '©': '(C)', '®': '(R)', '€': 'EUR',
  '‹': '<', '›': '>', '«': '<<', '»': '>>',
};

/** The byte of a code point in a single-byte encoding, or -1. */
function singleByte(enc, cp) {
  if (enc === 'us-ascii') return cp < 0x80 ? cp : -1;
  if (enc === 'iso-8859-1') return cp < 0x100 ? cp : -1;
  // windows-1252
  if (cp < 0x80 || (cp >= 0xa0 && cp < 0x100)) return cp;
  return CP1252_ENCODE.get(cp) ?? -1;
}

/** Whether the code point can be written in the encoding. */
export function canEncode(enc, cp) {
  const e = ENCODINGS.find((x) => x.id === enc);
  if (!e?.single) return true;
  return singleByte(enc, cp) >= 0;
}

export function isValidUtf8(bytes, start = 0) {
  for (let i = start; i < bytes.length;) {
    const b = bytes[i];
    if (b < 0x80) { i++; continue; }
    let n;
    let min;
    if (b >= 0xc2 && b <= 0xdf) { n = 1; min = 0x80; } else if (b >= 0xe0 && b <= 0xef) { n = 2; min = 0x800; } else if (b >= 0xf0 && b <= 0xf4) { n = 3; min = 0x10000; } else return false;
    if (i + n >= bytes.length) return false;
    let cp = b & (0x3f >> n);
    for (let k = 1; k <= n; k++) {
      const c = bytes[i + k];
      if (c === undefined || (c & 0xc0) !== 0x80) return false;
      cp = (cp << 6) | (c & 0x3f);
    }
    if (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return false;
    i += n + 1;
  }
  return true;
}

/** The encoding of text file bytes: { encoding, bomLength }. */
export function detectEncoding(bytes) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { encoding: 'utf-8-bom', bomLength: 3 };
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { encoding: 'utf-16le', bomLength: 2 };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { encoding: 'utf-16be', bomLength: 2 };
  return { encoding: isValidUtf8(bytes) ? 'utf-8' : 'windows-1252', bomLength: 0 };
}

/** The line ending used most in a text ('crlf' when there is none). */
export function detectLineEnding(text) {
  let crlf = 0;
  let lf = 0;
  let cr = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 13) { if (text.charCodeAt(i + 1) === 10) { crlf++; i++; } else cr++; } else if (c === 10) lf++;
  }
  if (!crlf && !lf && !cr) return 'crlf';
  if (crlf >= lf && crlf >= cr) return 'crlf';
  return lf >= cr ? 'lf' : 'cr';
}

function decodeSingle(bytes, enc, start) {
  let s = '';
  for (let i = start; i < bytes.length; i++) {
    const b = bytes[i];
    if (enc === 'windows-1252' && b >= 0x80 && b < 0xa0) s += String.fromCharCode(CP1252_HIGH[b - 0x80] ?? b);
    else s += String.fromCharCode(b);
  }
  return s;
}

function decodeUtf16(bytes, le, start) {
  let s = '';
  for (let i = start; i + 1 < bytes.length; i += 2) s += String.fromCharCode(le ? bytes[i] | (bytes[i + 1] << 8) : (bytes[i] << 8) | bytes[i + 1]);
  return s;
}

/** Bytes in a known encoding → string (BOM removed). */
export function decodeAs(bytes, encoding) {
  const bomLen = { 'utf-8-bom': 3, 'utf-16le': 2, 'utf-16be': 2 }[encoding] || 0;
  const hasBom = bomLen && detectEncoding(bytes).encoding === encoding;
  const start = hasBom ? bomLen : 0;
  switch (encoding) {
    case 'utf-8': case 'utf-8-bom': return new TextDecoder('utf-8').decode(bytes.subarray(start));
    case 'utf-16le': return decodeUtf16(bytes, true, start);
    case 'utf-16be': return decodeUtf16(bytes, false, start);
    default: return decodeSingle(bytes, encoding, start);
  }
}

/** Text file bytes → { text (with \n line breaks), encoding, lineEnding }. */
export function decodeText(bytes) {
  const { encoding } = detectEncoding(bytes);
  const raw = decodeAs(bytes, encoding);
  const lineEnding = detectLineEnding(raw);
  return { text: raw.replace(/\r\n?/g, '\n'), encoding, lineEnding };
}

/**
 * A string (with \n line breaks) → bytes.
 * @returns {{ bytes: Uint8Array, unencodable: number[] }} indexes (into the
 *   normalised text) of characters the encoding can't hold (written as "?")
 */
export function encodeText(text, { encoding = 'utf-8', lineEnding = 'crlf', substitute = false } = {}) {
  const eol = LINE_ENDINGS.find((l) => l.id === lineEnding)?.chars ?? '\r\n';
  const enc = ENCODINGS.find((e) => e.id === encoding) || ENCODINGS[0];
  let src = text.replace(/\r\n?/g, '\n');
  const unencodable = [];
  if (enc.single) {
    const out = [];
    let i = 0;
    for (const ch of src) {
      const cp = ch.codePointAt(0);
      if (ch === '\n') { for (const c of eol) out.push(c.charCodeAt(0)); i += ch.length; continue; }
      let b = singleByte(enc.id, cp);
      if (b < 0 && substitute && SUBSTITUTIONS[ch] != null) {
        const sub = SUBSTITUTIONS[ch];
        if ([...sub].every((c) => singleByte(enc.id, c.codePointAt(0)) >= 0)) { for (const c of sub) out.push(singleByte(enc.id, c.codePointAt(0))); i += ch.length; continue; }
      }
      if (b < 0) { unencodable.push(i); b = 0x3f; }
      out.push(b);
      i += ch.length;
    }
    return { bytes: Uint8Array.from(out), unencodable };
  }
  src = src.replace(/\n/g, eol);
  if (enc.id === 'utf-8' || enc.id === 'utf-8-bom') {
    const body = new TextEncoder().encode(src);
    if (enc.id === 'utf-8') return { bytes: body, unencodable };
    const out = new Uint8Array(body.length + 3);
    out.set([0xef, 0xbb, 0xbf]);
    out.set(body, 3);
    return { bytes: out, unencodable };
  }
  const le = enc.id === 'utf-16le';
  const out = new Uint8Array(2 + src.length * 2);
  out[0] = le ? 0xff : 0xfe;
  out[1] = le ? 0xfe : 0xff;
  for (let i = 0; i < src.length; i++) {
    const c = src.charCodeAt(i);
    out[2 + i * 2] = le ? c & 0xff : c >> 8;
    out[3 + i * 2] = le ? c >> 8 : c & 0xff;
  }
  return { bytes: out, unencodable };
}
