/**
 * Ribbon control renderers. Each returns a DOM element; every interactive
 * element carries data-command so the ribbon can refresh its enabled/checked
 * state, tooltips can describe it and KeyTips can target it.
 *
 * Control specs (see features/<tab>/index.js):
 *   { t:'large', cmd, label?, split?, menu?, oneLine? }   32px icon over a 1–2 line label
 *   { t:'col', items:[…] }                               up to three small rows
 *   { t:'rows', rows:[[…],[…]] }                         rows of icon buttons / combos (Font, Paragraph)
 *   { t:'row', items:[…] }                               a single row inside a column
 *   { cmd, menu?, split?, iconOnly?, label? }            small (in col) or icon (in rows) button
 *   { t:'combo', cmd, kind, width }                      font name / size combo box
 *   { t:'select', cmd, options, value, width }           drop-down list (citation style, display for review)
 *   { t:'spins', header, items:[{cmd,label,unit,value}] } labelled spin inputs (Layout ▸ Paragraph)
 *   { t:'number', cmd, value, width }                    small numeric input (record number)
 *   { t:'check', cmd }                                   checkbox
 *   { t:'gallery', id, cmd, menu? }                      in-ribbon gallery with ▲ ▼ ⋯
 */
import { h } from '../dom.js';
import { iconSvg } from '../icons.js';
import { t, hasKey } from '../../i18n/index.js';
import { openMenu } from '../menu.js';
import { STYLE_GALLERY, STYLE_SET_GALLERY, styleTile, styleSetTile } from './galleries.js';
import { isFontAvailable } from '../../layout/fonts.js';
import { DEFAULT_BODY_FONT } from '../../config.js';
import { fontList } from '../format-dialogs.js';
import { FONT_SIZES } from '../../core/commands/text.js';

const CARET = () => h('span', { class: 'caret', 'aria-hidden': 'true' });

