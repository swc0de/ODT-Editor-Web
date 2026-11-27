/**
 * Backstage (File): a full-window view with an indigo navigation column.
 * Home shows a greeting, template previews (real rendered pages), "More
 * templates" and Recent; then New, Open, Info, Recover, Save As, Print,
 * Export and About (Options opens a dialog).
 * Esc or the ‹ back arrow returns to the document.
 */
import { h } from './dom.js';
import { iconSvg } from './icons.js';
import { t } from '../i18n/index.js';
import { setPinned, removeRecent } from '../core/storage.js';
import { TEMPLATES, templateDoc } from '../features/file/templates.js';
import { EXPORTS, FIXED_DEFAULTS } from '../features/file/export.js';
import { SAVE_FORMATS, formatById, formatForName } from '../core/formats.js';
import { fileConversion, webOptions, fixedOptions } from './save-dialogs.js';
import { alertDialog } from './dialog.js';
import { renderInfo } from './info-page.js';
import { renderAbout } from './help.js';

/** Was the last input from the keyboard (so focus moved for it shows its ring)? */
let lastInputKeyboard = false;
addEventListener('keydown', () => { lastInputKeyboard = true; }, true);
addEventListener('pointerdown', () => { lastInputKeyboard = false; }, true);

const NAV = [
  { id: 'home', icon: 'home', label: 'backstage.home' },
  { id: 'new', icon: 'new', label: 'backstage.new' },
  { id: 'open', icon: 'open', label: 'backstage.open' },
  { id: 'info', icon: 'info', label: 'backstage.info' },
  { id: 'recover', icon: 'recover', label: 'backstage.recover' },
  { id: 'save', icon: 'save', label: 'backstage.save', command: 'file.save' },
  { id: 'saveAs', icon: 'save-as', label: 'backstage.saveAs' },
  { id: 'print', icon: 'print', label: 'backstage.print' },
  { id: 'export', icon: 'export', label: 'backstage.export' },
  { id: 'close', icon: 'close', label: 'backstage.close', command: 'file.close' },
  { id: 'options', icon: 'options', label: 'backstage.options', command: 'file.options' },
];

/** Milestone in which each placeholder page is built. */
const PLANNED = {};

export function greetingKey(date = new Date()) {
  const hr = date.getHours();
  if (hr < 12) return 'backstage.goodMorning';
  if (hr < 18) return 'backstage.goodAfternoon';
  return 'backstage.goodEvening';
}

