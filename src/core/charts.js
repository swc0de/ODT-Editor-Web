/**
 * Charts as ODF chart objects ("Object N/content.xml" + styles.xml), the way
 * LibreOffice stores them: a chart:chart with a local data table. The chart
 * spec { type, title, legend, categories, series: [{ name, values }] } is
 * read back from that XML (also from LibreOffice's own charts), so a chart
 * can be edited again. Drawing in the page is our own SVG (renderChart).
 *
 * Types: column (vertical bars), bar (horizontal bars), line, pie.
 */
import { cm, withWrap, uniqueName, maxZ } from './objects.js';
import { CHART_MIME, freeObjectDir } from './equations.js';

export const CHART_TYPES = ['column', 'bar', 'line', 'pie'];
export const CHART_COLOURS = ['#156082', '#e97132', '#196b24', '#0f9ed5', '#a02b93', '#4ea72e', '#8a8a8a', '#c0504d'];

export function defaultChart(type = 'column') {
  return {
    type, title: type === 'pie' ? 'Sales' : 'Chart Title', legend: true,
    categories: ['Category 1', 'Category 2', 'Category 3', 'Category 4'],
    series: type === 'pie'
      ? [{ name: 'Sales', values: [8.2, 3.2, 1.4, 1.2] }]
      : [{ name: 'Series 1', values: [4.3, 2.5, 3.5, 4.5] }, { name: 'Series 2', values: [2.4, 4.4, 1.8, 2.8] }, { name: 'Series 3', values: [2, 2, 3, 5] }],
  };
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const col = (i) => { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:chart="urn:oasis:names:tc:opendocument:xmlns:chart:1.0" xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0" xmlns:loext="urn:org:documentfoundation:names:experimental:office:xmlns:loext:1.0"';

/** Files of a chart object for a spec: { 'content.xml', 'styles.xml' }. */
export function chartFiles(spec, wCm = 15.24, hCm = 7.62) {
  const { type } = spec;
  const series = type === 'pie' ? spec.series.slice(0, 1) : spec.series;
  const n = spec.categories.length;
  const cls = { column: 'chart:bar', bar: 'chart:bar', line: 'chart:line', pie: 'chart:circle' }[type];
  const styles = [
    '<style:style style:name="chArea" style:family="chart"><style:graphic-properties draw:stroke="none" draw:fill="solid" draw:fill-color="#ffffff"/></style:style>',
    '<style:style style:name="chTitle" style:family="chart"><style:text-properties fo:font-size="14pt" fo:color="#595959"/></style:style>',
    '<style:style style:name="chLegend" style:family="chart"><style:text-properties fo:font-size="9pt" fo:color="#595959"/></style:style>',
    `<style:style style:name="chPlot" style:family="chart"><style:chart-properties chart:series-source="columns" chart:vertical="${type === 'bar' ? 'true' : 'false'}" chart:lines="${type === 'line' ? 'true' : 'false'}" chart:symbol-type="none" chart:include-hidden-cells="false" chart:auto-position="true" chart:auto-size="true"${type === 'column' || type === 'bar' ? ' chart:gap-width="150" chart:overlap="-20"' : ''}/></style:style>`,
    '<style:style style:name="chAxis" style:family="chart"><style:chart-properties chart:display-label="true" chart:logarithmic="false" chart:reverse-direction="false"/><style:graphic-properties svg:stroke-color="#d9d9d9"/><style:text-properties fo:font-size="9pt" fo:color="#595959"/></style:style>',
    '<style:style style:name="chGrid" style:family="chart"><style:graphic-properties svg:stroke-color="#d9d9d9"/></style:style>',
    '<style:style style:name="chWall" style:family="chart"><style:graphic-properties draw:stroke="none" draw:fill="none"/></style:style>',
    ...series.map((_, i) => (type === 'line'
      ? `<style:style style:name="chS${i}" style:family="chart"><style:chart-properties chart:symbol-type="none"/><style:graphic-properties draw:stroke="solid" svg:stroke-width="0.08cm" svg:stroke-color="${CHART_COLOURS[i % 8]}" draw:fill-color="${CHART_COLOURS[i % 8]}"/></style:style>`
      : `<style:style style:name="chS${i}" style:family="chart"><style:graphic-properties draw:stroke="none" draw:fill="solid" draw:fill-color="${CHART_COLOURS[i % 8]}"/></style:style>`)),
    ...(type === 'pie' ? spec.categories.map((_, i) => `<style:style style:name="chP${i}" style:family="chart"><style:graphic-properties draw:stroke="solid" svg:stroke-color="#ffffff" draw:fill="solid" draw:fill-color="${CHART_COLOURS[i % 8]}"/></style:style>`) : []),
  ];
  const last = n + 1;
  const range = `local-table.$A$1:.$${col(series.length)}$${last}`;
  let plot = `<chart:plot-area chart:style-name="chPlot" table:cell-range-address="${range}" chart:data-source-has-labels="both">`;
  if (type !== 'pie') {
    plot += `<chart:axis chart:dimension="x" chart:name="primary-x" chart:style-name="chAxis"><chart:categories table:cell-range-address="local-table.$A$2:.$A$${last}"/></chart:axis>`;
    plot += '<chart:axis chart:dimension="y" chart:name="primary-y" chart:style-name="chAxis"><chart:grid chart:style-name="chGrid" chart:class="major"/></chart:axis>';
  }
  series.forEach((s, i) => {
    plot += `<chart:series chart:style-name="chS${i}" chart:values-cell-range-address="local-table.$${col(i + 1)}$2:.$${col(i + 1)}$${last}" chart:label-cell-address="local-table.$${col(i + 1)}$1" chart:class="${cls}">`;
    if (type === 'pie') plot += spec.categories.map((_, k) => `<chart:data-point chart:style-name="chP${k}"/>`).join('');
    else plot += `<chart:data-point chart:repeated="${n}"/>`;
    plot += '</chart:series>';
  });
  plot += '<chart:wall chart:style-name="chWall"/><chart:floor chart:style-name="chWall"/></chart:plot-area>';
  const cell = (v) => (typeof v === 'number' && Number.isFinite(v) ? `<table:table-cell office:value-type="float" office:value="${v}"><text:p>${v}</text:p></table:table-cell>` : `<table:table-cell office:value-type="string"><text:p>${esc(v)}</text:p></table:table-cell>`);
  let tbl = '<table:table table:name="local-table"><table:table-header-columns><table:table-column/></table:table-header-columns>';
  tbl += `<table:table-columns><table:table-column table:number-columns-repeated="${series.length}"/></table:table-columns>`;
  tbl += `<table:table-header-rows><table:table-row><table:table-cell><text:p/></table:table-cell>${series.map((s) => cell(String(s.name))).join('')}</table:table-row></table:table-header-rows><table:table-rows>`;
  spec.categories.forEach((c, k) => { tbl += `<table:table-row>${cell(String(c))}${series.map((s) => cell(Number(s.values[k]) || 0)).join('')}</table:table-row>`; });
  tbl += '</table:table-rows></table:table>';
  const title = spec.title ? `<chart:title chart:style-name="chTitle"><text:p>${esc(spec.title)}</text:p></chart:title>` : '';
  const legend = spec.legend ? `<chart:legend chart:legend-position="${type === 'pie' ? 'end' : 'bottom'}" style:legend-expansion="${type === 'pie' ? 'high' : 'wide'}" chart:style-name="chLegend"/>` : '';
  const content = `<?xml version="1.0" encoding="UTF-8"?>\n<office:document-content ${NS} office:version="1.3"><office:automatic-styles>${styles.join('')}</office:automatic-styles><office:body><office:chart>`
    + `<chart:chart svg:width="${wCm}cm" svg:height="${hCm}cm" chart:class="${cls}" chart:style-name="chArea">${title}${legend}${plot}${tbl}</chart:chart></office:chart></office:body></office:document-content>\n`;
  const stylesXml = `<?xml version="1.0" encoding="UTF-8"?>\n<office:document-styles ${NS} office:version="1.3"><office:styles/></office:document-styles>\n`;
  return { 'content.xml': content, 'styles.xml': stylesXml };
}

/** Reads a chart spec back from an object's content.xml (ours or LibreOffice's); null if it can't. */
export function parseChart(xml) {
  if (!xml) return null;
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const C = 'urn:oasis:names:tc:opendocument:xmlns:chart:1.0';
  const T = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
  const O = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0';
  const chart = doc.getElementsByTagNameNS(C, 'chart')[0];
  if (!chart) return null;
  const cls = chart.getAttributeNS(C, 'class') || 'chart:bar';
  let vertical = false;
  const plot = chart.getElementsByTagNameNS(C, 'plot-area')[0];
  const plotStyle = plot?.getAttributeNS(C, 'style-name');
  for (const st of doc.getElementsByTagName('style:style')) {
    if (st.getAttribute('style:name') === plotStyle) for (const p of st.getElementsByTagName('style:chart-properties')) vertical = p.getAttribute('chart:vertical') === 'true';
  }
  const type = cls === 'chart:circle' || cls === 'chart:ring' ? 'pie' : cls === 'chart:line' ? 'line' : (vertical ? 'bar' : 'column');
  const titleEl = chart.getElementsByTagNameNS(C, 'title')[0];
  const table = chart.getElementsByTagNameNS(T, 'table')[0];
  const rows = table ? [...table.getElementsByTagNameNS(T, 'table-row')] : [];
  const cells = (row) => [...row.children].filter((c) => c.localName === 'table-cell').map((c) => {
    const t = c.getAttributeNS(O, 'value-type');
    return t === 'float' || t === 'percentage' ? Number(c.getAttributeNS(O, 'value')) : c.textContent.trim();
  });
  if (rows.length < 2) return null;
  const head = cells(rows[0]);
  const body = rows.slice(1).map(cells);
  const series = head.slice(1).map((name, i) => ({ name: String(name || `Series ${i + 1}`), values: body.map((r) => (typeof r[i + 1] === 'number' ? r[i + 1] : Number(r[i + 1]) || 0)) }));
  return {
    type, title: titleEl ? titleEl.textContent.trim() : '', legend: !!chart.getElementsByTagNameNS(C, 'legend')[0],
    categories: body.map((r, k) => String(r[0] ?? `Category ${k + 1}`)), series: series.length ? series : [{ name: 'Series 1', values: body.map(() => 0) }],
  };
}

/** Attrs for a new chart frame (in line with text). */
export function chartAttrs({ doc, state, spec, wCm = 15.24, hCm = 7.62 }) {
  const dir = freeObjectDir(doc, state);
  const attrs = {
    element: 'draw:frame', styleName: null, auto: null, kind: 'chart', href: `./${dir}`, body: [],
    frameAttrs: { 'draw:name': uniqueName(doc, 'Chart'), 'text:anchor-type': 'as-char', 'svg:width': `${wCm}cm`, 'svg:height': `${hCm}cm`, 'draw:z-index': String(maxZ(doc) + 1) },
    parts: [{ n: 'draw:object', a: { 'xlink:href': `./${dir}`, 'xlink:type': 'simple', 'xlink:show': 'embed', 'xlink:actuate': 'onLoad' }, '#files': chartFiles(spec, wCm, hCm), '#mime': CHART_MIME }],
  };
  return withWrap(attrs, 'inline');
}

/** The same chart frame with new data (the stale replacement picture is dropped). */
export function withChart(attrs, spec, wCm, hCm) {
  const parts = (attrs.parts || []).filter((p) => !(p.n === 'draw:image' && String(p.a['xlink:href']).includes('ObjectReplacements')))
    .map((p) => (p.n === 'draw:object' ? { ...p, '#files': { ...(p['#files'] || {}), ...chartFiles(spec, wCm, hCm) } } : p));
  return { ...attrs, parts };
}

// ---------------------------------------------------------------- drawing

const SVGNS = 'http://www.w3.org/2000/svg';
const el = (tag, a = {}, text = null) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(a)) if (v != null) e.setAttribute(k, String(v)); if (text != null) e.textContent = text; return e; };

