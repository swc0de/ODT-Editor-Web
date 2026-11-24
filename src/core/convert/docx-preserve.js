/**
 * Keeping a .docx the app didn't create intact (M15 §4).
 *
 * The reader keeps the original package on the state (state.docxSource):
 *   files      the original parts map
 *   mainPath   the main document part
 *   rootAttrs  namespace declarations and mc:Ignorable of the main part's root
 *   groups     top-level body elements grouped with the blocks they became:
 *              { xml: [element XML…], json, sect } (sect: the original sectPr
 *              the group ends with, if any)
 *   sectPrs    every original sectPr, in order
 *   snap       JSON snapshots of the model at open (doc, styles, pages)
 *
 * On save the writer regenerates the parts the editor owns, reusing the
 * original XML of every group whose blocks are unchanged; everything else in
 * the package is copied through with its relationships and content type.
 * This module holds the XML-level helpers for that: splitting children,
 * ordering them as the schema requires, patching sectPr / settings / core
 * properties, merging styles and numbering, and the package merge.
 */
import { strFromU8, strToU8 } from 'fflate';
import { contentTypes } from './flat-opc.js';

const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const RELS_CT = 'application/vnd.openxmlformats-package.relationships+xml';

// ------------------------------------------------------------ XML splitting

/**
 * The top-level children of an XML fragment: [{ name, xml, start, end }]
 * (text between elements is ignored). Handles comments, CDATA and PIs.
 */
