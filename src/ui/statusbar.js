/**
 * Status bar: Page X of Y, word count, language on the left; Focus, the
 * Read/Print/Web view buttons, the zoom slider with − / + and the zoom % on
 * the right (values are static until M3). Right-click to choose which items
 * show, as in Word; the choice is remembered.
 */
import { h } from './dom.js';
import { iconSvg } from './icons.js';
import { t, getLocale } from '../i18n/index.js';
import { openMenu } from './menu.js';
import { getSetting, setSetting } from '../core/settings.js';

const ITEMS = ['page', 'words', 'language', 'focus', 'views', 'zoomSlider', 'zoom'];

export function createStatusBar({ registry, store, toast }) {
  const hidden = new Set(getSetting('statusHidden') || []);
  const cmdButton = (cmd, cls, content, extra = {}) => {
    const b = h('button', { type: 'button', class: `sb-btn ${cls}`, 'data-command': cmd, ...extra }, ...content);
    b.addEventListener('click', () => { if (!registry.run(cmd)) toast(t('toast.comingSoon', { name: registry.label(cmd) }), b); });
    return b;
  };

  const pageEl = h('span', { class: 'sb-item', 'data-item': 'page' });
  const wordsEl = cmdButton('review.wordCount', 'sb-text', [], { 'data-item': 'words', 'data-tip': t('status.wordCountTip') });
  const langEl = cmdButton('review.language', 'sb-text', [], { 'data-item': 'language', 'data-tip': t('status.languageTip') });
  const focusEl = cmdButton('view.focus', 'sb-text sb-focus', [h('span', { html: iconSvg('focus', { size: 14 }) }), h('span', {}, t('status.focus'))], { 'data-item': 'focus' });
  const viewBtn = (cmd, icon, label) => cmdButton(cmd, 'sb-icon', [h('span', { html: iconSvg(icon, { size: 14 }) })], { 'aria-label': t(label), 'data-view': cmd });
  const views = h('span', { class: 'sb-group', 'data-item': 'views' },
    viewBtn('view.readMode', 'read-mode', 'status.readMode'), viewBtn('view.printLayout', 'print-layout', 'status.printLayout'), viewBtn('view.webLayout', 'web-layout', 'status.webLayout'));
  const zoomOut = cmdButton('view.zoomOut', 'sb-icon sb-zoomstep', [h('span', { html: iconSvg('minus', { size: 12 }) })], { 'aria-label': t('status.zoomOut') });
  const zoomIn = cmdButton('view.zoomIn', 'sb-icon sb-zoomstep', [h('span', { html: iconSvg('plus', { size: 12 }) })], { 'aria-label': t('status.zoomIn') });
  const slider = h('span', { class: 'sb-slider', role: 'slider', tabindex: '0', 'aria-label': t('status.zoomSlider'), 'aria-valuemin': '10', 'aria-valuemax': '500', 'data-command': 'view.zoomDialog' },
    h('span', { class: 'sb-slider-track' }), h('span', { class: 'sb-slider-thumb' }));
  const zoomSlider = h('span', { class: 'sb-group sb-zoom', 'data-item': 'zoomSlider' }, zoomOut, slider, zoomIn);
  const zoomPct = cmdButton('view.zoomDialog', 'sb-text sb-pct', [], { 'data-item': 'zoom', 'data-tip': t('status.zoomLevel') });

  const bar = h('footer', { class: 'status-bar', role: 'status', 'aria-label': t('status.label'), 'data-region': 'status' },
    h('div', { class: 'sb-left' }, pageEl, wordsEl, langEl),
    h('div', { class: 'sb-right' }, focusEl, views, zoomSlider, zoomPct));

  function update() {
    const s = store.get();
    pageEl.textContent = t('status.pageOf', { page: 1, pages: 1 });
    wordsEl.textContent = t('status.words', { count: s.words || 0 });
    langEl.textContent = t(`lang.${getLocale()}`);
    zoomPct.textContent = `${s.zoom}%`;
    slider.setAttribute('aria-valuenow', String(s.zoom));
    slider.setAttribute('aria-valuetext', `${s.zoom}%`);
    // Thumb position: 100% sits in the middle (10%…500% scale like Word).
    const frac = s.zoom <= 100 ? ((s.zoom - 10) / 90) * 0.5 : 0.5 + ((s.zoom - 100) / 400) * 0.5;
    slider.style.setProperty('--pos', String(frac));
    for (const b of views.children) b.classList.toggle('is-checked', b.dataset.view === `view.${{ read: 'readMode', print: 'printLayout', web: 'webLayout' }[s.view]}`);
    for (const el of bar.querySelectorAll('[data-item]')) el.hidden = hidden.has(el.dataset.item);
  }

  bar.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openMenu({
      point: { x: e.clientX, y: e.clientY - 8 }, label: t('status.customise'),
      items: [{ header: 'status.customise' }, ...ITEMS.map((id) => ({
        label: t(`status.item.${id}`), checked: !hidden.has(id), keepOpen: true, isChecked: () => !hidden.has(id),
        run: () => { if (hidden.has(id)) hidden.delete(id); else hidden.add(id); setSetting('statusHidden', [...hidden]); update(); },
      }))],
    });
  });

  store.subscribe(update);
  update();
  return { el: bar, update };
}
