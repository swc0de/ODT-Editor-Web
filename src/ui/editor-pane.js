/**
 * Editor pane (Review ▸ Spelling & Grammar, F7, Home ▸ Editor): counts of
 * spelling and grammar problems, then one problem at a time with its
 * sentence, suggestions, Ignore Once / Ignore All / Add to Dictionary /
 * Change All, and Previous / Next. "Your document looks good" when done.
 */
import { TextSelection } from 'prosemirror-state';
import { h } from './dom.js';
import { t } from '../i18n/index.js';
import { getSetting, setSetting } from '../core/settings.js';
import { problemsOf, suggestions, addToDictionary, ignoreAll, recheckAll } from '../core/proofing.js';

export function createEditorPane({ dock, getEditor }) {
  let rec = null;
  let body = null;
  let index = 0;
  let ignoredOnce = []; // problems skipped this session: { word, from }
  let seq = 0;

  const view = () => getEditor().view;
  const list = () => problemsOf(view().state).filter((p) => !ignoredOnce.some((x) => x.from === p.from && x.word === (p.word || p.rule)));

  function select(p) {
    const v = view();
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, p.from, p.to)).scrollIntoView());
  }

  function replace(p, text) {
    const v = view();
    const tr = v.state.tr;
    if (text) tr.insertText(text, p.from, p.to); else tr.delete(p.from, p.to);
    v.dispatch(tr.scrollIntoView());
  }

  async function render(focusIt = false) {
    if (!rec) return;
    const all = list();
    const spell = all.filter((p) => p.kind === 'spell').length;
    const gram = all.length - spell;
    const counts = h('div', { class: 'ed-counts' },
      h('div', { class: 'ed-count' }, h('span', { class: 'ed-dot spell' }), t('ed.spelling'), h('b', {}, String(spell))),
      h('div', { class: 'ed-count' }, h('span', { class: 'ed-dot grammar' }), t('ed.grammar'), h('b', {}, String(gram))));
    if (!all.length) {
      body.replaceChildren(counts, h('div', { class: 'ed-done' }, h('div', { class: 'ed-done-title' }, t('ed.good')), h('div', {}, t('ed.goodHint'))));
      return;
    }
    index = Math.max(0, Math.min(index, all.length - 1));
    const p = all[index];
    const v = view();
    const $p = v.state.doc.resolve(p.from);
    const para = $p.parent;
    const start = $p.start();
    const text = para.textBetween(0, para.content.size, null, '￼');
    const a = p.from - start;
    const b = p.to - start;
    const ctx = h('div', { class: 'ed-context' }, text.slice(Math.max(0, a - 60), a), h('mark', { class: p.kind === 'spell' ? 'sp' : 'gr' }, text.slice(a, b) || '␣'), text.slice(b, b + 60));
    const sugg = h('div', { class: 'ed-suggestions', role: 'list' });
    const n = ++seq;
    const fill = (items) => {
      if (n !== seq) return;
      sugg.replaceChildren(...(items.length ? items.map((s) => h('button', { type: 'button', class: 'ed-sugg', onclick: () => { replace(p, s); later(); } }, s.trim() ? s : (s ? t('ed.singleSpace') : t('ed.delete')))) : [h('div', { class: 'ed-none' }, t('ed.noSuggestions'))]));
    };
    if (p.kind === 'spell') suggestions(p.lang, p.word).then(fill); else fill([p.fix ?? '']);
    const actions = p.kind === 'spell'
      ? [
        h('button', { type: 'button', class: 'dlg-btn', onclick: () => { ignoredOnce.push({ from: p.from, word: p.word }); render(); } }, t('ed.ignoreOnce')),
        h('button', { type: 'button', class: 'dlg-btn', onclick: () => { ignoreAll(p.word); recheckAll(view()); later(); } }, t('ed.ignoreAll')),
        h('button', { type: 'button', class: 'dlg-btn', onclick: () => { addToDictionary([p.word]); setSetting('customDictionary', [...(getSetting('customDictionary') || []), p.word]); recheckAll(view()); later(); } }, t('ed.add')),
        h('button', { type: 'button', class: 'dlg-btn', onclick: async () => { const s = (await suggestions(p.lang, p.word))[0]; if (s) changeAll(p.word, s); } }, t('ed.changeAll')),
      ]
      : [h('button', { type: 'button', class: 'dlg-btn', onclick: () => { ignoredOnce.push({ from: p.from, word: p.rule }); render(); } }, t('ed.ignoreOnce'))];
    body.replaceChildren(counts,
      h('div', { class: `ed-card ${p.kind}` },
        h('div', { class: 'ed-kind' }, p.kind === 'spell' ? t('ed.spellingIssue') : t(`ed.rule.${p.rule}`)),
        ctx, h('div', { class: 'fm-label' }, t('ed.suggestions')), sugg, h('div', { class: 'ed-actions' }, ...actions)),
      h('div', { class: 'ed-nav' },
        h('button', { type: 'button', class: 'dlg-btn', 'aria-label': t('ed.previous'), onclick: () => { index = (index - 1 + all.length) % all.length; select(list()[index]); render(); } }, '‹'),
        h('span', {}, t('ed.position', { i: index + 1, n: all.length })),
        h('button', { type: 'button', class: 'dlg-btn', 'aria-label': t('ed.next'), onclick: () => { index = (index + 1) % all.length; select(list()[index]); render(); } }, '›')));
    // Selected when opened or after acting on a problem, not on background re-checks while you type.
    if (focusIt && !view().hasFocus()) select(p);
  }

  function changeAll(word, to) {
    const v = view();
    const tr = v.state.tr;
    for (const p of problemsOf(v.state).filter((x) => x.kind === 'spell' && x.word === word).reverse()) tr.insertText(to, p.from, p.to);
    v.dispatch(tr);
    later();
  }

  /** Re-render once the checker has caught up with an edit. */
  const later = () => {
    // Select the next problem only if nothing else was edited meanwhile.
    const doc = view().state.doc;
    setTimeout(() => render(view().state.doc === doc), 700);
  };

  return {
    open() {
      if (rec) { render(true); return; }
      body = h('div', { class: 'ed-pane', 'aria-live': 'polite' });
      index = 0;
      ignoredOnce = [];
      rec = dock.open({ id: 'editor', title: t('ed.title'), body, onClose: () => { rec = null; } });
      body.append(h('div', { class: 'ed-done' }, t('ed.checking')));
      setTimeout(() => render(true), 300);
    },
    render,
    get isOpen() { return !!rec; },
  };
}
