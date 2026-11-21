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
import { writePart } from '../hf-content.js';
import { imageAttrs, textBoxAttrs } from '../objects.js';
import { imageSize } from './readers.js';

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
const twipsCm = (t) => `${+(Number(t) / 567).toFixed(3)}cm`;
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

/** A Word border element → an ODF border value, or null. */
function border(el) {
  if (!el) return null;
  const v = wa(el, 'val');
  if (!v || v === 'nil' || v === 'none') return 'none';
  const sz = num(wa(el, 'sz')) || 4; // eighths of a point
  const colour = wa(el, 'color');
  return `${+(sz / 8).toFixed(2)}pt ${BORDER_STYLE[v] || 'solid'} ${colour && colour !== 'auto' ? `#${colour.toLowerCase()}` : '#000000'}`;
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
  const evenOdd = !!kid(settings?.documentElement, 'evenAndOddHeaders');

  // Body: blocks, split into sections at every sectPr.
  const body = kid(docXml.documentElement, 'body');
  const sections = [];
  let current = [];
  const conv = converter(ctx, mainRels);
  for (const el of kids(body)) {
    if (el.localName === 'sectPr') continue;
    current.push(...conv.items(el));
    const sp = el.localName === 'p' ? path(el, 'pPr', 'sectPr') : null;
    if (sp) { sections.push({ blocks: buildLists(ctx, current), sectPr: sp }); current = []; }
  }
  sections.push({ blocks: buildLists(ctx, current), sectPr: kid(body, 'sectPr') });

  // Page styles: the first section uses "Standard"; later ones get their own.
  const out = [];
  let master = 'Standard';
  sections.forEach((sec, i) => {
    const sp = sec.sectPr;
    const type = wa(kid(sp, 'type'), 'val') || 'nextPage';
    const geometry = pageGeometry(sp);
    const prevGeometry = i ? pageGeometry(sections[i - 1].sectPr) : null;
    const hasOwnParts = sp && (kids(sp, 'headerReference').length || kids(sp, 'footerReference').length);
    // A continuous break with the same page keeps the page style (columns become a section).
    const newPage = i === 0 || type !== 'continuous' || JSON.stringify(geometry.attrs) !== JSON.stringify(prevGeometry.attrs) || hasOwnParts;
    if (i > 0 && newPage) {
      master = newSectionMaster(state, master, { usage: type === 'evenPage' ? 'left' : type === 'oddPage' ? 'right' : null });
      // The section's first paragraph starts the new page style.
      const firstText = findFirstTextblock(sec.blocks);
      if (firstText) firstText.attrs = { ...firstText.attrs, auto: { ...(firstText.attrs.auto || { props: {} }), styleAttrs: { ...(firstText.attrs.auto?.styleAttrs || {}), 'style:master-page-name': master } } };
      else sec.blocks.unshift({ type: 'paragraph', attrs: { styleName: 'Standard', auto: { styleAttrs: { 'style:master-page-name': master }, props: {} } } });
    }
    if (newPage) {
      const titlePg = !!onOff(kid(sp, 'titlePg'));
      updatePageLayouts(state, [master], () => geometry.change);
      if (sp) readHeadersFooters(ctx, state, master, sp, { titlePg, evenOdd });
      // Each section decides whether its first page / even pages have their own header and footer.
      setPartOptions(state, [master], { firstPage: titlePg, oddEven: evenOdd });
    }
    // Columns: on the page style when the page has them throughout, otherwise a section.
    if (geometry.columns > 1) {
      if (newPage) updatePageLayouts(state, [master], () => ({ columns: { count: geometry.columns, gap: geometry.gap } }));
      else {
        const name = setSectionStyle(state, null, { count: geometry.columns, gap: geometry.gap });
        sec.blocks = [{ type: 'section', attrs: { name: `Section${i + 1}`, styleName: name }, content: sec.blocks.length ? sec.blocks : [{ type: 'paragraph' }] }];
      }
    }
    out.push(...sec.blocks);
  });
  if (!out.length) out.push({ type: 'paragraph', attrs: { styleName: 'Standard' } });
  state.doc = schema.nodeFromJSON({ type: 'doc', content: out.map(fixBlock) });
  state.fontFaces = [...(state.fontFaces || []), ...fontFaces(ctx, state)];
  readProperties(state, files);
  return { state, warnings: ctx.warnings };
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

function pageGeometry(sp) {
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
  const hasHeader = !!kid(sp, 'headerReference');
  const hasFooter = !!kid(sp, 'footerReference');
  const attrs = {
    'fo:page-width': twipsCm(w), 'fo:page-height': twipsCm(h), 'style:print-orientation': landscape ? 'landscape' : 'portrait',
    // ODF margins reach the header / footer when there is one; Word's reach the body.
    'fo:margin-top': twipsCm(hasHeader ? header : Math.abs(top)), 'fo:margin-bottom': twipsCm(hasFooter ? footer : Math.abs(bottom)),
    'fo:margin-left': twipsCm(num(wa(mar, 'left')) ?? num(wa(mar, 'start')) ?? 1440), 'fo:margin-right': twipsCm(num(wa(mar, 'right')) ?? num(wa(mar, 'end')) ?? 1440),
  };
  const change = { attrs };
  // The header / footer takes the space between the two distances.
  if (hasHeader) change.header = { 'fo:min-height': '0cm', 'fo:margin-bottom': twipsCm(Math.max(57, Math.abs(top) - header - 280)) };
  if (hasFooter) change.footer = { 'fo:min-height': '0cm', 'fo:margin-top': twipsCm(Math.max(57, Math.abs(bottom) - footer - 280)) };
  const count = num(wa(cols, 'num')) || 1;
  return { attrs, change, columns: count, gap: (num(wa(cols, 'space')) ?? 720) / 567 };
}

function readHeadersFooters(ctx, state, master, sp, { titlePg, evenOdd }) {
  const mainRels = ctx.pkg.rels(ctx.pkg.mainPath);
  let wantFirst = false;
  let wantLeft = false;
  const parts = [];
  for (const part of ['header', 'footer']) {
    for (const ref of kids(sp, `${part}Reference`)) {
      const type = wa(ref, 'type') || 'default';
      const rel = mainRels.get(ref.getAttributeNS(R, 'id') ?? ref.getAttribute('r:id'));
      if (!rel?.path || !ctx.files[rel.path]) continue;
      if (type === 'first' && !titlePg) continue;
      if (type === 'even' && !evenOdd) continue;
      if (type === 'first') wantFirst = true;
      if (type === 'even') wantLeft = true;
      parts.push({ part, kind: type === 'first' ? 'first' : type === 'even' ? 'left' : null, rel });
    }
  }
  // The default part first (first / even variants are added next to it).
  parts.sort((a, b) => (a.kind ? 1 : 0) - (b.kind ? 1 : 0));
  for (const p of parts) {
    const xml = parse(ctx.files[p.rel.path]);
    const conv = converter(ctx, ctx.pkg.rels(p.rel.path), { part: p.part });
    const blocks = conv.blocksOf(xml.documentElement);
    const doc = schema.nodeFromJSON({ type: 'doc', content: (blocks.length ? blocks : [{ type: 'paragraph', attrs: { styleName: p.part === 'header' ? 'Header' : 'Footer' } }]).map(fixBlock) });
    writePart(state, master, p.part, p.kind, doc);
  }
  void wantFirst;
  void wantLeft;
}

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

/** w:pPr → ODF paragraph properties { a, c } (c: tab stops). */
function paraProps(pPr) {
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
  if (bdr) for (const [side, odf] of [['top', 'top'], ['bottom', 'bottom'], ['left', 'left'], ['right', 'right']]) { const v = border(kid(bdr, side)); if (v) a[`fo:border-${odf}`] = v; }
  const bidi = onOff(kid(pPr, 'bidi'));
  if (bidi) a['style:writing-mode'] = 'rl-tb';
  const tabs = kids(kid(pPr, 'tabs'), 'tab').filter((t) => wa(t, 'val') !== 'clear');
  if (tabs.length) {
    c.push({
      n: 'style:tab-stops', a: {},
      c: tabs.map((t) => {
        const ta = { 'style:position': twipsCm(num(wa(t, 'pos')) || 0) };
        const v = wa(t, 'val');
        if (v === 'center') ta['style:type'] = 'center';
        if (v === 'right' || v === 'end') ta['style:type'] = 'right';
        if (v === 'decimal') { ta['style:type'] = 'char'; ta['style:char'] = '.'; }
        const leader = wa(t, 'leader');
        if (leader && leader !== 'none') { ta['style:leader-style'] = leader === 'dot' ? 'dotted' : 'solid'; ta['style:leader-text'] = leader === 'dot' ? '.' : leader === 'hyphen' ? '-' : '_'; }
        return { n: 'style:tab-stop', a: ta };
      }),
    });
  }
  return { a, c };
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
    const auto = autoOf({ para: info.family === 'paragraph' ? paraProps(kid(s, 'pPr')) : null, text: textProps(ctx, kid(s, 'rPr')) }) || { styleAttrs: {}, props: {} };
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
        left: num(wa(ind, 'left') ?? wa(ind, 'start')), hanging: num(wa(ind, 'hanging')),
        font: wa(path(lvl, 'rPr', 'rFonts'), 'ascii'),
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
  // Word's indents for each level.
  (def?.abstract?.levels || []).forEach((l, i) => {
    const el = tree.c[i];
    const la = el?.c?.[0]?.c?.[0];
    if (!l || !la || l.left == null) return;
    la.a['fo:margin-left'] = twipsCm(l.left);
    la.a['text:list-tab-stop-position'] = twipsCm(l.left);
    la.a['fo:text-indent'] = twipsCm(-(l.hanging ?? 360));
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
  void opts;

  /** One block-level element → [{ block, list? }] (lists are grouped by the caller). */
  function items(el) {
    switch (el.localName) {
      case 'p': return paragraph(el);
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
    const props = paraProps(pPr);
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
    inlineContent(p, segments, {});
    return segments.map((content, i) => {
      const a = { ...props.a };
      // A page break inside the paragraph starts a new paragraph on a new page.
      if (i > 0) a['fo:break-before'] = 'page';
      const auto = autoOf({ para: { a, c: props.c } });
      const attrs = { styleName: style.odt, auto };
      if (style.level) attrs.level = style.level;
      return { block: { type: style.level ? 'heading' : 'paragraph', attrs, content: mergeText(content) }, list: numId ? { numId, level } : null };
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
    if (blip) {
      const id = blip.getAttributeNS(R, 'embed') ?? blip.getAttribute('r:embed');
      return picture(id, w, h, alt);
    }
    // A text box: its paragraphs become the box's text.
    const txbx = all.find((x) => x.localName === 'txbxContent');
    if (txbx) {
      const conv = converter(ctx, rels, { inBox: true });
      const body = conv.blocksOf(txbx);
      return { type: 'frame', attrs: textBoxAttrs({ w, h, name: `Text Box ${++ctx.pictures}`, z: ctx.pictures, body }) };
    }
    return null;
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
    const borders = kid(tblPr, 'tblBorders') || path(styleEl, 'tblPr', 'tblBorders');
    const grid = kids(kid(tbl, 'tblGrid'), 'gridCol').map((g) => (num(wa(g, 'w')) || 1440) / 15);
    const rows = [];
    const pending = []; // vertical merges: column index → cell JSON being extended
    kids(tbl, 'tr').forEach((tr) => {
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
        const cellA = { 'fo:padding-left': '0.19cm', 'fo:padding-right': '0.19cm', 'fo:padding-top': '0cm', 'fo:padding-bottom': '0cm' };
        const b = kid(tcPr, 'tcBorders');
        for (const side of ['top', 'bottom', 'left', 'right']) {
          const v = border(kid(b, side) || kid(b, side === 'left' ? 'start' : side === 'right' ? 'end' : '_')) || border(kid(borders, side) || kid(borders, side === 'left' ? 'start' : side === 'right' ? 'end' : '_')) || border(kid(borders, side === 'top' || side === 'bottom' ? 'insideH' : 'insideV'));
          if (v) cellA[`fo:border-${side}`] = v;
        }
        const fill = wa(kid(tcPr, 'shd'), 'fill');
        if (fill && fill !== 'auto') cellA['fo:background-color'] = `#${fill.toLowerCase()}`;
        const va = wa(kid(tcPr, 'vAlign'), 'val');
        if (va) cellA['style:vertical-align'] = va === 'center' ? 'middle' : va === 'bottom' ? 'bottom' : 'top';
        const cell = { type: 'table_cell', attrs: { colspan: span, rowspan: 1, auto: changeAuto(null, 'style:table-cell-properties', cellA) }, content: content.length ? content : [{ type: 'paragraph' }] };
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
    if (!rows.length) rows.push({ type: 'table_row', content: [{ type: 'table_cell', content: [{ type: 'paragraph' }] }] });
    const jc = wa(kid(tblPr, 'jc'), 'val');
    const widthPx = grid.reduce((a, x) => a + x, 0) || 600;
    const node = schema.nodeFromJSON({ type: 'table', attrs: { auto: changeAuto(null, 'style:table-properties', { 'style:width': `${+(widthPx / (96 / 2.54)).toFixed(3)}cm`, 'table:align': jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : 'left' }) }, content: rows.map(fixBlock) });
    // Column widths from the grid (one per grid column).
    let cols = grid.length;
    if (!cols) node.firstChild.forEach((c) => { cols += c.attrs.colspan || 1; });
    const widths = grid.length ? grid : Array.from({ length: cols }, () => widthPx / cols);
    return node.type.create(withWidths(node, widths), node.content).toJSON();
  }

  const tableStyleEl = (id) => kids(ctx.stylesXml?.documentElement, 'style').find((st) => wa(st, 'styleId') === id) || null;

  return { items, blocksOf };
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
