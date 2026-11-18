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
  view: 'print', // 'read' | 'print' | 'web' | 'outline' | 'draft'
  pageMovement: 'vertical',
  zoom: 100,
  editingMode: 'editing', // 'editing' | 'reviewing' | 'viewing'
  drawTool: 'select',
  fontName: 'Aptos',
  fontSize: 12,
  paragraphStyle: 'Normal',
  paraAlign: 'left',
  paraDir: 'ltr',
  hasSelection: false,
  objectSelected: false,
  showRuler: true,
  docTitle: null,
});
