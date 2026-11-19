/**
 * Rich menu content: colour palettes, the table grid picker, symbol grid,
 * shape gallery, list libraries… Each widget is bound to a command; while
 * that command is "Coming soon" the widget renders dimmed and clicking shows
 * a notice instead of pretending to work.
 */
import { h } from './dom.js';
import { t } from '../i18n/index.js';
import { iconSvg } from './icons.js';
import { THEMES, COLOUR_SETS, FONT_SETS, SPACING, WATERMARKS } from '../features/design/apply.js';
import { QUICK_TABLES } from '../features/table/insert.js';
import { BORDER_STYLES } from '../features/table/design.js';
import { OBJECT_WIDGETS } from './object-widgets.js';
import { REFERENCE_WIDGETS } from './reference-widgets.js';
import { recentSymbols, charName } from './symbol-dialog.js';
import { getSetting } from '../core/settings.js';

const THEME_COLOURS = [
  ['#ffffff', '#000000', '#e8e8e8', '#0e2841', '#156082', '#e97132', '#196b24', '#0f9ed5', '#a02b93', '#4ea72e'],
  ['#f2f2f2', '#7f7f7f', '#d0d0d0', '#c0d8f0', '#c1e4f5', '#fbe3d6', '#c1f0c8', '#caeefb', '#f2cfee', '#daf2d0'],
  ['#d9d9d9', '#595959', '#aeaeae', '#83b1df', '#83cbeb', '#f6c6ad', '#83e28e', '#94dcf8', '#e59edd', '#b5e6a2'],
  ['#bfbfbf', '#404040', '#757575', '#4682c4', '#45b0e1', '#f1a983', '#47d459', '#61cbf3', '#d86ecc', '#8ed973'],
  ['#a6a6a6', '#262626', '#3a3a3a', '#215f9a', '#0f4761', '#c04f15', '#124f1a', '#0b76a0', '#78206e', '#3b7d23'],
];
const STANDARD = ['#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050', '#00b050', '#00b0f0', '#0070c0', '#002060', '#7030a0'];
const HIGHLIGHTS = ['#ffff00', '#00ff00', '#00ffff', '#ff00ff', '#0000ff', '#ff0000', '#000080', '#008080', '#008000', '#800080', '#800000', '#808000', '#808080', '#c0c0c0', '#000000'];

/** Shared "inactive" behaviour: dim when the command can't run yet, notify on click. */
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

function swatch(colour, o, cmdId, title = colour) {
  const el = h('button', { type: 'button', class: 'swatch', style: { background: colour }, title, 'aria-label': title, tabindex: '-1', 'data-menu-focus': '' });
  bind(el, o, cmdId, () => o.registry.run(cmdId, colour));
  return el;
}

function colourPalette(o, cmdId = o.cmd || 'home.fontColour') {
  return h('div', { class: 'menu-widget palette' },
    h('div', { class: 'menu-header' }, t('menu.themeColours')),
    h('div', { class: 'swatch-grid' }, THEME_COLOURS.flat().map((c) => swatch(c, o, cmdId))),
    h('div', { class: 'menu-header' }, t('menu.standardColours')),
    h('div', { class: 'swatch-grid' }, STANDARD.map((c) => swatch(c, o, cmdId))));
}

function tableGrid(o) {
  const cols = 10;
  const rows = 8;
  const header = h('div', { class: 'menu-header' }, t('menu.insertTable'));
  const cells = [];
  const grid = h('div', { class: 'table-grid', style: { gridTemplateColumns: `repeat(${cols}, 16px)` }, role: 'grid', 'aria-label': t('menu.insertTable') });
  const mark = (c, r) => {
    cells.forEach((el) => el.classList.toggle('is-on', +el.dataset.c <= c && +el.dataset.r <= r));
    header.textContent = c ? t('menu.tableSize', { cols: c, rows: r }) : t('menu.insertTable');
  };
  for (let r = 1; r <= rows; r++) {
    for (let c = 1; c <= cols; c++) {
      const cell = h('button', { type: 'button', class: 'table-cell', tabindex: '-1', 'data-c': c, 'data-r': r, 'aria-label': t('menu.tableSize', { cols: c, rows: r }) });
      cell.addEventListener('pointerenter', () => mark(c, r));
      cell.addEventListener('focus', () => mark(c, r));
      bind(cell, o, 'insert.tableGrid', () => o.registry.run('insert.tableGrid', { cols: c, rows: r }));
      cells.push(cell);
      grid.append(cell);
    }
  }
  cells[0].setAttribute('data-menu-focus', '');
  grid.addEventListener('pointerleave', () => mark(0, 0));
  grid.addEventListener('keydown', (e) => {
    const cur = document.activeElement;
    if (!cur?.classList.contains('table-cell')) return;
    let c = +cur.dataset.c;
    let r = +cur.dataset.r;
    if (e.key === 'ArrowRight') c = Math.min(cols, c + 1);
    else if (e.key === 'ArrowLeft') c = Math.max(1, c - 1);
    else if (e.key === 'ArrowDown') r = Math.min(rows, r + 1);
    else if (e.key === 'ArrowUp') { if (r === 1) return; r -= 1; } else return;
    e.preventDefault();
    e.stopPropagation();
    grid.querySelector(`[data-c="${c}"][data-r="${r}"]`).focus();
  });
  return h('div', { class: 'menu-widget' }, header, grid);
}

