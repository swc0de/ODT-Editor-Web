/**
 * The document outline: headings with their levels and the body text under
 * them. Used by Outline view (promote / demote, move up / down, collapse,
 * show level) and the Navigation pane (drag a heading to move its section).
 *
 * Outline items are the document's paragraphs and headings (also inside
 * lists and sections) plus other blocks (tables, indexes…) as body text.
 * Levels: 1–9 for headings, BODY (10) for everything else.
 */
import { findStyle, ensureStyles } from './style-edit.js';

export const BODY = 10;
const OPAQUE = new Set(['table', 'index']);

/** [{ pos, end, node, level, heading }] in document order. */
export function outlineItems(doc) {
  const out = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      const heading = node.type.name === 'heading';
      out.push({ pos, end: pos + node.nodeSize, node, heading, level: heading ? Math.max(1, Math.min(9, node.attrs.level || 1)) : BODY });
      return false;
    }
    if (OPAQUE.has(node.type.name) || node.isLeaf || node.isAtom) {
      out.push({ pos, end: pos + node.nodeSize, node, heading: false, level: BODY });
      return false;
    }
    return true;
  });
  return out;
}

/** Index just after the last item in heading i's section (items deeper than it). */
export function subtreeEnd(items, i) {
  const lvl = items[i].level;
  if (lvl >= BODY) return i + 1;
  let j = i + 1;
  while (j < items.length && items[j].level > lvl) j++;
  return j;
}

/**
 * The document range of items[i..j) as whole sibling blocks: { from, to } or
 * null when they don't share a parent (e.g. a heading inside a list item
 * followed by body text outside it).
 */
export function siblingRange(doc, items, i, j) {
  const first = items[i];
  const last = items[j - 1];
  const $a = doc.resolve(first.pos);
  const d = $a.depth;
  const $b = doc.resolve(last.pos);
  if ($b.depth < d || $b.start(d) !== $a.start(d)) return null;
  const to = $b.depth === d ? last.end : $b.after(d + 1);
  return { from: first.pos, to, depth: d };
}

/** Range of a heading's whole section (heading + everything under it). */
export function sectionRange(doc, headingPos) {
  const items = outlineItems(doc);
  const i = items.findIndex((x) => x.pos === headingPos);
  if (i < 0) return null;
  return siblingRange(doc, items, i, subtreeEnd(items, i));
}

/**
 * Moves the blocks from..to to `target` (a position between blocks at the same
 * depth, outside the range). Returns the new start of the moved blocks, or null.
 */
export function moveRange(tr, from, to, target) {
  if (target >= from && target <= to) return null;
  const $f = tr.doc.resolve(from);
  const $t = tr.doc.resolve(target);
  if ($t.depth !== $f.depth || $t.start() !== $f.start()) return null;
  const slice = tr.doc.slice(from, to);
  tr.delete(from, to);
  const at = tr.mapping.maps[tr.mapping.maps.length - 1].map(target, target > from ? -1 : 1);
  tr.insert(at, slice.content);
  return at;
}

/** Moves a heading's section before the item at `targetPos` (or to the end with null). */
export function moveSection(tr, headingPos, targetPos) {
  const r = sectionRange(tr.doc, headingPos);
  if (!r) return null;
  let target = targetPos == null ? null : targetPos;
  if (target == null) {
    const $f = tr.doc.resolve(r.from);
    target = $f.end();
  }
  return moveRange(tr, r.from, r.to, target);
}

/** Makes sure a "Heading N" style exists (Heading 5–9 are made from Heading 4). */
export function ensureHeadingStyle(docState, n) {
  const name = `Heading_20_${n}`;
  if (!docState || findStyle(docState, 'paragraph', name)) return name;
  ensureStyles(docState, 'paragraph', [name]);
  if (findStyle(docState, 'paragraph', name)) return name;
  ensureStyles(docState, 'paragraph', ['Heading_20_4']);
  const base = findStyle(docState, 'paragraph', 'Heading_20_4');
  if (!base) return name;
  const t = structuredClone(base);
  t.a = { ...t.a, 'style:name': name, 'style:display-name': `Heading ${n}`, 'style:default-outline-level': String(n) };
  docState.commonStyles = { ...docState.commonStyles, c: [...docState.commonStyles.c, t] };
  return name;
}

/** Sets an item's outline level (1–9 heading, BODY = normal text). */
export function setItemLevel(tr, pos, level, schema, styleFor) {
  const node = tr.doc.nodeAt(pos);
  if (!node?.isTextblock) return;
  const { paragraph, heading } = schema.nodes;
  if (level >= BODY) {
    if (node.type === heading) tr.setNodeMarkup(pos, paragraph, { styleName: 'Standard', auto: node.attrs.auto, extra: node.attrs.extra, change: node.attrs.change });
    return;
  }
  tr.setNodeMarkup(pos, heading, { styleName: styleFor(level), level, auto: node.attrs.auto, extra: node.attrs.extra, change: node.attrs.change });
}
