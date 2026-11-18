/** Layout tab: Page Setup, Paragraph (indent/spacing spins), Arrange. */
import { NodeRange } from 'prosemirror-model';
import { defineCommands } from '../define.js';
import { schema } from '../../core/schema.js';
import { editState } from '../../core/state-step.js';
import {
  PAGE_SIZES, MARGIN_PRESETS, pageProps, findMaster, findLayout, newSectionMaster, setSectionStyle, sectionColumnInfo,
  lineNumbering, setLineNumbering, hyphenation, setHyphenation, bodyMargins, hfExtent, hasPart, partOptions, setPartOptions,
} from '../../core/page-setup.js';
import { sections, currentSection, changePages, masterChain, PAGE_KEYS, bodyView } from './sections.js';
import { selectedTextblocks, setParagraphAttrs, effectiveParagraphProps } from '../../core/commands/paragraph.js';
import { cellProps, updateCells, changeAuto, nodeAuto } from '../../core/commands/tables.js';
import { pageSetupDialog, columnsDialog, lineNumbersDialog, hyphenationDialog } from '../../ui/layout-dialogs.js';
import { toPx } from '../../layout/units.js';

const objectSelected = (ctx) => !!ctx.state.objectSelected;
const canEdit = (c) => !!c.editor && c.state.editingMode !== 'viewing';
// Page and section commands act on the body; paragraph ones on the active editor (body or header/footer).
const V = (c) => bodyView(c);
const AV = (c) => c.editor.view;
const canEditBody = (c) => canEdit(c) && !c.state.hfEditing;
const CM = 96 / 2.54;
const cmv = (v) => `${+v.toFixed(3)}cm`;
const near = (a, b, tol = 0.05) => Math.abs(a - b) < tol;
const lenCm = (v, d) => (v ? (toPx(v) || 0) / CM : d);

/** Page properties of the current section, with Word-style (body) top/bottom margins. */
function current(c) {
  const st = c.session.state;
  const sec = currentSection(c);
  const p = pageProps(st, sec.master);
  const master = findMaster(st, sec.master);
  const layout = findLayout(st, master?.a['style:page-layout-name']);
  const e = hfExtent(layout);
  const top = lenCm(p['fo:margin-top'], 2) + (hasPart(master, 'header') ? e.headerMin + e.headerGap : 0);
  const bottom = lenCm(p['fo:margin-bottom'], 2) + (hasPart(master, 'footer') ? e.footerMin + e.footerGap : 0);
  return { p, sec, master, layout, top, bottom, left: lenCm(p['fo:margin-left'], 2), right: lenCm(p['fo:margin-right'], 2), width: lenCm(p['fo:page-width'], 21), height: lenCm(p['fo:page-height'], 29.7) };
}

const setMargins = (c, m) => changePages(c, (a, layout, users) => ({
  attrs: { ...bodyMargins(layout, users, { top: m.top, bottom: m.bottom }), 'fo:margin-left': cmv(m.left), 'fo:margin-right': cmv(m.right) },
  usage: m.mirrored ? 'mirrored' : 'all',
}), { whole: sections(c).length === 1 });

const marginCmd = (key) => ({
  isEnabled: canEdit,
  isChecked: (c) => { if (!c.ui.docArea?.model) return false; const k = current(c); const m = MARGIN_PRESETS[key]; return near(k.top, m.top) && near(k.bottom, m.bottom) && near(k.left, m.left) && near(k.right, m.right) && (k.p.usage === 'mirrored') === !!m.mirrored; },
  run: (c) => setMargins(c, MARGIN_PRESETS[key]),
});

