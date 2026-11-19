/**
 * Insert ▸ Links, Text and Pages: hyperlinks (Ctrl+K, Ctrl+click to follow),
 * bookmarks, Quick Parts (AutoText, document properties, fields), signature
 * line, Text from File, cover pages and Blank Page.
 */
import { TextSelection, NodeSelection, Plugin } from 'prosemirror-state';
import { Fragment, Slice } from 'prosemirror-model';
import { schema } from '../../core/schema.js';
import { linkDialog, bookmarkDialog, fieldDialog, signatureDialog, autoTextNameDialog } from '../../ui/insert-dialogs.js';
import { fields, insertInline } from '../headerfooter/actions.js';
import { getSetting, setSetting } from '../../core/settings.js';
import { documentStats } from '../../core/document.js';
import { importOdt } from '../../core/odt/import.js';

const LINK = schema.marks.link;

// ------------------------------------------------------------ hyperlinks

/** The link mark around pos and its range in the textblock, or null. */
export function linkAt(state, pos = state.selection.from) {
  const $p = state.doc.resolve(pos);
  const parent = $p.parent;
  if (!parent.isTextblock) return null;
  const start = $p.start();
  let mark = null;
  let from = -1;
  let to = -1;
  const idx = $p.parentOffset;
  // Children with the same link mark around the position form the link.
  const kids = [];
  parent.forEach((n, off) => kids.push({ n, off }));
  const at = kids.findIndex(({ n, off }) => idx >= off && idx <= off + n.nodeSize && LINK.isInSet(n.marks));
  if (at < 0) return null;
  mark = LINK.isInSet(kids[at].n.marks);
  const same = (k) => { const m = LINK.isInSet(kids[k].n.marks); return !!m && m.eq(mark); };
  let i = at;
  while (i > 0 && same(i - 1)) i--;
  let j = at;
  while (j < kids.length - 1 && same(j + 1)) j++;
  from = start + kids[i].off;
  to = start + kids[j].off + kids[j].n.nodeSize;
  return { mark, from, to };
}

function headingsAndBookmarks(doc) {
  const headings = [];
  const bookmarks = [];
  doc.descendants((n) => {
    if (n.type.name === 'heading' && n.textContent.trim()) headings.push(n.textContent.trim());
    if (n.type.name === 'bookmark' && (n.attrs.element === 'text:bookmark' || n.attrs.element === 'text:bookmark-start')) bookmarks.push(n.attrs.name);
    return true;
  });
  return { headings, bookmarks };
}

export async function editLink(c) {
  const view = c.editor.view;
  const st = view.state;
  const cur = linkAt(st);
  const { from, to, empty } = st.selection;
  const range = cur || { from, to };
  const plain = st.doc.textBetween(range.from, range.to, '\n', '￼');
  const r = await linkDialog({
    text: plain, href: cur?.mark.attrs.href || '', title: cur?.mark.attrs.extra?.['office:title'] || '',
    canEditText: !plain.includes('￼') && !plain.includes('\n'), existing: !!cur, ...headingsAndBookmarks(st.doc),
  });
  if (!r) return;
  const v = c.editor.view;
  const tr = v.state.tr;
  if (r.remove) {
    tr.removeMark(range.from, range.to, LINK);
    v.dispatch(tr);
    c.editor.focus();
    return;
  }
  const extra = { ...(cur?.mark.attrs.extra || {}) };
  if (r.title) extra['office:title'] = r.title; else delete extra['office:title'];
  const mark = LINK.create({ href: r.href, extra: Object.keys(extra).length ? extra : null });
  const newText = r.text || (empty && !cur ? r.href.replace(/^mailto:/, '').replace(/^#/, '').replace(/\|outline$/, '') : null);
  if (newText != null && newText !== plain && !plain.includes('￼')) {
    const marks = (range.from < range.to ? st.doc.resolve(range.from + 1).marks() : st.selection.$from.marks()).filter((m) => m.type !== LINK);
    tr.replaceWith(range.from, range.to, schema.text(newText, [...marks, mark]));
    tr.setSelection(TextSelection.create(tr.doc, range.from + newText.length));
  } else {
    tr.removeMark(range.from, range.to, LINK);
    tr.addMark(range.from, range.to, mark);
  }
  v.dispatch(tr.scrollIntoView());
  c.editor.focus();
}

/** Goes to an internal target: "#bookmark" or "#Heading text|outline". */
export function goToTarget(view, href) {
  const target = decodeURIComponent(href.slice(1));
  let pos = null;
  if (!target) pos = 1;
  view.state.doc.descendants((n, p) => {
    if (pos != null) return false;
    if (n.type.name === 'bookmark' && n.attrs.name === target && n.attrs.element !== 'text:bookmark-end') pos = p;
    else if (target.endsWith('|outline') && n.type.name === 'heading') {
      // LibreOffice puts the heading's number in front ("#2.1.Materials|outline").
      const want = target.slice(0, -8);
      const text = n.textContent.trim();
      if (text === want || want.replace(/^[\d.]+\s*/, '') === text) pos = p + 1;
    } else if (target.endsWith('|sequence') && n.type.name === 'field' && n.attrs.element === 'text:sequence') {
      // "#Figure!2|sequence": the caption with that number.
      const [name, value] = target.slice(0, -9).split('!');
      if (n.attrs.fieldAttrs['text:name'] === name && n.attrs.text === value) pos = p;
    }
    return true;
  });
  if (pos == null) return false;
  view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos))).scrollIntoView());
  view.focus();
  return true;
}