function symbolGrid(o) {
  return h('div', { class: 'menu-widget' },
    h('div', { class: 'menu-header' }, t('menu.recentSymbols')),
    h('div', { class: 'symbol-grid' }, recentSymbols().map((s, i) => {
      const b = h('button', { type: 'button', class: 'symbol-cell', tabindex: '-1', 'aria-label': charName(s.codePointAt(0)) || s, 'data-tip': charName(s.codePointAt(0)) || s, 'data-menu-focus': i === 0 ? '' : null }, s);
      bind(b, o, 'insert.insertSymbol', () => o.registry.run('insert.insertSymbol', s));
      return b;
    })));
}

function listLibrary(o, kind) {
  const samples = {
    bullet: [['•', '•', '•'], ['◦', '◦', '◦'], ['▪', '▪', '▪'], ['➢', '➢', '➢'], ['✓', '✓', '✓'], ['–', '–', '–']],
    number: [['1.', '2.', '3.'], ['1)', '2)', '3)'], ['I.', 'II.', 'III.'], ['A.', 'B.', 'C.'], ['a)', 'b)', 'c)'], ['i.', 'ii.', 'iii.']],
    multilevel: [['1.', '1.1.', '1.1.1.'], ['1)', 'a)', 'i)'], ['•', '◦', '▪'], ['Article I.', 'Section 1.01', '(a)'], ['1', '1.1', '1.1.1'], ['I.', 'A.', '1.']],
  }[kind];
  const cmdId = { bullet: 'home.bullets', number: 'home.numbering', multilevel: 'home.multilevel' }[kind];
  const header = { bullet: 'menu.bulletLibrary', number: 'menu.numberLibrary', multilevel: 'menu.listLibrary' }[kind];
  return h('div', { class: 'menu-widget' },
    h('div', { class: 'menu-header' }, t(header)),
    h('div', { class: 'list-grid' }, samples.map((marks, i) => {
      const b = h('button', { type: 'button', class: 'list-cell', tabindex: '-1', 'data-menu-focus': i === 0 ? '' : null, 'aria-label': marks.join(' ') },
        marks.map((m, lvl) => h('span', { class: 'list-line', style: { paddingLeft: `${kind === 'multilevel' ? lvl * 8 : 0}px` } }, h('span', { class: 'list-mark' }, m), h('span', { class: 'list-bar' }))));
      bind(b, o, cmdId, () => o.registry.run(cmdId, i));
      return b;
    })));
}

function thicknessList(o) {
  return h('div', { class: 'menu-widget' },
    h('div', { class: 'menu-header' }, t('menu.thickness')),
    h('div', { class: 'thickness-list' }, [0.5, 1, 2, 3.5, 5].map((w, i) => {
      const b = h('button', { type: 'button', class: 'thickness-cell', tabindex: '-1', 'data-menu-focus': i === 0 ? '' : null, 'aria-label': `${w} mm` }, h('span', { style: { height: `${Math.max(1, w * 1.6)}px` } }), `${w} mm`);
      bind(b, o, o.cmd || 'draw.penThickness', () => o.registry.run(o.cmd || 'draw.penThickness', w));
      return b;
    })));
}

/** Add Pen: the saved pens (click to use one). */
function savedPensWidget(o) {
  const pens = getSetting('inkPresets') || [];
  const wrap = h('div', { class: 'menu-widget saved-pens' });
  if (!pens.length) { wrap.append(h('div', { class: 'menu-note' }, t('ink.noSavedPens'))); return wrap; }
  wrap.append(h('div', { class: 'menu-header' }, t('ink.savedPens')));
  const row = h('div', { class: 'pen-row' });
  pens.forEach((p, i) => {
    const b = h('button', { type: 'button', class: `pen-chip tool-${p.tool}`, tabindex: '-1', 'data-menu-focus': i === 0 ? '' : null, 'aria-label': `${t(`ink.tool.${p.tool}`)} ${p.colour} ${p.width} mm`, title: `${t(`ink.tool.${p.tool}`)} · ${p.width} mm` },
      h('span', { class: 'pen-swatch', style: { background: p.colour, height: `${Math.max(3, Math.min(14, p.width * 3))}px` } }));
    bind(b, o, 'draw.usePen', () => o.registry.run('draw.usePen', i));
    row.append(b);
  });
  wrap.append(row);
  return wrap;
}

