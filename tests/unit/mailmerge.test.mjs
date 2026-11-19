import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schema } from '../../src/core/schema.js';
import { parseCsv, fromRows, newMerge, includedRecords, mergeField, conditionalField, mergeBlocks, addressBlock, greetingLine, parseCondition, conditionText, nextRecordField } from '../../src/core/mailmerge.js';

const csv = 'Title,First Name,Last Name,Company,Address Line 1,City,Postcode,Points\nMs,Ada,Lovelace,,"12 Engine Street, Flat 2",London,N1 1AA,120\nMr,"Charles ""Chuck""",Babbage,Analytical Ltd,3 Gear Road,Cambridge,CB2 1TN,80\n';
const m0 = () => { const { fields, records } = fromRows(parseCsv(csv)); return newMerge(null, { fields, records, source: { name: 'people.csv', kind: 'csv' } }); };
const text = (blocks) => blocks.map((b) => (b.content || []).map((n) => (n.type === 'hard_break' ? '\\n' : n.text || '')).join('')).join(' | ');

test('CSV with quotes, commas and doubled quotes', () => {
  const m = m0();
  assert.deepEqual(m.fields.slice(0, 3), ['Title', 'First Name', 'Last Name']);
  assert.equal(m.records[0][4], '12 Engine Street, Flat 2');
  assert.equal(m.records[1][1], 'Charles "Chuck"');
  assert.equal(m.db, 'people');
});

test('merge: fields, conditional text, empty address lines dropped, one page per record', () => {
  const m = m0();
  const para = (content) => schema.nodes.paragraph.create(null, content).toJSON();
  const doc = {
    type: 'doc',
    content: [
      { type: 'paragraph', attrs: { styleName: 'Standard' }, content: addressBlock(m, { name: 'first last', company: true, address: true }).map((n) => n.toJSON()) },
      { type: 'paragraph', attrs: { styleName: 'Standard' }, content: greetingLine(m, { salutation: 'Dear', name: 'first', punctuation: ',' }).map((n) => n.toJSON()) },
      para([schema.text('You have '), mergeField(m, 'Points'), schema.text(' points. '), conditionalField(m, { field: 'Points', op: 'ge', value: '100', then: 'Gold member!', otherwise: 'Keep going.' })]),
    ],
  };
  const out = mergeBlocks(doc, m, includedRecords(m));
  assert.equal(out.length, 6);
  assert.equal(text(out.slice(0, 3)), 'Ada Lovelace\\n12 Engine Street, Flat 2\\nLondon\\nN1 1AA | Dear Ada, | You have 120 points. Gold member!');
  assert.equal(text(out.slice(3)), 'Charles "Chuck" Babbage\\nAnalytical Ltd\\n3 Gear Road\\nCambridge\\nCB2 1TN | Dear Charles "Chuck", | You have 80 points. Keep going.');
  assert.equal(out[3].attrs.auto.props['style:paragraph-properties'].a['fo:break-before'], 'page');
});

test('skip records and unticked recipients; Next Record puts several records on one page', () => {
  const m = m0();
  m.skipIf = { field: 'City', op: 'eq', value: 'Cambridge' };
  assert.deepEqual(includedRecords(m).map((r) => r.index), [0]);
  m.skipIf = null;
  m.include[0] = false;
  assert.deepEqual(includedRecords(m).map((r) => r.index), [1]);
  m.include[0] = true;
  const doc = { type: 'doc', content: [schema.nodes.paragraph.create(null, [mergeField(m, 'First Name'), schema.text(' / '), nextRecordField(m), mergeField(m, 'First Name')]).toJSON()] };
  const out = mergeBlocks(doc, m, includedRecords(m));
  assert.equal(text(out), 'Ada / Charles "Chuck"');
});

test('conditions round-trip through LibreOffice syntax', () => {
  const m = m0();
  for (const c of [{ field: 'City', op: 'eq', value: 'London' }, { field: 'Points', op: 'ge', value: '100' }, { field: 'Company', op: 'blank', value: '' }, { field: 'Company', op: 'notBlank', value: '' }]) {
    assert.deepEqual(parseCondition(conditionText(m, c)), c);
  }
});
