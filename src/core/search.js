/**
 * Find and replace over the document: plain text (match case, whole words),
 * Word-style wildcards, regular expressions and formatting filters. Matches
 * never cross paragraph boundaries. A plugin highlights all matches and the
 * current one (Navigation pane results).
 */
import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

const OBJ = '￼';

/** Text of a textblock with a map from string offsets to document positions. */
function blockText(node, pos) {
  let text = '';
  const starts = []; // [stringOffset, docPos]
  node.forEach((child, offset) => {
    const p = pos + 1 + offset;
    starts.push([text.length, p]);
    if (child.isText) text += child.text;
    else if (child.type.name === 'tab') text += '\t';
    else if (child.type.name === 'hard_break') text += '\n';
    else text += OBJ;
  });
  return { text, starts };
}

function toPos(starts, i) {
  let lo = 0;
  for (let k = 0; k < starts.length; k++) if (starts[k][0] <= i) lo = k; else break;
  const [o, p] = starts[lo] || [0, 0];
  return p + (i - o);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Word wildcards → a JS regex source. */
export function wildcardToRegex(q) {
  let out = '';
  for (let i = 0; i < q.length; i++) {
    const c = q[i];
    if (c === '\\' && i + 1 < q.length) { out += escapeRe(q[++i]); continue; }
    if (c === '?') out += '.';
    else if (c === '*') out += '[^]*?';
    else if (c === '<') out += '\\b(?=\\w)';
    else if (c === '>') out += '\\b(?<=\\w)';
    else if (c === '@') out += '+';
    else if (c === '[') {
      const j = q.indexOf(']', i);
      if (j < 0) { out += '\\['; continue; }
      let body = q.slice(i + 1, j);
      if (body.startsWith('!')) body = `^${body.slice(1)}`;
      out += `[${body.replace(/\\/g, '\\\\')}]`;
      i = j;
    } else if (c === '{') {
      const j = q.indexOf('}', i);
      if (j < 0) { out += '\\{'; continue; }
      out += `{${q.slice(i + 1, j).replace(/[^\d,]/g, '')}}`;
      i = j;
    } else if (c === '(' || c === ')') out += c;
    else out += escapeRe(c);
  }
  return out;
}

/**
 * Builds a RegExp for the options, or throws for an invalid pattern.
 * @param {{query:string, matchCase?:boolean, wholeWord?:boolean, wildcards?:boolean, regex?:boolean}} o
 */
export function buildRegex(o) {
  let src;
  if (o.regex) src = o.query;
  else if (o.wildcards) src = wildcardToRegex(o.query);
  else src = escapeRe(o.query).replace(/\\\^t|\^t/g, '\\t').replace(/\^p|\^l/g, '\\n');
  if (o.wholeWord && !o.regex) src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`;
  return new RegExp(src, `gu${o.matchCase ? '' : 'i'}`);
}

/**
 * All matches in the document: [{ from, to, text, groups, block }].
 * `filter(marks, node)` optionally restricts by formatting at the match start.
 */
export function findAll(doc, o, filter = null, limit = 10000) {
  if (!o.query) return [];
  const re = buildRegex(o);
  const out = [];
  doc.descendants((node, pos) => {
    if (out.length >= limit) return false;
    if (!node.isTextblock) return true;
    const { text, starts } = blockText(node, pos);
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) && out.length < limit) {
      if (!m[0].length) { re.lastIndex++; continue; }
      const from = toPos(starts, m.index);
      const to = toPos(starts, m.index + m[0].length);
      if (filter) {
        const $p = doc.resolve(Math.min(from + 1, to));
        if (!filter($p.marks(), node)) continue;
      }
      out.push({ from, to, text: m[0], groups: [...m], block: pos, blockText: text, index: m.index });
    }
    return false;
  });
  return out;
}

/** Replacement text: $1 / \1 groups for regex and wildcards, ^& for the match. */
export function replacementFor(match, replace, o) {
  if (o.regex || o.wildcards) {
    return replace.replace(/\\(\d)|\$(\d)|\^&/g, (s, a, b) => (s === '^&' ? match.text : match.groups[Number(a || b)] ?? ''));
  }
  return replace.replace(/\^&/g, match.text).replace(/\^t/g, '\t');
}

/** A context snippet around a match for the results list. */
export function snippet(match, width = 34) {
  const s = match.blockText;
  const a = Math.max(0, match.index - width);
  const b = Math.min(s.length, match.index + match.text.length + width);
  return { before: (a > 0 ? '…' : '') + s.slice(a, match.index), hit: match.text, after: s.slice(match.index + match.text.length, b) + (b < s.length ? '…' : '') };
}

// ------------------------------------------------------------ highlights

export const searchKey = new PluginKey('search');

/** Highlights search matches; meta { matches, current } sets them. */
export function searchPlugin() {
  return new Plugin({
    key: searchKey,
    state: {
      init: () => ({ matches: [], current: -1, decos: DecorationSet.empty }),
      apply(tr, old, _o, state) {
        const meta = tr.getMeta(searchKey);
        if (meta) {
          const decos = meta.matches.slice(0, 5000).map((m, i) => Decoration.inline(m.from, m.to, { class: i === meta.current ? 'odt-find current' : 'odt-find' }));
          return { matches: meta.matches, current: meta.current, decos: DecorationSet.create(state.doc, decos) };
        }
        if (!tr.docChanged || !old.matches.length) return old;
        return { ...old, decos: old.decos.map(tr.mapping, tr.doc), matches: old.matches.map((m) => ({ ...m, from: tr.mapping.map(m.from), to: tr.mapping.map(m.to) })) };
      },
    },
    props: { decorations: (state) => searchKey.getState(state).decos },
  });
}

/** Selects a range and scrolls it into view. */
export function selectRange(view, from, to) {
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)).scrollIntoView());
}
