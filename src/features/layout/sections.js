/**
 * "Sections" in the Word sense: runs of the document governed by one page
 * style (master page). A section starts at a paragraph (or table) whose style
 * names a master page; the first section starts at the top of the document.
 */
import { topLevelMasters } from '../../layout/regions.js';
import { editState } from '../../core/state-step.js';
import { findMaster, newSectionMaster, updatePageLayouts } from '../../core/page-setup.js';
import { schema } from '../../core/schema.js';

export const PAGE_KEYS = ['masterStyles', 'stylesAutoStyles'];

/** The body editor (commands may run while a header/footer editor is active). */
export const bodyView = (c) => (c.mainEditor || c.editor).view;

const firstMasterName = (c) => c.ui.docArea.model?.first.name || 'Standard';

/** All sections: [{ master, start, end, startNode }]. */
export function sections(c) {
  const doc = bodyView(c).state.doc;
  const list = topLevelMasters(doc, c.ui.docArea.styleIndex, firstMasterName(c));
  const out = [];
  for (const [pos, node, master] of list) {
    const last = out[out.length - 1];
    const starts = !last || last.master !== master || (node.attrs?.auto?.styleAttrs?.['style:master-page-name']);
    if (starts && (!last || pos > last.start)) out.push({ master, start: pos, end: pos + node.nodeSize, startNode: node });
    else last.end = pos + node.nodeSize;
  }
  return out;
}

/** The section containing the selection head. */
export function currentSection(c) {
  const head = bodyView(c).state.selection.head;
  const all = sections(c);
  return all.find((s) => head >= s.start && head <= s.end) || all[all.length - 1] || { master: firstMasterName(c), start: 0, end: bodyView(c).state.doc.content.size };
}

/** A master page and the page styles that follow it (next-style chain). */
export function masterChain(state, name) {
  const out = [];
  let cur = name;
  while (cur && !out.includes(cur)) {
    out.push(cur);
    cur = findMaster(state, cur)?.a['style:next-style-name'] || null;
  }
  return out;
}

/** Sets the master page named by a top-level block (adds the attribute to its direct formatting). */
export function setBlockMaster(tr, pos, master) {
  const node = tr.doc.nodeAt(pos);
  if (!node) return;
  if (node.type === schema.nodes.paragraph || node.type === schema.nodes.heading) {
    const auto = structuredClone(node.attrs.auto) || { styleAttrs: {}, props: {} };
    auto.styleAttrs = { ...(auto.styleAttrs || {}), 'style:master-page-name': master };
    tr.setNodeMarkup(pos, null, { ...node.attrs, auto });
  } else if (node.type === schema.nodes.section) {
    let inner = pos + 1;
    const first = node.firstChild;
    if (first?.isTextblock) setBlockMaster(tr, inner, master);
    void inner;
  }
}

/**
 * Applies a page-layout change to the current section (or the whole
 * document) as one undoable step. A page style shared with other sections is
 * copied first, so only this section changes.
 */
export function changePages(c, fn, { whole = false } = {}) {
  const view = bodyView(c);
  const state = c.session.state;
  let targets;
  let repoint = null;
  if (whole) {
    targets = [...new Set(sections(c).flatMap((s) => masterChain(state, s.master)))];
  } else {
    const sec = currentSection(c);
    const shared = sections(c).filter((s) => s.master === sec.master).length > 1;
    targets = masterChain(state, sec.master);
    if (shared) repoint = sec;
  }
  editState(view, state, PAGE_KEYS, (st) => {
    if (repoint) {
      const name = newSectionMaster(st, repoint.master);
      targets = masterChain(st, name);
      repoint.newMaster = name;
    }
    updatePageLayouts(st, targets, fn);
  }, (tr) => { if (repoint) setBlockMaster(tr, repoint.start, repoint.newMaster); });
}