/** "Nice" axis maximum and step. */
function niceScale(max, min = 0) {
  const span = Math.max(1e-9, max - min);
  const raw = span / 5;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw) || raw;
  return { lo: Math.floor(min / step) * step, hi: Math.ceil(max / step) * step, step };
}

/** SVG drawing of a chart spec in a w×h box. */
export function renderChart(spec, w, h) {
  const svg = el('svg', { width: w, height: h, viewBox: `0 0 ${w} ${h}`, class: 'chart-svg', role: 'img', 'aria-label': spec.title || 'Chart' });
  svg.append(el('rect', { x: 0, y: 0, width: w, height: h, fill: '#ffffff' }));
  const font = 'Carlito, sans-serif';
  let top = 8;
  if (spec.title) { svg.append(el('text', { x: w / 2, y: 22, 'text-anchor': 'middle', 'font-family': font, 'font-size': 16, fill: '#595959' }, spec.title)); top = 34; }
  const series = spec.type === 'pie' ? spec.series.slice(0, 1) : spec.series;
  const legendItems = spec.type === 'pie' ? spec.categories : series.map((s) => s.name);
  let bottom = h - 8;
  let right = w - 8;
  if (spec.legend) {
    if (spec.type === 'pie') {
      right = w - 110;
      legendItems.forEach((name, i) => {
        const y = top + 10 + i * 18;
        svg.append(el('rect', { x: right + 14, y: y - 8, width: 9, height: 9, fill: CHART_COLOURS[i % 8] }));
        svg.append(el('text', { x: right + 28, y, 'font-family': font, 'font-size': 11, fill: '#595959' }, name));
      });
    } else {
      bottom = h - 26;
      const widths = legendItems.map((n) => 18 + String(n).length * 6 + 12);
      let x = (w - widths.reduce((a, b) => a + b, 0)) / 2;
      legendItems.forEach((name, i) => {
        svg.append(el('rect', { x, y: h - 17, width: 9, height: 9, fill: CHART_COLOURS[i % 8] }));
        svg.append(el('text', { x: x + 13, y: h - 9, 'font-family': font, 'font-size': 11, fill: '#595959' }, name));
        x += widths[i];
      });
    }
  }
  if (spec.type === 'pie') {
    const vals = series[0]?.values.map((v) => Math.max(0, Number(v) || 0)) || [];
    const total = vals.reduce((a, b) => a + b, 0) || 1;
    const cx = 8 + (right - 8) / 2; const cy = (top + bottom) / 2;
    const r = Math.max(10, Math.min(right - 16, bottom - top) / 2 - 4);
    let a0 = -Math.PI / 2;
    vals.forEach((v, i) => {
      const a1 = a0 + (v / total) * Math.PI * 2;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const p = vals.length === 1 || v === total
        ? `M${cx - r} ${cy} A${r} ${r} 0 1 1 ${cx + r} ${cy} A${r} ${r} 0 1 1 ${cx - r} ${cy} Z`
        : `M${cx} ${cy} L${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)} A${r} ${r} 0 ${large} 1 ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)} Z`;
      svg.append(el('path', { d: p, fill: CHART_COLOURS[i % 8], stroke: '#ffffff', 'stroke-width': 1.5 }));
      a0 = a1;
    });
    return svg;
  }
  const all = series.flatMap((s) => s.values.map((v) => Number(v) || 0));
  const { lo, hi, step } = niceScale(Math.max(0, ...all), Math.min(0, ...all));
  const horizontal = spec.type === 'bar';
  const labelW = horizontal ? Math.min(110, 8 + Math.max(...spec.categories.map((c) => String(c).length)) * 6) : 30;
  const x0 = 8 + labelW; const x1 = right - 6;
  const y0 = top + 4; const y1 = bottom - (horizontal ? 18 : 20);
  const n = spec.categories.length || 1;
  const valuePos = (v) => (horizontal ? x0 + ((v - lo) / (hi - lo || 1)) * (x1 - x0) : y1 - ((v - lo) / (hi - lo || 1)) * (y1 - y0));
  // Gridlines and value labels.
  for (let v = lo; v <= hi + step / 2; v += step) {
    const p = valuePos(v);
    const label = String(+v.toFixed(6));
    if (horizontal) {
      svg.append(el('line', { x1: p, x2: p, y1: y0, y2: y1, stroke: '#d9d9d9' }));
      svg.append(el('text', { x: p, y: y1 + 14, 'text-anchor': 'middle', 'font-family': font, 'font-size': 10, fill: '#595959' }, label));
    } else {
      svg.append(el('line', { x1: x0, x2: x1, y1: p, y2: p, stroke: '#d9d9d9' }));
      svg.append(el('text', { x: x0 - 6, y: p + 3, 'text-anchor': 'end', 'font-family': font, 'font-size': 10, fill: '#595959' }, label));
    }
  }
  const band = (horizontal ? y1 - y0 : x1 - x0) / n;
  spec.categories.forEach((c, k) => {
    const mid = (horizontal ? y0 : x0) + band * (k + 0.5);
    if (horizontal) svg.append(el('text', { x: x0 - 6, y: mid + 3, 'text-anchor': 'end', 'font-family': font, 'font-size': 10, fill: '#595959' }, c));
    else svg.append(el('text', { x: mid, y: y1 + 14, 'text-anchor': 'middle', 'font-family': font, 'font-size': 10, fill: '#595959' }, c));
  });
  const zero = valuePos(Math.max(lo, Math.min(hi, 0)));
  if (spec.type === 'line') {
    series.forEach((s, i) => {
      const pts = s.values.map((v, k) => [x0 + band * (k + 0.5), valuePos(Number(v) || 0)]);
      svg.append(el('polyline', { points: pts.map((p) => p.join(',')).join(' '), fill: 'none', stroke: CHART_COLOURS[i % 8], 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    });
  } else {
    const inner = band * 0.62;
    const bw = inner / Math.max(1, series.length);
    series.forEach((s, i) => s.values.forEach((v, k) => {
      const p = valuePos(Number(v) || 0);
      const start = (horizontal ? y0 : x0) + band * k + (band - inner) / 2 + bw * i;
      const a = Math.min(p, zero); const len = Math.abs(p - zero);
      svg.append(horizontal
        ? el('rect', { x: a, y: start, width: len, height: Math.max(1, bw - 1), fill: CHART_COLOURS[i % 8] })
        : el('rect', { x: start, y: a, width: Math.max(1, bw - 1), height: len, fill: CHART_COLOURS[i % 8] }));
    }));
  }
  svg.append(horizontal ? el('line', { x1: zero, x2: zero, y1: y0, y2: y1, stroke: '#bfbfbf' }) : el('line', { x1: x0, x2: x1, y1: zero, y2: zero, stroke: '#bfbfbf' }));
  return svg;
}

export { cm };
