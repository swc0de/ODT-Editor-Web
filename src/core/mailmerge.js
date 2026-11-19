/**
 * Mail merge. The recipient list lives in state.mailMerge:
 *   { type: 'letters' | 'envelopes' | 'labels' | 'directory' | null,
 *     source: { name, kind: 'csv' | 'xlsx' | 'typed' }, db, table,
 *     fields: [names], records: [[values]], include: [bool], skipIf: { field, op, value } | null }
 * and is saved in the package as MailMerge/recipients.json (the document
 * keeps its data, as Word does with an embedded list).
 *
 * In the text, merge fields are ODF database fields LibreOffice understands:
 *   text:database-display     a column («First Name»)
 *   text:conditional-text     If…Then…Else (text:condition in LibreOffice's syntax)
 *   text:text-input           Fill-in (a prompt)
 *   text:database-next        Next Record (labels)
 *   text:database-row-number  Merge Record #
 */
import { schema } from './schema.js';

export const MERGE_FILE = 'MailMerge/recipients.json';
export const DB_ELEMENTS = new Set(['text:database-display', 'text:conditional-text', 'text:text-input', 'text:database-next', 'text:database-row-number']);
export const DEFAULT_FIELDS = ['Title', 'First Name', 'Last Name', 'Company', 'Address Line 1', 'Address Line 2', 'City', 'County', 'Postcode', 'Country', 'Email'];

export const mergeOf = (st) => st?.mailMerge || null;
export const hasRecipients = (st) => !!st?.mailMerge?.fields?.length;

// ------------------------------------------------------------------ reading lists

/** Parses CSV / TSV text (quotes, doubled quotes, newlines in quotes; , ; or tab detected). */
export function parseCsv(text) {
  const src = text.replace(/^﻿/, '');
  const first = src.split(/\r?\n/)[0] || '';
  const delim = [',', ';', '\t'].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Rows (first = header) → { fields, records }. */
export function fromRows(rows) {
  const header = (rows[0] || []).map((h, i) => String(h ?? '').trim() || `Column ${i + 1}`);
  const seen = new Map();
  const fields = header.map((h) => { const n = (seen.get(h) || 0) + 1; seen.set(h, n); return n > 1 ? `${h} ${n}` : h; });
  const records = rows.slice(1).map((r) => fields.map((_, i) => (r[i] == null ? '' : String(r[i]))));
  return { fields, records };
}

/** A recipient list from data: { fields, records } + source. */
export function newMerge(prev, { fields, records, source, table = 'Sheet1' }) {
  return {
    type: prev?.type || 'letters', source, db: source.name.replace(/\.[^.]+$/, '') || 'Addresses', table,
    fields, records, include: records.map(() => true), skipIf: prev?.skipIf || null,
  };
}

/** The records that take part, in order: [{ index, values }] (unticked and skipped ones left out). */
export function includedRecords(m) {
  if (!m) return [];
  return m.records.map((values, index) => ({ index, values })).filter(({ index, values }) => m.include[index] !== false && !(m.skipIf && test(m.skipIf, valueOf(m, values, m.skipIf.field))));
}

export const valueOf = (m, values, field) => { const i = m.fields.indexOf(field); return i < 0 ? '' : (values[i] ?? ''); };

// ------------------------------------------------------------------ conditions

export const OPS = ['eq', 'ne', 'lt', 'gt', 'le', 'ge', 'blank', 'notBlank'];
const SYM = { eq: '==', ne: '!=', lt: '<', gt: '>', le: '<=', ge: '>=' };

/** Evaluates { op, value } against a field's value (numbers compare as numbers). */
export function test({ op, value }, actual) {
  const a = String(actual ?? '');
  const b = String(value ?? '');
  if (op === 'blank') return a.trim() === '';
  if (op === 'notBlank') return a.trim() !== '';
  const na = Number(a);
  const nb = Number(b);
  const num = a !== '' && b !== '' && !Number.isNaN(na) && !Number.isNaN(nb);
  const c = num ? na - nb : a.localeCompare(b, 'en-GB', { sensitivity: 'base' });
  return { eq: c === 0, ne: c !== 0, lt: c < 0, gt: c > 0, le: c <= 0, ge: c >= 0 }[op] ?? false;
}

/** A condition in LibreOffice's field syntax: ooow:[db.table.field] == "value". */
export function conditionText(m, { field, op, value }) {
  const ref = `[${m?.db || 'Addresses'}.${m?.table || 'Sheet1'}.${field}]`;
  if (op === 'blank') return `ooow:${ref} == ""`;
  if (op === 'notBlank') return `ooow:${ref} != ""`;
  return `ooow:${ref} ${SYM[op]} "${String(value).replace(/"/g, '\\"')}"`;
}

/** Parses conditionText back → { field, op, value } (or null). */
export function parseCondition(text) {
  const m = /^(?:ooow:)?\s*\[[^\].]*\.[^\].]*\.([^\]]+)\]\s*(==|!=|<=|>=|<|>|EQ|NEQ|LT|GT|LEQ|GEQ)\s*"((?:[^"\\]|\\.)*)"\s*$/.exec(String(text || '').trim());
  if (!m) return null;
  const op = { '==': 'eq', EQ: 'eq', '!=': 'ne', NEQ: 'ne', '<': 'lt', LT: 'lt', '>': 'gt', GT: 'gt', '<=': 'le', LEQ: 'le', '>=': 'ge', GEQ: 'ge' }[m[2]];
  const value = m[3].replace(/\\"/g, '"');
  if (value === '' && op === 'eq') return { field: m[1], op: 'blank', value: '' };
  if (value === '' && op === 'ne') return { field: m[1], op: 'notBlank', value: '' };
  return { field: m[1], op, value };
}

