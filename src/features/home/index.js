/** Home tab: Clipboard, Font, Paragraph, Paragraph Tools, Styles, Editing, Voice, Editor. */
import { Selection, NodeSelection } from 'prosemirror-state';
import { defineCommands } from '../define.js';
import { schema } from '../../core/schema.js';
import { t } from '../../i18n/index.js';
import {
  applyTextProps, toggleTextProp, clearCharFormatting, setCharStyle, changeCase, textPropsAtSelection, allText,
  nextSize, sizePt, UNDERLINES, NO_UNDERLINE, hasUnderline, textSegments, effectiveOf,
} from '../../core/commands/text.js';
import {
  selectedTextblocks, effectiveParagraphProps, updateParagraphProps, setParagraphAttrs, setParagraphStyle,
  clearParagraphFormatting, paragraphIndents,
} from '../../core/commands/paragraph.js';
import {
  LIST_LIBRARY, ensureListStyle, toggleList, listAt, rootListAt, sinkItem, liftItem, listLevels,
  restartNumbering, continueNumbering,
} from '../../core/commands/lists.js';
import { ensureStyles, findStyle, createStyle, setStyleFormatting, ownFormatting, updateStyleToMatch, deleteStyle, isBuiltIn } from '../../core/style-edit.js';
import { mergeAuto } from '../../core/odt/styles.js';
import { MultiRangeSelection, marksKey } from '../../core/editing-plugins.js';
import { editState } from '../../core/state-step.js';
import { dictationSupported } from '../../core/dictation.js';
import { pxToLength } from '../../layout/units.js';
import { showDialog } from '../../ui/dialog.js';
import { h } from '../../ui/dom.js';
import { field, text, select } from '../../ui/form.js';
import {
  fontDialog, paragraphDialog, tabsDialog, bordersDialog, sortDialog, defineListDialog, numberValueDialog, moreColoursDialog, styleDialog,
} from '../../ui/format-dialogs.js';
import { setSetting, getSetting } from '../../core/settings.js';

// ------------------------------------------------------------ helpers

const V = (c) => c.editor.view;
const IX = (c) => c.ui.docArea?.styleIndex || null;
const canEdit = (c) => !!c.editor && c.state.editingMode !== 'viewing';
const done = (c) => c.editor.focus();
const TP = 'style:text-properties';
const PP = 'style:paragraph-properties';

/** Formatting at the selection, computed once per editor state. */
const cache = new WeakMap();
export function formatAt(c) {
  const st = V(c).state;
  const ix = IX(c);
  let f = cache.get(st);
  if (f && f.ix === ix) return f;
  const block = selectedTextblocks(st)[0];
  const tested = new Map();
  f = {
    ix,
    text: textPropsAtSelection(st, ix),
    para: block ? (effectiveParagraphProps(block.node, ix).a || {}) : {},
    node: block?.node || null,
    list: rootListAt(st),
    charStyle: (st.selection.empty ? (st.storedMarks || st.selection.$from.marks()) : st.doc.resolve(Math.min(st.selection.from + 1, st.selection.to)).marks()).find((m) => m.type === schema.marks.charStyle)?.attrs.name || null,
    all(key, test) {
      if (!tested.has(key)) tested.set(key, allText(st, ix, test));
      return tested.get(key);
    },
  };
  cache.set(st, f);
  return f;
}

/** Runs several commands as one transaction (one undo step). */
function chain(c, ...fns) {
  const view = V(c);
  let state = view.state;
  const tr = state.tr;
  for (const fn of fns) {
    fn(state, (t2) => {
      for (const s of t2.steps) tr.step(s);
      state = state.apply(t2);
    });
  }
  tr.setSelection(Selection.fromJSON(tr.doc, state.selection.toJSON()));
  if (state.storedMarks) tr.setStoredMarks(state.storedMarks);
  view.dispatch(tr.scrollIntoView());
}

const textChange = (c, change) => { applyTextProps(V(c).state, V(c).dispatch, IX(c), change); done(c); };
const paraChange = (c, attrs) => { setParagraphAttrs(V(c).state, V(c).dispatch, IX(c), attrs); done(c); };

/** A text toggle (bold, italic…): checked when every selected character has it. */
const toggle = (key, isOn, on, off, extra = {}) => ({
  isEnabled: canEdit,
  isChecked: (c) => !!c.editor && formatAt(c).all(key, isOn),
  run: (c) => { toggleTextProp(V(c).state, V(c).dispatch, IX(c), isOn, on, off); done(c); },
  repeatable: true,
  ...extra,
});
const paraToggle = (key, onValue) => ({
  isEnabled: canEdit,
  isChecked: (c) => !!c.editor && formatAt(c).para[key] === onValue,
  run: (c) => paraChange(c, { [key]: formatAt(c).para[key] === onValue ? null : onValue }),
  repeatable: true,
});

const three = (base, v) => ({ [`fo:${base}`]: v, [`style:${base}-asian`]: v, [`style:${base}-complex`]: v });
const isBold = (p) => p['fo:font-weight'] === 'bold' || Number(p['fo:font-weight']) >= 600;
const isItalic = (p) => p['fo:font-style'] === 'italic' || p['fo:font-style'] === 'oblique';
const isStrike = (p) => !!p['style:text-line-through-style'] && p['style:text-line-through-style'] !== 'none';
const isSub = (p) => /^(sub|-)/.test(String(p['style:text-position'] || ''));
const isSup = (p) => /^(super|[1-9])/.test(String(p['style:text-position'] || ''));
const isBorder = (p) => !!p['fo:border'] && p['fo:border'] !== 'none';

