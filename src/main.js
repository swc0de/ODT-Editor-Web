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
import { initMenus, isMenuOpen, openMenu } from './ui/menu.js';
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
import { createEditor } from './core/editor.js';
import { createSession } from './core/session.js';
import { createClipboardActions } from './core/clipboard-actions.js';
import { editingPlugins, AUTOCORRECT_DEFAULTS } from './core/editing-plugins.js';
import { searchPlugin } from './core/search.js';
import { listLabelsPlugin, ensureListStyle, LIST_LIBRARY } from './core/commands/lists.js';
import { createFormatPainter } from './core/format-painter.js';
import { createDictation } from './core/dictation.js';
import { createDock, createNavigationPane, createStylesPane } from './ui/panes.js';
import { createFindDialog } from './ui/find-dialog.js';
import { createMiniToolbar, attachContextMenu } from './ui/mini-toolbar.js';
import { createHeaderFooter } from './ui/header-footer.js';
import { createObjectServices } from './ui/objects.js';
import { notesNumberingPlugin } from './core/notes.js';
import { findStyle } from './core/style-edit.js';
import { renderEquation } from './ui/equation-editor.js';
import { renderChartFrame } from './ui/chart-dialog.js';
import { createSelectionPane } from './ui/selection-pane.js';
import { linkFollowPlugin } from './features/insert/text-parts.js';
import { formatAt, GALLERY_STYLES, styleActions, useStyle, getListStyle } from './features/home/index.js';
import { spinValues } from './features/layout/index.js';
import { tableSpinValues } from './features/table/layout.js';
import { objectSpinValues } from './features/objects/format.js';
import { isInTable, tableAt } from './core/commands/tables.js';
import { textPropsCss } from './core/odt/css.js';
import { sizePt } from './core/commands/text.js';
import { createRepeat, createGoBack, extendSelection } from './core/navigation.js';
import { findWrapping } from 'prosemirror-transform';
import { TextSelection, NodeSelection, Plugin } from 'prosemirror-state';
import * as pasteModes from './core/paste-modes.js';
import { schema } from './core/schema.js';
import { stateSteps } from './core/state-step.js';
import { tablePlugins, tableKeymap } from './core/table-plugins.js';

