/**
 * Task panes docked beside the document (left or right), resizable by
 * dragging their inner edge: Navigation (Headings / Pages / Results with
 * search) and Styles (apply, modify, new, update to match, delete).
 */
import { h } from './dom.js';
import { t } from '../i18n/index.js';
import { iconSvg } from './icons.js';
import { openMenu } from './menu.js';
import { findAll, snippet, searchKey, selectRange } from '../core/search.js';
import { TextSelection } from 'prosemirror-state';
import { sectionRange, moveSection } from '../core/outline.js';

/** A dock on one side. Panes are { id, title, body, onClose }. */
export function createDock(side, { onResize } = {}) {
  const el = h('aside', { class: `pane-dock ${side}`, hidden: true });
  const panes = new Map();
  let width = side === 'left' ? 300 : 300;
  const grip = h('div', { class: 'pane-grip', role: 'separator', 'aria-orientation': 'vertical', tabindex: '-1' });
  el.append(grip);
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const w0 = width;
    const move = (ev) => {
      width = Math.max(220, Math.min(560, w0 + (side === 'left' ? ev.clientX - x0 : x0 - ev.clientX)));
      el.style.width = `${width}px`;
    };
    const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); onResize?.(); };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
  });
  el.style.width = `${width}px`;

  function open({ id, title, body, onClose }) {
    if (panes.has(id)) { panes.get(id).el.querySelector('input, button')?.focus(); return panes.get(id); }
    const close = () => closePane(id);
    const pane = h('section', { class: 'pane', 'data-pane': id, role: 'complementary', 'aria-label': title },
      h('header', { class: 'pane-head' }, h('h2', { class: 'pane-title' }, title),
        h('button', { type: 'button', class: 'pane-x', 'aria-label': t('common.close'), 'data-tip': t('common.close'), onclick: close, html: iconSvg('close', { size: 14 }) })),
      body);
    const rec = { el: pane, onClose };
    panes.set(id, rec);
    el.append(pane);
    el.hidden = false;
    onResize?.();
    return rec;
  }
  function closePane(id) {
    const rec = panes.get(id);
    if (!rec) return;
    rec.el.remove();
    panes.delete(id);
    el.hidden = panes.size === 0;
    rec.onClose?.();
    onResize?.();
  }
  return { el, open, close: closePane, isOpen: (id) => panes.has(id), get: (id) => panes.get(id) };
}

// ------------------------------------------------------------ Navigation pane

