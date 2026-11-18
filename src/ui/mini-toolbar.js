/**
 * The floating mini-toolbar shown above a mouse selection (and with the
 * context menu), and the document's right-click context menu. Both call the
 * same commands as the ribbon.
 */
import { h } from './dom.js';
import { t } from '../i18n/index.js';
import { iconSvg } from './icons.js';
import { openMenu, isMenuOpen } from './menu.js';
import { listAt } from '../core/commands/lists.js';

const BUTTONS = [
  ['home.bold', 'bold'], ['home.italic', 'italic'], ['home.underline', 'underline'],
  ['home.highlight', 'highlight', 'highlightPalette'], ['home.fontColour', 'font-colour', 'colourPalette'],
  null,
  ['home.bullets', 'bullets', 'bulletLibrary'], ['home.numbering', 'numbering', 'numberLibrary'],
  ['home.formatPainter', 'format-painter'], ['home.applyStyle', 'styles-pane', 'styles'],
];

export function createMiniToolbar({ registry, store, editor }) {
  const font = h('input', { class: 'mt-font', type: 'text', 'aria-label': registry.label('home.fontName'), spellcheck: 'false' });
  const size = h('input', { class: 'mt-size', type: 'text', 'aria-label': registry.label('home.fontSize'), spellcheck: 'false' });
  const btn = (id, icon, menu) => {
    const b = h('button', { type: 'button', class: 'mt-btn', 'data-command': id, 'aria-label': registry.label(id), 'data-tip-label': registry.label(id), html: iconSvg(icon, { size: 16 }) });
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => {
      if (menu === 'styles') {
        openMenu({ anchor: b, items: ['normal', 'noSpacing', 'heading1', 'heading2', 'heading3', 'title', 'subtitle', 'quote'].map((id2) => ({ label: t(`style.${id2}`), run: () => registry.run('home.applyStyle', id2) })) });
        return;
      }
      if (menu) { openMenu({ anchor: b, items: [{ custom: menu, cmd: id }] }); return; }
      registry.run(id);
      sync();
    });
    return b;
  };
  const row1 = h('div', { class: 'mt-row' }, font, size,
    btn('home.growFont', 'grow-font'), btn('home.shrinkFont', 'shrink-font'), btn('home.clearFormatting', 'clear-formatting'));
  const row2 = h('div', { class: 'mt-row' }, BUTTONS.map((b) => (b ? btn(...b) : h('span', { class: 'mt-sep' }))));
  const el = h('div', { class: 'mini-toolbar', role: 'toolbar', 'aria-label': t('mini.label'), hidden: true }, row1, row2);
  document.body.append(el);

  for (const [input, id] of [[font, 'home.fontName'], [size, 'home.fontSize']]) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); registry.run(id, id === 'home.fontSize' ? parseFloat(input.value) : input.value.trim()); hide(); }
      if (e.key === 'Escape') { e.preventDefault(); hide(); editor.focus(); }
      e.stopPropagation();
    });
  }

  function sync() {
    const s = store.get();
    if (document.activeElement !== font) font.value = s.fontName;
    if (document.activeElement !== size) size.value = String(s.fontSize);
    for (const b of el.querySelectorAll('[data-command]')) b.classList.toggle('is-checked', registry.isChecked(b.dataset.command));
  }

  let shownAt = null;
  function show(x, y) {
    sync();
    el.hidden = false;
    const r = el.getBoundingClientRect();
    el.style.left = `${Math.max(4, Math.min(innerWidth - r.width - 4, x - r.width / 2))}px`;
    el.style.top = `${Math.max(4, y - r.height - 10)}px`;
    el.style.opacity = '1';
    shownAt = { x, y };
  }
  function hide() { el.hidden = true; shownAt = null; }

  // Appears after a mouse selection; fades as the pointer moves away, like Word.
  editor.view.dom.addEventListener('mouseup', (e) => {
    if (e.button !== 0 || store.get().formatPainter) return;
    setTimeout(() => {
      const sel = editor.view.state.selection;
      if (sel.empty || isMenuOpen()) { hide(); return; }
      show(e.clientX, e.clientY - 8);
    }, 10);
  });
  document.addEventListener('mousemove', (e) => {
    if (!shownAt || el.contains(e.target)) { if (shownAt) el.style.opacity = '1'; return; }
    const d = Math.hypot(e.clientX - shownAt.x, e.clientY - shownAt.y);
    if (d > 220) hide(); else el.style.opacity = String(Math.max(0.25, 1 - Math.max(0, d - 40) / 180));
  });
  document.addEventListener('keydown', (e) => { if (!el.contains(e.target) && !el.hidden) hide(); }, true);
  editor.view.dom.addEventListener('mousedown', () => hide());
  editor.view.dom.addEventListener('scroll', hide, { passive: true });

  return { el, show, hide, isVisible: () => !el.hidden };
}

/** Right-click menu in the document. */
export function attachContextMenu({ registry, editor, mini }) {
  editor.view.dom.addEventListener('contextmenu', (e) => {
    if (e.shiftKey) return; // Shift+right-click: the browser's own menu (spelling suggestions)
    e.preventDefault();
    const view = editor.view;
    // Right-clicking outside the selection moves the caret there, like Word.
    const hit = view.posAtCoords({ left: e.clientX, top: e.clientY });
    const sel = view.state.selection;
    if (hit && (hit.pos < sel.from || hit.pos > sel.to)) editor.focusAt(hit.pos);
    const inList = !!listAt(view.state);
    const items = [
      'home.cut', 'home.copy',
      { header: 'menu.pasteOptions' }, 'home.pasteKeepSource', 'home.pasteMerge', 'home.pasteTextOnly',
      '-',
      'home.fontDialog', 'home.paragraphDialog',
      ...(inList ? ['-', 'home.restartNumbering', 'home.continueNumbering', 'home.setNumberingValue'] : []),
      '-',
      'home.find', 'insert.link', 'insert.comment',
    ];
    openMenu({ point: { x: e.clientX, y: e.clientY }, items, label: t('mini.contextMenu') });
    mini.show(e.clientX, e.clientY - 6);
  });
}
