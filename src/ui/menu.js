/**
 * Dropdown / context menus (role="menu"). Items:
 *   'cmd.id'                       a command (label, icon, shortcut, checked, Coming soon)
 *   { cmd, label?, icon? }         a command with overrides
 *   { cmd, sub: [...] }            a submenu
 *   { header: 'i18n.key' }         a section header
 *   '-'                            a separator
 *   { custom: 'widgetName' }       a widget from menu-widgets.js (palettes, grids…)
 *   { label, checked, run }        an ad-hoc item (e.g. status bar customisation)
 * Keyboard: ↑/↓/Home/End move, Enter/Space activate, → opens a submenu,
 * ← / Esc close. Clicking outside closes all menus.
 */
import { h } from './dom.js';
import { iconSvg } from './icons.js';
import { t } from '../i18n/index.js';
import { renderWidget } from './menu-widgets.js';
import { hideTooltip } from './tooltip.js';

const stack = []; // open menus, outermost first
let ctx = { registry: null, resolve: (id) => id, toast: () => {} };

export function initMenus(options) {
  ctx = { ...ctx, ...options };
  document.addEventListener('pointerdown', (e) => {
    if (!stack.length) return;
    if (e.target instanceof Element && (e.target.closest('.menu') || stack.some((m) => m.anchor && m.anchor.contains(e.target)))) return;
    closeAllMenus();
  }, true);
  addEventListener('resize', () => closeAllMenus());
  addEventListener('blur', () => closeAllMenus());
}

export const isMenuOpen = () => stack.length > 0;

export function closeAllMenus({ restoreFocus = false } = {}) {
  while (stack.length) closeTop({ restoreFocus: restoreFocus && stack.length === 1 });
}

function closeTop({ restoreFocus = true } = {}) {
  const m = stack.pop();
  if (!m) return;
  m.el.remove();
  if (m.anchor) {
    m.anchor.setAttribute('aria-expanded', 'false');
    m.anchor.classList.remove('is-open');
  }
  m.onClose?.();
  if (restoreFocus && m.anchor && document.contains(m.anchor)) m.anchor.focus({ preventScroll: true });
}

/**
 * Opens a menu next to an anchor element (or at {x, y}).
 * @param {object} o
 * @param {Element} [o.anchor]
 * @param {{x:number,y:number}} [o.point]
 * @param {Array} o.items
 * @param {string} [o.tab] tab id used to resolve short command refs
 * @param {'below'|'right'} [o.placement]
 * @param {boolean} [o.focusFirst]
 * @param {Function} [o.onClose]
 * @param {boolean} [o.keepOthers] keep parent menus open (submenus)
 */
export function openMenu(o) {
  hideTooltip();
  if (!o.keepOthers) closeAllMenus();
  const resolve = (ref) => ctx.resolve(o.tab, ref);
  const menu = h('div', { class: 'menu', role: 'menu', tabindex: '-1', 'aria-label': o.label || '' });
  const entry = { el: menu, anchor: o.anchor || null, onClose: o.onClose };
  for (const item of o.items) menu.append(renderItem(item, resolve, o.tab, entry));
  if (!menu.children.length) return null;
  document.body.append(menu);
  position(menu, o);
  stack.push(entry);
  if (o.anchor) {
    o.anchor.setAttribute('aria-expanded', 'true');
    o.anchor.classList.add('is-open');
  }
  menu.addEventListener('keydown', (e) => onKey(e, entry));
  if (o.focusFirst !== false) (items(menu)[0] || menu).focus({ preventScroll: true });
  else menu.focus({ preventScroll: true });
  return menu;
}

function position(menu, o) {
  const mr = menu.getBoundingClientRect();
  let x;
  let y;
  if (o.point) { x = o.point.x; y = o.point.y; } else {
    const r = o.anchor.getBoundingClientRect();
    if (o.placement === 'right') { x = r.right - 2; y = r.top - 4; } else { x = r.left; y = r.bottom + 2; }
    if (o.placement === 'right' && x + mr.width > innerWidth - 4) x = r.left - mr.width + 2;
  }
  if (x + mr.width > innerWidth - 4) x = innerWidth - 4 - mr.width;
  if (y + mr.height > innerHeight - 4) y = Math.max(4, innerHeight - 4 - mr.height);
  menu.style.left = `${Math.max(4, x)}px`;
  menu.style.top = `${Math.max(4, y)}px`;
}

const items = (menu) => [...menu.querySelectorAll(':scope > [role^="menuitem"], :scope > .menu-widget [data-menu-focus]')];

