/**
 * Recording tracked changes, and accepting / rejecting them.
 *
 * While Track Changes is on, every edit is rewritten after the fact
 * (appendTransaction): inserted text gets an insertion mark; deleted text is
 * put back with a deletion mark (text you inserted yourself is really
 * deleted); paragraph breaks typed or removed are recorded on the paragraph
 * (`change`); character formatting gets a formatChange mark that remembers
 * the previous formatting so Reject can restore it.
 */
import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { ReplaceStep, AddMarkStep, RemoveMarkStep } from 'prosemirror-transform';
import { Fragment, Slice } from 'prosemirror-model';
import { newChangeId } from './track-changes.js';

export const trackKey = new PluginKey('trackChanges');
const CHANGE_MARKS = ['insertion', 'deletion', 'formatChange'];
const FORMAT_MARKS = ['textProps', 'charStyle'];

const now = () => new Date().toISOString().slice(0, 19);
/** Inline nodes that are anchors, not content: never marked as inserted or deleted. */
const ANCHORS = new Set(['annotation', 'annotation_end', 'bookmark', 'change_marker']);

/** setNodeMarkup on an inline atom (a field's or comment's attributes): not a content change. */
function isAttrEdit(doc, step) {
  if (!(step instanceof ReplaceStep) || step.slice.content.childCount !== 1 || step.slice.openStart || step.slice.openEnd) return false;
  const old = doc.nodeAt(step.from);
  const neu = step.slice.content.firstChild;
  return !!old && old.isAtom && old.nodeSize === step.to - step.from && old.type === neu.type;
}

/** Should this transaction be recorded? */
function recordable(tr) {
  if (!tr.docChanged) return false;
  if (tr.getMeta('tcSkip') || tr.getMeta('load') || tr.getMeta('history$') || tr.getMeta('pagination') || tr.getMeta('addToHistory') === false) return false;
  return tr.steps.every((s) => s instanceof ReplaceStep || s instanceof AddMarkStep || s instanceof RemoveMarkStep);
}

/** The deleted slice with deletion marks; the author's own insertions are dropped. */
function markDeleted(slice, schema, attrs, author) {
  const del = schema.marks.deletion.create(attrs);
  const mapFrag = (frag) => {
    const out = [];
    frag.forEach((n) => {
      if (n.isText || n.isInline) {
        if (ANCHORS.has(n.type.name)) { out.push(n); return; }
        const ins = n.marks.find((m) => m.type.name === 'insertion');
        if (ins && ins.attrs.author === author) return; // your own new text: really gone
        if (n.marks.some((m) => m.type.name === 'deletion')) { out.push(n); return; }
        out.push(n.mark(del.addToSet(n.marks)));
        return;
      }
      out.push(n.copy(mapFrag(n.content)));
    });
    return Fragment.from(out);
  };
  return new Slice(mapFrag(slice.content), slice.openStart, slice.openEnd);
}

/** Deletion attrs: continue your own adjacent deletion (Backspace after Backspace), else a new change. */
function deletionAttrs(doc, pos, author) {
  const $p = doc.resolve(pos);
  for (const n of [$p.nodeAfter, $p.nodeBefore]) {
    const m = n?.marks.find((x) => x.type.name === 'deletion');
    if (m && m.attrs.author === author) return m.attrs;
  }
  return { author, date: now(), cid: newChangeId(), old: null };
}

/** The insertion mark attrs to use at pos: continue your own adjacent insertion, else a new change. */
function insertionAttrs(doc, pos, author) {
  const $p = doc.resolve(pos);
  const before = $p.nodeBefore?.marks.find((m) => m.type.name === 'insertion');
  if (before && before.attrs.author === author) return before.attrs;
  // At the start of a paragraph whose preceding break you just inserted.
  if ($p.parentOffset === 0 && $p.depth >= 1) {
    const idx = $p.index($p.depth - 1);
    const prev = idx > 0 ? $p.node($p.depth - 1).child(idx - 1) : null;
    const ch = prev?.attrs?.change;
    if (ch?.type === 'insertion' && ch.author === author) return { author, date: ch.date, cid: ch.cid, old: null };
  }
  return { author, date: now(), cid: newChangeId(), old: null };
}

