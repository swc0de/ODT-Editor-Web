/**
 * Layout dialogs: Page Setup (margins, paper, layout), Columns, Line
 * Numbers and Hyphenation options. They return the chosen settings; the
 * Layout commands apply them as undoable steps.
 */
import { h } from './dom.js';
import { t } from '../i18n/index.js';
import { showDialog } from './dialog.js';
import { field, number, select, check, radios, length, tabs, row, group } from './form.js';
import { PAGE_SIZES } from '../core/page-setup.js';
import { toPx } from '../layout/units.js';

const okCancel = [{ label: t('common.ok'), value: true, primary: true }, { label: t('common.cancel'), value: false }];
const px = (v, d) => (v ? toPx(v) || d : d);
const CM = 96 / 2.54;

/**
 * @param {object} p current page-layout attributes (+ usage)
 * @param {object} hf { firstPage, oddEven, headerFromEdge(px), footerFromEdge(px) }
 * @param {string} tab 'margins' | 'paper' | 'layout'
 * @returns {Promise<null | { attrs, usage, applyTo, firstPage, oddEven }>}
 */
export async function pageSetupDialog(p, hf, tab = 'margins', { sectionCount = 1 } = {}) {
  const top = length(px(p['fo:margin-top'], 2 * CM), 'cm');
  const bottom = length(px(p['fo:margin-bottom'], 2 * CM), 'cm');
  const left = length(px(p['fo:margin-left'], 2 * CM), 'cm');
  const right = length(px(p['fo:margin-right'], 2 * CM), 'cm');
  const mirrored = p.usage === 'mirrored';
  const pages = select([['normal', t('ps.normal')], ['mirrored', t('ps.mirrored')]], mirrored ? 'mirrored' : 'normal');
  const w0 = px(p['fo:page-width'], 21 * CM);
  const h0 = px(p['fo:page-height'], 29.7 * CM);
  const orient = radios('ps-orient', [['portrait', t('cmd.layout.portrait')], ['landscape', t('cmd.layout.landscape')]], w0 > h0 ? 'landscape' : 'portrait');
  const sizeName = Object.entries(PAGE_SIZES).find(([, [w, hh]]) => (Math.abs(w * CM - Math.min(w0, h0)) < 2 && Math.abs(hh * CM - Math.max(w0, h0)) < 2))?.[0] || 'custom';
  const size = select([...Object.keys(PAGE_SIZES).map((k) => [k, `${k} (${PAGE_SIZES[k][0]} × ${PAGE_SIZES[k][1]} cm)`]), ['custom', t('ps.customSize')]], sizeName);
  const width = length(w0, 'cm');
  const height = length(h0, 'cm');
  size.addEventListener('change', () => {
    const s = PAGE_SIZES[size.value];
    if (!s) return;
    const land = orient.value() === 'landscape';
    width.value = `${land ? s[1] : s[0]} cm`;
    height.value = `${land ? s[0] : s[1]} cm`;
  });
  orient.addEventListener('change', () => {
    const a = parseFloat(width.value);
    const b = parseFloat(height.value);
    const land = orient.value() === 'landscape';
    if ((land && a < b) || (!land && a > b)) { width.value = `${b} cm`; height.value = `${a} cm`; }
  });
  const firstPage = check(t('ps.differentFirst'), hf.firstPage);
  const oddEven = check(t('ps.differentOddEven'), hf.oddEven);
  const headerEdge = length(hf.headerFromEdge, 'cm');
  const footerEdge = length(hf.footerFromEdge, 'cm');
  const applyTo = select([['section', t('ps.thisSection')], ['whole', t('ps.wholeDocument')]], sectionCount > 1 ? 'section' : 'whole');
  const body = h('div', { class: 'ps' },
    tabs([
      [t('ps.marginsTab'), h('div', {},
        group(t('ps.margins'), row(field(t('ps.top'), top), field(t('ps.bottom'), bottom)), row(field(t('pd.left'), left), field(t('pd.right'), right)), row(field(t('ps.multiplePages'), pages))),
        group(t('cmd.layout.orientation'), orient))],
      [t('ps.paperTab'), h('div', {}, group(t('ps.paperSize'), row(field(t('cmd.layout.size'), size, { wide: true })), row(field(t('ps.width'), width), field(t('ps.height'), height))))],
      [t('ps.layoutTab'), h('div', {},
        group(t('ps.headersFooters'), firstPage, oddEven, row(field(t('ps.headerFromEdge'), headerEdge), field(t('ps.footerFromEdge'), footerEdge))))],
    ], { margins: 0, paper: 1, layout: 2 }[tab] || 0),
    row(field(t('ps.applyTo'), applyTo)));
  const ok = await showDialog({ title: t('ps.title'), message: body, buttons: okCancel, cancelValue: false, wide: true });
  if (!ok) return null;
  const cmv = (el) => `${+((el.px() || 0) / CM).toFixed(3)}cm`;
  const w = width.px() || w0;
  const hh = height.px() || h0;
  const attrs = {
    'fo:margin-top': cmv(top), 'fo:margin-bottom': cmv(bottom), 'fo:margin-left': cmv(left), 'fo:margin-right': cmv(right),
    'fo:page-width': `${+(w / CM).toFixed(3)}cm`, 'fo:page-height': `${+(hh / CM).toFixed(3)}cm`, 'style:print-orientation': w > hh ? 'landscape' : 'portrait',
  };
  return {
    attrs, usage: pages.value === 'mirrored' ? 'mirrored' : 'all', applyTo: applyTo.value,
    firstPage: firstPage.input.checked, oddEven: oddEven.input.checked, headerFromEdge: headerEdge.px(), footerFromEdge: footerEdge.px(),
  };
}

