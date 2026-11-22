/**
 * Dialogs for drawing objects: Layout (position, text wrapping, size),
 * Alt Text, and the Text Box / Drop Cap options. Each returns the chosen
 * values or null when cancelled.
 */
import { h } from './dom.js';
import { t } from '../i18n/index.js';
import { showDialog } from './dialog.js';
import { field, number, select, check, radios, length, tabs, row, group, text } from './form.js';
import { toPx } from '../layout/units.js';

const okCancel = () => [{ label: t('common.ok'), value: true, primary: true }, { label: t('common.cancel'), value: false }];

export const WRAP_LABELS = () => [
  ['inline', t('cmd.layout.wrapInline')], ['square', t('cmd.layout.wrapSquare')], ['tight', t('cmd.layout.wrapTight')], ['through', t('cmd.layout.wrapThrough')],
  ['topBottom', t('cmd.layout.wrapTopBottom')], ['behind', t('cmd.layout.wrapBehind')], ['front', t('cmd.layout.wrapInFront')],
];

/**
 * cur = { wrap, hpos, x, y, w, h, rotation, lockAspect, natural, distance: {t,b,l,r} (ODF lengths) }
 * → same shape with px numbers.
 */
export async function layoutOptionsDialog(cur, tab = 0) {
  const hpos = radios('lo-h', [['from-left', t('obj.absolutePosition')], ['left', t('pd.left')], ['center', t('pd.centred')], ['right', t('pd.right')]], ['left', 'center', 'right'].includes(cur.hpos) ? cur.hpos : 'from-left');
  const x = length(cur.x, 'cm');
  const y = length(cur.y, 'cm');
  const wrap = radios('lo-wrap', WRAP_LABELS(), cur.wrap);
  const d = (v) => length(v ? toPx(v) : 0, 'cm');
  const dt = d(cur.distance.t); const db = d(cur.distance.b); const dl = d(cur.distance.l); const dr = d(cur.distance.r);
  const w = length(cur.w, 'cm');
  const hh = length(cur.h, 'cm');
  const rot = number(Math.round(cur.rotation * 10) / 10, { min: '0', max: '359.9', step: '1' });
  const lock = check(t('obj.lockAspect'), cur.lockAspect);
  const ratio = cur.h ? cur.w / cur.h : 1;
  w.addEventListener('change', () => { if (lock.input.checked && w.px()) hh.value = `${+(w.px() / ratio / (96 / 2.54)).toFixed(2)} cm`; });
  hh.addEventListener('change', () => { if (lock.input.checked && hh.px()) w.value = `${+(hh.px() * ratio / (96 / 2.54)).toFixed(2)} cm`; });
  const reset = cur.natural ? h('button', { type: 'button', class: 'dlg-btn', onclick: () => { w.value = `${+(cur.natural.w / (96 / 2.54)).toFixed(2)} cm`; hh.value = `${+(cur.natural.h / (96 / 2.54)).toFixed(2)} cm`; rot.value = '0'; } }, t('obj.reset')) : null;
  const body = tabs([
    [t('obj.positionTab'), h('div', {}, group(t('obj.horizontal'), hpos, row(field(t('obj.rightOfParagraph'), x))), group(t('obj.vertical'), row(field(t('obj.belowParagraph'), y))))],
    [t('obj.wrappingTab'), h('div', {}, group(t('obj.wrappingStyle'), wrap), group(t('obj.distance'), row(field(t('ps.top'), dt), field(t('ps.bottom'), db)), row(field(t('pd.left'), dl), field(t('pd.right'), dr))))],
    [t('obj.sizeTab'), h('div', {}, row(field(t('obj.height'), hh), field(t('obj.width'), w)), row(field(t('obj.rotation'), rot)), lock, reset)],
  ], tab);
  const ok = await showDialog({ title: t('obj.layoutTitle'), message: body, buttons: okCancel(), cancelValue: false, wide: true });
  if (!ok) return null;
  return {
    wrap: wrap.value(), hpos: hpos.value(), x: x.px() ?? cur.x, y: Math.max(0, y.px() ?? cur.y),
    w: Math.max(2, w.px() || cur.w), h: Math.max(2, hh.px() || cur.h), rotation: ((Number(rot.value) || 0) % 360 + 360) % 360,
    distance: { t: dt.px() || 0, b: db.px() || 0, l: dl.px() || 0, r: dr.px() || 0 },
  };
}

