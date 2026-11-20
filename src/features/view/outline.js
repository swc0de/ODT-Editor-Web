/**
 * Outline view: every paragraph with an outline symbol (⊕ heading with
 * content, ⊖ empty heading, • body text), indented by level; headings
 * collapse and expand; Show Level hides deeper levels. The Outlining tab
 * promotes, demotes and moves paragraphs (with their collapsed content).
 */
import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { outlineItems, subtreeEnd, siblingRange, moveRange, setItemLevel, ensureHeadingStyle, BODY } from '../../core/outline.js';
import { editState } from '../../core/state-step.js';

export const outlineKey = new PluginKey('outline');

/** o = { on(): Outline view is showing } */
export function outlinePlugin(o) {
  return new Plugin({
    key: outlineKey,
    state: {
      init: () => ({ collapsed: [], showLevel: BODY }),
      apply(tr, v) {
        const meta = tr.getMeta(outlineKey);
        let next = v;
        if (tr.docChanged && v.collapsed.length) next = { ...next, collapsed: v.collapsed.map((p) => tr.mapping.mapResult(p, 1)).filter((r) => !r.deleted).map((r) => r.pos) };
        if (meta) next = { ...next, ...meta };
        return next;
      },
    },
    props: {
      decorations(state) {
        if (!o.on()) return null;
        const { collapsed, showLevel } = outlineKey.getState(state);
        const items = outlineItems(state.doc);
        const hidden = new Set();
        const shut = new Set(collapsed);
        let parentLevel = 0;
        const decos = [];
        items.forEach((it, i) => {
          if (shut.has(it.pos) && it.heading) for (let j = i + 1; j < subtreeEnd(items, i); j++) hidden.add(j);
          if (it.level > showLevel) hidden.add(i);
          if (it.heading) parentLevel = it.level;
          const depth = it.heading ? it.level - 1 : parentLevel;
          const hasContent = it.heading && subtreeEnd(items, i) > i + 1;
          const kind = it.heading ? (hasContent ? 'plus' : 'minus') : 'body';
          decos.push(Decoration.node(it.pos, it.end, {
            class: `ol-item ol-${kind}${hidden.has(i) ? ' ol-hidden' : ''}${shut.has(it.pos) && hasContent ? ' ol-collapsed' : ''}`,
            style: `--ol-depth:${depth}`,
          }));
          if (it.node.isTextblock) {
            decos.push(Decoration.widget(it.pos + 1, () => {
              const el = document.createElement('span');
              el.className = `ol-mark ol-mark-${kind}`;
              el.contentEditable = 'false';
              el.dataset.pos = String(it.pos);
              el.setAttribute('aria-hidden', 'true');
              return el;
            }, { side: -1, key: `ol:${kind}`, ignoreSelection: true, marks: [] }));
          }
        });
        return DecorationSet.create(state.doc, decos);
      },
      handleDOMEvents: {
        mousedown(view, e) {
          const mark = e.target.closest?.('.ol-mark');
          if (!mark || !o.on()) return false;
          e.preventDefault();
          const pos = Number(mark.dataset.pos);
          const items = outlineItems(view.state.doc);
          const i = items.findIndex((x) => x.pos === pos);
          if (i < 0) return true;
          // Click on a heading's symbol: collapse / expand it. Body text: select the paragraph.
          if (mark.classList.contains('ol-mark-plus')) toggleCollapse(view, [pos]);
          else view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos + 1, items[i].end - 1)));
          return true;
        },
      },
    },
  });
}

const st = (view) => outlineKey.getState(view.state);

export function toggleCollapse(view, positions, force = null) {
  const cur = new Set(st(view).collapsed);
  for (const p of positions) {
    const on = force ?? !cur.has(p);
    if (on) cur.add(p); else cur.delete(p);
  }
  view.dispatch(view.state.tr.setMeta(outlineKey, { collapsed: [...cur] }).setMeta('addToHistory', false));
}

/** The outline items the selection touches: [index…] (at least the caret's). */
function selectedItems(view, items) {
  const { from, to } = view.state.selection;
  const out = [];
  items.forEach((it, i) => { if (it.end > from && it.pos < Math.max(to, from + 1)) out.push(i); });
  if (!out.length) { const i = items.findIndex((it) => it.pos <= from && from <= it.end); if (i >= 0) out.push(i); }
  return out;
}

/** Selected items plus the hidden content of any collapsed heading among them. */
function withCollapsed(view, items, sel) {
  const shut = new Set(st(view).collapsed);
  const set = new Set(sel);
  for (const i of sel) if (items[i].heading && shut.has(items[i].pos)) for (let j = i + 1; j < subtreeEnd(items, i); j++) set.add(j);
  return [...set].sort((a, b) => a - b);
}

