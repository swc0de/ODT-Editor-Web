/**
 * Galleries and menu widgets for drawing objects: picture styles, shape
 * styles, the shapes gallery, Position, Corrections, Colour (recolour),
 * WordArt and text-box galleries.
 */
import { h } from './dom.js';
import { t } from '../i18n/index.js';
import { SHAPES, SHAPE_GROUPS, shapeIconPath } from '../core/shapes.js';
import { PICTURE_STYLES, SHAPE_STYLES } from '../features/objects/format.js';
import { POSITIONS } from '../features/objects/arrange.js';
import { WORDART_STYLES, TEXTBOX_PRESETS } from '../features/insert/objects.js';
import { COVER_PAGES, autoTextEntries, deleteAutoText } from '../features/insert/text-parts.js';
import { EQUATION_PRESETS } from '../core/equations.js';

const SVG = (inner, w = 20, hgt = 20, extra = '') => `<svg viewBox="0 0 ${w} ${hgt}" width="${w}" height="${hgt}" ${extra}>${inner}</svg>`;

function bind(el, { registry, close, toast }, cmdId, run) {
  const enabled = registry.isEnabled(cmdId);
  if (!enabled) el.classList.add('is-disabled');
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!enabled) { toast(t('toast.comingSoon', { name: registry.label(cmdId) })); return; }
    close({ restoreFocus: true });
    run?.();
  });
}

/** CSS border from an ODF border for small previews. */
const previewBorder = (b) => (!b || b === 'none' ? 'none' : b.replace(/([\d.]+)pt/, (_, n) => `${Math.max(1, Math.min(4, Number(n) / 2))}px`));

/** Ribbon tile galleries. */
export function objectGalleryItems(id) {
  if (id === 'pictureStyles') {
    return Object.entries(PICTURE_STYLES).map(([sid, g]) => {
      const sh = g['style:shadow'] && g['style:shadow'] !== 'none' ? '2px 2px 0 rgba(0,0,0,.45)' : 'none';
      const node = h('span', { class: 'pic-prev', style: { border: previewBorder(g['fo:border']), boxShadow: sh } }, h('span', { class: 'pic-prev-img' }));
      return { id: sid, label: t(`pstyle.${sid}`), node };
    });
  }
  if (id === 'shapeStyles') {
    return Object.entries(SHAPE_STYLES).map(([sid, s]) => {
      const [variant, n] = [sid.replace(/\d+$/, ''), Number(sid.match(/\d+$/)[0])];
      const node = h('span', { class: 'shp-prev', style: { background: s.fill, border: s.stroke === 'none' ? '1px solid transparent' : `1px solid ${s.stroke}`, color: s.text, boxShadow: s.shadow ? '2px 2px 2px rgba(0,0,0,.4)' : 'none' } }, 'Abc');
      return { id: sid, label: `${t(`sstyle.${variant}`)} – ${t(`accent.${n}`)}`, node };
    });
  }
  if (id === 'shapesMini') {
    return Object.keys(SHAPES).map((sid) => ({ id: sid, label: t(`shape.${sid}`), cls: 'shape-cell', node: h('span', { html: shapeIcon(sid) }) }));
  }
  return null;
}

const shapeIcon = (sid) => SVG(`<path d="${shapeIconPath(sid)}" transform="translate(1 ${SHAPES[sid].line ? 0 : 1})" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>${SHAPES[sid].end ? '<path d="M18 2l-5 1 4 4z" fill="currentColor"/>' : ''}${SHAPES[sid].start ? '<path d="M2 18l5-1-4-4z" fill="currentColor"/>' : ''}`);

/** Insert ▸ Shapes: every preset by group. */
function shapesGallery(o, cmdId = 'insert.insertShape') {
  const out = h('div', { class: 'menu-widget shapes' });
  let first = true;
  for (const g of SHAPE_GROUPS) {
    const ids = Object.keys(SHAPES).filter((sid) => SHAPES[sid].group === g);
    out.append(h('div', { class: 'menu-header' }, t(`shapeGroup.${g}`)));
    out.append(h('div', { class: 'shape-grid' }, ids.map((sid) => {
      const b = h('button', { type: 'button', class: 'shape-cell', tabindex: '-1', 'aria-label': t(`shape.${sid}`), 'data-tip': t(`shape.${sid}`), 'data-menu-focus': first ? '' : null, html: shapeIcon(sid) });
      first = false;
      bind(b, o, cmdId, () => o.registry.run(cmdId, sid));
      return b;
    })));
  }
  return out;
}

