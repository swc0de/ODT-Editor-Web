/** View tab, laid out exactly as reference/ribbon-view-dark.png. */
import { defineCommands } from '../define.js';
import { setTheme, getThemePreference } from '../../ui/theme.js';

const setView = (view) => (ctx) => ctx.store.set({ view });

export const commands = defineCommands('view', {
  readMode: { icon: 'read-mode' },
  printLayout: { icon: 'print-layout', run: setView('print') },
  webLayout: { icon: 'web-layout' },
  outline: { icon: 'outline' },
  draft: { icon: 'draft' },
  focus: { icon: 'focus' },
  immersiveReader: { icon: 'immersive-reader' },
  vertical: { icon: 'vertical', run: (ctx) => ctx.store.set({ pageMovement: 'vertical' }), isChecked: (ctx) => ctx.state.pageMovement === 'vertical' },
  sideToSide: { icon: 'side-to-side', run: (ctx) => ctx.store.set({ pageMovement: 'side' }), isChecked: (ctx) => ctx.state.pageMovement === 'side' },
  ruler: { run: (ctx) => ctx.store.set((s) => ({ showRuler: !s.showRuler })), isChecked: (ctx) => ctx.state.showRuler },
  gridlines: { run: (ctx) => ctx.store.set((s) => ({ gridlines: !s.gridlines })), isChecked: (ctx) => ctx.state.gridlines },
  navigationPane: { isChecked: () => false },
  hideWhiteSpace: {
    run: (ctx) => ctx.store.set((s) => ({ hideWhiteSpace: !s.hideWhiteSpace })),
    isChecked: (ctx) => ctx.state.hideWhiteSpace,
    isEnabled: (ctx) => ctx.state.pageMovement === 'vertical',
  },
  zoomDialog: { icon: 'zoom-in', run: (ctx) => ctx.ui.openZoomDialog() },
  zoom100: { icon: 'zoom-100', run: (ctx) => ctx.ui.docArea.setZoom(100) },
  zoomIn: { icon: 'circle-plus', run: (ctx) => ctx.ui.docArea.zoomIn(), isEnabled: (ctx) => ctx.state.zoom < 500 },
  zoomOut: { icon: 'circle-minus', run: (ctx) => ctx.ui.docArea.zoomOut(), isEnabled: (ctx) => ctx.state.zoom > 10 },
  onePage: { icon: 'one-page', run: (ctx) => ctx.ui.docArea.onePage() },
  multiplePages: { icon: 'multiple-pages', run: (ctx) => ctx.ui.docArea.multiplePages() },
  pageWidth: { icon: 'page-width', run: (ctx) => ctx.ui.docArea.pageWidth() },
  switchModes: { icon: 'switch-modes' },
  interfaceTheme: { icon: 'interface-theme', menuOnly: true },
  themeDark: { icon: 'moon', run: () => setTheme('dark'), isChecked: () => getThemePreference() === 'dark' },
  themeLight: { icon: 'sun', run: () => setTheme('light'), isChecked: () => getThemePreference() === 'light' },
  themeSystem: { icon: 'monitor', run: () => setTheme('system'), isChecked: () => getThemePreference() === 'system' },
  newWindow: { icon: 'new-window' },
  arrangeAll: { icon: 'arrange-all' },
  split: { icon: 'split' },
  // Need a second open window (M12); only one window can exist so far.
  sideBySide: { icon: 'side-by-side', isEnabled: () => false },
  synchronousScrolling: { icon: 'sync-scroll', isEnabled: () => false },
  switchWindows: { icon: 'switch-windows' },
  fullScreen: { icon: 'full-screen' },
  macros: { icon: 'macros' },
  templates: { icon: 'templates' },
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
