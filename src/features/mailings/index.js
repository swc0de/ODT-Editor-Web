/** Mailings tab: Create, Start Mail Merge, Write & Insert Fields, Preview Results, Finish (M11). */
import { defineCommands } from '../define.js';

export const commands = defineCommands('mailings', {
  envelopes: { icon: 'envelope' },
  labels: { icon: 'labels' },
  startMailMerge: { icon: 'start-merge' },
  mergeLetters: {},
  mergeEmail: {},
  mergeEnvelopes: {},
  mergeLabels: {},
  mergeDirectory: {},
  mergeNormal: {},
  selectRecipients: { icon: 'recipients' },
  typeNewList: {},
  useExistingList: {},
  editRecipientList: { icon: 'edit-recipients' },
  highlightMergeFields: { icon: 'highlight-fields' },
  addressBlock: { icon: 'address-block' },
  greetingLine: { icon: 'greeting-line' },
  insertMergeField: { icon: 'merge-field' },
  rules: { icon: 'rules' },
  ruleIfThenElse: {},
  ruleFillIn: {},
  ruleSkipRecord: {},
  ruleNextRecord: {},
  ruleMergeRecord: {},
  previewResults: { icon: 'preview-results' },
  firstRecord: { icon: 'first-record' },
  previousRecord: { icon: 'previous-record' },
  recordNumber: {},
  nextRecord: { icon: 'next-record' },
  lastRecord: { icon: 'last-record' },
  findRecipient: { icon: 'find-recipient' },
  finishMerge: { icon: 'finish-merge' },
  editIndividual: {},
  printDocuments: {},
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
