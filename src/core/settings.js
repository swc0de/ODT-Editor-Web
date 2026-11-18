/**
 * User settings (Options), persisted in localStorage. Reads and writes are
 * wrapped so the app still works with storage blocked (private windows, file://
 * restrictions). Documents themselves go to IndexedDB (core/autosave, M2).
 */
import { APP_ID, DEFAULT_THEME, DEFAULT_UNITS, DEFAULT_LOCALE, AUTOSAVE_INTERVAL_MS } from '../config.js';

const KEY = `${APP_ID}:settings`;

export const DEFAULT_SETTINGS = Object.freeze({
  theme: DEFAULT_THEME, // 'dark' | 'light' | 'system'
  units: DEFAULT_UNITS,
  locale: DEFAULT_LOCALE,
  userName: '',
  userInitials: '',
  autosaveIntervalMs: AUTOSAVE_INTERVAL_MS,
  showRuler: true,
  ribbonCollapsed: false,
});

let cache = null;
const listeners = new Set();

function load() {
  if (cache) return cache;
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { stored = {}; }
  // Automated tests can supply different defaults (e.g. no native file pickers)
  // without touching storage; anything the user saved still wins.
  const testDefaults = (typeof window !== 'undefined' && window.__ODT_TEST_DEFAULTS__) || {};
  cache = { ...DEFAULT_SETTINGS, ...testDefaults, ...stored };
  return cache;
}

export function getSetting(name) { return load()[name]; }
export function getSettings() { return { ...load() }; }

export function setSetting(name, value) {
  const s = load();
  if (s[name] === value) return;
  s[name] = value;
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable: keep in memory */ }
  listeners.forEach((fn) => fn(name, value));
}

export function onSettingChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
