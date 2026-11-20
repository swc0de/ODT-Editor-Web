/**
 * File ▸ Options: General (your name and initials, theme), Display, Proofing
 * (spelling, AutoCorrect, your dictionary), Save (autosave, file access,
 * version history), Language, Advanced (measurement units, pasting),
 * Customise Ribbon (show / hide tabs) and Quick Access Toolbar. Changes apply
 * when you press OK.
 */
import { h } from './dom.js';
import { t, availableLocales, getLocale } from '../i18n/index.js';
import { showDialog } from './dialog.js';
import { field, text, select, check } from './form.js';
import { getSetting, setSetting } from '../core/settings.js';
import { setTheme, getThemePreference } from './theme.js';
import { AUTOCORRECT_DEFAULTS } from '../core/editing-plugins.js';
import { UNITS } from '../layout/units.js';

export const SECTIONS = ['general', 'display', 'proofing', 'save', 'language', 'advanced', 'ribbon', 'qat'];
export const DEFAULT_QAT = ['file.save', 'file.undo', 'file.redo'];

/**
 * o = { registry, store, tabs (ribbon tab definitions), section (to open), onApplied() }
 * Resolves true if OK was pressed.
 */
export async function optionsDialog(o) {
  const { registry, store } = o;
  const changes = [];
  const set = (name, value) => changes.push(() => setSetting(name, value));

  // ---------------------------------------------------------- General
  const name = text(getSetting('userName') || '', { 'aria-label': t('opt.userName') });
  const initials = text(getSetting('userInitials') || '', { maxlength: '6', 'aria-label': t('opt.initials'), style: 'width:90px' });
  const theme = select([['dark', t('cmd.view.themeDark')], ['light', t('cmd.view.themeLight')], ['system', t('cmd.view.themeSystem')]], getThemePreference() || 'dark');
  changes.push(() => { setSetting('userName', name.value.trim()); setSetting('userInitials', initials.value.trim()); if (theme.value !== getThemePreference()) setTheme(theme.value); });
  const general = [
    h('h3', { class: 'opt-h' }, t('opt.personalise')),
    field(t('opt.userName'), name, { wide: true }), field(t('opt.initials'), initials),
    h('p', { class: 'opt-note' }, t('opt.userNote')),
    field(t('opt.theme'), theme),
  ];

  // ---------------------------------------------------------- Display
  const ruler = check(t('opt.showRuler'), store.get().showRuler);
  const marks = check(t('opt.showMarks'), store.get().showMarks);
  const mini = check(t('opt.miniToolbar'), getSetting('miniToolbar') !== false);
  const darkPage = check(t('opt.darkPage'), !!store.get().darkPage);
  const tips = check(t('opt.screenTips'), getSetting('screenTips') !== false);
  changes.push(() => {
    if (ruler.input.checked !== store.get().showRuler) store.set({ showRuler: ruler.input.checked });
    if (marks.input.checked !== !!store.get().showMarks) registry.run('home.showMarks');
    setSetting('miniToolbar', mini.input.checked);
    if (darkPage.input.checked !== !!store.get().darkPage) store.set({ darkPage: darkPage.input.checked });
    setSetting('screenTips', tips.input.checked);
  });
  const display = [h('h3', { class: 'opt-h' }, t('opt.showOnScreen')), ruler, marks, mini, tips, h('h3', { class: 'opt-h' }, t('opt.pages')), darkPage];

  // ---------------------------------------------------------- Proofing
  const spell = check(t('opt.checkSpelling'), getSetting('checkSpelling') !== false);
  const ac = { ...AUTOCORRECT_DEFAULTS, ...(getSetting('autocorrect') || {}) };
  const acChecks = Object.keys(AUTOCORRECT_DEFAULTS).map((k) => [k, check(t(`opt.ac.${k}`), !!ac[k])]);
  const dict = [...(getSetting('customDictionary') || [])];
  const dictList = h('select', { class: 'opt-list', size: '6', 'aria-label': t('opt.dictionary') });
  const drawDict = () => dictList.replaceChildren(...dict.map((w) => h('option', { value: w }, w)));
  drawDict();
  const removeWord = h('button', { type: 'button', class: 'dlg-btn', onclick: () => { const i = dict.indexOf(dictList.value); if (i >= 0) { dict.splice(i, 1); drawDict(); } } }, t('opt.removeWord'));
  changes.push(() => {
    setSetting('checkSpelling', spell.input.checked);
    setSetting('autocorrect', Object.fromEntries(acChecks.map(([k, c]) => [k, c.input.checked])));
    setSetting('customDictionary', dict);
  });
  const proofing = [h('h3', { class: 'opt-h' }, t('opt.spelling')), spell, h('h3', { class: 'opt-h' }, t('opt.autocorrect')), ...acChecks.map(([, c]) => c), h('h3', { class: 'opt-h' }, t('opt.dictionary')), dictList, h('div', { class: 'opt-row' }, removeWord)];

  // ---------------------------------------------------------- Save
  const intervals = [[15000, t('opt.every', { n: '15 s' })], [30000, t('opt.every', { n: '30 s' })], [60000, t('opt.every', { n: '1 min' })], [300000, t('opt.every', { n: '5 min' })], [600000, t('opt.every', { n: '10 min' })]];
  const interval = select(intervals.map(([v, l]) => [String(v), l]), String(getSetting('autosaveIntervalMs') || 30000));
  const fsAccess = check(t('opt.fileAccess'), getSetting('fileSystemAccess') !== false && typeof window.showSaveFilePicker === 'function', { disabled: typeof window.showSaveFilePicker !== 'function' ? '' : null });
  const versions = check(t('opt.keepVersions'), getSetting('keepVersions') !== false);
  changes.push(() => {
    setSetting('autosaveIntervalMs', Number(interval.value));
    if (typeof window.showSaveFilePicker === 'function') setSetting('fileSystemAccess', fsAccess.input.checked);
    setSetting('keepVersions', versions.input.checked);
  });
  const save = [h('h3', { class: 'opt-h' }, t('opt.autosave')), field(t('opt.autosaveEvery'), interval), h('p', { class: 'opt-note' }, t('opt.autosaveNote')), versions, h('h3', { class: 'opt-h' }, t('opt.files')), fsAccess, h('p', { class: 'opt-note' }, typeof window.showSaveFilePicker === 'function' ? t('opt.fileAccessNote') : t('opt.fileAccessNone'))];

  // ---------------------------------------------------------- Language
  const LANGS = [['en-GB', 'English (United Kingdom)'], ['en-US', 'English (United States)']];
  const uiLang = select(availableLocales().map((l) => [l, LANGS.find((x) => x[0] === l)?.[1] || l]), getLocale());
  const proofLang = select(LANGS, getSetting('proofingLanguage') || 'en-GB');
  changes.push(() => setSetting('proofingLanguage', proofLang.value));
  const language = [h('h3', { class: 'opt-h' }, t('opt.displayLanguage')), field(t('opt.uiLanguage'), uiLang), h('p', { class: 'opt-note' }, t('opt.uiLanguageNote')),
    h('h3', { class: 'opt-h' }, t('opt.proofingLanguage')), field(t('opt.newDocuments'), proofLang), h('p', { class: 'opt-note' }, t('opt.proofingNote'))];

  // ---------------------------------------------------------- Advanced
  const unitNames = { cm: t('opt.unit.cm'), mm: t('opt.unit.mm'), in: t('opt.unit.in'), pt: t('opt.unit.pt') };
  const units = select(UNITS.map((u) => [u, unitNames[u]]), getSetting('units') || 'cm');
  const pasteChoices = [['keep', t('cmd.home.pasteKeepSource')], ['merge', t('cmd.home.pasteMerge')], ['text', t('cmd.home.pasteTextOnly')]];
  const pasteWithin = select(pasteChoices, getSetting('pasteWithin') || 'keep');
  const pasteOther = select(pasteChoices, getSetting('pasteOther') || 'keep');
  changes.push(() => { setSetting('units', units.value); setSetting('pasteWithin', pasteWithin.value); setSetting('pasteOther', pasteOther.value); });
  const advanced = [h('h3', { class: 'opt-h' }, t('opt.display')), field(t('opt.units'), units),
    h('h3', { class: 'opt-h' }, t('opt.cutCopyPaste')), field(t('opt.pasteWithin'), pasteWithin), field(t('opt.pasteOther'), pasteOther)];

  // ---------------------------------------------------------- Customise Ribbon
  const hidden = new Set(getSetting('hiddenTabs') || []);
  const tabChecks = o.tabs.filter((d) => !d.contextual && !d.backstage).map((d) => [d.id, check(t(`tab.${d.id}`), !hidden.has(d.id), { 'data-tab-option': d.id })]);
  changes.push(() => { const hide = tabChecks.filter(([, c]) => !c.input.checked).map(([id]) => id); setSetting('hiddenTabs', hide); store.set({ hiddenTabs: hide }); });
  const ribbonSec = [h('h3', { class: 'opt-h' }, t('opt.mainTabs')), h('p', { class: 'opt-note' }, t('opt.mainTabsNote')), h('div', { class: 'opt-tabs' }, tabChecks.map(([, c]) => c))];

  // ---------------------------------------------------------- Quick Access Toolbar
  const qatOn = check(t('opt.qatShow'), !!getSetting('qatShow'));
  const qatPos = select([['top', t('opt.qatAbove')], ['below', t('opt.qatBelow')]], getSetting('qatPosition') || 'top');
  const qat = [...(getSetting('qatCommands') || DEFAULT_QAT)];
  const all = registry.list().filter((c) => c.run && !c.comingSoon && !c.hidden && !c.menuOnly).sort((a, b) => registry.label(a.id).localeCompare(registry.label(b.id)));
  const choose = h('select', { class: 'opt-list', size: '10', 'aria-label': t('opt.qatChoose') }, all.map((c) => h('option', { value: c.id }, registry.label(c.id))));
  const current = h('select', { class: 'opt-list', size: '10', 'aria-label': t('opt.qatCurrent'), 'data-qat-list': '' });
  const drawQat = () => current.replaceChildren(...qat.map((id) => h('option', { value: id }, registry.label(id))));
  drawQat();
  const btn = (label, fn) => h('button', { type: 'button', class: 'dlg-btn', onclick: fn }, label);
  const qatButtons = h('div', { class: 'opt-qat-buttons' },
    btn(t('opt.add'), () => { if (choose.value && !qat.includes(choose.value)) { qat.push(choose.value); drawQat(); } }),
    btn(t('opt.remove'), () => { const i = qat.indexOf(current.value); if (i >= 0) { qat.splice(i, 1); drawQat(); } }),
    btn(t('opt.moveUp'), () => { const i = qat.indexOf(current.value); if (i > 0) { [qat[i - 1], qat[i]] = [qat[i], qat[i - 1]]; drawQat(); current.value = qat[i - 1]; } }),
    btn(t('opt.reset'), () => { qat.splice(0, qat.length, ...DEFAULT_QAT); drawQat(); }));
  changes.push(() => { setSetting('qatShow', qatOn.input.checked); setSetting('qatPosition', qatPos.value); setSetting('qatCommands', qat); store.set({ qatVersion: (store.get().qatVersion || 0) + 1 }); });
  const qatSec = [qatOn, field(t('opt.qatPosition'), qatPos), h('div', { class: 'opt-qat' }, choose, qatButtons, current)];

  // ---------------------------------------------------------- layout
  const panels = { general, display, proofing, save, language, advanced, ribbon: ribbonSec, qat: qatSec };
  const nav = h('div', { class: 'opt-nav', role: 'tablist', 'aria-orientation': 'vertical' });
  const body = h('div', { class: 'opt-body' });
  let current0 = o.section && panels[o.section] ? o.section : 'general';
  const show = (k) => {
    current0 = k;
    for (const b of nav.children) b.setAttribute('aria-selected', String(b.dataset.section === k));
    body.replaceChildren(h('h2', { class: 'opt-title' }, t(`opt.section.${k}`)), ...panels[k].filter(Boolean));
  };
  for (const k of SECTIONS) {
    const b = h('button', { type: 'button', role: 'tab', class: 'opt-nav-item', 'data-section': k, onclick: () => show(k) }, t(`opt.section.${k}`));
    b.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const i = SECTIONS.indexOf(k) + (e.key === 'ArrowDown' ? 1 : -1);
      const next = nav.children[(i + SECTIONS.length) % SECTIONS.length];
      next.focus();
      next.click();
    });
    nav.append(b);
  }
  show(current0);
  const ok = await showDialog({ title: t('opt.title'), message: h('div', { class: 'opt' }, nav, body), wide: true, buttons: [{ label: t('common.ok'), value: true, primary: true }, { label: t('common.cancel'), value: false }], cancelValue: false });
  if (!ok) return false;
  for (const fn of changes) fn();
  o.onApplied?.();
  return true;
}