/** Ctrl+click (or a click while viewing) follows a link. */
export function linkFollowPlugin(isViewing) {
  return new Plugin({
    props: {
      handleClick(view, pos, event) {
        if (!(event.ctrlKey || event.metaKey || isViewing())) return false;
        const link = linkAt(view.state, pos);
        if (!link) return false;
        const href = link.mark.attrs.href;
        if (href.startsWith('#')) return goToTarget(view, href);
        if (/^(https?|mailto|ftp):/i.test(href)) window.open(href, '_blank', 'noopener,noreferrer');
        return true;
      },
      handleDOMEvents: {
        mouseover(view, e) {
          const a = e.target.closest?.('a.odt-link');
          if (a && !a.title) a.title = `${a.getAttribute('href')}\n${isViewing() ? '' : 'Ctrl+Click to follow link'}`.trim();
          return false;
        },
      },
    },
  });
}

// ------------------------------------------------------------ bookmarks

export function bookmarksOf(doc) {
  const out = [];
  doc.descendants((n, pos) => { if (n.type.name === 'bookmark' && n.attrs.element !== 'text:bookmark-end' && n.attrs.element.startsWith('text:bookmark')) out.push({ name: n.attrs.name, pos }); return true; });
  return out;
}

function removeBookmark(tr, name) {
  const del = [];
  tr.doc.descendants((n, pos) => { if (n.type.name === 'bookmark' && n.attrs.name === name && n.attrs.element.startsWith('text:bookmark')) del.push(pos); return true; });
  for (const p of del.reverse()) tr.delete(p, p + 1);
}

export async function bookmarks(c) {
  const view = c.editor.view;
  const st = view.state;
  const sel = st.doc.textBetween(st.selection.from, st.selection.to, ' ').trim().replace(/[^\p{L}\p{N}_]+/gu, '_').slice(0, 40);
  const r = await bookmarkDialog({ names: bookmarksOf(st.doc), suggested: /^[\p{L}_]/u.test(sel) ? sel : '' });
  if (!r) return;
  const v = c.editor.view;
  if (r.action === 'goto') { goToTarget(v, `#${r.name}`); return; }
  const tr = v.state.tr;
  const { from, to, empty } = v.state.selection;
  removeBookmark(tr, r.name);
  if (r.action === 'add') {
    const f = tr.mapping.map(from);
    const t2 = tr.mapping.map(to);
    if (empty) tr.insert(f, schema.nodes.bookmark.create({ element: 'text:bookmark', name: r.name }));
    else {
      tr.insert(t2, schema.nodes.bookmark.create({ element: 'text:bookmark-end', name: r.name }));
      tr.insert(f, schema.nodes.bookmark.create({ element: 'text:bookmark-start', name: r.name }));
    }
  }
  v.dispatch(tr);
  c.editor.focus();
}

// ------------------------------------------------------------ Quick Parts

const metaValue = (c, name) => {
  const m = (c.session.state.meta?.c || []).find((x) => typeof x !== 'string' && x.n === name);
  return (m?.c || []).filter((x) => typeof x === 'string').join('');
};
const fieldNode = (element, attrs, text) => schema.nodes.field.create({ element, fieldAttrs: attrs, text });

