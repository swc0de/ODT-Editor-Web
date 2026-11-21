/**
 * DOCX import that reads the WordprocessingML package directly:
 *
 *   styles      paragraph and character styles (names, inheritance, next
 *               style, outline levels), document defaults, theme fonts
 *   fonts       font table and every font used → ODF font faces
 *   page setup  page size, orientation, margins, header / footer distances,
 *               columns; every section (sectPr) with its own page style;
 *               first-page and even-page headers and footers
 *   content     paragraphs (alignment, indents, spacing, line spacing,
 *               keep / page-break options, borders, shading, tab stops),
 *               character formatting, hyperlinks, bookmarks, tabs, breaks,
 *               symbols, fields (page number / count, hyperlinks, results of
 *               others), lists (numbering.xml → ODF list styles), tables
 *               (grid widths, merged cells, header rows, row heights,
 *               borders, shading, vertical alignment), pictures, text boxes,
 *               footnotes and endnotes, comments, tracked insertions and
 *               deletions, content controls
 *   properties  title, subject, author, keywords, description, dates
 *
 * The result is a DocumentState (core/document.js), like an ODT import.
 */
import { unzipSync, strFromU8 } from 'fflate';
import { schema } from '../schema.js';
import { createBlankState } from '../document.js';
import { treeFromAuto } from '../odt/styles.js';
import { encodeStyleName } from '../style-edit.js';
import { makeListStyle } from '../commands/lists.js';
import { changeAuto, withWidths } from '../commands/tables.js';
import { updatePageLayouts, newSectionMaster, setPartOptions, setSectionStyle } from '../page-setup.js';
import { writePart, removePart } from '../hf-content.js';
import { setConfigItem } from '../doc-settings.js';
import { DEFAULT_SETTINGS } from '../odt/export.js';
import { imageAttrs, textBoxAttrs, withWrap, withPosition, withFrameAttrs, withGraphic } from '../objects.js';
import { imageSize } from './readers.js';
import { TOC_DEFAULTS, tocSource, tocBody } from '../indexes.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

// ------------------------------------------------------------ XML helpers

const kids = (el, local) => (el ? [...el.children].filter((c) => !local || c.localName === local) : []);
const kid = (el, local) => (el ? [...el.children].find((c) => c.localName === local) || null : null);
const path = (el, ...locals) => locals.reduce((e, l) => kid(e, l), el);
const wa = (el, name) => (el ? (el.getAttributeNS(W, name) ?? el.getAttribute(`w:${name}`)) : null);
/** On/off properties: <w:b/>, <w:b w:val="0"/>, w:val="false"/"off". */
const onOff = (el) => (el ? !['0', 'false', 'off', 'none'].includes(String(wa(el, 'val') ?? 'true').toLowerCase()) : null);
const num = (v) => (v == null || v === '' ? null : Number(v));
const twipsCm = (t) => `${+(Number(t) / (1440 / 2.54)).toFixed(3)}cm`;
const ind_ = (pPr) => kid(pPr, 'ind');
const twipsPt = (t) => `${+(Number(t) / 20).toFixed(2)}pt`;
const emuPx = (e) => Number(e) / 9525;
const parse = (bytes) => (bytes ? new DOMParser().parseFromString(strFromU8(bytes), 'application/xml') : null);

const HIGHLIGHT = {
  yellow: '#ffff00', green: '#00ff00', cyan: '#00ffff', magenta: '#ff00ff', blue: '#0000ff', red: '#ff0000', darkBlue: '#000080', darkCyan: '#008080',
  darkGreen: '#008000', darkMagenta: '#800080', darkRed: '#800000', darkYellow: '#808000', darkGray: '#808080', lightGray: '#c0c0c0', black: '#000000', white: '#ffffff',
};
const BORDER_STYLE = { single: 'solid', thick: 'solid', double: 'double', dotted: 'dotted', dashed: 'dashed', dotDash: 'dashed', dotDotDash: 'dotted', triple: 'double', wave: 'solid' };
const NUM_FMT = { decimal: '1', decimalZero: '1', lowerLetter: 'a', upperLetter: 'A', lowerRoman: 'i', upperRoman: 'I', ordinal: '1', cardinalText: '1', ordinalText: '1' };
/** Symbol-font bullets → Unicode. */
const BULLET = { '': '•', '': '▪', '': '➢', '': '✓', '': '❖', '': '◦', o: '◦', '§': '▪', '·': '•' };

/**
 * A Word border element → an ODF border value, or null. w:sz is the width of
 * one line in eighths of a point: a double border is two such lines with an
 * equal gap (three times as wide in all).
 */
function border(el) {
  if (!el) return null;
  const v = wa(el, 'val');
  if (!v || v === 'nil' || v === 'none') return 'none';
  const sz = num(wa(el, 'sz')) || 4; // eighths of a point
  const colour = wa(el, 'color');
  const lines = v === 'double' ? 3 : v === 'triple' ? 5 : 1;
  return `${+((sz / 8) * lines).toFixed(2)}pt ${BORDER_STYLE[v] || 'solid'} ${colour && colour !== 'auto' ? `#${colour.toLowerCase()}` : '#000000'}`;
}

/** Line width of a Word border in points (0 for none). */
const borderWidthPt = (el) => { const v = wa(el, 'val'); if (!el || !v || v === 'nil' || v === 'none') return 0; return ((num(wa(el, 'sz')) || 4) / 8) * (v === 'double' ? 3 : v === 'triple' ? 5 : 1); };

/** ECMA-376 §17.4.66 border numbers: a shared cell edge shows the border with the greater width × number. */
const BORDER_NUMBER = ['single', 'thick', 'double', 'dotted', 'dashed', 'dotDash', 'dotDotDash', 'triple', 'thinThickSmallGap', 'thickThinSmallGap', 'thinThickThinSmallGap', 'thinThickMediumGap', 'thickThinMediumGap', 'thinThickThinMediumGap', 'thinThickLargeGap', 'thickThinLargeGap', 'thinThickThinLargeGap', 'wave', 'doubleWave', 'dashSmallGap', 'dashDotStroked', 'threeDEmboss', 'threeDEngrave', 'outset', 'inset'];

/** Word's choice between two conflicting cell borders (elements or null): the winner. */
function strongerBorder(a, b) {
  const info = (el) => {
    const v = wa(el, 'val');
    if (!el || !v || v === 'nil' || v === 'none') return null;
    const n = BORDER_NUMBER.indexOf(v) + 1 || 1;
    const c = (wa(el, 'color') || '000000').replace('auto', '000000');
    const rgb = parseInt(c, 16) || 0;
    return { el, weight: (num(wa(el, 'sz')) || 4) * n, n, brightness: ((rgb >> 16) & 255) + (rgb & 255) + 2 * ((rgb >> 8) & 255) };
  };
  const x = info(a);
  const y = info(b);
  if (!x || !y) return (x || y)?.el || a || b;
  if (x.weight !== y.weight) return x.weight > y.weight ? a : b;
  if (x.n !== y.n) return x.n < y.n ? a : b;
  return x.brightness <= y.brightness ? a : b;
}

// ------------------------------------------------------------ package

