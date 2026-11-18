/**
 * Interface theme: 'dark' | 'light' | 'system'. The resolved theme is applied
 * as <html data-theme="dark|light">; all colours come from CSS custom
 * properties in styles/tokens.css.
 */
import { getSetting, setSetting } from '../core/settings.js';

const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null;
const listeners = new Set();

export const THEMES = Object.freeze(['dark', 'light', 'system']);

export function getThemePreference() { return getSetting('theme'); }

export function resolveTheme(pref = getThemePreference()) {
  if (pref === 'system') return media && media.matches ? 'light' : 'dark';
  return pref === 'light' ? 'light' : 'dark';
}

export function applyTheme() {
  const resolved = resolveTheme();
  document.documentElement.dataset.theme = resolved;
  listeners.forEach((fn) => fn(resolved));
  return resolved;
}

export function setTheme(pref) {
  if (!THEMES.includes(pref)) throw new Error(`Unknown theme ${pref}`);
  setSetting('theme', pref);
  return applyTheme();
}

export function onThemeChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

if (media) media.addEventListener?.('change', () => { if (getThemePreference() === 'system') applyTheme(); });
