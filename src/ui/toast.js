/**
 * Small transient notices ("Paste — coming soon"). Announced politely to
 * screen readers through an aria-live region.
 */
import { h } from './dom.js';

let el = null;
let timer = null;

export function toast(message, anchor = null) {
  if (!el) {
    el = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite', hidden: true });
    document.body.append(el);
  }
  el.textContent = message;
  el.hidden = false;
  if (anchor && anchor.getBoundingClientRect) {
    const r = anchor.getBoundingClientRect();
    el.style.left = `${Math.max(8, Math.min(innerWidth - el.offsetWidth - 8, r.left))}px`;
    el.style.top = `${Math.min(innerHeight - 40, r.bottom + 8)}px`;
    el.classList.add('anchored');
  } else {
    el.style.left = '';
    el.style.top = '';
    el.classList.remove('anchored');
  }
  clearTimeout(timer);
  timer = setTimeout(() => { el.hidden = true; }, 2200);
}
