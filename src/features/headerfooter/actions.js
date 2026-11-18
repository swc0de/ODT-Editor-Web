/**
 * Header & footer actions shared by Insert ▸ Header & Footer and the
 * contextual Header & Footer tab: gallery presets, page numbers (position,
 * format, start value, removal) and fields (page number, page count, date,
 * author, title, file name).
 */
import { schema } from '../../core/schema.js';
import { editState } from '../../core/state-step.js';
import { getSetting } from '../../core/settings.js';
import { updatePageLayouts, pageProps } from '../../core/page-setup.js';
import { bodyView, currentSection, masterChain, PAGE_KEYS } from '../layout/sections.js';
import { formatNumber } from '../../core/commands/lists.js';

const PP = 'style:paragraph-properties';
const field = (element, fieldAttrs, text) => schema.nodes.field.create({ element, fieldAttrs, text });

export const fields = {
  pageNumber: (c) => field('text:page-number', { 'text:select-page': 'current' }, String(c.ui.docArea.pages[c.ui.docArea.pageAt(bodyView(c).state.selection.head)]?.number || 1)),
  pageCount: (c) => field('text:page-count', {}, String(c.ui.docArea.pages.length || 1)),
  author: () => field('text:author-name', { 'text:fixed': 'false' }, getSetting('userName') || ''),
  title: (c) => {
    const meta = c.session.state.meta?.c || [];
    const tt = meta.find((m) => m.n === 'dc:title');
    return field('text:title', {}, (tt?.c || []).filter((x) => typeof x === 'string').join('') || c.state.docTitle || '');
  },
  fileName: (c) => field('text:file-name', { 'text:display': 'name-and-extension' }, c.session.name || c.state.docTitle || ''),
  date: (_c, { format = 'long', fixed = false } = {}) => {
    const now = new Date();
    const opts = { long: { day: 'numeric', month: 'long', year: 'numeric' }, short: { day: '2-digit', month: '2-digit', year: 'numeric' }, weekday: { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }, iso: null, time: { hour: '2-digit', minute: '2-digit' } }[format];
    const text = format === 'iso' ? now.toISOString().slice(0, 10) : now.toLocaleString('en-GB', opts);
    if (format === 'time') return field('text:time', { 'text:time-value': now.toISOString().slice(0, 19), 'text:fixed': fixed ? 'true' : 'false' }, text);
    return field('text:date', { 'text:date-value': now.toISOString().slice(0, 19), 'text:fixed': fixed ? 'true' : 'false' }, text);
  },
};

/** Inserts inline content at the active editor's selection. */
export function insertInline(c, node) {
  const v = c.editor.view;
  v.dispatch(v.state.tr.replaceSelectionWith(node, true).scrollIntoView());
  c.editor.focus();
}

const para = (part, align, content, extra = {}) => {
  const a = { ...(align && align !== 'start' ? { 'fo:text-align': align } : {}), ...extra };
  return schema.nodes.paragraph.create({ styleName: part === 'header' ? 'Header' : 'Footer', auto: Object.keys(a).length ? { styleAttrs: {}, props: { [PP]: { a } } } : null }, content);
};
const tab = () => schema.nodes.tab.create();

/** Gallery presets: id → (c, part) → content nodes. */
export const PRESETS = {
  header: {
    blank: (_c, part) => [para(part, null, [])],
    blank3: (_c, part) => [para(part, null, [tab(), tab()])],
    title: (c, part) => [para(part, null, [fields.title(c), tab(), tab(), fields.pageNumber(c)])],
    rule: (_c, part) => [para(part, null, [], { 'fo:border-bottom': '0.75pt solid #404040', 'fo:padding-bottom': '0.1cm' })],
  },
  footer: {
    blank: (_c, part) => [para(part, null, [])],
    blank3: (_c, part) => [para(part, null, [tab(), tab()])],
    pageCentre: (c, part) => [para(part, 'center', [fields.pageNumber(c)])],
    pageOfTotal: (c, part) => [para(part, 'center', [schema.text('Page '), fields.pageNumber(c), schema.text(' of '), fields.pageCount(c)])],
  },
};