function readPackage(bytes) {
  const files = unzipSync(bytes);
  const rels = (part) => {
    const dir = part.includes('/') ? part.slice(0, part.lastIndexOf('/') + 1) : '';
    const name = part.slice(part.lastIndexOf('/') + 1);
    const doc = parse(files[`${dir}_rels/${name}.rels`]);
    const map = new Map();
    for (const r of doc ? [...doc.documentElement.children] : []) {
      const target = r.getAttribute('Target') || '';
      const external = r.getAttribute('TargetMode') === 'External';
      map.set(r.getAttribute('Id'), { type: r.getAttribute('Type') || '', target, external, path: external ? null : normalise(target.startsWith('/') ? target.slice(1) : dir + target) });
    }
    return map;
  };
  const root = parse(files['_rels/.rels']);
  const main = [...(root?.documentElement.children || [])].find((r) => /officeDocument$/.test(r.getAttribute('Type') || ''));
  const mainPath = normalise((main?.getAttribute('Target') || 'word/document.xml').replace(/^\//, ''));
  return { files, rels, mainPath };
}

function normalise(p) {
  const out = [];
  for (const s of p.split('/')) { if (s === '..') out.pop(); else if (s && s !== '.') out.push(s); }
  return out.join('/');
}

// ------------------------------------------------------------ main

export function docxToStateNative(bytes) {
  const pkg = readPackage(bytes);
  const { files } = pkg;
  const docXml = parse(files[pkg.mainPath]);
  if (!docXml || docXml.documentElement.localName !== 'document') throw new Error('This is not a Word document.');
  const mainRels = pkg.rels(pkg.mainPath);
  const relOfType = (type) => [...mainRels.values()].find((r) => r.type.endsWith(`/${type}`));
  const partXml = (type) => { const r = relOfType(type); return r ? { xml: parse(files[r.path]), path: r.path } : null; };

  const state = createBlankState();
  const ctx = {
    state, pkg, files, warnings: [],
    theme: readTheme(partXml('theme')?.xml),
    fonts: new Map(), // name → generic family
    styles: new Map(), // styleId → { odt, family, type, name, heading, level }
    numbering: readNumbering(partXml('numbering')?.xml),
    lists: new Map(), // numId → ODF list style name
    seenNum: new Set(),
    notes: { footnote: readNotes(partXml('footnotes')), endnote: readNotes(partXml('endnotes')) },
    comments: readComments(partXml('comments')?.xml),
    commentsPath: relOfType('comments')?.path || 'word/comments.xml',
    stylesXml: partXml('styles')?.xml,
    noteCount: { footnote: 0, endnote: 0 },
    pictures: 0,
    cid: 0,
  };
  readFontTable(ctx, partXml('fontTable')?.xml);
  readStyles(ctx, partXml('styles')?.xml);
  const settings = partXml('settings')?.xml;
  const tabStop = num(wa(path(settings?.documentElement, 'defaultTabStop'), 'val'));
  if (tabStop) setDefaultProps(state, { 'style:paragraph-properties': { 'style:tab-stop-distance': twipsCm(tabStop) } });
  // On/off elements: <w:evenAndOddHeaders w:val="false"/> means off (the docx library always writes it).
  const evenOdd = !!onOff(kid(settings?.documentElement, 'evenAndOddHeaders'));
  const updateFields = !!onOff(kid(settings?.documentElement, 'updateFields'));
  // Word's layout rules for this document (tab stops from the margin, natural line height, …).
  state.settingsXml = wordCompatSettings();

  // Body: blocks, split into sections at every sectPr. Each section's
  // geometry is known before its content is read (positional tabs need it).
  const body = kid(docXml.documentElement, 'body');
  const sectPrs = kids(body).filter((el) => el.localName === 'p').map((el) => path(el, 'pPr', 'sectPr')).filter(Boolean);
  sectPrs.push(kid(body, 'sectPr'));
  const sections = [];
  let current = [];
  const conv = converter(ctx, mainRels);
  ctx.geometry = pageGeometry(sectPrs[0]);
  ctx.firstGeometry = ctx.geometry;
  for (const el of kids(body)) {
    if (el.localName === 'sectPr') continue;
    current.push(...conv.items(el));
    const sp = el.localName === 'p' ? path(el, 'pPr', 'sectPr') : null;
    if (sp) { sections.push({ blocks: buildLists(ctx, current), sectPr: sp }); current = []; ctx.geometry = pageGeometry(sectPrs[sections.length]); }
  }
  sections.push({ blocks: buildLists(ctx, current), sectPr: kid(body, 'sectPr') });

  // Page styles: the first section uses "Standard"; later ones get their own.
  const out = [];
  let master = 'Standard';
  // Header / footer parts in effect: a section without a reference of a type takes the previous section's (ECMA-376 §17.10.5).
  let inherited = { header: {}, footer: {} };
  const geometries = [];
  sections.forEach((sec, i) => {
    const sp = sec.sectPr;
    const type = wa(kid(sp, 'type'), 'val') || 'nextPage';
    const refs = partRefs(ctx, sp, inherited);
    const geometry = pageGeometry(sp, showsParts(ctx, refs, sp, evenOdd));
    const prevGeometry = i ? geometries[i - 1] : null;
    geometries.push(geometry);
    const sameParts = JSON.stringify(refs) === JSON.stringify(inherited);
    const titlePg = !!onOff(kid(sp, 'titlePg'));
    const prevTitlePg = i ? !!onOff(kid(sections[i - 1].sectPr, 'titlePg')) : null;
    inherited = refs;
    // A continuous break with the same page keeps the page style (columns become a section).
    const newPage = i === 0 || type !== 'continuous' || JSON.stringify(geometry.attrs) !== JSON.stringify(prevGeometry.attrs) || !sameParts || titlePg !== prevTitlePg;
    if (i > 0 && newPage) {
      master = newSectionMaster(state, master, { usage: type === 'evenPage' ? 'left' : type === 'oddPage' ? 'right' : null });
      // The section's first paragraph starts the new page style.
      const firstText = findFirstTextblock(sec.blocks);
      if (firstText) firstText.attrs = { ...firstText.attrs, auto: { ...(firstText.attrs.auto || { props: {} }), styleAttrs: { ...(firstText.attrs.auto?.styleAttrs || {}), 'style:master-page-name': master } } };
      else sec.blocks.unshift({ type: 'paragraph', attrs: { styleName: 'Standard', auto: { styleAttrs: { 'style:master-page-name': master }, props: {} } } });
    }
    if (newPage) {
      updatePageLayouts(state, [master], () => ({ ...geometry.change, columns: null }));
      writeHeadersFooters(ctx, state, master, refs, { titlePg, evenOdd, geometry });
      const start = num(wa(kid(sp, 'pgNumType'), 'start'));
      if (start != null && i > 0) {
        const firstText = findFirstTextblock(sec.blocks);
        if (firstText) firstText.attrs.auto = changeParaProps(firstText.attrs.auto, { 'style:page-number': String(start) });
      }
    }
    // Columns: a section with the columns (and the separator line), so
    // that each page style can have its own; the section starts on the
    // section's first page.
    if (geometry.columns > 1) {
      const name = setSectionStyle(state, null, { count: geometry.columns, gap: geometry.gap, separator: geometry.separator });
      sec.blocks = [{ type: 'section', attrs: { name: `Section${i + 1}`, styleName: name }, content: sec.blocks.length ? sec.blocks : [{ type: 'paragraph' }] }];
    }
    out.push(...sec.blocks);
  });
  if (!out.length) out.push({ type: 'paragraph', attrs: { styleName: 'Standard' } });
  markContinuations(out);
  state.doc = schema.nodeFromJSON({ type: 'doc', content: out.map(fixBlock) });
  fillTocs(ctx, state, out);
  if (updateFields || ctx.emptyToc) state.updateFieldsOnOpen = true;
  state.fontFaces = [...(state.fontFaces || []), ...fontFaces(ctx, state)];
  readProperties(state, files);
  return { state, warnings: ctx.warnings };
}

/**
 * settings.xml for a document read from Word: tab stops are measured from
 * the margin (LibreOffice's TabsRelativeToIndent=false, which it also sets
 * for Word files), and ODTEditorWordLayout keeps Word's line height, list
 * indent and paragraph spacing rules when the document is edited and saved
 * as ODT.
 */
function wordCompatSettings() {
  let xml = DEFAULT_SETTINGS;
  xml = setConfigItem(xml, 'TabsRelativeToIndent', 'boolean', 'false');
  xml = setConfigItem(xml, 'ParaSpaceMax', 'boolean', 'true');
  xml = setConfigItem(xml, 'AddExternalLeading', 'boolean', 'true');
  xml = setConfigItem(xml, 'ODTEditorWordLayout', 'boolean', 'true');
  return xml;
}

const changeParaProps = (auto, attrs) => {
  const next = auto ? structuredClone(auto) : { styleAttrs: {}, props: {} };
  const pp = next.props['style:paragraph-properties'] || { a: {} };
  next.props['style:paragraph-properties'] = { ...pp, a: { ...pp.a, ...attrs } };
  return next;
};

/**
 * A list whose numbering (numId) appeared earlier continues it. Decided in
 * document order once everything is read (table cells are read before the
 * lists around them are grouped).
 */
function markContinuations(blocks) {
  const seen = new Set();
  const walk = (nodes, inItem) => {
    for (const n of nodes || []) {
      if (!n || typeof n !== 'object' || n.type === 'text') continue;
      if (n.type === 'list' && !inItem) {
        const style = n.attrs?.styleName;
        const extra = { ...(n.attrs.extra || {}) };
        if (seen.has(style)) extra['text:continue-numbering'] = 'true'; else delete extra['text:continue-numbering'];
        n.attrs = { ...n.attrs, extra: Object.keys(extra).length ? extra : null };
        seen.add(style);
      }
      if (n.type === 'frame' || n.type === 'note' || n.type === 'annotation') continue;
      walk(n.content, n.type === 'list_item' || (inItem && n.type === 'list'));
    }
  };
  walk(blocks, false);
}

/** Blocks must contain valid content: empty sections / cells get a paragraph. */
function fixBlock(b) {
  if (b.content) b.content = b.content.map((x) => (x.type === 'text' || schema.nodes[x.type]?.isInline ? x : fixBlock(x)));
  if ((b.type === 'section' || b.type === 'table_cell' || b.type === 'list_item') && !b.content?.length) b.content = [{ type: 'paragraph' }];
  return b;
}

function findFirstTextblock(blocks) {
  for (const b of blocks) {
    if (b.type === 'paragraph' || b.type === 'heading') return b;
    if (b.content) { const f = findFirstTextblock(b.content.filter((x) => !schema.nodes[x.type]?.isInline)); if (f) return f; }
  }
  return null;
}

// ------------------------------------------------------------ page setup

/**
 * Page geometry of a section. `has` = { header, footer }: whether the
 * section's pages show them (they may be inherited from an earlier section).
 */
function pageGeometry(sp, has = { header: !!kid(sp, 'headerReference'), footer: !!kid(sp, 'footerReference') }) {
  const sz = kid(sp, 'pgSz');
  const mar = kid(sp, 'pgMar');
  const cols = kid(sp, 'cols');
  const w = num(wa(sz, 'w')) || 11906;
  const h = num(wa(sz, 'h')) || 16838;
  const landscape = wa(sz, 'orient') === 'landscape' || w > h;
  const top = num(wa(mar, 'top')) ?? 1440;
  const bottom = num(wa(mar, 'bottom')) ?? 1440;
  const header = num(wa(mar, 'header')) ?? 708;
  const footer = num(wa(mar, 'footer')) ?? 708;
  const left = num(wa(mar, 'left')) ?? num(wa(mar, 'start')) ?? 1440;
  const right = num(wa(mar, 'right')) ?? num(wa(mar, 'end')) ?? 1440;
  const attrs = {
    'fo:page-width': twipsCm(w), 'fo:page-height': twipsCm(h), 'style:print-orientation': landscape ? 'landscape' : 'portrait',
    // ODF margins reach the header / footer when there is one; Word's reach the body.
    'fo:margin-top': twipsCm(has.header ? header : Math.abs(top)), 'fo:margin-bottom': twipsCm(has.footer ? footer : Math.abs(bottom)),
    'fo:margin-left': twipsCm(left), 'fo:margin-right': twipsCm(right),
  };
  const change = { attrs };
  // Word starts the body at max(top margin, header bottom): the header's
  // minimum height reaches the top margin and grows with its content (the
  // same for the footer, from the bottom).
  if (has.header) change.header = { 'fo:min-height': twipsCm(Math.max(0, Math.abs(top) - header)), 'fo:margin-bottom': '0cm' };
  if (has.footer) change.footer = { 'fo:min-height': twipsCm(Math.max(0, Math.abs(bottom) - footer)), 'fo:margin-top': '0cm' };
  const count = num(wa(cols, 'num')) || 1;
  return {
    attrs, change, columns: count, gap: (num(wa(cols, 'space')) ?? 720) / 567, separator: onOffAttr(wa(cols, 'sep')),
    // Twips, for positional tabs.
    width: w, left, right, textWidth: w - left - right,
  };
}

const onOffAttr = (v) => v != null && !['0', 'false', 'off'].includes(String(v).toLowerCase());

/** Header / footer part paths per type for a section, starting from the previous section's. */
function partRefs(ctx, sp, inherited) {
  const mainRels = ctx.pkg.rels(ctx.pkg.mainPath);
  const out = { header: { ...inherited.header }, footer: { ...inherited.footer } };
  for (const part of ['header', 'footer']) {
    for (const ref of kids(sp, `${part}Reference`)) {
      const type = wa(ref, 'type') || 'default';
      const rel = mainRels.get(ref.getAttributeNS(R, 'id') ?? ref.getAttribute('r:id'));
      if (rel?.path && ctx.files[rel.path]) out[part][type] = rel.path;
    }
  }
  return out;
}

/**
 * Writes a section's headers and footers onto its master page: the default
 * part, the first-page part when w:titlePg is set and the even-page part
 * when w:evenAndOddHeaders is on. A wanted variant with no part (in this or
 * an earlier section) is empty, as in Word.
 */
function writeHeadersFooters(ctx, state, master, refs, { titlePg, evenOdd, geometry }) {
  removePart(state, master, 'header');
  removePart(state, master, 'footer');
  for (const part of ['header', 'footer']) {
    const r = refs[part];
    const shown = r.default || (titlePg && r.first) || (evenOdd && r.even);
    if (!shown) continue;
    const write = (kind, pathName) => {
      let blocks = [];
      if (pathName) {
        const xml = parse(ctx.files[pathName]);
        const saved = ctx.geometry;
        ctx.geometry = geometry;
        blocks = converter(ctx, ctx.pkg.rels(pathName), { part }).blocksOf(xml.documentElement);
        ctx.geometry = saved;
      }
      const doc = schema.nodeFromJSON({ type: 'doc', content: (blocks.length ? blocks : [{ type: 'paragraph', attrs: { styleName: part === 'header' ? 'Header' : 'Footer' } }]).map(fixBlock) });
      writePart(state, master, part, kind, doc);
    };
    // A default part that is empty (written so a section doesn't inherit
    // an earlier one) is no header / footer at all when nothing else shows.
    if (!(titlePg && r.first) && !(evenOdd && r.even) && r.default && isEmptyPart(ctx, r.default)) continue;
    write(null, r.default);
    if (evenOdd) write('left', r.even);
    if (titlePg) write('first', r.first);
  }
}

/** A header / footer part with no text, fields or objects. */
function isEmptyPart(ctx, pathName) {
  const xml = parse(ctx.files[pathName]);
  if (!xml) return true;
  return ![...xml.getElementsByTagName('*')].some((e) => ['t', 'fldSimple', 'fldChar', 'drawing', 'pict', 'object', 'tab', 'ptab', 'sym', 'tbl'].includes(e.localName) && (e.localName !== 't' || e.textContent));
}

/** Does a section show a header / footer (on any of its pages)? */
const showsParts = (ctx, refs, sp, evenOdd) => {
  const titlePg = !!onOff(kid(sp, 'titlePg'));
  const any = (r) => !!((r.default && !isEmptyPart(ctx, r.default)) || (titlePg && r.first) || (evenOdd && r.even));
  return { header: any(refs.header), footer: any(refs.footer) };
};

// ------------------------------------------------------------ theme, fonts

function readTheme(xml) {
  const out = { major: null, minor: null };
  if (!xml) return out;
  for (const which of ['major', 'minor']) {
    const f = [...xml.getElementsByTagName('*')].find((e) => e.localName === `${which}Font`);
    const latin = kid(f, 'latin');
    if (latin) out[which] = latin.getAttribute('typeface') || null;
  }
  return out;
}

function readFontTable(ctx, xml) {
  for (const f of kids(xml?.documentElement, 'font')) {
    const name = wa(f, 'name');
    const fam = wa(kid(f, 'family'), 'val');
    if (name) ctx.fonts.set(name, { roman: 'roman', swiss: 'swiss', modern: 'modern', script: 'script', decorative: 'decorative' }[fam] || 'swiss');
  }
}

/** The font of a run: ascii / hAnsi, or a theme font. */
function fontOf(ctx, rFonts, which = 'ascii') {
  if (!rFonts) return null;
  const theme = wa(rFonts, `${which}Theme`) || (which === 'ascii' ? wa(rFonts, 'hAnsiTheme') : null);
  if (theme) return /^major/.test(theme) ? ctx.theme.major : ctx.theme.minor;
  return wa(rFonts, which) || (which === 'ascii' ? wa(rFonts, 'hAnsi') : null);
}

function fontFaces(ctx, state) {
  const have = new Set((state.fontFaces || []).map((f) => f.a?.['style:name']));
  const used = new Set();
  const scan = (t) => {
    if (!t || typeof t !== 'object') return;
    for (const k of ['style:font-name', 'style:font-name-asian', 'style:font-name-complex']) if (t[k]) used.add(t[k]);
    for (const v of Object.values(t)) if (v && typeof v === 'object') scan(v);
  };
  scan(state.commonStyles);
  scan(state.doc.toJSON());
  scan(state.masterStyles);
  scan(state.stylesAutoStyles);
  return [...used].filter((n) => !have.has(n)).map((n) => ({
    n: 'style:font-face',
    a: { 'style:name': n, 'svg:font-family': /\s/.test(n) ? `'${n}'` : n, 'style:font-family-generic': ctx.fonts.get(n) || 'swiss', 'style:font-pitch': ctx.fonts.get(n) === 'modern' ? 'fixed' : 'variable' },
  }));
}

// ------------------------------------------------------------ properties

/** w:rPr → ODF text properties. */
function textProps(ctx, rPr) {
  const a = {};
  if (!rPr) return a;
  const f = fontOf(ctx, kid(rPr, 'rFonts'));
  if (f) a['style:font-name'] = f;
  const fa = fontOf(ctx, kid(rPr, 'rFonts'), 'eastAsia');
  if (fa) a['style:font-name-asian'] = fa;
  const fc = fontOf(ctx, kid(rPr, 'rFonts'), 'cs');
  if (fc) a['style:font-name-complex'] = fc;
  const b = onOff(kid(rPr, 'b'));
  if (b != null) a['fo:font-weight'] = b ? 'bold' : 'normal';
  const i = onOff(kid(rPr, 'i'));
  if (i != null) a['fo:font-style'] = i ? 'italic' : 'normal';
  const u = kid(rPr, 'u');
  if (u) {
    const v = wa(u, 'val') || 'single';
    if (v === 'none') a['style:text-underline-style'] = 'none';
    else {
      a['style:text-underline-style'] = { dotted: 'dotted', dash: 'dash', dotDash: 'dot-dash', wave: 'wave', double: 'solid' }[v] || 'solid';
      a['style:text-underline-width'] = /thick|heavy/i.test(v) ? 'bold' : 'auto';
      a['style:text-underline-color'] = wa(u, 'color') && wa(u, 'color') !== 'auto' ? `#${wa(u, 'color').toLowerCase()}` : 'font-color';
      if (v === 'double') a['style:text-underline-type'] = 'double';
    }
  }
  const strike = onOff(kid(rPr, 'strike')) || onOff(kid(rPr, 'dstrike'));
  if (kid(rPr, 'strike') || kid(rPr, 'dstrike')) a['style:text-line-through-style'] = strike ? 'solid' : 'none';
  if (onOff(kid(rPr, 'dstrike'))) a['style:text-line-through-type'] = 'double';
  const colour = wa(kid(rPr, 'color'), 'val');
  if (colour && colour !== 'auto') a['fo:color'] = `#${colour.toLowerCase()}`;
  // Automatic colour: black, or white on a dark background (as Word and LibreOffice draw it).
  else if (colour === 'auto') a['style:use-window-font-color'] = 'true';
  const sz = num(wa(kid(rPr, 'sz'), 'val'));
  if (sz) a['fo:font-size'] = `${sz / 2}pt`;
  const szCs = num(wa(kid(rPr, 'szCs'), 'val'));
  if (szCs) a['style:font-size-complex'] = `${szCs / 2}pt`;
  const hl = wa(kid(rPr, 'highlight'), 'val');
  if (hl && HIGHLIGHT[hl]) a['fo:background-color'] = HIGHLIGHT[hl];
  const shd = wa(kid(rPr, 'shd'), 'fill');
  if (!a['fo:background-color'] && shd && shd !== 'auto') a['fo:background-color'] = `#${shd.toLowerCase()}`;
  const va = wa(kid(rPr, 'vertAlign'), 'val');
  if (va === 'superscript') a['style:text-position'] = 'super 58%';
  if (va === 'subscript') a['style:text-position'] = 'sub 58%';
  if (onOff(kid(rPr, 'caps'))) a['fo:text-transform'] = 'uppercase';
  if (onOff(kid(rPr, 'smallCaps'))) a['fo:font-variant'] = 'small-caps';
  if (onOff(kid(rPr, 'vanish'))) a['text:display'] = 'none';
  if (onOff(kid(rPr, 'outline'))) a['style:text-outline'] = 'true';
  if (onOff(kid(rPr, 'shadow'))) a['fo:text-shadow'] = '1pt 1pt';
  const sp = num(wa(kid(rPr, 'spacing'), 'val'));
  if (sp) a['fo:letter-spacing'] = twipsPt(sp);
  const lang = wa(kid(rPr, 'lang'), 'val');
  if (lang && /^[a-z]{2,3}-[A-Za-z]{2}$/.test(lang)) { const [l, c] = lang.split('-'); a['fo:language'] = l; a['fo:country'] = c.toUpperCase(); }
  return a;
}

/**
 * w:pPr → ODF paragraph properties { a, c } (c: tab stops). `inherited`:
 * the indents (twips) the paragraph gets from its style chain, needed
 * because Word draws left / right borders outside the indent.
 */
function paraProps(pPr, inherited = {}) {
  const a = {};
  const c = [];
  if (!pPr) return { a, c };
  const jc = wa(kid(pPr, 'jc'), 'val');
  if (jc) a['fo:text-align'] = { both: 'justify', distribute: 'justify', center: 'center', right: 'end', end: 'end', left: 'start', start: 'start' }[jc] || 'start';
  const ind = kid(pPr, 'ind');
  if (ind) {
    const left = num(wa(ind, 'left') ?? wa(ind, 'start'));
    const right = num(wa(ind, 'right') ?? wa(ind, 'end'));
    const first = num(wa(ind, 'firstLine'));
    const hang = num(wa(ind, 'hanging'));
    if (left != null) a['fo:margin-left'] = twipsCm(left);
    if (right != null) a['fo:margin-right'] = twipsCm(right);
    if (hang != null) a['fo:text-indent'] = twipsCm(-hang);
    else if (first != null) a['fo:text-indent'] = twipsCm(first);
  }
  const sp = kid(pPr, 'spacing');
  if (sp) {
    const before = num(wa(sp, 'before'));
    const after = num(wa(sp, 'after'));
    if (before != null && wa(sp, 'beforeAutospacing') !== '1') a['fo:margin-top'] = twipsCm(before);
    if (after != null && wa(sp, 'afterAutospacing') !== '1') a['fo:margin-bottom'] = twipsCm(after);
    const line = num(wa(sp, 'line'));
    const rule = wa(sp, 'lineRule') || 'auto';
    if (line) {
      if (rule === 'auto') a['fo:line-height'] = `${Math.round((line / 240) * 100)}%`;
      else if (rule === 'exact') a['fo:line-height'] = twipsPt(line);
      else a['style:line-height-at-least'] = twipsPt(line);
    }
  }
  if (onOff(kid(pPr, 'contextualSpacing'))) a['style:contextual-spacing'] = 'true';
  if (onOff(kid(pPr, 'keepNext'))) a['fo:keep-with-next'] = 'always';
  if (onOff(kid(pPr, 'keepLines'))) a['fo:keep-together'] = 'always';
  if (onOff(kid(pPr, 'pageBreakBefore'))) a['fo:break-before'] = 'page';
  const widow = kid(pPr, 'widowControl');
  if (widow) { const on = onOff(widow); a['fo:widows'] = on ? '2' : '0'; a['fo:orphans'] = on ? '2' : '0'; }
  const shd = wa(kid(pPr, 'shd'), 'fill');
  if (shd && shd !== 'auto') a['fo:background-color'] = `#${shd.toLowerCase()}`;
  const bdr = kid(pPr, 'pBdr');
  if (bdr) {
    // w:space is the gap between border and text (points). The text stays at
    // the indent; left / right borders sit outside it (ODF margins reach the
    // border's outer edge).
    for (const side of ['top', 'bottom', 'left', 'right']) {
      const el = kid(bdr, side) || kid(bdr, side === 'left' ? 'start' : side === 'right' ? 'end' : '_');
      const v = border(el);
      if (!v) continue;
      a[`fo:border-${side}`] = v;
      const space = v === 'none' ? 0 : num(wa(el, 'space')) || 0;
      a[`fo:padding-${side}`] = `${space}pt`;
      if (side === 'left' || side === 'right') {
        const ind = side === 'left' ? num(wa(ind_(pPr), 'left') ?? wa(ind_(pPr), 'start')) ?? inherited.left ?? 0 : num(wa(ind_(pPr), 'right') ?? wa(ind_(pPr), 'end')) ?? inherited.right ?? 0;
        a[`fo:margin-${side}`] = twipsCm(ind - (space + borderWidthPt(el)) * 20);
      }
    }
  }
  const bidi = onOff(kid(pPr, 'bidi'));
  if (bidi) a['style:writing-mode'] = 'rl-tb';
  const tabs = kids(kid(pPr, 'tabs'), 'tab').filter((t) => wa(t, 'val') !== 'clear');
  if (tabs.length) c.push(tabStopsTree(tabs.map(tabInfo)));
  return { a, c };
}

/** A w:tab → { pos (twips), val, leader }. */
const tabInfo = (t) => ({ pos: num(wa(t, 'pos')) || 0, val: wa(t, 'val') || 'left', leader: wa(t, 'leader') || 'none' });

const LEADER = { dot: ['dotted', '.'], hyphen: ['dash', '-'], underscore: ['solid', '_'], heavy: ['solid', '_'], middleDot: ['dotted', '·'] };

/** Tab stops [{ pos, val, leader }] → style:tab-stops. */
function tabStopsTree(tabs) {
  return {
    n: 'style:tab-stops', a: {},
    c: [...tabs].filter((t) => t.val !== 'bar').sort((x, y) => x.pos - y.pos).map((t) => {
      const ta = { 'style:position': twipsCm(t.pos) };
      if (t.val === 'center') ta['style:type'] = 'center';
      if (t.val === 'right' || t.val === 'end') ta['style:type'] = 'right';
      if (t.val === 'decimal') { ta['style:type'] = 'char'; ta['style:char'] = '.'; }
      const l = LEADER[t.leader];
      if (l) { ta['style:leader-style'] = l[0]; ta['style:leader-text'] = l[1]; }
      return { n: 'style:tab-stop', a: ta };
    }),
  };
}

/** A style and the styles it is based on, base first. */
function styleChain(ctx, id) {
  const out = [];
  const seen = new Set();
  for (let cur = id; cur && !seen.has(cur);) {
    seen.add(cur);
    const st = ctx.styles.get(cur);
    if (!st) break;
    out.unshift(st);
    cur = st.basedOn;
  }
  return out;
}

/** Left / right indents (twips) a paragraph gets from a style chain. */
function inheritedInd(ctx, id) {
  const out = { left: null, right: null };
  for (const st of styleChain(ctx, id)) {
    const ind = kid(st.pPr, 'ind');
    const l = num(wa(ind, 'left') ?? wa(ind, 'start'));
    const r = num(wa(ind, 'right') ?? wa(ind, 'end'));
    if (l != null) out.left = l;
    if (r != null) out.right = r;
  }
  return out;
}

/**
 * Word's tab stops for a paragraph: those of its style chain, then its own
 * (w:val="clear" removes an inherited stop), plus positional-tab stops.
 * ODF replaces a parent's tab stops instead of adding to them, so the
 * paragraph gets the merged list.
 */
function mergedTabs(ctx, styleId, pPrs, extra = []) {
  const map = new Map();
  for (const pPr of [...styleChain(ctx, styleId).map((st) => st.pPr), ...pPrs]) {
    for (const t of kids(kid(pPr, 'tabs'), 'tab')) {
      const info = tabInfo(t);
      if (info.val === 'clear') map.delete(info.pos); else map.set(info.pos, info);
    }
  }
  for (const t of extra) map.set(t.pos, t);
  return [...map.values()];
}

function autoOf({ para = null, text = null } = {}) {
  const props = {};
  if (para && (Object.keys(para.a).length || para.c.length)) props['style:paragraph-properties'] = para.c.length ? { a: para.a, c: para.c } : { a: para.a };
  if (text && Object.keys(text).length) props['style:text-properties'] = { a: text };
  return Object.keys(props).length ? { styleAttrs: {}, props } : null;
}

function setDefaultProps(state, change) {
  state.commonStyles = {
    ...state.commonStyles,
    c: (state.commonStyles.c || []).map((t) => {
      if (typeof t === 'string' || t.n !== 'style:default-style' || t.a['style:family'] !== 'paragraph') return t;
      const c = [...(t.c || [])];
      for (const [el, attrs] of Object.entries(change)) {
        const i = c.findIndex((x) => x.n === el);
        const base = i >= 0 ? c[i] : { n: el, a: {} };
        const next = { ...base, a: { ...base.a, ...attrs } };
        if (i >= 0) c[i] = next; else c.push(next);
      }
      return { ...t, c };
    }),
  };
}

// ------------------------------------------------------------ styles

const KNOWN = {
  normal: 'Standard', title: 'Title', subtitle: 'Subtitle', quote: 'Quote', 'intense quote': 'Intense_20_Quote', 'list paragraph': 'List_20_Paragraph',
  'footnote text': 'Footnote', 'endnote text': 'Endnote', header: 'Header', footer: 'Footer', caption: 'Caption', 'no spacing': 'No_20_Spacing',
  'toc heading': 'Contents_20_Heading', hyperlink: 'Internet_20_link', strong: 'Strong_20_Emphasis', emphasis: 'Emphasis',
  'subtle emphasis': 'Subtle_20_Emphasis', 'intense emphasis': 'Intense_20_Emphasis',
  ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`toc ${i + 1}`, `Contents_20_${i + 1}`])),
};

