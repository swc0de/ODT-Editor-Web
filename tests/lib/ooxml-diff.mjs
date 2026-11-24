/**
 * OOXML coverage check for DOCX round trips (Node, independent of the app):
 * every element and attribute of the original body parts (document, headers,
 * footers, footnotes, endnotes, comments) must appear in the output, except
 * the allowed noise: rsid attributes, w:proofErr, w:lastRenderedPageBreak,
 * bookmark id renumbering and attribute order.
 *
 *   const r = ooxmlDiff(originalFiles, outputFiles)
 *   r.missing    [{ part, signature, count }] elements (with their attributes) the output lacks
 *   r.text       { original, output } the body text of both (must be equal)
 *   r.unowned    parts the editor doesn't write, and whether each is byte-identical
 *
 * CLI: node tests/lib/ooxml-diff.mjs original.docx output.docx
 */
import { unzipSync, strFromU8 } from 'fflate';
import { DOMParser } from '@xmldom/xmldom';
import { readFileSync } from 'node:fs';

const BODY_TYPES = ['officeDocument', 'header', 'footer', 'footnotes', 'endnotes', 'comments'];
const OWNED = new Set(['styles', 'numbering', 'settings', 'footnotes', 'endnotes', 'comments', 'header', 'footer']);
const NOISE_ELEMENTS = new Set(['w:proofErr', 'w:lastRenderedPageBreak']);

function rels(files, part) {
  const dir = part.includes('/') ? part.slice(0, part.lastIndexOf('/') + 1) : '';
  const p = `${dir}_rels/${part.slice(part.lastIndexOf('/') + 1)}.rels`;
  if (!files[p]) return [];
  const out = [];
  for (const m of strFromU8(files[p]).matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const a = Object.fromEntries([...m[1].matchAll(/([\w:]+)="([^"]*)"/g)].map((x) => [x[1], x[2]]));
    if (a.TargetMode === 'External') { out.push({ type: a.Type.replace(/^.*\//, ''), path: a.Target, id: a.Id, external: true }); continue; }
    const segs = [];
    for (const s of (a.Target.startsWith('/') ? a.Target.slice(1) : dir + a.Target).split('/')) { if (s === '..') segs.pop(); else if (s && s !== '.') segs.push(s); }
    out.push({ type: a.Type.replace(/^.*\//, ''), path: segs.join('/'), id: a.Id });
  }
  return out;
}

/** Body parts by kind: { document: [path], header: [...], … } */
export function bodyParts(files) {
  const main = rels(files, '').find((r) => r.type === 'officeDocument')?.path || 'word/document.xml';
  const out = { officeDocument: [main] };
  for (const r of rels(files, main)) if (BODY_TYPES.includes(r.type)) (out[r.type] ||= []).push(r.path);
  return out;
}

/** Element signatures of a part: name + attributes (noise removed), counted. */
function signatures(xml, rIdMap) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const counts = new Map();
  const walk = (el) => {
    if (el.nodeType !== 1) return;
    // The root element: its namespace declarations and mc:Ignorable may grow.
    if (el === doc.documentElement) { counts.set(`${el.nodeName}[]`, 1); for (let c = el.firstChild; c; c = c.nextSibling) walk(c); return; }
    if (NOISE_ELEMENTS.has(el.nodeName)) return;
    const attrs = [];
    for (let i = 0; i < el.attributes.length; i++) {
      const a = el.attributes[i];
      if (a.name.startsWith('xmlns') || /^w:rsid/.test(a.name)) continue;
      // Bookmark, comment, note and change ids may be renumbered; relationship ids too (compared by target).
      if (a.name === 'w:id' && /^w:(bookmark|comment|footnote|endnote|ins|del|move|customXml|permStart|permEnd|rPrChange|pPrChange|tblPrChange|trPrChange|tcPrChange|sectPrChange|numberingChange)/.test(el.nodeName)) continue;
      if (a.name === 'w:id' && /^w:(footnote|endnote|comment)$/.test(el.nodeName)) continue;
      if (/^r:/.test(a.name)) { attrs.push(`${a.name}=@${rIdMap?.(a.value) ?? a.value}`); continue; }
      attrs.push(`${a.name}=${a.value}`);
    }
    attrs.sort();
    const sig = `${el.nodeName}[${attrs.join(' ')}]`;
    counts.set(sig, (counts.get(sig) || 0) + 1);
    for (let c = el.firstChild; c; c = c.nextSibling) walk(c);
  };
  walk(doc.documentElement);
  return counts;
}

function textOf(xml) {
  return [...xml.matchAll(/<w:(?:t|delText)\b[^>]*>([^<]*)<\/w:(?:t|delText)>/g)].map((m) => m[1]).join('');
}

/**
 * @param {Record<string, Uint8Array>|Uint8Array} original
 * @param {Record<string, Uint8Array>|Uint8Array} output
 */
export function ooxmlDiff(original, output) {
  const a = original instanceof Uint8Array ? unzipSync(original) : original;
  const b = output instanceof Uint8Array ? unzipSync(output) : output;
  const pa = bodyParts(a);
  const pb = bodyParts(b);
  const missing = [];
  const text = { original: '', output: '' };
  for (const kind of BODY_TYPES) {
    const sum = (files, paths) => {
      const total = new Map();
      for (const p of paths || []) {
        if (!files[p]) continue;
        // Relationship ids compare by their targets.
        // (Parts the editor writes itself may be renamed: compared by their type.)
        const map = new Map(rels(files, p).map((r) => [r.id, OWNED.has(r.type) ? r.type : `${r.type}:${r.external ? r.path : r.path.replace(/^.*\//, '')}`]));
        for (const [s, n] of signatures(strFromU8(files[p]), (id) => map.get(id))) total.set(s, (total.get(s) || 0) + n);
      }
      return total;
    };
    const sa = sum(a, pa[kind]);
    const sb = sum(b, pb[kind]);
    for (const [sig, n] of sa) {
      const m = sb.get(sig) || 0;
      if (m < n) missing.push({ part: kind, signature: sig, count: n - m });
    }
    if (kind === 'officeDocument') {
      text.original = textOf(strFromU8(a[pa[kind][0]]));
      text.output = textOf(strFromU8(b[pb[kind][0]]));
    }
  }
  // Parts the editor doesn't own: byte-identical in the output.
  const main = pa.officeDocument[0];
  const ownedPaths = new Set([main, ...rels(a, main).filter((r) => OWNED.has(r.type)).map((r) => r.path), 'docProps/core.xml', '[Content_Types].xml']);
  const unowned = Object.keys(a).filter((p) => !p.endsWith('.rels') && !ownedPaths.has(p) && !p.endsWith('/')).map((p) => ({ part: p, present: !!b[p], identical: !!b[p] && Buffer.from(a[p]).equals(Buffer.from(b[p])) }));
  return { missing, text, unowned };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = ooxmlDiff(new Uint8Array(readFileSync(process.argv[2])), new Uint8Array(readFileSync(process.argv[3])));
  console.log(JSON.stringify({ missing: r.missing, textEqual: r.text.original === r.text.output, unowned: r.unowned.filter((u) => !u.identical) }, null, 1));
}
