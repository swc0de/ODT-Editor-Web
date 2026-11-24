import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { hash } from '../../src/core/convert/sha.js';
import { readCfb, writeCfb, isCfb } from '../../src/core/convert/cfb.js';
import { encryptOffice, decryptOffice, isOfficeEncrypted } from '../../src/core/convert/office-crypto.js';
import { partsToFlatOpc, flatOpcToParts, contentTypes, sniffXml } from '../../src/core/convert/flat-opc.js';
import { encodeText, decodeText, detectEncoding, detectLineEnding, isValidUtf8 } from '../../src/core/convert/text-encoding.js';

const tmp = mkdtempSync(join(tmpdir(), 'odte-'));

test('SHA-1/256/384/512 match node:crypto', () => {
  for (const len of [0, 1, 55, 56, 63, 64, 111, 112, 127, 128, 129, 1000]) {
    const b = randomBytes(len);
    for (const [a, n] of [['SHA1', 'sha1'], ['SHA256', 'sha256'], ['SHA384', 'sha384'], ['SHA512', 'sha512']]) {
      assert.equal(Buffer.from(hash(a, b)).toString('hex'), createHash(n).update(b).digest('hex'), `${a} len ${len}`);
    }
  }
});

test('compound file: write and read back (mini and regular streams, storages)', () => {
  const streams = { A: randomBytes(10), 'Big stream': randomBytes(70000), '\u0006DataSpaces/Version': randomBytes(76), '\u0006DataSpaces/TransformInfo/X/\u0006Primary': randomBytes(4095), Empty: new Uint8Array(0), Exact: randomBytes(4096) };
  for (let i = 0; i < 20; i++) streams[`s${i}`] = randomBytes(i * 300);
  const bytes = writeCfb(streams);
  assert.ok(isCfb(bytes));
  const back = readCfb(bytes);
  for (const [k, v] of Object.entries(streams)) assert.deepEqual(Buffer.from(back.get(k)), Buffer.from(v), k);
  assert.equal(back.size, Object.keys(streams).length);
});

test('compound file: large stream needs DIFAT sectors', () => {
  const big = randomBytes(8 * 1024 * 1024);
  const back = readCfb(writeCfb({ EncryptedPackage: big, small: randomBytes(5) }));
  assert.ok(Buffer.from(back.get('EncryptedPackage')).equals(big));
});

test('compound file: olefile (Python) reads ours', { skip: spawnSync('python3', ['-c', 'import olefile']).status !== 0 }, () => {
  const p = join(tmp, 'x.cfb');
  writeFileSync(p, writeCfb({ One: strToU8('hello'), 'St/Two': randomBytes(5000) }));
  const out = execFileSync('python3', ['-I', '-c', `import olefile,sys; o=olefile.OleFileIO(sys.argv[1]); print(sorted('/'.join(x) for x in o.listdir())); print(o.openstream('One').read())`, p]).toString();
  assert.match(out, /'One', 'St\/Two'/);
  assert.match(out, /b'hello'/);
});

const docxBytes = () => zipSync({ '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'), 'word/document.xml': strToU8('<w:document>x</w:document>'), pad: randomBytes(9000) });

test('Agile encryption round trip; wrong password refused', async () => {
  const plain = docxBytes();
  const enc = await encryptOffice(plain, 'Secret ünicode', { spinCount: 1000 });
  assert.ok(isOfficeEncrypted(enc));
  assert.deepEqual(Buffer.from(await decryptOffice(enc, 'Secret ünicode')), Buffer.from(plain));
  await assert.rejects(decryptOffice(enc, 'wrong'), (e) => e.code === 'wrong-password');
  // Tampering is caught by the HMAC.
  const s = readCfb(enc);
  const pkg = s.get('EncryptedPackage');
  pkg[100] ^= 1;
  const tampered = writeCfb(Object.fromEntries(s));
  await assert.rejects(decryptOffice(tampered, 'Secret ünicode'), (e) => e.code === 'integrity');
});

const hasMsoff = spawnSync('python3', ['-c', 'import msoffcrypto']).status === 0;
test('Agile encryption (Word defaults: AES-256, SHA-512, 100,000 spins) is decrypted by msoffcrypto-tool', { skip: !hasMsoff && 'msoffcrypto-tool not installed (pip install msoffcrypto-tool)' }, async () => {
  const plain = docxBytes();
  const t0 = performance.now();
  const enc = await encryptOffice(plain, 'pässword');
  const ms = performance.now() - t0;
  assert.ok(ms < 5000, `encryption took ${ms} ms`);
  const p = join(tmp, 'enc.docx');
  writeFileSync(p, enc);
  execFileSync('python3', ['-I', new URL('../lib/msoffcrypto-check.py', import.meta.url).pathname, p, 'pässword', join(tmp, 'dec.docx')]);
  assert.ok(readFileSync(join(tmp, 'dec.docx')).equals(Buffer.from(plain)));
});

