/**
 * Formatting dialogs: Font, Paragraph (with Tabs and Borders & Shading),
 * Sort, Define New Bullet / Number Format / Multilevel List, Set Numbering
 * Value, More Colours, New / Modify Style. Each reads the current formatting
 * and applies changes through the formatting commands as one undo step.
 */
import { h } from './dom.js';
import { t } from '../i18n/index.js';
import { showDialog } from './dialog.js';
import { field, text, number, select, check, radios, colour, length, tabs, row, group } from './form.js';
import { textPropsAtSelection, applyTextProps, sizePt, FONT_SIZES, UNDERLINES, NO_UNDERLINE, underlineKind } from '../core/commands/text.js';
import { effectiveParagraphProps, selectedTextblocks, updateParagraphProps } from '../core/commands/paragraph.js';
import { tabStopsOf } from '../layout/tabs.js';
import { toPx, pxToLength } from '../layout/units.js';
import { CURATED_FONTS } from '../layout/fonts.js';
import { BUNDLED_FONTS } from '../config.js';
import { schema } from '../core/schema.js';
import { autoToCss } from '../core/odt/css.js';

const okCancel = [{ label: t('common.ok'), value: true, primary: true }, { label: t('common.cancel'), value: false }];
const cm = (px) => pxToLength(px, 'cm', 3);
const pt = (px) => `${+(px * 72 / 96).toFixed(1)}pt`;

export const fontList = () => [...new Set([...BUNDLED_FONTS, 'Aptos', ...CURATED_FONTS])].sort((a, b) => a.localeCompare(b));

// ------------------------------------------------------------------ Font

const UL_NAMES = [['none', 'fd.ulNone'], ['single', 'fd.ulSingle'], ['double', 'fd.ulDouble'], ['thick', 'fd.ulThick'], ['dotted', 'fd.ulDotted'], ['dashed', 'fd.ulDashed'], ['wave', 'fd.ulWave']];

