/**
 * Line numbers (Layout ▸ Line Numbers): after each layout, the lines of body
 * paragraphs are measured and numbered in the left margin of their page,
 * following text:linenumbering-configuration (increment, restart on each
 * page, count empty lines), text:line-number restarts and paragraphs with
 * text:number-lines="false". Tables, headers and footers are not counted.
 */
import { effectiveParagraphProps } from '../core/commands/paragraph.js';

export function renderLineNumbers({ view, layer, model, pages, index, zoom, origin }) {
  layer.replaceChildren();
  const cfg = model?.lineNumbering;
  if (!cfg || !pages.length) return;
  const o = origin().getBoundingClientRect();
  const k = zoom || 1;
  const pageOf = (y) => {
    let i = 0;
    while (i + 1 < pages.length && pages[i + 1].top <= y) i++;
    return i;
  };
  let n = 0;
  let lastPage = -1;
  const frag = document.createDocumentFragment();
  view.state.doc.descendants((node, pos, parent) => {
    if (node.type.name === 'table') return false;
    if (!node.isTextblock) return true;
    if (parent.type.name === 'table_cell') return false;
    const a = effectiveParagraphProps(node, index).a || {};
    const dom = view.nodeDOM(pos);
    if (!dom || dom.nodeType !== 1) return false;
    if (a['text:line-number']) n = Number(a['text:line-number']) - 1;
    const counted = a['text:number-lines'] !== 'false';
    const range = document.createRange();
    range.selectNodeContents(dom);
    const rects = [...range.getClientRects()].filter((r) => r.height > 0 && r.width > 0).sort((x, y) => x.top - y.top);
    const lines = [];
    for (const r of rects) {
      const last = lines[lines.length - 1];
      if (last && r.top < last.b - 2) { last.b = Math.max(last.b, r.bottom); continue; }
      lines.push({ t: r.top, b: r.bottom });
    }
    if (!lines.length && cfg.countEmpty) {
      const r = dom.getBoundingClientRect();
      lines.push({ t: r.top, b: r.top + Math.min(r.height, 20) });
    }
    for (const l of lines) {
      const top = (l.t - o.top) / k;
      const pi = pageOf(top);
      if (cfg.restartOnPage && pi !== lastPage) n = 0;
      lastPage = pi;
      if (!counted) continue;
      n++;
      if (n % cfg.increment !== 0) continue;
      const page = pages[pi];
      const m = model.masters.get(page.master) || model.first;
      const el = document.createElement('div');
      el.className = 'ln-num';
      el.textContent = String(n);
      el.style.top = `${top + ((l.b - l.t) / k - 13) / 2}px`;
      el.style.left = `${m.x + m.marginLeft - cfg.offset - 40}px`;
      frag.append(el);
    }
    return false;
  });
  layer.append(frag);
}