test('decrypts files encrypted by msoffcrypto-tool (Agile)', { skip: !hasMsoff }, async () => {
  const plain = docxBytes();
  const p = join(tmp, 'plain.docx');
  writeFileSync(p, plain);
  execFileSync('python3', ['-I', '-c', `import msoffcrypto,sys\nfrom msoffcrypto.format.ooxml import OOXMLFile\nf=OOXMLFile(open(sys.argv[1],'rb'))\nf.encrypt('abc', open(sys.argv[2],'wb'))`, p, join(tmp, 'by-tool.docx')]);
  const out = await decryptOffice(new Uint8Array(readFileSync(join(tmp, 'by-tool.docx'))), 'abc');
  assert.ok(Buffer.from(out).equals(Buffer.from(plain)));
});

test('Standard encryption (AES-128 ECB, Office 2007) is read', { skip: spawnSync('python3', ['-c', 'import cryptography, olefile']).status !== 0 }, async () => {
  const plain = docxBytes();
  const p = join(tmp, 'plain2.docx');
  writeFileSync(p, plain);
  execFileSync('python3', ['-I', new URL('../lib/make-standard-encrypted.py', import.meta.url).pathname, p, 'std', join(tmp, 'std.docx')]);
  // Python writes the two streams (olefile can't create compound files); our writer packs them.
  const enc = writeCfb({ EncryptionInfo: new Uint8Array(readFileSync(join(tmp, 'std.docx.info'))), EncryptedPackage: new Uint8Array(readFileSync(join(tmp, 'std.docx.pkg'))) });
  assert.ok(Buffer.from(await decryptOffice(enc, 'std')).equals(Buffer.from(plain)));
  await assert.rejects(decryptOffice(enc, 'nope'), (e) => e.code === 'wrong-password');
});

test('Flat OPC: write and read back to the same parts map', () => {
  const files = {
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/customXml/item1.xml" ContentType="application/xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>A &amp; B &lt; “C”</w:t></w:r></w:p></w:body></w:document>'),
    'word/media/image1.png': randomBytes(300),
    'customXml/item1.xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<b:Sources xmlns:b="urn:x"/>'),
  };
  const flat = partsToFlatOpc(files);
  assert.match(flat, /^<\?xml version="1.0" standalone="yes"\?>\r\n<\?mso-application progid="Word.Document"\?>\r\n<pkg:package xmlns:pkg="http:\/\/schemas.microsoft.com\/office\/2006\/xmlPackage">/);
  assert.match(flat, /<pkg:part pkg:name="\/_rels\/.rels" pkg:contentType="application\/vnd.openxmlformats-package.relationships\+xml" pkg:padding="512"><pkg:xmlData><Relationships/);
  assert.match(flat, /pkg:name="\/word\/media\/image1.png" pkg:contentType="image\/png" pkg:compression="store"><pkg:binaryData>/);
  assert.equal(sniffXml(strToU8(flat)), 'flat-opc');
  const back = flatOpcToParts(flat);
  for (const k of Object.keys(files)) if (k !== '[Content_Types].xml') assert.deepEqual(Buffer.from(back[k]), Buffer.from(files[k]), k);
  const a = contentTypes(files);
  const b = contentTypes(back);
  for (const k of Object.keys(files)) if (!k.endsWith('.rels') && k !== '[Content_Types].xml') assert.equal(b(k), a(k), k);
  // And again: stable.
  assert.equal(partsToFlatOpc(back), flat);
});

test('Flat OPC: namespaces declared on the package move onto part roots', () => {
  const flat = '<?xml version="1.0"?><pkg:package xmlns:pkg="http://schemas.microsoft.com/office/2006/xmlPackage" xmlns:w="urn:w"><pkg:part pkg:name="/word/document.xml" pkg:contentType="application/xml"><pkg:xmlData><w:document><w:body/></w:document></pkg:xmlData></pkg:part></pkg:package>';
  assert.match(strFromU8(flatOpcToParts(flat)['word/document.xml']), /<w:document xmlns:w="urn:w">/);
});

test('sniffXml', () => {
  assert.equal(sniffXml(strToU8('<?xml version="1.0"?><!-- x --><office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"/>')), 'flat-odt');
  assert.equal(sniffXml(strToU8('<?xml version="1.0"?><root/>')), null);
});

