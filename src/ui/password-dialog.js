/** Password prompts: opening a protected document, and setting a password (with confirmation). */
import { h } from './dom.js';
import { showDialog } from './dialog.js';
import { t } from '../i18n/index.js';

/** Resolves to the password, or null if cancelled. With confirm: asks twice and checks they match. */
export async function passwordDialog({ title, message = '', error = '', confirm = false }) {
  for (;;) {
    const pw = h('input', { type: 'password', class: 'fm-input', autocomplete: confirm ? 'new-password' : 'current-password', 'aria-label': t('protect.password') });
    const pw2 = confirm ? h('input', { type: 'password', class: 'fm-input', autocomplete: 'new-password', 'aria-label': t('protect.confirm') }) : null;
    const err = h('p', { class: 'pw-error', role: 'alert' }, error);
    const body = h('div', { class: 'ref-dlg pw-dlg' },
      message ? h('p', {}, message) : null,
      h('label', { class: 'pw-row' }, h('span', {}, t('protect.password')), pw),
      pw2 ? h('label', { class: 'pw-row' }, h('span', {}, t('protect.confirm')), pw2) : null,
      confirm ? h('p', { class: 'pw-note' }, t('protect.caution')) : null,
      err);
    requestAnimationFrame(() => pw.focus());
    const ok = await showDialog({ title, message: body, buttons: [{ label: t('common.ok'), value: true, primary: true }, { label: t('common.cancel'), value: false }], cancelValue: false });
    if (!ok) return null;
    if (!pw.value) { error = t('protect.empty'); continue; }
    if (confirm && pw.value !== pw2.value) { error = t('protect.mismatch'); continue; }
    return pw.value;
  }
}
