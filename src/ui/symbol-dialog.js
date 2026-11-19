/**
 * Insert ▸ Symbol ▸ More Symbols: a grid of characters by Unicode block, a
 * font to show (and insert) them in, search by name or code (U+20AC, 20ac,
 * "euro"), recently used symbols, and a Special Characters list.
 * Resolves to { char, font } or null.
 */
import { h } from './dom.js';
import { t } from '../i18n/index.js';
import { showDialog } from './dialog.js';
import { select, field, row, tabs } from './form.js';
import { UNICODE_BLOCKS, UNICODE_NAMES } from './unicode-data.js';
import { fontList } from './format-dialogs.js';
import { getSetting, setSetting } from '../core/settings.js';

const NAME = new Map(UNICODE_NAMES.map((e) => { const i = e.indexOf(':'); return [parseInt(e.slice(0, i), 16), e.slice(i + 1)]; }));
export const charName = (cp) => NAME.get(cp) || '';

export const DEFAULT_RECENT = ['€', '£', '¥', '©', '®', '™', '±', '≠', '≤', '≥', '÷', '×', '∞', 'µ', 'α', 'β', 'π', 'Ω', '∑', '…'];

export const recentSymbols = () => {
  const r = getSetting('recentSymbols');
  return Array.isArray(r) && r.length ? [...r, ...DEFAULT_RECENT.filter((x) => !r.includes(x))].slice(0, 20) : DEFAULT_RECENT;
};
export function rememberSymbol(ch) {
  const r = (getSetting('recentSymbols') || []).filter((x) => x !== ch);
  setSetting('recentSymbols', [ch, ...r].slice(0, 20));
}

const SPECIAL = [
  ['—', 'em'], ['–', 'en'], [' ', 'nbsp'], ['‑', 'nbhyphen'], ['­', 'shy'], [' ', 'emspace'], [' ', 'enspace'],
  [' ', 'thinspace'], ['©', 'copyright'], ['®', 'registered'], ['™', 'trademark'], ['§', 'section'], ['¶', 'paragraph'],
  ['…', 'ellipsis'], ['‘', 'lsquo'], ['’', 'rsquo'], ['“', 'ldquo'], ['”', 'rdquo'], ['​', 'zwsp'], ['‍', 'zwj'],
];

const hex = (cp) => cp.toString(16).toUpperCase().padStart(4, '0');

export async function symbolDialog() {
  let chosen = null;
  const font = select([['', t('sym.normalText')], ...fontList().map((f) => [f, f])], '');
  const subset = select([['all', t('sym.allBlocks')], ...UNICODE_BLOCKS.map(([id]) => [id, t(`sym.block.${id}`)])], 'basicLatin');
  const search = h('input', { type: 'search', class: 'fm-input', placeholder: t('sym.search'), 'aria-label': t('sym.search') });
  const grid = h('div', { class: 'sym-grid', role: 'grid', 'aria-label': t('sym.title') });
  const recent = h('div', { class: 'sym-recent' });
  const info = h('div', { class: 'sym-info', role: 'status' });
  const code = h('input', { type: 'text', class: 'fm-input sym-code', 'aria-label': t('sym.code'), size: '6' });
  const choose = (ch, cell) => {
    chosen = ch;
    grid.querySelectorAll('.is-on').forEach((x) => x.classList.remove('is-on'));
    recent.querySelectorAll('.is-on').forEach((x) => x.classList.remove('is-on'));
    cell?.classList.add('is-on');
    const cp = ch.codePointAt(0);
    info.textContent = `${charName(cp) ? charName(cp).replace(/\b\w/g, (m) => m.toUpperCase()) : ''}  ·  U+${hex(cp)}`;
    code.value = hex(cp);
  };
  let insertNow = null;
  const cellFor = (cp) => {
    const ch = String.fromCodePoint(cp);
    const b = h('button', { type: 'button', class: 'sym-cell', role: 'gridcell', 'aria-label': `${charName(cp) || ''} U+${hex(cp)}`, 'data-cp': hex(cp) }, ch);
    b.addEventListener('click', () => choose(ch, b));
    b.addEventListener('dblclick', () => { choose(ch, b); insertNow?.(); });
    return b;
  };
  const render = () => {
    const q = search.value.trim().toLowerCase();
    let cps = [];
    if (q) {
      const m = /^(?:u\+)?([0-9a-f]{2,6})$/i.exec(q);
      if (m && NAME.has(parseInt(m[1], 16))) cps.push(parseInt(m[1], 16));
      for (const [cp, name] of NAME) if (name.includes(q) && !cps.includes(cp)) cps.push(cp);
      cps = cps.slice(0, 400);
    } else {
      const blocks = subset.value === 'all' ? UNICODE_BLOCKS : UNICODE_BLOCKS.filter(([id]) => id === subset.value);
      for (const [, a, b] of blocks) for (let cp = a; cp <= b; cp++) if (NAME.has(cp)) cps.push(cp);
    }
    grid.replaceChildren(...(cps.length ? cps.map(cellFor) : [h('div', { class: 'sym-empty' }, t('sym.none'))]));
  };
  const applyFont = () => { grid.style.fontFamily = font.value ? `"${font.value}"` : ''; recent.style.fontFamily = grid.style.fontFamily; };
  font.addEventListener('change', applyFont);
  subset.addEventListener('change', () => { search.value = ''; render(); });
  search.addEventListener('input', render);
  code.addEventListener('change', () => {
    const cp = parseInt(code.value.replace(/^u\+/i, ''), 16);
    if (Number.isFinite(cp) && cp > 31 && cp < 0x110000) choose(String.fromCodePoint(cp), grid.querySelector(`[data-cp="${hex(cp)}"]`));
  });
  for (const ch of recentSymbols()) {
    const b = h('button', { type: 'button', class: 'sym-cell', 'aria-label': `${charName(ch.codePointAt(0))} U+${hex(ch.codePointAt(0))}` }, ch);
    b.addEventListener('click', () => choose(ch, b));
    b.addEventListener('dblclick', () => { choose(ch, b); insertNow?.(); });
    recent.append(b);
  }
  const specials = h('div', { class: 'sym-special', role: 'listbox' }, SPECIAL.map(([ch, id]) => {
    const item = h('button', { type: 'button', class: 'sym-sp', role: 'option' }, h('span', { class: 'sym-sp-ch' }, /\s|­|​|‍/.test(ch) ? '·' : ch), h('span', {}, t(`sym.sp.${id}`)));
    item.addEventListener('click', () => { chosen = ch; specials.querySelectorAll('.is-on').forEach((x) => x.classList.remove('is-on')); item.classList.add('is-on'); });
    item.addEventListener('dblclick', () => { chosen = ch; insertNow?.(); });
    return item;
  }));
  render();
  const symbolsTab = h('div', { class: 'sym-body' }, row(field(t('sym.font'), font), field(t('sym.subset'), subset)), search, grid, h('div', { class: 'menu-header' }, t('sym.recent')), recent, h('div', { class: 'sym-foot' }, info, field(t('sym.code'), code)));
  const body = tabs([[t('sym.symbolsTab'), symbolsTab], [t('sym.specialTab'), specials]]);
  const result = new Promise((resolve) => {
    showDialog({
      title: t('sym.title'), message: body, wide: true, cancelValue: false,
      buttons: [{ label: t('sym.insert'), value: true, primary: true }, { label: t('common.cancel'), value: false }],
      validate: () => !!chosen,
    }).then((ok) => resolve(ok && chosen ? { char: chosen, font: font.value || null } : null));
    insertNow = () => document.querySelector('.dlg .dlg-btn.primary')?.click();
  });
  return result;
}
