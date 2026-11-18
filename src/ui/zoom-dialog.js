/**
 * View ▸ Zoom dialog: presets (200 %, 100 %, 75 %, page width, text width,
 * whole page, many pages) and a custom percentage.
 */
import { h } from './dom.js';
import { t } from '../i18n/index.js';
import { showDialog } from './dialog.js';
import { ZOOM_MIN, ZOOM_MAX } from '../layout/document-area.js';

export async function showZoomDialog({ store, docArea }) {
  const current = store.get().zoom;
  const percent = h('input', { type: 'number', class: 'zd-percent', min: String(ZOOM_MIN), max: String(ZOOM_MAX), step: '1', value: String(current), 'aria-label': t('zoom.percent') });
  const presets = [
    ['200', () => 200], ['100', () => 100], ['75', () => 75],
    ['pageWidth', () => docArea.fitWidth()], ['textWidth', () => docArea.fitWidth() * (docArea.model ? docArea.model.width / (docArea.model.width - docArea.model.marginLeft - docArea.model.marginRight + 24) : 1)],
    ['wholePage', () => docArea.fitPage()], ['manyPages', () => docArea.fitWidth(2)],
  ];
  let choice = null;
  const radios = presets.map(([id, fn]) => {
    const input = h('input', { type: 'radio', name: 'zoom-preset', value: id });
    if ((id === '200' && current === 200) || (id === '100' && current === 100) || (id === '75' && current === 75)) input.checked = true;
    input.addEventListener('change', () => { choice = id; percent.value = String(Math.round(fn())); });
    return h('label', { class: 'zd-option' }, input, t(`zoom.${id}`));
  });
  percent.addEventListener('input', () => { choice = null; radios.forEach((r) => { r.querySelector('input').checked = false; }); });
  const body = h('div', { class: 'zd' },
    h('fieldset', { class: 'zd-presets' }, h('legend', {}, t('zoom.zoomTo')), radios),
    h('label', { class: 'zd-percent-row' }, t('zoom.percent'), percent, '%'));
  const ok = await showDialog({
    title: t('cmd.view.zoomDialog'),
    message: body,
    buttons: [{ label: t('common.ok'), value: true, primary: true }, { label: t('common.cancel'), value: false }],
    cancelValue: false,
  });
  if (!ok) return;
  if (choice === 'manyPages') { docArea.multiplePages(); return; }
  if (choice === 'wholePage') { docArea.onePage(); return; }
  const v = Number(percent.value);
  if (Number.isFinite(v)) docArea.setZoom(v);
}