// ------------------------------------------------------------------ fields

const base = (m) => ({ 'text:table-name': m?.table || 'Sheet1', 'text:table-type': 'table', 'text:database-name': m?.db || 'Addresses' });

export const mergeField = (m, column) => schema.nodes.field.create({ element: 'text:database-display', fieldAttrs: { ...base(m), 'text:column-name': column }, text: `«${column}»` });

export function conditionalField(m, rule) {
  return schema.nodes.field.create({
    element: 'text:conditional-text',
    fieldAttrs: { 'text:condition': conditionText(m, rule), 'text:string-value-if-true': rule.then || '', 'text:string-value-if-false': rule.otherwise || '' },
    text: rule.otherwise || rule.then || '',
  });
}

export const fillInField = (prompt, deflt) => schema.nodes.field.create({ element: 'text:text-input', fieldAttrs: { 'text:description': prompt }, text: deflt || '' });
export const nextRecordField = (m) => schema.nodes.field.create({ element: 'text:database-next', fieldAttrs: { ...base(m), 'text:condition': '' }, text: '' });
export const recordNumberField = (m) => schema.nodes.field.create({ element: 'text:database-row-number', fieldAttrs: { ...base(m), 'style:num-format': '1' }, text: '1' });

/** Recognised parts of an address: field names by role. */
const ROLES = {
  title: ['title', 'courtesy title', 'salutation', 'honorific'],
  first: ['first name', 'firstname', 'forename', 'given name', 'first'],
  last: ['last name', 'lastname', 'surname', 'family name', 'last'],
  company: ['company', 'company name', 'organisation', 'organization'],
  address1: ['address line 1', 'address 1', 'address1', 'address', 'street', 'street address'],
  address2: ['address line 2', 'address 2', 'address2'],
  city: ['city', 'town', 'town/city'],
  region: ['county', 'state', 'region', 'province'],
  postcode: ['postcode', 'post code', 'postal code', 'zip', 'zip code'],
  country: ['country', 'country or region'],
};
export function matchFields(fields) {
  const out = {};
  for (const [role, names] of Object.entries(ROLES)) out[role] = fields.find((f) => names.includes(f.toLowerCase().trim())) || null;
  return out;
}

const space = () => schema.text(' ');
/** Address Block content: lines of fields (o = { name: 'first last' | 'title first last' | 'first', company, address, country }). */
export function addressBlock(m, o) {
  const f = matchFields(m.fields);
  const lines = [];
  const name = (o.name === 'title first last' ? [f.title, f.first, f.last] : o.name === 'first' ? [f.first] : [f.first, f.last]).filter(Boolean);
  if (name.length) lines.push(name);
  if (o.company && f.company) lines.push([f.company]);
  if (o.address) {
    for (const k of ['address1', 'address2', 'city', 'region', 'postcode']) if (f[k]) lines.push([f[k]]);
    if (o.country && f.country) lines.push([f.country]);
  }
  const content = [];
  lines.forEach((line, i) => {
    if (i) content.push(schema.nodes.hard_break.create());
    line.forEach((col, k) => { if (k) content.push(space()); content.push(mergeField(m, col)); });
  });
  return content;
}

/** Greeting Line content: "Dear «First Name» «Last Name»," (o = { salutation, name, punctuation }). */
export function greetingLine(m, o) {
  const f = matchFields(m.fields);
  const parts = { 'title last': [f.title, f.last], first: [f.first], 'first last': [f.first, f.last], 'title first last': [f.title, f.first, f.last] }[o.name] || [f.first];
  const content = [];
  if (o.salutation) content.push(schema.text(`${o.salutation} `));
  parts.filter(Boolean).forEach((col, k) => { if (k) content.push(space()); content.push(mergeField(m, col)); });
  if (o.punctuation) content.push(schema.text(o.punctuation));
  return content;
}

