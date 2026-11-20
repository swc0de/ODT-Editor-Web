/**
 * View ▸ Window: New Window (the same document, kept in sync), Arrange All,
 * View Side by Side with Synchronous Scrolling, Switch Windows and Full
 * Screen. The cross-window messaging lives in core/window-sync.js.
 */
import { createWindowHub, WINDOW_ID } from '../core/window-sync.js';
import { stateToJSON, stateFromJSON } from '../core/document.js';
import { showDialog } from './dialog.js';
import { h } from './dom.js';
import { t } from '../i18n/index.js';

export function createWindows({ store, getEditor, getSession, docArea, toast, onTitle }) {
  const params = new URLSearchParams(location.hash.slice(1));
  const openedBy = params.get('from');
  let joining = false;

  const hub = createWindowHub({
    title: () => document.title.replace(/^● /, ''),
    view: () => getEditor().view,
    reconfigure(add, removeOnly = false) {
      const view = getEditor().view;
      const st = view.state;
      const keep = st.plugins.filter((p) => !String(p.key).startsWith('collab$'));
      view.updateState(st.reconfigure({ plugins: removeOnly ? keep : [...keep, ...add] }));
    },
    snapshot: () => {
      const session = getSession();
      return { json: stateToJSON(session.currentState()), name: session.info.name };
    },
    load(json, name) {
      joining = true;
      try { getSession().load(stateFromJSON(json), { name, dirty: false }); } finally { joining = false; }
    },
    pictures: () => getSession()?.state?.pictures,
    addPictures(map) { Object.assign(getSession().state.pictures, map); getEditor().refresh(); },
    onChange: () => { updateTitle(); store.set({ windowsVersion: (store.get().windowsVersion || 0) + 1 }); },
    onFocusRequest: () => window.focus(),
    onArrange: (rect) => place(rect),
    onPartner: (id) => store.set({ sideBySide: id, syncScroll: !!id }),
    syncScroll: () => !!store.get().syncScroll,
    onScroll: (dx, dy) => {
      const c = docArea.canvas;
      c.scrollBy(dx, dy);
      // Remember where that left us, so the resulting scroll event isn't sent back.
      lastTop = c.scrollTop;
      lastLeft = c.scrollLeft;
    },
  });
  if (openedBy && window.opener) hub.addRef(openedBy, window.opener);

  function updateTitle() {
    const g = hub.group;
    const others = g ? hub.list().filter((w) => !w.self && w.group === g.key).length : 0;
    onTitle?.(g && others ? `:${g.n}` : '');
  }

  // ------------------------------------------------------------ New Window

  function newWindow() {
    const key = hub.startGroup();
    const url = `${location.href.split('#')[0]}#join=${encodeURIComponent(key)}&from=${WINDOW_ID}`;
    const w = Math.round(Math.min(screen.availWidth, window.outerWidth));
    const hgt = Math.round(Math.min(screen.availHeight, window.outerHeight));
    const ref = window.open(url, '_blank', `popup,width=${w},height=${hgt},left=${Math.round(window.screenX + 40)},top=${Math.round(window.screenY + 40)}`);
    if (!ref) { toast(t('win.blocked')); return null; }
    pendingRefs.push(ref);
    return ref;
  }
  const pendingRefs = [];
  // A window we opened says hello: remember its WindowProxy (to focus and arrange it).
  const seen = new Set();
  store.subscribe((_s, changed) => {
    if (!changed.includes('windowsVersion') || !pendingRefs.length) return;
    for (const w of hub.list()) if (!w.self && !seen.has(w.id)) { seen.add(w.id); if (!hub.hasRef(w.id) && pendingRefs.length) hub.addRef(w.id, pendingRefs.shift()); }
  });

  /** In a window opened by New Window: load the document from its group. */
  async function joinFromUrl() {
    const key = params.get('join');
    if (!key) return false;
    history.replaceState(null, '', location.href.split('#')[0]);
    const ok = await hub.join(key);
    if (!ok) toast(t('win.joinFailed'));
    return ok;
  }

  // ------------------------------------------------------------ arranging

  const avail = () => ({ left: screen.availLeft ?? 0, top: screen.availTop ?? 0, width: screen.availWidth, height: screen.availHeight });

  /** Moves and resizes this window (browsers allow it only for windows opened by the app). */
  function place(rect) {
    try {
      window.moveTo(rect.left, rect.top);
      window.resizeTo(rect.width, rect.height);
    } catch { /* not allowed */ }
  }

  function placeAll(rects) {
    const before = [window.screenX, window.screenY, window.outerWidth, window.outerHeight].join();
    for (const [id, rect] of rects) { if (id === WINDOW_ID) place(rect); else hub.arrange(id, rect); }
    // A browser tab can't be moved or resized by a page; say so instead of failing silently.
    setTimeout(() => {
      const mine = rects.find(([id]) => id === WINDOW_ID)?.[1];
      const after = [window.screenX, window.screenY, window.outerWidth, window.outerHeight].join();
      if (mine && before === after && (Math.abs(window.outerWidth - mine.width) > 4 || Math.abs(window.outerHeight - mine.height) > 4)) toast(t('win.arrangeLimited'));
    }, 400);
  }

  function arrangeAll() {
    const wins = hub.list();
    const a = avail();
    const hEach = Math.floor(a.height / wins.length);
    placeAll(wins.map((w, i) => [w.id, { left: a.left, top: a.top + i * hEach, width: a.width, height: hEach }]));
  }

  async function chooseWindow(title) {
    const others = hub.list().filter((w) => !w.self);
    if (others.length <= 1) return others[0] || null;
    const select = h('select', { class: 'dlg-select', 'aria-label': title }, others.map((w) => h('option', { value: w.id }, w.title)));
    const ok = await showDialog({ title, message: h('div', { class: 'ref-dlg' }, h('p', {}, t('win.compareWith')), select), buttons: [{ label: t('common.ok'), value: true, primary: true }, { label: t('common.cancel'), value: false }], cancelValue: false });
    return ok ? others.find((w) => w.id === select.value) : null;
  }

  async function sideBySide() {
    if (store.get().sideBySide) { hub.pair(store.get().sideBySide, false); return; }
    const other = await chooseWindow(t('win.sideBySideTitle'));
    if (!other) return;
    const a = avail();
    const half = Math.floor(a.width / 2);
    hub.pair(other.id, true);
    placeAll([[WINDOW_ID, { left: a.left, top: a.top, width: half, height: a.height }], [other.id, { left: a.left + half, top: a.top, width: a.width - half, height: a.height }]]);
  }

  // Synchronous Scrolling: pass this window's scroll movement to the partner.
  let lastTop = 0;
  let lastLeft = 0;
  docArea.canvas.addEventListener('scroll', () => {
    const c = docArea.canvas;
    const dx = c.scrollLeft - lastLeft;
    const dy = c.scrollTop - lastTop;
    lastTop = c.scrollTop;
    lastLeft = c.scrollLeft;
    if (store.get().sideBySide && store.get().syncScroll && (dx || dy)) hub.scroll(dx, dy);
  }, { passive: true });

  // ------------------------------------------------------------ full screen

  function setFullScreen(on) {
    store.set({ fullScreen: on });
    try {
      if (on && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
      if (!on && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    } catch { /* the ribbon still hides */ }
  }
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && store.get().fullScreen) store.set({ fullScreen: false }); });

  return {
    hub,
    newWindow,
    joinFromUrl,
    arrangeAll,
    sideBySide,
    setFullScreen,
    /** A new document was loaded here: it is no longer shared. */
    onLoad() { if (!joining && hub.group) hub.leaveGroup(); },
    /** After every local edit: send the steps to the other windows. */
    afterTransaction(tr) { if (hub.group && tr.docChanged && !tr.getMeta('remote')) queueMicrotask(() => hub.flush()); },
    windows: () => hub.list(),
    focus: (id) => hub.focus(id),
  };
}
