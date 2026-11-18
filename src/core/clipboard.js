/**
 * Pasting from other applications. Cleans Word/LibreOffice HTML, and parse
 * rules that turn generic HTML (b/i/u, inline styles, <font>, headings,
 * lists, tables) into the ODT model. Text-only paste (Ctrl+Shift+V) gives
 * plain paragraphs.
 */

/** Removes Office-specific noise before ProseMirror parses pasted HTML. */
export function cleanPastedHTML(html) {
  return html
    .replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<xml>[\s\S]*?<\/xml>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<meta[^>]*>/gi, '')
    .replace(/<link[^>]*>/gi, '')
    .replace(/<\/?o:p[^>]*>/gi, '')
    .replace(/<\/?(?:w|m|v):[^>]*>/gi, '');
}

const BLOCK_TAGS = new Set(['P', 'DIV', 'LI', 'TD', 'TH', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BODY', 'BLOCKQUOTE', 'UL', 'OL', 'TABLE', 'TR', 'SECTION', 'ARTICLE']);

function cssLengthToPt(v) {
  const m = String(v).trim().match(/^([\d.]+)(pt|px|em|rem|%)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const u = m[2] || 'px';
  if (u === 'pt') return n;
  if (u === 'px') return Math.round(n * 0.75 * 2) / 2;
  return null;
}

const FONT_SIZES = { 1: 8, 2: 10, 3: 12, 4: 14, 5: 18, 6: 24, 7: 36 };

function toHex(color) {
  const c = String(color).trim();
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(c)) return `#${[...c.slice(1)].map((x) => x + x).join('')}`.toLowerCase();
  const m = c.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/);
  if (m) { if (m[4] !== undefined && Number(m[4]) === 0) return null; return `#${[m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('')}`; }
  const named = { black: '#000000', white: '#ffffff', red: '#ff0000', blue: '#0000ff', green: '#008000', yellow: '#ffff00', gray: '#808080', grey: '#808080', navy: '#000080', maroon: '#800000', purple: '#800080', teal: '#008080', orange: '#ffa500' };
  return named[c.toLowerCase()] || null;
}

/** Character formatting of one element (tag + inline style) as ODF text props. */
function elementTextProps(el, p) {
  switch (el.tagName) {
    case 'B': case 'STRONG': p['fo:font-weight'] = 'bold'; break;
    case 'I': case 'EM': case 'CITE': case 'DFN': p['fo:font-style'] = 'italic'; break;
    case 'U': case 'INS': Object.assign(p, { 'style:text-underline-style': 'solid', 'style:text-underline-width': 'auto', 'style:text-underline-color': 'font-color' }); break;
    case 'S': case 'STRIKE': case 'DEL': Object.assign(p, { 'style:text-line-through-style': 'solid', 'style:text-line-through-type': 'single' }); break;
    case 'SUB': p['style:text-position'] = 'sub 58%'; break;
    case 'SUP': p['style:text-position'] = 'super 58%'; break;
    case 'CODE': case 'KBD': case 'SAMP': case 'TT': p['style:font-name'] = 'Liberation Mono'; break;
    case 'MARK': p['fo:background-color'] = '#ffff00'; break;
    case 'FONT': {
      if (el.getAttribute('face')) p['style:font-name'] = el.getAttribute('face').split(',')[0].trim().replace(/^['"]|['"]$/g, '');
      if (el.getAttribute('color')) { const c = toHex(el.getAttribute('color')); if (c) p['fo:color'] = c; }
      if (el.getAttribute('size')) { const s = FONT_SIZES[el.getAttribute('size')]; if (s) p['fo:font-size'] = `${s}pt`; }
      break;
    }
    default:
  }
  const s = el.style;
  if (!s) return p;
  const w = s.fontWeight;
  if (w) { if (w === 'bold' || Number(w) >= 600) p['fo:font-weight'] = 'bold'; else if (w === 'normal' || Number(w) <= 400) delete p['fo:font-weight']; }
  if (s.fontStyle) { if (s.fontStyle === 'italic' || s.fontStyle === 'oblique') p['fo:font-style'] = 'italic'; else if (s.fontStyle === 'normal') delete p['fo:font-style']; }
  const deco = `${s.textDecorationLine || ''} ${s.textDecoration || ''}`;
  if (/underline/.test(deco)) Object.assign(p, { 'style:text-underline-style': 'solid', 'style:text-underline-width': 'auto', 'style:text-underline-color': 'font-color' });
  if (/line-through/.test(deco)) Object.assign(p, { 'style:text-line-through-style': 'solid', 'style:text-line-through-type': 'single' });
  if (s.color) { const c = toHex(s.color); if (c) p['fo:color'] = c; }
  const bg = s.backgroundColor || s.background;
  if (bg) { const c = toHex(bg); if (c && c !== '#ffffff') p['fo:background-color'] = c; }
  if (s.fontSize) { const pt = cssLengthToPt(s.fontSize); if (pt) p['fo:font-size'] = `${pt}pt`; }
  if (s.fontFamily) {
    const fam = s.fontFamily.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
    if (fam && !/^(inherit|initial|sans-serif|serif|monospace)$/i.test(fam)) p['style:font-name'] = fam;
  }
  if (s.verticalAlign === 'super') p['style:text-position'] = 'super 58%';
  if (s.verticalAlign === 'sub') p['style:text-position'] = 'sub 58%';
  if (s.fontVariant === 'small-caps' || s.fontVariantCaps === 'small-caps') p['fo:font-variant'] = 'small-caps';
  if (s.textTransform === 'uppercase') p['fo:text-transform'] = 'uppercase';
  return p;
}

/**
 * The merged text props of an inline element and its inline ancestors (up to
 * the enclosing block), so nested <b><i>…</i></b> becomes one textProps mark.
 */
export function inheritedTextProps(el) {
  const chain = [];
  for (let n = el; n && n.nodeType === 1 && !BLOCK_TAGS.has(n.tagName); n = n.parentElement) chain.unshift(n);
  const p = {};
  for (const n of chain) elementTextProps(n, p);
  return p;
}

/** Paragraph attrs from a generic HTML block (style mapping + alignment). */
export function htmlBlockAttrs(dom) {
  const cls = dom.getAttribute?.('class') || '';
  let styleName = 'Standard';
  if (/MsoTitle\b/.test(cls)) styleName = 'Title';
  else if (/MsoSubtitle\b/.test(cls)) styleName = 'Subtitle';
  else if (/MsoQuote\b/.test(cls)) styleName = 'Quote';
  else if (/MsoIntenseQuote\b/.test(cls)) styleName = 'Intense_20_Quote';
  else if (/MsoNoSpacing\b/.test(cls)) styleName = 'No_20_Spacing';
  else if (dom.tagName === 'BLOCKQUOTE') styleName = 'Quote';
  const pp = {};
  const align = dom.style?.textAlign || dom.getAttribute?.('align');
  if (align && ['left', 'center', 'right', 'justify', 'start', 'end'].includes(align)) pp['fo:text-align'] = { left: 'start', right: 'end' }[align] || align;
  return { styleName, auto: Object.keys(pp).length ? { styleAttrs: {}, props: { 'style:paragraph-properties': { a: pp } } } : null, extra: null };
}
