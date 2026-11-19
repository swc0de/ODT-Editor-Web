/**
 * Equations: drawn in the page with the browser's own MathML; edited in a
 * dialog with MathLive's math field (loaded on first use), with the built-in
 * equations as a quick start.
 */
import { h } from './dom.js';
import { t } from '../i18n/index.js';
import { showDialog } from './dialog.js';
import { loadMathLive } from '../core/mathlive-loader.js';
import { EQUATION_PRESETS, formulaXml, objectPart } from '../core/equations.js';

const MATHNS = 'http://www.w3.org/1998/Math/MathML';

/** A <math> element from an object's content.xml (null if it isn't MathML). */
export function mathElement(xml) {
  if (!xml) return null;
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const root = doc.documentElement;
  if (!root || root.localName !== 'math' || root.namespaceURI !== MATHNS) return null;
  // LibreOffice's StarMath annotation is not part of what's drawn.
  for (const a of [...root.getElementsByTagNameNS(MATHNS, 'annotation')]) a.remove();
  return document.importNode(root, true);
}

/** Node view content for an equation frame. */
export function renderEquation(attrs) {
  const xml = objectPart(attrs)?.['#files']?.['content.xml'];
  const math = mathElement(xml);
  if (!math) return null;
  math.setAttribute('display', 'inline');
  const wrap = h('span', { class: 'obj-math' });
  wrap.append(math);
  return wrap;
}

/** Size (px) of MathML drawn at 12 pt. */
export function measureMath(xml) {
  const math = mathElement(xml);
  if (!math) return { w: 48, h: 24 };
  math.setAttribute('display', 'inline');
  const probe = h('span', { class: 'obj-math', style: { position: 'absolute', left: '-10000px', top: '0', fontSize: '12pt', whiteSpace: 'nowrap' } });
  probe.append(math);
  document.body.append(probe);
  const r = probe.getBoundingClientRect();
  probe.remove();
  return { w: Math.max(8, Math.ceil(r.width) + 2), h: Math.max(12, Math.ceil(r.height) + 2) };
}

/** The editor: resolves to { latex, xml } or null. */
export async function equationDialog(latex = '') {
  let ml;
  try { ml = await loadMathLive(); } catch (e) { return { error: e.message }; }
  const field = new ml.MathfieldElement();
  field.value = latex;
  field.className = 'eq-field';
  field.setAttribute('aria-label', t('eq.field'));
  field.mathVirtualKeyboardPolicy = 'manual';
  const presets = h('div', { class: 'eq-presets' }, Object.entries(EQUATION_PRESETS).map(([id, tex]) => {
    const b = h('button', { type: 'button', class: 'eq-preset', 'data-tip': t(`eq.${id}`) }, t(`eq.${id}`));
    b.addEventListener('click', () => { field.value = tex; field.focus(); });
    return b;
  }));
  const texInput = h('textarea', { class: 'fm-input eq-tex', rows: '2', spellcheck: 'false', 'aria-label': t('eq.latex') });
  texInput.value = latex;
  field.addEventListener('input', () => { texInput.value = field.value; });
  texInput.addEventListener('input', () => { field.value = texInput.value; });
  const body = h('div', { class: 'eq-body' }, h('div', { class: 'menu-header' }, t('eq.builtIn')), presets, field, h('label', { class: 'eq-tex-label' }, t('eq.latex')), texInput, h('p', { class: 'fm-note' }, t('eq.help')));
  requestAnimationFrame(() => field.focus());
  const ok = await showDialog({ title: t('eq.title'), message: body, wide: true, cancelValue: false, buttons: [{ label: t('common.ok'), value: true, primary: true }, { label: t('common.cancel'), value: false }] });
  if (!ok) return null;
  const tex = field.value.trim();
  if (!tex) return null;
  return { latex: tex, xml: formulaXml(ml.convertLatexToMathMl(tex), tex) };
}