function readStyles(ctx, xml) {
  const { state } = ctx;
  const root = xml?.documentElement;
  // Document defaults → the default paragraph style.
  const defaults = kid(root, 'docDefaults');
  const dText = textProps(ctx, path(defaults, 'rPrDefault', 'rPr'));
  const dPara = paraProps(path(defaults, 'pPrDefault', 'pPr'));
  if (!dText['style:font-name']) dText['style:font-name'] = ctx.theme.minor || 'Calibri';
  if (!dText['fo:font-size']) dText['fo:font-size'] = '10pt';
  if (!dText['fo:color']) dText['style:use-window-font-color'] = 'true';
  setDefaultProps(state, { 'style:paragraph-properties': dPara.a, 'style:text-properties': dText });

  const list = kids(root, 'style');
  // Names first, so basedOn / next can refer to any style.
  for (const s of list) {
    const type = wa(s, 'type');
    if (type !== 'paragraph' && type !== 'character') continue;
    const id = wa(s, 'styleId');
    const name = wa(kid(s, 'name'), 'val') || id;
    const low = name.toLowerCase();
    if (type === 'character' && low === 'default paragraph font') { ctx.styles.set(id, { odt: null, family: 'text' }); continue; }
    const hm = low.match(/^heading (\d)$/);
    let odt = hm ? `Heading_20_${hm[1]}` : KNOWN[low] || encodeStyleName(name);
    // A Word character style with the name of a paragraph style (or the other way round) gets a suffix.
    if (type === 'character' && ['Standard', 'Title', 'Subtitle', 'Quote', 'Caption', 'Header', 'Footer'].includes(odt)) odt = `${odt}_20_Char`;
    const outline = num(wa(path(s, 'pPr', 'outlineLvl'), 'val'));
    const level = hm ? Number(hm[1]) : (outline != null && outline < 9 ? outline + 1 : 0);
    // Styles can number their paragraphs (List Bullet, List Number…).
    const numPr = path(s, 'pPr', 'numPr');
    ctx.styles.set(id, {
      id, pPr: kid(s, 'pPr'), rPr: kid(s, 'rPr'),
      odt, family: type === 'paragraph' ? 'paragraph' : 'text', name, level, isDefault: wa(s, 'default') === '1',
      numId: wa(kid(numPr, 'numId'), 'val'), ilvl: num(wa(kid(numPr, 'ilvl'), 'val')) || 0, basedOn: wa(kid(s, 'basedOn'), 'val'),
    });
  }
  const add = [];
  for (const s of list) {
    const id = wa(s, 'styleId');
    const info = ctx.styles.get(id);
    if (!info?.odt) continue;
    const parentId = wa(kid(s, 'basedOn'), 'val');
    const parent = parentId ? ctx.styles.get(parentId)?.odt : null;
    const nextId = wa(kid(s, 'next'), 'val');
    let para = null;
    if (info.family === 'paragraph') {
      para = paraProps(kid(s, 'pPr'), inheritedInd(ctx, parentId));
      // Tab stops add to the parent style's.
      if (kid(kid(s, 'pPr'), 'tabs')) { para.c = para.c.filter((x) => x.n !== 'style:tab-stops'); const t = mergedTabs(ctx, id, []); if (t.length) para.c.push(tabStopsTree(t)); }
    }
    const auto = autoOf({ para, text: textProps(ctx, kid(s, 'rPr')) }) || { styleAttrs: {}, props: {} };
    const tree = treeFromAuto(info.odt, info.family, parent && parent !== info.odt ? parent : null, auto);
    tree.a['style:display-name'] = info.odt === 'Standard' ? 'Default Paragraph Style' : info.name.replace(/^heading (\d)$/, 'Heading $1').replace(/^\w/, (ch) => ch.toUpperCase());
    if (info.family === 'paragraph') {
      tree.a['style:class'] = 'text';
      if (info.level) tree.a['style:default-outline-level'] = String(info.level);
      const next = nextId ? ctx.styles.get(nextId)?.odt : null;
      if (next) tree.a['style:next-style-name'] = next;
      // Word's list paragraph indents come from the list.
    }
    add.push(tree);
  }
  // A style defined twice: the last definition wins (as in Word).
  const byName = new Map(add.map((t) => [`${t.a['style:family']}:${t.a['style:name']}`, t]));
  add.splice(0, add.length, ...byName.values());
  // Word styles replace the built-in ones of the same name.
  const names = new Set(add.map((t) => `${t.a['style:family']}:${t.a['style:name']}`));
  const keep = (state.commonStyles.c || []).filter((t) => typeof t === 'string' || t.n !== 'style:style' || !names.has(`${t.a['style:family']}:${t.a['style:name']}`));
  state.commonStyles = { ...state.commonStyles, c: [...keep, ...add] };
}

