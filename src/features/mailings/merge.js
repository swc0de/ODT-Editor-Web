/**
 * Mailings: recipients, merge fields and rules, preview, Finish & Merge,
 * envelopes and labels.
 */
import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { Fragment } from 'prosemirror-model';
import { schema } from '../../core/schema.js';
import { editState } from '../../core/state-step.js';
import { loadChunk } from '../../core/chunk-loader.js';
import {
  parseCsv, fromRows, newMerge, includedRecords, mergeField, conditionalField, fillInField, nextRecordField, recordNumberField,
  addressBlock, greetingLine, previewValues, mergeBlocks, DEFAULT_FIELDS, DB_ELEMENTS, valueOf, mergeOf,
} from '../../core/mailmerge.js';
import { envelopeState, labelsState } from '../../core/mail-docs.js';
import {
  recipientsDialog, addressBlockDialog, greetingDialog, ruleDialog, fillInDialog, askDialog, findRecipientDialog, mergeToDialog, envelopeDialog, labelsDialog,
} from '../../ui/mailing-dialogs.js';
import { alertDialog } from '../../ui/dialog.js';
import { h } from '../../ui/dom.js';
import { t } from '../../i18n/index.js';

export const previewKey = new PluginKey('mergePreview');

/** Shows the current record's values in the merge fields while Preview Results is on. */
export function mergePreviewPlugin(o) {
  const compute = (state) => {
    if (!o.on()) return DecorationSet.empty;
    const m = o.merge();
    if (!m) return DecorationSet.empty;
    const vals = previewValues(state.doc, m, o.record());
    const decos = [];
    for (const [pos, v] of vals) { const n = state.doc.nodeAt(pos); if (n) decos.push(Decoration.node(pos, pos + n.nodeSize, { 'data-shown': v, class: 'mm-previewed' })); }
    return DecorationSet.create(state.doc, decos);
  };
  return new Plugin({
    key: previewKey,
    state: {
      init: (_c, state) => compute(state),
      apply: (tr, old, _o, state) => (tr.getMeta(previewKey) || tr.docChanged ? compute(state) : old),
    },
    props: {
      decorations: (s) => previewKey.getState(s),
      attributes: () => (o.highlight() ? { class: 'mm-highlight' } : {}),
    },
  });
}

const view = (c) => c.mainEditor.view;
const merge = (c) => mergeOf(c.session.state);
export const hasList = (c) => !!c.session && !!merge(c)?.fields?.length;
const refresh = (c) => view(c).dispatch(view(c).state.tr.setMeta(previewKey, true).setMeta('addToHistory', false).setMeta('tcSkip', true));

function setMerge(c, m) {
  editState(view(c), c.session.state, ['mailMerge'], (st) => { st.mailMerge = m; return true; });
  const n = includedRecords(m).length;
  if (c.store.get().mergeRecord > n) c.store.set({ mergeRecord: Math.max(1, n) });
  refresh(c);
}

// ------------------------------------------------------------------ recipients

/** Reads a recipient list file (CSV, TXT, XLSX, XLS, ODS) → { fields, records } */
async function readList(file) {
  if (/\.(csv|txt|tsv)$/i.test(file.name)) return fromRows(parseCsv(await file.text()));
  const { read, utils } = await loadChunk('odt-sheetjs', 'The spreadsheet reader is not included in this build.');
  const wb = read(new Uint8Array(await file.arrayBuffer()), { type: 'array', cellDates: true });
  const sheet = wb.SheetNames[0];
  const rows = utils.sheet_to_json(wb.Sheets[sheet], { header: 1, raw: false, defval: '' });
  return { ...fromRows(rows), table: sheet };
}

export function useExistingList(c) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: '.csv,.txt,.tsv,.xlsx,.xls,.ods', style: 'display:none' });
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      input.remove();
      if (!f) { resolve(false); return; }
      try {
        const { fields, records, table } = await readList(f);
        if (!fields.length) throw new Error(t('mm.emptyList'));
        setMerge(c, newMerge(merge(c), { fields, records, source: { name: f.name, kind: /\.(csv|txt|tsv)$/i.test(f.name) ? 'csv' : 'xlsx' }, table: table || 'Sheet1' }));
        c.ui.toast?.(t('mm.loaded', { n: records.length }));
        resolve(true);
      } catch (e) {
        await alertDialog(t('mm.selectTitle'), `${t('mm.readFailed')} ${e.message || e}`);
        resolve(false);
      }
    });
    document.body.append(input);
    input.click();
  });
}