const alignOf = (a) => ({ left: 'start', right: 'end', start: 'start', end: 'end', center: 'center', justify: 'justify' })[a['fo:text-align']] || 'start';
const alignCmd = (val) => ({
  isEnabled: canEdit,
  isChecked: (c) => !!c.editor && alignOf(formatAt(c).para) === val,
  run: (c) => paraChange(c, { 'fo:text-align': alignOf(formatAt(c).para) === val && val !== 'start' ? 'start' : val }),
  repeatable: true,
});

const lineHeightOf = (a) => (a['style:line-height-at-least'] ? null : (!a['fo:line-height'] || a['fo:line-height'] === 'normal' ? '100%' : a['fo:line-height']));
const spacingCmd = (pct, shortcut) => ({
  shortcut,
  isEnabled: canEdit,
  isChecked: (c) => !!c.editor && lineHeightOf(formatAt(c).para) === pct,
  run: (c) => paraChange(c, { 'fo:line-height': pct, 'style:line-height-at-least': null, 'style:line-spacing': null }),
  repeatable: true,
});

// Borders
const SIDES = ['top', 'bottom', 'left', 'right'];
const LINE = '0.5pt solid #000000';
const sideValue = (a, s) => a[`fo:border-${s}`] ?? a['fo:border'];
const sidesOf = (a) => Object.fromEntries(SIDES.map((s) => { const v = sideValue(a, s); return [s, !!v && v !== 'none']; }));
function setBorders(c, change) {
  updateParagraphProps(V(c).state, V(c).dispatch, IX(c), (eff) => {
    const a = eff.a || {};
    const cur = sidesOf(a);
    const next = { ...cur, ...change };
    const attrs = { 'fo:border': null };
    const any = SIDES.some((s) => next[s]);
    for (const s of SIDES) attrs[`fo:border-${s}`] = next[s] ? (cur[s] ? sideValue(a, s) : LINE) : (any ? 'none' : null);
    if (!any) {
      // Nothing left: drop direct borders; keep 'none' only where the style draws one.
      for (const s of SIDES) if (cur[s]) attrs[`fo:border-${s}`] = 'none';
    }
    attrs['fo:padding'] = any ? (a['fo:padding'] || '0.049cm') : null;
    return { attrs };
  });
  done(c);
}
const borderCmd = (side, icon) => ({
  icon,
  isEnabled: canEdit,
  isChecked: (c) => !!c.editor && sidesOf(formatAt(c).para)[side],
  run: (c) => { setBorders(c, { [side]: !sidesOf(formatAt(c).para)[side] }); c.store.set({ lastBorder: `home.border${side[0].toUpperCase()}${side.slice(1)}` }); },
});

// Lists
export function getListStyle(c, name) {
  if (!name) return null;
  return IX(c)?.lists.get(name) || (c.session?.state?.contentAutoStyles || []).find((x) => x.n === 'text:list-style' && x.a['style:name'] === name) || null;
}
const listKind = (c, name) => {
  const l = listLevels(getListStyle(c, name))[0];
  return !l ? (name ? null : 'bullet') : (l.kind === 'bullet' ? 'bullet' : 'number');
};

/** Applies (or with the same kind toggles off) a list. levels: from the library or a dialog. */
export function applyList(c, kind, levels = null, explicit = false) {
  const view = V(c);
  const lv = levels || LIST_LIBRARY[kind][c.state.listPresets?.[kind] ?? 0];
  const name = ensureListStyle(c.session.state, lv);
  const ordered = lv[0].bullet == null;
  const root = rootListAt(view.state);
  if (root && !explicit && kind !== 'multilevel' && listKind(c, root.node.attrs.styleName) === kind) {
    toggleList(view.state, view.dispatch, { styleName: root.node.attrs.styleName, ordered, isKind: () => true });
  } else {
    toggleList(view.state, view.dispatch, { styleName: name, ordered, isKind: () => false });
  }
  done(c);
}
const listCmd = (kind, icon) => ({
  icon,
  isEnabled: canEdit,
  isChecked: (c) => kind !== 'multilevel' && !!c.editor && !!formatAt(c).list && listKind(c, formatAt(c).list.node.attrs.styleName) === kind,
  run: (c, preset) => {
    if (typeof preset === 'number') c.store.set({ listPresets: { ...c.state.listPresets, [kind]: preset } });
    applyList(c, kind, typeof preset === 'number' ? LIST_LIBRARY[kind][preset] : null, typeof preset === 'number');
  },
});

// Indents (cm steps like the default tab interval)
const STEP = 96 / 2.54 * 1.27;
function indentBy(c, dir) {
  const view = V(c);
  if (listAt(view.state)) {
    if (dir > 0) sinkItem(view.state, view.dispatch); else liftItem(view.state, view.dispatch);
    return done(c);
  }
  updateParagraphProps(view.state, view.dispatch, IX(c), (_eff, node) => {
    const left = paragraphIndents(node, IX(c)).left;
    const next = dir > 0 ? (Math.floor(left / STEP + 1e-6) + 1) * STEP : Math.max(0, (Math.ceil(left / STEP - 1e-6) - 1) * STEP);
    return { attrs: { 'fo:margin-left': pxToLength(next, 'cm', 3) } };
  });
  done(c);
}

// Styles
export const GALLERY_STYLES = {
  normal: ['paragraph', 'Standard'], noSpacing: ['paragraph', 'No_20_Spacing'], heading1: ['paragraph', 'Heading_20_1'],
  title: ['paragraph', 'Title'], heading2: ['paragraph', 'Heading_20_2'], subtitle: ['paragraph', 'Subtitle'],
  heading3: ['paragraph', 'Heading_20_3'], subtleEmphasis: ['text', 'Subtle_20_Emphasis'], emphasis: ['text', 'Emphasis'],
  intenseEmphasis: ['text', 'Intense_20_Emphasis'], strong: ['text', 'Strong_20_Emphasis'], quote: ['paragraph', 'Quote'],
  intenseQuote: ['paragraph', 'Intense_20_Quote'], listParagraph: ['paragraph', 'List_20_Paragraph'],
};