function setSize(c, w, h, orientation = null) {
  const k = current(c);
  const land = orientation ? orientation === 'landscape' : k.width > k.height;
  const [W, H] = land ? [Math.max(w, h), Math.min(w, h)] : [Math.min(w, h), Math.max(w, h)];
  changePages(c, () => ({ attrs: { 'fo:page-width': cmv(W), 'fo:page-height': cmv(H), 'style:print-orientation': land ? 'landscape' : 'portrait' } }), { whole: sections(c).length === 1 });
}
const sizeCmd = (key) => ({
  isEnabled: canEdit,
  isChecked: (c) => { if (!c.ui.docArea?.model) return false; const k = current(c); const [w, h] = PAGE_SIZES[key]; return near(Math.min(k.width, k.height), w, 0.1) && near(Math.max(k.width, k.height), h, 0.1); },
  run: (c) => setSize(c, ...PAGE_SIZES[key]),
});
const orientCmd = (o) => ({
  isEnabled: canEdit,
  isChecked: (c) => { if (!c.ui.docArea?.model) return false; const k = current(c); return o === 'landscape' ? k.width > k.height : k.width <= k.height; },
  run: (c) => { const k = current(c); setSize(c, k.width, k.height, o); },
});

// ------------------------------------------------------------ columns

/** The top-level section node around the selection head: { node, pos } or null. */
function sectionNodeAt(state) {
  const $h = state.selection.$head;
  for (let d = 1; d <= $h.depth; d++) if ($h.node(d).type === schema.nodes.section) return { node: $h.node(d), pos: $h.before(d) };
  return null;
}

function sectionColumnsAt(c) {
  const s = sectionNodeAt(V(c).state);
  if (s) {
    const tree = c.session.state.contentAutoStyles.find((x) => x.n === 'style:style' && x.a['style:family'] === 'section' && x.a['style:name'] === s.node.attrs.styleName);
    return { ...sectionColumnInfo(tree), section: s };
  }
  const k = c.ui.docArea?.model ? current(c) : null;
  return { count: k?.p.columns || 1, gap: null, separator: false, widths: [], section: null };
}

const uniqueSectionName = (doc) => {
  const names = new Set();
  doc.descendants((n) => { if (n.type === schema.nodes.section) names.add(n.attrs.name); return true; });
  let i = 1;
  while (names.has(`Section${i}`)) i++;
  return `Section${i}`;
};

/** Applies columns (Word: to the selection, the current section, or from here on), using text:section. */
export function applyColumns(c, cols, applyTo = null) {
  const view = V(c);
  const state = view.state;
  const docState = c.session.state;
  const info = sectionColumnsAt(c);
  const sel = state.selection;
  const mode = applyTo || (!sel.empty ? 'selection' : 'section');
  // Page-level columns (as LibreOffice writes them) stay page-level.
  if (!info.section && mode === 'section' && current(c).p.columns > 1) {
    changePages(c, () => ({ columns: cols.count > 1 ? cols : null }), { whole: sections(c).length === 1 });
    return;
  }
  if (info.section && mode === 'section') {
    const s = info.section;
    let shared = 0;
    state.doc.descendants((n) => { if (n.type === schema.nodes.section && n.attrs.styleName === s.node.attrs.styleName) shared++; return true; });
    editState(view, docState, ['contentAutoStyles'], (st) => { s.newName = setSectionStyle(st, s.node.attrs.styleName, cols, { copy: shared > 1 }); },
      (tr) => { if (s.newName !== s.node.attrs.styleName) tr.setNodeMarkup(s.pos, null, { ...s.node.attrs, styleName: s.newName }); });
    return;
  }
  // Wrap top-level blocks in a new section.
  let from;
  let to;
  if (mode === 'selection') {
    from = sel.$from.index(0);
    to = sel.$to.index(0);
  } else {
    const sec = currentSection(c);
    const startIdx = state.doc.resolve(sec.start).index(0);
    const endIdx = state.doc.resolve(Math.max(sec.start, sec.end - 1)).index(0);
    from = mode === 'forward' ? sel.$head.index(0) : startIdx;
    to = endIdx;
  }
  if (cols.count <= 1 && !info.section) return;
  let a = 0;
  for (let i = 0; i < from; i++) a += state.doc.child(i).nodeSize;
  let b = a;
  for (let i = from; i <= to; i++) b += state.doc.child(i).nodeSize;
  const range = new NodeRange(state.doc.resolve(a), state.doc.resolve(b), 0);
  let styleName;
  editState(view, docState, ['contentAutoStyles'], (st) => { styleName = setSectionStyle(st, null, cols); },
    (tr) => { tr.wrap(range, [{ type: schema.nodes.section, attrs: { name: uniqueSectionName(state.doc), styleName, extra: null } }]); });
}