/** Font dialog. For a style (target 'style') returns the text-property changes instead of applying them. */
export async function fontDialog({ editor, index, initial = null, apply = true }) {
  const view = editor.view;
  const p = initial || textPropsAtSelection(view.state, index);
  const font = text(String(p['style:font-name'] || p['fo:font-family'] || 'Carlito').replace(/^'|'$/g, ''), { list: 'fd-fonts' });
  const fonts = h('datalist', { id: 'fd-fonts' }, fontList().map((f) => h('option', { value: f })));
  const styleSel = select([['regular', t('fd.regular')], ['italic', t('fd.italic')], ['bold', t('fd.bold')], ['boldItalic', t('fd.boldItalic')]],
    `${p['fo:font-weight'] === 'bold' ? 'bold' : ''}${p['fo:font-style'] === 'italic' ? (p['fo:font-weight'] === 'bold' ? 'Italic' : 'italic') : ''}` || 'regular');
  const size = text(String(sizePt(p['fo:font-size'])), { list: 'fd-sizes', class: 'fm-input fm-num' });
  const sizes = h('datalist', { id: 'fd-sizes' }, FONT_SIZES.map((s) => h('option', { value: String(s) })));
  const fontColour = colour(/^#/.test(p['fo:color'] || '') ? p['fo:color'] : '#000000');
  const autoColour = check(t('fd.automatic'), !p['fo:color'] || p['fo:color'] === 'auto');
  const ul = select(UL_NAMES.map(([v, k]) => [v, t(k)]), underlineKind(p));
  const ulColour = colour(/^#/.test(p['style:text-underline-color'] || '') ? p['style:text-underline-color'] : '#000000');
  const ulAuto = check(t('fd.automatic'), !p['style:text-underline-color'] || p['style:text-underline-color'] === 'font-color');
  const strike = check(t('fd.strikethrough'), p['style:text-line-through-style'] && p['style:text-line-through-style'] !== 'none' && p['style:text-line-through-type'] !== 'double');
  const dstrike = check(t('fd.doubleStrikethrough'), p['style:text-line-through-type'] === 'double');
  const pos = String(p['style:text-position'] || '');
  const sup = check(t('cmd.home.superscript'), /^super|^[1-9]/.test(pos));
  const sub = check(t('cmd.home.subscript'), /^sub|^-/.test(pos));
  const smallCaps = check(t('fd.smallCaps'), p['fo:font-variant'] === 'small-caps');
  const allCaps = check(t('fd.allCaps'), p['fo:text-transform'] === 'uppercase');
  const hidden = check(t('fd.hidden'), p['text:display'] === 'none');
  const outline = check(t('cmd.home.textOutline'), p['style:text-outline'] === 'true');
  const shadow = check(t('cmd.home.textShadow'), !!p['fo:text-shadow'] && p['fo:text-shadow'] !== 'none');
  sup.input.addEventListener('change', () => { if (sup.input.checked) sub.input.checked = false; });
  sub.input.addEventListener('change', () => { if (sub.input.checked) sup.input.checked = false; });
  strike.input.addEventListener('change', () => { if (strike.input.checked) dstrike.input.checked = false; });
  dstrike.input.addEventListener('change', () => { if (dstrike.input.checked) strike.input.checked = false; });
  // Advanced
  const ls = toPx(p['fo:letter-spacing'] || '0pt') || 0;
  const spacing = select([['normal', t('fd.normal')], ['expanded', t('fd.expanded')], ['condensed', t('fd.condensed')]], ls > 0 ? 'expanded' : ls < 0 ? 'condensed' : 'normal');
  const spacingBy = length(Math.abs(ls), 'pt');
  const scale = number(parseFloat(p['style:text-scale'] || '100'), { min: '1', max: '600' });
  const posKind = select([['normal', t('fd.normal')], ['raised', t('fd.raised')], ['lowered', t('fd.lowered')]], /^[1-9]/.test(pos) ? 'raised' : /^-/.test(pos) ? 'lowered' : 'normal');
  const posBy = number(Math.abs(parseFloat(pos) || 0), { min: '0', max: '100' });
  const kerning = check(t('fd.kerning'), p['style:letter-kerning'] === 'true');
  const preview = h('div', { class: 'fd-preview odt-doc' }, h('span', {}, String(p['style:font-name'] || 'Carlito')));

  const collect = () => {
    const c = {};
    const name = font.value.trim();
    if (name) { c['style:font-name'] = name; c['fo:font-family'] = null; }
    const sz = parseFloat(size.value);
    if (sz > 0 && sz < 1639) c['fo:font-size'] = `${sz}pt`;
    const st = styleSel.value;
    c['fo:font-weight'] = st.startsWith('bold') ? 'bold' : 'normal';
    c['fo:font-style'] = /italic/i.test(st) ? 'italic' : 'normal';
    c['fo:color'] = autoColour.input.checked ? null : fontColour.value;
    Object.assign(c, ul.value === 'none' ? NO_UNDERLINE : UNDERLINES[ul.value]);
    if (ul.value !== 'none') c['style:text-underline-color'] = ulAuto.input.checked ? 'font-color' : ulColour.value;
    c['style:text-line-through-style'] = strike.input.checked || dstrike.input.checked ? 'solid' : null;
    c['style:text-line-through-type'] = dstrike.input.checked ? 'double' : (strike.input.checked ? 'single' : null);
    const raised = posKind.value === 'raised' ? Number(posBy.value) : posKind.value === 'lowered' ? -Number(posBy.value) : 0;
    c['style:text-position'] = sup.input.checked ? 'super 58%' : sub.input.checked ? 'sub 58%' : (raised ? `${raised}% 100%` : null);
    c['fo:font-variant'] = smallCaps.input.checked ? 'small-caps' : null;
    c['fo:text-transform'] = allCaps.input.checked ? 'uppercase' : null;
    c['text:display'] = hidden.input.checked ? 'none' : null;
    c['style:text-outline'] = outline.input.checked ? 'true' : null;
    c['fo:text-shadow'] = shadow.input.checked ? '1pt 1pt' : null;
    const by = spacingBy.px() || 0;
    c['fo:letter-spacing'] = spacing.value === 'normal' || !by ? null : (spacing.value === 'condensed' ? `-${pt(by)}` : pt(by));
    const sc = Number(scale.value);
    c['style:text-scale'] = sc && sc !== 100 ? `${sc}%` : null;
    c['style:letter-kerning'] = kerning.input.checked ? 'true' : null;
    return c;
  };
  const updatePreview = () => {
    const c = collect();
    const a = {};
    for (const [k, v] of Object.entries(c)) if (v != null) a[k] = v;
    preview.firstChild.setAttribute('style', autoToCss({ props: { 'style:text-properties': { a } } }, 'text'));
    preview.firstChild.textContent = font.value || 'Carlito';
  };
  const body = h('div', { class: 'fd' }, fonts, sizes,
    tabs([
      [t('fd.fontTab'), h('div', {},
        row(field(t('fd.font'), font, { wide: true }), field(t('fd.style'), styleSel), field(t('fd.size'), size)),
        row(field(t('cmd.home.fontColour'), h('div', { class: 'fm-inline' }, fontColour, autoColour)),
          field(t('fd.underlineStyle'), ul), field(t('fd.underlineColour'), h('div', { class: 'fm-inline' }, ulColour, ulAuto))),
        group(t('fd.effects'), h('div', { class: 'fm-grid2' }, strike, smallCaps, dstrike, allCaps, sup, hidden, sub, outline, h('span'), shadow)))],
      [t('fd.advancedTab'), h('div', {},
        group(t('fd.charSpacing'),
          row(field(t('fd.scale'), h('div', { class: 'fm-inline' }, scale, '%'))),
          row(field(t('fd.spacing'), spacing), field(t('fd.by'), spacingBy)),
          row(field(t('fd.position'), posKind), field(t('fd.byPercent'), h('div', { class: 'fm-inline' }, posBy, '%'))),
          kerning))],
    ]),
    h('div', { class: 'fd-preview-wrap' }, h('div', { class: 'fm-label' }, t('fd.preview')), preview));
  body.addEventListener('input', updatePreview);
  body.addEventListener('change', updatePreview);
  updatePreview();
  const ok = await showDialog({ title: t('fd.title'), message: body, buttons: okCancel, cancelValue: false, wide: true });
  if (!ok) return null;
  const change = collect();
  if (apply) { applyTextProps(view.state, view.dispatch, index, change); view.focus(); }
  return change;
}

// ------------------------------------------------------------------ Paragraph

const ALIGNS = [['start', 'pd.left'], ['center', 'pd.centred'], ['end', 'pd.right'], ['justify', 'pd.justified']];

function lineSpacingOf(a) {
  if (a['style:line-height-at-least']) return ['atLeast', toPx(a['style:line-height-at-least'])];
  const lh = a['fo:line-height'];
  if (!lh || lh === 'normal' || lh === '100%') return ['single', 1];
  if (/%$/.test(lh)) {
    const v = parseFloat(lh) / 100;
    if (Math.abs(v - 1.5) < 0.01) return ['onePointFive', 1.5];
    if (Math.abs(v - 2) < 0.01) return ['double', 2];
    return ['multiple', v];
  }
  return ['exactly', toPx(lh)];
}

/** Paragraph dialog. With `initial`/`apply:false` it edits style properties and returns the changes. */
export async function paragraphDialog({ editor, index, initial = null, apply = true, openTabs = null }) {
  const view = editor.view;
  const node = selectedTextblocks(view.state)[0]?.node;
  const pp = initial || (node ? effectiveParagraphProps(node, index) : { a: {} });
  const a = pp.a || {};
  const align = select(ALIGNS.map(([v, k]) => [v, t(k)]), { left: 'start', right: 'end' }[a['fo:text-align']] || a['fo:text-align'] || 'start');
  const dir = select([['lr-tb', t('pd.ltr')], ['rl-tb', t('pd.rtl')]], a['style:writing-mode'] === 'rl-tb' ? 'rl-tb' : 'lr-tb');
  const left = length(toPx(a['fo:margin-left'] || '0cm') || 0, 'cm');
  const right = length(toPx(a['fo:margin-right'] || '0cm') || 0, 'cm');
  const ti = toPx(a['fo:text-indent'] || '0cm') || 0;
  const special = select([['none', t('pd.none')], ['first', t('pd.firstLine')], ['hanging', t('pd.hanging')]], ti > 0 ? 'first' : ti < 0 ? 'hanging' : 'none');
  const by = length(Math.abs(ti), 'cm');
  const before = length(toPx(a['fo:margin-top'] || '0pt') || 0, 'pt');
  const after = length(toPx(a['fo:margin-bottom'] || '0pt') || 0, 'pt');
  const [lsKind, lsVal] = lineSpacingOf(a);
  const lineKind = select([['single', t('pd.single')], ['onePointFive', t('pd.onePointFive')], ['double', t('pd.double')], ['atLeast', t('pd.atLeast')], ['exactly', t('pd.exactly')], ['multiple', t('pd.multiple')]], lsKind);
  const lineAt = text(['atLeast', 'exactly'].includes(lsKind) ? `${+(lsVal * 72 / 96).toFixed(1)} pt` : String(lsVal));
  const widow = check(t('pd.widowControl'), (a['fo:widows'] ?? '2') !== '0');
  const keepNext = check(t('cmd.home.keepWithNext'), a['fo:keep-with-next'] === 'always');
  const keepTogether = check(t('cmd.home.keepLinesTogether'), a['fo:keep-together'] === 'always');
  const pageBreak = check(t('cmd.home.pageBreakBefore'), a['fo:break-before'] === 'page');
  const tabsBtn = h('button', { type: 'button', class: 'dlg-btn' }, t('cmd.home.tabsDialog'));
  let tabsRequested = false;
  const body = h('div', { class: 'pd' },
    tabs([
      [t('pd.indentsTab'), h('div', {},
        group(t('pd.general'), row(field(t('pd.alignment'), align), field(t('pd.direction'), dir))),
        group(t('pd.indentation'), row(field(t('pd.left'), left), field(t('pd.right'), right)), row(field(t('pd.special'), special), field(t('fd.by'), by))),
        group(t('pd.spacing'), row(field(t('pd.before'), before), field(t('pd.after'), after)), row(field(t('pd.lineSpacing'), lineKind), field(t('pd.at'), lineAt))))],
      [t('pd.breaksTab'), h('div', {}, group(t('pd.pagination'), widow, keepNext, keepTogether, pageBreak))],
    ]),
    h('div', { class: 'fm-row' }, tabsBtn));
  tabsBtn.addEventListener('click', () => { tabsRequested = true; body.closest('.dlg')?.querySelector('.dlg-btn.primary')?.click(); });

  const ok = await showDialog({ title: t('pd.title'), message: body, buttons: okCancel, cancelValue: false, wide: true });
  if (!ok) return null;
  const c = {
    'fo:text-align': align.value === 'start' ? null : align.value,
    'style:writing-mode': dir.value === 'rl-tb' ? 'rl-tb' : null,
    'fo:margin-left': cm(left.px() || 0), 'fo:margin-right': cm(right.px() || 0),
    'fo:text-indent': special.value === 'none' ? cm(0) : cm((special.value === 'hanging' ? -1 : 1) * (by.px() || 0)),
    'fo:margin-top': pt(before.px() || 0), 'fo:margin-bottom': pt(after.px() || 0),
    'fo:line-height': null, 'style:line-height-at-least': null,
    'fo:widows': widow.input.checked ? null : '0', 'fo:orphans': widow.input.checked ? null : '0',
    'fo:keep-with-next': keepNext.input.checked ? 'always' : null,
    'fo:keep-together': keepTogether.input.checked ? 'always' : null,
    'fo:break-before': pageBreak.input.checked ? 'page' : null,
  };
  const v = lineAt.value.trim();
  if (lineKind.value === 'onePointFive') c['fo:line-height'] = '150%';
  else if (lineKind.value === 'double') c['fo:line-height'] = '200%';
  else if (lineKind.value === 'multiple') c['fo:line-height'] = `${Math.round((parseFloat(v) || 1) * 100)}%`;
  else if (lineKind.value === 'atLeast') c['style:line-height-at-least'] = /pt|cm|mm|in/.test(v) ? v.replace(/\s+/g, '') : `${parseFloat(v) || 12}pt`;
  else if (lineKind.value === 'exactly') c['fo:line-height'] = /pt|cm|mm|in/.test(v) ? v.replace(/\s+/g, '') : `${parseFloat(v) || 12}pt`;
  else c['fo:line-height'] = '100%';
  if (apply) { updateParagraphProps(view.state, view.dispatch, index, () => ({ attrs: c })); view.focus(); }
  if (tabsRequested && openTabs) openTabs();
  return c;
}

// ------------------------------------------------------------------ Tabs

export async function tabsDialog({ editor, index }) {
  const view = editor.view;
  const node = selectedTextblocks(view.state)[0]?.node;
  if (!node) return;
  let stops = tabStopsOf(node, index).map((s) => ({ ...s }));
  const list = h('select', { class: 'fm-select td-list', size: '6' });
  const pos = length(0, 'cm');
  const alignment = radios('td-align', [['left', t('ruler.tab.left')], ['center', t('ruler.tab.centre')], ['right', t('ruler.tab.right')], ['char', t('ruler.tab.decimal')]], 'left');
  const leader = radios('td-leader', [['none', t('td.none')], ['dotted', t('td.dots')], ['dash', t('td.dashes')], ['solid', t('td.line')]], 'none');
  const fill = () => {
    list.replaceChildren(...stops.map((s, i) => h('option', { value: String(i) }, `${+(s.pos / (96 / 2.54)).toFixed(2)} cm`)));
  };
  list.addEventListener('change', () => {
    const s = stops[Number(list.value)];
    if (!s) return;
    pos.value = `${+(s.pos / (96 / 2.54)).toFixed(2)} cm`;
    alignment.querySelector(`input[value="${s.type}"]`).checked = true;
    leader.querySelector(`input[value="${s.leader || 'none'}"]`).checked = true;
  });
  const setBtn = h('button', { type: 'button', class: 'dlg-btn' }, t('td.set'));
  const clearBtn = h('button', { type: 'button', class: 'dlg-btn' }, t('td.clear'));
  const clearAll = h('button', { type: 'button', class: 'dlg-btn' }, t('td.clearAll'));
  setBtn.addEventListener('click', () => {
    const p = pos.px();
    if (!(p > 0)) return;
    stops = stops.filter((s) => Math.abs(s.pos - p) > 0.5);
    stops.push({ pos: p, type: alignment.value(), leader: leader.value() === 'none' ? null : leader.value(), char: '.' });
    stops.sort((x, y) => x.pos - y.pos);
    fill();
  });
  clearBtn.addEventListener('click', () => { const i = Number(list.value); if (stops[i]) { stops.splice(i, 1); fill(); } });
  clearAll.addEventListener('click', () => { stops = []; fill(); });
  fill();
  const body = h('div', { class: 'td' },
    row(h('div', {}, field(t('td.position'), pos), list), h('div', {}, group(t('pd.alignment'), alignment), group(t('td.leader'), leader))),
    row(setBtn, clearBtn, clearAll));
  const ok = await showDialog({ title: t('td.title'), message: body, buttons: okCancel, cancelValue: false });
  if (!ok) return;
  const LEADER_TEXT = { dotted: '.', dash: '-', solid: '_' };
  updateParagraphProps(view.state, view.dispatch, index, () => ({
    children: [{
      n: 'style:tab-stops', a: {}, keepEmpty: true,
      c: stops.map((s) => {
        const a = { 'style:position': cm(s.pos) };
        if (s.type !== 'left') a['style:type'] = s.type;
        if (s.type === 'char') a['style:char'] = s.char || '.';
        if (s.leader) { a['style:leader-style'] = s.leader === 'dash' ? 'dash' : s.leader === 'solid' ? 'solid' : 'dotted'; a['style:leader-text'] = LEADER_TEXT[s.leader]; }
        return { n: 'style:tab-stop', a };
      }),
    }],
  }));
  view.focus();
}

// ------------------------------------------------------------------ Borders and shading

export async function bordersDialog({ editor, index }) {
  const view = editor.view;
  const node = selectedTextblocks(view.state)[0]?.node;
  const a = node ? (effectiveParagraphProps(node, index).a || {}) : {};
  const has = (side) => { const v = a[`fo:border-${side}`] || a['fo:border']; return !!v && v !== 'none'; };
  const setting = radios('bd-setting', [['none', t('bd.none')], ['box', t('bd.box')], ['custom', t('bd.custom')]], ['top', 'bottom', 'left', 'right'].every(has) ? 'box' : ['top', 'bottom', 'left', 'right'].some(has) ? 'custom' : 'none');
  const sides = Object.fromEntries(['top', 'bottom', 'left', 'right'].map((s) => [s, check(t(`bd.${s}`), has(s))]));
  const sample = String(a['fo:border'] || a['fo:border-bottom'] || a['fo:border-top'] || '0.5pt solid #000000');
  const [w0, s0, c0] = sample.split(/\s+/);
  const style = select([['solid', t('bd.solid')], ['dotted', t('bd.dotted')], ['dashed', t('bd.dashed')], ['double', t('bd.double')]], s0 || 'solid');
  const width = select(['0.25pt', '0.5pt', '0.75pt', '1pt', '1.5pt', '2.25pt', '3pt', '4.5pt', '6pt'].map((v) => [v, v]), w0 || '0.5pt');
  const col = colour(/^#/.test(c0 || '') ? c0 : '#000000');
  const fillOn = check(t('bd.fill'), !!a['fo:background-color'] && a['fo:background-color'] !== 'transparent');
  const fill = colour(/^#/.test(a['fo:background-color'] || '') ? a['fo:background-color'] : '#ffff00');
  const applyTo = select([['paragraph', t('bd.paragraph')], ['text', t('bd.text')]], 'paragraph');
  setting.addEventListener('change', () => {
    const v = setting.value();
    if (v !== 'custom') for (const s of Object.values(sides)) s.input.checked = v === 'box';
  });
  const body = h('div', { class: 'bd' },
    tabs([
      [t('bd.bordersTab'), h('div', {}, row(group(t('bd.setting'), setting), group(t('bd.sides'), sides.top, sides.bottom, sides.left, sides.right)),
        row(field(t('bd.style'), style), field(t('bd.width'), width), field(t('bd.colour'), col)))],
      [t('bd.shadingTab'), h('div', {}, row(fillOn, fill))],
    ]),
    row(field(t('bd.applyTo'), applyTo)));
  const ok = await showDialog({ title: t('bd.title'), message: body, buttons: okCancel, cancelValue: false, wide: true });
  if (!ok) return;
  const line = `${width.value} ${style.value} ${col.value}`;
  if (applyTo.value === 'text') {
    applyTextProps(view.state, view.dispatch, index, {
      'fo:border': Object.values(sides).some((s) => s.input.checked) ? line : null,
      'fo:padding': Object.values(sides).some((s) => s.input.checked) ? '0.049cm' : null,
      'fo:background-color': fillOn.input.checked ? fill.value : null,
    });
  } else {
    const c = { 'fo:border': null };
    for (const [side, el] of Object.entries(sides)) c[`fo:border-${side}`] = el.input.checked ? line : 'none';
    const any = Object.values(sides).some((s) => s.input.checked);
    if (!any) for (const side of Object.keys(sides)) c[`fo:border-${side}`] = null;
    c['fo:padding'] = any ? '0.049cm' : null;
    c['fo:background-color'] = fillOn.input.checked ? fill.value : null;
    updateParagraphProps(view.state, view.dispatch, index, () => ({ attrs: c }));
  }
  view.focus();
}

// ------------------------------------------------------------------ Sort

export async function sortDialog({ editor }) {
  const view = editor.view;
  const order = radios('so-order', [['asc', t('so.ascending')], ['desc', t('so.descending')]], 'asc');
  const type = select([['text', t('so.text')], ['number', t('so.number')], ['date', t('so.date')]], 'text');
  const matchCase = check(t('fr.matchCase'), false);
  const body = h('div', {}, row(field(t('so.type'), type), group(t('so.order'), order)), matchCase);
  const ok = await showDialog({ title: t('so.title'), message: body, buttons: okCancel, cancelValue: false });
  if (!ok) return;
  const state = view.state;
  const blocks = selectedTextblocks(state);
  if (blocks.length < 2) return;
  // Sort sibling paragraphs within the same parent only.
  const parentOf = (pos) => state.doc.resolve(pos).parent;
  const parent = parentOf(blocks[0].pos);
  const same = blocks.filter((b) => parentOf(b.pos) === parent);
  const key = (n) => {
    const s = n.textContent.trim();
    if (type.value === 'number') return parseFloat(s.replace(/[^\d.-]/g, '')) || 0;
    if (type.value === 'date') return Date.parse(s) || 0;
    return matchCase.input.checked ? s : s.toLocaleLowerCase();
  };
  const sorted = [...same].sort((x, y) => {
    const a = key(x.node);
    const b = key(y.node);
    const r = typeof a === 'number' ? a - b : String(a).localeCompare(String(b));
    return order.value() === 'desc' ? -r : r;
  });
  const from = same[0].pos;
  const last = same[same.length - 1];
  const to = last.pos + last.node.nodeSize;
  const tr = state.tr.replaceWith(from, to, sorted.map((b) => b.node));
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

// ------------------------------------------------------------------ Lists

export async function defineListDialog(kind) {
  if (kind === 'bullet') {
    const ch = text('•', { maxlength: '2' });
    const ok = await showDialog({ title: t('cmd.home.defineBullet'), message: h('div', {}, field(t('dl.bulletChar'), ch)), buttons: okCancel, cancelValue: false });
    return ok && ch.value ? [{ bullet: [...ch.value][0] }] : null;
  }
  const levels = kind === 'multilevel' ? 3 : 1;
  const rows = [];
  for (let i = 0; i < levels; i++) {
    const fmt = select([['1', '1, 2, 3'], ['a', 'a, b, c'], ['A', 'A, B, C'], ['i', 'i, ii, iii'], ['I', 'I, II, III']], ['1', 'a', 'i'][i]);
    const prefix = text('', { size: '3' });
    const suffix = text('.', { size: '3' });
    const start = number(1, { min: '1' });
    rows.push({ fmt, prefix, suffix, start });
  }
  const full = kind === 'multilevel' ? check(t('dl.includeHigher'), true) : null;
  const body = h('div', {}, rows.map((r, i) => group(t('dl.level', { n: i + 1 }), row(field(t('dl.format'), r.fmt), field(t('dl.before'), r.prefix), field(t('dl.after'), r.suffix), field(t('dl.start'), r.start)))), full);
  const ok = await showDialog({ title: t(kind === 'multilevel' ? 'cmd.home.defineMultilevel' : 'cmd.home.defineNumber'), message: body, buttons: okCancel, cancelValue: false, wide: true });
  if (!ok) return null;
  return rows.map((r) => ({ format: r.fmt.value, prefix: r.prefix.value, suffix: r.suffix.value, start: Number(r.start.value) || 1, display: full?.input.checked ? 10 : 1 }));
}

export async function numberValueDialog() {
  const v = number(1, { min: '1' });
  const ok = await showDialog({ title: t('dl.setValue'), message: h('div', {}, field(t('dl.setValueTo'), v)), buttons: okCancel, cancelValue: false });
  return ok ? Math.max(1, Number(v.value) || 1) : null;
}

export async function moreColoursDialog(current = '#000000') {
  const c = colour(current);
  const ok = await showDialog({ title: t('cmd.home.fontColourMore'), message: h('div', {}, field(t('bd.colour'), c)), buttons: okCancel, cancelValue: false });
  return ok ? c.value : null;
}

// ------------------------------------------------------------------ Styles

/**
 * New / Modify Style dialog. Returns { displayName, parent, next, auto } or null.
 * `styles` = [[name, displayName]] of the family (for Based on / Next).
 */
export async function styleDialog({ title, family, displayName = '', parent = null, next = null, auto = null, styles, editor, index, isNew }) {
  const name = text(displayName);
  const based = select([['', t('sd.noStyle')], ...styles], parent || '');
  const nextSel = family === 'paragraph' ? select([['', t('sd.same')], ...styles], next || '') : null;
  let current = auto ? structuredClone(auto) : { styleAttrs: {}, props: {} };
  const tp = () => current.props['style:text-properties']?.a || {};
  const ppA = () => current.props['style:paragraph-properties']?.a || {};
  const quick = {
    bold: check(t('cmd.home.bold'), tp()['fo:font-weight'] === 'bold'),
    italic: check(t('cmd.home.italic'), tp()['fo:font-style'] === 'italic'),
    underline: check(t('cmd.home.underline'), !!tp()['style:text-underline-style'] && tp()['style:text-underline-style'] !== 'none'),
  };
  const fontBtn = h('button', { type: 'button', class: 'dlg-btn' }, t('sd.fontButton'));
  const paraBtn = family === 'paragraph' ? h('button', { type: 'button', class: 'dlg-btn' }, t('sd.paragraphButton')) : null;
  const setProps = (key, attrs) => {
    const p = current.props[key] || { a: {} };
    p.a = { ...p.a };
    for (const [k, v] of Object.entries(attrs)) { if (v == null) delete p.a[k]; else p.a[k] = v; }
    current.props[key] = p;
  };
  fontBtn.addEventListener('click', async () => {
    const eff = { ...index?.effective(family, parent || 'Standard')?.props?.['style:text-properties']?.a, ...tp() };
    const ch = await fontDialog({ editor, index, initial: eff, apply: false });
    if (ch) setProps('style:text-properties', ch);
  });
  paraBtn?.addEventListener('click', async () => {
    const ch = await paragraphDialog({ editor, index, initial: { a: { ...index?.effective('paragraph', parent || 'Standard')?.props?.['style:paragraph-properties']?.a, ...ppA() } }, apply: false });
    if (ch) setProps('style:paragraph-properties', ch);
  });
  const body = h('div', { class: 'sd' },
    group(t('sd.properties'), row(field(t('sd.name'), name, { wide: true })), row(field(t('sd.basedOn'), based), nextSel ? field(t('sd.next'), nextSel) : null)),
    group(t('sd.formatting'), row(quick.bold, quick.italic, quick.underline), row(fontBtn, paraBtn)));
  const ok = await showDialog({ title, message: body, buttons: okCancel, cancelValue: false, wide: true });
  if (!ok || !name.value.trim()) return null;
  setProps('style:text-properties', {
    'fo:font-weight': quick.bold.input.checked ? 'bold' : (tp()['fo:font-weight'] === 'bold' ? null : tp()['fo:font-weight'] ?? null),
    'fo:font-style': quick.italic.input.checked ? 'italic' : (tp()['fo:font-style'] === 'italic' ? null : tp()['fo:font-style'] ?? null),
    'style:text-underline-style': quick.underline.input.checked ? (tp()['style:text-underline-style'] && tp()['style:text-underline-style'] !== 'none' ? tp()['style:text-underline-style'] : 'solid') : null,
    'style:text-underline-width': quick.underline.input.checked ? (tp()['style:text-underline-width'] || 'auto') : null,
  });
  for (const k of Object.keys(current.props)) if (k !== '#other' && !Object.keys(current.props[k].a || {}).length && !current.props[k].c) delete current.props[k];
  void isNew; void schema;
  return { displayName: name.value.trim(), parent: based.value || null, next: nextSel ? (nextSel.value || null) : null, auto: current };
}