function windowList() {
  return h('div', { class: 'menu-widget' },
    h('div', { class: 'menu-item', role: 'menuitemradio', 'aria-checked': 'true', tabindex: '-1', 'data-menu-focus': '' },
      h('span', { class: 'menu-check', html: iconSvg('set-default', { size: 14 }) }),
      h('span', { class: 'menu-label' }, `1 ${document.title}`)),
    h('div', { class: 'menu-note' }, t('menu.noWindows')));
}

/** Header / footer galleries: small page-strip previews of each preset. */
function hfGallery(o, part) {
  const items = part === 'header'
    ? [['blank', 'hf.preset.blank', ['', '']], ['blank3', 'hf.preset.blank3', ['[ ]', '[ ]', '[ ]']], ['title', 'hf.preset.title', ['Title', '', '1']], ['rule', 'hf.preset.rule', ['', 'rule']]]
    : [['blank', 'hf.preset.blank', ['', '']], ['blank3', 'hf.preset.blank3', ['[ ]', '[ ]', '[ ]']], ['pageCentre', 'hf.preset.pageCentre', ['', '1', '']], ['pageOfTotal', 'hf.preset.pageOfTotal', ['', 'Page 1 of 3', '']]];
  const cmdId = part === 'header' ? 'insert.header' : 'insert.footer';
  return h('div', { class: 'menu-widget' },
    h('div', { class: 'menu-header' }, t('hf.builtIn')),
    h('div', { class: 'hf-gallery' }, items.map(([id, label, cells], i) => {
      const preview = h('span', { class: `hf-prev ${part}${cells[1] === 'rule' ? ' rule' : ''}` }, cells.filter((x) => x !== 'rule').map((x) => h('span', { class: 'hf-prev-cell' }, x)));
      const b = h('button', { type: 'button', class: 'hf-gal-item', tabindex: '-1', 'data-menu-focus': i === 0 ? '' : null, 'aria-label': t(label), 'data-preset': id }, preview, h('span', { class: 'hf-gal-name' }, t(label)));
      bind(b, o, cmdId, () => o.registry.run(cmdId, id));
      return b;
    })));
}

/** Design ▸ Themes: a card per theme (title sample in its fonts and colours). */
function themeGallery(o) {
  return h('div', { class: 'menu-widget' }, h('div', { class: 'menu-header' }, t('design.themesHeader')),
    h('div', { class: 'theme-grid' }, Object.entries(THEMES).map(([id, th], i) => {
      const cs = COLOUR_SETS[th.colours];
      const [hf] = FONT_SETS[th.fonts];
      const b = h('button', { type: 'button', class: 'theme-card', tabindex: '-1', 'data-menu-focus': i === 0 ? '' : null, 'aria-label': t(`design.theme.${id}`), 'data-theme-id': id },
        h('span', { class: 'theme-sample', style: { fontFamily: `"${hf}"`, color: cs.title } }, 'Aa'),
        h('span', { class: 'theme-bars' }, cs.swatches.map((c) => h('i', { style: { background: c } }))),
        h('span', { class: 'theme-name' }, t(`design.theme.${id}`)));
      bind(b, o, 'design.themes', () => o.registry.run('design.themes', id));
      return b;
    })));
}

function colourSets(o) {
  return h('div', { class: 'menu-widget' }, h('div', { class: 'menu-header' }, t('design.coloursHeader')),
    Object.entries(COLOUR_SETS).map(([id, cs], i) => {
      const b = h('button', { type: 'button', class: 'menu-item set-row', tabindex: '-1', 'data-menu-focus': i === 0 ? '' : null, 'aria-label': t(`design.colours.${id}`) },
        h('span', { class: 'set-swatches' }, cs.swatches.map((c) => h('i', { style: { background: c } }))), h('span', { class: 'menu-label' }, t(`design.colours.${id}`)));
      bind(b, o, 'design.colours', () => o.registry.run('design.colours', id));
      return b;
    }));
}

function fontSets(o) {
  return h('div', { class: 'menu-widget' }, h('div', { class: 'menu-header' }, t('design.fontsHeader')),
    Object.entries(FONT_SETS).map(([id, [hf, bf]], i) => {
      const b = h('button', { type: 'button', class: 'menu-item font-row', tabindex: '-1', 'data-menu-focus': i === 0 ? '' : null, 'aria-label': `${hf} / ${bf}` },
        h('span', { class: 'font-aa', style: { fontFamily: `"${hf}"` } }, 'Aa'),
        h('span', { class: 'font-names' }, h('span', { style: { fontFamily: `"${hf}"` } }, hf), h('span', { style: { fontFamily: `"${bf}"` } }, bf)));
      bind(b, o, 'design.fonts', () => o.registry.run('design.fonts', id));
      return b;
    }));
}