/** The ODF style of a paragraph's pStyle (or Word's default paragraph style). */
function paraStyle(ctx, pPr) {
  const id = wa(kid(pPr, 'pStyle'), 'val');
  const s = id ? ctx.styles.get(id) : [...ctx.styles.values()].find((x) => x.family === 'paragraph' && x.isDefault);
  return s?.odt ? s : { odt: 'Standard', level: 0 };
}

// ------------------------------------------------------------ numbering

function readNumbering(xml) {
  // (level rPr is converted later, once the theme fonts are known)
  const root = xml?.documentElement;
  const abstract = new Map();
  for (const an of kids(root, 'abstractNum')) {
    const levels = [];
    for (const lvl of kids(an, 'lvl')) {
      const i = num(wa(lvl, 'ilvl')) || 0;
      const fmt = wa(kid(lvl, 'numFmt'), 'val') || 'decimal';
      const text = wa(kid(lvl, 'lvlText'), 'val') ?? '';
      const ind = path(lvl, 'pPr', 'ind');
      levels[i] = {
        fmt, text, start: num(wa(kid(lvl, 'start'), 'val')) ?? 1,
        left: num(wa(ind, 'left') ?? wa(ind, 'start')), hanging: num(wa(ind, 'hanging')), firstLine: num(wa(ind, 'firstLine')),
        font: wa(path(lvl, 'rPr', 'rFonts'), 'ascii'),
        // The label's own run properties (colour, size, bold…), what follows it and its alignment.
        rPr: path(lvl, 'rPr'), suff: wa(kid(lvl, 'suff'), 'val') || 'tab', jc: wa(kid(lvl, 'lvlJc'), 'val') || 'left',
      };
    }
    abstract.set(wa(an, 'abstractNumId'), { levels, link: wa(kid(an, 'numStyleLink'), 'val') });
  }
  const nums = new Map();
  for (const n of kids(root, 'num')) {
    const overrides = new Map(kids(n, 'lvlOverride').map((o) => [num(wa(o, 'ilvl')) || 0, num(wa(kid(o, 'startOverride'), 'val'))]));
    nums.set(wa(n, 'numId'), { abstract: abstract.get(wa(kid(n, 'abstractNumId'), 'val')), overrides });
  }
  return nums;
}