function boot() {
  applyTheme();
  const store = createStore({ ...INITIAL_APP_STATE, ribbonCollapsed: !!getSetting('ribbonCollapsed'), showRuler: getSetting('showRuler') !== false, zoom: getSetting('zoom') || 100 });
  const ui = {};
  let editor = null;
  let session = null;
  let clipboard = null;
  // Commands act on the active editor: the body, or a header/footer being edited.
  const activeEditor = () => ui.hf?.activeEditor() || ui.objects?.activeEditor() || editor;
  const registry = new CommandRegistry({ translate: t, context: () => ({ store, state: store.get(), ui, editor: activeEditor(), mainEditor: editor, session, clipboard }) });
  ui.registry = registry;
  ui.toast = (msg) => toast(msg);
  const ctx = () => ({ store, state: store.get(), ui, editor: activeEditor(), mainEditor: editor, session, clipboard });
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
  /** What the table plugins need from the app. */
  const tableUI = {
    zoom: () => store.get().zoom / 100,
    docState: () => session?.state,
    bodyWidth: () => { const m = docArea.model; const p = docArea.pages[docArea.pageAt(editor?.view.state.selection.head ?? 0)]; return (m?.masters.get(p?.master) || m?.first)?.bodyWidth || 640; },
    mode: () => store.get().tableMode || null,
    pen: () => { const p = store.get().tablePen; return `${p.width} ${p.style} ${p.colour}`; },
  };
  const docArea = createDocumentArea({ store, getEditor: () => editor, getSession: () => session, pictureUrl: (p) => editorEnv.pictureUrl(p), onPagesChange: () => ui.onPages?.() });
  const editorEnv = {
    // Enter at the end of a paragraph: its style's next style.
    nextStyle: (name) => { const st = session && findStyle(session.state, 'paragraph', name); return st ? (st.a['style:next-style-name'] || name) : name; },
    pictureUrl(path) {
      if (!path || !session?.state) return '';
      path = path.replace(/^\.\//, '');
      if (!pictureUrls.has(path)) {
        const pic = session.state.pictures[path] || session.state.extraFiles?.[path];
        if (!pic) return '';
        pictureUrls.set(path, URL.createObjectURL(new Blob([pic.bytes], { type: pic.mediaType || undefined })));
      }
      return pictureUrls.get(path);
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
    priorityPlugins: () => [new Plugin({ props: { handleKeyDown: (_v, e) => !!ui.handleEditorKey?.(e) } }), ...(ui.objects ? [ui.objects.keyPlugin] : []), tableKeymap, ...editingPlugins(() => ({ ...AUTOCORRECT_DEFAULTS, ...(getSetting('autocorrect') || {}) }), makeList)],
    extraPlugins: () => [...docArea.plugins(), notesNumberingPlugin(() => session?.state, () => (docArea.pages.length ? (pos) => docArea.pageAt(pos) : null)), ...tablePlugins(tableUI), linkFollowPlugin(() => store.get().editingMode === 'viewing'), searchPlugin(), listLabelsPlugin((name) => getListStyle(ctx(), name))],
    pasteMode(event) {
      const once = clipboard?.takeMode();
      if (once) return once;
      const html = event?.clipboardData?.getData?.('text/html') || '';
      return (html.includes('data-pm-slice') ? getSetting('pasteWithin') : getSetting('pasteOther')) || 'keep';
    },
    onPasted: (info) => pasteOptions(info),
    onImageLoad: () => docArea.relayout(),
  };

  /** AutoCorrect "* " / "1. ": wraps the paragraph of tr's selection in a list. */
  function makeList(tr, kind, match) {
    let levels = LIST_LIBRARY[kind === 'bullet' ? 'bullet' : 'number'][0];
    if (kind === 'bullet' && match[0].trim() === '-') levels = [{ bullet: '–' }, ...levels.slice(1)];
    if (kind === 'number') levels = [{ format: match[1].replace(/[1]/, '1'), suffix: match[2] }, ...levels.slice(1)];
    const name = ensureListStyle(session.state, levels);
    const range = tr.selection.$from.blockRange();
    const wrapping = range && findWrapping(range, schema.nodes.list, { styleName: name, ordered: kind !== 'bullet', extra: null });
    if (!wrapping) return null;
    return tr.wrap(range, wrapping);
  }

  const ribbon = createRibbon({ registry, store, tabs: TABS, toast });
  const status = createStatusBar({ registry, store, toast });

  let statsTimer = null;
  const updateStats = () => {
    clearTimeout(statsTimer);
    statsTimer = setTimeout(() => store.set({ words: documentStats(editor.getDoc()).words }), 250);
  };
  editorEnv.onTransaction = (view, tr) => {
    if (tr.getMeta('pagination')) return;
    // Page styles / named styles changed (or were undone): apply and re-render.
    const ss = stateSteps(tr);
    if (ss.length) {
      for (const s of ss) session.state[s.key] = s.after;
      docArea.applyDocument(session.state);
      ui.onStylesChanged?.();
    }
    if (tr.docChanged && !tr.getMeta('load')) { session?.markDirty(); updateStats(); }
    if (tr.getMeta('load')) updateStats();
    if (tr.docChanged) docArea.update();
    if (tr.docChanged || tr.selectionSet) requestAnimationFrame(docArea.syncRulers);
    const hasSelection = !view.state.selection.empty;
    if (hasSelection !== store.get().hasSelection) store.set({ hasSelection });
    ui.trackEdit?.(tr, view.state);
    scheduleSync(tr.docChanged && !tr.getMeta('load'));
  };

  // Ribbon state (font, size, style, toggles) follows the selection, once per frame.
  // While typing, wait for a pause so keystrokes stay within a frame.
  let syncFrame = 0;
  let syncTimer = 0;
  function scheduleSync(typing = false) {
    if (typing) {
      clearTimeout(syncTimer);
      cancelAnimationFrame(syncFrame);
      syncFrame = 0;
      syncTimer = setTimeout(() => scheduleSync(false), 120);
      return;
    }
    if (syncFrame) return;
    syncFrame = requestAnimationFrame(() => {
      syncFrame = 0;
      const f = formatAt(ctx());
      const font = String(f.text['style:font-name'] || f.text['fo:font-family'] || 'Carlito').replace(/^['"]|['"]$/g, '');
      const styleName = f.node?.attrs.styleName;
      const styleId = (f.charStyle && Object.keys(GALLERY_STYLES).find((k) => GALLERY_STYLES[k][1] === f.charStyle))
        || Object.keys(GALLERY_STYLES).find((k) => GALLERY_STYLES[k][0] === 'paragraph' && GALLERY_STYLES[k][1] === styleName) || null;
      // Contextual tabs: Header & Footer while editing one, Table Design / Layout inside a table.
      const c2 = ctx();
      const inTbl = isInTable(c2.editor.view.state);
      const obj = ui.objects.selected(c2.editor) || ui.objects.selected(editor);
      const objTab = obj ? (obj.node.attrs.kind === 'image' ? 'picture' : (['shape', 'textbox', 'wordart', 'line'].includes(obj.node.attrs.kind) ? 'shape' : null)) : null;
      const contextual = [store.get().hfEditing && 'headerFooter', inTbl && 'table', objTab].filter(Boolean).join(' ') || null;
      const tabNow = store.get().activeTab;
      const leaveTab = (!inTbl && (tabNow === 'tableDesign' || tabNow === 'tableLayout')) || (objTab !== 'picture' && tabNow === 'pictureFormat') || (objTab !== 'shape' && tabNow === 'shapeFormat');
      const tbl = inTbl ? tableAt(c2.editor.view.state) : null;
      store.set({
        fontName: font, fontSize: sizePt(f.text['fo:font-size']), styleId, paragraphStyle: styleName,
        paraSpins: { ...spinValues(c2), ...tableSpinValues(c2), ...objectSpinValues(c2) }, contextual, inTable: inTbl, objectKind: obj?.node.attrs.kind || null,
        tableStyleId: tbl?.table.attrs.extra?.['table:template-name'] || null,
        ...(leaveTab ? { activeTab: 'home' } : {}),
      });
      registry.notify();
      nav?.refresh();
      stylesPane?.refresh();
      ui.selectionPane?.refresh();
    });
  }

  /** Style gallery samples rendered from the document's own styles. */
  function updateStyleSamples() {
    const index = docArea.styleIndex;
    if (!index) return;
    const samples = {};
    for (const [id, [family, name]] of Object.entries(GALLERY_STYLES)) {
      const a = index.effective(family, name, { includeDefault: false })?.props?.['style:text-properties']?.a || {};
      const css = {};
      if (a['fo:color']) css.color = a['fo:color'];
      if (a['fo:font-weight']) css.fontWeight = a['fo:font-weight'] === 'bold' ? '700' : a['fo:font-weight'];
      if (a['fo:font-style']) css.fontStyle = a['fo:font-style'];
      if (a['style:font-name']) css.fontFamily = textPropsCss({ 'style:font-name': a['style:font-name'] })[0].slice('font-family:'.length);
      samples[id] = css;
    }
    store.set({ styleSamples: samples });
  }
  // Drawing objects: node view services, nested text editors, selection.
  ui.objects = createObjectServices({
    store, docArea, getSession: () => session, getMainEditor: () => editor, createEditor, toast, t, registry,
    nestedEnv: ({ onTransaction }) => ({
      ...editorEnv,
      extraPlugins: () => [searchPlugin(), listLabelsPlugin((name) => getListStyle(ctx(), name))],
      onTransaction: (v, tr) => { onTransaction(v, tr); scheduleSync(tr.docChanged); },
    }),
  });
  Object.assign(editorEnv, ui.objects.env);
  docArea.notes.setCreateNested(ui.objects.createNested);
  ui.objects.renderers.equation = renderEquation;
  ui.objects.renderers.chart = renderChartFrame;
  ui.objects.setAddPicture((bytes, type) => editorEnv.addPicture(bytes, type));
  editor = createEditor(docArea.view.mount, editorEnv);
  // Back in the body: commands act on it again.
  editor.view.dom.addEventListener('focus', () => ui.objects.leaveInner());
  docArea.attach(editor);
  clipboard = createClipboardActions(editor, toast);
  ui.painter = createFormatPainter({ editor, store });
  ui.dictation = createDictation({ editor, store, toast, t });
  const repeat = createRepeat(registry);
  ui.repeat = repeat.run;
  ui.canRepeat = repeat.can;
  const goBack = createGoBack(editor);
  ui.goBack = goBack.run;
  ui.trackEdit = goBack.track;
  ui.extendSelection = () => extendSelection(editor);
  ui.onStylesChanged = () => { updateStyleSamples(); stylesPane.refresh(); };

  // Panes: Navigation (left) and Styles (right).
  const relayoutDocks = () => requestAnimationFrame(() => docArea.syncRulers());
  const leftDock = createDock('left', { onResize: relayoutDocks });
  const rightDock = createDock('right', { onResize: relayoutDocks });
  ui.findDialog = createFindDialog({ editor, docArea, toast });
  const nav = createNavigationPane({ dock: leftDock, editor, docArea, store, openReplace: (tab, q) => ui.findDialog.open(tab, q) });
  ui.nav = nav;
  const stylesPane = createStylesPane({
    dock: rightDock, store,
    listStyles: () => {
      const index = docArea.styleIndex;
      if (!index) return [];
      const used = new Set();
      editor.view.state.doc.descendants((n) => {
        if (n.isTextblock) used.add(`paragraph:${n.attrs.styleName}`);
        if (n.isText) for (const m of n.marks) if (m.type.name === 'charStyle') used.add(`text:${m.attrs.name}`);
        return true;
      });
      const out = [];
      for (const family of ['paragraph', 'text']) {
        for (const name of index.families.get(family)?.keys() || []) out.push({ family, name, display: index.displayName(family, name), inUse: used.has(`${family}:${name}`) });
      }
      return out.sort((a, b) => a.display.localeCompare(b.display));
    },
    current: () => { const f = formatAt(ctx()); return { paragraph: f.node?.attrs.styleName, text: f.charStyle }; },
    apply: (family, name) => useStyle(ctx(), family, name),
    actions: new Proxy({}, { get: (_o, k) => (...a) => styleActions(ctx())[k](...a) }),
    previewCss: (family, name) => {
      const a = docArea.styleIndex?.effective(family, name, { includeDefault: false })?.props?.['style:text-properties']?.a || {};
      const decl = textPropsCss(a).filter((d) => !/^(font-size|display|transform)/.test(d));
      const pt = sizePt(a['fo:font-size']);
      decl.push(`font-size:${Math.min(16, Math.max(9, pt * 0.9))}pt`);
      return decl.join(';');
    },
  });
  ui.stylesPane = stylesPane;
  const selectionPane = createSelectionPane({ dock: rightDock, store, getEditor: () => editor, registry });
  ui.selectionPane = selectionPane;

  // Header / footer editing: a second editor with the same editing behaviour.
  ui.hf = createHeaderFooter({
    store, docArea, getSession: () => session, mainEditor: editor,
    editorEnv: ({ onTransaction }) => ({
      ...editorEnv,
      extraPlugins: () => [...tablePlugins(tableUI), searchPlugin(), listLabelsPlugin((name) => getListStyle(ctx(), name))],
      onTransaction: (v, tr) => { onTransaction(v, tr); scheduleSync(tr.docChanged); },
    }),
  });
  ui.onPages = () => ui.hf.relocate();
  // View Gridlines: dotted outlines for cells without borders.
  const gridlines = () => docArea.view.mount.classList.toggle('no-gridlines', store.get().tableGridlines === false);
  store.subscribe((st, changed) => {
    if (changed.includes('tableGridlines')) gridlines();
    if (changed.includes('tableMode')) editor.view.dispatch(editor.view.state.tr.setMeta('addToHistory', false).setMeta('tableMode', st.tableMode));
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && store.get().tableMode) store.set({ tableMode: null }); });
  ui.addPicture = (bytes, type) => editorEnv.addPicture(bytes, type);
  ui.pictureUrl = (path) => editorEnv.pictureUrl(path);
  /** Opens the system file picker: resolves to a File (or Files with multiple), or null. */
  ui.pickFile = (accept, { multiple = false } = {}) => new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept, multiple });
    input.addEventListener('change', () => resolve(multiple ? [...input.files] : input.files[0] || null), { once: true });
    input.addEventListener('cancel', () => resolve(multiple ? [] : null), { once: true });
    input.click();
  });
  ui.docArea = docArea;

  const mini = createMiniToolbar({ registry, store, editor });
  attachContextMenu({ registry, editor, mini });

  // Paste Options button after a paste: re-paste the same content in another mode.
  let pasteBtn = null;
  function pasteOptions(info) {
    pasteBtn?.remove();
    let range = { from: info.from, to: info.to };
    const original = info.slice;
    const btn = h('button', { type: 'button', class: 'paste-options', 'aria-label': t('home.pasteOptions'), 'data-tip': t('home.pasteOptions'), 'aria-haspopup': 'menu' }, t('home.pasteCtrl'));
    pasteBtn = btn;
    const place = () => {
      try {
        const c = editor.view.coordsAtPos(Math.min(range.to, editor.view.state.doc.content.size));
        btn.style.left = `${c.left + 4}px`;
        btn.style.top = `${c.bottom + 2}px`;
      } catch { btn.remove(); }
    };
    const repaste = (mode) => {
      const view = editor.view;
      const { sliceForMode } = pasteModes;
      const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, range.from, range.to));
      const st = view.state.apply(tr);
      const { slice } = sliceForMode(original, mode, st);
      tr.replaceSelection(slice);
      range = { from: range.from, to: tr.selection.to };
      view.dispatch(tr.scrollIntoView().setMeta('pasteOptions', true));
      place();
    };
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', () => openMenu({
      anchor: btn,
      items: [['keep', 'cmd.home.pasteKeepSource'], ['merge', 'cmd.home.pasteMerge'], ['text', 'cmd.home.pasteTextOnly']].map(([m, k]) => ({ label: t(k), run: () => repaste(m) })),
    }));
    document.body.append(btn);
    requestAnimationFrame(place);
    pasteTracker = (tr) => {
      if (tr.getMeta('pasteOptions')) return;
      if (tr.docChanged || tr.selectionSet) { btn.remove(); pasteTracker = null; }
    };
  }
  let pasteTracker = null;
  const baseOnTransaction = editorEnv.onTransaction;
  editorEnv.onTransaction = (view, tr) => { if (pasteTracker && !tr.getMeta('paste')) pasteTracker(tr); baseOnTransaction(view, tr); };

  session = createSession({
    editor,
    toast,
    onLoad(state) {
      for (const url of pictureUrls.values()) URL.revokeObjectURL(url);
      pictureUrls = new Map();
      docArea.applyDocument(state);
      updateStyleSamples();
    },
    onChange(info) { store.set({ docTitle: info.name, dirty: info.dirty }); },
  });

  const backstage = createBackstage({ registry, store, toast, session });
  const search = createCommandSearch({ registry, tabs: TABS, toast });
  const keytips = createKeyTips({ ribbon, store, openCommandSearch: () => search.open() });

  // Regions cycled by F6 / Shift+F6.
  const regions = () => [ribbon.tabbar, ribbon.ribbon, leftDock.el, docArea.canvas, rightDock.el, status.el].filter((r) => !r.hidden && r.getClientRects().length);
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
  const work = h('div', { class: 'work' }, leftDock.el, docArea.el, rightDock.el);
  const shell = h('div', { class: 'shell' }, ribbon.tabbar, ribbon.ribbon, work, status.el);
  root.replaceChildren(shell, backstage.el);
  store.subscribe((s, changed) => {
    if (changed.includes('backstageOpen')) {
      shell.inert = s.backstageOpen;
      if (!s.backstageOpen) requestAnimationFrame(() => editor.focus());
    }
  });

  // Global shortcuts (Ctrl+F1, Alt+Q, F6…). Inside text fields only
  // modifier/function-key shortcuts apply, so typing stays untouched.
  function appKey(e) {
    if (keytips.isActive() || isMenuOpen() || search.isOpen() || document.querySelector('.dlg-overlay')) return null;
    if (store.get().backstageOpen && e.key !== 'F6') {
      if (!(e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(e.key))) return null;
    }
    if (isTextInput(e.target) && !(e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(e.key))) return null;
    const id = registry.handleKeydown(e);
    if (id && !registry.isEnabled(id) && registry.get(id).comingSoon) toast(t('toast.comingSoon', { name: registry.label(id) }));
    if (e.key === 'Escape' && store.get().ribbonPeek) store.set({ ribbonPeek: false });
    return id;
  }
  // In the document, app shortcuts go first: ProseMirror would otherwise
  // swallow Ctrl+B / I (it blocks the browser's own contenteditable formatting).
  ui.handleEditorKey = (e) => !!appKey(e);
  document.addEventListener('keydown', (e) => { if (!e.defaultPrevented) appKey(e); });

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
    pm: { TextSelection, NodeSelection },
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
