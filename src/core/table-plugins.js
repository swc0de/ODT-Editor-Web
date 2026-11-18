/**
 * Table interaction in the editor:
 *  - cell selection by dragging (prosemirror-tables' tableEditing)
 *  - Tab / Shift+Tab move between cells; Tab in the last cell adds a row
 *  - drag a column border to resize (the last one changes the table width),
 *    drag a row's bottom border to set its height
 *  - pointer modes from the ribbon: Border Painter, Draw Table, Eraser
 */
import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { keymap } from 'prosemirror-keymap';
import { tableEditing, goToNextCell, isInTable, TableMap, CellSelection, mergeCells } from 'prosemirror-tables';
import { schema } from './schema.js';
import {
  insertRows, columnWidths, withWidths, setRowHeight, paintEdge, createTable, insertTable, splitCells,
} from './commands/tables.js';

export const tableUIKey = new PluginKey('tableUI');
const EDGE = 5;

function nextCellOrRow(state, dispatch) {
  if (!isInTable(state)) return false;
  if (goToNextCell(1)(state, dispatch)) return true;
  // Last cell: add a row below and move into it.
  let st = state;
  const ok = insertRows(state, (tr) => { st = state.apply(tr); if (dispatch) dispatch(tr); }, true);
  if (ok && dispatch) goToNextCell(1)(st, dispatch);
  return ok;
}

export const tableKeymap = keymap({
  Tab: nextCellOrRow,
  'Shift-Tab': (state, dispatch) => (isInTable(state) ? goToNextCell(-1)(state, dispatch) || true : false),
});

/** The table cell DOM element and its node position for an event target. */
function cellFromEvent(view, e) {
  const td = e.target.closest?.('td');
  if (!td || !view.dom.contains(td)) return null;
  const pos = view.posAtDOM(td, 0);
  const $p = view.state.doc.resolve(pos);
  for (let d = $p.depth; d > 0; d--) {
    if ($p.node(d).type === schema.nodes.table_cell) {
      const tableDepth = d - 2;
      return { td, cellPos: $p.before(d), cell: $p.node(d), table: $p.node(tableDepth), tablePos: $p.before(tableDepth), tableStart: $p.start(tableDepth) };
    }
  }
  return null;
}

/** Which border of the cell the pointer is on: 'right' | 'bottom' | 'left' | 'top' | null. */
function edgeAt(td, e, k) {
  const r = td.getBoundingClientRect();
  const tol = EDGE * Math.max(0.6, k);
  if (Math.abs(e.clientX - r.right) <= tol) return 'right';
  if (Math.abs(e.clientY - r.bottom) <= tol) return 'bottom';
  if (Math.abs(e.clientX - r.left) <= tol) return 'left';
  if (Math.abs(e.clientY - r.top) <= tol) return 'top';
  return null;
}

/**
 * @param {object} ui { zoom(), docState(), bodyWidth(), mode() → 'paint'|'draw'|'erase'|null, pen() → border line, onDone(mode) }
 */