/** Columns dialog: { count, gap (cm), equal, widths, separator, applyTo }. */
export async function columnsDialog(cur, { canSelection = false } = {}) {
  const preset = radios('cd-preset', [['1', t('cmd.layout.columnsOne')], ['2', t('cmd.layout.columnsTwo')], ['3', t('cmd.layout.columnsThree')], ['left', t('cmd.layout.columnsLeft')], ['right', t('cmd.layout.columnsRight')]], cur.widths?.length === 2 && cur.widths[0] !== cur.widths[1] ? (cur.widths[0] < cur.widths[1] ? 'left' : 'right') : String(Math.min(3, cur.count)));
  const count = number(cur.count, { min: '1', max: '10' });
  const gap = length((parseFloat(cur.gap) || 1.25) * CM, 'cm');
  const separator = check(t('cd.lineBetween'), cur.separator);
  const applyTo = select([...(canSelection ? [['selection', t('cd.selectedText')]] : []), ['section', t('ps.thisSection')], ['forward', t('cd.thisPointForward')]], canSelection ? 'selection' : 'section');
  preset.addEventListener('change', () => { const v = preset.value(); count.value = v === 'left' || v === 'right' ? '2' : v; });
  const body = h('div', {}, group(t('cd.presets'), preset), row(field(t('cd.number'), count), field(t('cd.spacing'), gap)), separator, row(field(t('ps.applyTo'), applyTo)));
  const ok = await showDialog({ title: t('cd.title'), message: body, buttons: okCancel, cancelValue: false });
  if (!ok) return null;
  const n = Math.max(1, Math.min(10, Number(count.value) || 1));
  const v = preset.value();
  const widths = n === 2 && v === 'left' ? [1, 2] : n === 2 && v === 'right' ? [2, 1] : null;
  return { count: n, gap: +((gap.px() || 0) / CM).toFixed(3), widths, separator: separator.input.checked, applyTo: applyTo.value };
}