export async function typeNewList(c) {
  const start = newMerge(merge(c), { fields: [...DEFAULT_FIELDS], records: [DEFAULT_FIELDS.map(() => '')], source: { name: 'Addresses', kind: 'typed' } });
  const m = await recipientsDialog(start);
  if (!m) return;
  m.records = m.records.filter((r) => r.some((v) => String(v).trim()));
  m.include = m.records.map(() => true);
  setMerge(c, m);
}

export async function editRecipients(c) {
  const m = await recipientsDialog(merge(c));
  if (m) setMerge(c, m);
}

// ------------------------------------------------------------------ fields and rules

function insertInline(c, content) {
  const v = view(c);
  const nodes = Array.isArray(content) ? content : [content];
  const { from, to } = v.state.selection;
  const tr = v.state.tr.replaceWith(from, to, Fragment.from(nodes));
  tr.setSelection(TextSelection.create(tr.doc, from + Fragment.from(nodes).size));
  v.dispatch(tr.scrollIntoView());
  v.focus();
}

export const insertField = (c, column) => insertInline(c, mergeField(merge(c), column));

const firstRecord = (c) => includedRecords(merge(c))[0] || { index: 0, values: [] };
/** Plain text of field content for a dialog preview (the first recipient). */
const previewText = (c, content) => content.map((n) => (n.type.name === 'hard_break' ? '\n' : n.type.name === 'field' ? valueOf(merge(c), firstRecord(c).values, n.attrs.fieldAttrs['text:column-name']) : n.text || '')).join('').replace(/^\s*\n|\n\s*(?=\n)/g, '');

export async function insertAddressBlock(c) {
  const o = await addressBlockDialog((opts) => previewText(c, addressBlock(merge(c), opts)));
  if (o) insertInline(c, addressBlock(merge(c), o));
}

export async function insertGreeting(c) {
  const o = await greetingDialog((opts) => previewText(c, greetingLine(merge(c), opts)));
  if (o) insertInline(c, greetingLine(merge(c), o));
}

export async function ruleIfThenElse(c) {
  const r = await ruleDialog(merge(c).fields, { title: t('mm.ifTitle') });
  if (r) insertInline(c, conditionalField(merge(c), r));
}

export async function ruleFillIn(c) {
  const r = await fillInDialog();
  if (r) insertInline(c, fillInField(r.prompt, r.deflt));
}

export async function ruleSkipRecord(c) {
  const r = await ruleDialog(merge(c).fields, { withText: false, title: t('mm.skipTitle') });
  if (r) setMerge(c, { ...merge(c), skipIf: { field: r.field, op: r.op, value: r.value } });
}

export const ruleNextRecord = (c) => insertInline(c, nextRecordField(merge(c)));
export const ruleMergeRecord = (c) => insertInline(c, recordNumberField(merge(c)));

// ------------------------------------------------------------------ preview

export const recordCount = (c) => (hasList(c) ? includedRecords(merge(c)).length : 0);

export function goRecord(c, n) {
  const total = recordCount(c);
  if (!total) return;
  c.store.set({ mergeRecord: Math.max(1, Math.min(total, n)), mergePreview: true });
  refresh(c);
}

export function setPreview(c, on) {
  if (on) goRecord(c, c.store.get().mergeRecord || 1);
  else { c.store.set({ mergePreview: false }); refresh(c); }
}

export async function findRecipient(c) {
  const q = await findRecipientDialog(merge(c).fields);
  if (!q) return;
  const recs = includedRecords(merge(c));
  const start = c.store.get().mergeRecord || 0;
  const hit = (r) => (q.field ? [valueOf(merge(c), r.values, q.field)] : r.values).some((v) => String(v).toLowerCase().includes(q.text.toLowerCase()));
  for (let k = 0; k < recs.length; k++) {
    const i = (start + k) % recs.length;
    if (hit(recs[i])) { goRecord(c, i + 1); return; }
  }
  c.ui.toast?.(t('mm.notFound'));
}

