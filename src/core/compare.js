/**
 * Compare documents: the revised document with the differences from the
 * original as tracked changes (insertions and deletions by `author`).
 * Paragraphs are matched first (longest common subsequence of their text);
 * a changed paragraph is compared word by word. Tables and other blocks
 * that differ are taken from the revised document as they are.
 */
import { Fragment } from 'prosemirror-model';
import { newChangeId } from './track-changes.js';

/** Longest common subsequence of two arrays (by eq) → [['=', i, j] | ['-', i] | ['+', j]] */
export function diff(a, b, eq = (x, y) => x === y) {
  const n = a.length;
  const m = b.length;
  // Trim the common start and end (most documents differ in a few places).
  let s = 0;
  while (s < n && s < m && eq(a[s], b[s])) s++;
  let e = 0;
  while (e < n - s && e < m - s && eq(a[n - 1 - e], b[m - 1 - e])) e++;
  const A = a.slice(s, n - e);
  const B = b.slice(s, m - e);
  const ops = [];
  for (let i = 0; i < s; i++) ops.push(['=', i, i]);
  if (A.length * B.length > 4e6) {
    // Too large to align: everything in between is replaced.
    A.forEach((_, i) => ops.push(['-', s + i]));
    B.forEach((_, j) => ops.push(['+', s + j]));
  } else {
    const L = Array.from({ length: A.length + 1 }, () => new Uint32Array(B.length + 1));
    for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) L[i][j] = eq(A[i], B[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    let i = 0;
    let j = 0;
    while (i < A.length && j < B.length) {
      if (eq(A[i], B[j])) { ops.push(['=', s + i, s + j]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) { ops.push(['-', s + i]); i++; } else { ops.push(['+', s + j]); j++; }
    }
    while (i < A.length) ops.push(['-', s + i++]);
    while (j < B.length) ops.push(['+', s + j++]);
  }
  for (let k = 0; k < e; k++) ops.push(['=', n - e + k, m - e + k]);
  return ops;
}

const TEXTBLOCK = new Set(['paragraph', 'heading']);
const textOf = (n) => n.textBetween(0, n.content.size, null, '￼');
const tokens = (s) => s.match(/\s+|[\p{L}\p{N}'’]+|[^\s\p{L}\p{N}]/gu) || [];

function withMark(frag, mark) {
  const out = [];
  frag.forEach((n) => out.push(n.isInline ? n.mark(mark.addToSet(n.marks)) : n));
  return Fragment.from(out);
}

/** A changed paragraph: the revised one, with words removed from the original put back as deleted. */
function diffParagraph(orig, rev, ins, del) {
  const ta = tokens(textOf(orig));
  const tb = tokens(textOf(rev));
  const offs = (ts) => { const o = [0]; for (const t of ts) o.push(o[o.length - 1] + t.length); return o; };
  const oa = offs(ta);
  const ob = offs(tb);
  const parts = [];
  for (const [op, i, j] of diff(ta, tb)) {
    if (op === '=') parts.push(rev.content.cut(ob[j], ob[j + 1]));
    else if (op === '+') parts.push(withMark(rev.content.cut(ob[i], ob[i + 1]), ins));
    else parts.push(withMark(orig.content.cut(oa[i], oa[i + 1]), del));
  }
  let content = Fragment.empty;
  for (const p of parts) content = content.append(p);
  return rev.type.create(rev.attrs, content, rev.marks);
}

/**
 * The comparison as a new document node: revisedDoc with tracked changes.
 * o = { author, date }
 */
export function compareDocs(origDoc, revDoc, o) {
  const schema = revDoc.type.schema;
  const date = o.date || new Date().toISOString().slice(0, 19);
  const ins = schema.marks.insertion.create({ author: o.author, date, cid: newChangeId(), old: null });
  const del = schema.marks.deletion.create({ author: o.author, date, cid: newChangeId(), old: null });
  const A = [];
  const B = [];
  origDoc.forEach((n) => A.push(n));
  revDoc.forEach((n) => B.push(n));
  const key = (n) => (TEXTBLOCK.has(n.type.name) ? `${n.type.name}:${textOf(n)}` : JSON.stringify(n.toJSON()));
  const ops = diff(A.map(key), B.map(key));
  const out = [];
  // A deleted paragraph followed by an inserted one is a changed paragraph.
  for (let k = 0; k < ops.length; k++) {
    const [op, i, j] = ops[k];
    if (op === '=') { out.push(B[j]); continue; }
    if (op === '-' && ops[k + 1]?.[0] === '+' && TEXTBLOCK.has(A[i].type.name) && TEXTBLOCK.has(B[ops[k + 1][1]].type.name)) {
      out.push(diffParagraph(A[i], B[ops[k + 1][1]], ins, del));
      k++;
      continue;
    }
    if (op === '-') {
      const n = A[i];
      if (TEXTBLOCK.has(n.type.name)) out.push(n.type.create({ ...n.attrs, change: { type: 'deletion', ...del.attrs } }, withMark(n.content, del), n.marks));
      continue; // deleted tables etc. are left out
    }
    const n = B[i];
    if (TEXTBLOCK.has(n.type.name)) out.push(n.type.create({ ...n.attrs, change: { type: 'insertion', ...ins.attrs } }, withMark(n.content, ins), n.marks));
    else out.push(n);
  }
  if (!out.length) out.push(schema.nodes.paragraph.create());
  // A paragraph whose ending was deleted needs a following paragraph to join.
  const last = out[out.length - 1];
  if (last.attrs?.change?.type === 'deletion') out.push(schema.nodes.paragraph.create());
  return revDoc.type.create(revDoc.attrs, out);
}
