/**
 * Read Mode: the document laid out in screen-sized columns that you page
 * through sideways (arrows, ← / →, Page Up / Down, the mouse wheel), with
 * View ▾ Column Width and Page Colour, and Tools ▾ Find / Read Aloud. It
 * shows a read-only copy of the document; Esc or Edit Document goes back.
 */
import { h } from './dom.js';
import { iconSvg } from './icons.js';
import { openMenu } from './menu.js';
import { t } from '../i18n/index.js';

const COLUMN = { narrow: 440, default: 600, wide: 820 };

export function createReadMode({ store, getView, registry, docTitle }) {
  const content = h('div', { class: 'odt-doc rm-doc' });
  const columns = h('div', { class: 'rm-columns' }, content);
  const viewport = h('div', { class: 'rm-viewport' }, columns);
  const prev = h('button', { type: 'button', class: 'rm-arrow prev', 'aria-label': t('rm.previous'), html: iconSvg('chevron-left', { size: 28 }) });
  const next = h('button', { type: 'button', class: 'rm-arrow next', 'aria-label': t('rm.next'), html: iconSvg('chevron-right', { size: 28 }) });
  const title = h('div', { class: 'rm-title' });
  const status = h('div', { class: 'rm-status', role: 'status' });
  const menuBtn = (label, items) => {
    const b = h('button', { type: 'button', class: 'rm-menu', 'aria-haspopup': 'menu' }, label, h('span', { html: iconSvg('chevron-down', { size: 10 }) }));
    b.addEventListener('click', () => openMenu({ anchor: b, items: items() }));
    return b;
  };
  const tools = menuBtn(t('rm.tools'), () => [
    { label: t('rm.find'), run: () => { exit(); registry.run('home.find'); } },
    { label: registry.label('review.readAloud'), run: () => { exit(); registry.run('review.readAloud'); } },
  ]);
  const viewMenu = menuBtn(t('rm.view'), () => [
    { label: t('rm.editDocument'), run: exit },
    '-',
    ...Object.keys(COLUMN).map((k) => ({ label: t(`rm.col.${k}`), checked: store.get().readColumns === k, run: () => store.set({ readColumns: k }) })),
    '-',
    ...['none', 'sepia', 'inverse'].map((k) => ({ label: t(`rm.colour.${k}`), checked: store.get().readColour === k, run: () => store.set({ readColour: k }) })),
  ]);
  const edit = h('button', { type: 'button', class: 'rm-edit', onclick: () => exit() }, h('span', { html: iconSvg('file-pen', { size: 14 }) }), t('rm.editDocument'));
  const bar = h('header', { class: 'rm-bar' }, tools, viewMenu, title, edit);
  const el = h('div', { class: 'read-mode', hidden: true, role: 'document', 'aria-label': t('cmd.view.readMode'), tabindex: '-1' }, bar, h('div', { class: 'rm-body' }, prev, viewport, next), status);
  let screen = 0;

  const screens = () => Math.max(1, Math.ceil((viewport.scrollWidth - 1) / step()));
  const step = () => viewport.clientWidth + gap();
  const gap = () => 48;

  function layout() {
    const w = viewport.clientWidth;
    const want = COLUMN[store.get().readColumns] || COLUMN.default;
    const n = Math.max(1, Math.floor((w + gap()) / (want + gap())));
    const colW = (w - gap() * (n - 1)) / n;
    columns.style.columnWidth = `${colW}px`;
    columns.style.columnCount = String(n);
    columns.style.columnGap = `${gap()}px`;
    const cs = getComputedStyle(viewport);
    columns.style.height = `${viewport.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)}px`;
    columns.style.width = `${w}px`;
    go(Math.min(screen, screens() - 1));
  }

  function go(i) {
    screen = Math.max(0, Math.min(screens() - 1, i));
    viewport.scrollLeft = screen * step();
    prev.disabled = screen === 0;
    next.disabled = screen >= screens() - 1;
    status.textContent = t('rm.screenOf', { n: screen + 1, count: screens() });
  }

  /** A read-only copy of the editor's content (without page gaps and editing widgets). */
  function fill() {
    const src = getView().dom;
    const copy = src.cloneNode(true);
    copy.removeAttribute('contenteditable');
    copy.classList.add('rm-flow');
    for (const n of copy.querySelectorAll('.pg-gap, .ProseMirror-widget.pg-gap, .ol-mark, .ProseMirror-separator, .ProseMirror-trailingBreak, .sp-err, [data-ink-layer]')) {
      if (n.classList.contains('sp-err')) n.replaceWith(...n.childNodes); else n.remove();
    }
    for (const n of copy.querySelectorAll('[contenteditable]')) n.removeAttribute('contenteditable');
    for (const n of copy.querySelectorAll('.pg-shifted')) n.style.transform = '';
    content.replaceChildren(copy);
    title.textContent = docTitle();
  }

  function enter() {
    fill();
    el.hidden = false;
    el.dataset.colour = store.get().readColour;
    screen = 0;
    requestAnimationFrame(() => { layout(); el.focus(); });
  }

  function exit() {
    if (store.get().view === 'read') store.set({ view: 'print' });
  }

  prev.addEventListener('click', () => go(screen - 1));
  next.addEventListener('click', () => go(screen + 1));
  el.addEventListener('keydown', (e) => {
    if (e.target.closest('.menu')) return;
    const k = e.key;
    if (k === 'ArrowRight' || k === 'PageDown' || k === ' ') { e.preventDefault(); go(screen + 1); }
    else if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); go(screen - 1); }
    else if (k === 'Home') { e.preventDefault(); go(0); }
    else if (k === 'End') { e.preventDefault(); go(screens() - 1); }
    else if (k === 'Escape') { e.preventDefault(); exit(); }
  });
  let wheelAt = 0;
  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const now = performance.now();
    if (now - wheelAt < 250) return;
    wheelAt = now;
    go(screen + ((e.deltaY || e.deltaX) > 0 ? 1 : -1));
  }, { passive: false });
  new ResizeObserver(() => { if (!el.hidden) layout(); }).observe(viewport);

  store.subscribe((s, changed) => {
    if (changed.includes('view')) { if (s.view === 'read') enter(); else el.hidden = true; }
    if (changed.includes('readColumns') && !el.hidden) layout();
    if (changed.includes('readColour')) el.dataset.colour = s.readColour;
  });

  return { el, go, get screen() { return screen; }, get screens() { return screens(); }, isOpen: () => !el.hidden };
}
