/**
 * Insert ▸ Icons: a searchable, categorised grid of line icons (Lucide, ISC).
 * Pick one or more; each is inserted as an SVG picture, in line with text.
 */
import { h } from './dom.js';
import { t } from '../i18n/index.js';
import { showDialog } from './dialog.js';
import { ICON_NODES, ICON_CATEGORIES } from './icon-library.js';

const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** SVG markup of an icon (stroke colour, size in px). */
export function iconSvgText(name, { colour = '#000000', size = 96 } = {}) {
  const nodes = ICON_NODES[name] || [];
  const inner = nodes.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(' ')}/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${colour}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

export async function iconsDialog() {
  const chosen = new Set();
  const search = h('input', { type: 'search', class: 'fm-input ic-search', placeholder: t('icons.search'), 'aria-label': t('icons.search') });
  const cats = h('div', { class: 'ic-cats', role: 'tablist' });
  const grid = h('div', { class: 'ic-grid', role: 'listbox', 'aria-multiselectable': 'true', 'aria-label': t('icons.title') });
  const count = h('span', { class: 'ic-count' });
  let cat = 'all';
  const render = () => {
    const q = search.value.trim().toLowerCase();
    const names = cat === 'all' ? Object.keys(ICON_NODES) : ICON_CATEGORIES[cat];
    grid.replaceChildren(...names.filter((n) => !q || n.includes(q) || Object.entries(ICON_CATEGORIES).some(([c, list]) => c.includes(q) && list.includes(n))).map((n) => {
      const b = h('button', { type: 'button', class: `ic-cell${chosen.has(n) ? ' is-on' : ''}`, role: 'option', 'aria-selected': String(chosen.has(n)), 'aria-label': n.replace(/-/g, ' '), 'data-tip': n.replace(/-/g, ' '), 'data-icon': n, html: iconSvgText(n, { colour: 'currentColor', size: 28 }) });
      b.addEventListener('click', () => { if (chosen.has(n)) chosen.delete(n); else chosen.add(n); b.classList.toggle('is-on'); b.setAttribute('aria-selected', String(chosen.has(n))); count.textContent = chosen.size ? t('icons.selected', { n: chosen.size }) : ''; });
      return b;
    }));
  };
  for (const c of ['all', ...Object.keys(ICON_CATEGORIES)]) {
    const b = h('button', { type: 'button', class: `ic-cat${c === cat ? ' is-on' : ''}`, role: 'tab', 'aria-selected': String(c === cat) }, t(`icons.cat.${c}`));
    b.addEventListener('click', () => { cat = c; cats.querySelectorAll('.ic-cat').forEach((x) => { x.classList.toggle('is-on', x === b); x.setAttribute('aria-selected', String(x === b)); }); render(); });
    cats.append(b);
  }
  search.addEventListener('input', render);
  render();
  const ok = await showDialog({
    title: t('icons.title'), message: h('div', { class: 'ic-body' }, search, cats, grid, count), wide: true, cancelValue: false,
    buttons: [{ label: t('icons.insert'), value: true, primary: true }, { label: t('common.cancel'), value: false }],
  });
  return ok ? [...chosen] : null;
}