const STYLE_KEYS = ['commonStyles'];
/** Changes named styles as an undoable step (the editor re-renders on StateSteps). */
const editStyles = (c, fn) => editState(V(c), c.session.state, STYLE_KEYS, fn);

export function useStyle(c, family, name) {
  editStyles(c, (st) => ensureStyles(st, family, [name]));
  const view = V(c);
  if (family === 'paragraph') setParagraphStyle(view.state, view.dispatch, IX(c), name);
  else setCharStyle(view.state, view.dispatch, formatAt(c).charStyle === name ? null : name);
  done(c);
}

const styleOptions = (c, family) => [...(IX(c)?.families.get(family) || new Map()).keys()]
  .map((n) => [n, IX(c).displayName(family, n)]).sort((a, b) => a[1].localeCompare(b[1]));

/** Direct formatting at the selection as one auto (paragraph + first text run). */
function directFormatting(c) {
  const f = formatAt(c);
  const st = V(c).state;
  const seg = textSegments(st)[0];
  const marks = seg ? seg.node.marks : (st.storedMarks || st.selection.$from.marks());
  const text = marks.find((m) => m.type === schema.marks.textProps)?.attrs.auto || null;
  return mergeAuto(f.node?.attrs.auto || null, text ? { styleAttrs: {}, props: { [TP]: text.props[TP] } } : null);
}

/** Clears direct formatting of the selected paragraphs (and text) after a style absorbed it. */
const clearDirect = (c) => chain(c, clearCharFormatting, clearParagraphFormatting);

export const styleActions = (c) => ({
  async create() {
    const f = formatAt(c);
    const parent = f.node?.attrs.styleName || 'Standard';
    const res = await styleDialog({
      title: t('sd.newTitle'), family: 'paragraph', displayName: t('sd.defaultName'), parent, next: null, auto: directFormatting(c),
      styles: styleOptions(c, 'paragraph'), editor: c.editor, index: IX(c), isNew: true,
    });
    if (!res) return;
    const name = editStyles(c, (st) => createStyle(st, { displayName: res.displayName, family: 'paragraph', parent: res.parent, next: res.next, auto: res.auto }));
    chain(c, clearCharFormatting, clearParagraphFormatting, (s, d) => setParagraphStyle(s, d, IX(c), name));
    done(c);
  },
  async modify(family, name) {
    editStyles(c, (s2) => ensureStyles(s2, family, [name]));
    const st = c.session.state;
    const tree = findStyle(st, family, name);
    if (!tree) return;
    const res = await styleDialog({
      title: t('sd.modifyTitle'), family, displayName: IX(c)?.displayName(family, name) || name,
      parent: tree.a['style:parent-style-name'] || null, next: tree.a['style:next-style-name'] || null, auto: ownFormatting(st, family, name),
      styles: styleOptions(c, family).filter(([n]) => n !== name), editor: c.editor, index: IX(c), isNew: false,
    });
    if (!res) return;
    editStyles(c, (s2) => setStyleFormatting(s2, family, name, res.auto, { displayName: res.displayName, parent: res.parent, next: res.next }));
    done(c);
  },
  update(family, name) {
    const direct = directFormatting(c);
    editStyles(c, (st) => {
      ensureStyles(st, family, [name]);
      if (family === 'text') {
        const tp = direct?.props?.[TP];
        updateStyleToMatch(st, family, name, tp ? { styleAttrs: {}, props: { [TP]: tp } } : null);
      } else updateStyleToMatch(st, family, name, direct);
    });
    if (family === 'paragraph') chain(c, clearCharFormatting, clearParagraphFormatting, (s, d) => setParagraphStyle(s, d, IX(c), name));
    else chain(c, clearCharFormatting, (s, d) => setCharStyle(s, d, name));
    done(c);
  },
  async remove(family, name) {
    if (isBuiltIn(family, name)) { c.ui.toast?.(t('sp.cannotDelete')); return; }
    const ok = await showDialog({ title: t('sp.deleteTitle'), message: t('sp.deleteConfirm', { name: IX(c)?.displayName(family, name) || name }), buttons: [{ label: t('common.yes'), value: true, primary: true }, { label: t('common.no'), value: false }], cancelValue: false });
    if (!ok) return;
    const fallback = editStyles(c, (st) => deleteStyle(st, family, name));
    if (fallback === false) return;
    // Re-point everything that used it.
    const view = V(c);
    const tr = view.state.tr;
    view.state.doc.descendants((node, pos) => {
      if (family === 'paragraph' && node.isTextblock && node.attrs.styleName === name) tr.setNodeMarkup(pos, null, { ...node.attrs, styleName: fallback });
      if (family === 'text' && node.isText) {
        const m = node.marks.find((x) => x.type === schema.marks.charStyle && x.attrs.name === name);
        if (m) tr.removeMark(pos, pos + node.nodeSize, m);
      }
      return true;
    });
    if (tr.docChanged) view.dispatch(tr);
  },
  clearAll: () => clearAllFormatting(c),
});

function clearAllFormatting(c) {
  chain(c, clearCharFormatting, clearParagraphFormatting, (s, d) => setParagraphStyle(s, d, IX(c), 'Standard'));
  done(c);
}

