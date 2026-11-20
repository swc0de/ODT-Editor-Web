/**
 * Windows of the app (browser tabs or windows on the same computer) find
 * each other over a BroadcastChannel:
 *
 *   presence   every window announces itself (id, title, document group) and
 *              disappears when it closes — View ▸ Switch Windows lists them;
 *   New Window opens the same document in another window. The windows of a
 *              document form a group whose first window is the authority:
 *              edits travel as ProseMirror steps (prosemirror-collab rebases
 *              concurrent edits), with new pictures and document-level
 *              changes (styles, page setup) carried by the steps;
 *   arranging  Arrange All / View Side by Side ask windows to move and resize
 *              (browsers allow it only for windows the app opened itself);
 *   scrolling  Synchronous Scrolling passes scroll movements to the partner.
 */
import { collab, sendableSteps, receiveTransaction, getVersion } from 'prosemirror-collab';
import { Step } from 'prosemirror-transform';
import { schema } from './schema.js';

const CHANNEL = 'odt-editor-windows';
const HEARTBEAT = 2000;
const STALE = 7000;
export const WINDOW_ID = `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/**
 * o = {
 *   title(): this window's document title,
 *   view(): the main EditorView,
 *   reconfigure(extraPlugins): adds plugins to the editor state,
 *   snapshot(): { json, name } of the current document,
 *   load(json, name): replaces this window's document (when joining),
 *   pictures(): the document's pictures map, addPictures(map),
 *   onChange(): the window list or group changed,
 *   onScroll(dx, dy), onFocusRequest(), onArrange(rect), toast(msg)
 * }
 */
export function createWindowHub(o) {
  const bc = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL) : null;
  const peers = new Map(); // id → { id, title, group, n, seen }
  const refs = new Map(); // id → WindowProxy (windows we opened, and our opener)
  let group = null; // { key, leader, n } while this document is shared
  let auth = null; // the leader's { version }
  let sentPictures = new Set();
  let inFlight = 0;
  let partner = null; // View Side by Side partner id
  const answered = new Map(); // windows sent a snapshot → their number

  const post = (msg) => { try { bc?.postMessage({ ...msg, from: WINDOW_ID }); } catch (e) { console.warn('Window message failed:', e); } };
  const me = () => ({ id: WINDOW_ID, title: o.title(), group: group?.key || null, n: group?.n || 0, leader: !!group && group.leader === WINDOW_ID });
  const announce = (t = 'here') => post({ t, ...me() });

  function list() {
    const now = Date.now();
    for (const [id, p] of peers) if (now - p.seen > STALE) peers.delete(id);
    return [{ ...me(), self: true }, ...[...peers.values()].map((p) => ({ ...p, self: false }))];
  }

  // ------------------------------------------------------------ document groups

  function startGroup() {
    if (group) return group.key;
    group = { key: `g${WINDOW_ID}${Date.now().toString(36)}`, leader: WINDOW_ID, n: 1 };
    auth = { version: 0 };
    sentPictures = new Set(Object.keys(o.pictures() || {}));
    o.reconfigure([collab({ version: 0, clientID: WINDOW_ID })]);
    announce();
    o.onChange?.();
    return group.key;
  }

  /** Leaves the group (another document was opened here, or the window closes). */
  function leaveGroup() {
    if (!group) return;
    post({ t: 'leave', key: group.key });
    group = null;
    auth = null;
    o.reconfigure([], true);
    announce();
    o.onChange?.();
  }

  const groupPeers = () => [...peers.values()].filter((p) => group && p.group === group.key);

  function newPictures() {
    const all = o.pictures() || {};
    const out = {};
    for (const [path, pic] of Object.entries(all)) if (!sentPictures.has(path)) { out[path] = pic; sentPictures.add(path); }
    return Object.keys(out).length ? out : null;
  }

  /** Sends this window's unconfirmed steps (or, as the authority, accepts them). */
  function flush() {
    if (!group) return;
    const view = o.view();
    const s = sendableSteps(view.state);
    if (!s) return;
    if (group.leader === WINDOW_ID) {
      accept(s.version, s.steps, s.clientID, newPictures());
      return;
    }
    if (inFlight && Date.now() - inFlight < 1000) return;
    inFlight = Date.now();
    post({ t: 'submit', key: group.key, version: s.version, steps: s.steps.map((x) => x.toJSON()), clientID: s.clientID, pictures: newPictures() });
  }

  /** The authority accepts steps made at `version` and passes them to everyone. */
  function accept(version, steps, clientID, pictures) {
    if (!auth || version !== auth.version) return false;
    auth.version += steps.length;
    post({ t: 'steps', key: group.key, version: auth.version, steps: steps.map((x) => x.toJSON()), clientIDs: steps.map(() => clientID), pictures });
    apply(steps, steps.map(() => clientID), pictures);
    return true;
  }

  function apply(steps, clientIDs, pictures) {
    if (pictures) { o.addPictures(pictures); for (const k of Object.keys(pictures)) sentPictures.add(k); }
    const view = o.view();
    const tr = receiveTransaction(view.state, steps, clientIDs, { mapSelectionBackward: true });
    view.dispatch(tr.setMeta('remote', true).setMeta('tcSkip', true).setMeta('addToHistory', false));
  }

  // ------------------------------------------------------------ messages

  bc?.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || m.from === WINDOW_ID) return;
    if (m.to && m.to !== WINDOW_ID && !(m.t === 'focus' && refs.has(m.to))) return;
    switch (m.t) {
      case 'hello': peers.set(m.id, { id: m.id, title: m.title, group: m.group, n: m.n, leader: m.leader, seen: Date.now() }); announce(); o.onChange?.(); break;
      case 'here': {
        const known = peers.get(m.id);
        peers.set(m.id, { id: m.id, title: m.title, group: m.group, n: m.n, leader: m.leader, seen: Date.now() });
        if (!known || known.title !== m.title || known.group !== m.group) o.onChange?.();
        break;
      }
      case 'bye': case 'leave': {
        const was = peers.get(m.from);
        if (m.t === 'bye') peers.delete(m.from); else if (was) peers.set(m.from, { ...was, group: null });
        if (partner === m.from) { partner = null; o.onPartner?.(null); }
        // The authority left: the remaining window with the lowest number takes over.
        if (group && was?.group === group.key && group.leader === m.from) {
          const rest = [me(), ...groupPeers()].sort((a, b) => a.n - b.n);
          group.leader = rest[0].id;
          if (group.leader === WINDOW_ID) { auth = { version: getVersion(o.view().state) }; }
          inFlight = 0;
          if (rest.length === 1) leaveGroup(); else flush();
        }
        o.onChange?.();
        break;
      }
      case 'join': {
        if (!group || group.key !== m.key || group.leader !== WINDOW_ID) break;
        // A repeated request from a window that already joined.
        if (groupPeers().some((p) => p.id === m.from)) break;
        const n = Math.max(group.n, ...groupPeers().map((p) => p.n), ...[...answered.values()]) + 1;
        if (answered.has(m.from)) break;
        answered.set(m.from, n);
        const snap = o.snapshot();
        post({ t: 'snapshot', to: m.from, key: group.key, json: snap.json, name: snap.name, version: auth.version, n, leader: WINDOW_ID });
        break;
      }
      case 'snapshot': {
        if (!pendingJoin || m.key !== pendingJoin.key) break;
        const done = pendingJoin.resolve;
        pendingJoin = null;
        group = { key: m.key, leader: m.leader, n: m.n };
        o.load(m.json, m.name);
        sentPictures = new Set(Object.keys(o.pictures() || {}));
        o.reconfigure([collab({ version: m.version, clientID: WINDOW_ID })]);
        announce();
        o.onChange?.();
        done(true);
        break;
      }
      case 'submit':
        if (group?.key === m.key && group.leader === WINDOW_ID) accept(m.version, m.steps.map((j) => Step.fromJSON(schema, j)), m.clientID, m.pictures);
        break;
      case 'steps': {
        if (group?.key !== m.key) break;
        const steps = m.steps.map((j) => Step.fromJSON(schema, j));
        if (getVersion(o.view().state) !== m.version - steps.length) break; // already have them
        inFlight = 0;
        apply(steps, m.clientIDs, m.pictures);
        flush();
        break;
      }
      case 'focus': {
        if (m.to === WINDOW_ID) o.onFocusRequest?.();
        else { try { refs.get(m.to)?.focus(); } catch { /* closed */ } }
        break;
      }
      case 'arrange': o.onArrange?.(m.rect); break;
      case 'scroll': if (partner === m.from && o.syncScroll?.()) o.onScroll?.(m.dx, m.dy); break;
      case 'pair': partner = m.on ? m.from : null; o.onPartner?.(partner); break;
      default: break;
    }
  });

  let pendingJoin = null;
  /** Joins the group `key` (this window was opened by New Window). */
  function join(key) {
    return new Promise((resolve) => {
      pendingJoin = { key, resolve };
      // Ask again while waiting (the other window may be busy); give up after 15 s.
      const started = Date.now();
      const ask = () => {
        if (pendingJoin?.key !== key) return;
        if (Date.now() - started > 15000) { pendingJoin = null; resolve(false); return; }
        post({ t: 'join', key });
        setTimeout(ask, 1500);
      };
      ask();
    });
  }

  announce('hello');
  const beat = setInterval(() => announce(), HEARTBEAT);
  addEventListener('pagehide', () => { clearInterval(beat); post({ t: 'bye' }); });

  return {
    list,
    get group() { return group; },
    get partner() { return partner; },
    isLeader: () => !!group && group.leader === WINDOW_ID,
    startGroup,
    leaveGroup,
    join,
    flush,
    announce,
    addRef: (id, ref) => refs.set(id, ref),
    hasRef: (id) => refs.has(id),
    focus(id) {
      if (id === WINDOW_ID) { window.focus(); return; }
      const ref = refs.get(id);
      if (ref && !ref.closed) { try { ref.focus(); return; } catch { /* fall through */ } }
      post({ t: 'focus', to: id });
    },
    arrange(id, rect) { post({ t: 'arrange', to: id, rect }); },
    pair(id, on) { partner = on ? id : null; post({ t: 'pair', to: id, on }); o.onPartner?.(partner); },
    scroll(dx, dy) { if (partner) post({ t: 'scroll', to: partner, dx, dy }); },
    close: () => { clearInterval(beat); post({ t: 'bye' }); bc?.close(); },
  };
}