function spacingPresets(o) {
  return h('div', { class: 'menu-widget' }, h('div', { class: 'menu-header' }, t('design.spacingHeader')),
    Object.keys(SPACING).map((id, i) => {
      const b = h('button', { type: 'button', class: 'menu-item', tabindex: '-1', 'data-menu-focus': i === 0 ? '' : null, role: 'menuitem' },
        h('span', { class: 'menu-check' }), h('span', { class: 'menu-label' }, t(`design.spacing.${id}`)));
      bind(b, o, 'design.paragraphSpacing', () => o.registry.run('design.paragraphSpacing', id));
      return b;
    }));
}

function watermarkGallery(o) {
  return h('div', { class: 'menu-widget' }, h('div', { class: 'menu-header' }, t('design.watermarkHeader')),
    h('div', { class: 'wm-grid' }, WATERMARKS.map(([id, text], i) => {
      const b = h('button', { type: 'button', class: 'wm-card', tabindex: '-1', 'data-menu-focus': i === 0 ? '' : null, 'aria-label': text, 'data-watermark': id },
        h('span', { class: 'wm-page' }, h('span', { class: 'wm-text' }, text)), h('span', { class: 'wm-name' }, text));
      bind(b, o, 'design.watermark', () => o.registry.run('design.watermark', id));
      return b;
    })));
}

/** A miniature table preview (rows of strings). */
function miniTable(data) {
  return h('table', { class: 'mini-table' }, h('tbody', {}, data.slice(0, 5).map((row, i) => h('tr', { class: i === 0 ? 'head' : '' }, row.slice(0, 4).map((x) => h('td', {}, x))))));
}

function quickTables(o) {
  return h('div', { class: 'menu-widget' }, h('div', { class: 'menu-header' }, t('menu.builtIn')),
    h('div', { class: 'qt-list' }, Object.entries(QUICK_TABLES).map(([id, q], i) => {
      const b = h('button', { type: 'button', class: 'qt-item', tabindex: '-1', 'data-menu-focus': i === 0 ? '' : null, 'data-quick-table': id }, miniTable(q.data), h('span', { class: 'qt-name' }, t(`tbl.quick.${id}`)));
      bind(b, o, 'insert.quickTables', () => o.registry.run('insert.quickTables', id));
      return b;
    })));
}

function borderStyleGallery(o) {
  return h('div', { class: 'menu-widget' }, h('div', { class: 'menu-header' }, t('tbl.borderStyles')),
    h('div', { class: 'bs-grid' }, BORDER_STYLES.map(([w, st, col], i) => {
      const b = h('button', { type: 'button', class: 'bs-item', tabindex: '-1', 'data-menu-focus': i === 0 ? '' : null, 'aria-label': `${st} ${w} ${col}` }, h('span', { style: { borderTop: `${Math.max(1, parseFloat(w) * 1.33)}px ${st} ${col}` } }));
      bind(b, o, `tableDesign.borderStyle${i + 1}`, () => o.registry.run(`tableDesign.borderStyle${i + 1}`));
      return b;
    })));
}

/** Galleries whose previews are built together with their feature (later milestones). */
function pendingGallery() {
  return h('div', { class: 'menu-widget' }, h('div', { class: 'menu-note' }, t('menu.galleryPreview')));
}

const WIDGETS = {
  savedPens: savedPensWidget,
  ...OBJECT_WIDGETS,
  ...REFERENCE_WIDGETS,
  colourPalette: (o) => colourPalette(o),
  highlightPalette: (o) => h('div', { class: 'menu-widget palette' }, h('div', { class: 'swatch-grid five' }, HIGHLIGHTS.map((c) => swatch(c, o, o.cmd || 'home.highlight')))),
  tableGrid,
  symbolGrid,
  bulletLibrary: (o) => listLibrary(o, 'bullet'),
  numberLibrary: (o) => listLibrary(o, 'number'),
  multilevelLibrary: (o) => listLibrary(o, 'multilevel'),
  thicknessList,
  windowList,
  headerGallery: (o) => hfGallery(o, 'header'),
  themeGallery,
  quickTables,
  borderStyleGallery,
  themeColours: colourSets,
  themeFonts: fontSets,
  paragraphSpacingPresets: spacingPresets,
  watermarkGallery,
  footerGallery: (o) => hfGallery(o, 'footer'),
};

export function renderWidget(name, o) {
  return (WIDGETS[name] || pendingGallery)(o);
}