/**
 * The tracking plugin. o.isOn() → recording; o.author() → user name;
 * o.display() → 'simple' | 'all' | 'none' | 'original'; o.hidden() → { insdel, fmt, authors: Set }
 */
export function trackChangesPlugin(o) {
  return new Plugin({
    key: trackKey,
    appendTransaction(trs, oldState, state) {
      const recorded = trs.filter(recordable);
      const out = state.tr;
      // A split copies the paragraph's break change to both halves: keep it on the second only.
      for (const tr of trs) {
        if (!tr.docChanged) continue;
        tr.steps.forEach((step) => {
          if (!(step instanceof ReplaceStep) || step.slice.openStart === 0) return;
          const at = tr.mapping.map(step.from);
          const $a = out.doc.resolve(Math.min(at, out.doc.content.size));
          const idx = $a.index($a.depth - 1);
          const parent = $a.node($a.depth - 1);
          const cur = parent.maybeChild(idx);
          const next = parent.maybeChild(idx + 1);
          if (cur?.attrs?.change && next?.attrs?.change && cur.attrs.change.cid === next.attrs.change.cid) {
            out.setNodeMarkup($a.before($a.depth), null, { ...cur.attrs, change: null });
          }
        });
      }
      if (!o.isOn() || recorded.length !== 1 || recorded[0] !== trs[0]) return out.docChanged ? out.setMeta('tcSkip', true) : null;
      const tr = recorded[0];
      const author = o.author();
      const schema = state.schema;
      let caret = null;
      tr.steps.forEach((step, i) => {
        const docBefore = tr.docs[i];
        const toFinal = tr.mapping.slice(i + 1);
        const map = (pos, assoc) => out.mapping.map(toFinal.map(pos, assoc), assoc);
        if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) return; // below
        if (isAttrEdit(docBefore, step)) return;
        // Deleted content goes back in, marked as deleted.
        if (step.to > step.from) {
          const deleted = docBefore.slice(step.from, step.to);
          const attrs = deletionAttrs(out.doc, map(step.from, -1), author);
          const back = markDeleted(deleted, schema, attrs, author);
          const at = map(step.from, -1);
          const before = out.doc.content.size;
          let hasText = false;
          back.content.descendants((n) => { if (n.isInline) hasText = true; return !hasText; });
          if (hasText || back.openStart > 0) {
            try {
              out.replace(at, at, back);
              const end = at + (out.doc.content.size - before);
              // Paragraph breaks inside what was deleted.
              out.doc.nodesBetween(at, end, (n, pos) => {
                if (n.isTextblock) {
                  const brk = pos + n.nodeSize - 1;
                  if (brk >= at && brk < end) {
                    if (n.attrs.change?.type === 'insertion' && n.attrs.change.author === author) out.setNodeMarkup(pos, null, { ...n.attrs, change: null });
                    else out.setNodeMarkup(pos, null, { ...n.attrs, change: { type: 'deletion', ...attrs } });
                  }
                  return false;
                }
                return true;
              });
              // Backspace leaves the caret before the deleted text, Delete after it.
              // (When text replaced the deletion, the caret stays after the new text.)
              const sel = oldState.selection;
              if (!step.slice.size) caret = sel.empty && sel.from === step.to ? at : end;
            } catch { /* structure can't be restored: let the deletion stand */ }
          }
        }
        // Inserted content gets an insertion mark.
        if (step.slice.size) {
          const s = map(step.from, 1);
          const e = map(step.from + step.slice.size, -1);
          if (e > s) {
            const attrs = insertionAttrs(out.doc, s, author);
            out.doc.nodesBetween(s, e, (n, pos) => {
              if (n.isInline) {
                const a = Math.max(pos, s);
                const b = Math.min(pos + n.nodeSize, e);
                if (b > a && !ANCHORS.has(n.type.name) && !n.marks.some((m) => m.type.name === 'insertion')) out.addMark(a, b, schema.marks.insertion.create(attrs));
                return false;
              }
              if (n.isTextblock) {
                const brk = pos + n.nodeSize - 1;
                if (brk >= s && brk < e) out.setNodeMarkup(pos, null, { ...n.attrs, change: { type: 'insertion', ...attrs } });
              }
              return true;
            });
          }
        }
      });
      // Formatting (mark steps don't move positions): remember the previous formatting once.
      if (tr.steps.every((st) => st instanceof AddMarkStep || st instanceof RemoveMarkStep)) {
        const ranges = tr.steps.filter((st) => FORMAT_MARKS.includes(st.mark.type.name)).map((st) => [st.from, st.to]);
        const cid = newChangeId();
        for (const [from, to] of ranges) {
          oldState.doc.nodesBetween(from, to, (n, pos) => {
            if (!n.isText) return true;
            if (n.marks.some((m) => m.type.name === 'formatChange') || n.marks.some((m) => m.type.name === 'insertion' && m.attrs.author === author)) return false;
            const a = Math.max(pos, from);
            const b = Math.min(pos + n.nodeSize, to);
            const old = n.marks.filter((m) => FORMAT_MARKS.includes(m.type.name)).map((m) => m.toJSON());
            out.addMark(a, b, schema.marks.formatChange.create({ author, date: now(), cid, old }));
            return false;
          });
        }
      }
      if (!out.docChanged) return null;
      if (caret != null) out.setSelection(TextSelection.near(out.doc.resolve(Math.min(caret, out.doc.content.size))));
      return out.setMeta('tcSkip', true);
    },
    props: {
      // While tracking, Backspace / Delete are done here (the browser's own
      // deletion would fight the deleted text being put back).
      handleKeyDown(view, e) {
        if (!o.isOn() || !view.editable) return false;
        if (e.key !== 'Backspace' && e.key !== 'Delete') return false;
        if (e.altKey || (e.metaKey && e.key === 'Delete')) return false;
        // Arrow keys move the DOM selection first: read it in before using the state's.
        view.domObserver?.flush?.();
        const { state } = view;
        const sel = state.selection;
        if (!sel.empty || !(sel instanceof TextSelection)) return false;
        const $p = sel.$from;
        const back = e.key === 'Backspace';
        const text = back ? $p.parent.textBetween(0, $p.parentOffset, null, '\uFFFC') : $p.parent.textBetween($p.parentOffset, $p.parent.content.size, null, '\uFFFC');
        if (!text) return false; // at a paragraph edge: joining is handled by the usual commands
        let len;
        if (e.ctrlKey || e.metaKey) {
          const m = back ? /(\S+\s*|\s+)$/.exec(text) : /^(\s*\S+|\s+)/.exec(text);
          len = m ? m[0].length : 1;
        } else {
          const cp = back ? text.codePointAt(text.length - 1) : text.codePointAt(0);
          len = back && text.length > 1 && cp >= 0xdc00 && cp <= 0xdfff ? 2 : (!back && cp > 0xffff ? 2 : 1);
        }
        // Skip text that is already deleted: move over it instead.
        const from = back ? sel.from - len : sel.from;
        const to = back ? sel.from : sel.from + len;
        let allDeleted = true;
        state.doc.nodesBetween(from, to, (n) => { if (n.isInline && !n.marks.some((m) => m.type.name === 'deletion')) allDeleted = false; return true; });
        if (allDeleted) { view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, back ? from : to)).scrollIntoView()); return true; }
        view.dispatch(state.tr.delete(from, to).scrollIntoView());
        e.preventDefault();
        return true;
      },
      attributes: () => {
        const h = o.hidden?.() || {};
        const cls = [`tc-show-${o.display?.() || 'all'}`];
        if (h.insdel) cls.push('tc-hide-insdel');
        if (h.fmt) cls.push('tc-hide-fmt');
        for (const k of h.authors || []) cls.push(`tc-hide-a${k}`);
        return { class: cls.join(' ') };
      },
    },
  });
}

