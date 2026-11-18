/**
 * Find and Replace (Ctrl+H) with its Find and Go To (Ctrl+G) tabs. The
 * dialog is modeless so the document stays editable behind it: match case,
 * whole words, wildcards, regular expressions, and formatting to find and to
 * apply to replacements. Replace All is a single undo step.
 */
import { TextSelection } from 'prosemirror-state';
import { h } from './dom.js';
import { t } from '../i18n/index.js';
import { field, text, select, check, row } from './form.js';
import { findAll, replacementFor, searchKey, selectRange } from '../core/search.js';
import { schema } from '../core/schema.js';
import { effectiveOf, UNDERLINES, hasUnderline } from '../core/commands/text.js';
import { mergeAuto } from '../core/odt/styles.js';

const FORMATS = {
  bold: { test: (p) => p['fo:font-weight'] === 'bold', set: { 'fo:font-weight': 'bold' } },
  italic: { test: (p) => p['fo:font-style'] === 'italic', set: { 'fo:font-style': 'italic' } },
  underline: { test: hasUnderline, set: UNDERLINES.single },
  highlight: { test: (p) => !!p['fo:background-color'] && p['fo:background-color'] !== 'transparent', set: { 'fo:background-color': '#ffff00' } },
  strikethrough: { test: (p) => !!p['style:text-line-through-style'] && p['style:text-line-through-style'] !== 'none', set: { 'style:text-line-through-style': 'solid' } },
};

