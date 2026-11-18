/**
 * Rich tooltips (Word-style ScreenTips) for anything with data-command or
 * data-tip. Shows the label, the shortcut and "Coming soon" for unbuilt
 * commands. One shared element; shown after a short hover or on keyboard focus.
 */
import { h } from './dom.js';
import { t } from '../i18n/index.js';

let tipEl = null;
let timer = null;
let current = null;
let registryRef = null;

function ensureEl() {
  if (tipEl) return tipEl;
  tipEl = h('div', { class: 'tooltip', role: 'tooltip', id: 'app-tooltip', hidden: true });
  document.body.append(tipEl);
  return tipEl;
}

/** Builds tooltip content for an element. Returns null when there's nothing to show. */
function contentFor(el) {
  const reg = registryRef;
  const id = el.dataset.command;
  if (id && reg && reg.has(id)) {
    const cmd = reg.get(id);
    const title = el.dataset.tipLabel || reg.label(id).replace(/…$/, '');
    const keys = reg.shortcutText(id);
    let status = '';
    if (cmd.unavailable) status = t('ribbon.unavailable');
    else if (cmd.comingSoon) status = t('ribbon.comingSoon');
    else if (!reg.isEnabled(id) && cmd.isEnabled) status = t('ribbon.contextual');
    return { title: keys ? `${title} (${keys})` : title, body: el.dataset.tip || '', status };
  }
  if (el.dataset.tip) return { title: el.dataset.tip, body: '', status: '' };
  return null;
}

function show(el) {
  const c = contentFor(el);
  if (!c) return;
  const tip = ensureEl();
  tip.replaceChildren(...[
    h('div', { class: 'tooltip-title' }, c.title),
    c.body ? h('div', { class: 'tooltip-body' }, c.body) : null,
    c.status ? h('div', { class: 'tooltip-status' }, c.status) : null,
  ].filter(Boolean));
  tip.hidden = false;
  const r = el.getBoundingClientRect();
  const tr = tip.getBoundingClientRect();
  let x = r.left;
  let y = r.bottom + 6;
  if (x + tr.width > innerWidth - 8) x = innerWidth - 8 - tr.width;
  if (y + tr.height > innerHeight - 8) y = r.top - 6 - tr.height;
  tip.style.left = `${Math.max(8, x)}px`;
  tip.style.top = `${Math.max(8, y)}px`;
  el.setAttribute('aria-describedby', 'app-tooltip');
  current = el;
}

export function hideTooltip() {
  clearTimeout(timer);
  if (tipEl) tipEl.hidden = true;
  if (current) current.removeAttribute('aria-describedby');
  current = null;
}

/** Installs delegated listeners. */
export function initTooltips(registry) {
  registryRef = registry;
  const target = (e) => e.target instanceof Element && e.target.closest('[data-command], [data-tip]');
  document.addEventListener('pointerover', (e) => {
    const el = target(e);
    if (el === current) return;
    hideTooltip();
    if (!el || el.closest('.menu')) return;
    timer = setTimeout(() => show(el), 450);
  });
  document.addEventListener('pointerdown', hideTooltip, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideTooltip(); }, true);
  document.addEventListener('focusin', (e) => {
    const el = target(e);
    hideTooltip();
    if (el && el.matches(':focus-visible') && !el.closest('.menu')) timer = setTimeout(() => show(el), 600);
  });
  document.addEventListener('focusout', hideTooltip);
  addEventListener('blur', hideTooltip);
  addEventListener('scroll', hideTooltip, true);
}
