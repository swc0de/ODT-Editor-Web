/**
 * ODF formatting properties → CSS, for rendering documents in the editor.
 * Only the visual subset matters here; the properties themselves are always
 * kept verbatim in the model.
 */

/** Open metric-compatible substitutes for common proprietary fonts. */
export const FONT_SUBSTITUTES = {
  calibri: 'Carlito', aptos: 'Carlito', 'aptos display': 'Carlito', cambria: 'Caladea',
  arial: 'Liberation Sans', helvetica: 'Liberation Sans', 'times new roman': 'Liberation Serif', times: 'Liberation Serif',
  'courier new': 'Liberation Mono', courier: 'Liberation Mono',
};

const q = (s) => `"${String(s).replace(/^['"]|['"]$/g, '').replace(/"/g, '')}"`;

/** CSS font-family stack for an ODF font name, with a bundled fallback. */
export function fontStack(name, generic = 'sans-serif') {
  if (!name) return '';
  const clean = String(name).replace(/^['"]|['"]$/g, '');
  const sub = FONT_SUBSTITUTES[clean.toLowerCase()];
  return [q(clean), sub ? q(sub) : null, generic].filter(Boolean).join(', ');
}

const ALIGN = { start: 'left', left: 'left', end: 'right', right: 'right', center: 'center', justify: 'justify' };
const UNDERLINE = { solid: 'solid', dotted: 'dotted', dash: 'dashed', 'long-dash': 'dashed', 'dot-dash': 'dashed', 'dot-dot-dash': 'dashed', wave: 'wavy' };

/** style:text-properties attributes → CSS declarations. */
export function textPropsCss(a = {}, out = []) {
  const font = a['style:font-name'] || a['fo:font-family'];
  if (font) out.push(`font-family:${fontStack(font)}`);
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
  if (a['text:display'] === 'none') out.push('text-decoration:underline dotted;opacity:.55');
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
    if (p === 'super' || parseFloat(p) > 0) out.push('vertical-align:super');
    else if (p === 'sub' || parseFloat(p) < 0) out.push('vertical-align:sub');
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
  const lh = a['fo:line-height'];
  if (lh && lh !== 'normal') out.push(`line-height:${/%$/.test(lh) ? (parseFloat(lh) / 100) * 1.17 : lh}`);
  if (a['style:line-height-at-least']) out.push(`min-height:${a['style:line-height-at-least']}`);
  if (a['style:line-spacing']) out.push(`line-height:calc(1.17em + ${a['style:line-spacing']})`);
  if (a['style:writing-mode'] === 'rl-tb') out.push('direction:rtl');
  if (a['style:writing-mode'] === 'lr-tb') out.push('direction:ltr');
  boxCss(a, out);
  return out;
}

export function cellPropsCss(a = {}, out = []) {
  boxCss(a, out);
  if (a['style:vertical-align']) out.push(`vertical-align:${a['style:vertical-align'] === 'automatic' ? 'top' : a['style:vertical-align']}`);
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