/** The ODF list style for a numId (made once). */
function listStyleFor(ctx, numId) {
  if (ctx.lists.has(numId)) return ctx.lists.get(numId);
  const def = ctx.numbering.get(numId);
  const levels = (def?.abstract?.levels || []).map((l, i) => {
    if (!l) return { bullet: '•' };
    if (l.fmt === 'bullet' || l.fmt === 'none') {
      const ch = l.text || '•';
      return { bullet: l.fmt === 'none' ? ' ' : BULLET[ch] || (/[-]/.test(ch) ? '•' : ch) };
    }
    // "%1." → suffix "."; "(%1)" → prefix "(", suffix ")"; "%1.%2." → two levels shown.
    const shown = (l.text.match(/%\d/g) || []).length || 1;
    const last = l.text.lastIndexOf('%');
    const first = l.text.indexOf('%');
    return {
      format: NUM_FMT[l.fmt] || '1', prefix: first > 0 ? l.text.slice(0, first) : '', suffix: last >= 0 ? l.text.slice(last + 2) : '.', display: shown,
      start: def.overrides.get(i) ?? l.start,
    };
  });
  const name = `WWNum${numId}`;
  const tree = makeListStyle(name, levels.length ? levels : [{ bullet: '•' }]);
  // Word's indents for each level, what follows the label (tab / space /
  // nothing), the label's alignment and its run properties.
  (def?.abstract?.levels || []).forEach((l, i) => {
    const el = tree.c[i];
    const lp = el?.c?.[0];
    const la = lp?.c?.[0];
    if (!l || !la) return;
    if (l.left != null) {
      la.a['fo:margin-left'] = twipsCm(l.left);
      la.a['text:list-tab-stop-position'] = twipsCm(l.left);
      la.a['fo:text-indent'] = twipsCm(l.hanging != null ? -l.hanging : (l.firstLine ?? -360));
    }
    la.a['text:label-followed-by'] = { tab: 'listtab', space: 'space', nothing: 'nothing' }[l.suff] || 'listtab';
    if (l.suff !== 'tab') delete la.a['text:list-tab-stop-position'];
    if (l.jc === 'right' || l.jc === 'end' || l.jc === 'center') lp.a['fo:text-align'] = l.jc === 'center' ? 'center' : 'end';
    const tp = textProps(ctx, l.rPr);
    // A symbol font's bullet was mapped to Unicode: keep the paragraph's font for it.
    if (el.n === 'text:list-level-style-bullet' && tp['style:font-name'] && /symbol|wingdings/i.test(tp['style:font-name'])) delete tp['style:font-name'];
    if (Object.keys(tp).length) el.c.push({ n: 'style:text-properties', a: tp });
  });
  ctx.state.contentAutoStyles = [...ctx.state.contentAutoStyles, tree];
  ctx.lists.set(numId, name);
  return name;
}

/** Groups paragraphs carrying list numbering into (nested) list nodes. */
function buildLists(ctx, items) {
  const out = [];
  let stack = []; // [{ node, level }]
  let currentNum = null;
  const close = () => { stack = []; currentNum = null; };
  for (const it of items) {
    if (!it.list) { close(); out.push(it.block); continue; }
    const { numId, level } = it.list;
    const style = listStyleFor(ctx, numId);
    const ordered = !/^bullet|none$/.test(ctx.numbering.get(numId)?.abstract?.levels?.[level]?.fmt || 'decimal');
    if (numId !== currentNum) {
      close();
      currentNum = numId;
      const node = { type: 'list', attrs: { styleName: style, ordered, extra: ctx.seenNum.has(numId) ? { 'text:continue-numbering': 'true' } : null }, content: [] };
      ctx.seenNum.add(numId);
      out.push(node);
      stack.push({ node, level: 0 });
    }
    while (stack.length > 1 && stack[stack.length - 1].level > level) stack.pop();
    let top = stack[stack.length - 1];
    while (top.level < level) {
      // A nested list inside the last item (or a new item when there is none).
      let item = top.node.content[top.node.content.length - 1];
      if (!item) { item = { type: 'list_item', content: [{ type: 'paragraph' }] }; top.node.content.push(item); }
      const node = { type: 'list', attrs: { styleName: style, ordered }, content: [] };
      item.content.push(node);
      top = { node, level: top.level + 1 };
      stack.push(top);
    }
    top.node.content.push({ type: 'list_item', content: [it.block] });
  }
  return out;
}

// ------------------------------------------------------------ notes, comments

function readNotes(part) {
  const map = new Map();
  for (const n of kids(part?.xml?.documentElement)) {
    if (n.localName !== 'footnote' && n.localName !== 'endnote') continue;
    const type = wa(n, 'type');
    if (type === 'separator' || type === 'continuationSeparator' || type === 'continuationNotice') continue;
    map.set(wa(n, 'id'), { el: n, path: part.path });
  }
  return map;
}

function readComments(xml) {
  const map = new Map();
  for (const c of kids(xml?.documentElement, 'comment')) map.set(wa(c, 'id'), c);
  return map;
}

// ------------------------------------------------------------ content

/**
 * A converter for one story (body, header, footer, note, comment) with its
 * relationships. block(el) → JSON blocks.
 */
