/**
 * Entry point. M0: boots the core services (settings, theme, i18n, command
 * registry, fonts) and renders a minimal shell with one blank A4 page.
 * The full ribbon UI arrives in M1.
 */
import { APP_NAME, APP_VERSION, DEFAULT_PAGE } from './config.js';
import { CommandRegistry } from './core/command-registry.js';
import { t, getLocale, onLocaleChange } from './i18n/index.js';
import { applyTheme, setTheme, resolveTheme, getThemePreference } from './ui/theme.js';
import { iconSvg } from './ui/icons.js';
import { registerFeatures } from './features/index.js';
import { PX_PER_CM } from './layout/units.js';
import { defaultBodyFont, loadBundledFonts } from './layout/fonts.js';

function registerAppCommands(registry) {
  registry.register([
    { id: 'theme.dark', label: 'cmd.theme.dark', icon: 'moon', keywords: ['theme.dark'], run: () => setTheme('dark'), isChecked: () => getThemePreference() === 'dark' },
    { id: 'theme.light', label: 'cmd.theme.light', icon: 'sun', keywords: ['theme.light'], run: () => setTheme('light'), isChecked: () => getThemePreference() === 'light' },
    { id: 'theme.system', label: 'cmd.theme.system', keywords: ['theme.system'], run: () => setTheme('system'), isChecked: () => getThemePreference() === 'system' },
    { id: 'theme.toggle', label: 'cmd.theme.toggle', run: () => setTheme(resolveTheme() === 'dark' ? 'light' : 'dark') },
  ]);
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) node.append(c);
  return node;
}

function renderShell(root, registry) {
  const themeBtn = el('button', { class: 'shell-btn', type: 'button', 'data-command': 'theme.toggle', onclick: () => registry.run('theme.toggle') });
  const updateThemeBtn = () => {
    const dark = resolveTheme() === 'dark';
    themeBtn.innerHTML = iconSvg(dark ? 'sun' : 'moon');
    themeBtn.title = registry.label('theme.toggle');
    themeBtn.setAttribute('aria-label', registry.label('theme.toggle'));
  };
  updateThemeBtn();
  registry.onChange(updateThemeBtn);

  const header = el('header', { class: 'shell-header', role: 'banner' }, [
    el('span', { class: 'shell-logo', html: iconSvg('logo') }),
    el('span', { class: 'shell-title' }, `${t('app.untitled')} - ${APP_NAME}`),
    el('span', { class: 'shell-spacer' }),
    themeBtn,
  ]);

  const page = el('div', { class: 'page', role: 'document', 'aria-label': t('region.page', { page: 1 }) });
  page.style.width = `${DEFAULT_PAGE.widthCm * PX_PER_CM}px`;
  page.style.height = `${DEFAULT_PAGE.heightCm * PX_PER_CM}px`;
  const m = DEFAULT_PAGE.marginCm;
  page.style.padding = [m.top, m.right, m.bottom, m.left].map((v) => `${v * PX_PER_CM}px`).join(' ');
  page.append(el('div', { class: 'page-body', contenteditable: 'false' }));

  const canvas = el('main', { class: 'canvas', role: 'main', 'aria-label': t('region.document') }, [page]);

  const status = el('footer', { class: 'status-bar', role: 'status' }, [
    el('span', { class: 'status-item' }, t('status.pageOf', { page: 1, pages: 1 })),
    el('span', { class: 'status-item' }, t('status.words', { count: 0 })),
    el('span', { class: 'status-item' }, t(`lang.${getLocale()}`)),
    el('span', { class: 'shell-spacer' }),
    el('span', { class: 'status-item' }, `${APP_NAME} ${APP_VERSION}`),
  ]);

  root.replaceChildren(header, canvas, status);
}

function boot() {
  applyTheme();
  const registry = new CommandRegistry({ translate: t, context: () => ({}) });
  registerAppCommands(registry);
  registerFeatures(registry);

  document.title = APP_NAME;
  document.documentElement.style.setProperty('--doc-font', `"${defaultBodyFont()}", "Carlito", sans-serif`);

  const root = document.getElementById('app');
  renderShell(root, registry);
  onLocaleChange(() => renderShell(root, registry));

  document.addEventListener('keydown', (e) => registry.handleKeydown(e));

  const ready = loadBundledFonts().finally(() => root.setAttribute('aria-busy', 'false'));

  // Stable hook for tests and debugging.
  window.odtEditor = Object.freeze({ registry, t, setTheme, ready, version: APP_VERSION, appName: APP_NAME });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