/** Line Numbers options: { on, start, offset, increment, restart: 'page'|'section'|'continuous' } */
export async function lineNumbersDialog(cur) {
  const on = check(t('ln.add'), !!cur);
  const start = number(1, { min: '1' });
  const offset = length(px(cur?.offset, 0.499 * CM), 'cm');
  const increment = number(cur?.increment || 1, { min: '1' });
  const restart = radios('ln-restart', [['page', t('cmd.layout.lineNumbersRestartPage')], ['section', t('cmd.layout.lineNumbersRestartSection')], ['continuous', t('cmd.layout.lineNumbersContinuous')]], cur?.restartOnPage ? 'page' : 'continuous');
  const body = h('div', {}, on, row(field(t('ln.start'), start), field(t('ln.fromText'), offset), field(t('ln.countBy'), increment)), group(t('ln.numbering'), restart));
  const ok = await showDialog({ title: t('ln.title'), message: body, buttons: okCancel, cancelValue: false });
  if (!ok) return null;
  return { on: on.input.checked, start: Number(start.value) || 1, offset: `${+((offset.px() || 0) / CM).toFixed(3)}cm`, increment: Number(increment.value) || 1, restart: restart.value() };
}

export async function hyphenationDialog(cur) {
  const on = check(t('hy.auto'), cur.on);
  const caps = check(t('hy.caps'), cur.caps);
  const ladder = select([['0', t('hy.noLimit')], ...[1, 2, 3, 4, 5].map((n) => [String(n), String(n)])], String(cur.ladder || 0));
  const body = h('div', {}, on, caps, row(field(t('hy.limit'), ladder)));
  const ok = await showDialog({ title: t('hy.title'), message: body, buttons: okCancel, cancelValue: false });
  if (!ok) return null;
  return { on: on.input.checked, caps: caps.input.checked, ladder: Number(ladder.value) };
}

/** Page Number Format: { format, start (null = continue from the previous section) }. */
export async function pageNumberDialog(cur) {
  const fmt = select([['1', '1, 2, 3, …'], ['a', 'a, b, c, …'], ['A', 'A, B, C, …'], ['i', 'i, ii, iii, …'], ['I', 'I, II, III, …']], cur.format || '1');
  const mode = radios('pn-mode', [['continue', t('pn.continue')], ['start', t('pn.startAt')]], cur.start ? 'start' : 'continue');
  const start = number(cur.start || 1, { min: '0' });
  const body = h('div', {}, row(field(t('pn.format'), fmt, { wide: true })), group(t('pn.numbering'), mode, row(field(t('pn.startAt'), start))));
  const ok = await showDialog({ title: t('pn.title'), message: body, buttons: okCancel, cancelValue: false });
  if (!ok) return null;
  return { format: fmt.value, start: mode.value() === 'start' ? Math.max(0, Number(start.value) || 1) : null };
}

/** Date and Time: { format, fixed }. */
export async function dateTimeDialog() {
  const now = new Date();
  const sample = (o) => now.toLocaleString('en-GB', o);
  const formats = [
    ['long', sample({ day: 'numeric', month: 'long', year: 'numeric' })],
    ['short', sample({ day: '2-digit', month: '2-digit', year: 'numeric' })],
    ['weekday', sample({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })],
    ['iso', now.toISOString().slice(0, 10)],
    ['time', sample({ hour: '2-digit', minute: '2-digit' })],
  ];
  const list = h('select', { class: 'fm-select dt-list', size: String(formats.length), 'aria-label': t('dt.formats') }, formats.map(([v, l], i) => { const o = h('option', { value: v }, l); if (!i) o.selected = true; return o; }));
  const update = check(t('dt.update'), true);
  const ok = await showDialog({ title: t('dt.title'), message: h('div', {}, field(t('dt.formats'), list, { wide: true }), update), buttons: okCancel, cancelValue: false });
  if (!ok) return null;
  return { format: list.value || 'long', fixed: !update.input.checked };
}

/**
 * Custom watermark: returns null (no watermark), a spec for setWatermark, or
 * undefined when cancelled.
 */
