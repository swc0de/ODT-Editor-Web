/**
 * Comment balloons in the margin to the right of the pages, each beside the
 * line its comment is anchored to (pushed down so they don't overlap), with
 * a line to the anchor for the active one. A card shows the comment and its
 * replies (each editable in place), Reply, Resolve / Reopen and a ⋯ menu.
 * The same cards are listed in the Comments pane in List view.
 */
import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { schema, authorKey } from '../core/schema.js';
import { threadsOf, newComment, deleteThread, isResolved } from '../core/comments.js';

export const commentsKey = new PluginKey('comments');
const GAP = 8;
const keyOf = (node, pos) => node.attrs.name || `@${pos}`;

const when = (d) => {
  if (!d) return '';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  const today = new Date();
  return dt.toDateString() === today.toDateString()
    ? dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

/**
 * o: { layer (element in the page stack), getView, getZoom, origin(), pageRight(pos),
 *      createNested, user() → { author, initials }, t, isShown(), openMenu, onChange }
 */
export function createCommentsLayer(o) {
  const cards = new Map(); // thread key → { el, entries: Map(key → { el, editor }) }
  let active = null; // thread key
  let listHost = null; // the Comments pane's list, in List view
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'cmt-lines');
  o.layer.append(svg);

  const view = () => o.getView();
  const find = (key) => {
    let found = null;
    view().state.doc.descendants((n, pos) => { if (found) return false; if (n.type.name === 'annotation' && keyOf(n, pos) === key) found = { node: n, pos }; return true; });
    return found;
  };
  const dispatch = (tr) => view().dispatch(tr.setMeta('tcSkip', true));

  /** Adapter for a nested editor of one comment's text. */
  function adapter(key) {
    return {
      isNote: true,
      defaultStyle: 'Standard',
      get label() { return o.t('cmt.text'); },
      get node() { return find(key)?.node || schema.nodes.annotation.create(); },
      getPos: () => find(key)?.pos ?? null,
      setAttrs(attrs) { const f = find(key); if (f) dispatch(view().state.tr.setNodeMarkup(f.pos, null, attrs).setMeta('commentEdit', true)); },
    };
  }

  function entryEl(node, pos, rec) {
    const key = keyOf(node, pos);
    let e = rec.entries.get(key);
    if (!e) {
      const mount = document.createElement('div');
      mount.className = 'cmt-text';
      const avatar = document.createElement('span');
      avatar.className = 'cmt-avatar';
      const who = document.createElement('span');
      who.className = 'cmt-who';
      const date = document.createElement('span');
      date.className = 'cmt-date';
      const head = document.createElement('div');
      head.className = 'cmt-head';
      head.append(avatar, who, date);
      const el = document.createElement('div');
      el.className = 'cmt-entry';
      el.append(head, mount);
      const editor = o.createNested(mount, adapter(key));
      editor.view.dom.addEventListener('focus', () => setActive(rec.key));
      e = { el, editor, avatar, who, date };
      rec.entries.set(key, e);
    } else if (!e.editor.view.hasFocus()) e.editor.sync(node.attrs.body);
    e.avatar.textContent = node.attrs.initials || (node.attrs.creator || '?').slice(0, 1).toUpperCase();
    e.avatar.dataset.author = authorKey(node.attrs.creator);
    e.who.textContent = node.attrs.creator || o.t('rvp.unknown');
    e.date.textContent = when(node.attrs.date);
    e.date.title = node.attrs.date || '';
    e.used = true;
    return e.el;
  }

  function cardFor(thread) {
    const key = keyOf(thread.node, thread.pos);
    let rec = cards.get(key);
    if (!rec) {
      const el = document.createElement('div');
      el.className = 'cmt-card';
      el.dataset.key = key;
      el.tabIndex = -1;
      el.setAttribute('role', 'group');
      const list = document.createElement('div');
      list.className = 'cmt-entries';
      const actions = document.createElement('div');
      actions.className = 'cmt-actions';
      const reply = document.createElement('button');
      reply.type = 'button';
      reply.className = 'cmt-reply';
      reply.textContent = o.t('cmt.reply');
      reply.addEventListener('click', () => addReply(key));
      const resolve = document.createElement('button');
      resolve.type = 'button';
      resolve.className = 'cmt-resolve';
      resolve.addEventListener('click', () => toggleResolved(key));
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'cmt-more';
      more.setAttribute('aria-label', o.t('cmt.more'));
      more.textContent = '⋯';
      more.addEventListener('click', () => o.openMenu(more, [
        { label: o.t('cmt.delete'), run: () => removeThread(key) },
        { label: o.t(isResolved(find(key)?.node || thread.node) ? 'cmt.reopen' : 'cmt.resolve'), run: () => toggleResolved(key) },
      ]));
      actions.append(reply, resolve, more);
      el.append(list, actions);
      el.addEventListener('mousedown', () => setActive(key));
      rec = { key, el, list, resolve, entries: new Map() };
      cards.set(key, rec);
    }
    for (const e of rec.entries.values()) e.used = false;
    const els = [entryEl(thread.node, thread.pos, rec), ...thread.replies.map((r) => entryEl(r.node, r.pos, rec))];
    const kids = [...rec.list.children];
    if (kids.length !== els.length || kids.some((k, i) => k !== els[i])) rec.list.replaceChildren(...els);
    for (const [k, e] of rec.entries) if (!e.used) { e.editor.destroy(); rec.entries.delete(k); }
    rec.el.classList.toggle('is-resolved', thread.resolved);
    rec.el.dataset.author = authorKey(thread.node.attrs.creator);
    rec.resolve.textContent = o.t(thread.resolved ? 'cmt.reopen' : 'cmt.resolve');
    rec.used = true;
    return rec;
  }

  // ------------------------------------------------------------ actions

  function addReply(threadKey) {
    const f = find(threadKey);
    if (!f) return;
    const thread = threadsOf(view().state.doc).find((t) => keyOf(t.node, t.pos) === threadKey);
    const after = thread.replies.length ? thread.replies[thread.replies.length - 1] : thread;
    const at = after.pos + after.node.nodeSize;
    const u = o.user();
    const node = newComment(view().state.doc, { author: u.author, initials: u.initials, parent: f.node.attrs.name });
    dispatch(view().state.tr.insert(at, node));
    o.onChange?.();
    requestAnimationFrame(() => focusEntry(threadKey, node.attrs.name));
  }

  function toggleResolved(threadKey) {
    const f = find(threadKey);
    if (!f) return;
    const extra = { ...(f.node.attrs.extra || {}), 'loext:resolved': isResolved(f.node) ? 'false' : 'true' };
    dispatch(view().state.tr.setNodeMarkup(f.pos, null, { ...f.node.attrs, extra }));
  }

  function removeThread(threadKey) {
    const thread = threadsOf(view().state.doc).find((t) => keyOf(t.node, t.pos) === threadKey);
    if (!thread) return;
    dispatch(deleteThread(view().state.tr, thread));
    view().focus();
  }

  /** Focuses a comment's text (threadKey, and an entry key for a reply). */
  function focusEntry(threadKey, entryKey = threadKey) {
    const rec = cards.get(threadKey);
    const e = rec?.entries.get(entryKey);
    if (!e) return false;
    setActive(threadKey);
    rec.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    e.editor.focus();
    return true;
  }

  function setActive(key) {
    if (active === key) return;
    active = key;
    for (const [k, r] of cards) r.el.classList.toggle('is-active', k === key);
    const v = view();
    v.dispatch(v.state.tr.setMeta(commentsKey, { active: key }).setMeta('addToHistory', false).setMeta('tcSkip', true));
    drawLine();
  }

  // ------------------------------------------------------------ layout

  let placed = []; // [{ key, y, top (card), anchor: { x, y } }]

  /** Lays the cards out beside their anchors (or lists them in the pane). */
  function render() {
    renderInner();
    o.onCount?.(view() ? threadsOf(view().state.doc).length : 0);
  }

  function renderInner() {
    const v = view();
    if (!v) return;
    const threads = threadsOf(v.state.doc);
    for (const r of cards.values()) r.used = false;
    const recs = threads.map((t) => ({ t, rec: cardFor(t) }));
    for (const [k, r] of cards) if (!r.used) { for (const e of r.entries.values()) e.editor.destroy(); r.el.remove(); cards.delete(k); }
    const shown = o.isShown();
    if (listHost) {
      // List view: the pane holds the cards.
      o.layer.hidden = true;
      const els = recs.map((x) => x.rec.el);
      for (const el of els) { el.style.top = ''; el.style.left = ''; }
      const kids = [...listHost.children];
      if (kids.length !== els.length || kids.some((k, i) => k !== els[i])) listHost.replaceChildren(...els);
      placed = [];
      drawLine();
      return;
    }
    o.layer.hidden = !shown || !threads.length;
    if (o.layer.hidden) { placed = []; drawLine(); return; }
    const z = o.getZoom() || 1;
    const top0 = o.origin().getBoundingClientRect().top;
    const left0 = o.origin().getBoundingClientRect().left;
    let bottom = -Infinity;
    placed = [];
    for (const { t, rec } of recs) {
      let c;
      try { c = v.coordsAtPos(Math.min(t.pos + 1, v.state.doc.content.size)); } catch { c = null; }
      if (!c) continue;
      const anchorY = (c.top - top0) / z;
      const anchorX = (c.left - left0) / z;
      const x = o.pageRight(t.pos) + 18;
      const y = Math.max(anchorY - 6, bottom + GAP);
      rec.el.style.left = `${x}px`;
      rec.el.style.top = `${y}px`;
      if (rec.el.parentNode !== o.layer) o.layer.append(rec.el);
      bottom = y + rec.el.offsetHeight;
      placed.push({ key: rec.key, y, x, anchor: { x: anchorX, y: (c.bottom - top0) / z }, pageRight: o.pageRight(t.pos) });
    }
    drawLine();
  }

  function drawLine() {
    svg.replaceChildren();
    const p = placed.find((x) => x.key === active);
    if (!p) return;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    line.setAttribute('points', `${p.anchor.x},${p.anchor.y} ${p.pageRight},${p.anchor.y} ${p.x},${p.y + 14}`);
    line.setAttribute('class', 'cmt-line');
    svg.append(line);
  }

  /** The thread around the caret becomes the active one. */
  function onSelection(state) {
    if (document.activeElement?.closest?.('.cmt-card')) return;
    const pos = state.selection.from;
    let key = null;
    for (const t of threadsOf(state.doc)) {
      const to = t.end ?? t.pos + 1;
      if (pos >= t.pos && pos <= to) key = keyOf(t.node, t.pos);
    }
    if (key !== active) setActive(key);
  }

  /** Range highlights; the active thread's is stronger. */
  const plugin = new Plugin({
    key: commentsKey,
    state: {
      init: () => ({ active: null }),
      apply: (tr, prev) => tr.getMeta(commentsKey) || prev,
    },
    props: {
      decorations(state) {
        const decos = [];
        const act = commentsKey.getState(state)?.active;
        for (const t of threadsOf(state.doc)) {
          if (t.end == null || t.end <= t.pos + 1) continue;
          decos.push(Decoration.inline(t.pos + 1, t.end, { class: `cmt-range${keyOf(t.node, t.pos) === act ? ' is-active' : ''}${t.resolved ? ' is-resolved' : ''}`, 'data-author': authorKey(t.node.attrs.creator) }));
        }
        return DecorationSet.create(state.doc, decos);
      },
      handleClickOn(_v, _pos, node, nodePos) {
        if (node.type.name !== 'annotation') return false;
        const t = threadsOf(view().state.doc).find((x) => x.pos === nodePos || x.replies.some((r) => r.pos === nodePos));
        if (t) focusEntry(keyOf(t.node, t.pos));
        return !!t;
      },
    },
  });

  return {
    plugin,
    render,
    onSelection,
    focusEntry,
    addReply,
    removeThread,
    toggleResolved,
    keyOf,
    get active() { return active; },
    setListHost(el) { listHost = el; if (!el) for (const r of cards.values()) o.layer.append(r.el); render(); },
    /** Inserts a new comment on the selection and focuses it. */
    insert() {
      const v = view();
      const { from, to, empty } = v.state.selection;
      const u = o.user();
      const node = newComment(v.state.doc, { author: u.author, initials: u.initials });
      const tr = v.state.tr;
      if (!empty) tr.insert(to, schema.nodes.annotation_end.create({ name: node.attrs.name }));
      tr.insert(from, node);
      tr.setSelection(TextSelection.create(tr.doc, from + 1));
      dispatch(tr.scrollIntoView());
      o.onChange?.();
      const key = node.attrs.name;
      const tryFocus = (n = 0) => { if (!focusEntry(key, key) && n < 20) requestAnimationFrame(() => tryFocus(n + 1)); };
      requestAnimationFrame(() => tryFocus());
      return key;
    },
  };
}
