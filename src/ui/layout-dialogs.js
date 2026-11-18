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
