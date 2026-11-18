/**
 * i18n: every user-facing string goes through t(). English (UK) is the
 * default and the fallback for missing keys in other locales.
 *
 *   t('status.pageOf', { page: 1, pages: 3 })  →  "Page 1 of 3"
 *   t('status.words', { count: 1 })            →  "1 word"   (plural forms via Intl.PluralRules)
 */
import enGB from './en-GB.js';
import { APP_NAME, DEFAULT_LOCALE } from '../config.js';

const catalogs = new Map([['en-GB', enGB]]);
let current = DEFAULT_LOCALE;
const listeners = new Set();

export function registerLocale(locale, strings) {
  catalogs.set(locale, strings);
}

export function setLocale(locale) {
  if (!catalogs.has(locale)) throw new Error(`Unknown locale ${locale}`);
  current = locale;
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
  listeners.forEach((fn) => fn(locale));
}

export const getLocale = () => current;
export const availableLocales = () => [...catalogs.keys()];
export function onLocaleChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function lookup(key) {
  const cat = catalogs.get(current);
  if (cat && key in cat) return cat[key];
  if (key in enGB) return enGB[key];
  return undefined;
}

/** True if the key exists in the default catalogue. */
export const hasKey = (key) => key in enGB;

/**
 * Translates a key. Values may be a string or a plural object
 * ({ one: '…', other: '…' }) selected by params.count.
 * {name} placeholders are filled from params; {app} is always the app name.
 * Unknown keys are returned unchanged (so plain labels still render).
 */
export function t(key, params = {}) {
  let value = lookup(key);
  if (value === undefined) return key;
  if (typeof value === 'object') {
    const rule = new Intl.PluralRules(current).select(Number(params.count ?? 0));
    value = value[rule] ?? value.other;
  }
  return value.replace(/\{(\w+)\}/g, (m, name) => {
    if (name === 'app') return APP_NAME;
    if (!(name in params)) return m;
    const v = params[name];
    return typeof v === 'number' ? formatNumber(v) : String(v);
  });
}

export function formatNumber(n, opts) {
  return new Intl.NumberFormat(current, opts).format(n);
}
