/**
 * Mailings dialogs: Edit Recipient List / New Address List, Insert Address
 * Block, Insert Greeting Line, Rules (If…Then…Else, Fill-in, Skip Record If),
 * Find Recipient, Merge to New Document, Envelopes, Labels.
 */
import { h } from './dom.js';
import { t } from '../i18n/index.js';
import { showDialog } from './dialog.js';
import { field, select, text, check, row, group, radios } from './form.js';
import { OPS, includedRecords } from '../core/mailmerge.js';

const okCancel = (ok = t('common.ok')) => [{ label: ok, value: true, primary: true }, { label: t('common.cancel'), value: false }];
const opOptions = () => OPS.map((o) => [o, t(`mm.op.${o}`)]);

/**
 * Edit Recipient List (and New Address List when `typed`): tick recipients,
 * sort by a column, filter; a typed list can be edited, with entries and
 * columns added or removed. merge → updated copy or null.
 */
export async function recipientsDialog(merge) {
  const m = structuredClone(merge);
  const typed = m.source?.kind === 'typed';
  let sortCol = -1;
  let sortDir = 1;
  const filter = text('', { placeholder: t('mm.filter'), 'aria-label': t('mm.filter') });
  const tbl = h('table', { class: 'mm-table' });
  const wrap = h('div', { class: 'mm-table-wrap' }, tbl);
  const count = h('span', { class: 'mm-count' });
  const order = () => {
    const idx = m.records.map((_, i) => i);
    if (sortCol >= 0) idx.sort((a, b) => sortDir * String(m.records[a][sortCol] ?? '').localeCompare(String(m.records[b][sortCol] ?? ''), 'en-GB', { numeric: true }));
    const q = filter.value.trim().toLowerCase();
    return q ? idx.filter((i) => m.records[i].some((v) => String(v).toLowerCase().includes(q))) : idx;
  };
  const draw = () => {
    const all = h('input', { type: 'checkbox', 'aria-label': t('mm.all') });
    all.checked = m.include.every((x) => x !== false);
    all.addEventListener('change', () => { m.include = m.include.map(() => all.checked); draw(); });
    const head = h('tr', {}, h('th', {}, all), ...m.fields.map((f, c) => {
      const b = h('button', { type: 'button', class: 'mm-sort', onclick: () => { sortDir = sortCol === c ? -sortDir : 1; sortCol = c; draw(); } }, f, sortCol === c ? (sortDir > 0 ? ' ▲' : ' ▼') : '');
      return h('th', {}, b);
    }));
    const rows = order().map((i) => {
      const cb = h('input', { type: 'checkbox', 'aria-label': t('mm.include', { n: i + 1 }) });
      cb.checked = m.include[i] !== false;
      cb.addEventListener('change', () => { m.include[i] = cb.checked; count.textContent = t('mm.count', { n: m.include.filter((x) => x !== false).length, of: m.records.length }); });
      return h('tr', { 'data-row': String(i) }, h('td', {}, cb), ...m.fields.map((_, c) => {
        if (!typed) return h('td', {}, m.records[i][c] ?? '');
        const inp = h('input', { type: 'text', class: 'mm-cell', value: m.records[i][c] ?? '', 'aria-label': `${m.fields[c]} ${i + 1}` });
        inp.addEventListener('input', () => { m.records[i][c] = inp.value; });
        return h('td', {}, inp);
      }));
    });
    tbl.replaceChildren(h('thead', {}, head), h('tbody', {}, ...rows));
    count.textContent = t('mm.count', { n: m.include.filter((x) => x !== false).length, of: m.records.length });
  };
  filter.addEventListener('input', draw);
  const tools = typed ? h('div', { class: 'mm-tools' },
    h('button', { type: 'button', class: 'dlg-btn', onclick: () => { m.records.push(m.fields.map(() => '')); m.include.push(true); draw(); wrap.scrollTop = wrap.scrollHeight; tbl.querySelector('tbody tr:last-child input.mm-cell')?.focus(); } }, t('mm.newEntry')),
    h('button', { type: 'button', class: 'dlg-btn', onclick: () => { const r = tbl.querySelector('tbody tr:focus-within'); if (!r) return; const i = Number(r.dataset.row); m.records.splice(i, 1); m.include.splice(i, 1); draw(); } }, t('mm.deleteEntry')),
    h('button', { type: 'button', class: 'dlg-btn', onclick: async () => {
      const name = text('');
      const ok = await showDialog({ title: t('mm.addColumn'), message: field(t('mm.columnName'), name, { wide: true }), buttons: okCancel(), cancelValue: false, validate: () => !!name.value.trim() && !m.fields.includes(name.value.trim()) });
      if (!ok) return;
      m.fields.push(name.value.trim());
      for (const r of m.records) r.push('');
      draw();
    } }, t('mm.addColumn'))) : null;
  draw();
  const body = h('div', { class: 'mm-dlg' }, h('div', { class: 'mm-bar' }, filter, count), wrap, tools);
  const ok = await showDialog({ title: t(typed ? 'mm.typedTitle' : 'mm.recipientsTitle'), message: body, buttons: okCancel(), cancelValue: false, wide: true });
  return ok ? m : null;
}

