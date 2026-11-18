/**
 * Entry point: boots settings, theme, i18n, the command registry and the
 * window chrome (tab bar, ribbon, rulers, canvas with a blank A4 page, status
 * bar, Backstage, Alt+Q search, KeyTips). Editing arrives in M2.
 */
import { APP_NAME, APP_VERSION, DEFAULT_PAGE } from './config.js';
import { CommandRegistry } from './core/command-registry.js';
import { createStore, INITIAL_APP_STATE } from './core/app-state.js';
import { getSetting, setSetting } from './core/settings.js';
import { t } from './i18n/index.js';
import { applyTheme, onThemeChange } from './ui/theme.js';
import { h, isTextInput } from './ui/dom.js';
import { registerFeatures, TABS } from './features/index.js';
import { resolveId } from './features/define.js';
import { PX_PER_CM } from './layout/units.js';
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

function createDocumentArea(store) {
  const m = DEFAULT_PAGE.marginCm;
  const marginsPx = { top: m.top * PX_PER_CM, right: m.right * PX_PER_CM, bottom: m.bottom * PX_PER_CM, left: m.left * PX_PER_CM };
  const page = h('div', { class: 'page', role: 'document', 'aria-label': t('region.page', { page: 1 }) },
    h('div', { class: 'page-body' }, h('span', { class: 'page-caret', 'aria-hidden': 'true' })));
  page.style.width = `${DEFAULT_PAGE.widthCm * PX_PER_CM}px`;
  page.style.height = `${DEFAULT_PAGE.heightCm * PX_PER_CM}px`;
  page.style.padding = `${marginsPx.top}px ${marginsPx.right}px ${marginsPx.bottom}px ${marginsPx.left}px`;

  const pages = h('div', { class: 'pages' }, page);
  const canvas = h('div', { class: 'canvas', tabindex: '0', 'aria-label': t('region.document'), 'data-region': 'document' }, pages);
  const rulers = createRulers({ store });
  const area = h('main', { class: 'doc-area' }, canvas, rulers.hstrip, rulers.vstrip, rulers.corner);
  const sync = () => rulers.update(page, marginsPx);
  canvas.addEventListener('scroll', sync, { passive: true });
  new ResizeObserver(sync).observe(canvas);
  store.subscribe((s, changed) => { if (changed.includes('showRuler') || changed.includes('ribbonCollapsed') || changed.includes('ribbonPeek')) requestAnimationFrame(sync); });
  document.fonts?.ready.then(sync);
  return { el: area, canvas, page, sync };
}

function boot() {
  applyTheme();
  const store = createStore({ ...INITIAL_APP_STATE, ribbonCollapsed: !!getSetting('ribbonCollapsed'), showRuler: getSetting('showRuler') !== false });
  const ui = {};
  const registry = new CommandRegistry({ translate: t, context: () => ({ store, state: store.get(), ui }) });
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

  const ribbon = createRibbon({ registry, store, tabs: TABS, toast });
  const docArea = createDocumentArea(store);
  const status = createStatusBar({ registry, store, toast });
  const backstage = createBackstage({ registry, store, toast });
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
    else if (next === docArea.canvas) next.focus();
    else (next.querySelector('button:not([tabindex="-1"]), input, [tabindex="0"]') || next).focus();
  };

  const root = document.getElementById('app');
  const shell = h('div', { class: 'shell' }, ribbon.tabbar, ribbon.ribbon, docArea.el, status.el);
  root.replaceChildren(shell, backstage.el);
  store.subscribe((s, changed) => {
    if (changed.includes('backstageOpen')) shell.inert = s.backstageOpen;
  });

  // Global shortcuts (Ctrl+F1, Alt+Q, F6…). Inside text fields only
  // modifier/function-key shortcuts apply, so typing stays untouched.
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || keytips.isActive() || isMenuOpen() || search.isOpen()) return;
    if (store.get().backstageOpen && e.key !== 'F6') {
      if (!(e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(e.key))) return;
    }
    if (isTextInput(e.target) && !(e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(e.key))) return;
    const id = registry.handleKeydown(e);
    if (id && !registry.isEnabled(id) && registry.get(id).comingSoon) toast(t('toast.comingSoon', { name: registry.label(id) }));
    if (e.key === 'Escape' && store.get().ribbonPeek) store.set({ ribbonPeek: false });
  });

  addEventListener('resize', () => docArea.sync());
  requestAnimationFrame(docArea.sync);
  const ready = loadBundledFonts().then(() => new Promise((r) => requestAnimationFrame(r))).finally(() => {
    docArea.sync();
    root.setAttribute('aria-busy', 'false');
  });

  // Stable hook for tests and debugging.
  window.odtEditor = Object.freeze({ registry, store, t, ready, version: APP_VERSION, appName: APP_NAME, tabs: TABS, search, keytips, ribbon });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
