/**
 * The alphabetical index. Entries are marked in the text with
 * text:alphabetical-index-mark (a point; string-value = the entry, key1 /
 * key2 = the main entries above it) or a start/end pair around the indexed
 * text. Insert Index builds a text:alphabetical-index whose body lists the
 * entries alphabetically with their page numbers.
 */
import { schema } from './schema.js';

export const MARK = 'text:alphabetical-index-mark';
export const INDEX_DEFAULTS = { columns: 2, rightAlign: false, leader: '.', headings: false, combine: true };

/** Index entries in the body: [{ levels: ['Main', 'Sub'], pos }]. */
export function indexEntries(doc) {
  const out = [];
  const open = new Map();
  doc.descendants((n, pos) => {
    if (n.type.name === 'index') return false;
    if (n.type.name !== 'field') return true;
    const el = n.attrs.element;
    const a = n.attrs.fieldAttrs || {};
    const keys = [a['text:key1'], a['text:key2']].filter(Boolean);
    if (el === MARK && a['text:string-value']) out.push({ levels: [...keys, a['text:string-value']], pos });
    else if (el === `${MARK}-start`) open.set(a['text:id'], { keys, pos, sv: a['text:string-value'] });
    else if (el === `${MARK}-end` && open.has(a['text:id'])) {
      const st = open.get(a['text:id']);
      open.delete(a['text:id']);
      const text = (st.sv || doc.textBetween(st.pos + 1, pos, ' ')).trim();
      if (text) out.push({ levels: [...st.keys, text], pos: st.pos });
    }
    return false;
  });
  return out;
}

/** The text:alphabetical-index-source for options. */
export function indexSource(o) {
  const tpl = (lv) => {
    const c = [{ n: 'text:index-entry-text', a: {} }];
    if (o.rightAlign) c.push({ n: 'text:index-entry-tab-stop', a: { 'style:type': 'right', ...(o.leader ? { 'style:leader-char': o.leader } : {}) } });
    else c.push({ n: 'text:index-entry-span', a: {}, c: [', '] });
    c.push({ n: 'text:index-entry-page-number', a: {} });
    return { n: 'text:alphabetical-index-entry-template', a: { 'text:outline-level': String(lv), 'text:style-name': `Index_20_${lv}` }, c };
  };
  return {
    n: 'text:alphabetical-index-source',
    a: { 'text:ignore-case': 'true', 'text:alphabetical-separators': o.headings ? 'true' : 'false', 'text:combine-entries': 'true', 'text:use-keys-as-entries': 'true', 'fo:language': 'en', 'fo:country': 'GB' },
    c: [
      { n: 'text:index-title-template', a: { 'text:style-name': 'Index_20_Heading' } },
      { n: 'text:alphabetical-index-entry-template', a: { 'text:outline-level': 'separator', 'text:style-name': 'Index_20_Separator' }, c: [{ n: 'text:index-entry-text', a: {} }] },
      tpl(1), tpl(2), tpl(3),
    ],
  };
}

/** Options read back from an index's source. */
export function indexOptions(source, columns = INDEX_DEFAULTS.columns) {
  const o = { ...INDEX_DEFAULTS, columns };
  if (!source) return o;
  o.headings = source.a?.['text:alphabetical-separators'] === 'true';
  const tpl = (source.c || []).find((x) => x.n === 'text:alphabetical-index-entry-template' && x.a['text:outline-level'] === '1');
  const tab = (tpl?.c || []).find((x) => x.n === 'text:index-entry-tab-stop');
  o.rightAlign = !!tab;
  o.leader = tab ? (tab.a['style:leader-char'] ?? '') : '.';
  return o;
}

const collator = typeof Intl !== 'undefined' ? new Intl.Collator('en-GB', { sensitivity: 'base', numeric: true }) : null;
const cmp = (a, b) => (collator ? collator.compare(a, b) : a.localeCompare(b));

/** Block JSON-free body of an index: paragraph nodes. pageOf(pos) → number string. */
export function indexBody(doc, o, pageOf, emptyText) {
  // Tree: level-1 entries → their pages and sub-entries.
  const root = new Map();
  for (const e of indexEntries(doc)) {
    let level = root;
    let node = null;
    e.levels.slice(0, 3).forEach((name) => {
      const key = name.toLowerCase();
      if (!level.has(key)) level.set(key, { name, pages: new Set(), kids: new Map() });
      node = level.get(key);
      level = node.kids;
    });
    const p = Number(pageOf(e.pos));
    node.pages.add(Number.isFinite(p) ? p : pageOf(e.pos));
  }
  const blocks = [];
  let letter = null;
  const emit = (map, depth) => {
    for (const n of [...map.values()].sort((a, b) => cmp(a.name, b.name))) {
      if (depth === 1 && o.headings) {
        const l = n.name.charAt(0).toUpperCase();
        if (l !== letter) { letter = l; blocks.push(schema.nodes.paragraph.create({ styleName: 'Index_20_Separator' }, schema.text(/\p{L}/u.test(l) ? l : '#'))); }
      }
      const pages = [...n.pages].sort((a, b) => a - b).join(', ');
      const content = [schema.text(n.name)];
      if (pages) {
        if (o.rightAlign) content.push(schema.nodes.tab.create());
        else content.push(schema.text(', '));
        content.push(schema.text(pages));
      }
      blocks.push(schema.nodes.paragraph.create({ styleName: `Index_20_${depth}` }, content));
      emit(n.kids, depth + 1);
    }
  };
  emit(root, 1);
  if (!blocks.length) blocks.push(schema.nodes.paragraph.create({ styleName: 'Index_20_1' }, schema.text(emptyText)));
  return blocks;
}

/** A point index mark. */
export function indexMark(main, sub = '') {
  const fieldAttrs = sub ? { 'text:string-value': sub, 'text:key1': main } : { 'text:string-value': main };
  return schema.nodes.field.create({ element: MARK, fieldAttrs, text: '' });
}
