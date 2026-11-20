/** Mailings tab: Create, Start Mail Merge, Write & Insert Fields, Preview Results, Finish (M11). */
import { defineCommands } from '../define.js';

import {
  hasList, useExistingList, typeNewList, editRecipients, insertField, insertAddressBlock, insertGreeting, ruleIfThenElse, ruleFillIn, ruleSkipRecord,
  ruleNextRecord, ruleMergeRecord, recordCount, goRecord, setPreview, findRecipient, editIndividual, printDocuments, envelopes, labels, startMerge, stopMerge,
} from './merge.js';
import { mergeOf } from '../../core/mailmerge.js';

const canEdit = (c) => !!c.mainEditor && c.state.editingMode !== 'viewing';
const body = (c) => canEdit(c) && c.editor === c.mainEditor;
const withList = (c) => body(c) && hasList(c);
const preview = (c) => !!c.mainEditor && recordCount(c) > 0;
const kind = (type) => ({ isEnabled: canEdit, isChecked: (c) => mergeOf(c.session?.state)?.type === type, run: (c) => startMerge(c, type) });

export const commands = defineCommands('mailings', {
  envelopes: { icon: 'envelope', isEnabled: canEdit, run: envelopes },
  labels: { icon: 'labels', isEnabled: canEdit, run: labels },
  startMailMerge: { icon: 'start-merge', isEnabled: canEdit, menuOnly: true },
  mergeLetters: kind('letters'),
  mergeEmail: {},
  mergeEnvelopes: kind('envelopes'),
  mergeLabels: kind('labels'),
  mergeDirectory: kind('directory'),
  mergeNormal: { isEnabled: (c) => canEdit(c) && !!mergeOf(c.session?.state), run: stopMerge },
  selectRecipients: { icon: 'recipients', isEnabled: canEdit, menuOnly: true },
  typeNewList: { isEnabled: canEdit, run: typeNewList },
  useExistingList: { isEnabled: canEdit, run: useExistingList },
  editRecipientList: { icon: 'edit-recipients', isEnabled: (c) => canEdit(c) && hasList(c), run: editRecipients },
  highlightMergeFields: { icon: 'highlight-fields', isEnabled: (c) => !!c.mainEditor, isChecked: (c) => !!c.state.mergeHighlight, run: (c) => { c.store.set((s) => ({ mergeHighlight: !s.mergeHighlight })); const v = c.mainEditor.view; v.dispatch(v.state.tr.setMeta('tcSkip', true).setMeta('addToHistory', false)); } },
  addressBlock: { icon: 'address-block', isEnabled: withList, run: insertAddressBlock },
  greetingLine: { icon: 'greeting-line', isEnabled: withList, run: insertGreeting },
  insertMergeField: {
    icon: 'merge-field', isEnabled: withList,
    run: (c, column) => (typeof column === 'string' ? insertField(c, column) : undefined),
    fields: (c) => (hasList(c) ? mergeOf(c.session.state).fields : []),
  },
  rules: { icon: 'rules', isEnabled: withList, menuOnly: true },
  ruleIfThenElse: { isEnabled: withList, run: ruleIfThenElse },
  ruleFillIn: { isEnabled: body, run: ruleFillIn },
  ruleSkipRecord: { isEnabled: withList, run: ruleSkipRecord },
  ruleNextRecord: { isEnabled: withList, run: ruleNextRecord },
  ruleMergeRecord: { isEnabled: withList, run: ruleMergeRecord },
  previewResults: { icon: 'preview-results', isEnabled: preview, isChecked: (c) => !!c.state.mergePreview && preview(c), run: (c) => setPreview(c, !c.state.mergePreview) },
  firstRecord: { icon: 'first-record', isEnabled: preview, run: (c) => goRecord(c, 1) },
  previousRecord: { icon: 'previous-record', isEnabled: (c) => preview(c) && (c.state.mergeRecord || 1) > 1, run: (c) => goRecord(c, (c.state.mergeRecord || 1) - 1) },
  recordNumber: { isEnabled: preview, value: (c) => c.state.mergeRecord || 1, run: (c, n) => goRecord(c, Number(n) || 1) },
  nextRecord: { icon: 'next-record', isEnabled: (c) => preview(c) && (c.state.mergeRecord || 1) < recordCount(c), run: (c) => goRecord(c, (c.state.mergeRecord || 1) + 1) },
  lastRecord: { icon: 'last-record', isEnabled: preview, run: (c) => goRecord(c, recordCount(c)) },
  findRecipient: { icon: 'find-recipient', isEnabled: preview, run: findRecipient },
  finishMerge: { icon: 'finish-merge', isEnabled: preview, menuOnly: true },
  editIndividual: { isEnabled: preview, run: editIndividual },
  // Printing arrives with File ▸ Print (M13).
  printDocuments: { icon: 'print', isEnabled: (c) => recordCount(c) > 0, run: (c) => printDocuments(c) },
});

export const ribbon = {
  id: 'mailings',
  keytip: 'M',
  groups: [
    { id: 'create', icon: 'envelope', controls: [{ t: 'large', cmd: 'envelopes' }, { t: 'large', cmd: 'labels' }] },
    {
      id: 'startMailMerge', icon: 'start-merge',
      controls: [
        { t: 'large', cmd: 'startMailMerge', label: 'label.mailings.startMailMerge', menu: ['mergeLetters', 'mergeEmail', 'mergeEnvelopes', 'mergeLabels', 'mergeDirectory', '-', 'mergeNormal'] },
        { t: 'large', cmd: 'selectRecipients', label: 'label.mailings.selectRecipients', menu: ['typeNewList', 'useExistingList'] },
        { t: 'large', cmd: 'editRecipientList', label: 'label.mailings.editRecipientList' },
      ],
    },
    {
      id: 'writeInsert', icon: 'merge-field',
      controls: [
        { t: 'large', cmd: 'highlightMergeFields', label: 'label.mailings.highlightMergeFields' },
        { t: 'large', cmd: 'addressBlock', label: 'label.mailings.addressBlock' },
        { t: 'large', cmd: 'greetingLine', label: 'label.mailings.greetingLine' },
        { t: 'large', cmd: 'insertMergeField', label: 'label.mailings.insertMergeField', menu: [{ custom: 'mergeFieldList' }] },
        { t: 'col', items: [{ cmd: 'rules', menu: ['ruleIfThenElse', 'ruleFillIn', 'ruleSkipRecord', 'ruleNextRecord', 'ruleMergeRecord'] }] },
      ],
    },
    {
      id: 'previewResults', icon: 'preview-results',
      controls: [
        { t: 'large', cmd: 'previewResults', label: 'label.mailings.previewResults' },
        { t: 'col', items: [
          { t: 'row', items: [{ cmd: 'firstRecord' }, { cmd: 'previousRecord' }, { t: 'number', cmd: 'recordNumber', width: 40, value: 1 }, { cmd: 'nextRecord' }, { cmd: 'lastRecord' }] },
          { cmd: 'findRecipient' },
        ] },
      ],
    },
    { id: 'finish', icon: 'finish-merge', controls: [{ t: 'large', cmd: 'finishMerge', label: 'label.mailings.finishMerge', menu: ['editIndividual', 'printDocuments'] }] },
  ],
};

export function register(registry) { registry.register(commands); }