// ------------------------------------------------------------------ the changes

/**
 * Every change in the document, grouped by change id in document order:
 * [{ cid, type, author, date, ranges: [{from,to}], breaks: [pos of paragraph], from, to, text }]
 */
export function changesOf(doc) {
  const byId = new Map();
  const get = (cid, type, a) => {
    const key = `${type}:${cid}`;
    if (!byId.has(key)) byId.set(key, { cid, type, author: a.author, date: a.date, ranges: [], breaks: [], from: Infinity, to: -1, text: '' });
    return byId.get(key);
  };
  doc.descendants((n, pos) => {
    if (n.isTextblock && n.attrs.change) {
      const c = get(n.attrs.change.cid, n.attrs.change.type, n.attrs.change);
      c.breaks.push(pos);
      const end = pos + n.nodeSize - 1;
      c.from = Math.min(c.from, end);
      c.to = Math.max(c.to, end);
    }
    if (n.isInline) {
      for (const m of n.marks) {
        if (!CHANGE_MARKS.includes(m.type.name)) continue;
        const c = get(m.attrs.cid, m.type.name, m.attrs);
        const last = c.ranges[c.ranges.length - 1];
        if (last && last.to === pos) last.to = pos + n.nodeSize;
        else c.ranges.push({ from: pos, to: pos + n.nodeSize });
        c.from = Math.min(c.from, pos);
        c.to = Math.max(c.to, pos + n.nodeSize);
        if (n.isText && c.text.length < 200) c.text += n.text;
      }
    }
    return true;
  });
  return [...byId.values()].sort((a, b) => a.from - b.from);
}

