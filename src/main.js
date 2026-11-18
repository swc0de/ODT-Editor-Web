/**
 * Entry point: boots settings, theme, i18n, the command registry and the
 * window chrome (tab bar, ribbon, rulers, page, status bar, Backstage, Alt+Q
 * search, KeyTips), the editor and the document session (open/save/autosave).
 */
import { APP_NAME, APP_VERSION } from './config.js';
import { CommandRegistry } from './core/command-registry.js';
import { createStore, INITIAL_APP_STATE } from './core/app-state.js';
import { getSetting, setSetting } from './core/settings.js';
import { t } from './i18n/index.js';
import { applyTheme, onThemeChange } from './ui/theme.js';
import { h, isTextInput } from './ui/dom.js';
import { registerFeatures, TABS } from './features/index.js';
import { resolveId } from './features/define.js';
import { defaultBodyFont, loadBundledFonts } from './layout/fonts.js';
import { initTooltips } from './ui/tooltip.js';
import { initMenus, isMenuOpen } from './ui/menu.js';
import { toast } from './ui/toast.js';
import { createRibbon } from './ui/ribbon/ribbon.js';
import { createStatusBar } from './ui/statusbar.js';
import { createRulers } from './layout/ruler.js';
import { createBackstage } from './ui/backstage.js';
import { createCommandSearch } from './ui/command-search.js';
import { createKeyTips } from './ui/keytips.js';
import { importOdt } from './core/odt/import.js';
import { exportOdt } from './core/odt/export.js';
import { stateToJSON, createBlankState, documentStats } from './core/document.js';
import { buildStyleIndex, buildDocumentCss, pageLayout, autoFromTree } from './core/odt/styles.js';
import { createEditor } from './core/editor.js';
import { createSession } from './core/session.js';
import { createClipboardActions } from './core/clipboard-actions.js';
import { toPx } from './layout/units.js';
import { TextSelection } from 'prosemirror-state';

/**
 * The document area: canvas, page, rulers and the editor. The page takes its
 * size and margins from the document's default master page; in this
 * continuous view it grows with the content (pagination arrives in M3).
 */
function createDocumentArea(store, editorEnv) {
  const docStyle = h('style', { id: 'odt-doc-css' });
  document.head.append(docStyle);
  const mount = h('div', { class: 'odt-doc' });
  const page = h('div', { class: 'page', role: 'document', 'aria-label': t('region.page', { page: 1 }) }, mount);
  const pages = h('div', { class: 'pages' }, page);
  const canvas = h('div', { class: 'canvas', 'aria-label': t('region.document'), 'data-region': 'document' }, pages);
  const rulers = createRulers({ store });
  const area = h('main', { class: 'doc-area' }, canvas, rulers.hstrip, rulers.vstrip, rulers.corner);
  let marginsPx = { top: 96, right: 96, bottom: 96, left: 96 };
  let pageHeightPx = 1123;
  const sync = () => rulers.update(page, marginsPx, pageHeightPx);
  canvas.addEventListener('scroll', sync, { passive: true });
  new ResizeObserver(sync).observe(canvas);
  new ResizeObserver(sync).observe(page);
  store.subscribe((s, changed) => { if (changed.includes('showRuler') || changed.includes('ribbonCollapsed') || changed.includes('ribbonPeek')) requestAnimationFrame(sync); });
  document.fonts?.ready.then(sync);
  // Clicking the page margin or canvas puts the caret in the document, like Word.
  canvas.addEventListener('mousedown', (e) => {
    if (e.target === canvas || e.target === pages || e.target === page) { e.preventDefault(); editorEnv.focusEnd?.(e); }
  });

  /** Applies a document's styles and page geometry. */
  function applyDocument(state) {
    const index = buildStyleIndex(state);
    docStyle.textContent = buildDocumentCss(state, index);
    const layout = pageLayout(state);
    marginsPx = { top: toPx(layout.marginTop), right: toPx(layout.marginRight), bottom: toPx(layout.marginBottom), left: toPx(layout.marginLeft) };
    page.style.width = `${toPx(layout.width)}px`;
    pageHeightPx = toPx(layout.height);
    page.style.minHeight = `${pageHeightPx}px`;
    page.style.padding = `${marginsPx.top}px ${marginsPx.right}px ${marginsPx.bottom}px ${marginsPx.left}px`;
    page.style.background = layout.background || '';
    requestAnimationFrame(sync);
    return index;
  }
  return { el: area, canvas, page, mount, sync, applyDocument };
}