/** Document Property fields. */
export const DOC_PROPERTIES = {
  author: (c) => fieldNode('text:initial-creator', {}, metaValue(c, 'meta:initial-creator') || getSetting('userName') || ''),
  title: (c) => fieldNode('text:title', {}, metaValue(c, 'dc:title') || c.state.docTitle || ''),
  subject: (c) => fieldNode('text:subject', {}, metaValue(c, 'dc:subject')),
  keywords: (c) => fieldNode('text:keywords', {}, (c.session.state.meta?.c || []).filter((x) => x.n === 'meta:keyword').map((x) => (x.c || []).join('')).join(', ')),
  comments: (c) => fieldNode('text:description', {}, metaValue(c, 'dc:description')),
};

export function insertField(c, { kind, format = 'long', fixed = false }) {
  let node;
  const doc = c.mainEditor.view.state.doc;
  switch (kind) {
    case 'date': node = fields.date(c, { format, fixed }); break;
    case 'time': node = fields.date(c, { format: 'time', fixed }); break;
    case 'author': node = DOC_PROPERTIES.author(c); break;
    case 'fileName': node = fields.fileName(c); break;
    case 'page': node = fields.pageNumber(c); break;
    case 'numPages': node = fields.pageCount(c); break;
    case 'wordCount': node = fieldNode('text:word-count', {}, String(documentStats(doc).words)); break;
    case 'charCount': node = fieldNode('text:character-count', {}, String(documentStats(doc).chars)); break;
    default: node = DOC_PROPERTIES[kind]?.(c);
  }
  if (node) insertInline(c, node);
}

export async function fieldDialogRun(c) {
  const r = await fieldDialog();
  if (r) insertField(c, r);
}

/** AutoText entries: [{ name, slice }] in the app settings. */
export const autoTextEntries = () => getSetting('autoText') || [];

export async function saveAutoText(c) {
  const st = c.editor.view.state;
  if (st.selection.empty) return;
  const first = st.doc.textBetween(st.selection.from, st.selection.to, ' ').trim().split(/\s+/).slice(0, 3).join(' ');
  const name = await autoTextNameDialog(first || 'Entry');
  if (!name) return;
  const slice = st.selection.content();
  const list = autoTextEntries().filter((e) => e.name !== name);
  list.push({ name, slice: slice.toJSON() });
  setSetting('autoText', list.sort((a, b) => a.name.localeCompare(b.name)));
}

export function insertAutoText(c, name) {
  const e = autoTextEntries().find((x) => x.name === name);
  if (!e) return;
  const v = c.editor.view;
  v.dispatch(v.state.tr.replaceSelection(Slice.fromJSON(schema, e.slice)).scrollIntoView());
  c.editor.focus();
}

export function deleteAutoText(name) { setSetting('autoText', autoTextEntries().filter((e) => e.name !== name)); }

// ------------------------------------------------------------ inserting blocks

/**
 * Inserts block nodes at the selection. An empty paragraph there is replaced,
 * but its page break / page style carries over to the first new block.
 */
function insertBlocks(c, blocks) {
  const v = c.editor.view;
  const { $from } = v.state.selection;
  const tr = v.state.tr;
  const para = $from.parent;
  if (para.isTextblock && !para.content.size && blocks[0]?.isTextblock) {
    const keep = {};
    const a = para.attrs.auto?.props?.['style:paragraph-properties']?.a || {};
    for (const k of ['fo:break-before', 'fo:break-after']) if (a[k]) keep[k] = a[k];
    if (para.attrs.auto?.styleAttrs?.['style:master-page-name']) keep['#master'] = para.attrs.auto.styleAttrs['style:master-page-name'];
    if (Object.keys(keep).length) {
      const auto = structuredClone(blocks[0].attrs.auto || { styleAttrs: {}, props: {} });
      const ppr = auto.props['style:paragraph-properties'] || { a: {} };
      const { '#master': master, ...rest } = keep;
      auto.props['style:paragraph-properties'] = { ...ppr, a: { ...ppr.a, ...rest } };
      if (master) auto.styleAttrs = { ...auto.styleAttrs, 'style:master-page-name': master };
      blocks = [blocks[0].type.create({ ...blocks[0].attrs, auto }, blocks[0].content), ...blocks.slice(1)];
    }
    const pos = $from.before();
    tr.replaceWith(pos, pos + para.nodeSize, blocks);
  } else tr.replaceSelection(new Slice(Fragment.from(blocks), 1, 1));
  v.dispatch(tr.scrollIntoView());
  c.editor.focus();
}

// ------------------------------------------------------------ signature line