/** Position: In Line with Text, and nine "With Text Wrapping" places. */
function positionGallery(o) {
  const cmdId = o.cmd || 'layout.position';
  const page = (hx, vy) => {
    const x = { left: 3, center: 7.5, right: 12 }[hx];
    const y = { top: 3, middle: 8, bottom: 13 }[vy];
    return SVG(`<rect x="1.5" y="0.5" width="17" height="19" fill="#fff" stroke="#888"/>${[3, 5, 7, 9, 11, 13, 15, 17].map((ly) => `<line x1="3" x2="17" y1="${ly}" y2="${ly}" stroke="#bbb" stroke-width="0.8"/>`).join('')}<rect x="${x}" y="${y}" width="5" height="4" fill="#5b6ee1"/>`, 20, 20);
  };
  const inline = h('button', { type: 'button', class: 'pos-cell', tabindex: '-1', 'data-menu-focus': '', 'aria-label': t('menu.positionInline'), 'data-tip': t('menu.positionInline'), html: SVG('<rect x="1.5" y="0.5" width="17" height="19" fill="#fff" stroke="#888"/><line x1="3" x2="17" y1="3" y2="3" stroke="#bbb"/><line x1="3" x2="8" y1="7" y2="7" stroke="#bbb"/><rect x="9" y="5" width="5" height="4" fill="#5b6ee1"/><line x1="15" x2="17" y1="7" y2="7" stroke="#bbb"/><line x1="3" x2="17" y1="11" y2="11" stroke="#bbb"/>') });
  bind(inline, o, 'layout.positionInline', () => o.registry.run('layout.positionInline'));
  const grid = h('div', { class: 'pos-grid' }, Object.entries(POSITIONS).map(([pid, [hx, vy]]) => {
    const b = h('button', { type: 'button', class: 'pos-cell', tabindex: '-1', 'aria-label': t(`pos.${pid}`), 'data-tip': t(`pos.${pid}`), html: page(hx, vy) });
    bind(b, o, cmdId, () => o.registry.run(cmdId, pid));
    return b;
  }));
  return h('div', { class: 'menu-widget' }, h('div', { class: 'menu-header' }, t('menu.positionInline')), h('div', { class: 'pos-grid one' }, inline), h('div', { class: 'menu-header' }, t('menu.withTextWrapping')), grid);
}

/** The selected picture's URL, for live previews. */
function currentPicture(o) {
  const c = o.registry.context();
  const s = c.ui.objects?.selected(c.editor) || c.ui.objects?.selected(c.mainEditor);
  return s?.node.attrs.kind === 'image' ? c.ui.pictureUrl?.(s.node.attrs.href) || '' : '';
}

function thumb(url, filter) {
  return h('span', { class: 'pic-thumb' }, url ? h('img', { src: url, alt: '', style: { filter } }) : h('span', { class: 'pic-prev-img', style: { filter } }));
}

/** Corrections: a 5×5 grid of brightness × contrast. */
function correctionsGallery(o) {
  const cmdId = o.cmd || 'pictureFormat.correction';
  const url = currentPicture(o);
  const steps = [-40, -20, 0, 20, 40];
  let first = true;
  const grid = h('div', { class: 'thumb-grid five' });
  for (const c of steps) {
    for (const b of steps) {
      const label = t('menu.brightnessContrastValue', { b: b > 0 ? `+${b}` : b, c: c > 0 ? `+${c}` : c });
      const cell = h('button', { type: 'button', class: 'thumb-cell', tabindex: '-1', 'aria-label': label, 'data-tip': label, 'data-menu-focus': first ? '' : null }, thumb(url, `brightness(${1 + b / 100}) contrast(${1 + c / 100})`));
      first = false;
      bind(cell, o, cmdId, () => o.registry.run(cmdId, { b, c }));
      grid.append(cell);
    }
  }
  return h('div', { class: 'menu-widget' }, h('div', { class: 'menu-header' }, t('menu.brightnessContrast')), grid);
}

export const RECOLOURS = {
  none: { css: 'none' },
  greyscale: { mode: 'greyscale', css: 'grayscale(1)' },
  sepia: { r: 20, g: 5, b: -15, mode: 'greyscale', css: 'sepia(1)' },
  washout: { mode: 'watermark', css: 'brightness(1.5) contrast(0.3)' },
  mono: { mode: 'mono', css: 'grayscale(1) contrast(12)' },
  blue: { r: -20, g: 0, b: 25, css: 'sepia(.6) hue-rotate(170deg) saturate(1.6)' },
  green: { r: -15, g: 20, b: -15, css: 'sepia(.6) hue-rotate(60deg) saturate(1.5)' },
  orange: { r: 25, g: 5, b: -20, css: 'sepia(.7) saturate(1.8)' },
  purple: { r: 15, g: -15, b: 20, css: 'sepia(.6) hue-rotate(240deg) saturate(1.4)' },
};

function recolourGallery(o) {
  const cmdId = o.cmd || 'pictureFormat.recolour';
  const url = currentPicture(o);
  let first = true;
  const grid = h('div', { class: 'thumb-grid' }, Object.entries(RECOLOURS).map(([id, v]) => {
    const cell = h('button', { type: 'button', class: 'thumb-cell', tabindex: '-1', 'aria-label': t(`recolour.${id}`), 'data-tip': t(`recolour.${id}`), 'data-menu-focus': first ? '' : null }, thumb(url, v.css));
    first = false;
    bind(cell, o, cmdId, () => o.registry.run(cmdId, { mode: v.mode || null, r: v.r || 0, g: v.g || 0, b: v.b || 0 }));
    return cell;
  }));
  return h('div', { class: 'menu-widget' }, h('div', { class: 'menu-header' }, t('menu.recolour')), grid);
}