export function splitChildren(fragment) {
  const out = [];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<(\/?)([\w:.-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  let depth = 0;
  let cur = null;
  for (let m; (m = re.exec(fragment));) {
    if (!m[2]) continue;
    const closing = m[1] === '/';
    const selfClosing = m[4] === '/';
    if (!closing) {
      if (depth === 0) cur = { name: m[2], start: m.index };
      if (!selfClosing) depth++;
      else if (depth === 0) { out.push({ ...cur, end: re.lastIndex, xml: fragment.slice(cur.start, re.lastIndex) }); cur = null; }
    } else {
      depth--;
      if (depth === 0 && cur) { out.push({ ...cur, end: re.lastIndex, xml: fragment.slice(cur.start, re.lastIndex) }); cur = null; }
    }
  }
  return out;
}

/** An element's start tag, inner XML and end tag ({ start, inner, end, name }), or null. */
export function parts(xml) {
  const m = /^<([\w:.-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/.exec(xml);
  if (!m) return null;
  if (m[3] === '/') return { name: m[1], start: `<${m[1]}${m[2]}>`, inner: '', end: `</${m[1]}>` };
  const endTag = `</${m[1]}>`;
  return { name: m[1], start: m[0], inner: xml.slice(m[0].length, xml.length - endTag.length), end: endTag };
}

const local = (name) => name.replace(/^[\w.-]+:/, '');

/** Children ordered by a schema sequence (unknown names keep their place after known predecessors). */
export function orderChildren(children, order) {
  const rank = (c) => { const i = order.indexOf(local(c.name)); return i < 0 ? null : i; };
  const known = children.filter((c) => rank(c) != null).sort((a, b) => rank(a) - rank(b));
  // Unknown children (extensions) go after the last known one that preceded them originally.
  const out = [...known];
  children.forEach((c, i) => {
    if (rank(c) != null) return;
    const before = children.slice(0, i).reverse().find((x) => rank(x) != null);
    const at = before ? out.indexOf(before) + 1 : 0;
    out.splice(at, 0, c);
  });
  return out;
}

// ------------------------------------------------------------ sectPr

const SECTPR_ORDER = ['headerReference', 'footerReference', 'footnotePr', 'endnotePr', 'type', 'pgSz', 'pgMar', 'paperSrc', 'pgBorders', 'lnNumType', 'pgNumType', 'cols', 'formProt', 'vAlign', 'noEndnote', 'titlePg', 'textDirection', 'bidi', 'rtlGutter', 'docGrid', 'printerSettings', 'sectPrChange'];
/** What the writer decides in a sectPr; the rest comes from the original. */
const SECTPR_OWNED = new Set(['headerReference', 'footerReference', 'type', 'pgSz', 'pgMar', 'cols', 'titlePg']);

const unesc = (v) => v.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&');
const attrsOf = (start) => { const o = {}; for (const m of start.matchAll(/\s([\w:.-]+)="([^"]*)"/g)) o[m[1]] = m[2]; return o; };
/** Attributes with entities decoded (relationship targets). */
const attrsText = (start) => Object.fromEntries(Object.entries(attrsOf(start)).map(([k, v]) => [k, unesc(v)]));
const startWith = (name, attrs, selfClose) => `<${name}${Object.entries(attrs).map(([k, v]) => ` ${k}="${v}"`).join('')}${selfClose ? '/>' : '>'}`;

/**
 * The writer's sectPr merged into the original one: the writer's page size,
 * margins, columns, header / footer references, type and title page; the
 * original's grid, line numbering, page borders, number format, printer
 * settings, extensions… The page-number start merges into pgNumType.
 */
export function patchSectPr(generated, original) {
  if (!original) return generated;
  const g = parts(generated);
  const o = parts(original);
  if (!g || !o) return generated;
  const gen = splitChildren(g.inner);
  const orig = splitChildren(o.inner);
  const kept = orig.filter((c) => !SECTPR_OWNED.has(local(c.name)));
  // A generated setting equal to the original's (by the values that matter) is written as the original.
  const SAME = {
    pgSz: ['w:w', 'w:h'], pgMar: ['w:top', 'w:right', 'w:bottom', 'w:left'], type: ['w:val'], titlePg: [],
    cols: ['w:num', 'w:space', 'w:sep'],
  };
  const genOwned = gen.filter((c) => SECTPR_OWNED.has(local(c.name))).map((g) => {
    const keys = SAME[local(g.name)];
    const o = keys && orig.find((x) => x.name === g.name);
    if (!o) return g;
    const ga = attrsOf(/^<[^>]*>/.exec(g.xml)[0]);
    const oa = attrsOf(/^<[^>]*>/.exec(o.xml)[0]);
    const norm = (a, k) => (a[k] == null ? ({ 'w:num': '1', 'w:sep': '0', 'w:val': local(g.name) === 'type' ? 'nextPage' : undefined }[k]) : String(a[k]).replace(/^(true|on)$/, '1').replace(/^(false|off)$/, '0'));
    if (local(g.name) === 'cols' && norm(ga, 'w:num') === '1' && norm(oa, 'w:num') === '1') return o;
    return keys.every((k) => norm(ga, k) === norm(oa, k)) ? o : g;
  });
  const genNum = gen.find((c) => local(c.name) === 'pgNumType');
  const origNum = kept.find((c) => local(c.name) === 'pgNumType');
  if (origNum) {
    const a = attrsOf(origNum.xml);
    delete a['w:start'];
    if (genNum) Object.assign(a, attrsOf(genNum.xml));
    origNum.xml = startWith(origNum.name, a, true);
  } else if (genNum) kept.push(genNum);
  const merged = orderChildren([...genOwned, ...kept], SECTPR_ORDER);
  return `${o.start}${merged.map((c) => c.xml).join('')}${o.end}`;
}

// ------------------------------------------------------------ pPr / rPr extras

export const PPR_ORDER = ['pStyle', 'keepNext', 'keepLines', 'pageBreakBefore', 'framePr', 'widowControl', 'numPr', 'suppressLineNumbers', 'pBdr', 'shd', 'tabs', 'suppressAutoHyphens', 'kinsoku', 'wordWrap', 'overflowPunct', 'topLinePunct', 'autoSpaceDE', 'autoSpaceDN', 'bidi', 'adjustRightInd', 'snapToGrid', 'spacing', 'ind', 'contextualSpacing', 'mirrorIndents', 'suppressOverlap', 'jc', 'textDirection', 'textAlignment', 'textboxTightWrap', 'outlineLvl', 'divId', 'cnfStyle', 'rPr', 'sectPr', 'pPrChange'];
export const RPR_ORDER = ['rStyle', 'rFonts', 'b', 'bCs', 'i', 'iCs', 'caps', 'smallCaps', 'strike', 'dstrike', 'outline', 'shadow', 'emboss', 'imprint', 'noProof', 'snapToGrid', 'vanish', 'webHidden', 'color', 'spacing', 'w', 'kern', 'position', 'sz', 'szCs', 'highlight', 'u', 'effect', 'bdr', 'shd', 'fitText', 'vertAlign', 'rtl', 'cs', 'em', 'lang', 'eastAsianLayout', 'specVanish', 'oMath', 'rPrChange'];
export const PPR_MAPPED = new Set(['w:pStyle', 'w:keepNext', 'w:keepLines', 'w:pageBreakBefore', 'w:widowControl', 'w:numPr', 'w:pBdr', 'w:shd', 'w:tabs', 'w:bidi', 'w:spacing', 'w:ind', 'w:contextualSpacing', 'w:jc', 'w:outlineLvl', 'w:sectPr']);
export const RPR_MAPPED = new Set(['w:rStyle', 'w:rFonts', 'w:b', 'w:i', 'w:caps', 'w:smallCaps', 'w:strike', 'w:dstrike', 'w:outline', 'w:shadow', 'w:vanish', 'w:color', 'w:spacing', 'w:sz', 'w:szCs', 'w:highlight', 'w:u', 'w:shd', 'w:vertAlign', 'w:lang']);

const W_DECL = /\sxmlns:w="http:\/\/schemas\.openxmlformats\.org\/wordprocessingml\/2006\/main"/g;
const noDecl = (xml) => xml.replace(/\sxmlns(?::[\w.-]+)?="[^"]*"/g, '');
const attrSet = (xml) => { const t = /^<[\w:.-]+((?:[^>"']|"[^"]*"|'[^']*')*?)\/?>/.exec(xml)?.[1] || ''; const o = {}; for (const m of t.matchAll(/\s([\w:.-]+)="([^"]*)"/g)) if (!m[1].startsWith('xmlns')) o[m[1]] = m[2]; return o; };

/**
 * The writer's pPr / rPr children merged with the original ones (kept on the
 * model): a generated child the original had with the same values (and
 * more, e.g. theme fonts or language variants) is written as the original;
 * original children the reader doesn't map (format changes, extensions…)
 * are added; mapped ones the writer no longer writes are dropped.
 * @param {string} generatedInner the generated element's children
 * @param {string[]|null} extras original children (raw XML)
 */
export function mergeProps(generatedInner, extras, order, mapped) {
  if (!extras?.length) return generatedInner;
  const gen = splitChildren(generatedInner || '');
  const orig = extras.map((xml) => ({ name: /^<([\w:.-]+)/.exec(xml)?.[1] || '', xml: xml.replace(W_DECL, '') }));
  const used = new Set();
  const out = gen.map((g) => {
    const o = orig.find((x) => x.name === g.name);
    if (!o) return g;
    used.add(o);
    const selfClosing = /\/>$/.test(g.xml) && /\/>$/.test(o.xml.trim());
    if (selfClosing) {
      const ga = attrSet(g.xml);
      const oa = attrSet(o.xml);
      if (Object.entries(ga).every(([k, v]) => oa[k] === v)) return o;
      // Indents written another way (start / left, hanging / negative first line) with the same values.
      if (g.name === 'w:ind') {
        const n = (x) => ({ l: Number(x['w:left'] ?? x['w:start'] ?? 0), r: Number(x['w:right'] ?? x['w:end'] ?? 0), f: Number(x['w:firstLine'] ?? 0) - Number(x['w:hanging'] ?? 0) });
        const [p, q] = [n(ga), n(oa)];
        if (p.l === q.l && p.r === q.r && p.f === q.f) return o;
      }
      return g;
    }
    return noDecl(o.xml) === noDecl(g.xml) ? o : g;
  });
  // Original children the writer didn't write: kept unless the reader maps them (the model decides
  // those), except explicit "off" values and the default paragraph style, which mean what absence means.
  // (an empty element, or one whose every value is zero / off / none).
  const meansDefault = (o) => {
    const x = noDecl(o.xml).trim();
    if (/^<w:pStyle\b[^>]*w:val="Normal"/.test(x)) return true;
    if (!/\/>$/.test(x)) return false;
    return Object.values(attrSet(x)).every((v) => /^(0|false|off|none|nil)$/.test(v));
  };
  for (const o of orig) if (!used.has(o) && (!mapped.has(o.name) || meansDefault(o)) && !out.some((x) => x.name === o.name)) out.push(o);
  const wOrder = (c) => (c.name.startsWith('w:') ? c.name : `~${c.name}`);
  return orderChildren(out.map((c) => ({ ...c, name: wOrder(c) })), order).map((c) => c.xml).join('');
}

// ------------------------------------------------------------ settings.xml

const SETTINGS_ORDER = ['writeProtection', 'view', 'zoom', 'removePersonalInformation', 'removeDateAndTime', 'doNotDisplayPageBoundaries', 'displayBackgroundShape', 'printPostScriptOverText', 'printFractionalCharacterWidth', 'printFormsData', 'embedTrueTypeFonts', 'embedSystemFonts', 'saveSubsetFonts', 'saveFormsData', 'mirrorMargins', 'alignBordersAndEdges', 'bordersDoNotSurroundHeader', 'bordersDoNotSurroundFooter', 'gutterAtTop', 'hideSpellingErrors', 'hideGrammaticalErrors', 'activeWritingStyle', 'proofState', 'formsDesign', 'attachedTemplate', 'linkStyles', 'stylePaneFormatFilter', 'stylePaneSortMethod', 'documentType', 'mailMerge', 'revisionView', 'trackRevisions', 'doNotTrackMoves', 'doNotTrackFormatting', 'documentProtection', 'autoFormatOverride', 'styleLockTheme', 'styleLockQFSet', 'defaultTabStop', 'autoHyphenation', 'consecutiveHyphenLimit', 'hyphenationZone', 'doNotHyphenateCaps', 'showEnvelope', 'summaryLength', 'clickAndTypeStyle', 'defaultTableStyle', 'evenAndOddHeaders', 'bookFoldRevPrinting', 'bookFoldPrinting', 'bookFoldPrintingSheets', 'drawingGridHorizontalSpacing', 'drawingGridVerticalSpacing', 'displayHorizontalDrawingGridEvery', 'displayVerticalDrawingGridEvery', 'doNotUseMarginsForDrawingGridOrigin', 'drawingGridHorizontalOrigin', 'drawingGridVerticalOrigin', 'doNotShadeFormData', 'noPunctuationKerning', 'characterSpacingControl', 'printTwoOnOne', 'strictFirstAndLastChars', 'noLineBreaksAfter', 'noLineBreaksBefore', 'savePreviewPicture', 'doNotValidateAgainstSchema', 'saveInvalidXml', 'ignoreMixedContent', 'alwaysShowPlaceholderText', 'doNotDemarcateInvalidXml', 'saveXmlDataOnly', 'useXSLTWhenSaving', 'saveThroughXslt', 'showXMLTags', 'alwaysMergeEmptyNamespace', 'updateFields', 'hdrShapeDefaults', 'footnotePr', 'endnotePr', 'compat', 'docVars', 'rsids', 'mathPr', 'attachedSchema', 'themeFontLang', 'clrSchemeMapping', 'doNotIncludeSubdocsInStats', 'doNotAutoCompressPictures', 'forceUpgrade', 'captions', 'readModeInkLockDown', 'smartTagType', 'schemaLibrary', 'shapeDefaults', 'doNotEmbedSmartTags', 'decimalSymbol', 'listSeparator'];

/**
 * The original settings.xml with only what the editor changes patched in.
 * @param {string} original
 * @param {Record<string, string|null>} set local name → element XML, or null to remove it
 */
export function patchSettings(original, set) {
  const p = parts(original.replace(/^﻿?\s*<\?xml[^?]*\?>\s*/, ''));
  if (!p) return original;
  let kids = splitChildren(p.inner);
  for (const [name, xml] of Object.entries(set)) {
    const at = kids.findIndex((c) => local(c.name) === name);
    if (xml == null) { if (at >= 0) kids.splice(at, 1); continue; }
    const el = { name: `w:${name}`, xml };
    if (at >= 0) kids[at] = el; else kids.push(el);
  }
  kids = orderChildren(kids, SETTINGS_ORDER);
  const decl = /^﻿?\s*(<\?xml[^?]*\?>)/.exec(original)?.[1] || '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  return `${decl}\r\n${p.start}${kids.map((c) => c.xml).join('')}${p.end}`;
}

// ------------------------------------------------------------ core properties

/** The original core.xml with the modelled properties replaced (others, e.g. category, revision, kept). */
export function patchCore(original, generated) {
  const o = parts(original.replace(/^﻿?\s*<\?xml[^?]*\?>\s*/, ''));
  const g = parts(generated.replace(/^﻿?\s*<\?xml[^?]*\?>\s*/, ''));
  if (!o || !g) return generated;
  const gen = splitChildren(g.inner);
  const MODELLED = new Set(['title', 'subject', 'creator', 'keywords', 'description', 'lastModifiedBy', 'created', 'modified']);
  const kept = splitChildren(o.inner).filter((c) => !MODELLED.has(local(c.name)));
  // Namespaces the generated elements use must be declared: the generated root declares them all.
  const start = o.start.includes('xmlns:dcterms') && o.start.includes('xmlns:xsi') && o.start.includes('xmlns:dc=') ? o.start : g.start.replace('>', `${[...o.start.matchAll(/\sxmlns:([\w.-]+)="[^"]*"/g)].filter((m) => !g.start.includes(`xmlns:${m[1]}=`)).map((m) => m[0]).join('')}>`);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n${start}${[...gen, ...kept].map((c) => c.xml).join('')}${o.end}`;
}

// ------------------------------------------------------------ styles and numbering

/**
 * Generated styles.xml plus what the original had and the generator didn't
 * write: latent styles, and every style whose id isn't generated (table
 * styles, styles referenced by reused XML…).
 */
export function mergeStyles(generated, original) {
  const g = parts(generated.replace(/^﻿?\s*<\?xml[^?]*\?>\s*/, ''));
  const o = parts(original.replace(/^﻿?\s*<\?xml[^?]*\?>\s*/, ''));
  if (!g || !o) return generated;
  const gen = splitChildren(g.inner);
  const orig = splitChildren(o.inner);
  const idOf = (c) => /w:styleId="([^"]*)"/.exec(c.xml)?.[1];
  const have = new Set(gen.filter((c) => local(c.name) === 'style').map(idOf));
  const latent = orig.find((c) => local(c.name) === 'latentStyles');
  const extra = orig.filter((c) => local(c.name) === 'style' && !have.has(idOf(c)));
  const out = [];
  for (const c of gen) {
    out.push(c);
    if (local(c.name) === 'docDefaults' && latent) out.push(latent);
  }
  if (latent && !gen.some((c) => local(c.name) === 'docDefaults')) out.unshift(latent);
  out.push(...extra);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n${mergeRootStart(g.start, o.start)}${out.map((c) => c.xml).join('')}${g.end}`;
}

/** The root start tag of `a` with namespace declarations (and mc:Ignorable prefixes) from `b` added. */
export function mergeRootStart(a, b) {
  const declared = new Set([...a.matchAll(/\sxmlns(?::([\w.-]+))?="/g)].map((m) => m[1] || ''));
  const add = [...b.matchAll(/\sxmlns(?::([\w.-]+))?="([^"]*)"/g)].filter((m) => !declared.has(m[1] || '')).map((m) => m[0]);
  const ignA = /\smc:Ignorable="([^"]*)"/.exec(a)?.[1];
  const ignB = /\smc:Ignorable="([^"]*)"/.exec(b)?.[1];
  let out = a.replace(/\/?>$/, (end) => `${add.join('')}${end}`);
  if (ignB) {
    const all = [...new Set([...(ignA || '').split(/\s+/), ...ignB.split(/\s+/)].filter(Boolean))].join(' ');
    out = ignA != null ? out.replace(/\smc:Ignorable="[^"]*"/, ` mc:Ignorable="${all}"`) : out.replace(/\/?>$/, (end) => ` mc:Ignorable="${all}"${end}`);
  }
  return out;
}

/** Maximum numeric value of an attribute in some XML (−1 when absent). */
export const maxAttr = (xml, attr) => { let max = -1; for (const m of String(xml || '').matchAll(new RegExp(`${attr}="(-?\\d+)"`, 'g'))) max = Math.max(max, Number(m[1])); return max; };

/**
 * The original numbering.xml with the generated definitions added: generated
 * abstract numbers are renumbered after the original ones; generated nums
 * whose id the original has are dropped (WWNum<n> lists came from numId n).
 */
export function mergeNumbering(generated, original) {
  const o = parts(original.replace(/^﻿?\s*<\?xml[^?]*\?>\s*/, ''));
  if (!o) return generated;
  const orig = splitChildren(o.inner);
  const g = generated ? parts(generated.replace(/^﻿?\s*<\?xml[^?]*\?>\s*/, '')) : null;
  const gen = g ? splitChildren(g.inner) : [];
  const offset = maxAttr(original, 'w:abstractNumId') + 1;
  const origNums = new Set(orig.filter((c) => local(c.name) === 'num').map((c) => /w:numId="(\d+)"/.exec(c.xml)?.[1]));
  const genAbs = gen.filter((c) => local(c.name) === 'abstractNum').map((c) => ({ ...c, xml: c.xml.replace(/w:abstractNumId="(\d+)"/, (_, n) => `w:abstractNumId="${Number(n) + offset}"`) }));
  const genNums = gen.filter((c) => local(c.name) === 'num' && !origNums.has(/w:numId="(\d+)"/.exec(c.xml)?.[1])).map((c) => ({ ...c, xml: c.xml.replace(/<w:abstractNumId w:val="(\d+)"\/>/, (_, n) => `<w:abstractNumId w:val="${Number(n) + offset}"/>`) }));
  const pics = orig.filter((c) => local(c.name) === 'numPicBullet');
  const abs = orig.filter((c) => local(c.name) === 'abstractNum');
  const nums = orig.filter((c) => local(c.name) === 'num');
  const rest = orig.filter((c) => !['numPicBullet', 'abstractNum', 'num'].includes(local(c.name)));
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n${g ? mergeRootStart(o.start, g.start) : o.start}${[...pics, ...abs, ...genAbs, ...nums, ...genNums, ...rest].map((c) => c.xml).join('')}${o.end}`;
}

// ------------------------------------------------------------ relationships and the package

export function readRels(files, part) {
  const dir = part.includes('/') ? part.slice(0, part.lastIndexOf('/') + 1) : '';
  const name = part.slice(part.lastIndexOf('/') + 1);
  const relsPath = `${dir}_rels/${name}.rels`;
  const xml = files[relsPath] ? strFromU8(files[relsPath]) : '';
  const out = [];
  for (const m of xml.matchAll(/<(?:\w+:)?Relationship\b([^>]*)\/?>/g)) {
    const a = attrsText(m[1]);
    const external = a.TargetMode === 'External';
    const target = a.Target || '';
    out.push({ id: a.Id, type: a.Type || '', target, external, path: external ? null : normalise(target.startsWith('/') ? target.slice(1) : dir + target) });
  }
  return out;
}

export function normalise(p) {
  const out = [];
  for (const s of p.split('/')) { if (s === '..') out.pop(); else if (s && s !== '.') out.push(s); }
  return out.join('/');
}

const relsPathOf = (part) => { const dir = part.includes('/') ? part.slice(0, part.lastIndexOf('/') + 1) : ''; return `${dir}_rels/${part.slice(part.lastIndexOf('/') + 1)}.rels`; };
const relType = (t) => t.replace(/^.*\//, '');

/** Part types the editor writes itself (their original copies are replaced, not copied). */
export const OWNED_TYPES = new Set(['styles', 'numbering', 'settings', 'footnotes', 'endnotes', 'comments', 'header', 'footer']);

/**
 * Original relationships of a part the writer regenerates, to keep with
 * their ids: everything but those to parts the writer writes itself.
 */
export function keptRels(files, part) {
  return readRels(files, part).filter((r) => !OWNED_TYPES.has(relType(r.type)));
}

const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Merges the regenerated parts with the original package:
 *   - every part reachable from the output's relationships that the output
 *     doesn't have is copied from the original (with its own .rels, and
 *     recursively what those reach): theme, fonts, web settings, custom XML,
 *     glossary, people, comment extensions, charts, embeddings, media…
 *   - package relationships: the original's, with the main part and core
 *     properties pointing at the output's
 *   - content types: the output's overrides, plus the original's for copied
 *     parts and defaults for their extensions
 * @param {Record<string, Uint8Array>} out regenerated parts (with [Content_Types].xml)
 * @param {Record<string, Uint8Array>} orig original parts
 */
export function mergePackage(out, orig, { mainPath = 'word/document.xml', owned = new Set() } = {}) {
  const typeOrig = contentTypes(orig);
  const copied = new Set();
  const queue = [];
  const reach = (part) => { for (const r of readRels(out[relsPathOf(part)] ? out : orig, part)) if (r.path) queue.push(r.path); };
  // Package relationships: the original's (app, custom properties, thumbnail…), main and core pointing at ours.
  const origRoot = readRels(orig, '');
  const genRoot = readRels(out, '');
  const rootRels = [...genRoot];
  for (const r of origRoot) {
    const t = relType(r.type);
    // Our app.xml is replaced by the original's.
    if (t === 'extended-properties') { const i = rootRels.findIndex((g) => relType(g.type) === 'extended-properties'); if (i >= 0) rootRels.splice(i, 1); if (orig[r.path]) out[r.path] = orig[r.path]; }
    else if (t === 'officeDocument' || t === 'core-properties' || genRoot.some((g) => g.type === r.type && g.target === r.target)) continue;
    rootRels.push({ ...r, id: rootRels.some((g) => g.id === r.id) ? `rIdKeep${rootRels.length}` : r.id });
  }
  out['_rels/.rels'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rootRels.map((r) => `<Relationship Id="${xmlEsc(r.id)}" Type="${xmlEsc(r.type)}" Target="${xmlEsc(r.target)}"${r.external ? ' TargetMode="External"' : ''}/>`).join('')}</Relationships>`);
  for (const r of rootRels) if (r.path) queue.push(r.path);
  for (const p of Object.keys(out)) if (!p.endsWith('.rels') && p !== '[Content_Types].xml') reach(p);
  while (queue.length) {
    const p = queue.shift();
    if (out[p] || owned.has(p) || !orig[p]) continue;
    out[p] = orig[p];
    copied.add(p);
    const rp = relsPathOf(p);
    if (orig[rp] && !out[rp]) out[rp] = orig[rp];
    for (const r of readRels(orig, p)) if (r.path) queue.push(r.path);
  }
  // Content types.
  const ctXml = strFromU8(out['[Content_Types].xml']);
  const typeOut = contentTypes(out);
  const overrides = [];
  const defaults = new Map([...ctXml.matchAll(/<Default\b[^>]*Extension="([^"]*)"[^>]*ContentType="([^"]*)"/g)].map((m) => [m[1].toLowerCase(), m[2]]));
  for (const p of copied) {
    const want = typeOrig(p);
    if (typeOut(p) === want) continue;
    const ext = p.split('.').pop().toLowerCase();
    if (!defaults.has(ext) && !/\.xml$/i.test(p)) { defaults.set(ext, want); continue; }
    overrides.push(`<Override PartName="/${xmlEsc(p)}" ContentType="${xmlEsc(want)}"/>`);
  }
  const defaultXml = [...defaults].map(([e, t]) => `<Default Extension="${xmlEsc(e)}" ContentType="${xmlEsc(t)}"/>`).join('');
  const existingOverrides = [...ctXml.matchAll(/<Override\b[^>]*\/>/g)].map((m) => m[0]).join('');
  out['[Content_Types].xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${defaultXml}${existingOverrides}${overrides.join('')}</Types>`);
  void mainPath; void RELS_CT; void REL_NS;
  return { copied };
}

/** Removes namespace declarations from an element's start tag that the root already makes (same prefix and URI). */
export function dropRootDecls(xml, rootDecls) {
  return xml.replace(/^<[\w:.-]+(?:[^>"']|"[^"]*"|'[^']*')*?\/?>/, (tag) => tag.replace(/\sxmlns(?::([\w.-]+))?="([^"]*)"/g, (m, p, uri) => (rootDecls[p || ''] === uri ? '' : m)));
}

/** { prefix: uri } of a start tag's namespace declarations. */
export function declsOf(startTag) {
  const o = {};
  for (const m of startTag.matchAll(/\sxmlns(?::([\w.-]+))?="([^"]*)"/g)) o[m[1] || ''] = m[2];
  return o;
}
