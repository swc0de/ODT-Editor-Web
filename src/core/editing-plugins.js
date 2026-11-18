/**
 * Editing behaviour beyond the base keymap:
 *  - a multi-range selection ("Select Text with Similar Formatting")
 *  - formatting marks (Show ¶): space dots as decorations
 *  - list keys: Tab / Shift+Tab change level, Enter / Backspace leave the list
 *  - AutoCorrect as you type: smart quotes, dashes, ellipsis, (c) (r) (tm),
 *    "* " / "- " bullets, "1. " / "a) " numbering, sentence capitals
 */
import { Plugin, PluginKey, Selection, SelectionRange, TextSelection } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { chainCommands } from 'prosemirror-commands';
import { InputRule, inputRules, undoInputRule } from 'prosemirror-inputrules';
import { schema } from './schema.js';
import { listAt, sinkItem, liftItem, splitItem, changesBlocks } from './commands/lists.js';

// ------------------------------------------------------------ multi-range selection

export class MultiRangeSelection extends Selection {
  constructor(ranges) { super(ranges[0].$from, ranges[0].$to, ranges); }

  map(doc, mapping) {
    const rs = this.ranges
      .map((r) => [mapping.map(r.$from.pos, 1), mapping.map(r.$to.pos, -1)])
      .filter(([a, b]) => b > a)
      .map(([a, b]) => new SelectionRange(doc.resolve(a), doc.resolve(b)));
    if (!rs.length) return TextSelection.create(doc, mapping.map(this.head));
    return rs.length === 1 ? TextSelection.create(doc, rs[0].$from.pos, rs[0].$to.pos) : new MultiRangeSelection(rs);
  }

  eq(other) {
    return other instanceof MultiRangeSelection && other.ranges.length === this.ranges.length
      && other.ranges.every((r, i) => r.$from.pos === this.ranges[i].$from.pos && r.$to.pos === this.ranges[i].$to.pos);
  }

  toJSON() { return { type: 'multirange', ranges: this.ranges.map((r) => [r.$from.pos, r.$to.pos]) }; }

  static fromJSON(doc, json) { return new MultiRangeSelection(json.ranges.map(([a, b]) => new SelectionRange(doc.resolve(a), doc.resolve(b)))); }

  static create(doc, pairs) {
    if (pairs.length === 1) return TextSelection.create(doc, pairs[0][0], pairs[0][1]);
    return new MultiRangeSelection(pairs.map(([a, b]) => new SelectionRange(doc.resolve(a), doc.resolve(b))));
  }
}
Selection.jsonID('multirange', MultiRangeSelection);

/** Paints the extra ranges (the browser shows only the first). */
const multiSelectionPlugin = new Plugin({
  props: {
    decorations(state) {
      const sel = state.selection;
      if (!(sel instanceof MultiRangeSelection)) return null;
      return DecorationSet.create(state.doc, sel.ranges.map((r) => Decoration.inline(r.$from.pos, r.$to.pos, { class: 'odt-multisel' })));
    },
  },
});

// ------------------------------------------------------------ formatting marks

export const marksKey = new PluginKey('formattingMarks');

function spaceDecos(doc, from, to, out) {
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return true;
    const re = /[  ]/g;
    let m;
    while ((m = re.exec(node.text))) out.push(Decoration.inline(pos + m.index, pos + m.index + 1, { class: m[0] === ' ' ? 'odt-space' : 'odt-nbsp' }));
    return false;
  });
  return out;
}