function renderItem(item, resolve, tab, entry) {
  const reg = ctx.registry;
  if (item === '-') return h('div', { class: 'menu-sep', role: 'separator' });
  if (item.header) return h('div', { class: 'menu-header', role: 'presentation' }, t(item.header));
  if (item.custom) return renderWidget(item.custom, { registry: reg, close: closeAllMenus, toast: ctx.toast });

  if (typeof item === 'object' && !item.cmd) {
    // Ad-hoc item.
    const el = h('div', {
      class: 'menu-item', role: item.checked != null ? 'menuitemcheckbox' : 'menuitem', tabindex: '-1',
      'aria-checked': item.checked != null ? String(!!item.checked) : null,
      onclick: () => { item.run?.(); if (!item.keepOpen) closeAllMenus({ restoreFocus: true }); else el.setAttribute('aria-checked', String(!!item.isChecked?.())); },
    },
    h('span', { class: 'menu-check', html: item.checked ? iconSvg('set-default', { size: 14 }) : '' }),
    h('span', { class: 'menu-label' }, item.label),
    item.detail ? h('span', { class: 'menu-detail' }, item.detail) : null);
    return el;
  }

  // Normalise: a bare string is a command reference (note: strings have a
  // built-in .sub() method, so never read properties off the raw item).
  if (typeof item === 'string') item = { cmd: item };
  const id = resolve(item.cmd);
  const cmd = reg.get(id);
  if (!cmd) throw new Error(`Menu refers to unknown command "${id}"`);
  const enabled = reg.isEnabled(id);
  const checked = reg.isChecked(id);
  const hasSub = !!item.sub;
  const label = item.label ? t(item.label) : reg.label(id);
  const el = h('div', {
    class: `menu-item${enabled || hasSub ? '' : ' is-disabled'}`,
    role: cmd.isChecked ? 'menuitemcheckbox' : 'menuitem',
    tabindex: '-1',
    'data-command': id,
    'aria-disabled': enabled || hasSub ? null : 'true',
    'aria-checked': cmd.isChecked ? String(checked) : null,
    'aria-haspopup': hasSub ? 'menu' : null,
    'aria-expanded': hasSub ? 'false' : null,
  },
  h('span', { class: 'menu-check', html: checked ? iconSvg('set-default', { size: 14 }) : '' }),
  h('span', { class: 'menu-icon', html: cmd.icon ? iconSvg(item.icon || cmd.icon, { size: 16 }) : '' }),
  h('span', { class: 'menu-label' }, label),
  !enabled && cmd.comingSoon ? h('span', { class: 'menu-soon' }, t('ribbon.comingSoon')) : null,
  h('span', { class: 'menu-detail' }, reg.shortcutText(id)),
  hasSub ? h('span', { class: 'menu-sub', html: iconSvg('chevron-right', { size: 14 }) }) : null);

  const openSub = () => {
    while (stack.length && stack.at(-1) !== entry) closeTop({ restoreFocus: false });
    openMenu({ anchor: el, items: item.sub, tab, placement: 'right', keepOthers: true });
  };
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    if (hasSub) { openSub(); return; }
    if (!enabled) { if (cmd.comingSoon) ctx.toast(t('toast.comingSoon', { name: label })); return; }
    closeAllMenus({ restoreFocus: true });
    reg.run(id);
  });
  el.addEventListener('pointerenter', () => {
    el.focus({ preventScroll: true });
    if (hasSub) openSub();
    else while (stack.length && stack.at(-1) !== entry) closeTop({ restoreFocus: false });
  });
  el._openSub = hasSub ? openSub : null;
  return el;
}

function onKey(e, entry) {
  const list = items(entry.el);
  const i = list.indexOf(document.activeElement);
  const move = (d) => { e.preventDefault(); const n = list.length; if (n) list[(i + d + n) % n].focus(); };
  switch (e.key) {
    case 'ArrowDown': move(i < 0 ? 1 : 1); break;
    case 'ArrowUp': move(i < 0 ? 0 : -1); break;
    case 'Home': e.preventDefault(); list[0]?.focus(); break;
    case 'End': e.preventDefault(); list.at(-1)?.focus(); break;
    case 'ArrowRight':
      if (document.activeElement?._openSub) { e.preventDefault(); document.activeElement._openSub(); }
      break;
    case 'ArrowLeft':
    case 'Escape':
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'ArrowLeft' && stack.length < 2) break;
      closeTop();
      break;
    case 'Enter':
    case ' ':
      if (document.activeElement && entry.el.contains(document.activeElement)) { e.preventDefault(); document.activeElement.click(); }
      break;
    case 'Tab':
      e.preventDefault();
      closeAllMenus({ restoreFocus: true });
      break;
    default:
      if (e.key.length === 1 && /\S/.test(e.key)) {
        const k = e.key.toLowerCase();
        const start = i + 1;
        const hit = [...list.slice(start), ...list.slice(0, start)].find((el) => el.textContent.trim().toLowerCase().startsWith(k));
        if (hit) { e.preventDefault(); hit.focus(); }
      }
  }
}
