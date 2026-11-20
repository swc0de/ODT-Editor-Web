/**
 * Help tab: Help (every keyboard shortcut, searchable), Feedback (a note kept
 * in this browser, which you can copy or download), What's New, and About
 * (version, licences of the bundled libraries and fonts).
 */
import { h } from './dom.js';
import { t } from '../i18n/index.js';
import { showDialog } from './dialog.js';
import { getSetting, setSetting } from '../core/settings.js';
import { APP_NAME, APP_VERSION, BUILD_DATE } from '../config.js';
import { LOGO_SVG } from './logo.js';

/** Licences of everything bundled into the file. */
export const LICENCES = [
  ['ProseMirror (model, state, view, transform, history, keymap, commands, inputrules, tables, collab…)', 'MIT'],
  ['fflate', 'MIT'],
  ['MathLive, with the KaTeX maths fonts', 'MIT'],
  ['nspell', 'MIT'],
  ['Hunspell dictionaries en-GB and en-US (wooorm/dictionaries, from SCOWL)', 'MIT AND BSD'],
  ['citeproc-js', 'CPAL-1.0 / AGPL-1.0'],
  ['Citation Style Language styles and locales (APA, MLA, Chicago, IEEE, Harvard)', 'CC BY-SA 3.0'],
  ['hyphen, with the British English hyphenation patterns (hyph-en-gb, CTAN)', 'ISC / LPPL'],
  ['SheetJS Community Edition', 'Apache-2.0'],
  ['mammoth', 'BSD-2-Clause'],
  ['docx', 'MIT'],
  ['marked', 'MIT'],
  ['Lucide icons', 'ISC'],
  ['Fonts: Carlito, Caladea, Liberation Sans, Liberation Serif, Liberation Mono', 'SIL Open Font License 1.1'],
];

/** The About page (File ▸ About, Help ▸ About). */
export function renderAbout() {
  return h('div', { class: 'bs-home about-page' },
    h('div', { class: 'about-head' }, h('span', { class: 'about-logo', html: LOGO_SVG }), h('div', {},
      h('h1', { class: 'bs-title' }, APP_NAME),
      h('p', { class: 'about-version' }, t('about.version', { version: APP_VERSION, date: BUILD_DATE })))),
    h('p', {}, t('about.blurb')),
    h('p', {}, t('about.privacy')),
    h('h2', { class: 'bs-h2' }, t('about.licences')),
    h('p', { class: 'bs-empty' }, t('about.appLicence')),
    h('table', { class: 'about-licences' }, h('tbody', {}, LICENCES.map(([what, lic]) => h('tr', {}, h('td', {}, what), h('td', {}, lic))))),
    h('p', { class: 'about-credit' }, t('about.credit')));
}

/** Help (F1): every command with a keyboard shortcut, grouped and searchable. */
export function shortcutsDialog(registry, tabs) {
  const groups = new Map();
  const tabOf = (id) => id.split('.')[0];
  for (const c of registry.list()) {
    const keys = registry.shortcutText(c.id);
    if (!keys) continue;
    const g = tabOf(c.id);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push([registry.label(c.id), keys]);
  }
  // Shortcuts that aren't commands of their own.
  groups.set('other', [
    [t('help.k.keyTips'), 'Alt'], [t('help.k.search'), 'Alt+Q'], [t('help.k.regions'), 'F6 / Shift+F6'], [t('help.k.collapse'), 'Ctrl+F1'],
    [t('help.k.lineBreak'), 'Shift+Enter'], [t('help.k.pageBreak'), 'Ctrl+Enter'], [t('help.k.selectAll'), 'Ctrl+A'], [t('help.k.start'), 'Ctrl+Home / Ctrl+End'],
    [t('help.k.unicode'), 'Alt+X'], [t('help.k.contextMenu'), 'Shift+F10'],
  ]);
  const order = [...tabs.map((d) => d.id === 'file' ? 'file' : d.id), 'app', 'other'];
  const filter = h('input', { type: 'search', class: 'fm-input help-filter', placeholder: t('help.filter'), 'aria-label': t('help.filter') });
  const list = h('div', { class: 'help-list', tabindex: '0', role: 'region', 'aria-label': t('help.title') });
  const draw = () => {
    const q = filter.value.trim().toLowerCase();
    list.replaceChildren();
    for (const g of [...new Set([...order, ...groups.keys()])]) {
      const rows = (groups.get(g) || []).filter(([label, keys]) => !q || label.toLowerCase().includes(q) || keys.toLowerCase().includes(q)).sort((a, b) => a[0].localeCompare(b[0]));
      if (!rows.length) continue;
      list.append(h('h3', { class: 'help-group' }, g === 'other' ? t('help.other') : g === 'app' ? t('help.general') : t(`tab.${g}`)),
        h('table', { class: 'help-table' }, h('tbody', {}, rows.map(([label, keys]) => h('tr', {}, h('td', {}, label), h('td', {}, h('kbd', {}, keys)))))));
    }
    if (!list.childElementCount) list.append(h('p', { class: 'bs-empty' }, t('help.none')));
  };
  filter.addEventListener('input', draw);
  draw();
  requestAnimationFrame(() => filter.focus());
  return showDialog({ title: t('help.title'), message: h('div', { class: 'help-sheet' }, filter, list), wide: true, buttons: [{ label: t('common.close'), value: true, primary: true }], cancelValue: true });
}

/** Feedback: a note saved in this browser (nothing is sent anywhere). */
export async function feedbackDialog(toast) {
  const area = h('textarea', { class: 'fm-input feedback-text', rows: '10', 'aria-label': t('feedback.label'), placeholder: t('feedback.placeholder') });
  area.value = getSetting('feedbackNote') || '';
  const download = h('button', { type: 'button', class: 'dlg-btn', onclick: () => {
    const url = URL.createObjectURL(new Blob([area.value], { type: 'text/plain' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'odt-editor-feedback.txt' });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } }, t('feedback.download'));
  requestAnimationFrame(() => area.focus());
  const ok = await showDialog({ title: t('feedback.title'), message: h('div', { class: 'ref-dlg' }, h('p', {}, t('feedback.intro')), area, h('div', { class: 'opt-row' }, download)), buttons: [{ label: t('feedback.save'), value: true, primary: true }, { label: t('common.cancel'), value: false }], cancelValue: false });
  if (ok) { setSetting('feedbackNote', area.value); toast(t('feedback.saved')); }
}

const NEWS = ['m13', 'm12', 'm11', 'm10', 'm9', 'm8', 'm7', 'm6', 'm5', 'm4'];

export function whatsNewDialog() {
  const list = h('div', { class: 'help-list', tabindex: '0', role: 'region', 'aria-label': t('news.title', { version: APP_VERSION }) }, NEWS.map((k) => h('section', {}, h('h3', { class: 'help-group' }, t(`news.${k}.title`)), h('p', {}, t(`news.${k}.text`)))));
  return showDialog({ title: t('news.title', { version: APP_VERSION }), message: h('div', { class: 'help-sheet' }, list), wide: true, buttons: [{ label: t('common.close'), value: true, primary: true }], cancelValue: true });
}