export function createNavigationPane({ dock, editor, docArea, store, openReplace, runCommand }) {
  let matches = [];
  let current = -1;
  let tab = 'headings';
  let opts = { matchCase: false, wholeWord: false, wildcards: false, regex: false };
  let rec = null;
  let input;
  let list;
  let status;
  const tabs = {};

  const view = () => editor.view;
  const setHighlights = (ms, cur) => view().dispatch(view().state.tr.setMeta(searchKey, { matches: ms, current: cur }).setMeta('addToHistory', false));

  function runSearch() {
    const q = input.value;
    try {
      matches = q ? findAll(view().state.doc, { query: q, ...opts }) : [];
      input.removeAttribute('aria-invalid');
    } catch {
      matches = [];
      input.setAttribute('aria-invalid', 'true');
    }
    current = matches.length ? 0 : -1;
    setHighlights(matches, current);
    if (q) select('results'); else render();
    if (matches.length) go(0, false);
  }

  function go(i, focusEditor = true) {
    if (!matches.length) return;
    current = (i + matches.length) % matches.length;
    setHighlights(matches, current);
    const m = matches[current];
    selectRange(view(), m.from, m.to);
    if (focusEditor) editor.focus();
    render();
  }

  function headings() {
    const out = [];
    view().state.doc.descendants((node, pos) => {
      if (node.type.name === 'heading') { out.push({ level: node.attrs.level, text: node.textContent || t('nav.emptyHeading'), pos }); return false; }
      return !node.isTextblock;
    });
    return out;
  }

  function render() {
    if (!rec) return;
    for (const [k, b] of Object.entries(tabs)) b.setAttribute('aria-selected', String(k === tab));
    list.replaceChildren();
    if (tab === 'headings') {
      const hs = headings();
      const sel = view().state.selection.from;
      let active = -1;
      hs.forEach((x, i) => { if (x.pos <= sel) active = i; });
      if (!hs.length) list.append(h('p', { class: 'pane-empty' }, t('nav.noHeadings')));
      hs.forEach((x, i) => {
        const b = h('button', {
          type: 'button', class: `nav-heading${i === active ? ' is-active' : ''}`, style: { paddingLeft: `${8 + (x.level - 1) * 14}px` }, draggable: 'true', 'data-pos': String(x.pos),
          onclick: () => { editor.focusAt(x.pos + 1); view().dispatch(view().state.tr.scrollIntoView()); },
        }, x.text);
        headingDrag(b, x);
        b.addEventListener('contextmenu', (e) => { e.preventDefault(); headingMenu(e, x); });
        list.append(b);
      });
    } else if (tab === 'pages') {
      renderThumbs();
    } else {
      if (!input.value) list.append(h('p', { class: 'pane-empty' }, t('nav.searchHint')));
      matches.slice(0, 500).forEach((m, i) => {
        const s = snippet(m);
        list.append(h('button', { type: 'button', class: `nav-result${i === current ? ' is-active' : ''}`, onclick: () => go(i) },
          s.before, h('mark', {}, s.hit), s.after));
      });
    }
    status.textContent = input.value ? (matches.length ? t('nav.resultOf', { n: current + 1, count: matches.length }) : t('nav.noResults')) : '';
  }

  function select(k) { tab = k; render(); }

  // ---------------------------------------------------------- headings: drag to move a section
  let dragFrom = null;
  function headingDrag(b, x) {
    b.addEventListener('dragstart', (e) => { dragFrom = x.pos; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', x.text); b.classList.add('is-dragging'); });
    b.addEventListener('dragend', () => { dragFrom = null; b.classList.remove('is-dragging'); list.querySelectorAll('.drop-before, .drop-after').forEach((n) => n.classList.remove('drop-before', 'drop-after')); });
    b.addEventListener('dragover', (e) => {
      if (dragFrom == null || dragFrom === x.pos) return;
      e.preventDefault();
      const r = b.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      b.classList.toggle('drop-before', !after);
      b.classList.toggle('drop-after', after);
    });
    b.addEventListener('dragleave', () => b.classList.remove('drop-before', 'drop-after'));
    b.addEventListener('drop', (e) => {
      e.preventDefault();
      const after = b.classList.contains('drop-after');
      b.classList.remove('drop-before', 'drop-after');
      if (dragFrom == null) return;
      moveHeading(dragFrom, x.pos, after);
    });
  }

  /** Moves heading `from`'s section before heading `to` (or after `to`'s section). */
  function moveHeading(from, to, after = false) {
    const v = view();
    let target = to;
    if (after) { const r = sectionRange(v.state.doc, to); if (!r) return false; target = r.to; }
    const own = sectionRange(v.state.doc, from);
    if (!own || (target > own.from && target < own.to)) return false;
    const tr = v.state.tr;
    const at = moveSection(tr, from, target);
    if (at == null) return false;
    tr.setSelection(TextSelection.create(tr.doc, at + 1));
    v.dispatch(tr.scrollIntoView());
    editor.focus();
    render();
    return true;
  }

  function headingMenu(e, x) {
    const v = view();
    const selectHeading = () => v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, x.pos + 1)));
    const selectSection = () => {
      const r = sectionRange(v.state.doc, x.pos);
      if (r) v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, r.from + 1, Math.max(r.from + 1, r.to - 1))));
      editor.focus();
    };
    openMenu({
      point: { x: e.clientX, y: e.clientY },
      items: [
        { label: t('nav.promote'), run: () => { selectHeading(); runCommand?.('outlining.promote'); } },
        { label: t('nav.demote'), run: () => { selectHeading(); runCommand?.('outlining.demote'); } },
        '-',
        { label: t('nav.selectSection'), run: selectSection },
        { label: t('nav.deleteSection'), run: () => { const r = sectionRange(v.state.doc, x.pos); if (r) { v.dispatch(v.state.tr.delete(r.from, r.to)); editor.focus(); } } },
      ],
    });
  }

  // ---------------------------------------------------------- pages: rendered thumbnails
  // Each thumbnail is a window onto a scaled copy of the page stack; copies
  // are made only for thumbnails scrolled into view, and reused until the
  // document or its pages change.
  const THUMB_W = 132;
  let mirror = null;
  let mirrorKey = '';
  let io = null;
  function stackCopy() {
    const key = `${view().state.doc.content.size}|${docArea.pages.length}|${store.get().pageMovement}|${docArea.model?.version}|${view().state.doc.textContent.length}`;
    if (!mirror || key !== mirrorKey) {
      mirror = docArea.view.stack.cloneNode(true);
      for (const n of mirror.querySelectorAll('[contenteditable]')) n.removeAttribute('contenteditable');
      for (const n of mirror.querySelectorAll('[id]')) n.removeAttribute('id');
      mirror.classList.add('nav-mirror');
      mirrorKey = key;
    }
    return mirror.cloneNode(true);
  }
  function renderThumbs() {
    const pages = docArea.pages;
    const model = docArea.model;
    const wrap = h('div', { class: 'nav-thumbs' });
    list.append(wrap);
    if (!model || !pages.length) return;
    const scale = THUMB_W / model.width;
    const cur = store.get().page - 1;
    io?.disconnect();
    io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting || en.target._filled) continue;
        en.target._filled = true;
        const i = Number(en.target.dataset.page);
        const el = docArea.view.pageElement(i);
        if (!el) continue;
        const copy = stackCopy();
        copy.style.zoom = String(scale);
        copy.style.position = 'absolute';
        copy.style.left = `${-el.offsetLeft}px`;
        copy.style.top = `${-el.offsetTop}px`;
        copy.setAttribute('aria-hidden', 'true');
        en.target.append(copy);
      }
    }, { root: list, rootMargin: '200px 0px' });
    pages.forEach((p, i) => {
      const el = docArea.view.pageElement(i);
      const w = (el?.offsetWidth || model.width) * scale;
      const hgt = (el?.offsetHeight || p.box.pageHeight) * scale;
      const frame = h('span', { class: 'nav-thumb-page', 'data-page': String(i), style: { width: `${w}px`, height: `${hgt}px` } });
      const thumb = h('button', {
        type: 'button', class: `nav-thumb${cur === i ? ' is-active' : ''}`, 'aria-label': t('nav.pageN', { n: i + 1 }), 'aria-current': cur === i ? 'page' : null,
        onclick: () => { docArea.view.pageElement(i)?.scrollIntoView({ block: 'start' }); },
      }, frame, h('span', { class: 'nav-page-num' }, String(i + 1)));
      wrap.append(thumb);
      io.observe(frame);
    });
    requestAnimationFrame(() => wrap.children[cur]?.scrollIntoView?.({ block: 'nearest' }));
  }

  function open({ focusSearch = false, query = null } = {}) {
    if (!rec) {
      input = h('input', { type: 'search', class: 'nav-search', placeholder: t('nav.searchPlaceholder'), 'aria-label': t('nav.searchPlaceholder'), spellcheck: 'false' });
      const optsBtn = h('button', { type: 'button', class: 'nav-icon', 'aria-label': t('nav.options'), 'data-tip': t('nav.options'), 'aria-haspopup': 'menu', html: iconSvg('chevron-down', { size: 12 }) });
      const prev = h('button', { type: 'button', class: 'nav-icon', 'aria-label': t('nav.previous'), 'data-tip': t('nav.previous'), onclick: () => go(current - 1), html: iconSvg('chevron-up', { size: 12 }) });
      const next = h('button', { type: 'button', class: 'nav-icon', 'aria-label': t('nav.next'), 'data-tip': t('nav.next'), onclick: () => go(current + 1), html: iconSvg('chevron-down', { size: 12 }) });
      status = h('div', { class: 'nav-status', role: 'status' });
      list = h('div', { class: 'nav-list' });
      const bar = h('div', { class: 'nav-tabs', role: 'tablist' }, ['headings', 'pages', 'results'].map((k) => {
        tabs[k] = h('button', { type: 'button', role: 'tab', class: 'nav-tab', onclick: () => select(k) }, t(`nav.${k}`));
        return tabs[k];
      }));
      let timer = null;
      input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(runSearch, 150); });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); if (!matches.length || input.dataset.q !== input.value) { runSearch(); input.dataset.q = input.value; } else go(current + (e.shiftKey ? -1 : 1), false); }
        if (e.key === 'Escape') { e.preventDefault(); editor.focus(); }
      });
      optsBtn.addEventListener('click', () => openMenu({
        anchor: optsBtn,
        items: [
          ...['matchCase', 'wholeWord', 'wildcards', 'regex'].map((k) => ({ label: t(`fr.${k}`), checked: opts[k], run: () => { opts = { ...opts, [k]: !opts[k] }; if (k === 'wildcards' && opts.wildcards) opts.regex = false; if (k === 'regex' && opts.regex) opts.wildcards = false; runSearch(); } })),
          '-',
          { label: t('nav.advancedFind'), run: () => openReplace('find', input.value) },
          { label: t('cmd.home.replace'), run: () => openReplace('replace', input.value) },
          { label: t('cmd.home.goTo'), run: () => openReplace('goto') },
        ],
      }));
      rec = dock.open({
        id: 'navigation', title: t('nav.title'),
        body: h('div', { class: 'pane-body nav' }, h('div', { class: 'nav-searchrow' }, input, optsBtn, prev, next), status, bar, list),
        onClose: () => { rec = null; matches = []; setHighlights([], -1); store.set({ navigationPane: false }); },
      });
      store.set({ navigationPane: true });
    }
    if (query != null) { input.value = query; runSearch(); }
    if (focusSearch) { input.focus(); input.select(); }
    render();
  }

  // Keep headings / pages current while the pane is open.
  let raf = 0;
  const refresh = () => {
    if (!rec || tab === 'results' || raf) return;
    // Thumbnails are rebuilt at most a few times a second.
    if (tab === 'pages') { if (!refresh.timer) refresh.timer = setTimeout(() => { refresh.timer = 0; render(); }, 400); return; }
    raf = requestAnimationFrame(() => { raf = 0; render(); });
  };

  return {
    open,
    close: () => dock.close('navigation'),
    toggle: () => (rec ? dock.close('navigation') : open()),
    isOpen: () => !!rec,
    refresh,
    showTab: (k) => select(k),
    moveHeading,
  };
}

