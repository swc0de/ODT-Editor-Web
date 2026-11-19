/**
 * Comments (office:annotation). A comment is an `annotation` node where it
 * starts and, for a comment on a range of text, an `annotation_end` with the
 * same name where it ends. Replies are annotations right after their parent
 * with loext:parent-name (as LibreOffice writes them); a resolved thread has
 * loext:resolved="true" on its first comment.
 */
import { schema } from './schema.js';

export const isResolved = (node) => node.attrs.extra?.['loext:resolved'] === 'true';
export const parentOf = (node) => node.attrs.extra?.['loext:parent-name'] || null;
export const bodyText = (node) => (node.attrs.body || []).map((b) => (b.content || []).map((x) => x.text || '').join('')).join('\n');

/**
 * Threads in document order:
 * [{ name, node, pos, end (pos of annotation_end or null), replies: [{ node, pos }], resolved }]
 */
export function threadsOf(doc) {
  const byName = new Map();
  const threads = [];
  const ends = new Map();
  doc.descendants((n, pos) => {
    if (n.type.name === 'annotation') {
      const parent = parentOf(n);
      if (parent && byName.has(parent)) byName.get(parent).replies.push({ node: n, pos });
      else {
        const t = { name: n.attrs.name, node: n, pos, end: null, replies: [], resolved: isResolved(n) };
        threads.push(t);
        if (n.attrs.name) byName.set(n.attrs.name, t);
      }
      // Replies to replies belong to the same thread.
      if (parent && byName.has(parent) && n.attrs.name) byName.set(n.attrs.name, byName.get(parent));
    } else if (n.type.name === 'annotation_end') ends.set(n.attrs.name, pos);
    return true;
  });
  for (const t of threads) if (t.name && ends.has(t.name)) t.end = ends.get(t.name);
  return threads;
}

/** A comment name not used yet: __Annotation__N. */
export function newCommentName(doc) {
  const used = new Set();
  doc.descendants((n) => { if (n.type.name === 'annotation' && n.attrs.name) used.add(n.attrs.name); return true; });
  let i = used.size + 1;
  while (used.has(`__Annotation__${i}`)) i++;
  return `__Annotation__${i}`;
}

const stamp = () => new Date().toISOString().slice(0, 19);

/** A new comment node (empty body), optionally a reply. */
export function newComment(doc, { author, initials, parent = null, name = null }) {
  return schema.nodes.annotation.create({
    name: name || newCommentName(doc), creator: author, date: stamp(), initials,
    body: [{ type: 'paragraph', attrs: { styleName: 'Standard', auto: null, extra: null, change: null } }],
    extra: parent ? { 'loext:parent-name': parent } : { 'loext:resolved': 'false' },
  });
}

/** The thread whose anchor or range contains pos (innermost / nearest). */
export function threadAt(doc, pos) {
  let best = null;
  for (const t of threadsOf(doc)) {
    const from = t.pos;
    const to = t.end ?? t.pos + 1;
    if (pos >= from && pos <= to + 1 && (!best || from >= best.pos)) best = t;
  }
  return best;
}

/** Removes a thread (its comment, replies and range end) in tr. */
export function deleteThread(tr, thread) {
  const del = [thread.pos, ...thread.replies.map((r) => r.pos)];
  if (thread.end != null) del.push(thread.end);
  for (const p of del.sort((a, b) => b - a)) {
    const n = tr.doc.nodeAt(p);
    if (n && (n.type.name === 'annotation' || n.type.name === 'annotation_end')) tr.delete(p, p + n.nodeSize);
  }
  return tr;
}