const COL_PRESETS = {
  columnsOne: { count: 1 }, columnsTwo: { count: 2 }, columnsThree: { count: 3 },
  columnsLeft: { count: 2, widths: [1, 2] }, columnsRight: { count: 2, widths: [2, 1] },
};
const colCmd = (key) => ({
  isEnabled: canEditBody,
  isChecked: (c) => {
    if (!c.editor || !c.ui.docArea?.model) return false;
    const i = sectionColumnsAt(c);
    const p = COL_PRESETS[key];
    if (i.count !== p.count) return false;
    if (p.widths) return i.widths.length === 2 && (p.widths[0] < p.widths[1]) === (i.widths[0] < i.widths[1]);
    return p.count === 1 || !(i.widths.length === 2 && i.widths[0] !== i.widths[1]);
  },
  run: (c) => applyColumns(c, { ...COL_PRESETS[key], gap: 1.25 }),
});

// ------------------------------------------------------------ breaks

/** Splits the paragraph at the selection; `fn(tr, newPos, node)` adjusts the paragraph after the break. */
function splitAndMark(c, fn, { pageKeys = false, stateFn = null } = {}) {
  const view = V(c);
  const run = (tr) => {
    tr.deleteSelection();
    const $p = tr.selection.$from;
    if (!$p.parent.isTextblock) return;
    tr.split($p.pos, 1);
    const newPos = tr.doc.resolve(tr.selection.from).before();
    fn(tr, newPos, tr.doc.nodeAt(newPos));
    tr.scrollIntoView();
  };
  if (stateFn) editState(view, c.session.state, pageKeys ? PAGE_KEYS : [], stateFn, run);
  else { const tr = view.state.tr; run(tr); view.dispatch(tr); }
  c.editor.focus();
}

const withPara = (tr, pos, node, attrs, styleAttrs = null) => {
  const auto = structuredClone(node.attrs.auto) || { styleAttrs: {}, props: {} };
  const pp = auto.props['style:paragraph-properties'] || { a: {} };
  pp.a = { ...pp.a, ...attrs };
  auto.props['style:paragraph-properties'] = pp;
  if (styleAttrs) auto.styleAttrs = { ...(auto.styleAttrs || {}), ...styleAttrs };
  tr.setNodeMarkup(pos, null, { ...node.attrs, auto });
};

function sectionBreak(c, usage) {
  const sec = currentSection(c);
  let name;
  splitAndMark(c, (tr, pos, node) => withPara(tr, pos, node, {}, { 'style:master-page-name': name }), {
    pageKeys: true,
    stateFn: (st) => { name = newSectionMaster(st, masterChain(st, sec.master).at(-1), { usage }); },
  });
}

function continuousBreak(c) {
  const view = V(c);
  const sec = currentSection(c);
  splitAndMark(c, () => {});
  const state = view.state;
  const startIdx = state.selection.$head.index(0);
  const endIdx = state.doc.resolve(Math.max(0, Math.min(state.doc.content.size, view.state.tr.mapping.map(sec.end)) - 1)).index(0);
  let a = 0;
  for (let i = 0; i < startIdx; i++) a += state.doc.child(i).nodeSize;
  let b = a;
  for (let i = startIdx; i <= Math.max(startIdx, endIdx); i++) b += state.doc.child(i).nodeSize;
  const range = new NodeRange(state.doc.resolve(a), state.doc.resolve(b), 0);
  let styleName;
  editState(view, c.session.state, ['contentAutoStyles'], (st) => { styleName = setSectionStyle(st, null, { count: 1 }); },
    (tr) => tr.wrap(range, [{ type: schema.nodes.section, attrs: { name: uniqueSectionName(state.doc), styleName, extra: null } }]));
}

// ------------------------------------------------------------ line numbers / hyphenation

const lnMode = (c) => {
  const ln = lineNumbering(c.session.state);
  if (!ln) return 'none';
  if (ln.restartOnPage) return 'page';
  let restarts = false;
  V(c).state.doc.forEach((n) => { if (n.attrs?.auto?.props?.['style:paragraph-properties']?.a?.['text:line-number']) restarts = true; });
  return restarts ? 'section' : 'continuous';
};

