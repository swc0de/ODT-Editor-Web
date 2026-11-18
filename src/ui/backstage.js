/**
 * Backstage (File): a full-window view with an indigo navigation column.
 * Home shows a greeting, template previews (real rendered pages), "More
 * templates" and Recent. Other pages are placeholders until their milestone.
 * Esc or the ‹ back arrow returns to the document.
 */
import { h } from './dom.js';
import { iconSvg } from './icons.js';
import { t } from '../i18n/index.js';
import { TEMPLATES } from '../features/file/templates.js';

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
const PLANNED = { new: 'M2', open: 'M2', recover: 'M2', saveAs: 'M2', info: 'M13', print: 'M13', export: 'M13', options: 'M13', about: 'M13' };

export function greetingKey(date = new Date()) {
  const hr = date.getHours();
  if (hr < 12) return 'backstage.goodMorning';
  if (hr < 18) return 'backstage.goodAfternoon';
  return 'backstage.goodEvening';
}

export function createBackstage({ registry, store, toast }) {
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
    card.addEventListener('click', () => {
      // The current document is already blank, so "Blank document" returns to it.
      if (tpl.id === 'blank') { registry.run('file.closeBackstage'); return; }
      if (!registry.run('file.new')) toast(t('toast.comingSoon', { name: t(tpl.name) }), card);
    });
    return card;
  }

  function renderHome() {
    return h('div', { class: 'bs-home' },
      h('h1', { class: 'bs-title' }, t(greetingKey())),
      h('div', { class: 'tp-row' }, TEMPLATES.map(templateCard)),
      h('button', { type: 'button', class: 'bs-link', onclick: () => store.set({ backstagePage: 'new' }) }, t('backstage.moreTemplates'), h('span', { class: 'bs-link-arrow', html: iconSvg('arrow-right', { size: 13, strokeWidth: 2 }) })),
      h('h2', { class: 'bs-h2' }, t('backstage.recent')),
      h('p', { class: 'bs-empty' }, t('backstage.recentEmpty')));
  }

  function renderPlaceholder(page) {
    const label = page === 'about' ? t('backstage.about') : t(NAV.find((n) => n.id === page)?.label || 'backstage.home');
    return h('div', { class: 'bs-home' },
      h('h1', { class: 'bs-title' }, label),
      h('p', { class: 'bs-empty' }, t('backstage.placeholder'), ' ', PLANNED[page] ? t('backstage.placeholderIn', { milestone: PLANNED[page] }) : ''));
  }

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
    content.replaceChildren(state.backstagePage === 'home' ? renderHome() : renderPlaceholder(state.backstagePage));
    if (!wasOpen) requestAnimationFrame(() => navButtons.get(state.backstagePage)?.focus({ preventScroll: true }));
  }
  store.subscribe(apply);
  apply(store.get());
  return { el: root };
}
