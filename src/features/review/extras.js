/**
 * Review ▸ Compare and Protect: Compare Documents (the revised document with
 * the differences as tracked changes, opened as a new document) and
 * Restrict Editing (read only / comments only / tracked changes only, saved
 * in the document's settings).
 */
import { h } from '../../ui/dom.js';
import { t } from '../../i18n/index.js';
import { showDialog, alertDialog } from '../../ui/dialog.js';
import { field, text, select, check } from '../../ui/form.js';
import { compareDocs } from '../../core/compare.js';
import { getConfigItem, setConfigItem } from '../../core/doc-settings.js';
import { DEFAULT_SETTINGS } from '../../core/odt/export.js';
import { editState } from '../../core/state-step.js';
import { setTracking, userName } from './track.js';

/** Reads an .odt the user picks → { name, bytes } or null. */
function pickOdt() {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: '.odt,.ott,application/vnd.oasis.opendocument.text', style: 'display:none' });
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      input.remove();
      resolve(f ? { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) } : null);
    });
    document.body.append(input);
    input.click();
  });
}

/** Compare Documents: original (this document or a file) and revised (a file). */
export async function compareDocuments(c) {
  let original = null;
  let revised = null;
  const origSel = select([['current', t('cmp.thisDocument')], ['file', t('cmp.chooseFile')]], 'current');
  const origName = h('span', { class: 'cmp-file' }, t('cmp.thisDocument'));
  const revName = h('span', { class: 'cmp-file' }, t('cmp.none'));
  const label = text(userName(), { 'aria-label': t('cmp.label') });
  origSel.addEventListener('change', async () => {
    if (origSel.value === 'file') {
      original = await pickOdt();
      if (!original) origSel.value = 'current';
      origName.textContent = original ? original.name : t('cmp.thisDocument');
    } else { original = null; origName.textContent = t('cmp.thisDocument'); }
  });
  const pickRev = h('button', { type: 'button', class: 'dlg-btn', onclick: async () => { const f = await pickOdt(); if (f) { revised = f; revName.textContent = f.name; } } }, t('cmp.browse'));
  const body = h('div', { class: 'ref-dlg cmp-dlg' },
    field(t('cmp.original'), origSel, { wide: true }), origName,
    h('div', { class: 'fm-field wide' }, h('span', { class: 'fm-label' }, t('cmp.revised')), h('div', { class: 'cmp-row' }, pickRev, revName)),
    field(t('cmp.label'), label, { wide: true }));
  const ok = await showDialog({ title: t('cmp.title'), message: body, buttons: [{ label: t('common.ok'), value: true, primary: true }, { label: t('common.cancel'), value: false }], cancelValue: false, validate: () => !!revised });
  if (!ok || !revised) return;
  const io = c.ui.io;
  try {
    const origDoc = original ? io.importOdt(original.bytes).doc : c.mainEditor.view.state.doc;
    const revState = io.importOdt(revised.bytes);
    revState.doc = compareDocs(origDoc, revState.doc, { author: label.value.trim() || userName() });
    const { bytes } = io.exportOdt(revState);
    await c.session.openBytes(bytes, { name: t('cmp.resultName'), remember: false });
    c.store.set({ reviewDisplay: 'all' });
  } catch (e) {
    await alertDialog(t('cmp.title'), `${t('cmp.failed')} ${e.message || e}`);
  }
}

// ------------------------------------------------------------------ restrict editing

export const RESTRICT_ITEM = 'ODTEditorRestrictEditing';

/** The restriction saved in a document's settings (null: none). */
export const savedRestriction = (st) => getConfigItem(st?.settingsXml || '', RESTRICT_ITEM);

function saveRestriction(c, mode) {
  editState(c.mainEditor.view, c.session.state, ['settingsXml'], (st) => {
    let xml = st.settingsXml || DEFAULT_SETTINGS;
    xml = setConfigItem(xml, RESTRICT_ITEM, 'string', mode);
    xml = setConfigItem(xml, 'LoadReadonly', 'boolean', mode === 'readonly' ? 'true' : null);
    st.settingsXml = xml;
    return true;
  });
}

/** Applies a restriction to the editor (and Track Changes for 'tracked'). */
export function applyRestriction(c, mode) {
  c.store.set({ restrict: mode || null, trackLock: mode === 'tracked' });
  if (mode === 'tracked') setTracking(c, true);
  if (mode === 'readonly' || mode === 'comments') c.store.set({ editingMode: 'viewing' });
  else if (c.store.get().editingMode === 'viewing') c.store.set({ editingMode: 'editing' });
}

/** Restrict Editing pane. */
export function openRestrictPane(c) {
  const dock = c.ui.rightDock;
  if (dock.isOpen('restrict')) { dock.close('restrict'); return; }
  const allow = check(t('rst.allowOnly'), !!c.state.restrict);
  const mode = select([['readonly', t('rst.readonly')], ['comments', t('rst.comments')], ['tracked', t('rst.tracked')]], c.state.restrict || 'readonly');
  const status = h('p', { class: 'rst-status' });
  const start = h('button', { type: 'button', class: 'dlg-btn primary' }, t('rst.start'));
  const stop = h('button', { type: 'button', class: 'dlg-btn' }, t('rst.stop'));
  const draw = () => {
    const on = !!c.store.get().restrict;
    start.hidden = on;
    stop.hidden = !on;
    allow.input.disabled = on;
    mode.disabled = on || !allow.input.checked;
    start.disabled = !allow.input.checked;
    status.textContent = on ? t('rst.enforced', { mode: t(`rst.${c.store.get().restrict}`) }) : t('rst.notEnforced');
  };
  allow.input.addEventListener('change', draw);
  start.addEventListener('click', () => { saveRestriction(c, mode.value); applyRestriction(c, mode.value); draw(); });
  stop.addEventListener('click', () => { saveRestriction(c, null); applyRestriction(c, null); c.store.set({ trackLock: false }); draw(); });
  const body = h('div', { class: 'rst-pane' },
    h('h3', {}, t('rst.editing')), allow, mode, h('p', { class: 'fm-hint' }, t('rst.hint')),
    h('h3', {}, t('rst.enforce')), status, h('div', { class: 'rst-actions' }, start, stop));
  dock.open({ id: 'restrict', title: t('rst.title'), body });
  draw();
}
