/**
 * Envelope and label documents (Mailings ▸ Create, and Start Mail Merge ▸
 * Envelopes / Labels): a new document with the right page size and margins,
 * the addresses in place, and for labels a table whose cells are the labels.
 */
import { schema } from './schema.js';
import { createBlankState } from './document.js';
import { updatePageLayouts, findMaster } from './page-setup.js';
import { createTable, changeAuto } from './commands/tables.js';
import { ENVELOPES, LABELS } from '../ui/mailing-dialogs.js';
import { nextRecordField } from './mailmerge.js';

const CM = 96 / 2.54;
const cm = (v) => `${v.toFixed(3)}cm`;

/** Lines of text → paragraph content with line breaks. */
const lines = (txt) => {
  const out = [];
  String(txt || '').split(/\r?\n/).forEach((l, i) => { if (i) out.push(schema.nodes.hard_break.create()); if (l) out.push(schema.text(l)); });
  return out;
};

function pageSetup(state, attrs) {
  const master = findMaster(state, 'Standard') ? 'Standard' : (state.masterStyles?.c || []).find((m) => typeof m !== 'string')?.a['style:name'];
  updatePageLayouts(state, [master], () => ({ attrs }));
}

/**
 * Envelope document. o = { delivery, returnAddr, omitReturn, size } (or a
 * `delivery` made of merge fields: deliveryContent).
 */
export function envelopeState(o, deliveryContent = null) {
  const state = createBlankState();
  const [, h, w] = ENVELOPES[o.size] || ENVELOPES.dl;
  pageSetup(state, { 'fo:page-width': cm(w), 'fo:page-height': cm(h), 'style:print-orientation': 'landscape', 'fo:margin-top': '1.000cm', 'fo:margin-bottom': '1.000cm', 'fo:margin-left': '1.500cm', 'fo:margin-right': '1.500cm' });
  const P = (content, auto = null) => schema.nodes.paragraph.create({ styleName: 'Standard', auto }, content);
  const indent = (w - 3) * 0.42;
  const down = Math.max(1, h * 0.28 - (o.omitReturn ? 0 : 1.5));
  const deliveryAuto = { styleAttrs: {}, props: { 'style:paragraph-properties': { a: { 'fo:margin-left': cm(indent), 'fo:margin-top': cm(down) } } } };
  const blocks = [];
  if (!o.omitReturn && o.returnAddr?.trim()) blocks.push(P(lines(o.returnAddr), { styleAttrs: {}, props: { 'style:text-properties': { a: { 'fo:font-size': '10pt' } } } }));
  blocks.push(P(deliveryContent || lines(o.delivery), deliveryAuto));
  state.doc = schema.node('doc', null, blocks);
  return state;
}

/**
 * Labels document. o = { address, product, fullPage, row, col }; with
 * `mergeContent`, every label holds the merge fields, each after the first
 * starting with a Next Record field.
 */
export function labelsState(o, mergeContent = null, merge = null) {
  const [, page, cols, rows, lw, lh, top, left, hp, vp] = LABELS[o.product] || LABELS.l7160;
  const state = createBlankState();
  const [pw, ph] = page === 'Letter' ? [21.59, 27.94] : [21.0, 29.7];
  pageSetup(state, { 'fo:page-width': cm(pw), 'fo:page-height': cm(ph), 'fo:margin-top': cm(top), 'fo:margin-bottom': '0.300cm', 'fo:margin-left': cm(left), 'fo:margin-right': '0.300cm' });
  const width = cols * hp * CM;
  const cell = { 'fo:border': 'none', 'fo:padding-left': '0.250cm', 'fo:padding-right': '0.250cm', 'fo:padding-top': '0.150cm', 'fo:padding-bottom': '0.100cm' };
  let table = createTable({ rows, cols, width, cell, widths: Array.from({ length: cols }, (_, i) => (i < cols - 1 ? hp : lw) * CM) });
  void vp;
  const rowsOut = [];
  let n = 0;
  table.forEach((row, _o, r) => {
    const cells = [];
    row.forEach((c, _o2, k) => {
      let content = [];
      if (mergeContent) {
        content = n === 0 ? mergeContent() : [nextRecordField(merge), ...mergeContent()];
      } else if (o.fullPage || (r === o.row - 1 && k === o.col - 1)) content = lines(o.address);
      n++;
      cells.push(c.type.create(c.attrs, schema.nodes.paragraph.create({ styleName: 'Table_20_Contents' }, content)));
    });
    // Exact row height = the label's height.
    rowsOut.push(row.type.create({ ...row.attrs, auto: changeAuto(row.attrs.auto, 'style:table-row-properties', { 'style:row-height': cm(lh) }) }, cells));
  });
  table = table.type.create({ ...table.attrs, auto: changeAuto(table.attrs.auto, 'style:table-properties', { 'table:align': 'left', 'style:width': cm(width / CM) }) }, rowsOut);
  state.doc = schema.node('doc', null, [table, schema.nodes.paragraph.create({ styleName: 'Standard' })]);
  return state;
}
