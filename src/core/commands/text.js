/**
 * Character formatting. Direct formatting lives in the textProps mark as an
 * ODF automatic text style ({ styleAttrs, props: { 'style:text-properties':
 * { a } } }); named character styles are the charStyle mark.
 *
 * All commands work on every range of the selection (including the
 * multi-range selection made by "Select Text with Similar Formatting") and,
 * with an empty selection, on the stored marks for the next typed text.
 */
import { schema } from '../schema.js';
import { mergeAuto } from '../odt/styles.js';

const TP = 'style:text-properties';

/** Text-property attributes of a style chain (paragraph style text props + char style). */
function baseProps(index, paraNode, marks) {
  const para = index?.effective('paragraph', paraNode?.attrs.styleName) || null;
  const cs = marks.find((m) => m.type === schema.marks.charStyle);
  const ch = cs ? index?.effective('text', cs.attrs.name, { includeDefault: false }) || null : null;
  return { ...para?.props?.[TP]?.a, ...ch?.props?.[TP]?.a };
}

/** Effective text properties of a text node with its marks in a paragraph. */
export function effectiveOf(index, paraNode, marks) {
  const tp = marks.find((m) => m.type === schema.marks.textProps);
  return { ...baseProps(index, paraNode, marks), ...tp?.attrs.auto?.props?.[TP]?.a };
}

/** Segments of text in the selection: [{ from, to, node, para }]. */
export function textSegments(state) {
  const out = [];
  for (const r of state.selection.ranges) {
    const from = r.$from.pos;
    const to = r.$to.pos;
    state.doc.nodesBetween(from, to, (node, pos, parent) => {
      if (node.isText) out.push({ from: Math.max(from, pos), to: Math.min(to, pos + node.nodeSize), node, para: parent });
      return true;
    });
  }
  return out;
}

/** Effective props at the selection: of the first selected text, or what typing would get. */
export function textPropsAtSelection(state, index) {
  const { $from, empty } = state.selection;
  const para = $from.parent;
  if (empty) {
    const marks = state.storedMarks || $from.marks();
    return effectiveOf(index, para, marks);
  }
  const seg = textSegments(state)[0];
  return seg ? effectiveOf(index, seg.para, seg.node.marks) : effectiveOf(index, para, $from.marks());
}

/** True if every selected text segment satisfies test(effectiveProps). */
export function allText(state, index, test) {
  if (state.selection.empty) return test(textPropsAtSelection(state, index));
  const segs = textSegments(state);
  return segs.length > 0 && segs.every((s) => test(effectiveOf(index, s.para, s.node.marks)));
}

/** Values that mean "off" when the style doesn't set the property. */
const INITIAL = {
  'fo:font-weight': 'normal', 'style:font-weight-asian': 'normal', 'style:font-weight-complex': 'normal',
  'fo:font-style': 'normal', 'style:font-style-asian': 'normal', 'style:font-style-complex': 'normal',
  'style:text-underline-style': 'none', 'style:text-line-through-style': 'none', 'fo:font-variant': 'normal',
  'fo:text-transform': 'none', 'fo:background-color': 'transparent', 'fo:border': 'none', 'style:text-outline': 'false', 'fo:text-shadow': 'none',
};

/** New textProps auto from an old one with attribute changes (null deletes). */
function changedAuto(oldAuto, change, base) {
  const auto = oldAuto ? structuredClone(oldAuto) : { styleAttrs: {}, props: {} };
  const tp = auto.props[TP] || { a: {} };
  for (const [k, v] of Object.entries(change)) {
    // A value equal to the style's own (or the initial value when the style
    // doesn't set it) is redundant: drop it instead.
    const b = base?.[k];
    if (v == null || b === v || (b === undefined && INITIAL[k] === v)) delete tp.a[k]; else tp.a[k] = v;
  }
  if (Object.keys(tp.a).length || tp.c) auto.props[TP] = tp; else delete auto.props[TP];
  return Object.keys(auto.props).length || Object.keys(auto.styleAttrs).length ? auto : null;
}