// Select
function selectSimilar(c) {
  const view = V(c);
  const st = view.state;
  const ix = IX(c);
  const KEYS = ['style:font-name', 'fo:font-size', 'fo:font-weight', 'fo:font-style', 'fo:color', 'style:text-underline-style', 'fo:background-color', 'style:text-line-through-style', 'style:text-position'];
  const sig = (p) => KEYS.map((k) => p[k] ?? '').join('|');
  const target = sig(textPropsAtSelection(st, ix));
  const pairs = [];
  st.doc.descendants((node, pos, parent) => {
    if (!node.isText) return true;
    if (sig(effectiveOf(ix, parent, node.marks)) !== target) return false;
    const last = pairs.at(-1);
    if (last && last[1] === pos) last[1] = pos + node.nodeSize; else pairs.push([pos, pos + node.nodeSize]);
    return false;
  });
  if (!pairs.length) return;
  view.dispatch(st.tr.setSelection(MultiRangeSelection.create(st.doc, pairs)));
  done(c);
}

function selectObjects(c) {
  const view = V(c);
  const st = view.state;
  const frames = [];
  st.doc.descendants((node, pos) => { if (node.type === schema.nodes.frame) frames.push(pos); return true; });
  if (!frames.length) { c.ui.toast?.(t('home.noObjects')); return; }
  const cur = st.selection instanceof NodeSelection ? st.selection.from : -1;
  const next = frames.find((p) => p > cur) ?? frames[0];
  view.dispatch(st.tr.setSelection(NodeSelection.create(st.doc, next)).scrollIntoView());
  done(c);
}

async function applyStylesDialog(c) {
  const opts = [...styleOptions(c, 'paragraph').map(([n, d]) => ['paragraph', n, d]), ...styleOptions(c, 'text').map(([n, d]) => ['text', n, d])];
  const cur = formatAt(c).node?.attrs.styleName;
  const input = text(IX(c)?.displayName('paragraph', cur) || '', { list: 'as-styles' });
  const list = h('datalist', { id: 'as-styles' }, opts.map(([, , d]) => h('option', { value: d })));
  const ok = await showDialog({ title: t('cmd.home.applyStylesDialog').replace(/…$/, ''), message: h('div', {}, list, field(t('sd.styleName'), input, { wide: true })), buttons: [{ label: t('sd.reapply'), value: true, primary: true }, { label: t('common.cancel'), value: false }], cancelValue: false });
  if (!ok) return;
  const hit = opts.find(([, n, d]) => d.toLowerCase() === input.value.trim().toLowerCase() || n === input.value.trim());
  if (hit) useStyle(c, hit[0], hit[1]); else c.ui.toast?.(t('sd.noSuchStyle'));
}

async function pasteSpecial(c) {
  const sel = select([['keep', t('cmd.home.pasteKeepSource')], ['merge', t('cmd.home.pasteMerge')], ['text', t('cmd.home.pasteTextOnly')]], 'keep');
  const ok = await showDialog({ title: t('cmd.home.pasteSpecial').replace(/…$/, ''), message: h('div', {}, field(t('home.pasteAs'), sel, { wide: true })), buttons: [{ label: t('common.ok'), value: true, primary: true }, { label: t('common.cancel'), value: false }], cancelValue: false });
  if (ok) c.clipboard.paste(sel.value);
}

async function setDefaultPaste(c) {
  const opts = [['keep', t('cmd.home.pasteKeepSource')], ['merge', t('cmd.home.pasteMerge')], ['text', t('cmd.home.pasteTextOnly')]];
  const within = select(opts, getSetting('pasteWithin') || 'keep');
  const other = select(opts, getSetting('pasteOther') || 'keep');
  const ok = await showDialog({
    title: t('cmd.home.setDefaultPaste').replace(/…$/, ''),
    message: h('div', {}, field(t('home.pasteWithin'), within, { wide: true }), field(t('home.pasteOther'), other, { wide: true })),
    buttons: [{ label: t('common.ok'), value: true, primary: true }, { label: t('common.cancel'), value: false }], cancelValue: false,
  });
  if (ok) { setSetting('pasteWithin', within.value); setSetting('pasteOther', other.value); }
}

const colourCmd = (stateKey, apply, extra = {}) => ({
  isEnabled: canEdit,
  run: (c, colour) => {
    const col = typeof colour === 'string' ? colour : c.state[stateKey];
    if (typeof colour === 'string') c.store.set({ [stateKey]: colour });
    apply(c, col);
  },
  repeatable: true,
  ...extra,
});

function ensureFontFace(docState, name) {
  docState.fontFaces = docState.fontFaces || [];
  if (docState.fontFaces.some((f) => f.a['style:name'] === name)) return;
  docState.fontFaces = [...docState.fontFaces, { n: 'style:font-face', a: { 'style:name': name, 'svg:font-family': /[\s,]/.test(name) ? `'${name}'` : name } }];
}

// ------------------------------------------------------------ commands