function boot() {
  applyTheme();
  const store = createStore({ ...INITIAL_APP_STATE, ribbonCollapsed: !!getSetting('ribbonCollapsed'), showRuler: getSetting('showRuler') !== false });
  const ui = {};
  let editor = null;
  let session = null;
  let clipboard = null;
  const registry = new CommandRegistry({ translate: t, context: () => ({ store, state: store.get(), ui, editor, session, clipboard }) });
  registerFeatures(registry);
  store.subscribe((s, changed) => {
    if (changed.includes('ribbonCollapsed')) setSetting('ribbonCollapsed', s.ribbonCollapsed);
    registry.notify();
  });
  onThemeChange(() => registry.notify());

  document.title = APP_NAME;
  document.documentElement.style.setProperty('--doc-font', `"${defaultBodyFont()}", "Carlito", sans-serif`);

  initTooltips(registry);
  initMenus({ registry, resolve: resolveId, toast });

  // ------------------------------------------------------------ document
  let styleIndex = null;
  let pictureUrls = new Map();
  const editorEnv = {
    pictureUrl(path) {
      if (!path || !session?.state) return '';
      if (!pictureUrls.has(path)) {
        const pic = session.state.pictures[path];
        if (!pic) return '';
        pictureUrls.set(path, URL.createObjectURL(new Blob([pic.bytes], { type: pic.mediaType || undefined })));
      }
      return pictureUrls.get(path);
    },
    /** Horizontal placement of an anchored frame from its graphic style. */
    graphicPos(styleName) {
      const t2 = styleName && styleIndex?.autos.get(`graphic:${styleName}`);
      const gp = t2 ? autoFromTree(t2).auto?.props?.['style:graphic-properties']?.a || {} : {};
      if (gp['style:wrap'] === 'none' || gp['style:horizontal-pos'] === 'center') return 'center';
      if (gp['style:horizontal-pos'] === 'right' || gp['style:horizontal-pos'] === 'outside') return 'right';
      return 'left';
    },
    addPicture(bytes, mediaType) {
      const ext = (mediaType.split('/')[1] || 'png').replace('svg+xml', 'svg').replace('jpeg', 'jpg');
      let hash = 0;
      for (let i = 0; i < bytes.length; i += Math.max(1, bytes.length >> 12)) hash = (hash * 31 + bytes[i]) >>> 0;
      const path = `Pictures/${hash.toString(16)}${bytes.length.toString(16)}.${ext}`;
      session.state.pictures[path] = { bytes, mediaType };
      return path;
    },
    openFiles(files) { if (files[0]) session.openFile(files[0]).then((ok) => { if (ok) store.set({ backstageOpen: false }); }); },
    focusEnd(e) {
      const view = editor.view;
      const pos = view.posAtCoords({ left: e.clientX, top: e.clientY });
      const sel = pos ? TextSelection.near(view.state.doc.resolve(pos.pos)) : TextSelection.atEnd(view.state.doc);
      view.dispatch(view.state.tr.setSelection(sel));
      view.focus();
    },
  };

  const ribbon = createRibbon({ registry, store, tabs: TABS, toast });
  const docArea = createDocumentArea(store, editorEnv);
  const status = createStatusBar({ registry, store, toast });

  let statsTimer = null;
  const updateStats = () => {
    clearTimeout(statsTimer);
    statsTimer = setTimeout(() => store.set({ words: documentStats(editor.getDoc()).words }), 250);
  };
  editorEnv.onTransaction = (view, tr) => {
    if (tr.docChanged && !tr.getMeta('load')) { session?.markDirty(); updateStats(); }
    if (tr.getMeta('load')) updateStats();
    const hasSelection = !view.state.selection.empty;
    if (hasSelection !== store.get().hasSelection) store.set({ hasSelection });
    else if (tr.docChanged) registry.notify();
  };
  editor = createEditor(docArea.mount, editorEnv);
  clipboard = createClipboardActions(editor, toast);

  session = createSession({
    editor,
    toast,
    onLoad(state) {
      for (const url of pictureUrls.values()) URL.revokeObjectURL(url);
      pictureUrls = new Map();
      styleIndex = docArea.applyDocument(state);
    },
    onChange(info) { store.set({ docTitle: info.name, dirty: info.dirty }); },
  });

  const backstage = createBackstage({ registry, store, toast, session });
  const search = createCommandSearch({ registry, tabs: TABS, toast });
  const keytips = createKeyTips({ ribbon, store, openCommandSearch: () => search.open() });

  // Regions cycled by F6 / Shift+F6.
  const regions = () => [ribbon.tabbar, ribbon.ribbon, docArea.canvas, status.el].filter((r) => !r.hidden && r.getClientRects().length);
  ui.openCommandSearch = () => search.open();
  ui.showKeyTips = () => keytips.start();
  ui.cycleRegion = (dir) => {
    if (store.get().backstageOpen) return;
    const list = regions();
    const i = list.findIndex((r) => r.contains(document.activeElement));
    const next = list[(i + dir + list.length) % list.length];
    if (next === ribbon.tabbar) ribbon.focusTabs();
    else if (next === docArea.canvas) editor.focus();
    else (next.querySelector('button:not([tabindex="-1"]), input, [tabindex="0"]') || next).focus();
  };

  const root = document.getElementById('app');
  const shell = h('div', { class: 'shell' }, ribbon.tabbar, ribbon.ribbon, docArea.el, status.el);
  root.replaceChildren(shell, backstage.el);
  store.subscribe((s, changed) => {
    if (changed.includes('backstageOpen')) {
      shell.inert = s.backstageOpen;
      if (!s.backstageOpen) requestAnimationFrame(() => editor.focus());
    }
  });

  // Global shortcuts (Ctrl+F1, Alt+Q, F6…). Inside text fields only
  // modifier/function-key shortcuts apply, so typing stays untouched.
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || keytips.isActive() || isMenuOpen() || search.isOpen() || document.querySelector('.dlg-overlay')) return;
    if (store.get().backstageOpen && e.key !== 'F6') {
      if (!(e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(e.key))) return;
    }
    if (isTextInput(e.target) && !(e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(e.key))) return;
    const id = registry.handleKeydown(e);
    if (id && !registry.isEnabled(id) && registry.get(id).comingSoon) toast(t('toast.comingSoon', { name: registry.label(id) }));
    if (e.key === 'Escape' && store.get().ribbonPeek) store.set({ ribbonPeek: false });
  });

  // Drag and drop an .odt anywhere to open it.
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  addEventListener('drop', (e) => {
    if (!hasFiles(e) || e.defaultPrevented) return;
    e.preventDefault();
    const file = [...e.dataTransfer.files].find((f) => /\.(odt|ott)$/i.test(f.name));
    if (file) editorEnv.openFiles([file]);
  });

  addEventListener('resize', () => docArea.sync());
  session.newDocument({ skipGuard: true });

  const ready = loadBundledFonts().then(() => new Promise((r) => requestAnimationFrame(r))).finally(() => {
    docArea.sync();
    root.setAttribute('aria-busy', 'false');
  });

  // Offer recovery of documents left unsaved by an earlier session.
  ready.then(() => session.recoverable()).then((list) => {
    if (list.length) toast(t('file.recoverToast', { count: list.length }));
  });

  // Stable hook for tests and debugging.
  window.odtEditor = Object.freeze({
    io: { importOdt, exportOdt, stateToJSON, createBlankState }, registry, store, t, ready, version: APP_VERSION, appName: APP_NAME,
    tabs: TABS, search, keytips, ribbon, editor, session,
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