export async function altTextDialog(cur) {
  const title = text(cur.title || '', { 'aria-label': t('obj.altTitle') });
  const desc = h('textarea', { class: 'fm-input fm-area', rows: '5', 'aria-label': t('obj.altDescription') });
  desc.value = cur.desc || '';
  const decorative = check(t('obj.decorative'), !cur.title && !cur.desc && cur.decorative);
  const body = h('div', {}, h('p', { class: 'fm-note' }, t('obj.altHelp')), field(t('obj.altTitle'), title, { wide: true }), field(t('obj.altDescription'), desc, { wide: true }), decorative);
  const ok = await showDialog({ title: t('obj.altTextTitle'), message: body, buttons: okCancel(), cancelValue: false });
  if (!ok) return null;
  if (decorative.input.checked) return { title: '', desc: '' };
  return { title: title.value.trim(), desc: desc.value.trim() };
}

/** Drop Cap: position (dropped / none), font, lines to drop, distance from text. */
export async function dropCapDialog(cur) {
  const mode = radios('dc-mode', [['none', t('cmd.insert.dropCapNone')], ['dropped', t('cmd.insert.dropCapDropped')]], cur.lines ? 'dropped' : 'none');
  const lines = number(cur.lines || 3, { min: '2', max: '10' });
  const dist = length(cur.distance || 0, 'cm');
  const len = number(cur.length || 1, { min: '1', max: '20' });
  const body = h('div', {}, group(t('obj.dropCapPosition'), mode), row(field(t('obj.linesToDrop'), lines), field(t('obj.letters'), len)), row(field(t('obj.distanceFromText'), dist)));
  const ok = await showDialog({ title: t('obj.dropCapTitle'), message: body, buttons: okCancel(), cancelValue: false });
  if (!ok) return null;
  return mode.value() === 'none' ? { lines: 0 } : { lines: Math.max(2, Math.min(10, Number(lines.value) || 3)), length: Math.max(1, Number(len.value) || 1), distance: dist.px() || 0 };
}

/** WordArt text. */
export async function wordArtTextDialog(cur) {
  const input = h('textarea', { class: 'fm-input fm-area', rows: '3', 'aria-label': t('obj.wordArtText') });
  input.value = cur;
  const ok = await showDialog({ title: t('obj.wordArtTitle'), message: h('div', {}, field(t('obj.wordArtText'), input, { wide: true })), buttons: okCancel(), cancelValue: false });
  if (!ok) return null;
  return input.value.trim() || cur;
}

export { select };

/** Insert ▸ SmartArt: the layout and the items (one per line). */
export async function smartArtDialog() {
  const layout = radios('sa-layout', [['process', t('obj.smartArtProcess')], ['list', t('obj.smartArtList')], ['cycle', t('obj.smartArtCycle')]], 'process');
  const items = h('textarea', { class: 'fm-input fm-textarea', rows: '5' }, [t('obj.smartArtSample1'), t('obj.smartArtSample2'), t('obj.smartArtSample3')].join('\n'));
  const body = h('div', {}, group(t('obj.smartArtLayout'), layout), field(t('obj.smartArtItems'), items, { wide: true }));
  const ok = await showDialog({ title: t('obj.smartArtTitle'), message: body, buttons: okCancel(), cancelValue: false });
  if (!ok) return null;
  return { layout: layout.value(), items: items.value.split('\n').map((x) => x.trim()).filter(Boolean) };
}
