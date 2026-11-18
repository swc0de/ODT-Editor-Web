/**
 * Alt+Q command search ("Tell me what you want to do"): lists every command
 * with its location in the ribbon and its shortcut; Enter runs it.
 */
import { h } from './dom.js';
import { iconSvg } from './icons.js';
import { t } from '../i18n/index.js';
import { resolveId } from '../features/define.js';

/** Maps command id → "Tab › Group" by walking the ribbon definitions. */
export function buildCommandLocations(tabs) {
  const where = new Map();
  const visit = (spec, tab, group) => {
    if (!spec || typeof spec !== 'object') {
      if (typeof spec === 'string' && spec !== '-') where.has(resolveId(tab, spec)) || where.set(resolveId(tab, spec), `${t(`tab.${tab}`)} › ${group}`);
      return;
    }
    if (spec.cmd) { const id = resolveId(tab, spec.cmd); if (!where.has(id)) where.set(id, `${t(`tab.${tab}`)} › ${group}`); }
    for (const key of ['items', 'menu', 'sub', 'options', 'controls']) (spec[key] || []).forEach((s) => visit(s, tab, group));
    (spec.rows || []).forEach((row) => row.forEach((s) => visit(s, tab, group)));
  };
  for (const tab of tabs) for (const g of tab.groups) {
    const label = t(`group.${tab.id}.${g.id}`);
    g.controls.forEach((c) => visit(c, tab.id, label));
    if (g.launcher) visit(g.launcher, tab.id, label);
  }
  return where;
}

export function createCommandSearch({ registry, tabs, toast }) {
  const locations = buildCommandLocations(tabs);
  let overlay = null;
  let returnFocus = null;

  function close() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    if (returnFocus && document.contains(returnFocus)) returnFocus.focus({ preventScroll: true });
  }

  function open() {
    if (overlay) { overlay.querySelector('input').select(); return; }
    returnFocus = document.activeElement;
    const input = h('input', { type: 'search', class: 'cs-input', placeholder: t('search.placeholder'), 'aria-label': t('search.label'), role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'cs-list', 'aria-autocomplete': 'list', spellcheck: 'false' });
    const list = h('div', { class: 'cs-list', id: 'cs-list', role: 'listbox', 'aria-label': t('search.label') });
    const box = h('div', { class: 'cs-box', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('search.label') },
      h('div', { class: 'cs-field' }, h('span', { class: 'cs-icon', html: iconSvg('search', { size: 16 }) }), input), list);
    overlay = h('div', { class: 'cs-overlay' }, box);
    overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) close(); });
    document.body.append(overlay);

    let results = [];
    let active = 0;
    const renderList = () => {
      results = registry.search(input.value);
      active = Math.min(active, Math.max(0, results.length - 1));
      list.replaceChildren(...(results.length ? results.map((cmd, i) => {
        const enabled = registry.isEnabled(cmd.id);
        const row = h('div', {
          class: `cs-row${i === active ? ' is-active' : ''}${enabled ? '' : ' is-dim'}`, role: 'option', id: `cs-opt-${i}`,
          'aria-selected': String(i === active), 'aria-disabled': enabled ? null : 'true', 'data-id': cmd.id,
        },
        h('span', { class: 'cs-row-icon', html: cmd.icon ? iconSvg(cmd.icon, { size: 16 }) : '' }),
        h('span', { class: 'cs-row-label' }, registry.label(cmd.id)),
        h('span', { class: 'cs-row-where' }, locations.get(cmd.id) || ''),
        !enabled && cmd.comingSoon ? h('span', { class: 'cs-row-soon' }, t('search.comingSoon')) : null,
        h('span', { class: 'cs-row-keys' }, registry.shortcutText(cmd.id)));
        row.addEventListener('pointermove', () => { if (active !== i) { active = i; highlight(); } });
        row.addEventListener('click', () => runAt(i));
        return row;
      }) : [h('div', { class: 'cs-empty' }, t('search.noResults'))]));
      input.setAttribute('aria-activedescendant', results.length ? `cs-opt-${active}` : '');
    };
    const highlight = () => {
      [...list.children].forEach((el, i) => { el.classList.toggle('is-active', i === active); el.setAttribute('aria-selected', String(i === active)); });
      input.setAttribute('aria-activedescendant', `cs-opt-${active}`);
      list.children[active]?.scrollIntoView({ block: 'nearest' });
    };
    const runAt = (i) => {
      const cmd = results[i];
      if (!cmd) return;
      if (!registry.isEnabled(cmd.id)) { toast(t('toast.comingSoon', { name: registry.label(cmd.id) })); return; }
      close();
      registry.run(cmd.id);
    };
    input.addEventListener('input', () => { active = 0; renderList(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(results.length - 1, active + 1); highlight(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); highlight(); }
      else if (e.key === 'Enter') { e.preventDefault(); runAt(active); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === 'Tab') e.preventDefault();
    });
    renderList();
    input.focus();
  }

  return { open, close, isOpen: () => !!overlay, locations };
}
