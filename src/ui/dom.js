/**
 * Tiny DOM helpers used by the UI. h('div', {class: 'x', onclick}, children)
 * Attributes: class, style (object or string), dataset (object), html (innerHTML),
 * on<event> listeners, boolean true → empty attribute, false/null → omitted.
 */
export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  append(node, children);
  return node;
}

function append(node, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(node, c);
    else node.append(c instanceof Node ? c : String(c));
  }
}

/** Parses an SVG/HTML string into a single element. */
export function fromHTML(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/** Elements that can take keyboard focus inside root (visible, not inert). */
export function focusables(root) {
  return [...root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((el) => !el.closest('[hidden], [inert]') && el.getClientRects().length > 0);
}

/** Is the event target a text-entry field (where typing must not trigger app shortcuts)? */
export function isTextInput(el) {
  if (!el || !(el instanceof Element)) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName === 'INPUT') return !['checkbox', 'radio', 'button', 'range', 'submit'].includes(el.type);
  return false;
}

let idSeq = 0;
export const uid = (prefix = 'u') => `${prefix}-${++idSeq}`;
