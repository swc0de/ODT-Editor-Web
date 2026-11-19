/**
 * Equations: ODF formula objects. The frame's draw:object part carries the
 * object's files ('#files': { 'content.xml': MathML }), so the formula lives
 * in the document model (undo, copy/paste and round-trips cover it) and is
 * written to "Object N/content.xml" on save. The MathML keeps the LaTeX it
 * was made from as an annotation, for editing.
 */
import { cm, withWrap, uniqueName, maxZ } from './objects.js';

export const FORMULA_MIME = 'application/vnd.oasis.opendocument.formula';
export const CHART_MIME = 'application/vnd.oasis.opendocument.chart';

/** Built-in equations (Insert ▸ Equation ▾). */
export const EQUATION_PRESETS = {
  areaOfCircle: 'A=\\pi r^2',
  binomial: '(x+a)^n=\\sum_{k=0}^{n}\\binom{n}{k}x^k a^{n-k}',
  expansion: 'e^x=1+\\frac{x}{1!}+\\frac{x^2}{2!}+\\frac{x^3}{3!}+\\cdots',
  pythagoras: 'a^2+b^2=c^2',
  quadratic: 'x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}',
  sumOfSquares: '\\sum_{i=1}^{n} i^2=\\frac{n(n+1)(2n+1)}{6}',
  trigIdentity: '\\sin^2\\theta+\\cos^2\\theta=1',
};

const escXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Object content.xml for MathML (an <mrow>… fragment or a full <math>) and its LaTeX. */
export function formulaXml(mathml, latex) {
  let inner = String(mathml || '').trim();
  const m = /^<math\b[^>]*>([\s\S]*)<\/math>$/.exec(inner);
  if (m) inner = m[1];
  inner = inner.replace(/^<semantics>([\s\S]*)<annotation[\s\S]*<\/semantics>$/, '$1');
  if (!/^<mrow[\s>]/.test(inner)) inner = `<mrow>${inner}</mrow>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><semantics>${inner}<annotation encoding="application/x-tex">${escXml(latex || '')}</annotation></semantics></math>\n`;
}

/** The LaTeX annotation of an equation's content.xml ('' if it has none). */
export function latexOf(xml) {
  const m = /<(?:math:)?annotation[^>]*encoding="application\/x-tex"[^>]*>([\s\S]*?)<\/(?:math:)?annotation>/.exec(xml || '');
  return m ? m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') : '';
}

/** The draw:object part of an object frame. */
export const objectPart = (attrs) => (attrs.parts || []).find((p) => p.n === 'draw:object');

/** A free object directory name ("Object 3"). */
export function freeObjectDir(doc, state) {
  const used = new Set(Object.keys(state?.extraFiles || {}).map((p) => p.split('/')[0]));
  doc.descendants((n) => { if (n.type.name === 'frame') for (const p of n.attrs.parts || []) if (p.n === 'draw:object') used.add(String(p.a['xlink:href'] || '').replace(/^\.\//, '').replace(/\/$/, '')); return true; });
  let i = 1;
  while (used.has(`Object ${i}`)) i++;
  return `Object ${i}`;
}

/** Attrs for a new equation frame in line with text. */
export function equationAttrs({ doc, state, xml, w, h }) {
  const dir = freeObjectDir(doc, state);
  const attrs = {
    element: 'draw:frame', styleName: null, auto: null, kind: 'equation', href: `./${dir}`, body: [],
    frameAttrs: { 'draw:name': uniqueName(doc, 'Equation'), 'text:anchor-type': 'as-char', 'svg:width': cm(w), 'svg:height': cm(h), 'draw:z-index': String(maxZ(doc) + 1) },
    parts: [{ n: 'draw:object', a: { 'xlink:href': `./${dir}`, 'xlink:type': 'simple', 'xlink:show': 'embed', 'xlink:actuate': 'onLoad' }, '#files': { 'content.xml': xml }, '#mime': FORMULA_MIME }],
  };
  return withWrap(attrs, 'inline');
}

/** Same frame with new MathML (the stale replacement picture is dropped). */
export function withFormula(attrs, xml, w, h) {
  const parts = (attrs.parts || []).filter((p) => !(p.n === 'draw:image' && String(p.a['xlink:href']).includes('ObjectReplacements'))).map((p) => (p.n === 'draw:object' ? { ...p, '#files': { ...(p['#files'] || {}), 'content.xml': xml } } : p));
  return { ...attrs, parts, frameAttrs: { ...attrs.frameAttrs, 'svg:width': cm(w), 'svg:height': cm(h) } };
}
