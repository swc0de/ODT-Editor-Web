/** View tab, laid out exactly as reference/ribbon-view-dark.png. */
import { defineCommands } from '../define.js';
import { setTheme, getThemePreference, resolveTheme } from '../../ui/theme.js';

const TAB_FOR = { outline: 'outlining', immersive: 'immersiveReader' };
const setView = (view) => (ctx) => {
  if (ctx.state.focusMode && view !== ctx.state.view) ctx.store.set({ focusMode: false });
  ctx.store.set({ view, ...(TAB_FOR[view] ? { activeTab: TAB_FOR[view] } : (TAB_FOR[ctx.state.view] ? { activeTab: 'view' } : {})) });
};
const viewCmd = (icon, view) => ({ icon, run: setView(view), isChecked: (c) => c.state.view === view, isEnabled: (c) => !!c.mainEditor });

export const commands = defineCommands('view', {
  readMode: viewCmd('read-mode', 'read'),
  printLayout: viewCmd('print-layout', 'print'),
  webLayout: viewCmd('web-layout', 'web'),
  outline: viewCmd('outline', 'outline'),
  draft: viewCmd('draft', 'draft'),
  focus: { icon: 'focus', isChecked: (c) => !!c.state.focusMode, run: (c) => c.ui.setFocusMode(!c.state.focusMode) },
  immersiveReader: viewCmd('immersive-reader', 'immersive'),
  vertical: { icon: 'vertical', run: (ctx) => ctx.store.set({ pageMovement: 'vertical' }), isChecked: (ctx) => ctx.state.pageMovement === 'vertical', isEnabled: (ctx) => ctx.state.view === 'print' },
  sideToSide: { icon: 'side-to-side', run: (ctx) => ctx.store.set({ pageMovement: 'side' }), isChecked: (ctx) => ctx.state.pageMovement === 'side', isEnabled: (ctx) => ctx.state.view === 'print' },
  ruler: { run: (ctx) => ctx.store.set((s) => ({ showRuler: !s.showRuler })), isChecked: (ctx) => ctx.state.showRuler },
  gridlines: { run: (ctx) => ctx.store.set((s) => ({ gridlines: !s.gridlines })), isChecked: (ctx) => ctx.state.gridlines },
  navigationPane: { run: (ctx) => ctx.ui.nav.toggle(), isChecked: (ctx) => !!ctx.state.navigationPane },
  hideWhiteSpace: {
    run: (ctx) => ctx.store.set((s) => ({ hideWhiteSpace: !s.hideWhiteSpace })),
    isChecked: (ctx) => ctx.state.hideWhiteSpace,
    isEnabled: (ctx) => ctx.state.pageMovement === 'vertical' && ctx.state.view === 'print',
  },
  zoomDialog: { icon: 'zoom-in', run: (ctx) => ctx.ui.openZoomDialog() },
  zoom100: { icon: 'zoom-100', run: (ctx) => ctx.ui.docArea.setZoom(100) },
  zoomIn: { icon: 'circle-plus', run: (ctx) => ctx.ui.docArea.zoomIn(), isEnabled: (ctx) => ctx.state.zoom < 500 },
  zoomOut: { icon: 'circle-minus', run: (ctx) => ctx.ui.docArea.zoomOut(), isEnabled: (ctx) => ctx.state.zoom > 10 },
  onePage: { icon: 'one-page', run: (ctx) => ctx.ui.docArea.onePage(), isEnabled: (ctx) => ctx.state.view === 'print' },
  multiplePages: { icon: 'multiple-pages', run: (ctx) => ctx.ui.docArea.multiplePages(), isEnabled: (ctx) => ctx.state.view === 'print' },
  pageWidth: { icon: 'page-width', run: (ctx) => ctx.ui.docArea.pageWidth() },
  // Dark pages while the interface is dark (like Word's Switch Modes).
  switchModes: { icon: 'switch-modes', isEnabled: () => resolveTheme() === 'dark', isChecked: (c) => !!c.state.darkPage && resolveTheme() === 'dark', run: (c) => c.store.set((s) => ({ darkPage: !s.darkPage })) },
  interfaceTheme: { icon: 'interface-theme', menuOnly: true },
  themeDark: { icon: 'moon', run: () => setTheme('dark'), isChecked: () => getThemePreference() === 'dark' },
  themeLight: { icon: 'sun', run: () => setTheme('light'), isChecked: () => getThemePreference() === 'light' },
  themeSystem: { icon: 'monitor', run: () => setTheme('system'), isChecked: () => getThemePreference() === 'system' },
  newWindow: { icon: 'new-window', isEnabled: (c) => !!c.ui.windows, run: (c) => c.ui.windows.newWindow() },
  arrangeAll: { icon: 'arrange-all', isEnabled: (c) => !!c.ui.windows, run: (c) => c.ui.windows.arrangeAll() },
  split: { icon: 'split', isEnabled: (c) => !!c.ui.split && c.state.view !== 'read', isChecked: (c) => !!c.state.splitView, run: (c) => c.ui.split.toggle() },
  // Need another window of the app (a New Window, or another document open in another tab).
  sideBySide: { icon: 'side-by-side', isEnabled: (c) => !!c.ui.windows && (!!c.state.sideBySide || c.ui.windows.windows().length > 1), isChecked: (c) => !!c.state.sideBySide, run: (c) => c.ui.windows.sideBySide() },
  synchronousScrolling: { icon: 'sync-scroll', isEnabled: (c) => !!c.state.sideBySide, isChecked: (c) => !!c.state.sideBySide && !!c.state.syncScroll, run: (c) => c.store.set((s) => ({ syncScroll: !s.syncScroll })) },
  switchWindows: { icon: 'switch-windows', isEnabled: (c) => !!c.ui.windows, menuOnly: true },
  fullScreen: { icon: 'full-screen', isChecked: (c) => !!c.state.fullScreen, run: (c) => c.ui.windows.setFullScreen(!c.state.fullScreen) },
  macros: { icon: 'macros' },
  // The templates gallery (File ▸ New), with Save as Template.
  templates: { icon: 'templates', run: (c) => c.store.set({ backstageOpen: true, backstagePage: 'new' }) },
});

