/**
 * Accessibility pane (Review ▸ Check Accessibility): errors, warnings and
 * tips, each with where it is and a recommended action. It re-checks as the
 * document changes while it is open.
 */
import { NodeSelection, TextSelection } from 'prosemirror-state';
import { h } from './dom.js';
import { t } from '../i18n/index.js';
import { iconSvg } from './icons.js';
import { checkAccessibility } from '../core/accessibility.js';

const FIX = { altText: 'acc.fixAltText', tableHeader: 'acc.fixHeader' };

export function createAccessibilityPane({ dock, getEditor, getSession, getPages, runCommand }) {
  let rec = null;
  let body = null;
  let timer = 0;

  function goTo(issue) {
    const view = getEditor().view;
    if (issue.pos == null) return;
    const node = view.state.doc.nodeAt(issue.pos);
    let sel;
    if (node?.type.name === 'frame') sel = NodeSelection.create(view.state.doc, issue.pos);
    else if (node?.type.name === 'table') sel = TextSelection.near(view.state.doc.resolve(issue.pos + 4));
    else sel = TextSelection.near(view.state.doc.resolve(Math.min(issue.pos + 1, view.state.doc.content.size)));
    view.dispatch(view.state.tr.setSelection(sel).scrollIntoView());
    view.focus();
  }

  function fix(issue) {
    goTo(issue);
    const view = getEditor().view;
    if (issue.rule === 'altText') {
      const node = view.state.doc.nodeAt(issue.pos);
      runCommand(node?.attrs.kind === 'image' ? 'pictureFormat.altText' : 'shapeFormat.altText');
    } else if (issue.rule === 'tableHeader') runCommand('tableLayout.repeatHeader');
  }

  function render() {
    if (!rec) return;
    const session = getSession();
    const issues = checkAccessibility({ doc: getEditor().view.state.doc, meta: session?.state.meta }, { pages: getPages() });
    const groups = ['error', 'warning', 'tip'].map((sev) => [sev, issues.filter((i) => i.severity === sev)]).filter(([, list]) => list.length);
    if (!groups.length) {
      body.replaceChildren(h('div', { class: 'acc-good' }, h('span', { html: iconSvg('set-default', { size: 18 }) }), h('div', {}, h('b', {}, t('acc.good')), h('div', {}, t('acc.goodHint')))));
      return;
    }
    body.replaceChildren(...groups.map(([sev, list]) => h('section', { class: `acc-group ${sev}` },
      h('h3', { class: 'acc-head' }, h('span', { class: 'acc-icon', html: iconSvg(sev === 'error' ? 'circle-x' : sev === 'warning' ? 'alert-triangle' : 'info', { size: 14 }) }), `${t(`acc.${sev}s`)} (${list.length})`),
      ...list.map((issue) => h('div', { class: 'acc-item' },
        h('button', { type: 'button', class: 'acc-go', onclick: () => goTo(issue), disabled: issue.pos == null ? '' : null },
          h('span', { class: 'acc-rule' }, t(`acc.rule.${issue.rule}`)), issue.label ? h('span', { class: 'acc-label' }, issue.label) : null),
        h('div', { class: 'acc-why' }, t(`acc.why.${issue.rule}`)),
        FIX[issue.rule] ? h('button', { type: 'button', class: 'dlg-btn acc-fix', onclick: () => fix(issue) }, t(FIX[issue.rule])) : null)))));
  }

  return {
    open() {
      if (rec) { render(); return; }
      body = h('div', { class: 'acc-pane', 'aria-live': 'polite' });
      rec = dock.open({ id: 'accessibility', title: t('acc.title'), body, onClose: () => { rec = null; } });
      render();
    },
    /** After an edit, while open. */
    changed() { if (!rec) return; clearTimeout(timer); timer = setTimeout(render, 500); },
    get isOpen() { return !!rec; },
  };
}
