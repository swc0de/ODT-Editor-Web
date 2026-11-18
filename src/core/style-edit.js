/**
 * Editing the document's named styles (office:styles in styles.xml): add
 * missing built-in styles, create from formatting, modify, update to match,
 * delete. Inheritance (parent-style-name) and next-style are kept as ODF.
 * Callers re-render the document afterwards.
 */
import { createBlankState } from './document.js';
import { autoFromTree, mergeAuto, treeFromAuto } from './odt/styles.js';
import { treeToXml } from './odt/xml.js';

let defaults = null;
function defaultStyles() {
  if (!defaults) {
    defaults = new Map();
    for (const t of createBlankState().commonStyles.c || []) {
      if (typeof t === 'string') continue;
      const name = t.a?.['style:name'];
      if (name) defaults.set(`${t.n === 'style:style' ? t.a['style:family'] : t.n}:${name}`, t);
    }
  }
  return defaults;
}

/** ODF style names encode characters other than letters/digits as _XX_ (hex). */
export function encodeStyleName(display) {
  return [...display].map((ch) => (/[A-Za-z0-9]/.test(ch) ? ch : `_${ch.codePointAt(0).toString(16)}_`)).join('');
}

export function findStyle(docState, family, name) {
  return (docState.commonStyles?.c || []).find((t) => typeof t !== 'string' && t.n === (family === 'list' ? 'text:list-style' : 'style:style') && t.a?.['style:name'] === name && (family === 'list' || t.a['style:family'] === family)) || null;
}

/** Adds built-in styles (and their parents) the document doesn't define. Returns true if anything was added. */
export function ensureStyles(docState, family, names) {
  const add = [];
  const queue = [...names];
  while (queue.length) {
    const n = queue.pop();
    if (!n || findStyle(docState, family, n) || add.some((t) => t.a['style:name'] === n)) continue;
    const t = defaultStyles().get(`${family === 'list' ? 'text:list-style' : family}:${n}`);
    if (!t) continue;
    add.push(structuredClone(t));
    if (t.a['style:parent-style-name']) queue.push(t.a['style:parent-style-name']);
  }
  if (!add.length) return false;
  docState.commonStyles = { ...docState.commonStyles, c: [...(docState.commonStyles.c || []), ...add] };
  return true;
}

function replaceStyle(docState, oldTree, newTree) {
  docState.commonStyles = { ...docState.commonStyles, c: docState.commonStyles.c.map((t) => (t === oldTree ? newTree : t)) };
}

/** Replaces a style's formatting with `auto` (properties), keeping identity, parent and next. */
export function setStyleFormatting(docState, family, name, auto, meta = {}) {
  const old = findStyle(docState, family, name);
  if (!old) return false;
  const { parent } = autoFromTree(old);
  const keep = {};
  for (const k of ['style:display-name', 'style:next-style-name', 'style:class', 'style:default-outline-level', 'style:list-style-name', 'style:master-page-name']) if (old.a[k]) keep[k] = old.a[k];
  const tree = treeFromAuto(name, family, meta.parent !== undefined ? meta.parent : parent, { styleAttrs: { ...(auto?.styleAttrs || {}), ...keep }, props: auto?.props || {} });
  if (meta.displayName) tree.a['style:display-name'] = meta.displayName;
  if (meta.next !== undefined) { if (meta.next) tree.a['style:next-style-name'] = meta.next; else delete tree.a['style:next-style-name']; }
  replaceStyle(docState, old, tree);
  return true;
}

/** The style's own (not inherited) formatting as an auto object. */
export const ownFormatting = (docState, family, name) => {
  const t = findStyle(docState, family, name);
  return t ? autoFromTree(t).auto : null;
};

/** Update to Match Selection: merges direct formatting into the style. */
export function updateStyleToMatch(docState, family, name, directAuto) {
  const own = ownFormatting(docState, family, name);
  return setStyleFormatting(docState, family, name, mergeAuto(own, directAuto));
}

/** Creates a new style; returns its internal name. */
export function createStyle(docState, { displayName, family, parent, next, auto, outlineLevel }) {
  let name = encodeStyleName(displayName.trim() || 'Style');
  let i = 1;
  while (findStyle(docState, family, name)) name = `${encodeStyleName(displayName.trim())}_${++i}`;
  const styleAttrs = { ...(auto?.styleAttrs || {}) };
  delete styleAttrs['style:master-page-name'];
  const tree = treeFromAuto(name, family, parent || null, { styleAttrs, props: auto?.props || {} });
  if (displayName.trim() !== name) tree.a['style:display-name'] = displayName.trim();
  if (next) tree.a['style:next-style-name'] = next;
  if (outlineLevel) tree.a['style:default-outline-level'] = String(outlineLevel);
  if (family === 'paragraph') tree.a['style:class'] = 'text';
  docState.commonStyles = { ...docState.commonStyles, c: [...(docState.commonStyles.c || []), tree] };
  return name;
}

/** Deletes a style; children re-parent to its parent. Built-in (default) styles can't be deleted. */
export function deleteStyle(docState, family, name) {
  if (defaultStyles().has(`${family}:${name}`) || name === 'Standard') return false;
  const t = findStyle(docState, family, name);
  if (!t) return false;
  const parent = t.a['style:parent-style-name'] || null;
  docState.commonStyles = {
    ...docState.commonStyles,
    c: docState.commonStyles.c.filter((x) => x !== t).map((x) => {
      if (typeof x === 'string' || x.a?.['style:parent-style-name'] !== name || x.a['style:family'] !== family) return x;
      const a = { ...x.a };
      if (parent) a['style:parent-style-name'] = parent; else delete a['style:parent-style-name'];
      return { ...x, a };
    }),
  };
  return parent || (family === 'paragraph' ? 'Standard' : null);
}

export const isBuiltIn = (family, name) => name === 'Standard' || defaultStyles().has(`${family}:${name}`);
export { treeToXml };
