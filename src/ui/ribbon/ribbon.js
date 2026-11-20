/**
 * The tab bar and the ribbon: tabs (File opens the Backstage), groups with
 * centred labels, dividers and dialog launchers, collapse (Ctrl+F1 or
 * double-clicking a tab, with a temporary "peek" when a tab is clicked while
 * collapsed) and responsive group collapsing (right-most groups first fold
 * into a single dropdown button when the window is narrow).
 */
import { h } from '../dom.js';
import { iconSvg } from '../icons.js';
import { t } from '../../i18n/index.js';
import { openMenu, closeAllMenus } from '../menu.js';
import { createControlFactory } from './controls.js';
import { resolveId } from '../../features/define.js';

export function createRibbon({ registry, store, tabs, toast }) {
  const factory = createControlFactory({ registry, store, resolve: resolveId, toast });
  const panels = new Map(); // tabId → { el, groups: [{el, def, fullWidth}] }

  // ---------------------------------------------------------------- tab bar
  const tabButtons = new Map();
  const tablist = h('div', { class: 'tabs', role: 'tablist', 'aria-label': t('ribbon.tabs') });
  for (const def of tabs) {
    const btn = h('button', {
      type: 'button', role: 'tab', class: `tab${def.backstage ? ' tab-file' : ''}${def.contextual ? ' tab-contextual' : ''}`, id: `tab-${def.id}`, hidden: !!def.contextual,
      'aria-selected': 'false', 'aria-controls': def.backstage ? 'backstage' : 'ribbon-panel', tabindex: '-1',
      'data-tab': def.id, 'data-keytip': def.keytip,
    }, h('span', { class: 'tab-text' }, t(`tab.${def.id}`)));
    btn.addEventListener('click', () => selectTab(def.id, { fromClick: true }));
    btn.addEventListener('dblclick', () => { if (!def.backstage) registry.run('app.toggleRibbon'); });
    tabButtons.set(def.id, btn);
    tablist.append(btn);
  }
  tablist.addEventListener('keydown', (e) => {
    const ids = tabs.filter((d) => !tabButtons.get(d.id).hidden).map((d) => d.id);
    const i = ids.indexOf(e.target.dataset?.tab);
    if (i < 0) return;
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: ids.length - 1 }[e.key];
    if (next === undefined) {
      if (e.key === 'ArrowDown' && !store.get().ribbonCollapsed) { e.preventDefault(); focusFirstControl(); }
      return;
    }
    e.preventDefault();
    const id = ids[(next + ids.length) % ids.length];
    tabButtons.get(id).focus();
    if (id !== 'file') selectTab(id);
  });

  const editingBtn = h('button', { type: 'button', class: 'top-btn', 'data-command': 'app.editingMode', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'data-menu-button': '', 'data-keytip': 'ZM' },
    h('span', { class: 'top-icon', html: iconSvg('editing-mode', { size: 14 }) }), h('span', { class: 'top-text' }, t('top.editing')), h('span', { class: 'caret' }));
  editingBtn.addEventListener('click', () => openMenu({ anchor: editingBtn, items: ['app.modeEditing', 'app.modeReviewing', 'app.modeViewing'], tab: 'app' }));
  const commentsBtn = h('button', { type: 'button', class: 'top-btn', 'data-command': 'app.commentsPane', 'data-keytip': 'ZC' },
    h('span', { class: 'top-icon', html: iconSvg('comments', { size: 14 }) }), h('span', { class: 'top-text' }, t('top.comments')));
  commentsBtn.addEventListener('click', () => { if (!registry.run('app.commentsPane')) toast(t('toast.comingSoon', { name: t('top.comments') }), commentsBtn); });
  const shareBtn = h('button', { type: 'button', class: 'top-btn share', 'data-command': 'file.share', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'data-menu-button': '', 'data-keytip': 'ZS' },
    h('span', { class: 'top-icon', html: iconSvg('share', { size: 14 }) }), h('span', { class: 'top-text' }, t('top.share')));
  shareBtn.addEventListener('click', () => openMenu({ anchor: shareBtn, items: [...(registry.isEnabled('file.shareNative') ? ['file.shareNative', '-'] : []), 'file.shareDownload', 'file.shareExportPdf', 'file.shareCopyHtml'], tab: 'file' }));

  const tabbar = h('div', { class: 'tabbar', 'data-region': 'tabs' }, tablist, h('div', { class: 'tabbar-spacer' }),
    h('div', { class: 'top-actions' }, commentsBtn, editingBtn, shareBtn));

  // ---------------------------------------------------------------- ribbon
  const panelHost = h('div', { class: 'ribbon-groups' });
  const ribbon = h('div', { class: 'ribbon', id: 'ribbon-panel', role: 'tabpanel', 'aria-label': t('ribbon.label'), 'data-region': 'ribbon' }, panelHost);
  ribbon.addEventListener('keydown', onRibbonKeys);

  function buildPanel(def) {
    const el = h('div', { class: 'ribbon-panel', 'data-tab': def.id, role: 'toolbar', 'aria-label': t(`tab.${def.id}`), 'aria-labelledby': `tab-${def.id}` });
    const groups = [];
    for (const g of def.groups) {
      const labelId = `grp-${def.id}-${g.id}`;
      const body = h('div', { class: 'group-body' }, g.controls.map((c) => factory.render(c, def.id)));
      const launcherId = g.launcher ? resolveId(def.id, g.launcher) : null;
      const launcher = launcherId ? h('button', {
        type: 'button', class: 'launcher', 'data-command': launcherId, 'aria-label': t('ribbon.launcher', { name: registry.label(launcherId) }),
        html: iconSvg('launcher', { size: 10, strokeWidth: 1.4 }),
        onclick: () => { if (!registry.run(launcherId)) toast(t('toast.comingSoon', { name: registry.label(launcherId) }), launcher); },
      }) : null;
      const label = h('div', { class: 'group-label', id: labelId }, h('span', {}, t(`group.${def.id}.${g.id}`)), launcher);
      const full = h('div', { class: 'group-full' }, body, label);
      const collapsedBtn = h('button', { type: 'button', class: 'rb rb-large group-collapsed-btn two-line', 'aria-haspopup': 'true', 'aria-expanded': 'false', 'data-tip': t(`group.${def.id}.${g.id}`) },
        h('span', { class: 'rb-icon32', html: iconSvg(g.icon || 'file', { size: 32, strokeWidth: 1.25 }) }),
        h('span', { class: 'rb-label' }, h('span', { class: 'rb-line' }, t(`group.${def.id}.${g.id}`), h('span', { class: 'caret' }))));
      const groupEl = h('div', { class: 'group', role: 'group', 'aria-labelledby': labelId, 'data-group': g.id }, full, collapsedBtn);
      collapsedBtn.addEventListener('click', () => openCollapsedGroup(groupEl, full, collapsedBtn));
      groups.push({ el: groupEl, full, def: g, fullWidth: 0 });
      el.append(groupEl);
    }
    return { el, groups, measured: false };
  }

  /** Shows a collapsed group's full content in a popup under its button. */
  function openCollapsedGroup(groupEl, full, btn) {
    const r = btn.getBoundingClientRect();
    const pop = openMenu({ anchor: btn, point: { x: r.left, y: r.bottom + 2 }, items: [{ custom: '__group' }], focusFirst: false,
      onClose: () => { groupEl.prepend(full); } });
    if (!pop) return;
    pop.classList.add('group-popup');
    pop.setAttribute('role', 'dialog');
    pop.querySelector('.menu-widget').replaceWith(full);
    full.querySelector('button, input')?.focus();
  }

  let activeTab = null;
  function selectTab(id, { fromClick = false } = {}) {
    const def = tabs.find((d) => d.id === id);
    if (!def) return;
    closeAllMenus();
    if (def.backstage) { registry.run('file.backstage'); return; }
    const state = store.get();
    if (state.ribbonCollapsed && fromClick) {
      store.set({ activeTab: id, ribbonPeek: !(state.ribbonPeek && state.activeTab === id) });
    } else store.set({ activeTab: id });
  }

  function showTab(id) {
    if (activeTab === id && panelHost.firstChild) return;
    activeTab = id;
    for (const [tid, btn] of tabButtons) {
      const sel = tid === id;
      btn.setAttribute('aria-selected', String(sel));
      btn.classList.toggle('is-active', sel);
      btn.setAttribute('tabindex', sel ? '0' : '-1');
    }
    if (!panels.has(id)) panels.set(id, buildPanel(tabs.find((d) => d.id === id)));
    const p = panels.get(id);
    panelHost.replaceChildren(p.el);
    refresh();
    layout();
  }

  // ------------------------------------------------- responsive collapsing
  const COLLAPSED_W = 64;
  function layout() {
    const p = panels.get(activeTab);
    if (!p || ribbon.hidden || !ribbon.isConnected) return;
    // Measure natural widths once per panel (and again after fonts load).
    if (!p.measured) {
      p.groups.forEach((g) => g.el.classList.remove('is-collapsed'));
      p.groups.forEach((g) => { g.fullWidth = g.el.getBoundingClientRect().width; });
      p.measured = p.groups.every((g) => g.fullWidth > 0);
    }
    const avail = panelHost.clientWidth - 8;
    let total = p.groups.reduce((s, g) => s + g.fullWidth, 0);
    const collapse = new Set();
    for (let i = p.groups.length - 1; i >= 0 && total > avail; i--) {
      collapse.add(i);
      total += COLLAPSED_W - p.groups[i].fullWidth;
    }
    p.groups.forEach((g, i) => g.el.classList.toggle('is-collapsed', collapse.has(i)));
  }
  const ro = new ResizeObserver(() => layout());
  ro.observe(panelHost);
  document.fonts?.ready.then(() => { panels.forEach((p) => { p.measured = false; }); layout(); });

  // ------------------------------------------------------- state refresh
  function refresh() {
    const p = panels.get(activeTab);
    const roots = [tabbar, p?.el].filter(Boolean);
    for (const root of roots) {
      for (const el of root.querySelectorAll('[data-command]')) {
        const id = el.dataset.command;
        const cmd = registry.get(id);
        if (!cmd) continue;
        const enabled = registry.isEnabled(id);
        const opensMenu = el.hasAttribute('data-menu-button');
        el.classList.toggle('is-dim', !enabled);
        // Contextual commands (isEnabled) stay dim in screenshot-compare mode.
        if (cmd.comingSoon && !cmd.isEnabled) el.dataset.comingSoon = ''; else delete el.dataset.comingSoon;
        if (el.tagName === 'INPUT' && el.type === 'checkbox') {
          el.checked = registry.isChecked(id);
          el.setAttribute('aria-disabled', String(!enabled));
        } else if (el.tagName === 'INPUT') {
          el.readOnly = !enabled;
          el.setAttribute('aria-disabled', String(!enabled));
        } else if (!opensMenu) {
          if (enabled) el.removeAttribute('aria-disabled'); else el.setAttribute('aria-disabled', 'true');
        }
        if (cmd.isChecked && !el.matches('.rb-check, .gal-tile, input')) {
          const on = registry.isChecked(id);
          el.classList.toggle('is-checked', on);
          if (!opensMenu) el.setAttribute('aria-pressed', String(on));
        }
      }
      root.querySelectorAll('.rb-combo, .gal, .rb-spins, .rb-synced').forEach((c) => c._sync?.());
    }
  }
  registry.onChange(refresh);

  function applyState(state, changed) {
    // Editing ▾ shows the current mode.
    if (!changed || changed.includes('editingMode')) {
      const mode = state.editingMode || 'editing';
      editingBtn.querySelector('.top-text').textContent = t(`top.${mode}`);
      editingBtn.querySelector('.top-icon').innerHTML = iconSvg({ editing: 'editing-mode', reviewing: 'track-changes', viewing: 'eye' }[mode] || 'editing-mode', { size: 14 });
      editingBtn.dataset.mode = mode;
    }
    // Contextual tabs (Header & Footer, Table Design…) show while their object is active.
    if (!changed || changed.includes('contextual')) {
      const shown = String(state.contextual || '').split(' ');
      for (const d of tabs) if (d.contextual) tabButtons.get(d.id).hidden = !shown.includes(d.contextual);
    }
    if (!changed || changed.includes('activeTab')) showTab(state.activeTab);
    ribbon.classList.toggle('is-collapsed', state.ribbonCollapsed);
    ribbon.classList.toggle('is-peek', state.ribbonCollapsed && state.ribbonPeek);
    ribbon.hidden = state.ribbonCollapsed && !state.ribbonPeek;
    tabbar.classList.toggle('ribbon-collapsed', state.ribbonCollapsed);
    const relayout = !changed || ['activeTab', 'ribbonCollapsed', 'ribbonPeek'].some((k) => changed.includes(k));
    if (!ribbon.hidden && relayout) requestAnimationFrame(layout);
    refresh();
  }
  store.subscribe(applyState);
  applyState(store.get());

  // Close a peeking ribbon when clicking elsewhere.
  document.addEventListener('pointerdown', (e) => {
    const s = store.get();
    if (!s.ribbonPeek || !(e.target instanceof Element)) return;
    if (e.target.closest('.ribbon, .tabbar, .menu')) return;
    store.set({ ribbonPeek: false });
  });

  // ---------------------------------------------------- keyboard in ribbon
  function controlsInPanel() {
    const p = panels.get(activeTab);
    if (!p) return [];
    return [...p.el.querySelectorAll('button, input')].filter((el) => el.getClientRects().length && !el.closest('.is-collapsed .group-full') && el.tabIndex !== -1 || el.matches('.gal-tile[tabindex="0"]'));
  }
  function focusFirstControl() { controlsInPanel()[0]?.focus(); }
  function onRibbonKeys(e) {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key) || e.target.tagName === 'INPUT') return;
    if (e.target.closest('.gal-tiles')) return;
    const list = controlsInPanel();
    const i = list.indexOf(e.target);
    if (i < 0) return;
    e.preventDefault();
    list[(i + (e.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length].focus();
  }

  return {
    tabbar,
    ribbon,
    selectTab,
    refresh,
    layout,
    tabButton: (id) => tabButtons.get(id),
    activePanel: () => panels.get(activeTab)?.el || null,
    focusTabs: () => tabButtons.get(activeTab)?.focus(),
  };
}