function setLineMode(c, mode, opts = {}) {
  const view = V(c);
  const secs = sections(c);
  editState(view, c.session.state, ['commonStyles'], (st) => {
    setLineNumbering(st, mode === 'none' ? null : { increment: opts.increment || lineNumbering(st)?.increment || 1, restartOnPage: mode === 'page', offset: opts.offset });
  }, (tr) => {
    // Restart at each section: text:line-number on the first paragraph of every section.
    tr.doc.forEach((node, pos) => {
      const a = node.attrs?.auto?.props?.['style:paragraph-properties']?.a;
      const isStart = secs.some((s) => s.start === pos);
      const want = mode === 'section' && isStart ? '1' : null;
      if ((a?.['text:line-number'] ?? null) !== want && node.isTextblock) {
        const auto = structuredClone(node.attrs.auto) || { styleAttrs: {}, props: {} };
        const pp = auto.props['style:paragraph-properties'] || { a: {} };
        if (want) pp.a['text:line-number'] = want; else delete pp.a['text:line-number'];
        if (Object.keys(pp.a).length) auto.props['style:paragraph-properties'] = pp; else delete auto.props['style:paragraph-properties'];
        tr.setNodeMarkup(pos, null, { ...node.attrs, auto: Object.keys(auto.props).length || Object.keys(auto.styleAttrs || {}).length ? auto : null });
      }
    });
  });
}
const lnCmd = (mode) => ({ isEnabled: canEdit, isChecked: (c) => !!c.session?.state && lnMode(c) === mode, run: (c) => setLineMode(c, mode) });

const setHyph = (c, cfg) => editState(V(c), c.session.state, ['commonStyles'], (st) => setHyphenation(st, cfg));

// ------------------------------------------------------------ text direction (table cells)

function cellAt(state) {
  const $h = state.selection.$head;
  for (let d = $h.depth; d > 0; d--) if ($h.node(d).type === schema.nodes.table_cell) return { node: $h.node(d), pos: $h.before(d) };
  return null;
}
const cellMode = (c) => {
  const cell = c.editor && cellAt(V(c).state);
  if (!cell) return null;
  return cellProps(cell.node, c.session.state)['style:writing-mode'] || 'lr-tb';
};
function setCellDirection(c, mode) {
  const v = V(c);
  updateCells(v.state, v.dispatch, c.session.state, (n) => ({ auto: changeAuto(nodeAuto(n, c.session.state, 'table-cell'), 'style:table-cell-properties', { 'style:writing-mode': mode === 'lr-tb' ? null : mode }) }));
}
const dirCmd = (mode) => ({ isEnabled: (c) => canEdit(c) && !!cellAt(V(c).state), isChecked: (c) => cellMode(c) === mode, run: (c) => setCellDirection(c, mode) });

// ------------------------------------------------------------ Page Setup dialog

async function openPageSetup(c, tab = 'margins') {
  const k = current(c);
  const st = c.session.state;
  const opts = partOptions(k.master);
  const res = await pageSetupDialog({ ...k.p, 'fo:margin-top': cmv(k.top), 'fo:margin-bottom': cmv(k.bottom) }, {
    ...opts, headerFromEdge: (toPx(k.p['fo:margin-top'] || '2cm') || 0), footerFromEdge: (toPx(k.p['fo:margin-bottom'] || '2cm') || 0),
  }, tab, { sectionCount: sections(c).length });
  if (!res) return;
  const whole = res.applyTo === 'whole';
  const top = lenCm(res.attrs['fo:margin-top'], 2);
  const bottom = lenCm(res.attrs['fo:margin-bottom'], 2);
  changePages(c, (a, layout, users) => {
    const header = users.some((m) => hasPart(m, 'header'));
    const footer = users.some((m) => hasPart(m, 'footer'));
    const e = hfExtent(layout);
    const attrs = { ...res.attrs };
    const out = { attrs, usage: res.usage };
    // With a header, ODF's top margin is the header's distance from the edge.
    if (header) {
      const edge = (res.headerFromEdge || 0) / CM;
      attrs['fo:margin-top'] = cmv(edge);
      const minH = Math.max(0, top - edge - e.headerGap);
      out.header = { 'fo:min-height': cmv(minH), 'fo:margin-bottom': cmv(top - edge - minH) };
    } else attrs['fo:margin-top'] = cmv(top);
    if (footer) {
      const edge = (res.footerFromEdge || 0) / CM;
      attrs['fo:margin-bottom'] = cmv(edge);
      const minH = Math.max(0, bottom - edge - e.footerGap);
      out.footer = { 'fo:min-height': cmv(minH), 'fo:margin-top': cmv(bottom - edge - minH) };
    } else attrs['fo:margin-bottom'] = cmv(bottom);
    return out;
  }, { whole });
  if (res.firstPage !== opts.firstPage || res.oddEven !== opts.oddEven) {
    const names = whole ? [...new Set(sections(c).flatMap((s) => masterChain(st, s.master)))] : masterChain(st, currentSection(c).master);
    editState(V(c), c.session.state, PAGE_KEYS, (s2) => setPartOptions(s2, names, { firstPage: res.firstPage, oddEven: res.oddEven }));
  }
  c.editor.focus();
}