/**
 * Applies attribute changes (value or null to remove) to the selection.
 * `change` may also be a function (effectiveProps) → change, evaluated per segment.
 */
export function applyTextProps(state, dispatch, index, change) {
  const type = schema.marks.textProps;
  if (state.selection.empty) {
    if (!dispatch) return true;
    const $f = state.selection.$from;
    const marks = state.storedMarks || $f.marks();
    const tp = marks.find((m) => m.type === type);
    const base = baseProps(index, $f.parent, marks);
    const ch = typeof change === 'function' ? change(effectiveOf(index, $f.parent, marks)) : change;
    const auto = changedAuto(tp?.attrs.auto, ch, base);
    let next = marks.filter((m) => m.type !== type);
    if (auto) next = type.create({ auto }).addToSet(next);
    dispatch(state.tr.setStoredMarks(next));
    return true;
  }
  const segs = textSegments(state);
  if (!segs.length) return false;
  if (!dispatch) return true;
  const tr = state.tr;
  for (const s of segs) {
    const tp = s.node.marks.find((m) => m.type === type);
    const base = baseProps(index, s.para, s.node.marks);
    const ch = typeof change === 'function' ? change(effectiveOf(index, s.para, s.node.marks)) : change;
    const auto = changedAuto(tp?.attrs.auto, ch, base);
    tr.removeMark(s.from, s.to, type);
    if (auto) tr.addMark(s.from, s.to, type.create({ auto }));
  }
  dispatch(tr.scrollIntoView());
  return true;
}

/** Toggles a property: on when not every selected text has it. */
export function toggleTextProp(state, dispatch, index, isOn, onChange, offChange) {
  const on = allText(state, index, isOn);
  return applyTextProps(state, dispatch, index, on ? offChange : onChange);
}

/** Removes direct character formatting and character styles (Ctrl+Space). */
export function clearCharFormatting(state, dispatch) {
  if (state.selection.empty) {
    if (dispatch) dispatch(state.tr.setStoredMarks((state.storedMarks || state.selection.$from.marks()).filter((m) => m.type !== schema.marks.textProps && m.type !== schema.marks.charStyle)));
    return true;
  }
  if (!dispatch) return true;
  const tr = state.tr;
  for (const r of state.selection.ranges) {
    tr.removeMark(r.$from.pos, r.$to.pos, schema.marks.textProps);
    tr.removeMark(r.$from.pos, r.$to.pos, schema.marks.charStyle);
  }
  dispatch(tr);
  return true;
}

/** Applies (or with null removes) a named character style. */
export function setCharStyle(state, dispatch, name) {
  const type = schema.marks.charStyle;
  if (state.selection.empty) {
    const marks = (state.storedMarks || state.selection.$from.marks()).filter((m) => m.type !== type);
    if (dispatch) dispatch(state.tr.setStoredMarks(name ? type.create({ name }).addToSet(marks) : marks));
    return true;
  }
  if (!dispatch) return true;
  const tr = state.tr;
  for (const r of state.selection.ranges) {
    tr.removeMark(r.$from.pos, r.$to.pos, type);
    if (name) tr.addMark(r.$from.pos, r.$to.pos, type.create({ name }));
  }
  dispatch(tr.scrollIntoView());
  return true;
}

