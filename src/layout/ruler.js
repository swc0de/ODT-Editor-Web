/**
 * Rulers (static in M1; live dragging arrives in M3). The horizontal ruler is
 * drawn across the page width just under the ribbon, numbered in cm outward
 * from the left margin, with the margin areas shaded and the indent markers
 * at the margins. The vertical ruler runs down the window's left edge along
 * the page. The tab selector sits in the corner where the rulers meet.
 */
import { h } from '../ui/dom.js';
import { iconSvg } from '../ui/icons.js';
import { t } from '../i18n/index.js';
import { PX_PER_CM } from './units.js';

const TAB_TYPES = ['left', 'centre', 'right', 'decimal', 'bar', 'firstLine', 'hanging'];
const TAB_ICON = { left: 'tab-left', centre: 'tab-centre', right: 'tab-right', decimal: 'tab-decimal', bar: 'tab-bar', firstLine: 'tab-first-line', hanging: 'tab-hanging' };

/**
 * Builds tick marks for a ruler of `lengthPx` whose text area runs from
 * `startPx` to `endPx`. Inside the text area whole centimetres are numbered
 * from the margin; in the margins they are plain lines (as in the reference).
 * Returns [{ pos, kind: 'num'|'half'|'quarter', n? }].
 */
export function rulerTicks(lengthPx, startPx, endPx = lengthPx, scale = 1) {
  const step = (PX_PER_CM * scale) / 4;
  const out = [];
  const first = -Math.floor(startPx / step);
  const last = Math.floor((lengthPx - startPx) / step);
  for (let i = first; i <= last; i++) {
    if (i === 0) continue;
    const pos = startPx + i * step;
    if (pos < 2 || pos > lengthPx - 2) continue;
    const q = ((i % 4) + 4) % 4;
    if (q === 0 && pos > startPx && pos < endPx - 1) out.push({ pos, kind: 'num', n: i / 4 });
    else if (q === 0) out.push({ pos, kind: 'half' });
    else out.push({ pos, kind: q === 2 ? 'half' : 'quarter' });
  }
  return out;
}

/** Redraws ticks only when the geometry changed (scrolling just moves the ruler). */
function drawTicks(container, ticks, vertical, key) {
  if (container._key === key) return;
  container._key = key;
  const frag = document.createDocumentFragment();
  for (const tk of ticks) {
    const el = tk.kind === 'num'
      ? h('span', { class: 'rt-num' }, String(tk.n))
      : h('span', { class: `rt-tick ${tk.kind}` });
    el.style[vertical ? 'top' : 'left'] = `${tk.pos}px`;
    frag.append(el);
  }
  container.replaceChildren(frag);
}

export function createRulers({ store }) {
  let tabType = 0;
  const selector = h('button', { type: 'button', class: 'tab-selector', 'aria-label': '', 'data-tip': '' });
  const updateSelector = () => {
    const type = TAB_TYPES[tabType];
    selector.innerHTML = iconSvg(TAB_ICON[type], { size: 10, strokeWidth: 2 });
    const label = t('ruler.tabSelector', { type: t(`ruler.tab.${type}`) });
    selector.setAttribute('aria-label', label);
    selector.dataset.tip = label;
  };
  selector.addEventListener('click', () => { tabType = (tabType + 1) % TAB_TYPES.length; updateSelector(); });
  updateSelector();

  const hBody = h('div', { class: 'hruler-body' });
  const hTicks = h('div', { class: 'hruler-ticks' });
  const firstLine = h('span', { class: 'ruler-marker first-line', 'data-tip': t('ruler.firstLineIndent') });
  const hanging = h('span', { class: 'ruler-marker hanging', 'data-tip': t('ruler.hangingIndent') });
  const leftIndent = h('span', { class: 'ruler-marker left-indent', 'data-tip': t('ruler.leftIndent') });
  const rightIndent = h('span', { class: 'ruler-marker right-indent', 'data-tip': t('ruler.rightIndent') });
  const hruler = h('div', { class: 'hruler', role: 'presentation', 'aria-label': t('ruler.horizontal') },
    h('div', { class: 'hruler-margin left' }), hBody, h('div', { class: 'hruler-margin right' }), hTicks, firstLine, hanging, leftIndent, rightIndent);
  const hstrip = h('div', { class: 'hruler-strip' }, hruler);

  const vBody = h('div', { class: 'vruler-body' });
  const vTicks = h('div', { class: 'vruler-ticks' });
  const vruler = h('div', { class: 'vruler', role: 'presentation', 'aria-label': t('ruler.vertical') }, h('div', { class: 'vruler-margin top' }), vBody, h('div', { class: 'vruler-margin bottom' }), vTicks);
  const vstrip = h('div', { class: 'vruler-strip' }, vruler);
  const corner = h('div', { class: 'ruler-corner' }, selector);

  /**
   * Positions both rulers against a page element inside the scrolling canvas.
   * @param {HTMLElement} page
   * @param {{left:number,right:number,top:number,bottom:number}} marginsPx
   */
  function update(page, marginsPx, pageHeightPx = null) {
    if (!page) return;
    const pr = page.getBoundingClientRect();
    const sr = hstrip.getBoundingClientRect();
    const scale = pr.width / page.offsetWidth || 1;
    const m = { left: marginsPx.left * scale, right: marginsPx.right * scale, top: marginsPx.top * scale, bottom: marginsPx.bottom * scale };
    // Horizontal
    hruler.style.left = `${pr.left - sr.left}px`;
    hruler.style.width = `${pr.width}px`;
    hruler.querySelector('.hruler-margin.left').style.width = `${m.left}px`;
    hruler.querySelector('.hruler-margin.right').style.width = `${m.right}px`;
    hBody.style.left = `${m.left}px`;
    hBody.style.right = `${m.right}px`;
    drawTicks(hTicks, rulerTicks(pr.width, m.left, pr.width - m.right, scale), false, `${pr.width}|${m.left}|${m.right}|${scale}`);
    for (const mk of [firstLine, hanging, leftIndent]) mk.style.left = `${m.left}px`;
    rightIndent.style.left = `${pr.width - m.right}px`;
    // Vertical: one page tall, following the page as it scrolls. (In the
    // continuous view the page can be very long; M3 gives each page its own.)
    const vr = vstrip.getBoundingClientRect();
    const height = Math.min(pr.height, (pageHeightPx || pr.height) * scale);
    vruler.style.top = `${pr.top - vr.top}px`;
    vruler.style.height = `${height}px`;
    vruler.querySelector('.vruler-margin.top').style.height = `${m.top}px`;
    vruler.querySelector('.vruler-margin.bottom').style.height = `${m.bottom}px`;
    vBody.style.top = `${m.top}px`;
    vBody.style.bottom = `${m.bottom}px`;
    drawTicks(vTicks, rulerTicks(height, m.top, height - m.bottom, scale), true, `${height}|${m.top}|${m.bottom}|${scale}`);
  }

  function setVisible(show) {
    hstrip.hidden = !show;
    vstrip.hidden = !show;
    corner.hidden = !show;
  }
  store.subscribe((s, changed) => { if (changed.includes('showRuler')) setVisible(s.showRuler); });
  setVisible(store.get().showRuler);

  return { hstrip, vstrip, corner, update };
}
