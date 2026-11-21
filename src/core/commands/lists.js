/**
 * Lists: bullets / numbering / multilevel, level changes (Tab / Shift+Tab),
 * restart / continue / set value, and the numbering labels plugin that
 * renders ODF list numbering (start values, continue-numbering,
 * continue-list, list headers, display-levels) as list markers.
 */
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { wrapInList, liftListItem, sinkListItem, splitListItem } from 'prosemirror-schema-list';
import { schema } from '../schema.js';
import { stableStringify, listLevelGeometry } from '../odt/styles.js';
import { textPropsCss } from '../odt/css.js';
import { treeToXml } from '../odt/xml.js';

const { list: LIST, list_item: ITEM } = schema.nodes;

// ------------------------------------------------------------ list styles

const ALPHA = 'abcdefghijklmnopqrstuvwxyz';
function roman(n) {
  const map = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let out = '';
  for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
  return out;
}
function alpha(n) {
  let s = '';
  while (n > 0) { n--; s = ALPHA[n % 26] + s; n = Math.floor(n / 26); }
  return s;
}
export function formatNumber(n, fmt) {
  switch (fmt) {
    case 'a': return alpha(n);
    case 'A': return alpha(n).toUpperCase();
    case 'i': return roman(n);
    case 'I': return roman(n).toUpperCase();
    case '': return '';
    default: return String(n);
  }
}

/** Level definitions of a list style tree: index → { kind, bullet, format, prefix, suffix, display, start }. */
export function listLevels(tree) {
  const levels = [];
  for (const c of tree?.c || []) {
    if (typeof c === 'string' || !c.a?.['text:level']) continue;
    const i = Number(c.a['text:level']) - 1;
    // Where the label and text go, and the label's own character formatting.
    const geo = listLevelGeometry(c);
    const tp = (c.c || []).find((x) => typeof x !== 'string' && x.n === 'style:text-properties')?.a || null;
    const extra = { geo, labelCss: tp ? textPropsCss(tp).join(';') : '' };
    if (c.n === 'text:list-level-style-bullet') levels[i] = { kind: 'bullet', bullet: c.a['text:bullet-char'] || '•', ...extra };
    else if (c.n === 'text:list-level-style-number') {
      levels[i] = {
        kind: 'number', format: c.a['style:num-format'] ?? '1', prefix: c.a['style:num-prefix'] || '', suffix: c.a['style:num-suffix'] || '',
        display: Number(c.a['text:display-levels'] || 1), start: Number(c.a['text:start-value'] || 1), ...extra,
      };
    } else levels[i] = { kind: 'none', ...extra };
  }
  return levels;
}

const indent = (i) => (0.635 * (i + 1)).toFixed(3);
const levelProps = (i) => ({
  n: 'style:list-level-properties', a: { 'text:list-level-position-and-space-mode': 'label-alignment' },
  c: [{ n: 'style:list-level-label-alignment', a: { 'text:label-followed-by': 'listtab', 'text:list-tab-stop-position': `${indent(i)}cm`, 'fo:text-indent': '-0.635cm', 'fo:margin-left': `${indent(i)}cm` } }],
});

/**
 * Builds a text:list-style tree.
 * @param {string} name
 * @param {Array<{bullet?:string, format?:string, prefix?:string, suffix?:string, display?:number, start?:number}>} levels (1–10; missing levels repeat the pattern)
 */
export function makeListStyle(name, levels) {
  const c = [];
  for (let i = 0; i < 10; i++) {
    const l = levels[i] || levels[i % levels.length];
    if (l.bullet != null) c.push({ n: 'text:list-level-style-bullet', a: { 'text:level': String(i + 1), 'text:bullet-char': l.bullet }, c: [levelProps(i)] });
    else {
      const a = { 'text:level': String(i + 1), 'style:num-format': l.format ?? '1' };
      if (l.prefix) a['style:num-prefix'] = l.prefix;
      if (l.suffix) a['style:num-suffix'] = l.suffix;
      if (l.display > 1) a['text:display-levels'] = String(Math.min(l.display, i + 1));
      if (l.start > 1) a['text:start-value'] = String(l.start);
      c.push({ n: 'text:list-level-style-number', a, c: [levelProps(i)] });
    }
  }
  return { n: 'text:list-style', a: { 'style:name': name }, c };
}

