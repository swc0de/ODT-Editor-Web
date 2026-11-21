/**
 * ODF formatting properties → CSS, for rendering documents in the editor.
 * Only the visual subset matters here; the properties themselves are always
 * kept verbatim in the model.
 */

/** Open metric-compatible substitutes for common proprietary fonts. */
export const FONT_SUBSTITUTES = {
  calibri: 'Carlito', 'calibri light': 'Carlito', aptos: 'Carlito', 'aptos display': 'Carlito', cambria: 'Caladea',
  arial: 'Liberation Sans', helvetica: 'Liberation Sans', 'times new roman': 'Liberation Serif', times: 'Liberation Serif',
  'courier new': 'Liberation Mono', courier: 'Liberation Mono',
};

/**
 * Word's single line height for a font, as a multiple of the font size
 * (ascent + descent + line gap of the Windows metrics). Used for "1.5 lines"
 * and the like in documents laid out by Word's rules.
 */
export const LINE_FACTORS = {
  calibri: 1.2207, 'calibri light': 1.2207, carlito: 1.2207, cambria: 1.1719, caladea: 1.1719, arial: 1.1499, 'liberation sans': 1.1499, helvetica: 1.1499,
  'times new roman': 1.1499, 'liberation serif': 1.1499, times: 1.1499, 'courier new': 1.1328, 'liberation mono': 1.1328, courier: 1.1328,
  georgia: 1.1362, verdana: 1.2153, tahoma: 1.2075, 'trebuchet ms': 1.1611, 'segoe ui': 1.3301, consolas: 1.1709, 'century gothic': 1.2251, garamond: 1.1235,
};

const q = (s) => `"${String(s).replace(/^['"]|['"]$/g, '').replace(/"/g, '')}"`;

/**
 * Single-weight families named after their weight ("Calibri Light"). Word
 * draws them in bold by emboldening the light face; a browser only does that
 * when the family has no bold face of its own, which a system's font
 * matching can't promise. Such a name is used through an alias face that
 * declares just the one weight (see fontAliasCss), so bold is always
 * synthesised from it, and the bundled substitute follows when the font
 * isn't installed.
 */
const SINGLE_WEIGHT = /\b(light|semilight|thin|extralight|ultralight)$/i;
export const aliasName = (name) => `ODT ${name}`;