export async function watermarkDialog({ addPicture }) {
  const kind = radios('wm-kind', [['none', t('wm.none')], ['image', t('wm.picture')], ['text', t('wm.text')]], 'text');
  const file = h('input', { type: 'file', accept: 'image/*', class: 'fm-input', 'aria-label': t('wm.selectPicture') });
  const textIn = h('input', { type: 'text', class: 'fm-input', value: 'DRAFT', list: 'wm-texts', 'aria-label': t('wm.text') });
  const texts = h('datalist', { id: 'wm-texts' }, ['ASAP', 'CONFIDENTIAL', 'DO NOT COPY', 'DRAFT', 'ORIGINAL', 'PERSONAL', 'SAMPLE', 'TOP SECRET', 'URGENT'].map((x) => h('option', { value: x })));
  const font = select(['Carlito', 'Caladea', 'Liberation Sans', 'Liberation Serif', 'Liberation Mono'].map((f) => [f, f]), 'Carlito');
  const colourIn = h('input', { type: 'color', class: 'fm-colour', value: '#c0c0c0', 'aria-label': t('bd.colour') });
  const semi = check(t('wm.semi'), true);
  const layout = radios('wm-layout', [['diagonal', t('wm.diagonal')], ['horizontal', t('wm.horizontal')]], 'diagonal');
  const body = h('div', { class: 'wm' }, texts, kind,
    group(t('wm.picture'), field(t('wm.selectPicture'), file, { wide: true })),
    group(t('wm.text'), row(field(t('wm.text'), textIn, { wide: true })), row(field(t('fd.font'), font), field(t('bd.colour'), colourIn)), semi, layout));
  const ok = await showDialog({ title: t('wm.title'), message: body, buttons: okCancel, cancelValue: false });
  if (!ok) return undefined;
  const k = kind.value();
  if (k === 'none') return null;
  if (k === 'image') {
    const f = file.files?.[0];
    if (!f) return undefined;
    const bytes = new Uint8Array(await f.arrayBuffer());
    const path = addPicture(bytes, f.type || 'image/png');
    const img = await new Promise((resolve) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => resolve(null); i.src = URL.createObjectURL(f); });
    const ratio = img && img.naturalWidth ? img.naturalHeight / img.naturalWidth : 1;
    const w = 14;
    return { kind: 'image', path, width: w, height: +(w * ratio).toFixed(2) };
  }
  return { kind: 'text', text: textIn.value.trim() || 'DRAFT', font: font.value, colour: colourIn.value, semi: semi.input.checked, layout: layout.value() };
}

/** Page Borders: null (none), { style, width, colour, shadow, applyTo }, or undefined when cancelled. */
export async function pageBordersDialog(cur) {
  const has = cur['fo:border'] && cur['fo:border'] !== 'none';
  const [w0, s0, c0] = String(has ? cur['fo:border'] : '0.5pt solid #000000').split(/\s+/);
  const setting = radios('pb-setting', [['none', t('bd.none')], ['box', t('bd.box')], ['shadow', t('pb.shadow')]], has ? (cur['style:shadow'] && cur['style:shadow'] !== 'none' ? 'shadow' : 'box') : 'none');
  const style = select([['solid', t('bd.solid')], ['dotted', t('bd.dotted')], ['dashed', t('bd.dashed')], ['double', t('bd.double')]], s0 || 'solid');
  const width = select(['0.5pt', '0.75pt', '1pt', '1.5pt', '2.25pt', '3pt', '4.5pt', '6pt'].map((v) => [v, v]), w0 || '0.5pt');
  const colourIn = h('input', { type: 'color', class: 'fm-colour', value: /^#/.test(c0 || '') ? c0 : '#000000', 'aria-label': t('bd.colour') });
  const applyTo = select([['whole', t('ps.wholeDocument')], ['section', t('ps.thisSection')]], 'whole');
  const body = h('div', {}, row(group(t('bd.setting'), setting), h('div', {}, field(t('bd.style'), style), field(t('bd.width'), width), field(t('bd.colour'), colourIn))), row(field(t('ps.applyTo'), applyTo)));
  const ok = await showDialog({ title: t('pb.title'), message: body, buttons: okCancel, cancelValue: false });
  if (!ok) return undefined;
  if (setting.value() === 'none') return null;
  return { style: style.value, width: width.value, colour: colourIn.value, shadow: setting.value() === 'shadow', applyTo: applyTo.value };
}