/** Opens the header/footer editor on the caret's page and fills it with a preset. */
export function applyPreset(c, part, id) {
  const make = PRESETS[part][id] || PRESETS[part].blank;
  c.ui.hf.open({ part });
  const ed = c.ui.hf.activeEditor();
  if (!ed) return;
  const nodes = make(c, part);
  ed.view.dispatch(ed.view.state.tr.replaceWith(0, ed.view.state.doc.content.size, nodes));
  c.ui.hf.commit();
  ed.focus();
}

/** Page number at the top/bottom of the page: left / center / end. */
export function pageNumberAt(c, part, align) {
  c.ui.hf.open({ part });
  const ed = c.ui.hf.activeEditor();
  if (!ed) return;
  ed.view.dispatch(ed.view.state.tr.replaceWith(0, ed.view.state.doc.content.size, [para(part, align, [fields.pageNumber(c)])]));
  c.ui.hf.commit();
  ed.focus();
}

/** Removes page-number fields from the current section's headers and footers. */
export function removePageNumbers(c) {
  const sec = currentSection(c);
  const names = new Set(masterChain(c.session.state, sec.master));
  const strip = (t) => (typeof t === 'string' ? t : { ...t, c: (t.c || []).filter((x) => typeof x === 'string' || x.n !== 'text:page-number').map(strip) });
  if (c.ui.hf.isActive()) c.ui.hf.close({ focusBody: false });
  editState(bodyView(c), c.session.state, PAGE_KEYS, (st) => {
    st.masterStyles = {
      ...st.masterStyles,
      c: (st.masterStyles?.c || []).map((m) => (typeof m === 'string' || m.n !== 'style:master-page' || !names.has(m.a['style:name']) ? m : {
        ...m, c: (m.c || []).map((p) => (typeof p !== 'string' && /^style:(header|footer)/.test(p.n) ? strip(p) : p)),
      })),
    };
  });
}

export const NUM_FORMATS = [['1', '1, 2, 3, …'], ['a', 'a, b, c, …'], ['A', 'A, B, C, …'], ['i', 'i, ii, iii, …'], ['I', 'I, II, III, …']];

/** Current page-number format of the section and its start value (null = continue). */
export function pageNumberFormat(c) {
  const sec = currentSection(c);
  const p = pageProps(c.session.state, sec.master);
  const startNode = bodyView(c).state.doc.nodeAt(sec.start);
  const v = startNode?.attrs?.auto?.props?.[PP]?.a?.['style:page-number'];
  return { format: p['style:num-format'] ?? '1', start: v && v !== 'auto' ? Number(v) : null };
}

/** Applies a page-number format to the section's page styles and a start value to its first paragraph. */
export function setPageNumberFormat(c, { format, start }) {
  const sec = currentSection(c);
  const view = bodyView(c);
  editState(view, c.session.state, PAGE_KEYS, (st) => updatePageLayouts(st, masterChain(st, sec.master), () => ({ attrs: { 'style:num-format': format } })), (tr) => {
    const node = tr.doc.nodeAt(sec.start);
    let pos = sec.start;
    let target = node;
    if (node && !node.isTextblock) { node.descendants((n, p) => { if (target === node && n.isTextblock) { target = n; pos = sec.start + 1 + p; } return target === node; }); }
    if (!target?.isTextblock) return;
    const auto = structuredClone(target.attrs.auto) || { styleAttrs: {}, props: {} };
    const pp = auto.props[PP] || { a: {} };
    if (start) pp.a['style:page-number'] = String(start); else delete pp.a['style:page-number'];
    if (Object.keys(pp.a).length) auto.props[PP] = pp; else delete auto.props[PP];
    tr.setNodeMarkup(pos, null, { ...target.attrs, auto: Object.keys(auto.props).length || Object.keys(auto.styleAttrs || {}).length ? auto : null });
  });
}

export const formatPreview = (fmt) => [1, 2, 3].map((n) => formatNumber(n, fmt)).join(', ');