function wordArtGallery(o) {
  const cmdId = 'insert.insertWordArt';
  let first = true;
  const grid = h('div', { class: 'wa-grid' }, Object.entries(WORDART_STYLES).map(([id, s]) => {
    const style = { color: s.fill === 'none' ? 'transparent' : s.fill, WebkitTextStroke: s.stroke ? `1px ${s.stroke}` : '0', textShadow: s.shadow ? '2px 2px 2px rgba(0,0,0,.35)' : 'none' };
    const cell = h('button', { type: 'button', class: 'wa-cell', tabindex: '-1', 'aria-label': t(`wordart.${id}`), 'data-tip': t(`wordart.${id}`), 'data-menu-focus': first ? '' : null }, h('span', { style }, 'A'));
    first = false;
    bind(cell, o, cmdId, () => o.registry.run(cmdId, id));
    return cell;
  }));
  return h('div', { class: 'menu-widget' }, grid);
}

function textBoxGallery(o) {
  const cmdId = 'insert.insertTextBox';
  let first = true;
  const grid = h('div', { class: 'tb-grid' }, Object.entries(TEXTBOX_PRESETS).map(([id, p]) => {
    const prev = h('span', { class: 'tb-prev', style: p.preview }, h('span', { class: 'tb-prev-title' }), h('span', { class: 'tb-prev-line' }), h('span', { class: 'tb-prev-line' }), h('span', { class: 'tb-prev-line short' }));
    const cell = h('button', { type: 'button', class: 'tb-cell', tabindex: '-1', 'aria-label': t(`textbox.${id}`), 'data-menu-focus': first ? '' : null }, prev, h('span', { class: 'tb-caption' }, t(`textbox.${id}`)));
    first = false;
    bind(cell, o, cmdId, () => o.registry.run(cmdId, id));
    return cell;
  }));
  return h('div', { class: 'menu-widget' }, h('div', { class: 'menu-header' }, t('menu.builtIn')), grid);
}

/** Cover pages: small page previews of each design. */
function coverPages(o) {
  const cmdId = 'insert.insertCoverPage';
  let first = true;
  const sample = { title: 'Title', subtitle: 'Subtitle', author: 'Author', date: 'Date' };
  const grid = h('div', { class: 'cp-grid' }, Object.keys(COVER_PAGES).map((id) => {
    const page = h('span', { class: `cp-page cp-${id}` }, COVER_PAGES[id](sample).filter((b) => b.text).map((b) => h('span', { class: `cp-line cp-${b.s.toLowerCase()}` })));
    const cell = h('button', { type: 'button', class: 'cp-cell', tabindex: '-1', 'aria-label': t(`cover.${id}`), 'data-menu-focus': first ? '' : null }, page, h('span', { class: 'tb-caption' }, t(`cover.${id}`)));
    first = false;
    bind(cell, o, cmdId, () => o.registry.run(cmdId, id));
    return cell;
  }));
  return h('div', { class: 'menu-widget' }, h('div', { class: 'menu-header' }, t('menu.builtIn')), grid);
}

/** AutoText: saved entries (click inserts; × deletes). */
function autoTextGallery(o) {
  const cmdId = 'insert.autoTextEntry';
  const entries = autoTextEntries();
  if (!entries.length) return h('div', { class: 'menu-widget' }, h('div', { class: 'menu-note' }, t('qp.empty')));
  return h('div', { class: 'menu-widget at-list' }, entries.map((e, i) => {
    const del = h('span', { class: 'at-del', role: 'button', 'aria-label': t('qp.delete', { name: e.name }), title: t('qp.delete', { name: e.name }) }, '×');
    const item = h('button', { type: 'button', class: 'at-item', tabindex: '-1', 'data-menu-focus': i === 0 ? '' : null }, h('span', { class: 'at-name' }, e.name), del);
    del.addEventListener('click', (ev) => { ev.stopPropagation(); deleteAutoText(e.name); item.remove(); });
    bind(item, o, cmdId, () => o.registry.run(cmdId, e.name));
    return item;
  }));
}

/** Insert ▸ Equation ▾: the built-in equations. */
function equationGallery(o) {
  const cmdId = 'insert.insertEquationPreset';
  let first = true;
  return h('div', { class: 'menu-widget eq-gallery' }, h('div', { class: 'menu-header' }, t('eq.builtIn')), Object.keys(EQUATION_PRESETS).map((id) => {
    const b = h('button', { type: 'button', class: 'at-item', tabindex: '-1', 'data-menu-focus': first ? '' : null }, h('span', { class: 'at-name' }, t(`eq.${id}`)), h('code', { class: 'eq-src' }, EQUATION_PRESETS[id]));
    first = false;
    bind(b, o, cmdId, () => o.registry.run(cmdId, id));
    return b;
  }));
}

export const OBJECT_WIDGETS = {
  equationGallery,
  coverPages,
  autoTextGallery,
  shapesGallery: (o) => shapesGallery(o),
  positionGallery,
  correctionsGallery,
  recolourGallery,
  wordArtGallery,
  textBoxGallery,
};