export const commands = defineCommands('home', {
  // Clipboard
  paste: { icon: 'paste', shortcutHint: 'Mod-v', isEnabled: canEdit, run: (ctx) => ctx.clipboard.paste() },
  pasteKeepSource: { icon: 'paste-keep', isEnabled: canEdit, run: (c) => c.clipboard.paste('keep') },
  pasteMerge: { icon: 'paste-merge', isEnabled: canEdit, run: (c) => c.clipboard.paste('merge') },
  pasteTextOnly: { icon: 'paste-text', isEnabled: canEdit, run: (c) => c.clipboard.paste('text') },
  pasteSpecial: { isEnabled: canEdit, run: pasteSpecial },
  setDefaultPaste: { run: setDefaultPaste },
  cut: { icon: 'cut', shortcutHint: 'Mod-x', isEnabled: (ctx) => ctx.state.hasSelection && canEdit(ctx), run: (ctx) => ctx.clipboard.cut() },
  copy: { icon: 'copy', shortcutHint: 'Mod-c', run: (ctx) => ctx.clipboard.copy() },
  formatPainter: { icon: 'format-painter', shortcut: 'Mod-Shift-c', isEnabled: canEdit, isChecked: (c) => !!c.state.formatPainter, run: (c) => c.ui.painter.toggle() },
  clipboardPane: { icon: 'clipboard' },
  // Font
  fontName: {
    icon: 'type', keywords: ['font', 'typeface'], isEnabled: canEdit, repeatable: true,
    run: (c, name) => {
      if (typeof name !== 'string') { document.querySelector('.rb-combo.font .rb-combo-input')?.focus(); return; }
      ensureFontFace(c.session.state, name);
      textChange(c, { 'style:font-name': name, 'fo:font-family': null, 'style:font-family-generic': null, 'style:font-pitch': null });
    },
  },
  fontSize: {
    icon: 'type', isEnabled: canEdit, repeatable: true,
    run: (c, n) => {
      if (!(Number(n) > 0)) { document.querySelector('.rb-combo.size .rb-combo-input')?.focus(); return; }
      const v = `${Math.round(Number(n) * 2) / 2}pt`;
      textChange(c, { 'fo:font-size': v, 'style:font-size-asian': v, 'style:font-size-complex': v });
    },
  },
  growFont: { icon: 'grow-font', shortcut: 'Mod-]', isEnabled: canEdit, repeatable: true, run: (c) => textChange(c, (p) => ({ 'fo:font-size': `${nextSize(sizePt(p['fo:font-size']), 1)}pt` })) },
  shrinkFont: { icon: 'shrink-font', shortcut: 'Mod-[', isEnabled: canEdit, repeatable: true, run: (c) => textChange(c, (p) => ({ 'fo:font-size': `${nextSize(sizePt(p['fo:font-size']), -1)}pt` })) },
  changeCase: { icon: 'change-case', shortcut: 'Shift-F3', isEnabled: canEdit, run: (c) => { changeCase(V(c).state, V(c).dispatch, 'cycle'); done(c); } },
  caseSentence: { isEnabled: canEdit, repeatable: true, run: (c) => { changeCase(V(c).state, V(c).dispatch, 'sentence'); done(c); } },
  caseLower: { isEnabled: canEdit, repeatable: true, run: (c) => { changeCase(V(c).state, V(c).dispatch, 'lower'); done(c); } },
  caseUpper: { isEnabled: canEdit, repeatable: true, run: (c) => { changeCase(V(c).state, V(c).dispatch, 'upper'); done(c); } },
  caseCapitalize: { isEnabled: canEdit, repeatable: true, run: (c) => { changeCase(V(c).state, V(c).dispatch, 'capitalize'); done(c); } },
  caseToggle: { isEnabled: canEdit, repeatable: true, run: (c) => { changeCase(V(c).state, V(c).dispatch, 'toggle'); done(c); } },
  clearFormatting: { icon: 'clear-formatting', isEnabled: canEdit, repeatable: true, run: clearAllFormatting },
  clearCharacterFormatting: { shortcut: 'Mod-Space', isEnabled: canEdit, repeatable: true, run: (c) => { clearCharFormatting(V(c).state, V(c).dispatch); done(c); } },
  phoneticGuide: { icon: 'phonetic-guide' },
  bold: { icon: 'bold', shortcut: 'Mod-b', ...toggle('b', isBold, three('font-weight', 'bold'), three('font-weight', 'normal')) },
  italic: { icon: 'italic', shortcut: 'Mod-i', ...toggle('i', isItalic, three('font-style', 'italic'), three('font-style', 'normal')) },
  underline: { icon: 'underline', shortcut: 'Mod-u', ...toggle('u', hasUnderline, UNDERLINES.single, NO_UNDERLINE) },
  underlineDouble: toggle('ud', (p) => p['style:text-underline-type'] === 'double', UNDERLINES.double, NO_UNDERLINE),
  underlineThick: toggle('ut', (p) => hasUnderline(p) && p['style:text-underline-width'] === 'bold', UNDERLINES.thick, NO_UNDERLINE),
  underlineDotted: toggle('udo', (p) => p['style:text-underline-style'] === 'dotted', UNDERLINES.dotted, NO_UNDERLINE),
  underlineDashed: toggle('uda', (p) => p['style:text-underline-style'] === 'dash', UNDERLINES.dashed, NO_UNDERLINE),
  underlineWave: toggle('uw', (p) => p['style:text-underline-style'] === 'wave', UNDERLINES.wave, NO_UNDERLINE),
  underlineMore: { isEnabled: canEdit, run: (c) => fontDialog({ editor: c.editor, index: IX(c) }) },
  underlineColour: colourCmd('lastUnderlineColour', (c, col) => textChange(c, (p) => ({ ...(hasUnderline(p) ? {} : UNDERLINES.single), 'style:text-underline-color': col }))),
  strikethrough: { icon: 'strikethrough', ...toggle('s', isStrike, { 'style:text-line-through-style': 'solid', 'style:text-line-through-type': null }, { 'style:text-line-through-style': 'none', 'style:text-line-through-type': null }) },
  subscript: { icon: 'subscript', shortcut: 'Mod-=', ...toggle('sub', isSub, { 'style:text-position': 'sub 58%' }, { 'style:text-position': null }) },
  superscript: { icon: 'superscript', shortcut: 'Mod-Shift-=', ...toggle('sup', isSup, { 'style:text-position': 'super 58%' }, { 'style:text-position': null }) },
  characterBorder: { icon: 'char-border', ...toggle('cb', isBorder, { 'fo:border': LINE, 'fo:padding': '0.049cm' }, { 'fo:border': 'none', 'fo:padding': null }) },
  enclosedCharacters: { icon: 'enclosed-char' },
  textEffects: { icon: 'text-effects', menuOnly: true },
  textOutline: toggle('to', (p) => p['style:text-outline'] === 'true', { 'style:text-outline': 'true' }, { 'style:text-outline': 'false' }),
  textShadow: toggle('ts', (p) => !!p['fo:text-shadow'] && p['fo:text-shadow'] !== 'none', { 'fo:text-shadow': '1pt 1pt' }, { 'fo:text-shadow': 'none' }),
  textGlow: {},
  highlight: { icon: 'highlight', ...colourCmd('lastHighlight', (c, col) => textChange(c, { 'fo:background-color': col })) },
  highlightNone: { isEnabled: canEdit, repeatable: true, run: (c) => textChange(c, { 'fo:background-color': 'transparent' }) },
  fontColour: { icon: 'font-colour', ...colourCmd('lastFontColour', (c, col) => textChange(c, { 'fo:color': col })) },
  fontColourAuto: { isEnabled: canEdit, repeatable: true, run: (c) => textChange(c, { 'fo:color': null, 'style:use-window-font-color': 'true' }) },
  fontColourMore: { isEnabled: canEdit, run: async (c) => { const col = await moreColoursDialog(c.state.lastFontColour); if (col) c.ui.registry.run('home.fontColour', col); } },
  fontDialog: { icon: 'type', shortcut: 'Mod-d', isEnabled: canEdit, run: (c) => fontDialog({ editor: c.editor, index: IX(c) }) },
  // Paragraph
  bullets: listCmd('bullet', 'bullets'),
  numbering: listCmd('number', 'numbering'),
  multilevel: listCmd('multilevel', 'multilevel'),
  defineBullet: { isEnabled: canEdit, run: async (c) => { const l = await defineListDialog('bullet'); if (l) applyList(c, 'bullet', l, true); } },
  defineNumber: { isEnabled: canEdit, run: async (c) => { const l = await defineListDialog('number'); if (l) applyList(c, 'number', l, true); } },
  defineMultilevel: { isEnabled: canEdit, run: async (c) => { const l = await defineListDialog('multilevel'); if (l) applyList(c, 'multilevel', l, true); } },
  restartNumbering: { isEnabled: (c) => canEdit(c) && !!listAt(V(c).state), run: (c) => { restartNumbering(V(c).state, V(c).dispatch, 1); done(c); } },
  continueNumbering: { isEnabled: (c) => canEdit(c) && !!listAt(V(c).state), run: (c) => { continueNumbering(V(c).state, V(c).dispatch); done(c); } },
  setNumberingValue: { isEnabled: (c) => canEdit(c) && !!listAt(V(c).state), run: async (c) => { const v = await numberValueDialog(); if (v) { restartNumbering(V(c).state, V(c).dispatch, v); done(c); } } },
  decreaseIndent: { icon: 'indent-decrease', shortcut: 'Mod-Shift-m', isEnabled: canEdit, repeatable: true, run: (c) => indentBy(c, -1) },
  increaseIndent: { icon: 'indent-increase', shortcut: 'Mod-m', isEnabled: canEdit, repeatable: true, run: (c) => indentBy(c, 1) },
  sort: { icon: 'sort', isEnabled: canEdit, run: (c) => sortDialog({ editor: c.editor }) },
  showMarks: {
    icon: 'pilcrow', shortcut: 'Mod-Shift-8', keywords: ['formatting marks', 'pilcrow'], isChecked: (c) => !!c.state.showMarks,
    run: (c) => { const on = !c.state.showMarks; c.store.set({ showMarks: on }); V(c).dispatch(V(c).state.tr.setMeta(marksKey, on).setMeta('addToHistory', false)); },
  },
  alignLeft: { icon: 'align-left', shortcut: 'Mod-l', ...alignCmd('start') },
  alignCentre: { icon: 'align-centre', shortcut: 'Mod-e', ...alignCmd('center') },
  alignRight: { icon: 'align-right', shortcut: 'Mod-r', ...alignCmd('end') },
  justify: { icon: 'justify', shortcut: 'Mod-j', ...alignCmd('justify') },
  ltr: { icon: 'ltr', isEnabled: canEdit, isChecked: (c) => !!c.editor && formatAt(c).para['style:writing-mode'] !== 'rl-tb', run: (c) => paraChange(c, { 'style:writing-mode': null, ...(alignOf(formatAt(c).para) === 'end' && formatAt(c).para['style:writing-mode'] === 'rl-tb' ? { 'fo:text-align': null } : {}) }) },
  rtl: { icon: 'rtl', isEnabled: canEdit, isChecked: (c) => !!c.editor && formatAt(c).para['style:writing-mode'] === 'rl-tb', run: (c) => paraChange(c, { 'style:writing-mode': 'rl-tb', ...(alignOf(formatAt(c).para) === 'start' ? { 'fo:text-align': 'end' } : {}) }) },
  lineSpacing: { icon: 'line-spacing', menuOnly: true },
  lineSpacing1: spacingCmd('100%', 'Mod-1'),
  lineSpacing115: spacingCmd('115%'),
  lineSpacing15: spacingCmd('150%', 'Mod-5'),
  lineSpacing2: spacingCmd('200%', 'Mod-2'),
  lineSpacing25: spacingCmd('250%'),
  lineSpacing3: spacingCmd('300%'),
  lineSpacingOptions: { isEnabled: canEdit, run: (c) => paragraphDialog({ editor: c.editor, index: IX(c), openTabs: () => tabsDialog({ editor: c.editor, index: IX(c) }) }) },
  addSpaceBefore: { isEnabled: canEdit, isChecked: (c) => !!c.editor && parseFloat(formatAt(c).para['fo:margin-top'] || '0') > 0, run: (c) => paraChange(c, { 'fo:margin-top': parseFloat(formatAt(c).para['fo:margin-top'] || '0') > 0 ? '0cm' : '12pt' }) },
  removeSpaceAfter: { isEnabled: canEdit, run: (c) => paraChange(c, { 'fo:margin-bottom': parseFloat(formatAt(c).para['fo:margin-bottom'] || '0') > 0 ? '0cm' : '8pt' }) },
  shading: { icon: 'shading', ...colourCmd('lastShading', (c, col) => paraChange(c, { 'fo:background-color': col })) },
  shadingNone: { isEnabled: canEdit, run: (c) => paraChange(c, { 'fo:background-color': 'transparent' }) },
  borders: { icon: 'borders', isEnabled: canEdit, run: (c) => c.ui.registry.run(c.state.lastBorder || 'home.borderBottom') },
  borderBottom: borderCmd('bottom', 'border-bottom'),
  borderTop: borderCmd('top', 'border-top'),
  borderLeft: borderCmd('left', 'border-left'),
  borderRight: borderCmd('right', 'border-right'),
  borderNone: { icon: 'border-none', isEnabled: canEdit, run: (c) => setBorders(c, { top: false, bottom: false, left: false, right: false }) },
  borderAll: { icon: 'borders', isEnabled: canEdit, run: (c) => setBorders(c, { top: true, bottom: true, left: true, right: true }) },
  borderOutside: { icon: 'border-outside', isEnabled: canEdit, run: (c) => setBorders(c, { top: true, bottom: true, left: true, right: true }) },
  horizontalLine: {
    isEnabled: canEdit,
    run: (c) => {
      const view = V(c);
      const block = selectedTextblocks(view.state).at(-1);
      if (!block) return;
      const at = block.pos + block.node.nodeSize;
      const line = schema.nodes.paragraph.create({ styleName: 'Standard', auto: { styleAttrs: {}, props: { [PP]: { a: { 'fo:border-bottom': '1.1pt solid #a0a0a0', 'fo:padding-bottom': '0.035cm', 'fo:margin-bottom': '0.212cm', 'fo:line-height': '50%' } } } } });
      view.dispatch(view.state.tr.insert(at, line).scrollIntoView());
      done(c);
    },
  },
  bordersAndShading: { isEnabled: canEdit, run: (c) => bordersDialog({ editor: c.editor, index: IX(c) }) },
  paragraphDialog: { icon: 'pilcrow', isEnabled: canEdit, run: (c) => paragraphDialog({ editor: c.editor, index: IX(c), openTabs: () => tabsDialog({ editor: c.editor, index: IX(c) }) }) },
  clearParagraphFormatting: { shortcut: 'Mod-q', isEnabled: canEdit, repeatable: true, run: (c) => { clearParagraphFormatting(V(c).state, V(c).dispatch); done(c); } },
  // Paragraph Tools
  paragraphTools: { icon: 'paragraph-tools', menuOnly: true },
  tabsDialog: { isEnabled: canEdit, run: (c) => tabsDialog({ editor: c.editor, index: IX(c) }) },
  keepWithNext: paraToggle('fo:keep-with-next', 'always'),
  keepLinesTogether: paraToggle('fo:keep-together', 'always'),
  pageBreakBefore: paraToggle('fo:break-before', 'page'),
  // Styles
  applyStyle: {
    keywords: ['style'], isEnabled: canEdit,
    run: (c, item) => {
      if (!item) return applyStylesDialog(c);
      const [family, name] = typeof item === 'string' ? (GALLERY_STYLES[item] || ['paragraph', item]) : [item.family, item.name];
      return useStyle(c, family, name);
    },
  },
  styleNormal: { shortcut: 'Mod-Shift-n', isEnabled: canEdit, run: (c) => useStyle(c, 'paragraph', 'Standard') },
  styleHeading1: { shortcut: 'Mod-Alt-1', isEnabled: canEdit, run: (c) => useStyle(c, 'paragraph', 'Heading_20_1') },
  styleHeading2: { shortcut: 'Mod-Alt-2', isEnabled: canEdit, run: (c) => useStyle(c, 'paragraph', 'Heading_20_2') },
  styleHeading3: { shortcut: 'Mod-Alt-3', isEnabled: canEdit, run: (c) => useStyle(c, 'paragraph', 'Heading_20_3') },
  stylesPane: { icon: 'styles-pane', shortcut: 'Mod-Alt-Shift-s', isChecked: (c) => !!c.state.stylesPane, run: (c) => c.ui.stylesPane.toggle() },
  createStyle: { isEnabled: canEdit, run: (c) => styleActions(c).create() },
  clearStyle: { isEnabled: canEdit, run: clearAllFormatting },
  applyStylesDialog: { isEnabled: canEdit, run: applyStylesDialog },
  // Editing
  find: { icon: 'find', shortcut: 'Mod-f', run: (c) => { const s = V(c).state; const q = s.selection.empty ? null : s.doc.textBetween(s.selection.from, s.selection.to, ' ').slice(0, 200); c.ui.nav.open({ focusSearch: true, query: q && !q.includes('\n') ? q : null }); } },
  advancedFind: { run: (c) => c.ui.findDialog.open('find') },
  goTo: { shortcut: 'Mod-g', run: (c) => c.ui.findDialog.open('goto') },
  replace: { icon: 'replace', shortcut: 'Mod-h', isEnabled: canEdit, run: (c) => c.ui.findDialog.open('replace') },
  select: { icon: 'draw-select', menuOnly: true },
  selectAll: { shortcutHint: 'Mod-a', run: (ctx) => { ctx.editor.selectAll(); ctx.editor.focus(); } },
  selectObjects: { run: selectObjects },
  selectSimilar: { run: selectSimilar },
  // Voice & Editor
  dictate: { icon: 'dictate', isEnabled: (c) => dictationSupported() && canEdit(c), isChecked: (c) => !!c.state.dictating, run: (c) => c.ui.dictation.toggle() },
  editor: { icon: 'editor' },
});

