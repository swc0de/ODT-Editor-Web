/**
 * App (UI) state: a small observable store. Commands read it through the
 * registry context and change it with set(); the UI subscribes to updates.
 * Document state (ProseMirror) arrives in M2 and lives beside this.
 */
export function createStore(initial) {
  let state = { ...initial };
  const listeners = new Set();
  return {
    get: () => state,
    set(patch) {
      const next = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
      const changed = Object.keys(next).filter((k) => next[k] !== state[k]);
      if (!changed.length) return;
      state = next;
      listeners.forEach((fn) => fn(state, changed));
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

export const INITIAL_APP_STATE = Object.freeze({
  activeTab: 'home',
  backstageOpen: false,
  backstagePage: 'home',
  ribbonCollapsed: false,
  ribbonPeek: false, // collapsed ribbon temporarily shown after clicking a tab
  view: 'print', // 'read' | 'print' | 'web' | 'outline' | 'draft' | 'immersive'
  outlineFormatting: true,
  outlineFirstLine: false,
  focusMode: false,
  irColumnWidth: 680,
  irPageColour: 'none',
  irLineFocus: 0,
  irTextSpacing: false,
  irSyllables: false,
  darkPage: false,
  splitView: false,
  fullScreen: false,
  sideBySide: null, // the partner window's id
  syncScroll: false,
  windowsVersion: 0,
  readColumns: 'default', // Read Mode column width: narrow | default | wide
  readColour: 'none', // Read Mode page colour: none | sepia | inverse
  pageMovement: 'vertical', // 'vertical' | 'side'
  hideWhiteSpace: false,
  gridlines: false,
  page: 1,
  pageCount: 1,
  zoom: 100,
  editingMode: 'editing', // 'editing' | 'reviewing' | 'viewing'
  // Review tab (M9)
  trackChanges: false,
  trackLock: false,
  reviewDisplay: 'all', // 'simple' | 'all' | 'none' | 'original'
  reviewHide: { insdel: false, fmt: false, comments: false, authors: [] },
  reviewingPane: null, // null | 'vertical' | 'horizontal'
  commentsView: 'contextual', // 'contextual' (balloons) | 'list' (Comments pane)
  restrict: null, // null | 'readonly' | 'comments' | 'tracked' | 'forms'
  readingAloud: false,
  drawTool: 'select',
  inkToShape: false,
  mergePreview: false,
  ccDesign: false,
  mergeRecord: 1,
  mergeHighlight: false,
  inkReplaying: false,
  fontName: 'Aptos',
  fontSize: 12,
  paragraphStyle: 'Normal',
  paraAlign: 'left',
  paraDir: 'ltr',
  hasSelection: false,
  objectSelected: false,
  showRuler: true,
  docTitle: null,
  docFormat: null,
  saveAsFormat: null,
  dirty: false,
  words: 0,
  // Home tab (M4)
  styleId: 'normal',
  styleSamples: null,
  showMarks: false,
  formatPainter: false,
  dictating: false,
  navigationPane: false,
  stylesPane: false,
  lastHighlight: '#ffff00',
  lastFontColour: '#c00000',
  lastShading: '#d9d9d9',
  lastUnderlineColour: '#c00000',
  lastBorder: 'home.borderBottom',
  listPresets: {},
  // M5
  contextual: null, // contextual ribbon tab shown ('headerFooter', …)
  hfEditing: null,
  paraSpins: null,
  designTheme: 'classic', designColours: 'classic', designFonts: 'carlito', designSet: null, designSpacing: null,
  lastPageColour: '#f2f2f2',
  // M6
  tableMode: null, // 'draw' | 'erase' | 'paint'
  tablePen: { style: 'solid', width: '0.5pt', colour: '#000000' },
  tableGridlines: true,
  lastTableShading: '#d9d9d9',
  lastTableBorder: 'all',
  inTable: false,
});
