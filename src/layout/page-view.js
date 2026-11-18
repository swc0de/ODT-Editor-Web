/**
 * The Print Layout surface: a stack of page backgrounds (white pages with
 * their headers, footers and page numbers) behind the single editor flow,
 * zoom, Vertical / Side to Side page movement, gridlines and Hide White Space.
 *
 *   .page-stack  (zoomed)
 *     .page-bgs    one .pg per page (absolute), with .pg-header / .pg-footer
 *     .page-flow   the editor (padding = first page's body box)
 *
 * In Vertical mode the paginator inserts the gaps; in Side to Side mode the
 * flow becomes CSS columns of the body height, one column per page.
 */
import { h } from '../ui/dom.js';
import { PAGE_GAP } from './paginator.js';

export function createPageView() {
  const bgs = h('div', { class: 'page-bgs', 'aria-hidden': 'true' });
  const mount = h('div', { class: 'odt-doc' });
  const flow = h('div', { class: 'page-flow' }, mount);
  const stack = h('div', { class: 'page-stack' }, bgs, flow);
  const pagesEl = h('div', { class: 'pages' }, stack);
  let model = null;
  let opts = { zoom: 1, side: false, hideWhiteSpace: false, gridlines: false };
  let pageEls = [];

  function setModel(m) { model = m; }
  function setOptions(o) {
    opts = { ...opts, ...o };
    stack.style.zoom = String(opts.zoom);
    stack.classList.toggle('side', !!opts.side);
    stack.classList.toggle('gridlines', !!opts.gridlines);
    stack.classList.toggle('hide-white', !!opts.hideWhiteSpace);
  }

  /** Header/footer for a page, with page-number and page-count fields filled in. */
  function partFor(master, kind, part, number, total) {
    const tpl = kind ? master[part][kind] : null;
    if (!tpl) return null;
    const el = tpl.cloneNode(true);
    for (const f of el.querySelectorAll('.f-text-page-number')) f.textContent = String(number);
    for (const f of el.querySelectorAll('.f-text-page-count')) f.textContent = String(total);
    return el;
  }

  /** Renders the page backgrounds for a vertical layout. */
  function renderPages(pages) {
    if (!model) return;
    const first = model.first;
    const W = model.width;
    const total = pages.length;
    // Reuse page elements; rebuild their contents only when something changed.
    while (pageEls.length > pages.length) pageEls.pop().remove();
    pages.forEach((p, i) => {
      const master = model.masters.get(p.master) || first;
      const key = `${p.master}|${p.number}|${total}|${p.box.headerKind}|${p.box.footerKind}|${p.box.pageHeight}|${p.top}|${opts.hideWhiteSpace}`;
      let el = pageEls[i];
      if (!el) { el = h('div', { class: 'pg' }); bgs.append(el); pageEls[i] = el; }
      if (el._key === key) return;
      el._key = key;
      el.style.top = `${p.top}px`;
      el.style.width = `${W}px`;
      el.style.height = `${p.box.pageHeight}px`;
      el.style.background = master.background || '';
      el.replaceChildren();
      const body = h('div', { class: 'pg-body' });
      body.style.cssText = `top:${p.box.top}px;height:${p.box.height}px;left:${model.marginLeft}px;right:${model.marginRight}px`;
      el.append(body);
      if (!opts.hideWhiteSpace) {
        const head = partFor(master, p.box.headerKind, 'header', p.number, total);
        if (head) {
          const box = h('div', { class: 'pg-header' }, head);
          box.style.cssText = `top:${master.marginTop}px;left:${model.marginLeft}px;right:${model.marginRight}px`;
          el.append(box);
        }
        const foot = partFor(master, p.box.footerKind, 'footer', p.number, total);
        if (foot) {
          const box = h('div', { class: 'pg-footer' }, foot);
          box.style.cssText = `bottom:${master.marginBottom}px;left:${model.marginLeft}px;right:${model.marginRight}px`;
          el.append(box);
        }
      }
    });
    const last = pages[pages.length - 1];
    const height = last ? last.top + last.box.pageHeight : first.height;
    stack.style.width = `${W}px`;
    stack.style.height = `${height}px`;
    bgs.style.height = `${height}px`;
    const p0 = pages[0];
    flow.style.paddingTop = `${p0 ? p0.box.top : first.marginTop}px`;
    flow.style.paddingLeft = `${model.marginLeft}px`;
    flow.style.paddingRight = `${model.marginRight}px`;
    flow.style.removeProperty('height');
    flow.style.removeProperty('column-width');
  }

  /** Side to Side: CSS columns of the body height; returns the page count. */
  function renderSide() {
    if (!model) return 1;
    const m = model.first;
    const box = { top: m.marginTop, bottom: m.height - m.marginBottom };
    const bodyW = model.width - model.marginLeft - model.marginRight;
    const pitch = model.width + PAGE_GAP;
    flow.style.paddingTop = '0px';
    flow.style.paddingLeft = '0px';
    flow.style.paddingRight = '0px';
    flow.style.position = 'absolute';
    flow.style.left = `${model.marginLeft}px`;
    flow.style.top = `${box.top}px`;
    flow.style.height = `${box.bottom - box.top}px`;
    flow.style.columnWidth = `${bodyW}px`;
    flow.style.columnGap = `${model.marginLeft + model.marginRight + PAGE_GAP}px`;
    flow.style.width = `${bodyW}px`;
    const count = Math.max(1, Math.round((flow.scrollWidth + model.marginLeft + model.marginRight + PAGE_GAP) / pitch));
    const pages = Array.from({ length: count }, (_, i) => ({
      master: m.name, number: i + 1, index: i, top: 0, left: i * pitch,
      box: { top: box.top, bottom: box.bottom, height: box.bottom - box.top, pageHeight: m.height, headerKind: i === 0 && m.header.first ? 'first' : (m.header.right ? 'right' : null), footerKind: i === 0 && m.footer.first ? 'first' : (m.footer.right ? 'right' : null) },
    }));
    while (pageEls.length > count) pageEls.pop().remove();
    pages.forEach((p, i) => {
      let el = pageEls[i];
      if (!el) { el = h('div', { class: 'pg' }); bgs.append(el); pageEls[i] = el; }
      el._key = null;
      el.style.top = '0px';
      el.style.left = `${p.left}px`;
      el.style.width = `${model.width}px`;
      el.style.height = `${m.height}px`;
      el.replaceChildren();
      const head = partFor(m, p.box.headerKind, 'header', p.number, count);
      if (head) { const b = h('div', { class: 'pg-header' }, head); b.style.cssText = `top:${m.marginTop}px;left:${model.marginLeft}px;right:${model.marginRight}px`; el.append(b); }
      const foot = partFor(m, p.box.footerKind, 'footer', p.number, count);
      if (foot) { const b = h('div', { class: 'pg-footer' }, foot); b.style.cssText = `bottom:${m.marginBottom}px;left:${model.marginLeft}px;right:${model.marginRight}px`; el.append(b); }
    });
    stack.style.width = `${count * pitch - PAGE_GAP}px`;
    stack.style.height = `${m.height}px`;
    bgs.style.height = `${m.height}px`;
    return pages;
  }

  function leaveSide() {
    for (const p of ['position', 'left', 'top', 'height', 'columnWidth', 'columnGap', 'width']) flow.style[p] = '';
    for (const el of pageEls) { el.style.left = '0px'; el._key = null; }
  }

  return {
    el: pagesEl, stack, flow, mount, bgs, setModel, setOptions, renderPages, renderSide, leaveSide,
    pageElement: (i) => pageEls[i] || pageEls[0] || null,
    get options() { return opts; },
  };
}