// ------------------------------------------------------------ paragraph spins

const spinCmd = (key, unit) => ({
  isEnabled: canEdit,
  run: (c, value) => {
    if (!(Number.isFinite(value))) return;
    setParagraphAttrs(AV(c).state, AV(c).dispatch, c.ui.docArea.styleIndex, { [key]: unit === 'cm' ? cmv(value) : `${+value.toFixed(1)}pt` });
  },
});

/** Current paragraph's indents (cm) and spacing (pt) for the spin boxes. */
export function spinValues(c) {
  const node = selectedTextblocks(AV(c).state)[0]?.node;
  const a = node ? effectiveParagraphProps(node, c.ui.docArea.styleIndex).a || {} : {};
  const pt = (v) => (toPx(v || '0pt') || 0) * 72 / 96;
  return {
    'layout.indentLeft': lenCm(a['fo:margin-left'], 0), 'layout.indentRight': lenCm(a['fo:margin-right'], 0),
    'layout.spacingBefore': pt(a['fo:margin-top']), 'layout.spacingAfter': pt(a['fo:margin-bottom']),
  };
}

export const commands = defineCommands('layout', {
  textDirection: { icon: 'text-direction', menuOnly: true },
  textDirectionHorizontal: dirCmd('lr-tb'),
  textDirectionRotate90: dirCmd('tb-rl'),
  textDirectionRotate270: dirCmd('bt-lr'),
  margins: { icon: 'margins', menuOnly: true },
  marginsNormal: marginCmd('normal'),
  marginsNarrow: marginCmd('narrow'),
  marginsModerate: marginCmd('moderate'),
  marginsWide: marginCmd('wide'),
  marginsMirrored: marginCmd('mirrored'),
  marginsCustom: { isEnabled: canEditBody, run: (c) => openPageSetup(c, 'margins') },
  orientation: { icon: 'orientation', menuOnly: true },
  portrait: orientCmd('portrait'),
  landscape: orientCmd('landscape'),
  size: { icon: 'page-size', menuOnly: true },
  sizeA4: sizeCmd('A4'),
  sizeA5: sizeCmd('A5'),
  sizeA3: sizeCmd('A3'),
  sizeLetter: sizeCmd('Letter'),
  sizeLegal: sizeCmd('Legal'),
  sizeB5: sizeCmd('B5'),
  sizeMore: { isEnabled: canEditBody, run: (c) => openPageSetup(c, 'paper') },
  columns: { icon: 'columns', menuOnly: true },
  columnsOne: colCmd('columnsOne'),
  columnsTwo: colCmd('columnsTwo'),
  columnsThree: colCmd('columnsThree'),
  columnsLeft: colCmd('columnsLeft'),
  columnsRight: colCmd('columnsRight'),
  columnsMore: {
    isEnabled: canEditBody,
    run: async (c) => {
      const cur = sectionColumnsAt(c);
      const res = await columnsDialog({ ...cur, gap: cur.gap }, { canSelection: !V(c).state.selection.empty });
      if (res) applyColumns(c, res, res.applyTo);
    },
  },
  breaks: { icon: 'breaks', menuOnly: true },
  breakPage: { isEnabled: canEditBody, run: (c) => splitAndMark(c, (tr, pos, node) => withPara(tr, pos, node, { 'fo:break-before': 'page' })) },
  breakColumn: { isEnabled: canEditBody, run: (c) => splitAndMark(c, (tr, pos, node) => withPara(tr, pos, node, { 'fo:break-before': 'column' })) },
  breakTextWrapping: { isEnabled: canEdit, run: (c) => { const v = AV(c); v.dispatch(v.state.tr.replaceSelectionWith(schema.nodes.hard_break.create({ clear: 'all' })).scrollIntoView()); c.editor.focus(); } },
  breakSectionNext: { isEnabled: canEditBody, run: (c) => sectionBreak(c, null) },
  breakSectionContinuous: { isEnabled: canEditBody, run: continuousBreak },
  breakSectionEven: { isEnabled: canEditBody, run: (c) => sectionBreak(c, 'left') },
  breakSectionOdd: { isEnabled: canEditBody, run: (c) => sectionBreak(c, 'right') },
  lineNumbers: { icon: 'line-numbers', menuOnly: true },
  lineNumbersNone: lnCmd('none'),
  lineNumbersContinuous: lnCmd('continuous'),
  lineNumbersRestartPage: lnCmd('page'),
  lineNumbersRestartSection: lnCmd('section'),
  lineNumbersSuppress: {
    isEnabled: canEdit,
    isChecked: (c) => { const n = c.editor && selectedTextblocks(AV(c).state)[0]?.node; return !!n && effectiveParagraphProps(n, c.ui.docArea.styleIndex).a?.['text:number-lines'] === 'false'; },
    run: (c) => {
      const n = selectedTextblocks(AV(c).state)[0]?.node;
      const off = n && effectiveParagraphProps(n, c.ui.docArea.styleIndex).a?.['text:number-lines'] === 'false';
      setParagraphAttrs(AV(c).state, AV(c).dispatch, c.ui.docArea.styleIndex, { 'text:number-lines': off ? null : 'false' });
    },
  },
  lineNumbersOptions: {
    isEnabled: canEdit,
    run: async (c) => {
      const res = await lineNumbersDialog(lineNumbering(c.session.state));
      if (res) setLineMode(c, res.on ? res.restart : 'none', res);
    },
  },
  hyphenation: { icon: 'hyphenation', menuOnly: true },
  hyphenationNone: { isEnabled: canEdit, isChecked: (c) => !!c.session?.state && !hyphenation(c.session.state).on, run: (c) => setHyph(c, { ...hyphenation(c.session.state), on: false }) },
  hyphenationAuto: { isEnabled: canEdit, isChecked: (c) => !!c.session?.state && hyphenation(c.session.state).on, run: (c) => setHyph(c, { ...hyphenation(c.session.state), on: true }) },
  hyphenationOptions: { isEnabled: canEdit, run: async (c) => { const r = await hyphenationDialog(hyphenation(c.session.state)); if (r) setHyph(c, r); } },
  pageSetupDialog: { icon: 'margins', isEnabled: canEdit, run: (c) => openPageSetup(c, 'margins') },
  indentLeft: { icon: 'indent-increase', ...spinCmd('fo:margin-left', 'cm') },
  indentRight: { icon: 'indent-decrease', ...spinCmd('fo:margin-right', 'cm') },
  spacingBefore: { icon: 'line-spacing', ...spinCmd('fo:margin-top', 'pt') },
  spacingAfter: { icon: 'line-spacing', ...spinCmd('fo:margin-bottom', 'pt') },
  position: { icon: 'position', isEnabled: objectSelected },
  wrapText: { icon: 'wrap-text', isEnabled: objectSelected },
  wrapInline: {},
  wrapSquare: {},
  wrapTight: {},
  wrapTopBottom: {},
  wrapBehind: {},
  wrapInFront: {},
  bringForward: { icon: 'bring-forward', isEnabled: objectSelected },
  bringToFront: {},
  sendBackward: { icon: 'send-backward', isEnabled: objectSelected },
  sendToBack: {},
  selectionPane: { icon: 'selection-pane' },
  align: { icon: 'align-objects', isEnabled: objectSelected },
  group: { icon: 'group', isEnabled: objectSelected },
  ungroup: {},
  rotate: { icon: 'rotate', isEnabled: objectSelected },
  rotateRight: {},
  rotateLeft: {},
  flipVertical: {},
  flipHorizontal: {},
});