function converter(ctx, rels, opts = {}) {
  const fieldStack = [];
  const openComments = new Set();
  let ptabs = []; // positional tabs of the paragraph being read
  void opts;

  /**
   * A TOC field being read: Word writes `TOC \o "1-3" \h` as a complex field
   * that begins in one paragraph and ends in another, with the entries as
   * its cached result. Those paragraphs become a text:table-of-content.
   */
  let toc = null;

  /** One block-level element → [{ block, list? }] (lists are grouped by the caller). */
  function items(el) {
    switch (el.localName) {
      case 'p': {
        if (!toc && !opts.part) {
          const instr = tocInstr(el);
          if (instr) toc = { instr, depth: 0, started: false, blocks: [] };
        }
        if (!toc) return paragraph(el);
        const got = paragraph(el);
        for (const fc of [...el.getElementsByTagName('*')].filter((x) => x.localName === 'fldChar' || x.localName === 'fldSimple')) {
          if (fc.localName === 'fldSimple') continue;
          const t = wa(fc, 'fldCharType');
          if (t === 'begin') { toc.depth++; toc.started = true; } else if (t === 'end') toc.depth--;
        }
        toc.blocks.push(...got.map((g) => g.block).filter((b) => (b.content || []).some((x) => x.type !== 'text' || x.text.trim())));
        if (toc.started && toc.depth > 0) return [];
        const node = tocIndex(ctx, toc);
        toc = null;
        return [{ block: node }];
      }
      case 'tbl': return [{ block: table(el) }];
      case 'sdt': return kids(kid(el, 'sdtContent')).flatMap(items);
      case 'customXml': return kids(el).flatMap(items);
      default: return [];
    }
  }
  /** The blocks of a container (body of a cell, note, comment, header…). */
  const blocksOf = (container) => buildLists(ctx, kids(container).flatMap(items)).map(fixBlock);

  /** One w:p → [{ block, list? }] (a page break inside it splits it). */
  function paragraph(p) {
    const pPr = kid(p, 'pPr');
    const style = opts.part && !kid(pPr, 'pStyle') ? { odt: opts.part === 'header' ? 'Header' : 'Footer', level: 0 } : paraStyle(ctx, pPr);
    const props = paraProps(pPr, inheritedInd(ctx, style.id));
    const numPr = kid(pPr, 'numPr');
    let numId = wa(kid(numPr, 'numId'), 'val');
    let level = num(wa(kid(numPr, 'ilvl'), 'val')) || 0;
    // Numbering can come from the paragraph style (or a style it is based on).
    if (!numPr) {
      for (let st = style, guard = 0; st && guard < 10; st = st.basedOn ? ctx.styles.get(st.basedOn) : null, guard++) {
        if (st.numId) { numId = st.numId; level = st.ilvl; break; }
      }
    }
    if (numId === '0' || (numId && !ctx.numbering.has(numId))) numId = null;
    // Numbered headings stay headings (Word's outline numbering isn't kept).
    if (style.level) numId = null;
    if (numId) { delete props.a['fo:margin-left']; delete props.a['fo:text-indent']; }
    const segments = [[]];
    ptabs = [];
    inlineContent(p, segments, {});
    // Direct tab stops add to the style's; positional tabs become stops at
    // their place (measured from the margin, as all of Word's stops are).
    if (kid(pPr, 'tabs') || ptabs.length) {
      const g = ctx.geometry || { textWidth: 9360 };
      const ind = { ...inheritedInd(ctx, style.id) };
      const own = kid(pPr, 'ind');
      if (own) { ind.left = num(wa(own, 'left') ?? wa(own, 'start')) ?? ind.left; ind.right = num(wa(own, 'right') ?? wa(own, 'end')) ?? ind.right; }
      const extra = ptabs.map((pt) => {
        const lo = pt.relativeTo === 'indent' ? ind.left || 0 : 0;
        const hi = pt.relativeTo === 'indent' ? g.textWidth - (ind.right || 0) : g.textWidth;
        return { pos: pt.alignment === 'right' ? hi : pt.alignment === 'center' ? Math.round((lo + hi) / 2) : lo, val: pt.alignment, leader: pt.leader };
      });
      props.c = props.c.filter((x) => x.n !== 'style:tab-stops');
      const t = mergedTabs(ctx, style.id, [pPr], extra);
      if (t.length) props.c.push(tabStopsTree(t));
    }
    return segments.map((content, i) => {
      const a = { ...props.a };
      // A page break inside the paragraph starts a new paragraph on a new page.
      if (i > 0) a['fo:break-before'] = 'page';
      const auto = autoOf({ para: { a, c: props.c } });
      const attrs = { styleName: style.odt, auto };
      if (style.level) attrs.level = style.level;
      return { block: { type: style.level ? 'heading' : 'paragraph', attrs, content: hoistFloats(mergeText(content)) }, list: numId ? { numId, level } : null };
    });
  }

  /** Inline content of a container into segments (a new segment after each page break). */
  function inlineContent(container, segments, marks) {
    for (const el of kids(container)) inline(el, segments, marks);
  }

  const push = (segments, node) => segments[segments.length - 1].push(node);

  function inline(el, segments, marks) {
    switch (el.localName) {
      case 'r': return run(el, segments, marks);
      case 'hyperlink': {
        const id = el.getAttributeNS(R, 'id') ?? el.getAttribute('r:id');
        const rel = id ? rels.get(id) : null;
        const anchor = wa(el, 'anchor');
        const href = rel?.external ? rel.target : anchor ? `#${anchor}` : rel?.target || '';
        return inlineContent(el, segments, href ? { ...marks, link: href } : marks);
      }
      case 'ins': return inlineContent(el, segments, { ...marks, change: { type: 'insertion', author: wa(el, 'author') || '', date: wa(el, 'date') || '', id: wa(el, 'id') } });
      case 'del': return inlineContent(el, segments, { ...marks, change: { type: 'deletion', author: wa(el, 'author') || '', date: wa(el, 'date') || '', id: wa(el, 'id') } });
      case 'moveFrom': return inlineContent(el, segments, { ...marks, change: { type: 'deletion', author: wa(el, 'author') || '', date: wa(el, 'date') || '', id: wa(el, 'id') } });
      case 'moveTo': return inlineContent(el, segments, { ...marks, change: { type: 'insertion', author: wa(el, 'author') || '', date: wa(el, 'date') || '', id: wa(el, 'id') } });
      case 'smartTag': case 'customXml': case 'dir': case 'bdo': return inlineContent(el, segments, marks);
      case 'sdt': return inlineContent(kid(el, 'sdtContent'), segments, marks);
      case 'fldSimple': {
        const instr = (wa(el, 'instr') || '').trim();
        const field = fieldNode(instr);
        if (field) return push(segments, field);
        const m = instr.match(/^HYPERLINK\s+"([^"]+)"/i);
        return inlineContent(el, segments, m ? { ...marks, link: m[1] } : marks);
      }
      case 'bookmarkStart': {
        const name = wa(el, 'name');
        if (name && !name.startsWith('_')) push(segments, { type: 'bookmark', attrs: { element: 'text:bookmark-start', name } });
        if (name) bookmarks.set(wa(el, 'id'), name.startsWith('_') ? null : name);
        return;
      }
      case 'bookmarkEnd': {
        const name = bookmarks.get(wa(el, 'id'));
        if (name) push(segments, { type: 'bookmark', attrs: { element: 'text:bookmark-end', name } });
        return;
      }
      case 'commentRangeStart': {
        const id = wa(el, 'id');
        const ann = annotation(id);
        if (ann) { openComments.add(id); push(segments, ann); }
        return;
      }
      case 'commentRangeEnd': {
        const id = wa(el, 'id');
        if (openComments.has(id)) push(segments, { type: 'annotation_end', attrs: { name: `__Annotation__${id}` } });
        return;
      }
      case 'oMath': case 'oMathPara': {
        // Equations: their text (Word's OMML isn't converted to MathML).
        const text = [...el.getElementsByTagName('*')].filter((x) => x.localName === 't').map((x) => x.textContent).join('');
        if (text) push(segments, textNode(text, marks, null));
        return;
      }
      default: return undefined;
    }
  }

  const bookmarks = new Map();

  function annotation(id) {
    const c = ctx.comments.get(id);
    if (!c) return null;
    const conv = converter(ctx, ctx.pkg.rels(ctx.commentsPath), { inComment: true });
    const body = conv.blocksOf(c);
    ctx.comments.delete(id);
    return { type: 'annotation', attrs: { name: `__Annotation__${id}`, creator: wa(c, 'author') || '', date: (wa(c, 'date') || '').replace(/Z$/, ''), initials: wa(c, 'initials') || '', body: body.length ? body : [{ type: 'paragraph' }] } };
  }

  function fieldNode(instr) {
    const code = instr.split(/\s+/)[0]?.toUpperCase();
    if (code === 'PAGE') return { type: 'field', attrs: { element: 'text:page-number', fieldAttrs: { 'text:select-page': 'current' }, text: '1' } };
    if (code === 'NUMPAGES') return { type: 'field', attrs: { element: 'text:page-count', fieldAttrs: {}, text: '1' } };
    return null;
  }

  function run(r, segments, marks) {
    const rPr = kid(r, 'rPr');
    const rStyle = wa(kid(rPr, 'rStyle'), 'val');
    const charStyle = rStyle ? ctx.styles.get(rStyle)?.odt : null;
    const tp = textProps(ctx, rPr);
    for (const el of kids(r)) {
      // The innermost field being read (a field can begin and end inside one run).
      const fld = fieldStack[fieldStack.length - 1];
      switch (el.localName) {
        case 't': case 'delText': {
          if (fld && fld.phase !== 'result') break;
          if (fld?.result === 'skip') break;
          push(segments, textNode(el.textContent, fld?.link ? { ...marks, link: fld.link } : marks, { tp, charStyle }));
          break;
        }
        case 'tab': if (!fld || fld.phase === 'result') push(segments, { type: 'tab' }); break;
        case 'ptab': {
          // Positional tab: a tab to a stop at the margin / indent (added to the paragraph).
          if (fld && fld.phase !== 'result') break;
          const pt = { alignment: wa(el, 'alignment') || 'left', relativeTo: wa(el, 'relativeTo') || 'margin', leader: wa(el, 'leader') || 'none' };
          ptabs.push(pt);
          push(segments, { type: 'tab', attrs: { ptab: pt } });
          break;
        }
        case 'br': {
          const type = wa(el, 'type');
          if (type === 'page') segments.push([]);
          else if (type !== 'column') push(segments, { type: 'hard_break' });
          break;
        }
        case 'cr': push(segments, { type: 'hard_break' }); break;
        case 'noBreakHyphen': push(segments, textNode('‑', marks, { tp, charStyle })); break;
        case 'softHyphen': push(segments, textNode('­', marks, { tp, charStyle })); break;
        case 'sym': {
          const ch = String.fromCharCode(parseInt(wa(el, 'char') || '0', 16));
          push(segments, textNode(BULLET[ch] || (/[-]/.test(ch) ? String.fromCharCode(ch.charCodeAt(0) - 0xf000) : ch), marks, { tp, charStyle }));
          break;
        }
        case 'fldChar': {
          const t = wa(el, 'fldCharType');
          if (t === 'begin') fieldStack.push({ phase: 'instr', instr: '' });
          else if (t === 'separate' && fld) {
            fld.phase = 'result';
            const instr = fld.instr.trim();
            const node = fieldNode(instr);
            if (node) { push(segments, node); fld.result = 'skip'; }
            const m = instr.match(/^HYPERLINK\s+(?:\\l\s+)?"([^"]+)"/i);
            if (m) fld.link = /\\l/.test(instr) ? `#${m[1]}` : m[1];
          } else if (t === 'end') {
            const done = fieldStack.pop();
            if (done && done.phase === 'instr') { const node = fieldNode(done.instr.trim()); if (node) push(segments, node); }
          }
          break;
        }
        case 'instrText': if (fld) fld.instr += el.textContent; break;
        case 'footnoteReference': case 'endnoteReference': {
          const cls = el.localName === 'footnoteReference' ? 'footnote' : 'endnote';
          const n = ctx.notes[cls].get(wa(el, 'id'));
          if (!n) break;
          const conv = converter(ctx, ctx.pkg.rels(n.path), { inNote: true });
          const body = conv.blocksOf(n.el);
          const count = ++ctx.noteCount[cls];
          push(segments, { type: 'note', attrs: { noteClass: cls, citation: String(count), body: body.length ? body : [{ type: 'paragraph', attrs: { styleName: cls === 'footnote' ? 'Footnote' : 'Endnote' } }], extra: { 'text:id': `${cls === 'footnote' ? 'ftn' : 'edn'}${count}` } } });
          break;
        }
        case 'footnoteRef': case 'endnoteRef': break;
        case 'commentReference': {
          const id = wa(el, 'id');
          if (!openComments.has(id)) { const ann = annotation(id); if (ann) push(segments, ann); }
          break;
        }
        case 'drawing': { const node = drawing(el); if (node) push(segments, node); break; }
        case 'AlternateContent': {
          // Word writes text boxes and other new objects with a fallback: read the first choice we understand.
          const choice = kids(el, 'Choice')[0] || kid(el, 'Fallback');
          const d = choice && [...choice.getElementsByTagName('*')].find((x) => x.localName === 'drawing');
          if (d) { const node = drawing(d); if (node) push(segments, node); }
          break;
        }
        case 'pict': case 'object': {
          // VML pictures (older files).
          const img = [...el.getElementsByTagName('*')].find((x) => x.localName === 'imagedata');
          const id = img && (img.getAttributeNS(R, 'id') ?? img.getAttribute('r:id'));
          const node = id ? picture(id, 200, 150, '') : null;
          if (node) push(segments, node);
          break;
        }
        default: break;
      }
    }
  }

  function textNode(text, marks, f) {
    const m = [];
    if (marks.link) m.push({ type: 'link', attrs: { href: marks.link } });
    if (f?.charStyle) m.push({ type: 'charStyle', attrs: { name: f.charStyle } });
    if (f?.tp && Object.keys(f.tp).length) m.push({ type: 'textProps', attrs: { auto: { styleAttrs: {}, props: { 'style:text-properties': { a: f.tp } } } } });
    if (marks.change) m.push({ type: marks.change.type, attrs: { author: marks.change.author, date: marks.change.date.replace(/Z$/, ''), cid: `ct${marks.change.id ?? ++ctx.cid}` } });
    return m.length ? { type: 'text', text, marks: m } : { type: 'text', text };
  }

  function drawing(el) {
    const holder = kid(el, 'inline') || kid(el, 'anchor');
    const ext = kid(holder, 'extent');
    const w = emuPx(ext?.getAttribute('cx') || 0) || 200;
    const h = emuPx(ext?.getAttribute('cy') || 0) || 150;
    const doc = kid(holder, 'docPr');
    const alt = doc?.getAttribute('descr') || doc?.getAttribute('title') || '';
    const all = [...holder.getElementsByTagName('*')];
    const blip = all.find((x) => x.localName === 'blip');
    let node = null;
    if (blip) {
      const id = blip.getAttributeNS(R, 'embed') ?? blip.getAttribute('r:embed');
      node = picture(id, w, h, alt);
    } else {
      // A text box: its paragraphs become the box's text.
      const txbx = all.find((x) => x.localName === 'txbxContent');
      if (txbx) {
        const conv = converter(ctx, rels, { inBox: true });
        const body = conv.blocksOf(txbx);
        node = { type: 'frame', attrs: textBoxAttrs({ w, h, name: `Text Box ${++ctx.pictures}`, z: ctx.pictures, body }) };
      }
    }
    if (node && holder.localName === 'anchor') node.attrs = anchored(node.attrs, holder);
    return node;
  }

  function picture(id, w, h, alt) {
    const rel = rels.get(id);
    const bytes = rel?.path ? ctx.files[rel.path] : null;
    if (!bytes) return null;
    const ext = rel.path.split('.').pop().toLowerCase();
    const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff', emf: 'image/x-emf', wmf: 'image/x-wmf' }[ext] || 'application/octet-stream';
    const target = `Pictures/${rel.path.split('/').pop()}`;
    ctx.state.pictures[target] = { bytes, mediaType: mime };
    if (!w || !h) { const s = imageSize(bytes, mime); w = w || s.w; h = h || s.h; }
    return { type: 'frame', attrs: imageAttrs({ path: target, mime, w, h, name: `Picture ${++ctx.pictures}`, title: alt, z: ctx.pictures }) };
  }

  // ---------------------------------------------------------- tables

  function table(tbl) {
    const tblPr = kid(tbl, 'tblPr');
    const styleId = wa(kid(tblPr, 'tblStyle'), 'val');
    const styleEl = styleId ? tableStyleEl(styleId) : null;
    void styleEl;
    const borders = kid(tblPr, 'tblBorders') || tableStyleChain(styleId).map((st) => path(st, 'tblPr', 'tblBorders')).filter(Boolean).pop() || null;
    const grid = kids(kid(tbl, 'tblGrid'), 'gridCol').map((g) => (num(wa(g, 'w')) || 1440) / 15);
    const gridCount = grid.length || 1;
    // Default cell margins of the table (its own, else its style chain's).
    const cellMar = { top: 0, left: 108, bottom: 0, right: 108 };
    for (const mar of [...tableStyleChain(styleId).map((st) => path(st, 'tblPr', 'tblCellMar')), kid(tblPr, 'tblCellMar')]) {
      for (const side of ['top', 'left', 'bottom', 'right']) {
        const v = marginTwips(kid(mar, side) || kid(mar, side === 'left' ? 'start' : side === 'right' ? 'end' : '_'));
        if (v != null) cellMar[side] = v;
      }
    }
    const rows = [];
    const grid2 = []; // every cell with its grid position, for border conflicts
    const pending = []; // vertical merges: column index → cell JSON being extended
    const trs = kids(tbl, 'tr');
    trs.forEach((tr) => {
      const trPr = kid(tr, 'trPr');
      let col = num(wa(kid(trPr, 'gridBefore'), 'val')) || 0;
      const cells = [];
      for (const tc of kids(tr).filter((x) => x.localName === 'tc' || x.localName === 'sdt')) {
        const realTc = tc.localName === 'sdt' ? kid(kid(tc, 'sdtContent'), 'tc') : tc;
        if (!realTc) continue;
        const tcPr = kid(realTc, 'tcPr');
        const span = num(wa(kid(tcPr, 'gridSpan'), 'val')) || 1;
        const vm = kid(tcPr, 'vMerge');
        const vmVal = vm ? (wa(vm, 'val') || 'continue') : null;
        if (vmVal === 'continue' && pending[col]) {
          pending[col].attrs.rowspan += 1;
          col += span;
          continue;
        }
        const content = blocksOf(realTc);
        // Cell margins: w:tcMar → the table's w:tblCellMar → its style's → Word's 108 twips left / right, 0 top / bottom.
        const cellA = {};
        const tcMar = kid(tcPr, 'tcMar');
        for (const side of ['top', 'left', 'bottom', 'right']) {
          const alt = side === 'left' ? 'start' : side === 'right' ? 'end' : null;
          const v = marginTwips(kid(tcMar, side) || kid(tcMar, alt)) ?? cellMar[side];
          cellA[`fo:padding-${side}`] = twipsCm(v);
        }
        // Borders: the cell's own, else the table's (outer edges / inside lines by position).
        const b = kid(tcPr, 'tcBorders');
        const rowIndex = rows.length;
        const sideEls = {};
        for (const side of ['top', 'bottom', 'left', 'right']) {
          const alt = side === 'left' ? 'start' : side === 'right' ? 'end' : '_';
          const outer = side === 'top' ? rowIndex === 0 : side === 'bottom' ? rowIndex === trs.length - 1 : side === 'left' ? col === 0 : col + span >= gridCount;
          const tableEl = outer ? (kid(borders, side) || kid(borders, alt)) : kid(borders, side === 'top' || side === 'bottom' ? 'insideH' : 'insideV');
          sideEls[side] = kid(b, side) || kid(b, alt) || tableEl;
        }
        const fill = wa(kid(tcPr, 'shd'), 'fill');
        if (fill && fill !== 'auto') cellA['fo:background-color'] = `#${fill.toLowerCase()}`;
        const va = wa(kid(tcPr, 'vAlign'), 'val');
        if (va) cellA['style:vertical-align'] = va === 'center' ? 'middle' : va === 'bottom' ? 'bottom' : 'top';
        // Vertical text: tbRl reads top to bottom, btLr bottom to top.
        const dir = wa(kid(tcPr, 'textDirection'), 'val');
        if (dir === 'tbRl' || dir === 'tbRlV' || dir === 'tbLrV') cellA['style:writing-mode'] = 'tb-rl';
        else if (dir === 'btLr') cellA['style:writing-mode'] = 'bt-lr';
        const cell = { type: 'table_cell', attrs: { colspan: span, rowspan: 1, auto: null }, content: content.length ? content : [{ type: 'paragraph' }] };
        grid2.push({ cell, cellA, sideEls, row: rowIndex, col, span });
        cells.push(cell);
        for (let k = 0; k < span; k++) pending[col + k] = vmVal === 'restart' ? cell : null;
        col += span;
      }
      const rowAttrs = { header: !!onOff(kid(trPr, 'tblHeader')) };
      const height = kid(trPr, 'trHeight');
      if (height) {
        const v = num(wa(height, 'val'));
        if (v) rowAttrs.auto = changeAuto(null, 'style:table-row-properties', wa(height, 'hRule') === 'exact' ? { 'style:row-height': twipsCm(v) } : { 'style:min-row-height': twipsCm(v) });
      }
      if (onOff(kid(trPr, 'cantSplit'))) rowAttrs.auto = changeAuto(rowAttrs.auto, 'style:table-row-properties', { 'fo:keep-together': 'always' });
      if (cells.length) rows.push({ type: 'table_row', attrs: rowAttrs, content: cells });
    });
    resolveCellBorders(grid2);
    for (const g of grid2) {
      for (const side of ['top', 'bottom', 'left', 'right']) { const v = border(g.sideEls[side]); if (v) g.cellA[`fo:border-${side}`] = v; }
      g.cell.attrs.auto = changeAuto(null, 'style:table-cell-properties', g.cellA);
    }
    if (!rows.length) rows.push({ type: 'table_row', content: [{ type: 'table_cell', content: [{ type: 'paragraph' }] }] });
    const jc = wa(kid(tblPr, 'jc'), 'val');
    const widthPx = grid.reduce((a, x) => a + x, 0) || 600;
    const tableA = { 'style:width': `${+(widthPx / (96 / 2.54)).toFixed(3)}cm`, 'table:align': jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : 'left' };
    // w:tblInd: the table's left edge from the margin (Word 2013 measures to the cell border).
    const tblInd = marginTwips(kid(tblPr, 'tblInd')) ?? marginTwips(tableStyleChain(styleId).map((st) => path(st, 'tblPr', 'tblInd')).filter(Boolean).pop());
    if (tblInd && tableA['table:align'] === 'left') tableA['fo:margin-left'] = twipsCm(tblInd);
    const node = schema.nodeFromJSON({ type: 'table', attrs: { auto: changeAuto(null, 'style:table-properties', tableA) }, content: rows.map(fixBlock) });
    // Column widths from the grid (one per grid column).
    let cols = grid.length;
    if (!cols) node.firstChild.forEach((c) => { cols += c.attrs.colspan || 1; });
    const widths = grid.length ? grid : Array.from({ length: cols }, () => widthPx / cols);
    return node.type.create(withWidths(node, widths), node.content).toJSON();
  }

  const tableStyleEl = (id) => kids(ctx.stylesXml?.documentElement, 'style').filter((st) => wa(st, 'styleId') === id).pop() || null;
  /** A table style and those it is based on, base first. */
  const tableStyleChain = (id) => {
    const out = [];
    const seen = new Set();
    for (let cur = id; cur && !seen.has(cur);) { seen.add(cur); const el = tableStyleEl(cur); if (!el) break; out.unshift(el); cur = wa(kid(el, 'basedOn'), 'val'); }
    // The default table style applies to tables without one.
    if (!id) { const def = kids(ctx.stylesXml?.documentElement, 'style').find((st) => wa(st, 'type') === 'table' && wa(st, 'default') === '1'); if (def) out.push(def); }
    return out;
  };

  return { items, blocksOf };
}