export function createControlFactory(env) {
  const { registry, store, resolve, toast } = env;

  const labelOf = (spec, id) => {
    if (spec.label) return t(spec.label);
    const key = `label.${id}`;
    return hasKey(key) ? t(key) : registry.label(id);
  };

  /** Click behaviour shared by all command buttons. */
  function activate(id, el, spec, tab) {
    if (registry.isEnabled(id)) { registry.run(id); return; }
    const cmd = registry.get(id);
    if (cmd?.comingSoon) toast(t('toast.comingSoon', { name: registry.label(id).replace(/…$/, '') }), el);
  }

  function menuOpener(spec, tab, anchor) {
    return () => {
      if (anchor.getAttribute('aria-expanded') === 'true') return;
      openMenu({ anchor, items: spec.menu, tab, label: registry.label(resolve(tab, spec.cmd)) });
    };
  }

  function baseButton(id, cls, children, attrs = {}) {
    return h('button', { type: 'button', class: cls, 'data-command': id, 'aria-label': registry.label(id).replace(/…$/, ''), ...attrs }, ...children);
  }

  function large(spec, tab) {
    const id = resolve(tab, spec.cmd);
    const cmd = registry.get(id);
    const lines = labelOf(spec, id).split('\n');
    const labelEl = h('span', { class: 'rb-label' }, lines.map((line, i) => h('span', { class: 'rb-line' }, line, i === lines.length - 1 && spec.menu ? CARET() : null)));
    const icon = h('span', { class: 'rb-icon32', html: iconSvg(cmd.icon || 'file', { size: 32, strokeWidth: 1.25 }) });
    if (spec.menu && spec.split) {
      const top = baseButton(id, 'rb-split-top', [icon], { onclick: () => activate(id, top, spec, tab) });
      const bottom = baseButton(id, 'rb-split-bottom', [labelEl], { 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'data-menu-button': '', 'data-tip-label': labelOf(spec, id).replace('\n', ' ') });
      bottom.setAttribute('aria-label', `${registry.label(id)} – ${t('ribbon.moreOptions')}`);
      bottom.addEventListener('click', menuOpener(spec, tab, bottom));
      return h('div', { class: `rb rb-large rb-split${lines.length > 1 ? ' two-line' : ''}`, role: 'group' }, top, bottom);
    }
    const btn = baseButton(id, `rb rb-large${lines.length > 1 ? ' two-line' : ''}`, [icon, labelEl], spec.menu ? { 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'data-menu-button': '' } : {});
    btn.addEventListener('click', spec.menu ? menuOpener(spec, tab, btn) : () => activate(id, btn, spec, tab));
    return btn;
  }

  /** Small (icon + label) or icon-only button, optionally split or with a menu. */
  function small(spec, tab, { iconOnly = false } = {}) {
    const id = resolve(tab, spec.cmd);
    const cmd = registry.get(id);
    const showLabel = !iconOnly && !spec.iconOnly;
    const content = [h('span', { class: 'rb-icon16', html: iconSvg(cmd.icon || 'file', { size: 16 }) })];
    if (showLabel) content.push(h('span', { class: 'rb-text' }, labelOf(spec, id)));
    const cls = showLabel ? 'rb rb-small' : 'rb rb-icon';
    if (spec.menu && spec.split) {
      const main = baseButton(id, `${cls} rb-split-main`, content, { onclick: () => activate(id, main, spec, tab) });
      const arrow = baseButton(id, 'rb rb-split-arrow', [CARET()], { 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'data-menu-button': '', tabindex: '-1' });
      arrow.setAttribute('aria-label', `${registry.label(id)} – ${t('ribbon.moreOptions')}`);
      arrow.addEventListener('click', menuOpener(spec, tab, arrow));
      return h('div', { class: `rb-splitpair${spec.gap ? ' gap' : ''}`, role: 'group' }, main, arrow);
    }
    if (spec.menu) content.push(CARET());
    const btn = baseButton(id, `${cls}${spec.menu ? ' has-menu' : ''}${spec.gap ? ' gap' : ''}`, content, spec.menu ? { 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'data-menu-button': '' } : {});
    btn.addEventListener('click', spec.menu ? menuOpener(spec, tab, btn) : () => activate(id, btn, spec, tab));
    return btn;
  }

  function combo(spec, tab) {
    const id = resolve(tab, spec.cmd);
    const state = store.get();
    const isFont = spec.kind === 'font';
    const value = isFont ? state.fontName : String(state.fontSize);
    const input = h('input', {
      class: 'rb-combo-input', type: 'text', value, 'aria-label': registry.label(id), 'data-command': id,
      spellcheck: 'false', autocomplete: 'off', role: 'combobox', 'aria-expanded': 'false',
    });
    const warn = isFont ? h('span', { class: 'rb-combo-warn', html: iconSvg('warning-triangle', { size: 12 }), hidden: true }) : null;
    const arrow = h('button', { type: 'button', class: 'rb-combo-arrow', tabindex: '-1', 'aria-label': registry.label(id), 'data-command': id, 'data-menu-button': '' }, CARET());
    const wrap = h('div', { class: `rb-combo${isFont ? ' font' : ' size'}`, style: { width: `${spec.width}px` } }, input, warn, arrow);
    const updateWarn = () => {
      if (!warn) return;
      const name = input.value.trim();
      const missing = name && !isFontAvailable(name);
      warn.hidden = !missing;
      warn.dataset.tip = missing ? t('ribbon.fontMissing', { font: name, fallback: DEFAULT_BODY_FONT.fallback }) : '';
    };
    updateWarn();
    document.fonts?.ready.then(updateWarn);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.value = isFont ? store.get().fontName : String(store.get().fontSize); input.blur(); }
    });
    input.addEventListener('change', () => {
      if (isFont) {
        const name = input.value.trim();
        if (name && registry.isEnabled(id)) registry.run(id, name);
        else if (name) store.set({ fontName: name });
      } else {
        const n = parseFloat(input.value);
        if (n >= 1 && n <= 1638) {
          const v = Math.round(n * 2) / 2;
          if (registry.isEnabled(id)) registry.run(id, v); else store.set({ fontSize: v });
        }
        input.value = String(store.get().fontSize);
      }
      updateWarn();
    });
    const items = isFont
      ? fontList().map((f) => ({ label: f, checked: f === store.get().fontName, run: () => { input.value = f; input.dispatchEvent(new Event('change')); } }))
      : FONT_SIZES.map((n) => ({ label: String(n), checked: n === store.get().fontSize, run: () => { input.value = String(n); input.dispatchEvent(new Event('change')); } }));
    arrow.addEventListener('click', () => openMenu({ anchor: arrow, items: items.map((i) => ({ ...i, checked: i.label === input.value })), tab, label: registry.label(id) }));
    wrap._sync = () => { if (document.activeElement !== input) input.value = isFont ? store.get().fontName : String(store.get().fontSize); updateWarn(); };
    return wrap;
  }

  function select(spec, tab) {
    const id = resolve(tab, spec.cmd);
    const current = resolve(tab, spec.value);
    const btn = baseButton(id, 'rb rb-select', [h('span', { class: 'rb-select-value' }, registry.label(current)), CARET()], { 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'data-menu-button': '', style: `width:${spec.width}px` });
    btn.addEventListener('click', menuOpener({ ...spec, menu: spec.options }, tab, btn));
    if (spec.cmd === 'citationStyle') {
      return h('div', { class: 'rb-select-row' }, h('span', { class: 'rb-icon16', html: iconSvg('citation-style', { size: 16 }) }), h('span', { class: 'rb-text' }, t('cmd.references.citationStyle')), btn);
    }
    return btn;
  }

  function spins(spec, tab) {
    return h('div', { class: 'rb-spins' },
      h('div', { class: 'rb-spins-header' }, t(spec.header)),
      spec.items.map((it) => {
        const id = resolve(tab, it.cmd);
        const input = h('input', {
          class: 'rb-spin-input', type: 'text', inputmode: 'decimal', 'data-command': id, 'aria-label': registry.label(id),
          value: `${it.value.toFixed(it.decimals)} ${it.unit}`, role: 'spinbutton', 'aria-valuenow': String(it.value),
        });
        return h('label', { class: 'rb-spin' }, h('span', { class: 'rb-spin-label' }, t(it.label)), input);
      }));
  }

  function number(spec, tab) {
    const id = resolve(tab, spec.cmd);
    return h('input', { class: 'rb-number', type: 'text', inputmode: 'numeric', value: String(spec.value), 'data-command': id, 'aria-label': registry.label(id), style: `width:${spec.width}px` });
  }

  function check(spec, tab) {
    const id = resolve(tab, spec.cmd);
    const box = h('input', { type: 'checkbox', class: 'rb-checkbox', 'data-command': id });
    const el = h('label', { class: 'rb rb-check', 'data-command': id }, box, h('span', { class: 'rb-text' }, registry.label(id)));
    box.addEventListener('click', (e) => {
      if (!registry.isEnabled(id)) { e.preventDefault(); activate(id, el, spec, tab); return; }
      registry.run(id);
    });
    return el;
  }

  function gallery(spec, tab) {
    const id = resolve(tab, spec.cmd);
    const isStyles = spec.id === 'styles';
    const list = isStyles ? STYLE_GALLERY : STYLE_SET_GALLERY;
    const tiles = h('div', { class: 'gal-tiles', role: 'listbox', 'aria-label': registry.label(id) });
    list.forEach((item, i) => {
      const tile = h('button', {
        type: 'button', class: `gal-tile${isStyles ? '' : ' set'}`, role: 'option', 'data-command': id,
        'data-gallery-item': item.id, 'data-tip-label': t(item.name), 'aria-label': t(item.name), tabindex: i === 0 ? '0' : '-1',
        'aria-selected': String(isStyles ? item.id === 'normal' : item.id === 'default'),
      }, isStyles ? styleTile(item, t) : styleSetTile(item, t));
      tile.addEventListener('click', () => {
        if (registry.isEnabled(id)) registry.run(id, item.id); else activate(id, tile, spec, tab);
      });
      tiles.append(tile);
    });
    const scroll = (dir) => {
      const rowH = tiles.clientHeight;
      tiles.scrollBy({ top: dir * rowH, behavior: 'smooth' });
    };
    const up = h('button', { type: 'button', class: 'gal-btn', 'aria-label': t('ribbon.galleryUp'), 'data-tip': t('ribbon.galleryUp'), onclick: () => scroll(-1), html: iconSvg('chevron-up', { size: 12 }) });
    const down = h('button', { type: 'button', class: 'gal-btn', 'aria-label': t('ribbon.galleryDown'), 'data-tip': t('ribbon.galleryDown'), onclick: () => scroll(1), html: iconSvg('chevron-down', { size: 12 }) });
    const more = h('button', { type: 'button', class: 'gal-btn gal-more', 'aria-label': t('ribbon.galleryMore'), 'data-tip': t('ribbon.galleryMore'), 'data-menu-button': '', 'aria-haspopup': 'true', 'aria-expanded': 'false', html: iconSvg('more', { size: 12 }) });
    const el = h('div', { class: `gal${isStyles ? ' styles' : ' sets'}` }, tiles, h('div', { class: 'gal-scroll' }, up, down, more));
    if (isStyles) {
      // Live gallery: the current style is selected; samples follow the document's styles.
      let samples = null;
      el._sync = () => {
        const s = store.get();
        for (const tile of tiles.children) tile.setAttribute('aria-selected', String(tile.dataset.galleryItem === s.styleId));
        if (s.styleSamples && s.styleSamples !== samples) {
          samples = s.styleSamples;
          for (const tile of tiles.children) {
            const css = samples[tile.dataset.galleryItem];
            const sample = tile.querySelector('.gal-sample');
            if (css && sample) Object.assign(sample.style, css);
          }
        }
      };
    }
    more.addEventListener('click', () => openGalleryPopup(el, tiles, more, spec, tab));
    // Arrow keys move between tiles (roving tabindex).
    tiles.addEventListener('keydown', (e) => {
      const all = [...tiles.children];
      const i = all.indexOf(document.activeElement);
      if (i < 0) return;
      const d = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: Math.round(tiles.clientWidth / all[0].offsetWidth), ArrowUp: -Math.round(tiles.clientWidth / all[0].offsetWidth) }[e.key];
      if (!d) return;
      e.preventDefault();
      const next = all[Math.max(0, Math.min(all.length - 1, i + d))];
      all.forEach((x) => x.setAttribute('tabindex', '-1'));
      next.setAttribute('tabindex', '0');
      next.focus();
    });
    return el;
  }

  /** The ⋯ "more" button expands the gallery into a popup showing every tile. */
  function openGalleryPopup(galleryEl, tiles, anchor, spec, tab) {
    const popup = h('div', { class: 'gal-popup-grid' });
    for (const tile of tiles.children) {
      const copy = tile.cloneNode(true);
      copy.addEventListener('click', () => tile.click());
      copy.setAttribute('tabindex', '-1');
      copy.setAttribute('data-menu-focus', '');
      popup.append(copy);
    }
    const r = galleryEl.getBoundingClientRect();
    const items = [{ custom: '__gallery' }];
    const menu = openMenu({ point: { x: r.left, y: r.top }, anchor, items: spec.menu ? [...items, '-', ...spec.menu] : items, tab, focusFirst: false });
    if (menu) {
      menu.classList.add('gal-popup');
      menu.querySelector('.menu-widget').replaceWith(h('div', { class: 'menu-widget' }, popup));
      menu.style.minWidth = `${r.width}px`;
      popup.querySelector('button')?.focus();
    }
  }

  /** Renders any control spec. `inRows` → buttons are icon-only. */
  function render(spec, tab, { inRows = false } = {}) {
    switch (spec.t) {
      case 'large': return large(spec, tab);
      case 'col': return h('div', { class: 'rb-col' }, spec.items.map((s) => render(s, tab)));
      case 'row': return h('div', { class: 'rb-row' }, spec.items.map((s) => render(s, tab, { inRows: true })));
      case 'rows': return h('div', { class: 'rb-rows' }, spec.rows.map((row) => h('div', { class: 'rb-row' }, row.map((s) => render(s, tab, { inRows: true })))));
      case 'combo': return combo(spec, tab);
      case 'select': return select(spec, tab);
      case 'spins': return spins(spec, tab);
      case 'number': return number(spec, tab);
      case 'check': return check(spec, tab);
      case 'gallery': return gallery(spec, tab);
      default: return small(spec, tab, { iconOnly: inRows });
    }
  }

  return { render, labelOf };
}
