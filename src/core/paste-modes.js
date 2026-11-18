/**
 * Paste options: Keep Source Formatting (as parsed), Merge Formatting (take
 * the destination's paragraph style, keep only bold / italic / underline and
 * links) and Keep Text Only (plain text in the destination's formatting).
 */
import { Fragment, Slice } from 'prosemirror-model';
import { schema } from './schema.js';

const TP = 'style:text-properties';
const EMPHASIS = ['fo:font-weight', 'fo:font-style', 'style:text-underline-style', 'style:text-underline-type', 'style:text-underline-width'];

function mergeMarks(marks) {
  const out = [];
  for (const m of marks) {
    if (m.type === schema.marks.link) out.push(m);
    else if (m.type === schema.marks.textProps) {
      const a = m.attrs.auto?.props?.[TP]?.a || {};
      const kept = Object.fromEntries(EMPHASIS.filter((k) => a[k]).map((k) => [k, a[k]]));
      if (Object.keys(kept).length) out.push(schema.marks.textProps.create({ auto: { styleAttrs: {}, props: { [TP]: { a: kept } } } }));
    }
  }
  return out;
}

function mergeFragment(fragment, para) {
  const nodes = [];
  fragment.forEach((node) => {
    if (node.isText) nodes.push(node.mark(mergeMarks(node.marks)));
    else if (node.isTextblock) {
      const type = para?.type === schema.nodes.heading && node.type === schema.nodes.heading ? node.type : schema.nodes.paragraph;
      const attrs = type === schema.nodes.paragraph ? { styleName: para?.type === schema.nodes.paragraph ? para.attrs.styleName : 'Standard', auto: null, extra: null } : { ...node.attrs, auto: null };
      nodes.push(type.create(attrs, mergeFragment(node.content, para)));
    } else if (node.isLeaf) nodes.push(node);
    else nodes.push(node.copy(mergeFragment(node.content, para)));
  });
  return Fragment.fromArray(nodes);
}

/** Plain text of a slice: paragraphs separated by newlines. */
export function sliceText(slice) {
  return slice.content.textBetween(0, slice.content.size, '\n', (leaf) => (leaf.type.name === 'tab' ? '\t' : leaf.type.name === 'hard_break' ? '\n' : ''));
}

/** Text-only slice: lines become paragraphs shaped like the destination one, with its marks. */
export function textSlice(text, $pos, marks) {
  const para = $pos.parent;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const inline = (line) => {
    const parts = [];
    line.split('\t').forEach((seg, i) => {
      if (i) parts.push(schema.nodes.tab.create(null, null, marks));
      if (seg) parts.push(schema.text(seg, marks));
    });
    return Fragment.fromArray(parts);
  };
  if (lines.length === 1) return new Slice(inline(lines[0]), 0, 0);
  const blocks = lines.map((l) => para.type.create(para.attrs, inline(l)));
  return new Slice(Fragment.fromArray(blocks), 1, 1);
}

/**
 * Converts a parsed paste slice for a mode. Returns { slice, adoptStyle }.
 * @param {'keep'|'merge'|'text'} mode
 */
export function sliceForMode(slice, mode, state) {
  const $from = state.selection.$from;
  if (mode === 'text') {
    const marks = (state.storedMarks || $from.marks()).filter((m) => m.type !== schema.marks.link);
    return { slice: textSlice(sliceText(slice), $from, marks), adoptStyle: false };
  }
  if (mode === 'merge') {
    const para = $from.parent.isTextblock ? $from.parent : null;
    return { slice: new Slice(mergeFragment(slice.content, para), slice.openStart, slice.openEnd), adoptStyle: false };
  }
  return { slice, adoptStyle: true };
}