/** Library presets shown in the Bullets / Numbering / Multilevel galleries. */
export const LIST_LIBRARY = {
  bullet: [
    [{ bullet: '•' }, { bullet: '◦' }, { bullet: '▪' }],
    [{ bullet: '◦' }], [{ bullet: '▪' }], [{ bullet: '➢' }], [{ bullet: '✓' }], [{ bullet: '–' }],
  ],
  number: [
    [{ format: '1', suffix: '.' }, { format: 'a', suffix: '.' }, { format: 'i', suffix: '.' }],
    [{ format: '1', suffix: ')' }], [{ format: 'I', suffix: '.' }], [{ format: 'A', suffix: '.' }], [{ format: 'a', suffix: ')' }], [{ format: 'i', suffix: '.' }],
  ],
  multilevel: [
    Array.from({ length: 10 }, () => ({ format: '1', suffix: '.', display: 10 })),
    [{ format: '1', suffix: ')' }, { format: 'a', suffix: ')' }, { format: 'i', suffix: ')' }],
    [{ bullet: '•' }, { bullet: '◦' }, { bullet: '▪' }],
    [{ format: 'I', suffix: '.' }, { format: 'A', suffix: '.' }, { format: '1', suffix: '.' }, { format: 'a', suffix: ')' }],
    Array.from({ length: 10 }, () => ({ format: '1', display: 10 })),
    [{ format: 'A', suffix: '.' }, { format: '1', suffix: '.' }, { format: 'a', suffix: '.' }],
  ],
};

/**
 * Finds or adds an automatic list style with these levels in the document
 * state (de-duplicated by content). Returns its name.
 */
export function ensureListStyle(docState, levels) {
  const probe = makeListStyle('?', levels);
  const key = stableStringify(probe.c);
  for (const t of docState.contentAutoStyles) if (t.n === 'text:list-style' && stableStringify(t.c) === key) return t.a['style:name'];
  const taken = new Set(docState.contentAutoStyles.map((t) => t.a?.['style:name']));
  let i = 1;
  while (taken.has(`L${i}`)) i++;
  const tree = makeListStyle(`L${i}`, levels);
  docState.contentAutoStyles = [...docState.contentAutoStyles, tree];
  void treeToXml;
  return tree.a['style:name'];
}

// ------------------------------------------------------------ commands

/** The list item / list around the selection: { item, itemPos, list, listPos, depth } or null. */
export function listAt(state) {
  const $f = state.selection.$from;
  for (let d = $f.depth; d > 0; d--) {
    if ($f.node(d).type === ITEM) {
      return { item: $f.node(d), itemPos: $f.before(d), list: $f.node(d - 1), listPos: $f.before(d - 1), depth: d };
    }
  }
  return null;
}

/** Outermost list containing the selection. */
export function rootListAt(state) {
  const $f = state.selection.$from;
  for (let d = 1; d <= $f.depth; d++) if ($f.node(d).type === LIST) return { node: $f.node(d), pos: $f.before(d) };
  return null;
}

/**
 * Bullets / Numbering: toggles a list of this kind, switches another list
 * to it, or applies a specific list style.
 * @param {'bullet'|'number'|'multilevel'} kind
 * @param {string|null} styleName list style to use (null = the default for the kind)
 * @param {(styleName:string)=>boolean} isKind tests whether a list style is of this kind
 */
export function toggleList(state, dispatch, { styleName, ordered, isKind }) {
  const root = rootListAt(state);
  if (root) {
    const current = root.node.attrs.styleName;
    if (isKind(current) && (!styleName || styleName === current)) {
      // Same kind: lift the selected items out of the list.
      let lifted = false;
      let s = state;
      const trs = [];
      for (let i = 0; i < 12 && listAt(s); i++) {
        if (!liftListItem(ITEM)(s, (tr) => { trs.push(tr); s = s.apply(tr); })) break;
        lifted = true;
      }
      if (dispatch && lifted) {
        const tr = state.tr;
        for (const t of trs) for (const step of t.steps) tr.step(step);
        dispatch(tr.scrollIntoView());
      }
      return lifted;
    }
    if (dispatch) dispatch(state.tr.setNodeMarkup(root.pos, null, { ...root.node.attrs, styleName, ordered }).scrollIntoView());
    return true;
  }
  return wrapInList(LIST, { styleName, ordered, extra: null })(state, dispatch);
}