/** Changes the outline level of the selected paragraphs: fn(level, index) → new level. */
export function changeLevels(c, fn) {
  const view = c.mainEditor.view;
  const items = outlineItems(view.state.doc);
  const sel = withCollapsed(view, items, selectedItems(view, items));
  const changes = [];
  for (const i of sel) {
    if (!items[i].node.isTextblock) continue;
    const prevHeading = items.slice(0, i).reverse().find((x) => x.heading);
    const next = Math.max(1, Math.min(BODY, fn(items[i].level, i, prevHeading?.level || 0, sel[0] === i)));
    if (next !== items[i].level && (next < BODY || items[i].heading)) changes.push([items[i].pos, next === BODY ? BODY : Math.min(9, next)]);
  }
  if (!changes.length) return;
  const docState = c.session.state;
  editState(view, docState, ['commonStyles'], (s) => { for (const [, l] of changes) if (l < BODY) ensureHeadingStyle(s, l); }, (tr) => {
    for (const [pos, level] of changes) setItemLevel(tr, pos, level, view.state.schema, (l) => `Heading_20_${l}`);
  });
  view.focus();
}

export const promote = (c) => changeLevels(c, (l, _i, prev, isFirst) => (l >= BODY ? (isFirst ? Math.max(1, prev || 1) : l) : l - 1));
export const demote = (c) => changeLevels(c, (l) => (l >= BODY ? l : Math.min(9, l + 1)));
export const promoteToHeading1 = (c) => changeLevels(c, () => 1);
export const demoteToBody = (c) => changeLevels(c, () => BODY);
export const setLevel = (c, level) => changeLevels(c, () => level);

/** Current outline level at the caret (1–9, BODY), or null. */
export function levelAt(view) {
  const items = outlineItems(view.state.doc);
  const i = selectedItems(view, items)[0];
  return i == null ? null : items[i].level;
}

/** Which items are showing (not under a collapsed heading, not deeper than Show Level). */
function visibility(view, items) {
  const shut = new Set(st(view).collapsed);
  const showLevel = st(view).showLevel;
  const vis = items.map((it) => it.level <= showLevel);
  items.forEach((it, i) => { if (it.heading && shut.has(it.pos)) for (let j = i + 1; j < subtreeEnd(items, i); j++) vis[j] = false; });
  return vis;
}

/** Index after item i and the hidden items that follow it (they move with it). */
const withHidden = (vis, i) => { let j = i + 1; while (j < vis.length && !vis[j]) j++; return j; };

/** Moves the selected paragraphs (with their hidden content) up or down past the neighbouring visible item. */
export function moveItems(c, dir) {
  const view = c.mainEditor.view;
  const items = outlineItems(view.state.doc);
  const sel = selectedItems(view, items);
  if (!sel.length) return;
  const vis = visibility(view, items);
  const i0 = sel[0];
  const i1 = withHidden(vis, sel[sel.length - 1]);
  const range = siblingRange(view.state.doc, items, i0, i1);
  if (!range) return;
  let target = null;
  if (dir < 0) {
    let k = i0 - 1;
    while (k >= 0 && !vis[k]) k--;
    if (k < 0) return;
    const r = siblingRange(view.state.doc, items, k, i0);
    target = r ? r.from : null;
  } else {
    let k = i1;
    while (k < items.length && !vis[k]) k++;
    if (k >= items.length) return;
    const r = siblingRange(view.state.doc, items, i1, withHidden(vis, k));
    target = r ? r.to : null;
  }
  if (target == null) return;
  const { from, to } = view.state.selection;
  const offFrom = from - range.from;
  const offTo = to - range.from;
  const tr = view.state.tr;
  const at = moveRange(tr, range.from, range.to, target);
  if (at == null) return;
  const max = tr.doc.content.size;
  tr.setSelection(TextSelection.create(tr.doc, Math.min(max, at + offFrom), Math.min(max, at + offTo)));
  // Collapsed headings that moved stay collapsed.
  const collapsed = st(view).collapsed.map((p) => (p >= range.from && p < range.to ? at + (p - range.from) : tr.mapping.map(p)));
  view.dispatch(tr.scrollIntoView().setMeta(outlineKey, { collapsed }));
  view.focus();
}

/** Expand / Collapse one level at the selection (Word: the + and − buttons). */
export function expand(c, on) {
  const view = c.mainEditor.view;
  const items = outlineItems(view.state.doc);
  const sel = selectedItems(view, items).filter((i) => items[i].heading);
  if (!sel.length) return;
  toggleCollapse(view, sel.map((i) => items[i].pos), !on);
}

export function showLevel(c, level) {
  const view = c.mainEditor.view;
  view.dispatch(view.state.tr.setMeta(outlineKey, { showLevel: level, collapsed: [] }).setMeta('addToHistory', false));
}

export const shownLevel = (c) => outlineKey.getState(c.mainEditor.view.state)?.showLevel ?? BODY;
