/**
 * Proofing: spelling (nspell in a worker, en-GB and en-US) and a few
 * grammar checks (repeated words, a sentence starting in lower case, double
 * spaces, a space before punctuation). Problems are decorations: a red wavy
 * underline for spelling, a blue double underline for grammar.
 *
 * Text marked with another language is skipped (no dictionary), as is text
 * marked "Do not check spelling" (fo:language="zxx").
 */
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { loadChunkText } from './chunk-loader.js';

export const proofKey = new PluginKey('proofing');
const WORD = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu;
const ABBREV = new Set(['e.g', 'i.e', 'etc', 'mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'vs', 'cf', 'no', 'fig', 'p', 'pp', 'vol', 'approx', 'jr', 'sr', 'inc', 'ltd', 'co']);

// ------------------------------------------------------------------ speller

let worker = null;
let seq = 0;
const waiting = new Map();
const known = { 'en-GB': new Map(), 'en-US': new Map() }; // word → correct?

function getWorker() {
  if (!worker) {
    const code = loadChunkText('odt-spell');
    if (!code) return null;
    worker = new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
    worker.onmessage = (e) => { const w = waiting.get(e.data.id); if (w) { waiting.delete(e.data.id); w(e.data); } };
  }
  return worker;
}

const ask = (msg) => new Promise((resolve) => {
  const w = getWorker();
  if (!w) { resolve(null); return; }
  const id = ++seq;
  waiting.set(id, resolve);
  w.postMessage({ ...msg, id });
});

const norm = (w) => w.replace(/’/g, "'");

/** Checks words; their results land in the cache. */
export async function checkWords(lang, words) {
  const cache = known[lang] || known['en-GB'];
  const todo = [...new Set(words.map(norm))].filter((w) => !cache.has(w));
  if (!todo.length) return;
  const r = await ask({ type: 'check', lang, words: todo });
  if (!r) return;
  const bad = new Set(r.misspelled);
  for (const w of todo) cache.set(w, !bad.has(w));
}

export async function suggestions(lang, word) {
  const r = await ask({ type: 'suggest', lang, word: norm(word) });
  return r?.suggestions || [];
}

/** Personal dictionary (Add to Dictionary) and Ignore All. */
const personal = new Set();
const ignored = new Set();
export function addToDictionary(words) {
  for (const w of words) { personal.add(norm(w)); for (const c of Object.values(known)) c.set(norm(w), true); }
  getWorker()?.postMessage({ type: 'add', words: words.map(norm) });
}
export const ignoreAll = (w) => ignored.add(norm(w));
export const spellingReady = () => !!getWorker();

// ------------------------------------------------------------------ language

/** The language of a text node: 'en-GB', 'en-US', 'skip' (no checking) or 'other'. */
function langOf(node, para, fallback) {
  const fromAuto = (auto) => auto?.props?.['style:text-properties']?.a;
  let a = null;
  for (const m of node.marks) if (m.type.name === 'textProps') a = fromAuto(m.attrs.auto);
  a = a?.['fo:language'] ? a : fromAuto(para.attrs.auto) || a;
  const l = a?.['fo:language'];
  if (!l) return fallback;
  if (l === 'zxx') return 'skip';
  if (l !== 'en') return 'other';
  return a['fo:country'] === 'US' ? 'en-US' : 'en-GB';
}

// ------------------------------------------------------------------ checking one paragraph

/**
 * Problems in a textblock at pos: [{ from, to, kind: 'spell'|'grammar', word, lang, rule, fix }]
 * (words not yet known to the speller are listed in `unknown`).
 */
export function blockProblems(node, pos, fallback, unknown) {
  const out = [];
  const text = node.textBetween(0, node.content.size, null, '￼');
  // Language per character offset (by text node).
  const langs = [];
  node.forEach((child, off) => {
    const l = child.isText ? (child.marks.some((m) => m.type.name === 'deletion') ? 'skip' : langOf(child, node, fallback)) : 'skip';
    for (let i = 0; i < child.nodeSize; i++) langs[off + i] = l;
  });
  for (const m of text.matchAll(WORD)) {
    const w = m[0];
    const lang = langs[m.index];
    if (lang !== 'en-GB' && lang !== 'en-US') continue;
    if (w.length < 2 || /\d/.test(w)) continue;
    // URLs, e-mail addresses and words glued to digits are left alone.
    const around = text.slice(Math.max(0, m.index - 1), m.index + w.length + 1);
    if (/[@/\\_.]\p{L}|\p{L}[@/\\_]/u.test(around) && /[@/\\_]/.test(around)) continue;
    const n = norm(w);
    if (personal.has(n) || ignored.has(n)) continue;
    const cache = known[lang];
    if (!cache.has(n)) { unknown?.push([lang, n]); continue; }
    if (!cache.get(n)) out.push({ from: pos + 1 + m.index, to: pos + 1 + m.index + w.length, kind: 'spell', word: w, lang });
  }
  // Grammar.
  const g = (index, len, rule, fix) => out.push({ from: pos + 1 + index, to: pos + 1 + index + len, kind: 'grammar', rule, fix, lang: langs[index] });
  for (const m of text.matchAll(/\b([\p{L}]+)(\s+)(\1)\b/giu)) {
    if (langs[m.index] === 'skip') continue;
    g(m.index + m[1].length, m[2].length + m[3].length, 'repeated', '');
  }
  for (const m of text.matchAll(/(?<![\p{L}\p{N}'’])i(?![\p{L}\p{N}'’.])/gu)) { if (langs[m.index] === 'en-GB' || langs[m.index] === 'en-US') g(m.index, 1, 'pronoun', 'I'); }
  for (const m of text.matchAll(/(?<=\S) {2,}(?=\S)/g)) g(m.index, m[0].length, 'spaces', ' ');
  for (const m of text.matchAll(/(?<=\p{L}) +(?=[,.;:!?](?:\s|$))/gu)) g(m.index, m[0].length, 'spaceBefore', '');
  // A sentence that starts in lower case (after . ! ? or at the paragraph start).
  for (const m of text.matchAll(/(?:^|[.!?]["'”’)]?\s+)(\p{Ll}[\p{L}']*)/gu)) {
    const start = m.index + m[0].length - m[1].length;
    if (langs[start] === 'skip') continue;
    const before = text.slice(0, m.index + 1).match(/([\p{L}.]+)\.$/u);
    if (before && ABBREV.has(before[1].toLowerCase())) continue;
    if (m.index > 0 && /\d\.$/.test(text.slice(0, m.index + 1))) continue; // "1. item", "3.5 cm"
    g(start, m[1].length, 'capital', m[1][0].toUpperCase() + m[1].slice(1));
  }
  return out;
}

// ------------------------------------------------------------------ plugin

/**
 * o.enabled() → checking on; o.fallback() → the document's language
 * ('en-GB'); o.onProblems?(list) → after each pass.
 */
export function proofingPlugin(o) {
  return new Plugin({
    key: proofKey,
    state: {
      init: () => ({ decos: DecorationSet.empty, dirty: null, problems: [] }),
      apply(tr, prev, _old, state) {
        const meta = tr.getMeta(proofKey);
        if (meta) return { ...prev, ...meta };
        if (!tr.docChanged) return prev;
        // Paragraphs touched by the change need checking again.
        let dirty = prev.dirty ? prev.dirty.map((r) => [tr.mapping.map(r[0], -1), tr.mapping.map(r[1], 1)]) : [];
        tr.mapping.maps.forEach((map, i) => map.forEach((_a, _b, from, to) => {
          const rest = tr.mapping.slice(i + 1);
          dirty.push([rest.map(from, -1), rest.map(to, 1)]);
        }));
        if (tr.getMeta('load')) dirty = null;
        return { decos: prev.decos.map(tr.mapping, state.doc), dirty: tr.getMeta('load') ? 'all' : dirty, problems: prev.problems };
      },
    },
    props: { decorations: (state) => (o.enabled() ? proofKey.getState(state).decos : DecorationSet.empty) },
    view(view) {
      let timer = 0;
      let running = false;
      const schedule = (delay = 450) => { clearTimeout(timer); timer = setTimeout(run, delay); };
      async function run() {
        if (running) { schedule(200); return; }
        const st = proofKey.getState(view.state);
        if (!o.enabled() || !getWorker()) return;
        running = true;
        try {
          const doc = view.state.doc;
          const all = st.dirty === 'all' || st.dirty == null;
          const ranges = all ? [[0, doc.content.size]] : st.dirty;
          const blocks = [];
          for (const [a, b] of ranges) {
            doc.nodesBetween(Math.max(0, a), Math.min(doc.content.size, b), (n, pos) => {
              if (n.isTextblock) { blocks.push([n, pos]); return false; }
              return true;
            });
          }
          const unknown = [];
          for (const [n, pos] of blocks) blockProblems(n, pos, o.fallback(), unknown);
          const byLang = {};
          for (const [l, w] of unknown) (byLang[l] ??= []).push(w);
          for (const [l, ws] of Object.entries(byLang)) await checkWords(l, ws);
          if (view.state.doc !== doc) { running = false; schedule(150); return; }
          // Rebuild decorations for those paragraphs.
          let decos = proofKey.getState(view.state).decos;
          const caret = view.state.selection.empty && view.hasFocus() ? view.state.selection.from : -1;
          const add = [];
          for (const [n, pos] of blocks) {
            decos = decos.remove(decos.find(pos, pos + n.nodeSize));
            for (const p of blockProblems(n, pos, o.fallback(), null)) {
              // The word being typed isn't marked until you move on.
              if (p.kind === 'spell' && caret >= p.from && caret <= p.to && Date.now() - lastTyping < 1500) continue;
              add.push(Decoration.inline(p.from, p.to, { class: p.kind === 'spell' ? 'sp-err' : 'gr-err', 'data-proof': JSON.stringify(p) }, p));
            }
          }
          decos = all ? DecorationSet.create(doc, add) : decos.add(doc, add);
          const problems = decos.find().map((d) => d.spec);
          view.dispatch(view.state.tr.setMeta(proofKey, { decos, dirty: [], problems }).setMeta('addToHistory', false).setMeta('tcSkip', true).setMeta('pagination', true));
          o.onProblems?.(problems);
        } finally { running = false; }
      }
      let lastTyping = 0;
      const onKey = () => { lastTyping = Date.now(); };
      view.dom.addEventListener('keydown', onKey);
      schedule(300);
      return {
        update(v, prev) {
          const st = proofKey.getState(v.state);
          if (v.state.doc !== prev.doc || (st.dirty === 'all') || o.consumeRefresh?.()) schedule(st.dirty === 'all' ? 50 : 450);
          // Moving off a just-typed word marks it.
          else if (v.state.selection !== prev.selection && Date.now() - lastTyping < 1600) schedule(120);
        },
        destroy() { clearTimeout(timer); view.dom.removeEventListener('keydown', onKey); },
      };
    },
  });
}

/** Forces a full check (after Add to Dictionary, Ignore All, language changes, turning it on). */
export function recheckAll(view) {
  view.dispatch(view.state.tr.setMeta(proofKey, { dirty: 'all' }).setMeta('addToHistory', false).setMeta('tcSkip', true).setMeta('pagination', true));
}

/** The problem under a document position, if any. */
export function problemAt(state, pos) {
  const found = proofKey.getState(state)?.decos.find(pos, pos) || [];
  return found.length ? found[0].spec : null;
}

/** Every current problem in document order. */
export const problemsOf = (state) => (proofKey.getState(state)?.decos.find() || []).map((d) => d.spec).sort((a, b) => a.from - b.from);