/** A small preview of the first included recipient. */
const previewBox = () => h('div', { class: 'ref-preview mm-preview' });

/** Insert Address Block → { name, company, address, country } or null. preview(o) → text */
export async function addressBlockDialog(preview) {
  const name = select([['first last', 'Joshua Randall'], ['title first last', 'Mr Joshua Randall'], ['first', 'Joshua']], 'first last');
  const company = check(t('mm.insertCompany'), true);
  const address = check(t('mm.insertAddress'), true);
  const country = check(t('mm.insertCountry'), true);
  const box = previewBox();
  const o = () => ({ name: name.value, company: company.input.checked, address: address.input.checked, country: country.input.checked });
  const draw = () => { box.textContent = preview(o()); };
  [name, company.input, address.input, country.input].forEach((x) => x.addEventListener('change', draw));
  draw();
  const body = h('div', { class: 'ref-dlg' }, field(t('mm.nameFormat'), name, { wide: true }), company, address, country, h('label', { class: 'fm-label' }, t('mm.preview')), box);
  const ok = await showDialog({ title: t('mm.addressTitle'), message: body, buttons: okCancel(), cancelValue: false });
  return ok ? o() : null;
}

/** Insert Greeting Line → { salutation, name, punctuation } or null. */
export async function greetingDialog(preview) {
  const sal = select([['Dear', 'Dear'], ['To', 'To'], ['', t('mm.none')]], 'Dear');
  const name = select([['first', 'Joshua'], ['first last', 'Joshua Randall'], ['title last', 'Mr Randall'], ['title first last', 'Mr Joshua Randall']], 'first');
  const punct = select([[',', ','], [':', ':'], ['', t('mm.none')]], ',');
  const box = previewBox();
  const o = () => ({ salutation: sal.value, name: name.value, punctuation: punct.value });
  const draw = () => { box.textContent = preview(o()); };
  [sal, name, punct].forEach((x) => x.addEventListener('change', draw));
  draw();
  const body = h('div', { class: 'ref-dlg' }, row(field(t('mm.salutation'), sal), field(t('mm.nameFormat'), name), field(t('mm.punctuation'), punct)), h('label', { class: 'fm-label' }, t('mm.preview')), box);
  const ok = await showDialog({ title: t('mm.greetingTitle'), message: body, buttons: okCancel(), cancelValue: false });
  return ok ? o() : null;
}

