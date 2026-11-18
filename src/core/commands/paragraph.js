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
  for (const r of state.selection.ranges) {
    state.doc.nodesBetween(r.$from.pos, r.$to.pos, (node, pos) => {
      if (node.isTextblock) { if (!out.some((o) => o.pos === pos)) out.push({ node, pos }); return false; }
      return true;
    });
  }
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
    for (const [k, v] of Object.entries(pp.a)) if (v == null) delete pp.a[k];
    if (change.children) {
      const names = new Set(change.children.map((c) => c.n));
      pp.c = [...(pp.c || []).filter((c) => typeof c === 'string' || !names.has(c.n)), ...change.children.filter((c) => c.c?.length || c.keepEmpty)];
      if (!pp.c.length) delete pp.c;
    }
    if (Object.keys(pp.a).length || pp.c?.length) auto.props[PP] = pp; else delete auto.props[PP];
    const empty = !Object.keys(auto.props).length && !Object.keys(auto.styleAttrs || {}).length;
    tr.setNodeMarkup(pos, null, { ...node.attrs, auto: empty ? null : auto });
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

/** Outline level of a paragraph style (from the style or its parents), or 0. */
export function styleOutlineLevel(index, name) {
  const fam = index?.families.get('paragraph');
  const seen = new Set();
  for (let t = fam?.get(name); t && !seen.has(t); t = fam.get(t.a['style:parent-style-name'])) {
    seen.add(t);
    if (t.a['style:default-outline-level']) return Number(t.a['style:default-outline-level']);
  }
  return 0;
}

/** Applies a paragraph style; paragraphs become headings when the style has an outline level. */
export function setParagraphStyle(state, dispatch, index, name) {
  const blocks = selectedTextblocks(state);
  if (!blocks.length) return false;
  if (!dispatch) return true;
  const level = styleOutlineLevel(index, name);
  const { paragraph, heading } = state.schema.nodes;
  const tr = state.tr;
  for (const { node, pos } of blocks) {
    const type = level ? heading : paragraph;
    const attrs = { styleName: name, auto: node.attrs.auto, extra: node.attrs.extra };
    if (level) attrs.level = level;
    tr.setNodeMarkup(pos, type, attrs);
  }
  dispatch(tr.scrollIntoView());
  return true;
}

/** Changes paragraph-properties attributes (null removes) on the selected paragraphs. */
export function setParagraphAttrs(state, dispatch, index, attrs) {
  return updateParagraphProps(state, dispatch, index, () => ({ attrs }));
}

/** Removes direct paragraph formatting (Ctrl+Q). */
export function clearParagraphFormatting(state, dispatch) {
  const blocks = selectedTextblocks(state);
  if (!blocks.length) return false;
  if (dispatch) {
    const tr = state.tr;
    for (const { node, pos } of blocks) if (node.attrs.auto) tr.setNodeMarkup(pos, null, { ...node.attrs, auto: null });
    dispatch(tr);
  }
  return true;
}
