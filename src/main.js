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
import { createDocumentArea } from './layout/document-area.js';
import { showZoomDialog } from './ui/zoom-dialog.js';
import { createBackstage } from './ui/backstage.js';
import { createCommandSearch } from './ui/command-search.js';
import { createKeyTips } from './ui/keytips.js';
import { importOdt } from './core/odt/import.js';
import { exportOdt } from './core/odt/export.js';
import { stateToJSON, createBlankState, documentStats } from './core/document.js';
import { autoFromTree } from './core/odt/styles.js';
import { createEditor } from './core/editor.js';
import { createSession } from './core/session.js';
import { createClipboardActions } from './core/clipboard-actions.js';

function boot() {
  applyTheme();
  const store = createStore({ ...INITIAL_APP_STATE, ribbonCollapsed: !!getSetting('ribbonCollapsed'), showRuler: getSetting('showRuler') !== false, zoom: getSetting('zoom') || 100 });
  const ui = {};
  let editor = null;
  let session = null;
  let clipboard = null;
  const registry = new CommandRegistry({ translate: t, context: () => ({ store, state: store.get(), ui, editor, session, clipboard }) });
  registerFeatures(registry);
  store.subscribe((s, changed) => {
    if (changed.includes('ribbonCollapsed')) setSetting('ribbonCollapsed', s.ribbonCollapsed);
    if (changed.includes('showRuler')) setSetting('showRuler', s.showRuler);
    if (changed.includes('zoom')) setSetting('zoom', s.zoom);
    registry.notify();
  });
  onThemeChange(() => registry.notify());

  document.title = APP_NAME;
  document.documentElement.style.setProperty('--doc-font', `"${defaultBodyFont()}", "Carlito", sans-serif`);

  initTooltips(registry);
  initMenus({ registry, resolve: resolveId, toast });

  // ------------------------------------------------------------ document
  let pictureUrls = new Map();
  const docArea = createDocumentArea({ store, getEditor: () => editor, getSession: () => session });
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
      const t2 = styleName && docArea.styleIndex?.autos.get(`graphic:${styleName}`);
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
    extraPlugins: () => [docArea.plugin()],
    onImageLoad: () => docArea.relayout(),
  };

  const ribbon = createRibbon({ registry, store, tabs: TABS, toast });
  const status = createStatusBar({ registry, store, toast });

  let statsTimer = null;
  const updateStats = () => {
    clearTimeout(statsTimer);
    statsTimer = setTimeout(() => store.set({ words: documentStats(editor.getDoc()).words }), 250);
  };
  editorEnv.onTransaction = (view, tr) => {
    if (tr.getMeta('pagination')) return;
    if (tr.docChanged && !tr.getMeta('load')) { session?.markDirty(); updateStats(); }
    if (tr.getMeta('load')) updateStats();
    if (tr.docChanged) docArea.update();
    if (tr.docChanged || tr.selectionSet) requestAnimationFrame(docArea.syncRulers);
    const hasSelection = !view.state.selection.empty;
    if (hasSelection !== store.get().hasSelection) store.set({ hasSelection });
    else if (tr.docChanged) registry.notify();
  };
  editor = createEditor(docArea.view.mount, editorEnv);
  docArea.attach(editor);
  clipboard = createClipboardActions(editor, toast);

  session = createSession({
    editor,
    toast,
    onLoad(state) {
      for (const url of pictureUrls.values()) URL.revokeObjectURL(url);
      pictureUrls = new Map();
      docArea.applyDocument(state);
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
  ui.docArea = docArea;
  ui.openZoomDialog = () => showZoomDialog({ store, docArea });
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

  document.fonts?.addEventListener?.('loadingdone', () => docArea.relayout());
  session.newDocument({ skipGuard: true });

  const ready = loadBundledFonts().then(() => new Promise((r) => requestAnimationFrame(r))).finally(() => {
    docArea.relayout();
    root.setAttribute('aria-busy', 'false');
  });

  // Offer recovery of documents left unsaved by an earlier session.
  ready.then(() => session.recoverable()).then((list) => {
    if (list.length) toast(t('file.recoverToast', { count: list.length }));
  });

  // Stable hook for tests and debugging.
  window.odtEditor = Object.freeze({
    io: { importOdt, exportOdt, stateToJSON, createBlankState }, registry, store, t, ready, version: APP_VERSION, appName: APP_NAME,
    tabs: TABS, search, keytips, ribbon, editor, session, docArea,
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