export function createFindDialog({ editor, docArea, toast }) {
  let el = null;
  let tab = 'find';
  const view = () => editor.view;
  const index = () => docArea.styleIndex;

  function close() {
    if (!el) return;
    el.remove();
    el = null;
    view().dispatch(view().state.tr.setMeta(searchKey, { matches: [], current: -1 }).setMeta('addToHistory', false));
    editor.focus();
  }

  function open(which = 'replace', query = null) {
    tab = which;
    if (!el) build();
    if (query != null) el.querySelector('.fr-find').value = query;
    else if (!view().state.selection.empty && which !== 'goto') {
      const s = view().state.doc.textBetween(view().state.selection.from, view().state.selection.to, ' ');
      if (s.length < 200 && !s.includes('\n')) el.querySelector('.fr-find').value = s;
    }
    show();
  }

  let controls;
  function build() {
    const find = text('', { class: 'fm-input fr-find', 'aria-label': t('fr.findWhat') });
    const repl = text('', { class: 'fm-input fr-repl', 'aria-label': t('fr.replaceWith') });
    const matchCase = check(t('fr.matchCase'));
    const wholeWord = check(t('fr.wholeWord'));
    const wildcards = check(t('fr.wildcards'));
    const regex = check(t('fr.regex'));
    wildcards.input.addEventListener('change', () => { if (wildcards.input.checked) regex.input.checked = false; });
    regex.input.addEventListener('change', () => { if (regex.input.checked) wildcards.input.checked = false; });
    const fmtOpts = [['', t('fr.anyFormat')], ...Object.keys(FORMATS).map((k) => [k, t(`fr.fmt.${k}`)])];
    const findFmt = select(fmtOpts, '');
    const replFmt = select([['', t('fr.noFormat')], ...fmtOpts.slice(1)], '');
    const status = h('div', { class: 'fr-status', role: 'status', 'aria-live': 'polite' });
    const gotoWhat = select([['page', t('fr.page')], ['heading', t('fr.heading')], ['bookmark', t('fr.bookmark')]], 'page');
    const gotoInput = text('', { class: 'fm-input fr-goto', 'aria-label': t('fr.gotoNumber') });
    controls = { find, repl, matchCase, wholeWord, wildcards, regex, findFmt, replFmt, status, gotoWhat, gotoInput };

    const btn = (label, fn, cls = '') => h('button', { type: 'button', class: `dlg-btn ${cls}`, onclick: fn }, label);
    const tabsEl = h('div', { class: 'fm-tabs', role: 'tablist' }, ['find', 'replace', 'goto'].map((k) => h('button', { type: 'button', role: 'tab', class: 'fm-tab', 'data-tab': k, onclick: () => { tab = k; show(); } }, t(`fr.tab.${k}`))));
    const findPanel = h('div', { class: 'fr-panel', 'data-panel': 'find' },
      row(field(t('fr.findWhat'), find, { wide: true })),
      h('div', { class: 'fr-replace-row' }, row(field(t('fr.replaceWith'), repl, { wide: true }))),
      h('div', { class: 'fm-grid2' }, matchCase, wildcards, wholeWord, regex),
      row(field(t('fr.findFormat'), findFmt), h('div', { class: 'fr-replace-row' }, field(t('fr.replaceFormat'), replFmt))),
      status,
      h('div', { class: 'dlg-buttons fr-buttons' },
        h('span', { class: 'fr-replace-row' }, btn(t('fr.replace'), replaceOne), btn(t('fr.replaceAll'), replaceAll)),
        btn(t('fr.findNext'), () => findNext(1), 'primary'), btn(t('common.close'), close)));
    const gotoPanel = h('div', { class: 'fr-panel', 'data-panel': 'goto' },
      row(field(t('fr.gotoWhat'), gotoWhat), field(t('fr.gotoNumber'), gotoInput, { wide: true })),
      h('div', { class: 'dlg-buttons' }, btn(t('fr.goTo'), goTo, 'primary'), btn(t('common.close'), close)));
    el = h('div', { class: 'dlg fr-dialog', role: 'dialog', 'aria-modal': 'false', 'aria-label': t('fr.title') },
      h('div', { class: 'dlg-head fr-drag' }, h('h2', { class: 'dlg-title' }, t('fr.title')), h('button', { type: 'button', class: 'dlg-x', 'aria-label': t('common.close'), onclick: close }, '×')),
      h('div', { class: 'dlg-body' }, tabsEl, findPanel, gotoPanel));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); if (tab === 'goto') goTo(); else findNext(1); }
      e.stopPropagation();
    });
    // Drag by the title bar.
    const head = el.querySelector('.fr-drag');
    head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      const r = el.getBoundingClientRect();
      const dx = e.clientX - r.left;
      const dy = e.clientY - r.top;
      head.setPointerCapture(e.pointerId);
      const move = (ev) => { el.style.left = `${Math.max(0, ev.clientX - dx)}px`; el.style.top = `${Math.max(0, ev.clientY - dy)}px`; };
      const up = () => { head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', up); };
      head.addEventListener('pointermove', move);
      head.addEventListener('pointerup', up);
    });
    document.body.append(el);
  }

  function show() {
    el.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    el.querySelector('[data-panel="find"]').hidden = tab === 'goto';
    el.querySelector('[data-panel="goto"]').hidden = tab !== 'goto';
    el.querySelectorAll('.fr-replace-row').forEach((r) => { r.hidden = tab !== 'replace'; });
    const focus = tab === 'goto' ? controls.gotoInput : controls.find;
    focus.focus();
    focus.select();
  }

  const options = () => ({
    query: controls.find.value, matchCase: controls.matchCase.input.checked, wholeWord: controls.wholeWord.input.checked,
    wildcards: controls.wildcards.input.checked, regex: controls.regex.input.checked,
  });

  function filter() {
    const f = FORMATS[controls.findFmt.value];
    if (!f) return null;
    return (marks, para) => f.test(effectiveOf(index(), para, marks));
  }

  function matches() {
    try {
      const ms = findAll(view().state.doc, options(), filter());
      controls.find.removeAttribute('aria-invalid');
      return ms;
    } catch {
      controls.find.setAttribute('aria-invalid', 'true');
      controls.status.textContent = t('fr.badPattern');
      return null;
    }
  }

  function highlight(ms, cur) {
    view().dispatch(view().state.tr.setMeta(searchKey, { matches: ms, current: cur }).setMeta('addToHistory', false));
  }

  function findNext(dir = 1) {
    const ms = matches();
    if (!ms) return null;
    if (!ms.length) { controls.status.textContent = t('fr.notFound'); highlight([], -1); return null; }
    const { from, to } = view().state.selection;
    let i = dir > 0 ? ms.findIndex((m) => m.from >= to || (m.from >= from && m.from > from)) : ms.findLastIndex((m) => m.to <= from);
    if (i < 0) i = dir > 0 ? 0 : ms.length - 1;
    highlight(ms, i);
    selectRange(view(), ms[i].from, ms[i].to);
    controls.status.textContent = t('nav.resultOf', { n: i + 1, count: ms.length });
    return ms[i];
  }

  /** Applies "replace with" formatting to a range of a transaction. */
  function formatRange(tr, from, to) {
    const f = FORMATS[controls.replFmt.value];
    if (!f || to <= from) return;
    const type = schema.marks.textProps;
    tr.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isText) return true;
      const a = Math.max(from, pos);
      const b = Math.min(to, pos + node.nodeSize);
      const old = node.marks.find((m) => m.type === type)?.attrs.auto || null;
      const auto = mergeAuto(old, { styleAttrs: {}, props: { 'style:text-properties': { a: Object.fromEntries(Object.entries(f.set).filter(([, v]) => v != null)) } } });
      tr.removeMark(a, b, type).addMark(a, b, type.create({ auto }));
      return false;
    });
  }

  function replaceIn(tr, m, o) {
    const from = tr.mapping.map(m.from);
    const to = tr.mapping.map(m.to);
    const s = replacementFor(m, controls.repl.value, o);
    const marks = tr.doc.resolve(Math.min(from + 1, to)).marks();
    if (s) tr.replaceWith(from, to, schema.text(s, marks)); else tr.delete(from, to);
    formatRange(tr, from, from + s.length);
    return from + s.length;
  }

  function replaceOne() {
    const o = options();
    const ms = matches();
    if (!ms) return;
    const { from, to } = view().state.selection;
    const m = ms.find((x) => x.from === from && x.to === to);
    if (m) {
      const tr = view().state.tr;
      const end = replaceIn(tr, m, o);
      tr.setSelection(TextSelection.create(tr.doc, end));
      view().dispatch(tr.scrollIntoView());
    }
    findNext(1);
  }

  function replaceAll() {
    const o = options();
    const ms = matches();
    if (!ms) return;
    if (!ms.length) { controls.status.textContent = t('fr.notFound'); return; }
    const tr = view().state.tr;
    for (const m of ms) replaceIn(tr, m, o);
    view().dispatch(tr.scrollIntoView());
    highlight([], -1);
    controls.status.textContent = t('fr.replacedN', { count: ms.length });
    toast(t('fr.replacedN', { count: ms.length }));
  }

  function goTo() {
    const what = controls.gotoWhat.value;
    const raw = controls.gotoInput.value.trim();
    const v = view();
    if (what === 'page') {
      const pages = docArea.pages;
      let n = Number(raw.replace(/^[+-]/, ''));
      if (/^[+-]/.test(raw)) n = (docArea.pageAt(v.state.selection.head) + 1) + (raw[0] === '-' ? -n : n);
      if (!n || n < 1 || n > pages.length) { controls.status.textContent = t('fr.noSuchPage', { count: pages.length }); return; }
      const pos = pages[n - 1].startPos ?? null;
      if (pos != null) editor.focusAt(pos);
      docArea.view.pageElement(n - 1)?.scrollIntoView({ block: 'start' });
      editor.focus();
    } else if (what === 'heading') {
      const hs = [];
      v.state.doc.descendants((node, pos) => { if (node.type.name === 'heading') hs.push(pos); return !node.isTextblock; });
      const cur = v.state.selection.head;
      let target = null;
      if (!raw || raw === '+') target = hs.find((p) => p > cur);
      else if (raw === '-') target = hs.filter((p) => p < cur - 1).at(-1);
      else target = hs[Number(raw) - 1];
      if (target == null) { controls.status.textContent = t('fr.noSuchHeading'); return; }
      editor.focusAt(target + 1);
      v.dispatch(v.state.tr.scrollIntoView());
    } else {
      let target = null;
      v.state.doc.descendants((node, pos) => { if (target == null && node.type.name === 'bookmark' && node.attrs.name === raw) target = pos; return target == null; });
      if (target == null) { controls.status.textContent = t('fr.noSuchBookmark'); return; }
      editor.focusAt(target);
      v.dispatch(v.state.tr.scrollIntoView());
    }
    close();
  }

  return { open, close, isOpen: () => !!el, findNext };
}