/** If…Then…Else / Skip Record If: { field, op, value (, then, otherwise) } or null. */
export async function ruleDialog(fields, { withText = true, title } = {}) {
  const f = select(fields.map((x) => [x, x]), fields[0]);
  const op = select(opOptions(), 'eq');
  const val = text('');
  const then = text('');
  const otherwise = text('');
  op.addEventListener('change', () => { val.disabled = op.value === 'blank' || op.value === 'notBlank'; });
  const body = h('div', { class: 'ref-dlg' },
    row(field(t('mm.fieldName'), f), field(t('mm.comparison'), op), field(t('mm.compareTo'), val)),
    withText ? field(t('mm.thenText'), then, { wide: true }) : null,
    withText ? field(t('mm.elseText'), otherwise, { wide: true }) : null);
  const ok = await showDialog({ title, message: body, buttons: okCancel(), cancelValue: false });
  return ok ? { field: f.value, op: op.value, value: val.value, then: then.value, otherwise: otherwise.value } : null;
}

/** Fill-in: { prompt, deflt } or null. */
export async function fillInDialog() {
  const prompt = text('', { 'aria-label': t('mm.prompt') });
  const deflt = text('');
  const ok = await showDialog({ title: t('mm.fillInTitle'), message: h('div', { class: 'ref-dlg' }, field(t('mm.prompt'), prompt, { wide: true }), field(t('mm.defaultText'), deflt, { wide: true })), buttons: okCancel(), cancelValue: false, validate: () => !!prompt.value.trim() });
  return ok ? { prompt: prompt.value.trim(), deflt: deflt.value } : null;
}

/** Asks a Fill-in prompt during a merge → answer (or the default). */
export async function askDialog(prompt, deflt) {
  const v = text(deflt || '', { 'aria-label': prompt });
  const ok = await showDialog({ title: t('mm.fillInTitle'), message: h('div', { class: 'ref-dlg' }, h('p', {}, prompt), v), buttons: okCancel(), cancelValue: false });
  return ok ? v.value : deflt || '';
}

/** Find Recipient → { text, field ('' = all) } or null. */
export async function findRecipientDialog(fields) {
  const q = text('', { 'aria-label': t('mm.findWhat') });
  const f = select([['', t('mm.allFields')], ...fields.map((x) => [x, x])], '');
  const ok = await showDialog({ title: t('mm.findTitle'), message: h('div', { class: 'ref-dlg' }, field(t('mm.findWhat'), q, { wide: true }), field(t('mm.lookIn'), f, { wide: true })), buttons: okCancel(t('mm.findNext')), cancelValue: false, validate: () => !!q.value.trim() });
  return ok ? { text: q.value.trim(), field: f.value } : null;
}

/** Merge to New Document → { from, to } (1-based, inclusive) or null. */
export async function mergeToDialog(total, current) {
  const which = radios('mm-which', [['all', t('mm.all')], ['current', t('mm.currentRecord')], ['range', t('mm.from')]], 'all');
  const from = text('1', { style: 'width:60px', 'aria-label': t('mm.from') });
  const to = text(String(total), { style: 'width:60px', 'aria-label': t('mm.to') });
  const body = h('div', { class: 'ref-dlg' }, group(t('mm.mergeRecords'), which, row(field(t('mm.from'), from), field(t('mm.to'), to))));
  const ok = await showDialog({ title: t('mm.mergeTitle'), message: body, buttons: okCancel(), cancelValue: false });
  if (!ok) return null;
  const w = which.value();
  if (w === 'current') return { from: current, to: current };
  if (w === 'range') return { from: Math.max(1, Number(from.value) || 1), to: Math.min(total, Number(to.value) || total) };
  return { from: 1, to: total };
}

export const ENVELOPES = { dl: ['DL (110 × 220 mm)', 11, 22], c5: ['C5 (162 × 229 mm)', 16.2, 22.9], c6: ['C6 (114 × 162 mm)', 11.4, 16.2], c4: ['C4 (229 × 324 mm)', 22.9, 32.4], '10': ['Size 10 (4⅛ × 9½ in)', 10.48, 24.13], monarch: ['Monarch (3⅞ × 7½ in)', 9.84, 19.05] };