// ------------------------------------------------------------ table of contents

/** The instruction of a TOC field in a paragraph ("TOC \o "1-3" \h"), or null. */
function tocInstr(p) {
  let instr = '';
  for (const el of p.getElementsByTagName('*')) {
    if (el.localName === 'fldSimple' && /^\s*TOC\b/i.test(wa(el, 'instr') || '')) return wa(el, 'instr').trim();
    if (el.localName === 'instrText') instr += el.textContent;
  }
  return /^\s*TOC\b/i.test(instr) ? instr.trim() : null;
}

/** TOC switches → the editor's TOC options. */
function tocOptionsOf(instr) {
  const o = { ...TOC_DEFAULTS, title: '' };
  const levels = instr.match(/\\o\s+"?(\d)\s*-\s*(\d)"?/);
  o.levels = levels ? Number(levels[2]) : 9;
  o.links = /\\h\b/.test(instr);
  o.pageNumbers = !/\\n\b/.test(instr);
  const sep = instr.match(/\\p\s+"([^"]*)"/);
  if (sep) { o.rightAlign = false; }
  return o;
}

/** A text:table-of-content from a TOC field (its cached entries, or generated later). */
function tocIndex(ctx, t) {
  const o = tocOptionsOf(t.instr);
  ctx.tocCount = (ctx.tocCount || 0) + 1;
  // Entry links in the index's link style (as the editor makes them).
  const restyle = (n) => {
    if (n.marks) n.marks = n.marks.map((m) => (m.type === 'link' ? { ...m, attrs: { ...m.attrs, extra: { 'text:style-name': 'Index_20_Link', 'text:visited-style-name': 'Index_20_Link' } } } : m));
    (n.content || []).forEach(restyle);
  };
  t.blocks.forEach(restyle);
  const node = {
    type: 'index',
    attrs: { element: 'text:table-of-content', attrs: { 'text:protected': 'true', 'text:name': `Table of Contents${ctx.tocCount}` }, source: tocSource(o), titleCount: 0, titleAttrs: null },
    content: t.blocks.length ? t.blocks : [{ type: 'paragraph', attrs: { styleName: 'Contents_20_1' } }],
  };
  (ctx.tocs ||= []).push({ node, o, empty: !t.blocks.length });
  return node;
}