const colour = (cmd) => ({ custom: 'colourPalette', cmd });

export const ribbon = {
  id: 'home',
  keytip: 'H',
  groups: [
    {
      id: 'clipboard', icon: 'paste', launcher: 'clipboardPane',
      controls: [
        { t: 'large', cmd: 'paste', split: true, menu: [{ header: 'menu.pasteOptions' }, 'pasteKeepSource', 'pasteMerge', 'pasteTextOnly', '-', 'pasteSpecial', 'setDefaultPaste'] },
        { t: 'col', items: [{ cmd: 'cut' }, { cmd: 'copy' }, { cmd: 'formatPainter', label: 'label.home.format' }] },
      ],
    },
    {
      id: 'font', icon: 'font-colour', launcher: 'fontDialog',
      controls: [{
        t: 'rows', rows: [
          [
            { t: 'combo', cmd: 'fontName', kind: 'font', width: 145 },
            { t: 'combo', cmd: 'fontSize', kind: 'size', width: 48 },
            { cmd: 'growFont' }, { cmd: 'shrinkFont' },
            { cmd: 'changeCase', menu: ['caseSentence', 'caseLower', 'caseUpper', 'caseCapitalize', 'caseToggle'] },
            { cmd: 'clearFormatting' }, { cmd: 'phoneticGuide' },
          ],
          [
            { cmd: 'bold' }, { cmd: 'italic' },
            { cmd: 'underline', split: true, menu: ['underline', 'underlineDouble', 'underlineThick', 'underlineDotted', 'underlineDashed', 'underlineWave', '-', 'underlineMore', { cmd: 'underlineColour', sub: [colour('underlineColour')] }] },
            { cmd: 'strikethrough' }, { cmd: 'subscript' }, { cmd: 'superscript' },
            { cmd: 'characterBorder' }, { cmd: 'enclosedCharacters' },
            { cmd: 'textEffects', menu: ['textOutline', 'textShadow', 'textGlow'], gap: true },
            { cmd: 'highlight', split: true, menu: [{ custom: 'highlightPalette', cmd: 'highlight' }, '-', 'highlightNone'] },
            { cmd: 'fontColour', split: true, menu: ['fontColourAuto', colour('fontColour'), '-', 'fontColourMore'] },
          ],
        ],
      }],
    },
    {
      id: 'paragraph', icon: 'pilcrow', launcher: 'paragraphDialog',
      controls: [{
        t: 'rows', rows: [
          [
            { cmd: 'bullets', split: true, menu: [{ custom: 'bulletLibrary' }, '-', 'defineBullet'] },
            { cmd: 'numbering', split: true, menu: [{ custom: 'numberLibrary' }, '-', 'defineNumber', 'setNumberingValue'] },
            { cmd: 'multilevel', menu: [{ custom: 'multilevelLibrary' }, '-', 'defineMultilevel'] },
            { cmd: 'decreaseIndent', gap: true }, { cmd: 'increaseIndent' },
            { cmd: 'sort', gap: true }, { cmd: 'showMarks' },
          ],
          [
            { cmd: 'alignLeft' }, { cmd: 'alignCentre' }, { cmd: 'alignRight' }, { cmd: 'justify' },
            { cmd: 'ltr', gap: true }, { cmd: 'rtl' },
            { cmd: 'lineSpacing', menu: ['lineSpacing1', 'lineSpacing115', 'lineSpacing15', 'lineSpacing2', 'lineSpacing25', 'lineSpacing3', '-', 'lineSpacingOptions', '-', 'addSpaceBefore', 'removeSpaceAfter'], gap: true },
            { cmd: 'shading', split: true, menu: [colour('shading'), '-', 'shadingNone'] },
            { cmd: 'borders', split: true, menu: ['borderBottom', 'borderTop', 'borderLeft', 'borderRight', '-', 'borderNone', 'borderAll', 'borderOutside', '-', 'horizontalLine', 'bordersAndShading'] },
          ],
        ],
      }],
    },
    {
      id: 'paragraphTools', icon: 'paragraph-tools',
      controls: [{ t: 'large', cmd: 'paragraphTools', menu: ['paragraphDialog', 'tabsDialog', 'bordersAndShading', '-', 'keepWithNext', 'keepLinesTogether', 'pageBreakBefore', '-', 'clearParagraphFormatting'] }],
    },
    {
      id: 'styles', icon: 'styles-pane', launcher: 'stylesPane',
      controls: [{ t: 'gallery', id: 'styles', cmd: 'applyStyle', menu: ['createStyle', 'clearStyle', 'applyStylesDialog'] }],
    },
    {
      id: 'editing', icon: 'find',
      controls: [{
        t: 'col', items: [
          { cmd: 'find', split: true, menu: ['find', 'advancedFind', 'goTo'] },
          { cmd: 'replace' },
          { cmd: 'select', menu: ['selectAll', 'selectObjects', 'selectSimilar', '-', 'layout.selectionPane'] },
        ],
      }],
    },
    { id: 'voice', icon: 'dictate', controls: [{ t: 'large', cmd: 'dictate' }] },
    { id: 'editorGroup', icon: 'editor', controls: [{ t: 'large', cmd: 'editor' }] },
  ],
};

export function register(registry) { registry.register(commands); }