export const ribbon = {
  id: 'layout',
  keytip: 'P',
  groups: [
    {
      id: 'pageSetup', icon: 'margins', launcher: 'pageSetupDialog',
      controls: [
        { t: 'large', cmd: 'textDirection', label: 'label.layout.textDirection', menu: ['textDirectionHorizontal', 'textDirectionRotate90', 'textDirectionRotate270'] },
        { t: 'large', cmd: 'margins', menu: ['marginsNormal', 'marginsNarrow', 'marginsModerate', 'marginsWide', 'marginsMirrored', '-', 'marginsCustom'] },
        { t: 'large', cmd: 'orientation', menu: ['portrait', 'landscape'] },
        { t: 'large', cmd: 'size', menu: ['sizeA4', 'sizeA5', 'sizeA3', 'sizeLetter', 'sizeLegal', 'sizeB5', '-', 'sizeMore'] },
        { t: 'large', cmd: 'columns', menu: ['columnsOne', 'columnsTwo', 'columnsThree', 'columnsLeft', 'columnsRight', '-', 'columnsMore'] },
        { t: 'col', items: [
          { cmd: 'breaks', menu: [{ header: 'menu.pageBreaks' }, 'breakPage', 'breakColumn', 'breakTextWrapping', { header: 'menu.sectionBreaks' }, 'breakSectionNext', 'breakSectionContinuous', 'breakSectionEven', 'breakSectionOdd'] },
          { cmd: 'lineNumbers', menu: ['lineNumbersNone', 'lineNumbersContinuous', 'lineNumbersRestartPage', 'lineNumbersRestartSection', 'lineNumbersSuppress', '-', 'lineNumbersOptions'] },
          { cmd: 'hyphenation', menu: ['hyphenationNone', 'hyphenationAuto', '-', 'hyphenationOptions'] },
        ] },
      ],
    },
    {
      id: 'paragraph', icon: 'pilcrow', launcher: 'home.paragraphDialog',
      controls: [
        { t: 'spins', header: 'label.layout.indent', items: [{ cmd: 'indentLeft', label: 'label.layout.left', unit: 'cm', value: 0, step: 0.1, decimals: 1 }, { cmd: 'indentRight', label: 'label.layout.right', unit: 'cm', value: 0, step: 0.1, decimals: 1 }] },
        { t: 'spins', header: 'label.layout.spacing', items: [{ cmd: 'spacingBefore', label: 'label.layout.before', unit: 'pt', value: 0, step: 6, decimals: 0 }, { cmd: 'spacingAfter', label: 'label.layout.after', unit: 'pt', value: 8, step: 6, decimals: 0 }] },
      ],
    },
    {
      id: 'arrange', icon: 'bring-forward',
      controls: [
        { t: 'large', cmd: 'position' },
        { t: 'large', cmd: 'wrapText', label: 'label.layout.wrapText', menu: ['wrapInline', '-', 'wrapSquare', 'wrapTight', 'wrapTopBottom', 'wrapBehind', 'wrapInFront'] },
        { t: 'col', items: [{ cmd: 'bringForward', split: true, menu: ['bringForward', 'bringToFront'] }, { cmd: 'sendBackward', split: true, menu: ['sendBackward', 'sendToBack'] }, { cmd: 'selectionPane' }] },
        { t: 'col', items: [{ cmd: 'align', iconOnly: true, menu: [{ custom: 'alignObjects' }] }, { cmd: 'group', iconOnly: true, menu: ['group', 'ungroup'] }, { cmd: 'rotate', iconOnly: true, menu: ['rotateRight', 'rotateLeft', 'flipVertical', 'flipHorizontal'] }] },
      ],
    },
  ],
};

export function register(registry) { registry.register(commands); }