const pp = (a) => ({ styleAttrs: {}, props: { 'style:paragraph-properties': { a } } });
const tp = (a) => [{ type: 'textProps', attrs: { auto: { styleAttrs: {}, props: { 'style:text-properties': { a } } } } }];
const P = (content, auto = null, styleName = 'Standard') => schema.nodeFromJSON({ type: 'paragraph', attrs: { styleName, auto, extra: null }, ...(content.length ? { content } : {}) });
const T = (text, a = null) => ({ type: 'text', text, ...(a ? { marks: tp(a) } : {}) });

export async function signatureLine(c) {
  const r = await signatureDialog();
  if (!r) return;
  const paras = [
    P([], pp({ 'fo:margin-top': '0.6cm' })),
    P([T('X', { 'fo:font-size': '20pt' })], pp({ 'fo:border-bottom': '0.75pt solid #000000', 'fo:padding-bottom': '0.05cm', 'fo:margin-right': '8.5cm' })),
  ];
  for (const line of [r.signer, r.title, r.email]) if (line) paras.push(P([T(line)], pp({ 'fo:margin-top': '0cm', 'fo:margin-bottom': '0cm' })));
  if (r.showDate) paras.push(P([T('Date: ')], pp({ 'fo:margin-top': '0.2cm' })));
  insertBlocks(c, paras);
}

// ------------------------------------------------------------ Text from File

export async function textFromFile(c) {
  const file = await c.ui.pickFile('.odt,.ott,.txt,text/plain,application/vnd.oasis.opendocument.text');
  if (!file) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  let blocks;
  if (/\.(odt|ott)$/i.test(file.name)) {
    let st;
    try { st = importOdt(bytes); } catch (e) { c.ui.toast?.(e.message); return; }
    // Pictures come along with their frames.
    for (const [path, pic] of Object.entries(st.pictures || {})) if (!c.session.state.pictures[path]) c.session.state.pictures[path] = pic;
    blocks = [];
    st.doc.forEach((n) => blocks.push(n));
  } else {
    const txt = new TextDecoder().decode(bytes).replace(/\r\n?/g, '\n');
    blocks = txt.split('\n').map((line) => P(line ? [T(line)] : []));
  }
  insertBlocks(c, blocks);
}

// ------------------------------------------------------------ cover pages

const ACCENT = '#156082';
/** Original cover page designs: (info) → block JSON. The last block ends the page. */
export const COVER_PAGES = {
  classic: (i) => [
    { s: 'Standard', pp: { 'fo:margin-top': '6cm' } },
    { s: 'Title', text: i.title, pp: { 'fo:text-align': 'center' } },
    { s: 'Subtitle', text: i.subtitle, pp: { 'fo:text-align': 'center' } },
    { s: 'Standard', pp: { 'fo:margin-top': '8cm' } },
    { s: 'Standard', text: i.author, pp: { 'fo:text-align': 'center' }, tp: { 'fo:font-weight': 'bold' } },
    { s: 'Standard', text: i.date, pp: { 'fo:text-align': 'center' } },
  ],
  banded: (i) => [
    { s: 'Standard', pp: { 'fo:margin-top': '4cm' } },
    { s: 'Title', text: i.title, pp: { 'fo:background-color': ACCENT, 'fo:padding': '0.6cm', 'fo:margin-bottom': '0cm' }, tp: { 'fo:color': '#ffffff' } },
    { s: 'Subtitle', text: i.subtitle, pp: { 'fo:background-color': ACCENT, 'fo:padding': '0.6cm', 'fo:padding-top': '0cm', 'fo:margin-top': '0cm' }, tp: { 'fo:color': '#dce9f3' } },
    { s: 'Standard', pp: { 'fo:margin-top': '9cm' } },
    { s: 'Standard', text: `${i.author} · ${i.date}`, pp: { 'fo:text-align': 'end' } },
  ],
  sideline: (i) => [
    { s: 'Standard', pp: { 'fo:margin-top': '7cm' } },
    { s: 'Title', text: i.title, pp: { 'fo:border-left': `6pt solid ${'#e97132'}`, 'fo:padding-left': '0.5cm' } },
    { s: 'Subtitle', text: i.subtitle, pp: { 'fo:border-left': `6pt solid ${'#e97132'}`, 'fo:padding-left': '0.5cm' } },
    { s: 'Standard', pp: { 'fo:margin-top': '7cm' } },
    { s: 'Standard', text: i.author, pp: { 'fo:padding-left': '0.7cm' }, tp: { 'fo:font-weight': 'bold' } },
    { s: 'Standard', text: i.date, pp: { 'fo:padding-left': '0.7cm' } },
  ],
  minimal: (i) => [
    { s: 'Standard', text: i.date, pp: { 'fo:text-align': 'end', 'fo:margin-bottom': '10cm' }, tp: { 'fo:color': '#7f7f7f' } },
    { s: 'Title', text: i.title, pp: { 'fo:border-bottom': '1.5pt solid #000000', 'fo:padding-bottom': '0.3cm' } },
    { s: 'Subtitle', text: i.subtitle },
    { s: 'Standard', text: i.author, pp: { 'fo:margin-top': '1cm' } },
  ],
};

