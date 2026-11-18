/**
 * Rich menu content: colour palettes, the table grid picker, symbol grid,
 * shape gallery, list libraries… Each widget is bound to a command; while
 * that command is "Coming soon" the widget renders dimmed and clicking shows
 * a notice instead of pretending to work.
 */
import { h } from './dom.js';
import { t } from '../i18n/index.js';
import { iconSvg } from './icons.js';

const THEME_COLOURS = [
  ['#ffffff', '#000000', '#e8e8e8', '#0e2841', '#156082', '#e97132', '#196b24', '#0f9ed5', '#a02b93', '#4ea72e'],
  ['#f2f2f2', '#7f7f7f', '#d0d0d0', '#c0d8f0', '#c1e4f5', '#fbe3d6', '#c1f0c8', '#caeefb', '#f2cfee', '#daf2d0'],
  ['#d9d9d9', '#595959', '#aeaeae', '#83b1df', '#83cbeb', '#f6c6ad', '#83e28e', '#94dcf8', '#e59edd', '#b5e6a2'],
  ['#bfbfbf', '#404040', '#757575', '#4682c4', '#45b0e1', '#f1a983', '#47d459', '#61cbf3', '#d86ecc', '#8ed973'],
  ['#a6a6a6', '#262626', '#3a3a3a', '#215f9a', '#0f4761', '#c04f15', '#124f1a', '#0b76a0', '#78206e', '#3b7d23'],
];
const STANDARD = ['#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050', '#00b050', '#00b0f0', '#0070c0', '#002060', '#7030a0'];
const HIGHLIGHTS = ['#ffff00', '#00ff00', '#00ffff', '#ff00ff', '#0000ff', '#ff0000', '#000080', '#008080', '#008000', '#800080', '#800000', '#808000', '#808080', '#c0c0c0', '#000000'];
const SYMBOLS = ['€', '£', '¥', '©', '®', '™', '±', '≠', '≤', '≥', '÷', '×', '∞', 'µ', 'α', 'β', 'π', 'Ω', '∑', '…', '–', '—', '“', '”', '§', '¶', '•', '°', '✓', '→'];
const SHAPES = {
  'menu.lines': ['M3 21 21 3', 'M3 21 21 3M15 3h6v6', 'M3 12c4-8 8 8 18 0'],
  'menu.rectangles': ['M3 6h18v12H3z', 'M3 6h18v12H3z|r'],
  'menu.basicShapes': ['M12 3 21 20H3z', 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 2l3 7h7l-5.5 4.5 2 7.5L12 16.5 5.5 21l2-7.5L2 9h7z', 'M7 3h10l4 9-4 9H7l-4-9z', 'M12 3 21 12 12 21 3 12z', 'M3 12a9 9 0 0 1 18 0'],
  'menu.blockArrows': ['M3 9h11V5l7 7-7 7v-4H3z', 'M21 9H10V5l-7 7 7 7v-4h11z', 'M9 21V10H5l7-7 7 7h-4v11z', 'M9 3v11H5l7 7 7-7h-4V3z'],
  'menu.callouts': ['M3 4h18v12H10l-5 4v-4H3z', 'M12 4a9 6 0 1 0 0 12h-2l-4 4 1-5'],
};

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
      bind(cell, o, 'insert.tableGrid');
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
    h('div', { class: 'symbol-grid' }, SYMBOLS.map((s, i) => {
      const b = h('button', { type: 'button', class: 'symbol-cell', tabindex: '-1', 'aria-label': s, 'data-menu-focus': i === 0 ? '' : null }, s);
      bind(b, o, 'insert.insertSymbol');
      return b;
    })));
}

function shapesGallery(o) {
  const out = h('div', { class: 'menu-widget shapes' });
  let first = true;
  for (const [title, paths] of Object.entries(SHAPES)) {
    out.append(h('div', { class: 'menu-header' }, t(title)));
    out.append(h('div', { class: 'shape-grid' }, paths.map((d) => {
      const [path, mod] = d.split('|');
      const b = h('button', { type: 'button', class: 'shape-cell', tabindex: '-1', 'aria-label': t(title), 'data-menu-focus': first ? '' : null, html: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"${mod ? ' rx="4"' : ''}><path d="${path}"/></svg>` });
      first = false;
      bind(b, o, 'insert.insertShape');
      return b;
    })));
  }
  return out;
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
      bind(b, o, 'draw.penThickness');
      return b;
    })));
}

function windowList() {
  return h('div', { class: 'menu-widget' },
    h('div', { class: 'menu-item', role: 'menuitemradio', 'aria-checked': 'true', tabindex: '-1', 'data-menu-focus': '' },
      h('span', { class: 'menu-check', html: iconSvg('set-default', { size: 14 }) }),
      h('span', { class: 'menu-label' }, `1 ${document.title}`)),
    h('div', { class: 'menu-note' }, t('menu.noWindows')));
}

/** Galleries whose previews are built together with their feature (later milestones). */
function pendingGallery() {
  return h('div', { class: 'menu-widget' }, h('div', { class: 'menu-note' }, t('menu.galleryPreview')));
}

const WIDGETS = {
  colourPalette: (o) => colourPalette(o),
  highlightPalette: (o) => h('div', { class: 'menu-widget palette' }, h('div', { class: 'swatch-grid five' }, HIGHLIGHTS.map((c) => swatch(c, o, o.cmd || 'home.highlight')))),
  tableGrid,
  symbolGrid,
  shapesGallery,
  bulletLibrary: (o) => listLibrary(o, 'bullet'),
  numberLibrary: (o) => listLibrary(o, 'number'),
  multilevelLibrary: (o) => listLibrary(o, 'multilevel'),
  thicknessList,
  windowList,
};

export function renderWidget(name, o) {
  return (WIDGETS[name] || pendingGallery)(o);
}
