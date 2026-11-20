/**
 * View ▸ Split: a second, independently scrolling pane of the same document
 * below the first. It is a second editor whose document is kept identical to
 * the main one: edits made in either pane are applied to the other as the
 * same steps (the main editor stays the one that is saved and undone).
 */
import { h } from './dom.js';
import { t } from '../i18n/index.js';

export function createSplitView({ docArea, store, getMain, createEditor, env, onFocusChange }) {
  const mount = h('div', { class: 'odt-doc split-doc' });
  const page = h('div', { class: 'split-page' }, mount);
  const scroller = h('div', { class: 'split-scroll', 'aria-label': t('win.splitPane') }, page);
  const bar = h('div', { class: 'split-bar', role: 'separator', 'aria-orientation': 'horizontal', tabindex: '0', 'aria-label': t('win.splitBar') });
  const pane = h('div', { class: 'split-pane', hidden: true }, bar, scroller);
  docArea.el.append(pane);
  let editor = null;
  let ratio = 0.5;
  let focused = false;

  function layout() {
    const total = docArea.el.clientHeight;
    const hgt = Math.round(Math.max(80, Math.min(total - 80, total * ratio)));
    pane.style.height = `${hgt}px`;
    docArea.el.style.setProperty('--split-h', `${hgt}px`);
    const m = docArea.model;
    page.style.width = `${m?.first.bodyWidth || 640}px`;
    page.style.zoom = String(store.get().zoom / 100);
  }

  function create() {
    editor = createEditor(mount, {
      ...env,
      onTransaction(view, tr, transactions = [tr]) {
        if (tr.getMeta('load')) return;
        // Edits made here go to the main editor as the same steps.
        const main = getMain();
        const steps = transactions.filter((x) => x.docChanged && !x.getMeta('mirror')).flatMap((x) => x.steps);
        if (!steps.length) return;
        const mt = main.view.state.tr;
        for (const s of steps) mt.step(s);
        main.view.dispatch(mt.setMeta('fromSplit', true));
      },
    });
    // Commands act on the pane last typed in (focus moves to the ribbon in between).
    editor.view.dom.addEventListener('focus', () => { focused = true; onFocusChange?.(); });
    editor.setDoc(getMain().getDoc());
  }

  /** Main editor transactions (all of them, including appended ones). */
  function mirror(root, transactions) {
    if (!editor || pane.hidden) return;
    if (root.getMeta('load')) { editor.setDoc(getMain().getDoc()); return; }
    const steps = transactions.filter((x) => x.docChanged && !(x === root && root.getMeta('fromSplit'))).flatMap((x) => x.steps);
    if (!steps.length) return;
    const tr = editor.view.state.tr;
    try {
      for (const s of steps) tr.step(s);
    } catch {
      editor.setDoc(getMain().getDoc());
      return;
    }
    editor.view.dispatch(tr.setMeta('mirror', true).setMeta('addToHistory', false));
  }

  function setOn(on) {
    store.set({ splitView: on });
    pane.hidden = !on;
    docArea.el.classList.toggle('is-split', on);
    if (on) {
      if (!editor) create(); else editor.setDoc(getMain().getDoc());
      layout();
      // The lower pane starts where the upper one is.
      const sel = getMain().view.state.selection.head;
      requestAnimationFrame(() => { try { editor.focusAt(sel); } catch { /* empty */ } });
    } else {
      focused = false;
      getMain().focus();
    }
    requestAnimationFrame(() => docArea.syncRulers());
  }

  bar.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    bar.setPointerCapture?.(e.pointerId);
    const r = docArea.el.getBoundingClientRect();
    const move = (ev) => { ratio = Math.max(0.1, Math.min(0.9, (r.bottom - ev.clientY) / r.height)); layout(); };
    const up = () => { bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up); docArea.syncRulers(); };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
  });
  bar.addEventListener('dblclick', () => setOn(false));
  new ResizeObserver(() => { if (!pane.hidden) layout(); }).observe(docArea.el);
  store.subscribe((_s, changed) => { if (changed.includes('zoom') && !pane.hidden) layout(); });

  return {
    toggle: () => setOn(pane.hidden),
    setOn,
    mirror,
    isOn: () => !pane.hidden,
    /** The lower pane's editor while it has the focus (commands act on it). */
    activeEditor: () => (editor && !pane.hidden && focused ? editor : null),
    get editor() { return editor; },
    /** The main editor got the focus. */
    mainFocused: () => { focused = false; },
  };
}