// Reference bytes (independent of the encoder).
const SAMPLE = 'Café “quoted” – 1…\nLine 2 €';
test('text encoders produce reference bytes', () => {
  const crlf = SAMPLE.replace(/\n/g, '\r\n');
  assert.deepEqual(Buffer.from(encodeText(SAMPLE, { encoding: 'utf-8' }).bytes), Buffer.from(crlf, 'utf8'));
  assert.deepEqual(Buffer.from(encodeText(SAMPLE, { encoding: 'utf-8-bom', lineEnding: 'lf' }).bytes), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(SAMPLE, 'utf8')]));
  assert.deepEqual(Buffer.from(encodeText(SAMPLE, { encoding: 'utf-16le' }).bytes), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(crlf, 'utf16le')]));
  const be = Buffer.from(crlf, 'utf16le');
  be.swap16();
  assert.deepEqual(Buffer.from(encodeText(SAMPLE, { encoding: 'utf-16be' }).bytes), Buffer.concat([Buffer.from([0xfe, 0xff]), be]));
  // Windows-1252: “ 0x93, ” 0x94, – 0x96, … 0x85, € 0x80, é 0xE9.
  assert.deepEqual([...encodeText(SAMPLE, { encoding: 'windows-1252', lineEnding: 'cr' }).bytes], [0x43, 0x61, 0x66, 0xe9, 0x20, 0x93, 0x71, 0x75, 0x6f, 0x74, 0x65, 0x64, 0x94, 0x20, 0x96, 0x20, 0x31, 0x85, 0x0d, 0x4c, 0x69, 0x6e, 0x65, 0x20, 0x32, 0x20, 0x80]);
  // ISO-8859-1 can't hold the quotes, dash, ellipsis or euro: "?" and reported.
  const latin = encodeText(SAMPLE, { encoding: 'iso-8859-1', lineEnding: 'lf' });
  assert.equal(Buffer.from(latin.bytes).toString('latin1'), 'Café ?quoted? ? 1?\nLine 2 ?');
  assert.deepEqual(latin.unencodable, [5, 12, 14, 17, 26]);
  // With substitution they become ASCII.
  const sub = encodeText(SAMPLE, { encoding: 'us-ascii', lineEnding: 'lf', substitute: true });
  assert.equal(Buffer.from(sub.bytes).toString('latin1'), 'Caf? "quoted" - 1...\nLine 2 EUR');
  assert.deepEqual(sub.unencodable, [3]);
});

test('BOM and encoding detection; decode round trip for every encoding and line ending', () => {
  assert.equal(detectEncoding(Uint8Array.from([0xef, 0xbb, 0xbf, 0x41])).encoding, 'utf-8-bom');
  assert.equal(detectEncoding(Uint8Array.from([0xff, 0xfe, 0x41, 0])).encoding, 'utf-16le');
  assert.equal(detectEncoding(Uint8Array.from([0xfe, 0xff, 0, 0x41])).encoding, 'utf-16be');
  assert.equal(detectEncoding(Buffer.from('Café', 'utf8')).encoding, 'utf-8');
  assert.equal(detectEncoding(Buffer.from('Café', 'latin1')).encoding, 'windows-1252');
  assert.equal(isValidUtf8(Uint8Array.from([0xe2, 0x82])), false);
  assert.equal(isValidUtf8(Uint8Array.from([0xed, 0xa0, 0x80])), false); // surrogate
  assert.equal(isValidUtf8(Uint8Array.from([0xc0, 0x80])), false); // overlong
  assert.equal(detectLineEnding('a\r\nb\r\nc\nd'), 'crlf');
  assert.equal(detectLineEnding('a\nb\nc\r\nd'), 'lf');
  assert.equal(detectLineEnding('a\rb'), 'cr');
  const text = 'Plain ASCII text\nsecond line\n\nend';
  const rich = 'Café – “x” €';
  for (const encoding of ['utf-8', 'utf-8-bom', 'utf-16le', 'utf-16be', 'windows-1252', 'iso-8859-1', 'us-ascii']) {
    for (const lineEnding of ['crlf', 'lf', 'cr']) {
      const src = encoding === 'iso-8859-1' || encoding === 'us-ascii' ? text : `${text}\n${rich}`;
      const d = decodeText(encodeText(src, { encoding, lineEnding }).bytes);
      assert.equal(d.text, src, `${encoding} ${lineEnding}`);
      assert.equal(d.lineEnding, lineEnding);
      // Pure ASCII can't tell its single-byte encoding apart: it reads as UTF-8 (the same bytes).
      const expect = { 'iso-8859-1': 'utf-8', 'us-ascii': 'utf-8' }[encoding] || encoding;
      assert.equal(d.encoding, expect, `${encoding} ${lineEnding}`);
    }
  }
});