export const ribbon = {
  id: 'view',
  keytip: 'W',
  groups: [
    {
      id: 'views', icon: 'print-layout',
      controls: [
        { t: 'large', cmd: 'readMode', label: 'label.view.readMode' },
        { t: 'large', cmd: 'printLayout', label: 'label.view.printLayout' },
        { t: 'large', cmd: 'webLayout', label: 'label.view.webLayout' },
        { t: 'col', items: [{ cmd: 'outline' }, { cmd: 'draft' }] },
      ],
    },
    { id: 'immersive', icon: 'focus', controls: [{ t: 'large', cmd: 'focus' }, { t: 'large', cmd: 'immersiveReader', label: 'label.view.immersiveReader' }] },
    { id: 'pageMovement', icon: 'vertical', controls: [{ t: 'large', cmd: 'vertical' }, { t: 'large', cmd: 'sideToSide', label: 'label.view.sideToSide' }] },
    {
      id: 'show', icon: 'ruler',
      controls: [
        { t: 'col', items: [{ t: 'check', cmd: 'ruler' }, { t: 'check', cmd: 'gridlines' }, { t: 'check', cmd: 'navigationPane' }] },
        { t: 'col', items: [{ t: 'check', cmd: 'hideWhiteSpace' }] },
      ],
    },
    {
      id: 'zoom', icon: 'zoom',
      controls: [
        { t: 'large', cmd: 'zoomDialog', label: 'label.view.zoom' },
        { t: 'large', cmd: 'zoom100', label: 'label.view.zoom100' },
        { t: 'col', items: [{ cmd: 'zoomIn' }, { cmd: 'zoomOut' }] },
        { t: 'col', items: [{ cmd: 'onePage' }, { cmd: 'multiplePages' }, { cmd: 'pageWidth' }] },
      ],
    },
    {
      id: 'darkMode', icon: 'interface-theme',
      controls: [
        { t: 'large', cmd: 'switchModes', label: 'label.view.switchModes' },
        { t: 'large', cmd: 'interfaceTheme', label: 'label.view.interfaceTheme', menu: ['themeDark', 'themeLight', 'themeSystem'] },
      ],
    },
    {
      id: 'window', icon: 'new-window',
      controls: [
        { t: 'large', cmd: 'newWindow', label: 'label.view.newWindow' },
        { t: 'large', cmd: 'arrangeAll', label: 'label.view.arrangeAll' },
        { t: 'large', cmd: 'split' },
        { t: 'col', items: [{ cmd: 'sideBySide' }, { cmd: 'synchronousScrolling' }] },
        { t: 'large', cmd: 'switchWindows', label: 'label.view.switchWindows', menu: [{ custom: 'windowList' }] },
        { t: 'large', cmd: 'fullScreen', label: 'label.view.fullScreen' },
      ],
    },
    { id: 'macros', icon: 'macros', controls: [{ t: 'large', cmd: 'macros' }] },
    { id: 'templates', icon: 'templates', controls: [{ t: 'large', cmd: 'templates' }] },
  ],
};

export function register(registry) { registry.register(commands); }
