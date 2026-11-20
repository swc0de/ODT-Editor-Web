/**
 * Shared helpers for the converters: the effective formatting of a text run
 * or paragraph (named style + direct formatting), list nesting, pictures.
 */
import { mergeAuto } from '../odt/styles.js';
import { styleOutlineLevel } from '../commands/paragraph.js';

const pt = (v) => {
  const m = String(v || '').match(/^([\d.]+)(pt|cm|mm|in|px)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return { pt: n, cm: n * 28.3465, mm: n * 2.83465, in: n * 72, px: n * 0.75 }[m[2] || 'pt'];
};
export const lengthPt = pt;

/** Effective text properties of a run: paragraph style ← character style ← direct formatting. */
export function runProps(node, parent, index) {
  let auto = index?.effective('paragraph', parent?.attrs.styleName) || null;
  for (const m of node.marks) {
    if (m.type.name === 'charStyle') auto = mergeAuto(auto, index?.effective('text', m.attrs.name, { includeDefault: false }) || null);
  }
  if (parent?.attrs.auto) auto = mergeAuto(auto, { props: { 'style:text-properties': parent.attrs.auto.props?.['style:text-properties'] || { a: {} } } });
  for (const m of node.marks) if (m.type.name === 'textProps') auto = mergeAuto(auto, m.attrs.auto);
  return auto?.props?.['style:text-properties']?.a || {};
}

/** Simple run formatting: { bold, italic, underline, strike, sub, sup, sizePt, colour, font, highlight, link }. */
export function runFormat(node, parent, index) {
  const a = runProps(node, parent, index);
  const weight = a['fo:font-weight'];
  const pos = String(a['style:text-position'] || '');
  const colour = a['fo:color'] && a['fo:color'] !== '#000000' ? a['fo:color'] : null;
  const hl = a['fo:background-color'] && a['fo:background-color'] !== 'transparent' ? a['fo:background-color'] : null;
  return {
    bold: weight === 'bold' || Number(weight) >= 600,
    italic: a['fo:font-style'] === 'italic' || a['fo:font-style'] === 'oblique',
    underline: !!a['style:text-underline-style'] && a['style:text-underline-style'] !== 'none',
    strike: !!a['style:text-line-through-style'] && a['style:text-line-through-style'] !== 'none',
    sub: /^(sub|-)/.test(pos),
    sup: /^(super|[1-9])/.test(pos),
    sizePt: pt(a['fo:font-size']),
    colour,
    font: String(a['style:font-name'] || a['fo:font-family'] || '').replace(/^['"]|['"]$/g, '') || null,
    highlight: hl,
    link: node.marks.find((m) => m.type.name === 'link')?.attrs.href || null,
  };
}

/** Effective paragraph properties. */
export function paraProps(node, index) {
  const auto = mergeAuto(index?.effective('paragraph', node.attrs.styleName) || null, node.attrs.auto);
  return auto?.props?.['style:paragraph-properties']?.a || {};
}

/** Paragraph formatting: { level (heading 1–9 or 0), align, indentLeftPt, indentRightPt, firstLinePt, beforePt, afterPt, pageBreak }. */
export function paraFormat(node, index) {
  const p = paraProps(node, index);
  const level = node.type.name === 'heading' ? node.attrs.level : styleOutlineLevel(index, node.attrs.styleName);
  const align = { center: 'center', end: 'right', right: 'right', justify: 'justify' }[p['fo:text-align']] || 'left';
  return {
    level: Math.min(9, level || 0),
    title: node.attrs.styleName === 'Title',
    subtitle: node.attrs.styleName === 'Subtitle',
    align,
    indentLeftPt: pt(p['fo:margin-left']) || 0,
    indentRightPt: pt(p['fo:margin-right']) || 0,
    firstLinePt: pt(p['fo:text-indent']) || 0,
    beforePt: pt(p['fo:margin-top']),
    afterPt: pt(p['fo:margin-bottom']),
    pageBreak: p['fo:break-before'] === 'page',
  };
}

/** The picture of an image frame: { bytes, mediaType, path, widthPt, heightPt, alt } or null. */
export function framePicture(node, state) {
  if (node.type.name !== 'frame' || node.attrs.kind !== 'image') return null;
  const img = node.attrs.parts?.find((p) => p.n === 'draw:image');
  const path = String(img?.a?.['xlink:href'] || node.attrs.href || '').replace(/^\.\//, '');
  const pic = state.pictures?.[path] || state.extraFiles?.[path];
  if (!pic) return null;
  const fa = node.attrs.frameAttrs || {};
  const alt = node.attrs.parts?.find((p) => p.n === 'svg:title')?.c?.[0] || fa['draw:name'] || '';
  return { ...pic, path, widthPt: pt(fa['svg:width']) || 200, heightPt: pt(fa['svg:height']) || 150, alt: typeof alt === 'string' ? alt : '' };
}

export function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export const dataUri = (pic) => `data:${pic.mediaType || 'image/png'};base64,${bytesToBase64(pic.bytes)}`;