/** CSS font-family stack for an ODF font name, with a bundled fallback. */
export function fontStack(name, generic = 'sans-serif') {
  if (!name) return '';
  const clean = String(name).replace(/^['"]|['"]$/g, '');
  const sub = FONT_SUBSTITUTES[clean.toLowerCase()];
  return [SINGLE_WEIGHT.test(clean) ? q(aliasName(clean)) : null, q(clean), sub ? q(sub) : null, generic].filter(Boolean).join(', ');
}

/** @font-face rules for the single-weight families among `names`. */
export function fontAliasCss(names) {
  const out = [];
  for (const n of new Set(names)) {
    const clean = String(n).replace(/^['"]|['"]$/g, '');
    if (!SINGLE_WEIGHT.test(clean)) continue;
    const weight = /thin|extralight|ultralight/i.test(clean) ? 200 : /semilight/i.test(clean) ? 350 : 300;
    const local = [clean, clean.replace(/\s+/g, ''), clean.replace(/\s+/g, '-')].map((x) => `local(${q(x)})`).join(', ');
    out.push(`@font-face{font-family:${q(aliasName(clean))};src:${local};font-weight:${weight};font-style:normal}`);
    out.push(`@font-face{font-family:${q(aliasName(clean))};src:${local};font-weight:${weight};font-style:italic}`);
  }
  return out.join('\n');
}

/** Is a CSS colour (#rgb / #rrggbb) dark enough for automatic text to turn white? */
export function isDark(colour) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(colour || '').trim());
  if (!m) return false;
  const h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
  const n = parseInt(h, 16);
  return (299 * ((n >> 16) & 255) + 587 * ((n >> 8) & 255) + 114 * (n & 255)) / 1000 < 128;
}

/** Automatic text colour over a background: white on dark (--odt-dark-ink, see buildDocumentCss). */
const autoInk = (bg, out) => { if (bg && bg !== 'transparent' && isDark(bg)) out.push('color:var(--odt-dark-ink, #fff)'); };

const ALIGN = { start: 'left', left: 'left', end: 'right', right: 'right', center: 'center', justify: 'justify' };
const UNDERLINE = { solid: 'solid', dotted: 'dotted', dash: 'dashed', 'long-dash': 'dashed', 'dot-dash': 'dashed', 'dot-dot-dash': 'dashed', wave: 'wavy' };

/** style:text-properties attributes → CSS declarations. */
export function textPropsCss(a = {}, out = []) {
  const font = a['style:font-name'] || a['fo:font-family'];
  if (font) {
    out.push(`font-family:${fontStack(font)}`);
    const f = LINE_FACTORS[String(font).replace(/^['"]|['"]$/g, '').toLowerCase()];
    if (f) out.push(`--odt-lhw:${f}`);
  }
  // Automatic colour turns white on a dark highlight / shading (D12).
  if (!a['fo:color']) autoInk(a['fo:background-color'], out);
  if (a['fo:font-size']) out.push(`font-size:${a['fo:font-size']}`);
  if (a['fo:font-weight']) out.push(`font-weight:${a['fo:font-weight']}`);
  if (a['fo:font-style']) out.push(`font-style:${a['fo:font-style']}`);
  if (a['fo:color']) out.push(`color:${a['fo:color']}`);
  if (a['fo:background-color'] && a['fo:background-color'] !== 'transparent') out.push(`background-color:${a['fo:background-color']}`);
  if (a['fo:font-variant']) out.push(`font-variant:${a['fo:font-variant']}`);
  if (a['fo:text-transform']) out.push(`text-transform:${a['fo:text-transform']}`);
  if (a['fo:letter-spacing'] && a['fo:letter-spacing'] !== 'normal') out.push(`letter-spacing:${a['fo:letter-spacing']}`);
  if (a['fo:text-shadow'] && a['fo:text-shadow'] !== 'none') out.push(`text-shadow:${a['fo:text-shadow']} rgba(0,0,0,.45)`);
  if (a['style:text-outline'] === 'true') out.push(`-webkit-text-stroke:0.6px ${a['fo:color'] && a['fo:color'] !== 'transparent' ? a['fo:color'] : '#000'};color:transparent`);
  // Hidden text shows (dotted) only while formatting marks are shown.
  if (a['text:display'] === 'none') out.push('display:var(--odt-hidden,none);text-decoration:underline dotted');
  if (a['style:text-scale'] && a['style:text-scale'] !== '100%') out.push(`display:inline-block;transform:scaleX(${parseFloat(a['style:text-scale']) / 100});transform-origin:left`);
  const ul = a['style:text-underline-style'];
  const lt = a['style:text-line-through-style'];
  const deco = [];
  if (ul && ul !== 'none') deco.push('underline');
  if (lt && lt !== 'none') deco.push('line-through');
  if (deco.length) {
    out.push(`text-decoration-line:${deco.join(' ')}`);
    let style = UNDERLINE[ul] || UNDERLINE[lt] || 'solid';
    if ((ul && a['style:text-underline-type'] === 'double') || (lt && a['style:text-line-through-type'] === 'double')) style = 'double';
    out.push(`text-decoration-style:${style}`);
    const c = a['style:text-underline-color'];
    if (c && c !== 'font-color') out.push(`text-decoration-color:${c}`);
    if (a['style:text-underline-width'] === 'bold') out.push('text-decoration-thickness:2px');
  }
  const pos = a['style:text-position'];
  if (pos) {
    const [p, size] = pos.split(/\s+/);
    // Raised / lowered text doesn't make its line taller (as in Word and LibreOffice).
    if (p === 'super' || parseFloat(p) > 0) out.push('vertical-align:super', 'line-height:0');
    else if (p === 'sub' || parseFloat(p) < 0) out.push('vertical-align:sub', 'line-height:0');
    if (size) out.push(`font-size:${parseFloat(size) / 100}em`);
  }
  if (a['fo:border'] && a['fo:border'] !== 'none') out.push(`border:${a['fo:border']}`, 'padding:0 1px');
  if (a['fo:hyphenate'] === 'true') out.push('hyphens:auto');
  return out;
}

const BORDER_KEYS = ['fo:border', 'fo:border-top', 'fo:border-right', 'fo:border-bottom', 'fo:border-left'];
const PAD_KEYS = ['fo:padding', 'fo:padding-top', 'fo:padding-right', 'fo:padding-bottom', 'fo:padding-left'];

function boxCss(a, out) {
  for (const k of BORDER_KEYS) if (a[k]) out.push(`${k.slice(3)}:${a[k] === 'none' ? 'none' : a[k]}`);
  for (const k of PAD_KEYS) if (a[k]) out.push(`${k.slice(3)}:${a[k]}`);
  if (a['fo:background-color'] && a['fo:background-color'] !== 'transparent') out.push(`background-color:${a['fo:background-color']}`);
  return out;
}

/** style:paragraph-properties attributes → CSS declarations. */
export function paragraphPropsCss(a = {}, out = []) {
  if (a['fo:text-align']) out.push(`text-align:${ALIGN[a['fo:text-align']] || 'left'}`);
  if (a['fo:text-align-last'] === 'justify') out.push('text-align-last:justify');
  for (const side of ['top', 'bottom', 'left', 'right']) if (a[`fo:margin-${side}`]) out.push(`margin-${side}:${a[`fo:margin-${side}`]}`);
  if (a['fo:margin']) out.push(`margin:${a['fo:margin']}`);
  if (a['fo:text-indent']) out.push(`text-indent:${a['fo:text-indent']}`);
  // Proportional spacing multiplies the single line height: 1.17 of the font
  // size, or with Word's rules the font's own (--odt-lhk, see content.css).
  const lh = a['fo:line-height'];
  if (lh && lh !== 'normal') out.push(`line-height:${/%$/.test(lh) ? `calc(${parseFloat(lh) / 100} * var(--odt-lhk, 1.17))` : lh}`);
  // At least: every line is at least this tall.
  if (a['style:line-height-at-least']) out.push(`line-height:max(${a['style:line-height-at-least']}, calc(var(--odt-lhk, 1.17) * 1em))`);
  if (a['style:line-spacing']) out.push(`line-height:calc(1.17em + ${a['style:line-spacing']})`);
  if (a['style:writing-mode'] === 'rl-tb') out.push('direction:rtl');
  if (a['style:writing-mode'] === 'lr-tb') out.push('direction:ltr');
  boxCss(a, out);
  autoInk(a['fo:background-color'], out);
  return out;
}

export function cellPropsCss(a = {}, out = []) {
  boxCss(a, out);
  autoInk(a['fo:background-color'], out);
  if (a['style:vertical-align']) out.push(`vertical-align:${a['style:vertical-align'] === 'automatic' ? 'top' : a['style:vertical-align']}`);
  // Rotated cell text (Layout ▸ Text Direction).
  if (a['style:writing-mode'] === 'tb-rl') out.push('writing-mode:vertical-rl');
  else if (a['style:writing-mode'] === 'bt-lr') out.push('writing-mode:sideways-lr');
  return out;
}

export function tablePropsCss(a = {}, out = []) {
  if (a['style:width']) out.push(`width:${a['style:width']}`);
  if (a['table:align'] === 'center') out.push('margin-left:auto', 'margin-right:auto');
  else if (a['table:align'] === 'right') out.push('margin-left:auto');
  if (a['fo:margin-top']) out.push(`margin-top:${a['fo:margin-top']}`);
  if (a['fo:margin-bottom']) out.push(`margin-bottom:${a['fo:margin-bottom']}`);
  if (a['fo:margin-left'] && a['table:align'] === 'left') out.push(`margin-left:${a['fo:margin-left']}`);
  if (a['fo:background-color'] && a['fo:background-color'] !== 'transparent') out.push(`background-color:${a['fo:background-color']}`);
  return out;
}

/** style:table-row-properties → CSS (heights apply to the cells). */
export function rowPropsCss(a = {}, out = []) {
  if (a['style:row-height']) out.push(`height:${a['style:row-height']}`);
  else if (a['style:min-row-height']) out.push(`height:${a['style:min-row-height']}`);
  if (a['fo:background-color'] && a['fo:background-color'] !== 'transparent') out.push(`background-color:${a['fo:background-color']}`);
  autoInk(a['fo:background-color'], out);
  return out;
}

/** CSS text for a table / row / cell automatic style. */
export function tableAutoCss(auto, family) {
  const p = auto?.props || {};
  const out = [];
  if (family === 'table') tablePropsCss(p['style:table-properties']?.a, out);
  else if (family === 'table-row') rowPropsCss(p['style:table-row-properties']?.a, out);
  else if (family === 'table-cell') {
    cellPropsCss(p['style:table-cell-properties']?.a, out);
    paragraphPropsCss({ 'fo:text-align': p['style:paragraph-properties']?.a?.['fo:text-align'] }, out);
    textPropsCss(p['style:text-properties']?.a, out);
  }
  return out.join(';');
}

export function sectionPropsCss(a = {}, children = [], out = []) {
  if (a['fo:background-color'] && a['fo:background-color'] !== 'transparent') out.push(`background-color:${a['fo:background-color']}`);
  const cols = children.find((c) => typeof c !== 'string' && c.n === 'style:columns');
  const n = Number(cols?.a?.['fo:column-count'] || 1);
  if (n > 1) {
    out.push(`column-count:${n}`);
    if (cols.a['fo:column-gap']) out.push(`column-gap:${cols.a['fo:column-gap']}`);
    if ((cols.c || []).some((c) => c.n === 'style:column-sep')) out.push('column-rule:1px solid #000');
  }
  return out;
}

/** Props of an auto/named style → CSS text (no braces). kind: 'paragraph' | 'text'. */
export function autoToCss(auto, kind) {
  if (!auto?.props) return '';
  const out = [];
  if (kind === 'paragraph') paragraphPropsCss(auto.props['style:paragraph-properties']?.a, out);
  textPropsCss(auto.props['style:text-properties']?.a, out);
  return out.join(';');
}
