/**
 * Repeated table heading rows. When a table with heading rows ("Repeat Header
 * Rows", ODF table:table-header-rows) continues on a new page, the paginator
 * leaves room above the first row there (gap.repeat: rowPos → height). This
 * draws a read-only copy of the heading rows in that space, on a layer above
 * the page flow, styled like the table.
 */
import { paginationKey } from './paginator.js';

export function renderRepeatedRows({ view, layer, zoom, origin }) {
  const host = layer.firstChild;
  const st = paginationKey.getState(view.state);
  const out = [];
  if (st) {
    const o = origin().getBoundingClientRect();
    const k = zoom || 1;
    for (const g of st.gaps) {
      if (g.type !== 'rows' || !g.repeat?.size) continue;
      const tableDom = view.nodeDOM(g.tablePos);
      const table = tableDom?.nodeName === 'TABLE' ? tableDom : tableDom?.querySelector?.('table');
      if (!table) continue;
      const tbody = table.tBodies[0] || table;
      const heads = [...tbody.children].filter((r) => r.nodeName === 'TR' && r.dataset.header != null);
      if (!heads.length) continue;
      const tr = table.getBoundingClientRect();
      for (const [rowPos, hh] of g.repeat) {
        const rowDom = view.nodeDOM(rowPos);
        if (!rowDom || rowDom.nodeType !== 1) continue;
        const rr = rowDom.getBoundingClientRect();
        const copy = table.cloneNode(false);
        copy.removeAttribute('contenteditable');
        const cg = table.querySelector(':scope > colgroup');
        if (cg) copy.append(cg.cloneNode(true));
        const body = document.createElement('tbody');
        for (const r of heads) {
          const c = r.cloneNode(true);
          c.style.transform = '';
          c.classList.remove('pg-shifted');
          for (const sel of c.querySelectorAll('.selectedCell')) sel.classList.remove('selectedCell');
          body.append(c);
        }
        copy.append(body);
        copy.classList.add('repeat-copy');
        copy.style.position = 'absolute';
        copy.style.left = `${(tr.left - o.left) / k}px`;
        copy.style.top = `${(rr.top - o.top) / k - hh}px`;
        copy.style.width = `${tr.width / k}px`;
        out.push(copy);
      }
    }
  }
  host.replaceChildren(...out);
}