export function tableUIPlugin(ui) {
  let drag = null;
  const guide = document.createElement('div');
  guide.className = 'table-guide';

  function startColumnDrag(view, info, e) {
    const map = TableMap.get(info.table);
    const rect = map.findCell(info.cellPos - info.tableStart);
    const boundary = rect.right; // the border after column boundary-1
    const dom = view.nodeDOM(info.tablePos);
    const widths = columnWidths(info.table, dom, ui.bodyWidth());
    drag = { kind: 'col', tablePos: info.tablePos, table: info.table, boundary, widths, x0: e.clientX };
    guide.className = 'table-guide v';
    document.body.append(guide);
    guide.style.cssText = `left:${e.clientX}px;top:${dom.getBoundingClientRect().top}px;height:${dom.getBoundingClientRect().height}px`;
  }

  function startRowDrag(view, info, e) {
    const tr = info.td.parentElement;
    const r = tr.getBoundingClientRect();
    const $c = view.state.doc.resolve(info.cellPos);
    drag = { kind: 'row', rowPos: $c.before($c.depth), y0: e.clientY, top: r.top, height: r.height };
    guide.className = 'table-guide h';
    document.body.append(guide);
    guide.style.cssText = `top:${e.clientY}px;left:${r.left}px;width:${r.width}px`;
  }

  function onMove(e) {
    if (!drag) return;
    if (drag.kind === 'col') guide.style.left = `${e.clientX}px`;
    else guide.style.top = `${e.clientY}px`;
  }

  function finish(view, e) {
    const d = drag;
    drag = null;
    guide.remove();
    if (!d) return;
    const k = ui.zoom();
    if (d.kind === 'col') {
      const dx = (e.clientX - d.x0) / k;
      const w = [...d.widths];
      const i = d.boundary - 1;
      if (d.boundary >= w.length) w[i] = Math.max(15, w[i] + dx);
      else {
        const move = Math.max(15 - w[i], Math.min(w[i + 1] - 15, dx));
        w[i] += move;
        w[i + 1] -= move;
      }
      const table = view.state.doc.nodeAt(d.tablePos);
      if (table) view.dispatch(view.state.tr.setNodeMarkup(d.tablePos, null, withWidths(table, w)));
    } else {
      const h = Math.max(8, d.height / k + (e.clientY - d.y0) / k);
      const $r = view.state.doc.resolve(d.rowPos + 1);
      const sel = TextSelection.near($r);
      const st = view.state.apply(view.state.tr.setSelection(sel));
      setRowHeight(st, (tr) => view.dispatch(tr), ui.docState(), h, 'atLeast');
    }
  }

  // Draw Table: drag a rectangle outside a table to insert one; drag across a cell to split it.
  function drawEnd(view, s, e) {
    const k = ui.zoom();
    const w = Math.abs(e.clientX - s.x) / k;
    const h = Math.abs(e.clientY - s.y) / k;
    if (s.info) {
      const horiz = w > h;
      if (Math.max(w, h) < 8) return;
      const st = view.state.apply(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(s.info.cellPos + 1))));
      splitCells(st, (tr) => view.dispatch(tr), horiz ? 1 : 2, horiz ? 2 : 1, { bodyWidth: ui.bodyWidth() });
      return;
    }
    if (w < 20 || h < 10) return;
    const hit = view.posAtCoords({ left: s.x, top: s.y });
    const pos = hit ? hit.pos : view.state.doc.content.size;
    const st = view.state.apply(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos))));
    insertTable(st, (tr) => view.dispatch(tr), createTable({ rows: 1, cols: 1, width: Math.min(w, ui.bodyWidth()) }));
    const t = view.state.selection.$from;
    for (let d = t.depth; d > 0; d--) if (t.node(d).type === schema.nodes.table) { setRowHeight(view.state, (tr) => view.dispatch(tr), ui.docState(), h, 'atLeast'); break; }
  }

  return new Plugin({
    key: tableUIKey,
    props: {
      handleDOMEvents: {
        mousemove(view, e) {
          if (drag) return false;
          const mode = ui.mode();
          const info = cellFromEvent(view, e);
          view.dom.classList.toggle('tbl-col-resize', !mode && !!info && edgeAt(info.td, e, ui.zoom()) === 'right');
          view.dom.classList.toggle('tbl-row-resize', !mode && !!info && edgeAt(info.td, e, ui.zoom()) === 'bottom');
          return false;
        },
        mousedown(view, e) {
          if (e.button !== 0) return false;
          const mode = ui.mode();
          const info = cellFromEvent(view, e);
          if (mode === 'draw') {
            e.preventDefault();
            const start = { x: e.clientX, y: e.clientY, info };
            const box = document.createElement('div');
            box.className = 'table-draw-box';
            document.body.append(box);
            const move = (ev) => { box.style.cssText = `left:${Math.min(start.x, ev.clientX)}px;top:${Math.min(start.y, ev.clientY)}px;width:${Math.abs(ev.clientX - start.x)}px;height:${Math.abs(ev.clientY - start.y)}px`; };
            const up = (ev) => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); box.remove(); drawEnd(view, start, ev); };
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
            return true;
          }
          if (!info) return false;
          const edge = edgeAt(info.td, e, ui.zoom());
          if (mode === 'paint') {
            e.preventDefault();
            const r = info.td.getBoundingClientRect();
            const near = edge || [['top', e.clientY - r.top], ['bottom', r.bottom - e.clientY], ['left', e.clientX - r.left], ['right', r.right - e.clientX]].sort((a, b) => a[1] - b[1])[0][0];
            paintEdge(view.state, view.dispatch, ui.docState(), info.cellPos, near, ui.pen());
            return true;
          }
          if (mode === 'erase') {
            e.preventDefault();
            const map = TableMap.get(info.table);
            const rect = map.findCell(info.cellPos - info.tableStart);
            const r = info.td.getBoundingClientRect();
            const side = edge || [['top', e.clientY - r.top], ['bottom', r.bottom - e.clientY], ['left', e.clientX - r.left], ['right', r.right - e.clientX]].sort((a, b) => a[1] - b[1])[0][0];
            const nb = { top: [rect.top - 1, rect.left], bottom: [rect.bottom, rect.left], left: [rect.top, rect.left - 1], right: [rect.top, rect.right] }[side];
            if (nb[0] < 0 || nb[1] < 0 || nb[0] >= map.height || nb[1] >= map.width) return true;
            const other = info.tableStart + map.map[nb[0] * map.width + nb[1]];
            const sel = CellSelection.create(view.state.doc, info.cellPos, other);
            const st = view.state.apply(view.state.tr.setSelection(sel));
            mergeCells(st, (tr) => view.dispatch(tr));
            return true;
          }
          if (edge === 'right' || edge === 'bottom') {
            e.preventDefault();
            if (edge === 'right') startColumnDrag(view, info, e); else startRowDrag(view, info, e);
            const move = (ev) => onMove(ev);
            const up = (ev) => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); finish(view, ev); };
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
            return true;
          }
          return false;
        },
      },
      attributes: () => {
        const mode = ui.mode();
        return mode ? { class: `tbl-mode-${mode}` } : {};
      },
    },
  });
}

/** All table plugins for an editor. */
export const tablePlugins = (ui) => [tableUIPlugin(ui), tableEditing()];