// ------------------------------------------------------------------ the merge

/**
 * Shown values of the merge fields for preview: Map(pos → text), starting at
 * included record `at` (Next Record fields move on to the next record).
 */
export function previewValues(doc, m, at) {
  const recs = includedRecords(m);
  const out = new Map();
  let i = at;
  doc.descendants((n, pos) => {
    if (n.type.name !== 'field' || !DB_ELEMENTS.has(n.attrs.element)) return true;
    const rec = recs[i];
    out.set(pos, rec ? fieldValue(n.attrs, m, rec) : '');
    if (n.attrs.element === 'text:database-next') i++;
    return false;
  });
  return out;
}

/** The text a merge field shows for a record ({ index, values }). */
export function fieldValue(attrs, m, rec, answers = {}) {
  const a = attrs.fieldAttrs || {};
  switch (attrs.element) {
    case 'text:database-display': return valueOf(m, rec.values, a['text:column-name']);
    case 'text:conditional-text': {
      const c = parseCondition(a['text:condition']);
      return c && test(c, valueOf(m, rec.values, c.field)) ? (a['text:string-value-if-true'] || '') : (a['text:string-value-if-false'] || '');
    }
    case 'text:text-input': return answers[a['text:description'] || ''] ?? attrs.text;
    case 'text:database-row-number': return String(rec.index + 1);
    default: return '';
  }
}

/**
 * A paragraph's inline content with merge fields replaced by text. cur =
 * { rec(), next() }. Address lines made only of fields that come out empty are dropped.
 */
function mergeInline(content, m, cur, answers) {
  const lines = [[]];
  for (const n of content) {
    if (n.type === 'hard_break') lines.push([n]); else lines[lines.length - 1].push(n);
  }
  const out = [];
  for (const line of lines) {
    let hadField = false;
    let onlyFields = true;
    const mapped = [];
    for (const n of line) {
      if (n.type === 'field' && DB_ELEMENTS.has(n.attrs.element)) {
        hadField = true;
        if (n.attrs.element === 'text:database-next') { cur.next(); continue; }
        const v = fieldValue(n.attrs, m, cur.rec(), answers);
        if (v) mapped.push({ type: 'text', text: v, ...(n.marks ? { marks: n.marks } : {}) });
        continue;
      }
      if (n.type !== 'hard_break' && !(n.type === 'text' && !n.text.trim())) onlyFields = false;
      mapped.push(n);
    }
    const empty = mapped.every((n) => n.type === 'hard_break' || (n.type === 'text' && !n.text.trim()));
    if (hadField && onlyFields && empty && lines.length > 1) continue; // an empty address line
    // A dropped first line must not leave the next line starting with its break.
    out.push(...(out.length ? mapped : mapped.filter((n, i) => !(i === 0 && n.type === 'hard_break'))));
  }
  const merged = [];
  for (const n of out) {
    const prev = merged[merged.length - 1];
    if (prev && prev.type === 'text' && n.type === 'text' && JSON.stringify(prev.marks || []) === JSON.stringify(n.marks || [])) prev.text += n.text;
    else merged.push(n.type === 'text' ? { ...n } : n);
  }
  return merged.filter((n) => n.type !== 'text' || n.text);
}

/**
 * Merges the document (JSON) for records: one copy per record (or, with Next
 * Record fields, per group of records, as on a sheet of labels), each copy
 * after the first starting on a new page unless `continuous` (a directory).
 * Returns block JSON.
 */
export function mergeBlocks(docJson, m, records, { answers = {}, continuous = false } = {}) {
  const out = [];
  let i = 0;
  while (i < records.length) {
    let at = i;
    const empty = { index: -1, values: [] };
    const cur = { rec: () => records[at] || empty, next: () => { at++; } };
    const walk = (blocks) => blocks.map((b) => {
      if (b.type === 'paragraph' || b.type === 'heading') return b.content ? { ...b, content: mergeInline(b.content, m, cur, answers) } : b;
      return b.content ? { ...b, content: walk(b.content) } : b;
    });
    const copy = walk(docJson.content);
    if (i > 0 && !continuous && copy.length && (copy[0].type === 'paragraph' || copy[0].type === 'heading')) {
      const b = copy[0];
      const auto = b.attrs?.auto || { styleAttrs: {}, props: {} };
      const pp = auto.props?.['style:paragraph-properties'] || { a: {} };
      copy[0] = { ...b, attrs: { ...b.attrs, auto: { ...auto, props: { ...auto.props, 'style:paragraph-properties': { ...pp, a: { ...pp.a, 'fo:break-before': 'page' } } } } } };
    }
    out.push(...copy);
    i = at + 1;
  }
  return out;
}