/** Applies accept (true) or reject (false) to some changes in tr. */
export function resolveChanges(tr, changes, accept) {
  const schema = tr.doc.type.schema;
  // Last first, so earlier positions stay valid.
  const ops = [];
  for (const c of changes) {
    for (const r of c.ranges) ops.push({ c, kind: 'range', from: r.from, to: r.to });
    for (const b of c.breaks) ops.push({ c, kind: 'break', pos: b });
  }
  ops.sort((a, b) => (b.from ?? b.pos) - (a.from ?? a.pos) || (a.kind === 'break' ? -1 : 1));
  for (const op of ops) {
    const { c } = op;
    if (op.kind === 'range') {
      const markType = schema.marks[c.type];
      const remove = (c.type === 'insertion' && !accept) || (c.type === 'deletion' && accept);
      if (remove) {
        tr.delete(op.from, op.to);
        continue;
      }
      if (c.type === 'formatChange' && !accept) {
        // Put the previous formatting back.
        tr.doc.nodesBetween(op.from, op.to, (n, pos) => {
          if (!n.isText) return true;
          const fc = n.marks.find((m) => m.type === markType && m.attrs.cid === c.cid);
          if (!fc) return false;
          const a = Math.max(pos, op.from);
          const b = Math.min(pos + n.nodeSize, op.to);
          for (const name of FORMAT_MARKS) tr.removeMark(a, b, schema.marks[name]);
          for (const mj of fc.attrs.old || []) { try { tr.addMark(a, b, schema.markFromJSON(mj)); } catch { /* unknown mark */ } }
          return false;
        });
      }
      tr.doc.nodesBetween(op.from, op.to, (n, pos) => {
        if (!n.isInline) return true;
        const m = n.marks.find((x) => x.type === markType && x.attrs.cid === c.cid);
        if (m) tr.removeMark(Math.max(pos, op.from), Math.min(pos + n.nodeSize, op.to), m);
        return false;
      });
    } else {
      const node = tr.doc.nodeAt(op.pos);
      if (!node?.isTextblock || node.attrs.change?.cid !== c.cid) continue;
      const join = (c.type === 'insertion' && !accept) || (c.type === 'deletion' && accept);
      tr.setNodeMarkup(op.pos, null, { ...node.attrs, change: null });
      if (join) {
        const end = op.pos + node.nodeSize;
        const $e = tr.doc.resolve(end);
        if ($e.nodeAfter?.isTextblock) {
          try { tr.join(end); } catch { /* not joinable */ }
        }
      }
    }
  }
  return tr;
}

/** The changes at the selection (touching it). */
export function changesAt(state) {
  const { from, to } = state.selection;
  return changesOf(state.doc).filter((c) => c.ranges.some((r) => (from === to ? r.from <= to && r.to >= from : r.from < to && r.to > from)) || c.breaks.some((b) => {
    const end = b + state.doc.nodeAt(b).nodeSize - 1;
    return end >= from && end <= Math.max(to, from);
  }));
}

/** Read-only while viewing (Editing ▾ Viewing, Restrict Editing). */
export function editablePlugin(isEditable) {
  return new Plugin({ props: { editable: () => isEditable() } });
}

/**
 * Reads a pending DOM selection change in before any key is handled (keys
 * pressed quickly after an arrow key could otherwise act on the old caret).
 */
export const flushSelectionPlugin = () => new Plugin({ props: { handleKeyDown(view) { view.domObserver?.flush?.(); return false; } } });