export const COVER_NAME = 'CoverPage';

function coverBlocks(c, id) {
  const meta = (n) => metaValue(c, n);
  const info = {
    title: meta('dc:title') || '[Document title]',
    subtitle: meta('dc:subject') || '[Document subtitle]',
    author: meta('meta:initial-creator') || getSetting('userName') || '[Author name]',
    date: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
  };
  const spec = COVER_PAGES[id](info);
  return spec.map((b, k) => {
    const a = { ...(b.pp || {}) };
    if (k === spec.length - 1) a['fo:break-after'] = 'page';
    return P(b.text ? [T(b.text, b.tp || null)] : [], Object.keys(a).length ? pp(a) : null, b.s);
  });
}

/** Inserts (or replaces) the cover page: a section named CoverPage at the start of the document. */
export function insertCoverPage(c, id) {
  if (!COVER_PAGES[id]) return;
  const v = c.mainEditor.view;
  const tr = v.state.tr;
  const old = [];
  tr.doc.forEach((n, pos) => { if (n.type.name === 'section' && n.attrs.name === COVER_NAME) old.push([pos, pos + n.nodeSize]); });
  for (const [a, b] of old.reverse()) tr.delete(a, b);
  const section = schema.nodes.section.create({ name: COVER_NAME, styleName: null, extra: null }, coverBlocks(c, id));
  tr.insert(0, section);
  tr.setSelection(TextSelection.near(tr.doc.resolve(1)));
  v.dispatch(tr.scrollIntoView());
  v.focus();
}

export function removeCoverPage(c) {
  const v = c.mainEditor.view;
  const tr = v.state.tr;
  const old = [];
  tr.doc.forEach((n, pos) => { if (n.type.name === 'section' && n.attrs.name === COVER_NAME) old.push([pos, pos + n.nodeSize]); });
  for (const [a, b] of old.reverse()) tr.delete(a, b);
  if (tr.docChanged) v.dispatch(tr);
}

export const hasCoverPage = (c) => { let found = false; c.mainEditor?.view.state.doc.forEach((n) => { if (n.type.name === 'section' && n.attrs.name === COVER_NAME) found = true; }); return found; };

/** Paragraph attrs with a page break before. */
function withBreakBefore(attrs) {
  const auto = structuredClone(attrs.auto || { styleAttrs: {}, props: {} });
  const ppr = auto.props['style:paragraph-properties'] || { a: {} };
  auto.props['style:paragraph-properties'] = { ...ppr, a: { ...ppr.a, 'fo:break-before': 'page' } };
  return { ...attrs, auto };
}

/** Blank Page: a page break, an empty page and another page break, with the caret on the new page. */
export function blankPage(c) {
  const v = c.editor.view;
  const tr = v.state.tr;
  const sel = tr.selection;
  // A selected inline object (field, picture…) stays: the break goes after it.
  const at = sel instanceof NodeSelection ? sel.to : sel.from;
  if (!tr.doc.resolve(at).parent.isTextblock) return;
  if (!(sel instanceof NodeSelection)) tr.deleteSelection();
  tr.split(sel instanceof NodeSelection ? at : tr.selection.from);
  const pos = tr.selection.$from.before();
  const next = tr.doc.nodeAt(pos);
  tr.setNodeMarkup(pos, null, withBreakBefore(next.attrs));
  const blank = schema.nodes.paragraph.create(withBreakBefore({ styleName: next.attrs.styleName === 'Title' ? 'Standard' : (next.attrs.styleName || 'Standard'), auto: null, extra: null }));
  tr.insert(pos, blank);
  tr.setSelection(TextSelection.create(tr.doc, pos + 1));
  v.dispatch(tr.scrollIntoView());
  c.editor.focus();
}
