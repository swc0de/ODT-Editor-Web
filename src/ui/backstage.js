/**
 * Backstage (File): a full-window view with an indigo navigation column.
 * Home shows a greeting, template previews (real rendered pages), "More
 * templates" and Recent. Other pages are placeholders until their milestone.
 * Esc or the ‹ back arrow returns to the document.
 */
import { h } from './dom.js';
import { iconSvg } from './icons.js';
import { t } from '../i18n/index.js';
import { setPinned, removeRecent } from '../core/storage.js';
import { TEMPLATES, templateDoc } from '../features/file/templates.js';

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
  { id: 'options', icon: 'options', label: 'backstage.options' },
];

/** Milestone in which each placeholder page is built. */
const PLANNED = { info: 'M13', print: 'M13', export: 'M13', options: 'M13', about: 'M13' };

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
  const list = h('div', { class: 'bs-nav-list', role: 'tablist', 'aria-orientation': 'vertical' });
  for (const item of NAV) {
    const btn = h('button', {
      type: 'button', class: 'bs-nav-item', role: item.command ? null : 'tab', 'data-page': item.id,
      'data-command': item.command || null, 'aria-selected': item.command ? null : 'false',
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
  const about = h('button', { type: 'button', class: 'bs-nav-item bs-about', role: 'tab', 'data-page': 'about', 'aria-selected': 'false' }, t('backstage.about'));
  about.addEventListener('click', () => store.set({ backstagePage: 'about' }));
  navButtons.set('about', about);
  nav.append(list, h('div', { class: 'bs-nav-bottom' }, about));

  const content = h('main', { class: 'bs-content', role: 'tabpanel', tabindex: '-1' });
  const root = h('div', { class: 'backstage', id: 'backstage', role: 'region', 'aria-label': t('backstage.label'), hidden: true, 'data-region': 'backstage' }, nav, content);
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); registry.run('file.closeBackstage'); }
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
    const list = h('div', { class: 'bs-recent', role: 'list' }, h('p', { class: 'bs-empty' }, t('backstage.recentEmpty')));
    session.listRecent().then((items) => {
      if (!items.length) return;
      list.replaceChildren(...items.map((e) => {
        const open = h('button', { type: 'button', class: 'bs-recent-open', role: 'listitem' },
          h('span', { class: 'bs-recent-icon', html: iconSvg('file-text', { size: 20 }) }),
          h('span', { class: 'bs-recent-text' }, h('span', { class: 'bs-recent-name' }, e.name), h('span', { class: 'bs-recent-when' }, t('backstage.openedAt', { when: fmtWhen(e.openedAt) }))));
        open.addEventListener('click', async () => { if (await session.openRecent(e)) store.set({ backstageOpen: false }); });
        const pin = h('button', { type: 'button', class: `bs-icon-btn${e.pinned ? ' is-on' : ''}`, 'aria-label': t(e.pinned ? 'backstage.unpin' : 'backstage.pin'), 'data-tip': t(e.pinned ? 'backstage.unpin' : 'backstage.pin'), 'aria-pressed': String(e.pinned), html: iconSvg('pin', { size: 14 }) });
        pin.addEventListener('click', async () => { await setPinned(e.id, !e.pinned); refreshPage(); });
        const remove = h('button', { type: 'button', class: 'bs-icon-btn', 'aria-label': t('backstage.remove'), 'data-tip': t('backstage.remove'), html: iconSvg('close', { size: 14 }) });
        remove.addEventListener('click', async () => { await removeRecent(e.id); refreshPage(); });
        return h('div', { class: 'bs-recent-row' }, open, pin, remove);
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

  function renderSaveAs() {
    const saveAs = h('button', { type: 'button', class: 'bs-big-btn' }, h('span', { html: iconSvg('save-as', { size: 20 }) }), t('backstage.saveAsOdt'));
    saveAs.addEventListener('click', async () => { if (await session.saveAs()) store.set({ backstageOpen: false }); });
    const copy = h('button', { type: 'button', class: 'bs-big-btn' }, h('span', { html: iconSvg('download', { size: 20 }) }), t('backstage.downloadCopy'));
    copy.addEventListener('click', () => session.downloadCopy());
    return h('div', { class: 'bs-home' }, h('h1', { class: 'bs-title' }, t('backstage.saveAsTitle')),
      h('div', { class: 'bs-actions' }, saveAs, copy), h('p', { class: 'bs-empty bs-gap' }, t('backstage.saveAsHint')));
  }

  function renderRecover() {
    const list = h('div', { class: 'bs-recent', role: 'list' }, h('p', { class: 'bs-empty' }, t('backstage.recoverEmpty')));
    session.recoverable().then((items) => {
      if (!items.length) return;
      list.replaceChildren(...items.map((e) => {
        const open = h('button', { type: 'button', class: 'bs-recent-open', role: 'listitem' },
          h('span', { class: 'bs-recent-icon', html: iconSvg('recover', { size: 20 }) }),
          h('span', { class: 'bs-recent-text' }, h('span', { class: 'bs-recent-name' }, e.name), h('span', { class: 'bs-recent-when' }, t('backstage.savedAt', { when: fmtWhen(e.savedAt) }))));
        open.addEventListener('click', async () => { if (await session.recover(e.id)) store.set({ backstageOpen: false }); });
        const del = h('button', { type: 'button', class: 'bs-text-btn' }, t('backstage.recoverDelete'));
        del.addEventListener('click', async () => { await session.deleteRecovered(e.id); refreshPage(); });
        return h('div', { class: 'bs-recent-row' }, open, del);
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

  const PAGES = { home: renderHome, new: renderNew, open: renderOpen, saveAs: renderSaveAs, recover: renderRecover };
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
      if (btn.getAttribute('role') === 'tab') btn.setAttribute('aria-selected', String(on));
    }
    renderPage(state.backstagePage);
    if (!wasOpen) requestAnimationFrame(() => navButtons.get(state.backstagePage)?.focus({ preventScroll: true }));
  }
  store.subscribe(apply);
  apply(store.get());
  return { el: root };
}