/** Space dots while Show ¶ is on (meta true/false toggles); only edited paragraphs are recomputed. */
export function formattingMarksPlugin() {
  return new Plugin({
    key: marksKey,
    state: {
      init: () => ({ on: false, decos: DecorationSet.empty }),
      apply(tr, old, _o, state) {
        const meta = tr.getMeta(marksKey);
        if (meta !== undefined) return { on: meta, decos: meta ? DecorationSet.create(state.doc, spaceDecos(state.doc, 0, state.doc.content.size, [])) : DecorationSet.empty };
        if (!old.on || !tr.docChanged) return old;
        let decos = old.decos.map(tr.mapping, tr.doc);
        const ranges = [];
        tr.steps.forEach((step, i) => step.getMap().forEach((_a, _b, from, to) => {
          ranges.push([tr.mapping.slice(i + 1).map(from, -1), tr.mapping.slice(i + 1).map(to, 1)]);
        }));
        for (let [from, to] of ranges) {
          from = Math.max(0, Math.min(from, tr.doc.content.size));
          to = Math.max(from, Math.min(to, tr.doc.content.size));
          const $a = tr.doc.resolve(from);
          const $b = tr.doc.resolve(to);
          const a = $a.depth ? $a.start($a.depth) : from;
          const b = $b.depth ? $b.end($b.depth) : to;
          decos = decos.remove(decos.find(a, b)).add(tr.doc, spaceDecos(tr.doc, a, b, []));
        }
        return { on: true, decos };
      },
    },
    props: {
      decorations: (state) => marksKey.getState(state).decos,
      attributes: (state) => (marksKey.getState(state).on ? { class: 'show-marks' } : {}),
    },
  });
}

// ------------------------------------------------------------ lists

const atItemStart = (state) => {
  const at = listAt(state);
  if (!at) return false;
  const { $from } = state.selection;
  return $from.parentOffset === 0 && $from.index($from.depth - 1) === 0 && $from.node($from.depth - 1).type === schema.nodes.list_item;
};
const multiItem = (state) => !state.selection.empty && state.selection.$from.blockRange(state.selection.$to)?.parent.type === schema.nodes.list;

const listTab = (state, dispatch) => ((atItemStart(state) || multiItem(state)) && listAt(state) ? sinkItem(state, dispatch) : false);
const listShiftTab = (state, dispatch) => (listAt(state) ? liftItem(state, dispatch) : false);
const listBackspace = (state, dispatch) => (state.selection.empty && atItemStart(state) ? liftItem(state, dispatch) : false);
const listEnter = (state, dispatch) => {
  if (!listAt(state)) return false;
  const { $from, empty } = state.selection;
  if (empty && !$from.parent.content.size) return liftItem(state, dispatch);
  return splitItem(state, dispatch);
};

export const listKeymap = keymap({
  Tab: listTab,
  'Shift-Tab': chainCommands(listShiftTab, () => true),
  Enter: listEnter,
  Backspace: chainCommands(undoInputRule, listBackspace),
});

// ------------------------------------------------------------ AutoCorrect

/** AutoCorrect options (Backstage ▸ Options ▸ Proofing). */
export const AUTOCORRECT_DEFAULTS = Object.freeze({
  smartQuotes: true, dashes: true, symbols: true, autoBullets: true, autoNumbers: true, capitalise: true,
});

const inCode = () => false;

function replaceRule(re, replacement, when) {
  return new InputRule(re, (state, match, start, end) => {
    if (!when()) return null;
    const insert = typeof replacement === 'function' ? replacement(match, state, start) : replacement;
    if (insert == null) return null;
    const marks = state.doc.resolve(start).marks();
    return state.tr.replaceWith(start, end, schema.text(insert, marks));
  });
}

/** "* " → bullets, "1. " → numbering: the callback creates the list. */
function listRule(re, kind, when, makeList) {
  return new InputRule(re, (state, match, start, end) => {
    if (!when() || listAt(state) || state.selection.$from.parent.type !== schema.nodes.paragraph) return null;
    const tr = state.tr.delete(start, end);
    return makeList(tr, kind, match) || null;
  });
}

/**
 * Creates the AutoCorrect plugin.
 * @param {() => object} getOptions current options
 * @param {(tr, kind, match) => Transaction|null} makeList wraps the paragraph of tr's selection in a list
 */