export function createBackstage({ registry, store, toast, session }) {
  const navButtons = new Map();
  const back = h('button', { type: 'button', class: 'bs-back', 'aria-label': t('backstage.back'), 'data-tip': t('backstage.back'), html: iconSvg('chevron-left', { size: 18 }) });
  back.addEventListener('click', () => registry.run('file.closeBackstage'));

  const nav = h('nav', { class: 'bs-nav', 'aria-label': t('backstage.label') }, back);
  const list = h('div', { class: 'bs-nav-list', role: 'group' });
  for (const item of NAV) {
    const btn = h('button', {
      type: 'button', class: 'bs-nav-item', 'data-page': item.id,
      'data-command': item.command || null,
    }, h('span', { class: 'bs-nav-icon', html: iconSvg(item.icon, { size: 16 }) }), h('span', {}, t(item.label)));
    btn.addEventListener('click', () => {
      if (item.command) {
        if (!registry.run(item.command)) toast(t('toast.comingSoon', { name: t(item.label) }), btn);
        return;
      }
      store.set({ backstagePage: item.id });
    });
    navButtons.set(item.id, btn);
    list.append(btn);
  }
  const about = h('button', { type: 'button', class: 'bs-nav-item bs-about', 'data-page': 'about' }, t('backstage.about'));
  about.addEventListener('click', () => store.set({ backstagePage: 'about' }));
  navButtons.set('about', about);
  nav.append(list, h('div', { class: 'bs-nav-bottom' }, about));

  const content = h('main', { class: 'bs-content', role: 'tabpanel', tabindex: '-1' });
  const root = h('div', { class: 'backstage', id: 'backstage', role: 'region', 'aria-label': t('backstage.label'), hidden: true, 'data-region': 'backstage' }, nav, content);
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); registry.run('file.closeBackstage'); }
    // Word's backstage KeyTips (Alt+F, A = Save As…) with focus in the navigation column.
    const KEYS = { h: 'home', n: 'new', o: 'open', i: 'info', r: 'recover', s: 'save', a: 'saveAs', p: 'print', e: 'export', c: 'close', t: 'options' };
    if (e.target.closest('.bs-nav') && !e.ctrlKey && !e.metaKey && !e.altKey && KEYS[e.key.toLowerCase()]) {
      e.preventDefault();
      navButtons.get(KEYS[e.key.toLowerCase()])?.click();
      return;
    }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && e.target.closest('.bs-nav')) {
      const items = [...nav.querySelectorAll('.bs-nav-item')];
      const i = items.indexOf(e.target);
      if (i >= 0) { e.preventDefault(); items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus(); }
    }
  });

  function templateCard(tpl) {
    const page = h('div', { class: 'tp-page', html: tpl.html });
    const thumb = h('span', { class: 'tp-thumb', 'aria-hidden': 'true' }, page);
    const card = h('button', { type: 'button', class: 'tp-card', 'data-template': tpl.id, 'data-command': tpl.id === 'blank' ? null : 'file.new' },
      thumb, h('span', { class: 'tp-caption' }, t(tpl.name)));
    card.setAttribute('aria-label', t(tpl.name));
    card.removeAttribute('data-command');
    card.addEventListener('click', async () => {
      const ok = await session.newDocument({ doc: templateDoc(tpl.id) });
      if (ok) store.set({ backstageOpen: false });
    });
    return card;
  }

  const fmtWhen = (ms) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms));

  /** Recent documents (IndexedDB), pinned first, with pin and remove. */
  function recentList() {
    const list = h('div', { class: 'bs-recent' }, h('p', { class: 'bs-empty' }, t('backstage.recentEmpty')));
    session.listRecent().then((items) => {
      if (!items.length) return;
      list.setAttribute('role', 'list');
      list.replaceChildren(...items.map((e) => {
        const open = h('button', { type: 'button', class: 'bs-recent-open' },
          h('span', { class: 'bs-recent-icon', html: iconSvg((formatById(e.format) || formatForName(e.name))?.icon || 'file-text', { size: 20 }) }),
          h('span', { class: 'bs-recent-text' }, h('span', { class: 'bs-recent-name' }, e.name), h('span', { class: 'bs-recent-when' }, t('backstage.openedAt', { when: fmtWhen(e.openedAt) }))));
        open.addEventListener('click', async () => { if (await session.openRecent(e)) store.set({ backstageOpen: false }); });
        const pin = h('button', { type: 'button', class: `bs-icon-btn${e.pinned ? ' is-on' : ''}`, 'aria-label': t(e.pinned ? 'backstage.unpin' : 'backstage.pin'), 'data-tip': t(e.pinned ? 'backstage.unpin' : 'backstage.pin'), 'aria-pressed': String(e.pinned), html: iconSvg('pin', { size: 14 }) });
        pin.addEventListener('click', async () => { await setPinned(e.id, !e.pinned); refreshPage(); });
        const remove = h('button', { type: 'button', class: 'bs-icon-btn', 'aria-label': t('backstage.remove'), 'data-tip': t('backstage.remove'), html: iconSvg('close', { size: 14 }) });
        remove.addEventListener('click', async () => { await removeRecent(e.id); refreshPage(); });
        return h('div', { class: 'bs-recent-row', role: 'listitem' }, open, pin, remove);
      }));
    });
    return list;
  }

  function renderHome() {
    return h('div', { class: 'bs-home' },
      h('h1', { class: 'bs-title' }, t(greetingKey())),
      h('div', { class: 'tp-row' }, TEMPLATES.filter((x) => x.home !== false).map(templateCard)),
      h('button', { type: 'button', class: 'bs-link', onclick: () => store.set({ backstagePage: 'new' }) }, t('backstage.moreTemplates'), h('span', { class: 'bs-link-arrow', html: iconSvg('arrow-right', { size: 13, strokeWidth: 2 }) })),
      h('h2', { class: 'bs-h2' }, t('backstage.recent')),
      recentList());
  }

  function renderNew() {
    const saveTpl = h('button', { type: 'button', class: 'bs-big-btn', 'data-command': 'file.saveAsTemplate' }, h('span', { html: iconSvg('save-template', { size: 20 }) }), t('backstage.saveAsTemplate'));
    saveTpl.addEventListener('click', async () => { if (await session.saveAs({ asTemplate: true })) store.set({ backstageOpen: false }); });
    const openTpl = h('button', { type: 'button', class: 'bs-big-btn' }, h('span', { html: iconSvg('open', { size: 20 }) }), t('backstage.openTemplate'));
    openTpl.addEventListener('click', async () => { if (await session.openDialog()) store.set({ backstageOpen: false }); });
    return h('div', { class: 'bs-home' }, h('h1', { class: 'bs-title' }, t('backstage.newTitle')),
      h('div', { class: 'tp-row wrap' }, TEMPLATES.map(templateCard)),
      h('h2', { class: 'bs-h2' }, t('backstage.yourTemplates')),
      h('p', { class: 'bs-empty' }, t('backstage.templatesHint')),
      h('div', { class: 'bs-actions' }, saveTpl, openTpl));
  }

  function renderOpen() {
    const browse = h('button', { type: 'button', class: 'bs-big-btn' }, h('span', { html: iconSvg('open', { size: 20 }) }), t('backstage.browse'));
    browse.addEventListener('click', () => registry.run('file.open'));
    return h('div', { class: 'bs-home' },
      h('h1', { class: 'bs-title' }, t('backstage.open')),
      browse, h('p', { class: 'bs-empty bs-gap' }, t('backstage.openHint')),
      h('h2', { class: 'bs-h2' }, t('backstage.recent')), recentList());
  }

  /**
   * Save As, laid out like Word's: "This PC" and "Browse" on the left; the
   * file name, the "Save as type" list, More options… and Save on the right.
   * Without File System Access, Save downloads <name>.<ext>; with it, Save
   * and Browse open the save picker pre-filled with them.
   */
  const pendingOptions = {};
  function renderSaveAs() {
    const info = session.info;
    let format = store.get().saveAsFormat && formatById(store.get().saveAsFormat) ? store.get().saveAsFormat : session.currentFormat();
    const name = h('input', { type: 'text', class: 'bs-input sa-name', value: info.name || '', 'aria-label': t('saveas.fileName'), 'data-saveas-name': '', spellcheck: 'false' });
    const type = h('select', { class: 'bs-select sa-type', 'aria-label': t('saveas.type'), 'data-saveas-type': '' },
      SAVE_FORMATS.map((f) => h('option', { value: f.id, selected: f.id === format ? '' : null, disabled: f.available === false ? '' : null }, t(f.labelKey))));
    const ext = h('span', { class: 'sa-ext', 'aria-hidden': 'true' });
    const note = h('p', { class: 'bs-empty sa-note', role: 'status' });
    const more = h('button', { type: 'button', class: 'bs-link sa-more', 'data-saveas-more': '' }, t('saveas.moreOptions'));
    const saveBtn = h('button', { type: 'button', class: 'bs-print-btn sa-save', 'data-saveas-save': '' }, h('span', { html: iconSvg('save-as', { size: 24 }) }), t('saveas.save'));
    const update = () => {
      format = type.value;
      const f = formatById(format);
      ext.textContent = f.exts[0];
      const notes = [];
      if (f.kind === 'fixed') notes.push(f.available === false ? t('fmt.comingM16') : t('saveas.copyNote', { format: t(`fmt.short.${f.id}`) }));
      notes.push(info.fileName ? t('saveas.current', { file: info.fileName }) : t('saveas.unsaved'));
      if (!session.fsAccess()) notes.push(t('saveas.download'));
      note.textContent = notes.join(' ');
      saveBtn.disabled = f.available === false;
      more.disabled = f.available === false;
    };
    type.addEventListener('change', update);
    // A name typed with an extension picks that type.
    name.addEventListener('change', () => {
      const m = /\.[a-z0-9]+$/i.exec(name.value.trim());
      const f = m && SAVE_FORMATS.find((x) => x.exts.includes(m[0].toLowerCase()) && x.available !== false);
      if (f) { name.value = name.value.trim().slice(0, -m[0].length); type.value = f.id; update(); }
    });
    more.addEventListener('click', async () => {
      const f = formatById(format);
      const cur = { ...(info.format === f.id ? info.options : {}), ...pendingOptions[f.id] };
      let o = null;
      if (f.id === 'txt') o = await fileConversion({ encoding: 'utf-8', lineEnding: 'crlf', ...cur }, session.currentState());
      else if (f.id === 'html') o = await webOptions(cur, info.name);
      else if (f.kind === 'fixed') o = await fixedOptions(f.id, { ...FIXED_DEFAULTS[f.id], ...cur }, registry.context().ui.docArea.pages.length);
      else { await alertDialog(t('saveas.moreOptions'), t('saveas.noOptions')); return; }
      if (o) pendingOptions[f.id] = o;
    });
    const doSave = async () => {
      const f = formatById(format);
      const ok = await session.saveAs({ format: f.id, name: name.value.trim() || info.name, options: pendingOptions[f.id], optionsChosen: !!pendingOptions[f.id], direct: true });
      if (ok) { delete pendingOptions[f.id]; store.set({ backstageOpen: false, saveAsFormat: null }); }
    };
    saveBtn.addEventListener('click', doSave);
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSave(); } });
    const browse = h('button', { type: 'button', class: 'bs-recent-open sa-place', 'data-saveas-browse': '' },
      h('span', { class: 'bs-recent-icon', html: iconSvg('open', { size: 22 }) }),
      h('span', { class: 'bs-recent-text' }, h('span', { class: 'bs-recent-name' }, t('saveas.browse')), h('span', { class: 'bs-recent-when' }, t('saveas.browseDesc'))));
    browse.addEventListener('click', doSave);
    const thisPc = h('div', { class: 'bs-recent-open sa-place is-current', role: 'presentation' },
      h('span', { class: 'bs-recent-icon', html: iconSvg('computer', { size: 22 }) }),
      h('span', { class: 'bs-recent-text' }, h('span', { class: 'bs-recent-name' }, t('saveas.thisPc'))));
    update();
    requestAnimationFrame(() => { name.focus({ preventScroll: true }); name.select(); });
    return h('div', { class: 'bs-home sa-page' }, h('h1', { class: 'bs-title' }, t('backstage.saveAsTitle')),
      h('div', { class: 'sa-cols' },
        h('div', { class: 'sa-places' }, thisPc, browse),
        h('div', { class: 'sa-form' },
          h('h2', { class: 'bs-h2' }, t('saveas.thisPc')),
          h('label', { class: 'sa-row' }, h('span', { class: 'sa-label' }, t('saveas.fileName')), h('span', { class: 'sa-namewrap' }, name, ext)),
          h('label', { class: 'sa-row' }, h('span', { class: 'sa-label' }, t('saveas.type')), type),
          h('div', { class: 'sa-row sa-actions' }, more, saveBtn),
          note)));
  }

  function renderRecover() {
    const list = h('div', { class: 'bs-recent' }, h('p', { class: 'bs-empty' }, t('backstage.recoverEmpty')));
    session.recoverable().then((items) => {
      if (!items.length) return;
      list.setAttribute('role', 'list');
      list.replaceChildren(...items.map((e) => {
        const open = h('button', { type: 'button', class: 'bs-recent-open' },
          h('span', { class: 'bs-recent-icon', html: iconSvg('recover', { size: 20 }) }),
          h('span', { class: 'bs-recent-text' }, h('span', { class: 'bs-recent-name' }, e.name), h('span', { class: 'bs-recent-when' }, t('backstage.savedAt', { when: fmtWhen(e.savedAt) }))));
        open.addEventListener('click', async () => { if (await session.recover(e.id)) store.set({ backstageOpen: false }); });
        const del = h('button', { type: 'button', class: 'bs-text-btn' }, t('backstage.recoverDelete'));
        del.addEventListener('click', async () => { await session.deleteRecovered(e.id); refreshPage(); });
        return h('div', { class: 'bs-recent-row', role: 'listitem' }, open, del);
      }));
    });
    return h('div', { class: 'bs-home' }, h('h1', { class: 'bs-title' }, t('backstage.recoverTitle')), h('p', { class: 'bs-empty bs-gap' }, t('backstage.recoverHint')), list);
  }

  function renderPlaceholder(page) {
    const label = page === 'about' ? t('backstage.about') : t(NAV.find((n) => n.id === page)?.label || 'backstage.home');
    return h('div', { class: 'bs-home' },
      h('h1', { class: 'bs-title' }, label),
      h('p', { class: 'bs-empty' }, t('backstage.placeholder'), ' ', PLANNED[page] ? t('backstage.placeholderIn', { milestone: PLANNED[page] }) : ''));
  }

  /** Print: settings on the left, a preview of the pages on the right. */
  let printOpts = { range: 'all', pages: '' };
  let previewPage = 0;
  function renderPrint() {
    const ui = registry.context().ui;
    const da = ui.docArea;
    const total = da.pages.length;
    previewPage = Math.min(previewPage, total - 1);
    const printBtn = h('button', { type: 'button', class: 'bs-print-btn', 'data-command': 'file.printNow' }, h('span', { html: iconSvg('print', { size: 28 }) }), t('print.print'));
    printBtn.addEventListener('click', async () => {
      store.set({ backstageOpen: false });
      await ui.print.run({ ...printOpts });
    });
    const rangeSel = h('select', { class: 'bs-select', 'aria-label': t('print.pages') },
      ['all', 'current', 'custom'].map((k) => h('option', { value: k, selected: printOpts.range === k ? '' : null }, t(`print.range.${k}`))));
    const pagesInput = h('input', { type: 'text', class: 'bs-input', placeholder: t('print.pagesPlaceholder'), 'aria-label': t('print.pagesLabel'), value: printOpts.pages });
    rangeSel.addEventListener('change', () => { printOpts.range = rangeSel.value; pagesInput.hidden = rangeSel.value !== 'custom'; if (rangeSel.value === 'custom') pagesInput.focus(); });
    pagesInput.addEventListener('input', () => { printOpts.pages = pagesInput.value; if (pagesInput.value) { printOpts.range = 'custom'; rangeSel.value = 'custom'; } });
    pagesInput.hidden = printOpts.range !== 'custom';
    const m = da.model;
    const cm = (px) => `${(px / (96 / 2.54)).toFixed(1)} cm`;
    const setup = m ? `${cm(m.width)} × ${cm(m.first.height)} · ${m.width > m.first.height ? t('print.landscape') : t('print.portrait')} · ${t('print.margins', { top: cm(m.first.marginTop), left: cm(m.first.marginLeft) })}` : '';
    const pageSetup = h('button', { type: 'button', class: 'bs-text-btn', onclick: () => { store.set({ backstageOpen: false }); registry.run('layout.pageSetupDialog'); } }, t('print.pageSetup'));
    const settings = h('div', { class: 'bs-print-settings' },
      h('h1', { class: 'bs-title' }, t('backstage.print')),
      printBtn,
      h('p', { class: 'bs-empty' }, t('print.dialogHint')),
      h('h2', { class: 'bs-h2' }, t('print.settings')),
      h('label', { class: 'bs-field' }, h('span', {}, t('print.pages')), rangeSel),
      pagesInput,
      h('p', { class: 'bs-empty' }, setup), pageSetup);
    // Preview: a copy of the page at a size that fits.
    const frame = h('div', { class: 'bs-print-page' });
    const label = h('span', { class: 'bs-print-label', role: 'status' });
    const prev = h('button', { type: 'button', class: 'bs-icon-btn', 'aria-label': t('print.previousPage'), html: iconSvg('chevron-left', { size: 16 }) });
    const next = h('button', { type: 'button', class: 'bs-icon-btn', 'aria-label': t('print.nextPage'), html: iconSvg('chevron-right', { size: 16 }) });
    const show = () => {
      const el = da.view.pageElement(previewPage);
      frame.replaceChildren();
      label.textContent = t('print.pageOf', { n: previewPage + 1, count: total });
      prev.disabled = previewPage <= 0;
      next.disabled = previewPage >= total - 1;
      if (!el) return;
      const scale = Math.min(520 / el.offsetHeight, 420 / el.offsetWidth);
      frame.style.width = `${el.offsetWidth * scale}px`;
      frame.style.height = `${el.offsetHeight * scale}px`;
      const copy = da.view.stack.cloneNode(true);
      for (const x of copy.querySelectorAll('[contenteditable]')) x.removeAttribute('contenteditable');
      for (const x of copy.querySelectorAll('.comments-layer')) x.remove();
      copy.style.zoom = String(scale);
      copy.style.position = 'absolute';
      copy.style.left = `${-el.offsetLeft}px`;
      copy.style.top = `${-el.offsetTop}px`;
      copy.setAttribute('aria-hidden', 'true');
      copy.inert = true;
      frame.append(copy);
    };
    prev.addEventListener('click', () => { previewPage--; show(); });
    next.addEventListener('click', () => { previewPage++; show(); });
    requestAnimationFrame(show);
    const preview = h('div', { class: 'bs-print-preview' }, frame, h('div', { class: 'bs-print-nav' }, prev, label, next));
    return h('div', { class: 'bs-home bs-print' }, settings, preview);
  }

  /** Export: one button per format. */
  function renderExport() {
    const list = h('div', { class: 'bs-export' }, EXPORTS.map((f) => {
      const b = h('button', { type: 'button', class: 'bs-export-item', 'data-command': `file.export_${f.id}`, 'data-format': f.id },
        h('span', { class: 'bs-export-icon', html: iconSvg(f.icon, { size: 22 }) }),
        h('span', { class: 'bs-export-text' }, h('span', { class: 'bs-export-name' }, t(`export.${f.id}`)), h('span', { class: 'bs-export-desc' }, t(`export.${f.id}Desc`))));
      b.addEventListener('click', async () => {
        const ok = await registry.run(`file.export_${f.id}`);
        if (f.id === 'pdf' && ok !== false) store.set({ backstageOpen: false });
      });
      return b;
    }));
    // Create PDF/XPS Document: Save As with PDF selected (dimmed until the PDF/XPS writers exist).
    const pdfXps = h('button', { type: 'button', class: 'bs-export-item bs-export-pdfxps', 'data-command': 'file.createPdfXps', disabled: registry.isEnabled('file.createPdfXps') ? null : '', 'data-tip': registry.isEnabled('file.createPdfXps') ? null : t('fmt.comingM16') },
      h('span', { class: 'bs-export-icon', html: iconSvg('fmt-pdf', { size: 22 }) }),
      h('span', { class: 'bs-export-text' }, h('span', { class: 'bs-export-name' }, t('export.createPdfXps')), h('span', { class: 'bs-export-desc' }, t('export.createPdfXpsDesc'))));
    pdfXps.addEventListener('click', () => registry.run('file.createPdfXps'));
    list.prepend(pdfXps);
    return h('div', { class: 'bs-home' }, h('h1', { class: 'bs-title' }, t('backstage.exportTitle')), h('p', { class: 'bs-empty' }, t('backstage.exportHint')), list);
  }

  const PAGES = { home: renderHome, new: renderNew, open: renderOpen, saveAs: renderSaveAs, recover: renderRecover, export: renderExport, print: renderPrint, about: renderAbout, info: () => renderInfo({ registry, store, session, refresh: () => refreshPage() }) };
  function renderPage(page) { content.replaceChildren((PAGES[page] || (() => renderPlaceholder(page)))()); }
  function refreshPage() { renderPage(store.get().backstagePage); }

  let lastFocus = null;
  function apply(state, changed) {
    if (changed && !changed.some((k) => k === 'backstageOpen' || k === 'backstagePage')) return;
    const wasOpen = !root.hidden;
    root.hidden = !state.backstageOpen;
    document.documentElement.classList.toggle('backstage-open', state.backstageOpen);
    if (!state.backstageOpen) {
      if (wasOpen && lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
      return;
    }
    if (!wasOpen) lastFocus = document.activeElement;
    for (const [id, btn] of navButtons) {
      const on = id === state.backstagePage;
      btn.classList.toggle('is-active', on);
      // The page being shown (Save, Close and Options are actions, not pages).
      if (on) btn.setAttribute('aria-current', 'page'); else btn.removeAttribute('aria-current');
    }
    renderPage(state.backstagePage);
    // The ring shows only for keyboard users (as in the reference, opened with the mouse).
    if (!wasOpen) requestAnimationFrame(() => navButtons.get(state.backstagePage)?.focus({ preventScroll: true, focusVisible: lastInputKeyboard }));
  }
  store.subscribe(apply);
  apply(store.get());
  return { el: root };
}