export const sinkItem = (state, dispatch) => sinkListItem(ITEM)(state, dispatch);
export const liftItem = (state, dispatch) => liftListItem(ITEM)(state, dispatch);
export const splitItem = (state, dispatch) => splitListItem(ITEM)(state, dispatch);

/** Sets or clears extra attributes on the list item at the selection. */
function setItemExtra(state, dispatch, change) {
  const at = listAt(state);
  if (!at) return false;
  if (dispatch) {
    const extra = { ...(at.item.attrs.extra || {}) };
    for (const [k, v] of Object.entries(change)) { if (v == null) delete extra[k]; else extra[k] = String(v); }
    dispatch(state.tr.setNodeMarkup(at.itemPos, null, { ...at.item.attrs, extra: Object.keys(extra).length ? extra : null }));
  }
  return true;
}

export const restartNumbering = (state, dispatch, value = 1) => setItemExtra(state, dispatch, { 'text:start-value': value });

/** Continue numbering from the previous list: drop restarts and mark the list as continuing. */
export function continueNumbering(state, dispatch) {
  const root = rootListAt(state);
  if (!root) return false;
  if (dispatch) {
    const tr = state.tr;
    const extra = { ...(root.node.attrs.extra || {}), 'text:continue-numbering': 'true' };
    delete extra['text:continue-list'];
    tr.setNodeMarkup(root.pos, null, { ...root.node.attrs, extra });
    const at = listAt(state);
    if (at?.item.attrs.extra?.['text:start-value']) {
      const ex = { ...at.item.attrs.extra };
      delete ex['text:start-value'];
      tr.setNodeMarkup(at.itemPos, null, { ...at.item.attrs, extra: Object.keys(ex).length ? ex : null });
    }
    dispatch(tr);
  }
  return true;
}

// ------------------------------------------------------------ labels

export const listLabelsKey = new PluginKey('listLabels');

/**
 * Computes the label of every list item. getLists(name) → list style tree.
 * Returns DecorationSet with data-label on each list item.
 */
