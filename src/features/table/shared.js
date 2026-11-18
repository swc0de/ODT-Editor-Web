/** Helpers shared by the Insert ▸ Table menu and the Table Design / Table Layout tabs. */
import { closeHistory } from 'prosemirror-history';
import { isInTable, tableAt, columnWidths } from '../../core/commands/tables.js';

export const canEdit = (c) => !!c.editor && c.state.editingMode !== 'viewing';
export const V = (c) => c.editor.view;
export const inTable = (c) => canEdit(c) && isInTable(V(c).state);
export const docState = (c) => c.session.state;

/** Body width (px) of the page where the selection is. */
export function bodyWidth(c) {
  const da = c.ui.docArea;
  const m = da.model;
  const p = da.pages[da.pageAt((c.mainEditor || c.editor).view.state.selection.head)];
  return (m?.masters.get(p?.master) || m?.first)?.bodyWidth || 640;
}

/** Options for column-width aware commands: the table's DOM and the body width. */
export function widthOpts(c) {
  const t = tableAt(V(c).state);
  return { dom: t ? V(c).nodeDOM(t.tablePos) : null, bodyWidth: bodyWidth(c) };
}

/** Runs a (state, dispatch, …args) command on the active editor as its own undo step, and refocuses. */
export const runCmd = (c, fn, ...args) => {
  const v = V(c);
  v.dispatch(closeHistory(v.state.tr));
  const r = fn(v.state, v.dispatch, ...args);
  c.editor.focus();
  return r;
};

/** Current column widths of the table at the selection (px). */
export const widthsAt = (c) => { const t = tableAt(V(c).state); return t ? columnWidths(t.table, V(c).nodeDOM(t.tablePos), bodyWidth(c)) : []; };
