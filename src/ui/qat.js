/**
 * Quick Access Toolbar (File ▸ Options ▸ Quick Access Toolbar; off by default):
 * small icon buttons for chosen commands (Save, Undo, Redo…), shown before
 * the ribbon tabs or below the ribbon.
 */
import { h } from './dom.js';
import { iconSvg } from './icons.js';
import { t } from '../i18n/index.js';
import { getSetting } from '../core/settings.js';
import { DEFAULT_QAT } from './options-dialog.js';

export function createQat({ registry, store, tabbar, ribbonEl, toast }) {
  const el = h('div', { class: 'qat', role: 'toolbar', 'aria-label': t('qat.label'), hidden: true });
  function render() {
    const on = !!getSetting('qatShow');
    el.hidden = !on;
    el.classList.toggle('below', getSetting('qatPosition') === 'below');
    if (!on) { el.remove(); return; }
    if (getSetting('qatPosition') === 'below') ribbonEl.after(el); else tabbar.prepend(el);
    el.replaceChildren(...(getSetting('qatCommands') || DEFAULT_QAT).filter((id) => registry.get(id)).map((id) => {
      const cmd = registry.get(id);
      const b = h('button', { type: 'button', class: 'qat-btn', 'data-command': id, 'aria-label': registry.label(id), html: iconSvg(cmd.icon || 'file', { size: 16 }) });
      b.addEventListener('click', () => { if (!registry.run(id)) toast(t('toast.comingSoon', { name: registry.label(id) }), b); });
      return b;
    }));
    sync();
  }
  function sync() {
    for (const b of el.children) {
      const id = b.dataset.command;
      b.disabled = !registry.isEnabled(id);
      b.classList.toggle('is-checked', !!registry.get(id)?.isChecked && registry.isChecked(id));
    }
  }
  registry.onChange(sync);
  store.subscribe((_s, changed) => { if (changed.includes('qatVersion')) render(); });
  render();
  return { el, render };
}
