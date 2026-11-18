/**
 * Automatic hyphenation with the bundled en-GB Liang patterns (the `hyphen`
 * package, ISC): in paragraphs whose effective text properties have
 * fo:hyphenate="true", soft hyphens are added as widgets at the break points
 * of long words, so lines break like LibreOffice's hyphenation. The text
 * itself is unchanged. Only edited paragraphs are recomputed.
 */
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import hyphenator from 'hyphen/en-gb';
import { mergeAuto } from '../core/odt/styles.js';

export const hyphenKey = new PluginKey('hyphenation');
const SHY = '­';
const MIN_WORD = 6;
const cache = new Map();

function breaks(word) {
  let b = cache.get(word);
  if (b) return b;
  const parts = hyphenator.hyphenateSync(word, { hyphenChar: SHY }).split(SHY);
  b = [];
  let i = 0;
  for (let j = 0; j < parts.length - 1; j++) { i += parts[j].length; if (i >= 2 && word.length - i >= 2) b.push(i); }
  if (cache.size > 20000) cache.clear();
  cache.set(word, b);
  return b;
}

const shy = () => {
  const el = document.createElement('span');
  el.className = 'odt-shy';
  el.textContent = SHY;
  return el;
};

function decosFor(doc, from, to, wants, caps, out) {
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true;
    if (!wants(node)) return false;
    node.forEach((child, offset) => {
      if (!child.isText) return;
      const base = pos + 1 + offset;
      for (const m of child.text.matchAll(/\p{L}+/gu)) {
        const w = m[0];
        if (w.length < MIN_WORD || (!caps && w === w.toUpperCase())) continue;
        for (const b of breaks(w.toLowerCase())) out.push(Decoration.widget(base + m.index + b, shy, { side: -1, key: 'shy', ignoreSelection: true, marks: [] }));
      }
    });
    return false;
  });
  return out;
}

/** getConfig() → { index, caps } where index is the style index. */
export function hyphenationPlugin(getConfig) {
  const wantsFor = () => {
    const { index } = getConfig();
    const memo = new Map();
    return (node) => {
      const key = `${node.attrs.styleName}|${node.attrs.auto ? JSON.stringify(node.attrs.auto.props?.['style:text-properties'] || '') : ''}`;
      if (memo.has(key)) return memo.get(key);
      const auto = mergeAuto(index?.effective('paragraph', node.attrs.styleName) || null, node.attrs.auto);
      const v = auto?.props?.['style:text-properties']?.a?.['fo:hyphenate'] === 'true';
      memo.set(key, v);
      return v;
    };
  };
  return new Plugin({
    key: hyphenKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, old, _o, state) {
        if (tr.getMeta(hyphenKey)) return DecorationSet.create(state.doc, decosFor(state.doc, 0, state.doc.content.size, wantsFor(), getConfig().caps, []));
        if (!tr.docChanged) return old;
        let decos = old.map(tr.mapping, tr.doc);
        const wants = wantsFor();
        tr.steps.forEach((step, i) => step.getMap().forEach((_a, _b, from, to) => {
          const m = tr.mapping.slice(i + 1);
          let a = Math.max(0, Math.min(m.map(from, -1), tr.doc.content.size));
          let b = Math.max(a, Math.min(m.map(to, 1), tr.doc.content.size));
          const $a = tr.doc.resolve(a);
          const $b = tr.doc.resolve(b);
          a = $a.depth ? $a.start($a.depth) : a;
          b = $b.depth ? $b.end($b.depth) : b;
          decos = decos.remove(decos.find(a, b)).add(tr.doc, decosFor(tr.doc, a, b, wants, getConfig().caps, []));
        }));
        return decos;
      },
    },
    props: { decorations: (state) => hyphenKey.getState(state) },
  });
}