/** Envelopes → { delivery, returnAddr, omitReturn, size } or null. */
export async function envelopeDialog(delivery, returnAddr) {
  const del = h('textarea', { class: 'fm-input mm-area', rows: '5', 'aria-label': t('mm.delivery') }, delivery);
  const ret = h('textarea', { class: 'fm-input mm-area', rows: '4', 'aria-label': t('mm.return') }, returnAddr);
  const omit = check(t('mm.omit'), false);
  const size = select(Object.entries(ENVELOPES).map(([k, v]) => [k, v[0]]), 'dl');
  const body = h('div', { class: 'ref-dlg mm-env' }, field(t('mm.delivery'), del, { wide: true }), field(t('mm.return'), ret, { wide: true }), omit, field(t('mm.envelopeSize'), size, { wide: true }));
  const ok = await showDialog({ title: t('mm.envelopesTitle'), message: body, buttons: okCancel(t('mm.createDocument')), cancelValue: false });
  return ok ? { delivery: del.value, returnAddr: ret.value, omitReturn: omit.input.checked, size: size.value } : null;
}

/** Label products: [name, page, cols, rows, width cm, height cm, top margin, left margin, h pitch, v pitch]. */
export const LABELS = {
  l7160: ['Avery L7160 — 21 per A4 sheet (63.5 × 38.1 mm)', 'A4', 3, 7, 6.35, 3.81, 1.51, 0.72, 6.6, 3.81],
  l7163: ['Avery L7163 — 14 per A4 sheet (99.1 × 38.1 mm)', 'A4', 2, 7, 9.91, 3.81, 1.51, 0.47, 10.16, 3.81],
  l7173: ['Avery L7173 — 10 per A4 sheet (99.1 × 57 mm)', 'A4', 2, 5, 9.91, 5.7, 0.6, 0.47, 10.16, 5.7],
  l7159: ['Avery L7159 — 24 per A4 sheet (63.5 × 33.9 mm)', 'A4', 3, 8, 6.35, 3.39, 1.29, 0.66, 6.6, 3.39],
  l7651: ['Avery L7651 — 65 per A4 sheet (38.1 × 21.2 mm)', 'A4', 5, 13, 3.81, 2.12, 1.09, 0.47, 4.04, 2.12],
  a5160: ['Avery 5160 — 30 per Letter sheet (1 × 2⅝ in)', 'Letter', 3, 10, 6.67, 2.54, 1.27, 0.48, 6.99, 2.54],
  a5163: ['Avery 5163 — 10 per Letter sheet (2 × 4 in)', 'Letter', 2, 5, 10.16, 5.08, 1.27, 0.4, 10.4, 5.08],
};

/** Labels → { address, product, fullPage, row, col } or null. */
export async function labelsDialog(address, { forMerge = false } = {}) {
  const addr = h('textarea', { class: 'fm-input mm-area', rows: '5', 'aria-label': t('mm.address') }, address);
  const product = select(Object.entries(LABELS).map(([k, v]) => [k, v[0]]), 'l7160');
  const which = radios('mm-lbl', [['full', t('mm.fullPage')], ['single', t('mm.singleLabel')]], 'full');
  const r = text('1', { style: 'width:50px', 'aria-label': t('mm.row') });
  const c = text('1', { style: 'width:50px', 'aria-label': t('mm.column') });
  const body = h('div', { class: 'ref-dlg mm-env' },
    forMerge ? h('p', { class: 'fm-hint' }, t('mm.labelsMergeHint')) : field(t('mm.address'), addr, { wide: true }),
    field(t('mm.product'), product, { wide: true }),
    forMerge ? null : group(t('mm.print'), which, row(field(t('mm.row'), r), field(t('mm.column'), c))));
  const ok = await showDialog({ title: t('mm.labelsTitle'), message: body, buttons: okCancel(t('mm.createDocument')), cancelValue: false });
  return ok ? { address: addr.value, product: product.value, fullPage: forMerge || which.value() === 'full', row: Number(r.value) || 1, col: Number(c.value) || 1 } : null;
}

export { includedRecords };
