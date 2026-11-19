/**
 * Modal dialogs (role="dialog", aria-modal): focus is trapped inside, Esc
 * cancels, focus returns where it was. Returns a promise of the chosen value.
 */
import { h, focusables } from './dom.js';
import { t } from '../i18n/index.js';

/**
 * @param {object} o
 * @param {string} o.title
 * @param {string|Node} [o.message]
 * @param {Array<{label:string, value:any, primary?:boolean}>} o.buttons
 * @param {any} [o.cancelValue]
 * @param {(value) => boolean} [o.validate] keeps the dialog open when it returns false
 */
export function showDialog(o) {
  return new Promise((resolve) => {
    const returnFocus = document.activeElement;
    const titleId = `dlg-title-${Date.now()}`;
    const close = (value) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      if (returnFocus && document.contains(returnFocus)) returnFocus.focus({ preventScroll: true });
      resolve(value);
    };
    const choose = (value) => { if (value !== o.cancelValue && o.validate && !o.validate(value)) return; close(value); };
    const buttons = o.buttons.map((b) => h('button', { type: 'button', class: `dlg-btn${b.primary ? ' primary' : ''}`, onclick: () => choose(b.value) }, b.label));
    const box = h('div', { class: `dlg${o.wide ? ' wide' : ''}`, role: o.alert ? 'alertdialog' : 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
      h('div', { class: 'dlg-head' },
        h('h2', { class: 'dlg-title', id: titleId }, o.title),
        h('button', { type: 'button', class: 'dlg-x', 'aria-label': t('common.close'), onclick: () => close(o.cancelValue) }, '×')),
      o.message ? h('div', { class: 'dlg-body' }, o.message) : null,
      h('div', { class: 'dlg-buttons' }, buttons));
    const overlay = h('div', { class: 'dlg-overlay' }, box);
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(o.cancelValue); return; }
      if (e.key === 'Tab') {
        const f = focusables(box);
        const i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f.at(-1).focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
      e.stopPropagation();
    };
    document.addEventListener('keydown', onKey, true);
    document.body.append(overlay);
    (buttons.find((_, i) => o.buttons[i].primary) || buttons[0]).focus();
  });
}

export function alertDialog(title, message) {
  return showDialog({ title, message, buttons: [{ label: t('common.ok'), value: true, primary: true }], cancelValue: true, alert: true });
}