// ------------------------------------------------------------ Styles pane

/**
 * @param {object} o
 * @param o.listStyles () → [{ family, name, display, inUse }]
 * @param o.current () → { paragraph, text }
 * @param o.apply (family, name)
 * @param o.actions { modify(family,name), update(family,name), remove(family,name), create(), clearAll() }
 */
export function createStylesPane({ dock, store, listStyles, current, apply, actions, previewCss }) {
  let rec = null;
  let listEl;
  let showPreview = false;
  let onlyInUse = false;

  function render() {
    if (!rec) return;
    const cur = current();
    listEl.replaceChildren();
    for (const s of listStyles()) {
      if (onlyInUse && !s.inUse) continue;
      const active = cur[s.family] === s.name;
      const label = h('span', { class: 'sp-name', style: showPreview ? previewCss(s.family, s.name) : null }, s.display);
      const kind = h('span', { class: 'sp-kind', 'aria-hidden': 'true' }, s.family === 'paragraph' ? '¶' : 'a');
      const more = h('button', { type: 'button', class: 'sp-more', tabindex: '-1', 'aria-label': t('sp.optionsFor', { name: s.display }), html: iconSvg('chevron-down', { size: 10 }) });
      const row = h('div', { class: `sp-row${active ? ' is-active' : ''}`, role: 'option', 'aria-selected': String(active), tabindex: '0', 'data-style': s.name, 'data-family': s.family }, label, kind, more);
      row.addEventListener('click', (e) => { if (!more.contains(e.target)) apply(s.family, s.name); });
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); apply(s.family, s.name); } });
      more.addEventListener('click', (e) => {
        e.stopPropagation();
        openMenu({
          anchor: more,
          items: [
            { label: t('sp.updateToMatch', { name: s.display }), run: () => actions.update(s.family, s.name) },
            { label: t('sp.modify'), run: () => actions.modify(s.family, s.name) },
            '-',
            { label: t('sp.delete', { name: s.display }), run: () => actions.remove(s.family, s.name) },
          ],
        });
      });
      listEl.append(row);
    }
  }

  function open() {
    if (rec) return;
    listEl = h('div', { class: 'sp-list', role: 'listbox', 'aria-label': t('sp.title') });
    const preview = h('label', { class: 'fm-check' }, h('input', { type: 'checkbox', onchange: (e) => { showPreview = e.target.checked; render(); } }), t('sp.showPreview'));
    const inUse = h('label', { class: 'fm-check' }, h('input', { type: 'checkbox', onchange: (e) => { onlyInUse = e.target.checked; render(); } }), t('sp.inUse'));
    const foot = h('div', { class: 'sp-foot' },
      h('button', { type: 'button', class: 'dlg-btn', onclick: () => actions.create() }, t('sp.newStyle')),
      h('button', { type: 'button', class: 'dlg-btn', onclick: () => actions.clearAll() }, t('sp.clearAll')));
    rec = dock.open({ id: 'styles', title: t('sp.title'), body: h('div', { class: 'pane-body sp' }, listEl, h('div', { class: 'sp-opts' }, preview, inUse), foot), onClose: () => { rec = null; store.set({ stylesPane: false }); } });
    store.set({ stylesPane: true });
    render();
  }

  let raf = 0;
  return {
    open,
    toggle: () => (rec ? dock.close('styles') : open()),
    isOpen: () => !!rec,
    refresh: () => { if (rec && !raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); },
  };
}
