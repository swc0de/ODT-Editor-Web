/**
 * KeyTips: tap Alt (or F10) to show letters over the tabs; type a tab's
 * letters to open it and show letters over its controls; type a control's
 * letters to press it. Esc steps back a level; any other key leaves.
 */
import { h } from './dom.js';
import { t } from '../i18n/index.js';
import { isMenuOpen, closeAllMenus } from './menu.js';

/**
 * Assigns prefix-free key tips to labels. Letters used by a single label get a
 * one-letter tip; letters shared by several get two-character tips that start
 * with that letter. `reserved` letters are never used as a first letter.
 * @param {string[]} labels
 * @param {Set<string>} [reserved]
 * @returns {string[]}
 */
export function assignKeyTips(labels, reserved = new Set()) {
  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const firstOf = (label) => {
    const letters = (label.normalize('NFD').toUpperCase().match(/[A-Z]/g) || []);
    return letters.find((c) => !reserved.has(c)) || ALPHA.split('').find((c) => !reserved.has(c));
  };
  const firsts = labels.map(firstOf);
  const counts = {};
  firsts.forEach((f) => { counts[f] = (counts[f] || 0) + 1; });
  const used = new Set();
  return labels.map((label, i) => {
    const f = firsts[i];
    if (counts[f] === 1) return f;
    const rest = label.normalize('NFD').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(1) + '123456789' + ALPHA;
    for (const c of rest) {
      const code = f + c;
      if (!used.has(code)) { used.add(code); return code; }
    }
    return f + i;
  });
}

export function createKeyTips({ ribbon, store, openCommandSearch }) {
  let level = null; // null | 'top' | 'tab'
  let targets = []; // [{ code, el, kind }]
  let buffer = '';
  let altDown = false;
  let altClean = false;
  const layer = h('div', { class: 'keytips-layer', 'aria-hidden': 'true' });
  const live = h('div', { class: 'sr-only', 'aria-live': 'polite' });
  document.body.append(layer, live);

  function badge(el, code) {
    const r = el.getBoundingClientRect();
    const b = h('span', { class: 'keytip' }, code);
    b.style.left = `${Math.round(r.left + r.width / 2)}px`;
    b.style.top = `${Math.round(el.closest('.tabbar') ? r.bottom - 6 : r.bottom - 10)}px`;
    return b;
  }

  function render() {
    layer.replaceChildren(...targets.filter((x) => x.code.startsWith(buffer)).map((x) => badge(x.el, x.code)));
  }

  function showTop() {
    level = 'top';
    buffer = '';
    const tabEls = [...document.querySelectorAll('.tabbar [data-keytip]')];
    targets = tabEls.map((el) => ({ code: el.dataset.keytip, el, kind: el.getAttribute('role') === 'tab' ? 'tab' : 'button' }));
    const spacer = document.querySelector('.tabbar .tabbar-spacer');
    if (spacer) targets.push({ code: 'Q', el: spacer, kind: 'search' });
    live.textContent = t('keytips.hint');
    render();
  }

  function showTab() {
    level = 'tab';
    buffer = '';
    const panel = ribbon.activePanel();
    if (!panel) { exit(); return; }
    const els = [...panel.querySelectorAll('.group:not(.is-collapsed) [data-command], .group.is-collapsed > .group-collapsed-btn')]
      .filter((el) => el.getClientRects().length && !el.matches('.rb-split-arrow, .rb-combo-arrow, .gal-tile:not(:first-child), .rb-check input'));
    // One tip per split pair (its action half) and one per gallery.
    const unique = els.filter((el) => !el.matches('.rb-split-bottom'));
    const labels = unique.map((el) => el.getAttribute('aria-label') || el.textContent || '');
    const codes = assignKeyTips(labels);
    targets = unique.map((el, i) => ({ code: codes[i], el, kind: 'control' }));
    render();
  }

  function exit() {
    level = null;
    buffer = '';
    targets = [];
    layer.replaceChildren();
    document.documentElement.classList.remove('keytips-on');
  }

  function activate(target) {
    const { el, kind } = target;
    if (kind === 'search') { exit(); openCommandSearch(); return; }
    if (kind === 'tab') {
      const id = el.dataset.tab;
      if (id === 'file') { exit(); el.click(); return; }
      ribbon.selectTab(id, { fromClick: store.get().ribbonCollapsed });
      requestAnimationFrame(() => { if (level) showTab(); });
      return;
    }
    exit();
    if (el.tagName === 'INPUT') { el.focus(); el.select?.(); return; }
    if (el.matches('.rb-check')) { el.querySelector('input').click(); return; }
    el.focus();
    el.click();
  }

  function onKeydown(e) {
    if (e.key === 'Alt') {
      altDown = true;
      altClean = !e.repeat && !e.ctrlKey && !e.shiftKey && !e.metaKey;
      return;
    }
    if (altDown) altClean = false;
    if (e.key === 'F10' && !e.altKey && !e.ctrlKey && !e.shiftKey && !level) {
      e.preventDefault();
      start();
      return;
    }
    if (!level) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') {
      if (buffer) { buffer = ''; render(); } else if (level === 'tab') showTop(); else exit();
      return;
    }
    if (e.key === 'Backspace') { buffer = buffer.slice(0, -1); render(); return; }
    const ch = e.key.length === 1 ? e.key.toUpperCase() : '';
    if (!/^[A-Z0-9]$/.test(ch)) { exit(); return; }
    const next = buffer + ch;
    const matches = targets.filter((x) => x.code.startsWith(next));
    if (!matches.length) return; // ignore wrong keys, like Word
    buffer = next;
    const exact = matches.find((x) => x.code === next);
    if (exact && matches.length === 1) activate(exact);
    else render();
  }

  function onKeyup(e) {
    if (e.key !== 'Alt') return;
    const clean = altDown && altClean;
    altDown = false;
    if (!clean) return;
    e.preventDefault();
    if (level) exit(); else start();
  }

  function start() {
    if (isMenuOpen()) closeAllMenus();
    if (store.get().backstageOpen) return;
    document.documentElement.classList.add('keytips-on');
    showTop();
  }

  document.addEventListener('keydown', onKeydown, true);
  document.addEventListener('keyup', onKeyup, true);
  document.addEventListener('pointerdown', () => { if (level) exit(); }, true);
  addEventListener('blur', () => { altDown = false; exit(); });
  addEventListener('resize', () => { if (level) render(); });

  return { start, exit, isActive: () => !!level, get level() { return level; } };
}