export function computeListLabels(doc, getListStyle) {
  const decos = [];
  const lastByStyle = new Map(); // style → counters at the end of the last list with that style
  const byId = new Map(); // xml:id → counters
  const visitList = (list, pos, styleName, counters, depth) => {
    const style = list.attrs.styleName || styleName;
    const levels = style ? listLevels(getListStyle(style)) : [];
    let offset = pos + 1;
    list.forEach((item) => {
      const itemPos = offset;
      offset += item.nodeSize;
      const lv = levels[depth] || (depth === 0 && !style ? { kind: 'bullet', bullet: '•' } : levels[levels.length - 1] || { kind: 'bullet', bullet: '•' });
      if (!item.attrs.header) {
        const sv = item.attrs.extra?.['text:start-value'];
        counters[depth] = sv ? Number(sv) : (counters[depth] ? counters[depth] + 1 : (lv.start || 1));
        for (let d = depth + 1; d < counters.length; d++) counters[d] = 0;
        let label;
        if (lv.kind === 'bullet') label = lv.bullet;
        else if (lv.kind === 'number') {
          const parts = [];
          const from = Math.max(0, depth - (lv.display || 1) + 1);
          for (let d = from; d <= depth; d++) parts.push(formatNumber(counters[d] || 1, (levels[d] || lv).format ?? '1'));
          label = lv.format === '' ? '' : `${lv.prefix || ''}${parts.join('.')}${lv.suffix || ''}`;
        } else label = '';
        // The label is drawn in the first line of the item's first paragraph,
        // as Word and LibreOffice do: at the level's label position, followed
        // by a tab to the text position (or a space, or nothing).
        const first = item.firstChild;
        const widget = first?.isTextblock && lv.geo;
        decos.push(Decoration.node(itemPos, itemPos + item.nodeSize, widget ? { 'data-label': label, class: 'has-label' } : { 'data-label': label }));
        if (widget) decos.push(labelWidget(itemPos + 2, label, lv));
      }
      let childOffset = itemPos + 1;
      item.forEach((child) => {
        if (child.type === LIST) visitList(child, childOffset, style, counters, depth + 1);
        else visitBlocks(child, childOffset);
        childOffset += child.nodeSize;
      });
    });
    return style;
  };
  const visitRoot = (list, pos) => {
    const ex = list.attrs.extra || {};
    let counters = [];
    const style = list.attrs.styleName;
    if (ex['text:continue-list'] && byId.has(ex['text:continue-list'])) counters = [...byId.get(ex['text:continue-list'])];
    else if (ex['text:continue-numbering'] === 'true' && lastByStyle.has(style)) counters = [...lastByStyle.get(style)];
    visitList(list, pos, style, counters, 0);
    lastByStyle.set(style, counters);
    if (ex['xml:id']) byId.set(ex['xml:id'], counters);
  };
  const visitBlocks = (node, pos) => {
    if (node.type === LIST) { visitRoot(node, pos); return; }
    if (node.isTextblock || node.isAtom) return;
    let o = pos + 1;
    node.forEach((c) => { visitBlocks(c, o); o += c.nodeSize; });
  };
  let o = 0;
  doc.forEach((c) => { visitBlocks(c, o); o += c.nodeSize; });
  return DecorationSet.create(doc, decos);
}

/** The label of a list item as a widget at the start of its first paragraph. */
function labelWidget(pos, label, lv) {
  const g = lv.geo;
  const text = g.follow === 'space' && label ? `${label}\u00a0` : label;
  const width = g.follow === 'listtab' ? Math.max(0, (g.tab ?? g.margin) - (g.margin + g.indent)) : 0;
  const css = `margin-left:${g.indent.toFixed(2)}px;min-width:${width.toFixed(2)}px${g.align === 'center' ? ';text-align:center' : g.align === 'end' || g.align === 'right' ? ';text-align:right' : ''}${lv.labelCss ? `;${lv.labelCss}` : ''}`;
  return Decoration.widget(pos, () => {
    const span = document.createElement('span');
    span.className = 'odt-label';
    span.contentEditable = 'false';
    span.setAttribute('aria-hidden', 'true');
    span.style.cssText = css;
    span.textContent = text;
    return span;
  }, { side: -1, key: `lbl:${text}:${css}`, ignoreSelection: true, marks: [] });
}

/**
 * True when a transaction may change list structure (and so labels): anything
 * but typing / deleting inline content inside one textblock or changing marks.
 */
export function changesBlocks(tr) {
  return tr.steps.some((step, i) => {
    const type = step.toJSON().stepType;
    if (type === 'addMark' || type === 'removeMark') return false;
    if (type !== 'replace') return true;
    const doc = tr.docs[i];
    const $a = doc.resolve(step.from);
    const $b = doc.resolve(step.to);
    if (!$a.parent.isTextblock || $a.parent !== $b.parent) return true;
    let block = false;
    step.slice.content.forEach((n) => { if (!n.isInline) block = true; });
    return block || step.slice.openStart > 0 || step.slice.openEnd > 0;
  });
}

/** Plugin keeping list labels up to date. */
export function listLabelsPlugin(getListStyle) {
  return new Plugin({
    key: listLabelsKey,
    state: {
      init: (_, state) => computeListLabels(state.doc, getListStyle),
      apply: (tr, old, _o, state) => {
        if (tr.getMeta(listLabelsKey) || (tr.docChanged && changesBlocks(tr))) return computeListLabels(state.doc, getListStyle);
        return tr.docChanged ? old.map(tr.mapping, tr.doc) : old;
      },
    },
    props: { decorations: (state) => listLabelsKey.getState(state) },
  });
}