export function autocorrectPlugin(getOptions, makeList) {
  const opt = (k) => () => getOptions()[k] !== false && !inCode();
  const openQuote = (prev) => !prev || /[\s([{‘“—–-]/.test(prev);
  const quoteRule = (ch, open, close) => new InputRule(new RegExp(`${ch === '"' ? '"' : "'"}$`), (state, _m, start, end) => {
    if (!getOptions().smartQuotes) return null;
    const prev = state.doc.textBetween(Math.max(state.selection.$from.start(), start - 1), start);
    const marks = state.doc.resolve(start).marks();
    return state.tr.replaceWith(start, end, schema.text(openQuote(prev) ? open : close, marks));
  });
  const rules = [
    quoteRule('"', '“', '”'),
    quoteRule("'", '‘', '’'),
    // "word - word" → en dash, "--" → en dash, "---" → em dash (when the next char is typed).
    replaceRule(/(?<=\S)---$/, '—', opt('dashes')),
    replaceRule(/–-$/, '—', opt('dashes')),
    replaceRule(/(?<=\S)--$/, '–', opt('dashes')),
    replaceRule(/(?<=\S )-- $/, '– ', opt('dashes')),
    replaceRule(/(?<=\S )- $/, '– ', opt('dashes')),
    replaceRule(/\.\.\.$/, '…', opt('symbols')),
    replaceRule(/\(c\)$/i, '©', opt('symbols')),
    replaceRule(/\(r\)$/i, '®', opt('symbols')),
    replaceRule(/\(tm\)$/i, '™', opt('symbols')),
    replaceRule(/(?<![-<])->$/, '→', opt('symbols')),
    replaceRule(/<-$/, '←', opt('symbols')),
    listRule(/^\s*[*\-•]\s$/, 'bullet', opt('autoBullets'), makeList),
    listRule(/^\s*([1aAiI])([.)])\s$/, 'number', opt('autoNumbers'), makeList),
    // Capitalise the first letter of a sentence when the word is finished.
    new InputRule(/(?:^|[.!?]["”’)]?\s+)["“‘(]?(\p{Ll})(\p{L}*)(["”’)]*[\s,;:])$/u, (state, match, start, end) => {
      if (!getOptions().capitalise) return null;
      const word = match[1] + match[2];
      if (/^(i\.e|e\.g|etc)$/i.test(word)) return null;
      const pos = start + match[0].length - word.length - match[3].length;
      // Only at the start of a paragraph or after sentence punctuation.
      const before = state.doc.textBetween(state.selection.$from.start(), pos, '\ufffc', '\ufffc');
      if (!/^["“‘(\s]*$/.test(before) && !/[.!?]["”’)]?\s+["“‘(]?$/.test(before)) return null;
      if (/\b(?:e\.g|i\.e|etc|vs|Mr|Mrs|Ms|Dr|St|No)\.\s+["“‘(]?$/i.test(before)) return null;
      const marks = state.doc.resolve(pos + 1).marks();
      return state.tr.replaceWith(pos, pos + 1, schema.text(match[1].toUpperCase(), marks)).insertText(match[0].slice(-1), end, end);
    }),
  ];
  return inputRules({ rules });
}

/**
 * Nested lists without their own style inherit the outer list's numbering:
 * keep their ul/ol (the `ordered` attribute) in step, as the importer does.
 */
const listOrderPlugin = new Plugin({
  appendTransaction(trs, _old, state) {
    if (!trs.some((t2) => t2.docChanged && changesBlocks(t2))) return null;
    let tr = null;
    const walk = (node, pos, ordered) => {
      if (node.isTextblock || node.isLeaf) return;
      let o = pos + 1;
      node.forEach((child) => {
        let next = ordered;
        if (child.type === schema.nodes.list) {
          if (child.attrs.styleName || ordered == null) next = child.attrs.ordered;
          else if (child.attrs.ordered !== ordered) {
            tr = tr || state.tr;
            tr.setNodeMarkup(o, null, { ...child.attrs, ordered });
          }
        }
        walk(child, o, child.type === schema.nodes.list ? next : (child.type === schema.nodes.list_item ? ordered : null));
        o += child.nodeSize;
      });
    };
    walk(state.doc, -1, null);
    return tr;
  },
});

export const editingPlugins = (getOptions, makeList) => [multiSelectionPlugin, formattingMarksPlugin(), listKeymap, autocorrectPlugin(getOptions, makeList), listOrderPlugin];
