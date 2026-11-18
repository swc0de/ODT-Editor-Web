/**
 * Tab stops. A tab character is rendered as an inline-block whose width is
 * computed after layout so the following text starts at the paragraph's next
 * tab stop (left, centre, right or decimal), with optional leader dots or
 * lines. Positions are relative to the paragraph's left indent, as in
 * LibreOffice; past the last explicit stop, default stops repeat at the
 * document's default interval.
 */
import { toPx } from './units.js';
import { mergeAuto } from '../core/odt/styles.js';

const LEADER = { dotted: 'dotted', dash: 'dash', 'long-dash': 'dash', solid: 'solid', 'dot-dash': 'dotted', wave: 'solid' };

/** Effective tab stops of a paragraph node: [{ pos(px), type, char, leader }] sorted. */
export function tabStopsOf(node, index) {
  const auto = mergeAuto(index?.effective('paragraph', node.attrs.styleName) || null, node.attrs.auto);
  const pp = auto?.props?.['style:paragraph-properties'];
  const ts = (pp?.c || []).find((c) => typeof c !== 'string' && c.n === 'style:tab-stops');
  const stops = (ts?.c || []).filter((c) => typeof c !== 'string' && c.n === 'style:tab-stop').map((c) => {
    const leaderText = c.a['style:leader-text'];
    let leader = LEADER[c.a['style:leader-style']] || null;
    if (leaderText === '.') leader = 'dotted';
    else if (leaderText === '-') leader = 'dash';
    else if (leaderText === '_') leader = 'solid';
    if (c.a['style:leader-style'] === 'none') leader = null;
    return { pos: toPx(c.a['style:position']) || 0, type: c.a['style:type'] || 'left', char: c.a['style:char'] || '.', leader };
  });
  return stops.sort((a, b) => a.pos - b.pos);
}

export function defaultTabInterval(index) {
  const d = index?.defaults?.get('paragraph');
  const pp = (d?.c || []).find((c) => typeof c !== 'string' && c.n === 'style:paragraph-properties');
  return toPx(pp?.a?.['style:tab-stop-distance']) || 48;
}

/**
 * Sizes every tab in paragraphs at/after `fromPos` (all when null).
 * @returns number of paragraphs processed
 */
export function layoutTabs(view, index, zoom, fromPos = 0) {
  const interval = defaultTabInterval(index);
  let n = 0;
  view.state.doc.descendants((node, pos) => {
    if (pos + node.nodeSize < fromPos) return false;
    if (!node.isTextblock) return true;
    let hasTab = false;
    node.forEach((c) => { if (c.type.name === 'tab') hasTab = true; });
    if (!hasTab) return false;
    const dom = view.nodeDOM(pos);
    if (dom?.nodeType === 1) { sizeTabs(dom, tabStopsOf(node, index), interval, zoom); n++; }
    return false;
  });
  return n;
}

function textWidthAfter(span, stopAtChar) {
  // Width of the text after this tab up to the next tab (or the decimal char).
  const range = document.createRange();
  range.setStartAfter(span);
  let end = span.nextSibling;
  let last = null;
  while (end && !(end.nodeType === 1 && end.classList?.contains('odt-tab'))) { last = end; end = end.nextSibling; }
  if (!last) return 0;
  if (stopAtChar && last) {
    // Walk text nodes for the decimal character.
    for (let n = span.nextSibling; n && n !== end; n = n.nextSibling) {
      const text = n.nodeType === 3 ? n.data : n.textContent;
      const i = text.indexOf(stopAtChar);
      if (i >= 0 && n.nodeType === 3) { range.setEnd(n, i); return range.getBoundingClientRect().width; }
    }
  }
  range.setEndAfter(last);
  const rects = range.getClientRects();
  return rects.length ? rects[0].width : 0;
}

function sizeTabs(p, stops, interval, zoom) {
  const tabs = [...p.querySelectorAll(':scope > .odt-tab, :scope > * .odt-tab')];
  if (!tabs.length) return;
  for (const t of tabs) { t.style.width = '0px'; t.removeAttribute('data-leader'); }
  const pr = p.getBoundingClientRect();
  const cs = getComputedStyle(p);
  const originLeft = pr.left + (parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth)) * zoom;
  for (const t of tabs) {
    const x = (t.getBoundingClientRect().left - originLeft) / zoom;
    let stop = stops.find((s) => s.pos > x + 0.5);
    if (!stop) stop = { pos: (Math.floor(x / interval) + 1) * interval, type: 'left', leader: null };
    let w = stop.pos - x;
    if (stop.type === 'right') w -= textWidthAfter(t) / zoom;
    else if (stop.type === 'center') w -= textWidthAfter(t) / zoom / 2;
    else if (stop.type === 'char') w -= textWidthAfter(t, stop.char) / zoom;
    if (w < 1) w = Math.max(1, stop.pos - x > 0 ? 1 : interval - (x % interval));
    t.style.width = `${w}px`;
    if (stop.leader) t.dataset.leader = stop.leader;
  }
}