// ------------------------------------------------------------------ finish

/** The answers to Fill-in prompts (asked once per merge). */
async function askFillIns(doc) {
  const answers = {};
  const seen = [];
  doc.descendants((n) => { if (n.type.name === 'field' && n.attrs.element === 'text:text-input' && DB_ELEMENTS.has(n.attrs.element)) seen.push(n); return true; });
  for (const n of seen) {
    const key = n.attrs.fieldAttrs['text:description'] || '';
    if (!(key in answers)) answers[key] = await askDialog(key, n.attrs.text);
  }
  return answers;
}

/** The merged document as a document state (records from..to, 1-based). */
async function mergedState(c, range) {
  const m = merge(c);
  const recs = includedRecords(m).slice(range.from - 1, range.to);
  const answers = await askFillIns(view(c).state.doc);
  const st = c.ui.io.importOdt(await c.session.serialize());
  const blocks = mergeBlocks(view(c).state.doc.toJSON(), m, recs, { answers, continuous: m.type === 'directory' });
  st.doc = schema.nodeFromJSON({ type: 'doc', content: blocks.length ? blocks : [{ type: 'paragraph' }] });
  delete st.mailMerge;
  return st;
}

export async function editIndividual(c) {
  const total = recordCount(c);
  if (!total) return;
  const range = await mergeToDialog(total, c.store.get().mergeRecord || 1);
  if (!range) return;
  const st = await mergedState(c, range);
  await c.session.openBytes(c.ui.io.exportOdt(st).bytes, { name: t('mm.lettersName'), remember: false });
}

/** Finish & Merge ▸ Print Documents: the merged letters open as a new document and print. */
export async function printDocuments(c) {
  const total = recordCount(c);
  if (!total) return;
  const range = await mergeToDialog(total, c.store.get().mergeRecord || 1);
  if (!range) return;
  const st = await mergedState(c, range);
  const ok = await c.session.openBytes(c.ui.io.exportOdt(st).bytes, { name: t('mm.lettersName'), remember: false });
  if (ok) await c.ui.print.run({ range: 'all' });
}

// ------------------------------------------------------------------ envelopes and labels

const selectionText = (c) => { const s = view(c).state; return s.doc.textBetween(s.selection.from, s.selection.to, '\n', '\n').trim(); };

async function openState(c, st, name) {
  await c.session.openBytes(c.ui.io.exportOdt(st).bytes, { name, remember: false });
}

export async function envelopes(c) {
  const o = await envelopeDialog(selectionText(c), c.ui.userAddress?.() || '');
  if (o) await openState(c, envelopeState(o), t('mm.envelopeName'));
}

export async function labels(c) {
  const o = await labelsDialog(selectionText(c));
  if (o) await openState(c, labelsState(o), t('mm.labelsName'));
}

/** Start Mail Merge ▸ a type. Envelopes and Labels lay the document out for it. */
export async function startMerge(c, type) {
  const m = merge(c) || { type, fields: [], records: [], include: [], db: 'Addresses', table: 'Sheet1', source: null, skipIf: null };
  if (type === 'envelopes' || type === 'labels') {
    const o = type === 'envelopes' ? await envelopeDialog('', '') : await labelsDialog('', { forMerge: true });
    if (!o) return;
    const content = () => (m.fields.length ? addressBlock(m, { name: 'first last', company: true, address: true, country: true }) : []);
    const st = type === 'envelopes' ? envelopeState(o, content()) : labelsState(o, content, m);
    st.mailMerge = { ...m, type };
    await openState(c, st, t(type === 'envelopes' ? 'mm.envelopeName' : 'mm.labelsName'));
    return;
  }
  setMerge(c, { ...m, type });
}

export function stopMerge(c) {
  editState(view(c), c.session.state, ['mailMerge'], (st) => { st.mailMerge = null; return true; });
  c.store.set({ mergePreview: false });
  refresh(c);
}