/** Underline kinds → text-property attributes. */
export const UNDERLINES = {
  single: { 'style:text-underline-style': 'solid', 'style:text-underline-width': 'auto', 'style:text-underline-color': 'font-color', 'style:text-underline-type': null },
  double: { 'style:text-underline-style': 'solid', 'style:text-underline-type': 'double', 'style:text-underline-width': 'auto', 'style:text-underline-color': 'font-color' },
  thick: { 'style:text-underline-style': 'solid', 'style:text-underline-width': 'bold', 'style:text-underline-color': 'font-color', 'style:text-underline-type': null },
  dotted: { 'style:text-underline-style': 'dotted', 'style:text-underline-width': 'auto', 'style:text-underline-color': 'font-color', 'style:text-underline-type': null },
  dashed: { 'style:text-underline-style': 'dash', 'style:text-underline-width': 'auto', 'style:text-underline-color': 'font-color', 'style:text-underline-type': null },
  wave: { 'style:text-underline-style': 'wave', 'style:text-underline-width': 'auto', 'style:text-underline-color': 'font-color', 'style:text-underline-type': null },
};
export const NO_UNDERLINE = { 'style:text-underline-style': 'none', 'style:text-underline-width': null, 'style:text-underline-color': null, 'style:text-underline-type': null };
export const hasUnderline = (p) => !!p['style:text-underline-style'] && p['style:text-underline-style'] !== 'none';
export function underlineKind(p) {
  if (!hasUnderline(p)) return 'none';
  if (p['style:text-underline-type'] === 'double') return 'double';
  if (p['style:text-underline-width'] === 'bold') return 'thick';
  return { solid: 'single', dotted: 'dotted', dash: 'dashed', wave: 'wave' }[p['style:text-underline-style']] || 'single';
}

// ------------------------------------------------------------ case

const sentence = (s) => s.toLowerCase().replace(/(^\s*|[.!?]\s+)(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
const capitalize = (s) => s.toLowerCase().replace(/(^|[\s\-–—("“‘])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
const toggle = (s) => [...s].map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join('');
export const CASES = { sentence, lower: (s) => s.toLowerCase(), upper: (s) => s.toUpperCase(), capitalize, toggle };

/** Changes the case of the selected text (marks kept). mode: key of CASES or 'cycle' (Shift+F3 cycles UPPER → lower → Capitalised). */
export function changeCase(state, dispatch, mode) {
  if (state.selection.empty) return false;
  const segs = textSegments(state);
  if (!segs.length) return false;
  let fn = CASES[mode];
  if (mode === 'cycle') {
    const sel = segs.map((x) => state.doc.textBetween(x.from, x.to)).join('');
    if (sel === sel.toUpperCase() && sel !== sel.toLowerCase()) fn = CASES.lower;
    else if (sel === sel.toLowerCase()) fn = CASES.capitalize;
    else fn = CASES.upper;
  }
  if (!fn) return false;
  if (!dispatch) return true;
  const tr = state.tr;
  for (const x of segs) {
    const text = state.doc.textBetween(x.from, x.to);
    let next;
    if (fn === sentence) {
      // Sentence case needs what precedes the segment in its paragraph.
      const before = state.doc.textBetween(state.doc.resolve(x.from).start(), x.from);
      next = sentence(before + text).slice(before.length);
    } else next = fn(text);
    if (next !== text && next.length === text.length) tr.replaceWith(tr.mapping.map(x.from), tr.mapping.map(x.to), schema.text(next, x.node.marks));
  }
  dispatch(tr.setSelection(state.selection.map(tr.doc, tr.mapping)));
  return true;
}

// ------------------------------------------------------------ sizes

export const FONT_SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];
export function nextSize(pt, dir) {
  if (dir > 0) return FONT_SIZES.find((s) => s > pt + 0.01) ?? Math.min(1638, Math.floor(pt / 10) * 10 + 10);
  const smaller = [...FONT_SIZES].reverse().find((s) => s < pt - 0.01);
  return smaller ?? Math.max(1, pt - 1);
}

export const sizePt = (v) => {
  const m = /^([\d.]+)pt$/.exec(v || '');
  return m ? Number(m[1]) : (/^([\d.]+)px$/.test(v || '') ? Number(RegExp.$1) * 0.75 : 12);
};

/** Merges two text auto objects (for Format Painter etc.). */
export const mergeTextAuto = (a, b) => mergeAuto(a, b);