/**
 * Fills TOCs whose field had no cached result (Word updates such fields when
 * the document opens) from the headings, and gives the default Contents
 * styles a right tab at the text width, measured from the margin as Word
 * does. Page numbers follow once the document is laid out.
 */
function fillTocs(ctx, state, out) {
  if (!ctx.tocs?.length) return;
  const width = twipsCm(ctx.firstGeometry?.textWidth || 9360);
  const wordStyles = new Set([...ctx.styles.values()].map((x) => x.odt));
  state.commonStyles = {
    ...state.commonStyles,
    c: (state.commonStyles.c || []).map((t) => {
      if (typeof t === 'string' || t.n !== 'style:style' || !/^Contents_20_\d$/.test(t.a['style:name']) || wordStyles.has(t.a['style:name'])) return t;
      const copy = structuredClone(t);
      for (const pp of copy.c || []) for (const ts of pp.c || []) if (ts.n === 'style:tab-stops') for (const stop of ts.c || []) stop.a['style:position'] = width;
      return copy;
    }),
  };
  let changed = false;
  for (const t of ctx.tocs) {
    if (!t.empty) continue;
    t.node.content = tocBody(state.doc, t.o, () => '');
    ctx.emptyToc = true;
    changed = true;
  }
  if (changed) state.doc = schema.nodeFromJSON({ type: 'doc', content: out.map(fixBlock) });
}

// ------------------------------------------------------------ tables

/** A width element (w:w + w:type) in twips, or null (percentages and auto are not margins). */
function marginTwips(el) {
  if (!el) return null;
  const type = wa(el, 'type') || 'dxa';
  const v = num(wa(el, 'w'));
  if (v == null) return null;
  if (type === 'nil') return 0;
  return type === 'dxa' ? v : null;
}

/**
 * Shared cell edges show one border, chosen by Word's rule (greater
 * width × style number; then the style earlier in the list; then the
 * darker colour). Both cells get the winner, so the browser's collapsing
 * draws exactly that border.
 */
function resolveCellBorders(cells) {
  const at = new Map(); // "row,col" → entry (spans fill several slots)
  for (const g of cells) for (let k = 0; k < g.span; k++) at.set(`${g.row},${g.col + k}`, g);
  for (const g of cells) {
    const right = at.get(`${g.row},${g.col + g.span}`);
    if (right && right !== g && right.row === g.row && right.col === g.col + g.span) {
      const w = strongerBorder(g.sideEls.right, right.sideEls.left);
      g.sideEls.right = w; right.sideEls.left = w;
    }
    const below = at.get(`${g.row + 1},${g.col}`);
    if (below && below !== g && below.col === g.col && below.span === g.span) {
      const w = strongerBorder(g.sideEls.bottom, below.sideEls.top);
      g.sideEls.bottom = w; below.sideEls.top = w;
    }
  }
}

// ------------------------------------------------------------ floating objects

const H_REL = { page: 'page', margin: 'page-content', column: 'paragraph', character: 'char', leftMargin: 'page-start-margin', rightMargin: 'page-end-margin', insideMargin: 'page-start-margin', outsideMargin: 'page-end-margin' };
const V_REL = { page: 'page', margin: 'page-content', paragraph: 'paragraph', line: 'line', topMargin: 'page', bottomMargin: 'page', insideMargin: 'page', outsideMargin: 'page' };
const H_ALIGN = { left: 'left', center: 'center', right: 'right', inside: 'inside', outside: 'outside' };
const V_ALIGN = { top: 'top', center: 'middle', bottom: 'bottom', inside: 'top', outside: 'bottom' };
const WRAP_SIDE = { bothSides: 'parallel', left: 'left', right: 'right', largest: 'biggest' };

/**
 * A wp:anchor's position, wrapping and distances → a floating ODF frame
 * anchored to its paragraph (or character): svg:x / svg:y from posOffset,
 * style:horizontal-pos / -rel and vertical-pos / -rel from align and
 * relativeFrom, style:wrap from wrapSquare / Tight / Through / TopAndBottom /
 * None + behindDoc, and fo:margin-* from distT / B / L / R.
 */
function anchored(attrs, holder) {
  const posH = kid(holder, 'positionH');
  const posV = kid(holder, 'positionV');
  const relH = posH?.getAttribute('relativeFrom') || 'column';
  const relV = posV?.getAttribute('relativeFrom') || 'paragraph';
  const alignH = kid(posH, 'align')?.textContent?.trim();
  const alignV = kid(posV, 'align')?.textContent?.trim();
  const offH = kid(posH, 'posOffset')?.textContent;
  const offV = kid(posV, 'posOffset')?.textContent;
  const wrapEl = kids(holder).find((c) => /^wrap/.test(c.localName));
  const behind = onOffAttr(holder.getAttribute('behindDoc'));
  const wrap = { wrapSquare: 'square', wrapTight: 'tight', wrapThrough: 'through', wrapTopAndBottom: 'topBottom' }[wrapEl?.localName] || (behind ? 'behind' : 'front');
  const x = offH != null ? emuPx(offH) : 0;
  const y = offV != null ? emuPx(offV) : 0;
  let next = withWrap(attrs, wrap, { x, y });
  if (relH === 'character' || relV === 'line') next = withFrameAttrs(next, { 'text:anchor-type': 'char' });
  next = withPosition(next, {
    x: alignH ? null : x, y: alignV ? null : y,
    hpos: alignH ? H_ALIGN[alignH] || 'left' : 'from-left', hrel: H_REL[relH] || 'paragraph',
    vpos: alignV ? V_ALIGN[alignV] || 'top' : 'from-top', vrel: V_REL[relV] || 'paragraph',
  });
  if (alignH) next = withFrameAttrs(next, { 'svg:x': null });
  if (alignV) next = withFrameAttrs(next, { 'svg:y': null });
  const dist = (n) => `${+(emuPx(holder.getAttribute(n) || 0) / (96 / 2.54)).toFixed(3)}cm`;
  const g = { 'fo:margin-top': dist('distT'), 'fo:margin-bottom': dist('distB'), 'fo:margin-left': dist('distL'), 'fo:margin-right': dist('distR') };
  const side = WRAP_SIDE[wrapEl?.getAttribute('wrapText')];
  if ((wrap === 'square' || wrap === 'tight' || wrap === 'through') && side && side !== 'parallel') g['style:wrap'] = side;
  next = withGraphic(next, g);
  const z = num(holder.getAttribute('relativeHeight'));
  if (z != null) next = withFrameAttrs(next, { 'draw:z-index': String(Math.max(0, z - 251658240)) });
  return next;
}

/** Paragraph-anchored frames go first in their paragraph, where Word measures them from. */
function hoistFloats(content) {
  const isFloat = (n) => n.type === 'frame' && (n.attrs.frameAttrs?.['text:anchor-type'] || 'paragraph') === 'paragraph';
  return [...content.filter(isFloat), ...content.filter((n) => !isFloat(n))];
}

/** Joins neighbouring text with the same marks. */
function mergeText(content) {
  const out = [];
  for (const n of content) {
    const last = out[out.length - 1];
    if (n.type === 'text' && !n.text) continue;
    if (last?.type === 'text' && n.type === 'text' && JSON.stringify(last.marks || []) === JSON.stringify(n.marks || [])) last.text += n.text;
    else out.push(n);
  }
  return out;
}

// ------------------------------------------------------------ properties (docProps/core.xml)

function readProperties(state, files) {
  const xml = parse(files['docProps/core.xml']);
  if (!xml) return;
  const get = (local) => [...xml.documentElement.children].find((e) => e.localName === local)?.textContent?.trim() || '';
  const c = (state.meta.c || []).filter((t) => typeof t === 'string' || !['dc:title', 'dc:subject', 'dc:description', 'meta:initial-creator', 'dc:creator', 'meta:keyword', 'meta:creation-date', 'dc:date'].includes(t.n));
  const add = (n, v) => { if (v) c.push({ n, a: {}, c: [v] }); };
  add('dc:title', get('title'));
  add('dc:subject', get('subject'));
  add('dc:description', get('description'));
  add('meta:initial-creator', get('creator'));
  add('dc:creator', get('lastModifiedBy'));
  for (const k of get('keywords').split(/\s*[,;]\s*/).filter(Boolean)) add('meta:keyword', k);
  add('meta:creation-date', get('created').replace(/Z$/, ''));
  add('dc:date', get('modified').replace(/Z$/, ''));
  state.meta = { ...state.meta, c };
}
