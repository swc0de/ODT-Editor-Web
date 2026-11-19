/**
 * Insert ▸ Chart: chart type, title, legend and an editable data grid
 * (categories down the side, series across the top), with a live preview.
 * Resolves to a chart spec (core/charts.js) or null.
 */
import { h } from './dom.js';
import { t } from '../i18n/index.js';
import { showDialog } from './dialog.js';
import { check, field, text } from './form.js';
import { CHART_TYPES, defaultChart, renderChart } from '../core/charts.js';
import { iconSvg } from './icons.js';
import { objectPart } from '../core/equations.js';
import { parseChart } from '../core/charts.js';

const TYPE_ICON = {
  column: '<svg viewBox="0 0 24 24" width="22" height="22"><rect x="4" y="11" width="4" height="9" fill="#156082"/><rect x="10" y="5" width="4" height="15" fill="#e97132"/><rect x="16" y="8" width="4" height="12" fill="#196b24"/></svg>',
  bar: '<svg viewBox="0 0 24 24" width="22" height="22"><rect x="4" y="4" width="9" height="4" fill="#156082"/><rect x="4" y="10" width="15" height="4" fill="#e97132"/><rect x="4" y="16" width="12" height="4" fill="#196b24"/></svg>',
  line: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke-width="2"><polyline points="3,17 9,10 14,13 21,5" stroke="#156082"/><polyline points="3,20 9,16 14,18 21,12" stroke="#e97132"/></svg>',
  pie: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 12V3a9 9 0 0 1 9 9z" fill="#e97132"/><path d="M12 12h9a9 9 0 1 1-9-9z" fill="#156082"/></svg>',
};

export async function chartDialog(initial = null) {
  const spec = structuredClone(initial || defaultChart('column'));
  const preview = h('div', { class: 'ch-preview', 'aria-hidden': 'true' });
  const grid = h('table', { class: 'ch-grid' });
  const title = text(spec.title, { 'aria-label': t('chart.titleLabel') });
  const legend = check(t('chart.legend'), spec.legend);
  const types = h('div', { class: 'ch-types', role: 'radiogroup', 'aria-label': t('chart.type') });
  const redraw = () => preview.replaceChildren(renderChart(spec, 380, 210));
  const renderGrid = () => {
    const series = spec.type === 'pie' ? spec.series.slice(0, 1) : spec.series;
    const input = (value, onInput, label, num = false) => {
      const i = h('input', { class: `ch-cell${num ? ' num' : ''}`, value: String(value), 'aria-label': label, inputmode: num ? 'decimal' : null });
      i.addEventListener('input', () => { onInput(i.value); redraw(); });
      return i;
    };
    const head = h('tr', {}, h('th', {}), series.map((s, j) => h('th', {}, input(s.name, (v) => { s.name = v; }, t('chart.seriesName', { n: j + 1 })))));
    const rows = spec.categories.map((c, k) => h('tr', {},
      h('th', {}, input(c, (v) => { spec.categories[k] = v; }, t('chart.categoryName', { n: k + 1 }))),
      series.map((s, j) => h('td', {}, input(s.values[k] ?? 0, (v) => { s.values[k] = Number(String(v).replace(',', '.')) || 0; }, `${s.name}, ${spec.categories[k]}`, true)))));
    grid.replaceChildren(head, ...rows);
  };
  const setType = (ty) => {
    spec.type = ty;
    types.querySelectorAll('button').forEach((b) => { b.classList.toggle('is-on', b.dataset.type === ty); b.setAttribute('aria-checked', String(b.dataset.type === ty)); });
    renderGrid();
    redraw();
  };
  for (const ty of CHART_TYPES) types.append(h('button', { type: 'button', class: 'ch-type', role: 'radio', 'data-type': ty, 'aria-label': t(`chart.t.${ty}`), onclick: () => setType(ty), html: `${TYPE_ICON[ty]}<span>${t(`chart.t.${ty}`)}</span>` }));
  title.addEventListener('input', () => { spec.title = title.value; redraw(); });
  legend.input.addEventListener('change', () => { spec.legend = legend.input.checked; redraw(); });
  const btn = (label, icon, fn) => h('button', { type: 'button', class: 'dlg-btn ch-btn', 'aria-label': label, 'data-tip': label, onclick: () => { fn(); renderGrid(); redraw(); }, html: `${iconSvg(icon, { size: 14 })}<span>${label}</span>` });
  const tools = h('div', { class: 'ch-tools' },
    btn(t('chart.addCategory'), 'plus', () => { spec.categories.push(`Category ${spec.categories.length + 1}`); spec.series.forEach((s) => s.values.push(0)); }),
    btn(t('chart.removeCategory'), 'minus', () => { if (spec.categories.length > 1) { spec.categories.pop(); spec.series.forEach((s) => s.values.pop()); } }),
    btn(t('chart.addSeries'), 'plus', () => { if (spec.type !== 'pie') spec.series.push({ name: `Series ${spec.series.length + 1}`, values: spec.categories.map(() => 0) }); }),
    btn(t('chart.removeSeries'), 'minus', () => { if (spec.series.length > 1) spec.series.pop(); }));
  setType(spec.type);
  const body = h('div', { class: 'ch-body' }, types, h('div', { class: 'ch-main' }, h('div', { class: 'ch-data' }, field(t('chart.titleLabel'), title, { wide: true }), legend, tools, h('div', { class: 'ch-grid-wrap' }, grid)), preview));
  const ok = await showDialog({ title: t(initial ? 'chart.editTitle' : 'chart.insertTitle'), message: body, wide: true, cancelValue: false, buttons: [{ label: t('common.ok'), value: true, primary: true }, { label: t('common.cancel'), value: false }] });
  return ok ? spec : null;
}

/** The spec of a chart frame, or null. */
export const chartSpecOf = (attrs) => parseChart(objectPart(attrs)?.['#files']?.['content.xml']);

/** Node view content for a chart frame. */
export function renderChartFrame(attrs, w, h) {
  const spec = chartSpecOf(attrs);
  if (!spec) return null;
  const wrap = document.createElement('span');
  wrap.className = 'obj-chart';
  wrap.append(renderChart(spec, Math.max(40, w), Math.max(30, h)));
  return wrap;
}
