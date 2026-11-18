/**
 * Paragraph formatting helpers: read the effective paragraph properties at
 * the selection, and change direct paragraph formatting (the node's `auto`)
 * of every paragraph/heading in the selection as one undoable step.
 */
import { mergeAuto } from '../odt/styles.js';
import { toPx, pxToLength } from '../../layout/units.js';

const PP = 'style:paragraph-properties';

/** Paragraph/heading nodes touched by the selection: [{ node, pos }]. */
export function selectedTextblocks(state) {
  const out = [];
  const { from, to } = state.selection;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isTextblock) { out.push({ node, pos }); return false; }
    return true;
  });
  if (!out.length) {
    const $f = state.selection.$from;
    for (let d = $f.depth; d > 0; d--) if ($f.node(d).isTextblock) { out.push({ node: $f.node(d), pos: $f.before(d) }); break; }
  }
  return out;
}

/** Effective paragraph-properties of a node: { a, c } (style chain + direct). */
export function effectiveParagraphProps(node, index) {
  const auto = mergeAuto(index?.effective('paragraph', node.attrs.styleName) || null, node.attrs.auto);
  return auto?.props?.[PP] || { a: {} };
}

/** Indents (px) of a paragraph: { left, right, firstLine }. */
export function paragraphIndents(node, index) {
  const a = effectiveParagraphProps(node, index).a || {};
  return { left: toPx(a['fo:margin-left'] || '0cm') || 0, right: toPx(a['fo:margin-right'] || '0cm') || 0, firstLine: toPx(a['fo:text-indent'] || '0cm') || 0 };
}

/**
 * Applies fn(effectivePP, node) → { attrs?, children? } to each selected
 * paragraph's direct formatting. attrs are merged; children (e.g. tab stops)
 * replace by element name.
 */
export function updateParagraphProps(state, dispatch, index, fn) {
  const blocks = selectedTextblocks(state);
  if (!blocks.length) return false;
  if (!dispatch) return true;
  const tr = state.tr;
  for (const { node, pos } of blocks) {
    const eff = effectiveParagraphProps(node, index);
    const change = fn(eff, node);
    if (!change) continue;
    const auto = structuredClone(node.attrs.auto) || { styleAttrs: {}, props: {} };
    const pp = auto.props[PP] || { a: {} };
    pp.a = { ...pp.a, ...(change.attrs || {}) };
    if (change.children) {
      const names = new Set(change.children.map((c) => c.n));
      pp.c = [...(pp.c || []).filter((c) => typeof c === 'string' || !names.has(c.n)), ...change.children.filter((c) => c.c?.length || c.keepEmpty)];
      if (!pp.c.length) delete pp.c;
    }
    auto.props[PP] = pp;
    tr.setNodeMarkup(pos, null, { ...node.attrs, auto });
  }
  dispatch(tr.scrollIntoView());
  return true;
}

const cm = (px) => pxToLength(px, 'cm', 3);

/** Sets indents (px; undefined = unchanged). */
export function setIndents(state, dispatch, index, { left, right, firstLine }) {
  return updateParagraphProps(state, dispatch, index, () => {
    const attrs = {};
    if (left !== undefined) attrs['fo:margin-left'] = cm(left);
    if (right !== undefined) attrs['fo:margin-right'] = cm(right);
    if (firstLine !== undefined) attrs['fo:text-indent'] = cm(firstLine);
    return { attrs };
  });
}

/** Replaces the explicit tab stops: stops = [{ pos(px), type, char?, leaderStyle?, leaderText? }]. */
export function setTabStops(state, dispatch, index, stops) {
  return updateParagraphProps(state, dispatch, index, () => ({
    children: [{
      n: 'style:tab-stops', a: {}, keepEmpty: true,
      c: [...stops].sort((a, b) => a.pos - b.pos).map((s) => {
        const a = { 'style:position': cm(s.pos) };
        if (s.type && s.type !== 'left') a['style:type'] = s.type;
        if (s.type === 'char') a['style:char'] = s.char || '.';
        if (s.leaderStyle) a['style:leader-style'] = s.leaderStyle;
        if (s.leaderText) a['style:leader-text'] = s.leaderText;
        return { n: 'style:tab-stop', a };
      }),
    }],
  }));
}
