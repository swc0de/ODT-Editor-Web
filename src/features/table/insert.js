/** Insert ▸ Table: new tables, Quick Tables and Convert Text to Table. */
import { createTable, insertTable, textToTable, applyTableStyle } from '../../core/commands/tables.js';
import { convertTextDialog } from '../../ui/table-dialogs.js';
import { editState } from '../../core/state-step.js';
import { ensureStyles } from '../../core/style-edit.js';
import { V, bodyWidth, docState, runCmd } from './shared.js';

/** Table cells use "Table Contents": make sure the document defines it. */
const ensureTableStyles = (c) => editState(V(c), docState(c), ['commonStyles'], (st) => ensureStyles(st, 'paragraph', ['Table_20_Contents', 'Table_20_Heading']));

export function insertNewTable(c, rows, cols, fit = 'window') {
  ensureTableStyles(c);
  const width = bodyWidth(c);
  runCmd(c, insertTable, createTable({ rows, cols, width }));
  if (fit === 'contents') c.ui.registry.run('tableLayout.autoFitContents');
}

export async function convertSelectionToTable(c) {
  const v = V(c);
  const { from, to } = v.state.selection;
  let tabs = 0;
  v.state.doc.nodesBetween(from, to, (n) => { if (n.isTextblock) { let k = 0; n.forEach((x) => { if (x.type.name === 'tab') k++; }); tabs = Math.max(tabs, k); return false; } return true; });
  const r = await convertTextDialog({ toTable: true, guessCols: tabs + 1 });
  if (!r) return;
  ensureTableStyles(c);
  runCmd(c, textToTable, { separator: r.separator, cols: r.cols, width: bodyWidth(c) });
}

/** Quick Tables: a few ready-made tables with sample content. */
export const QUICK_TABLES = {
  tabularList: { style: 'simpleBanded', data: [['Item', 'Needed'], ['Notebooks', '12'], ['Pens', '40'], ['Folders', '8'], ['Labels', '100']] },
  matrix: { style: 'gridLight', data: [['', 'City A', 'City B', 'City C'], ['City A', '—', '120 km', '310 km'], ['City B', '120 km', '—', '205 km'], ['City C', '310 km', '205 km', '—']] },
  withSubheads: { style: 'listBlue', data: [['Course', 'Term', 'Credits'], ['Introduction to Botany', 'Autumn', '10'], ['Field Methods', 'Spring', '15'], ['Ecology Project', 'Summer', '20']] },
  calendar: { style: 'grid', data: [['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], ['', '', '1', '2', '3', '4', '5'], ['6', '7', '8', '9', '10', '11', '12'], ['13', '14', '15', '16', '17', '18', '19'], ['20', '21', '22', '23', '24', '25', '26'], ['27', '28', '29', '30', '31', '', '']] },
};

export function insertQuickTable(c, id) {
  const q = QUICK_TABLES[id];
  if (!q) return;
  ensureTableStyles(c);
  runCmd(c, insertTable, createTable({ rows: q.data.length, cols: q.data[0].length, width: bodyWidth(c), text: (r, col) => q.data[r][col], header: true }));
  runCmd(c, applyTableStyle, docState(c), q.style);
}
