/** References tab: TOC, Footnotes, Citations & Bibliography, Captions, Index (M8). */
import { defineCommands } from '../define.js';

export const commands = defineCommands('references', {
  toc: { icon: 'toc' },
  tocCustom: {},
  removeToc: {},
  addText: { icon: 'add-text' },
  addTextNone: {},
  addTextLevel1: {},
  addTextLevel2: {},
  addTextLevel3: {},
  updateToc: { icon: 'update-table' },
  insertFootnote: { icon: 'footnote', shortcut: 'Mod-Alt-f' },
  insertEndnote: { icon: 'endnote', shortcut: 'Mod-Alt-d' },
  nextFootnote: { icon: 'next-footnote' },
  previousFootnote: {},
  nextEndnote: {},
  previousEndnote: {},
  showNotes: { icon: 'show-notes' },
  footnoteOptions: { icon: 'footnote' },
  insertCitation: { icon: 'citation' },
  addNewSource: {},
  addNewPlaceholder: {},
  manageSources: { icon: 'manage-sources' },
  citationStyle: { icon: 'citation-style' },
  styleApa: {},
  styleMla: {},
  styleChicago: {},
  styleIeee: {},
  styleHarvard: {},
  bibliography: { icon: 'bibliography' },
  insertBibliography: {},
  insertCaption: { icon: 'caption' },
  insertTableOfFigures: { icon: 'table-of-figures' },
  updateFigures: { icon: 'update-table' },
  crossReference: { icon: 'cross-reference' },
  markEntry: { icon: 'mark-entry', shortcut: 'Alt-Shift-x' },
  insertIndex: { icon: 'insert-index' },
  updateIndex: { icon: 'update-table' },
});

export const ribbon = {
  id: 'references',
  keytip: 'S',
  groups: [
    {
      id: 'toc', icon: 'toc',
      controls: [
        { t: 'large', cmd: 'toc', label: 'label.references.toc', menu: [{ custom: 'tocGallery' }, '-', 'tocCustom', 'removeToc'] },
        { t: 'col', items: [{ cmd: 'addText', menu: ['addTextNone', 'addTextLevel1', 'addTextLevel2', 'addTextLevel3'] }, { cmd: 'updateToc' }] },
      ],
    },
    {
      id: 'footnotes', icon: 'footnote', launcher: 'footnoteOptions',
      controls: [
        { t: 'large', cmd: 'insertFootnote', label: 'label.references.insertFootnote' },
        { t: 'col', items: [{ cmd: 'insertEndnote' }, { cmd: 'nextFootnote', split: true, menu: ['nextFootnote', 'previousFootnote', 'nextEndnote', 'previousEndnote'] }, { cmd: 'showNotes' }] },
      ],
    },
    {
      id: 'citations', icon: 'citation',
      controls: [
        { t: 'large', cmd: 'insertCitation', label: 'label.references.insertCitation', menu: ['addNewSource', 'addNewPlaceholder'] },
        { t: 'col', items: [
          { cmd: 'manageSources' },
          { t: 'select', cmd: 'citationStyle', width: 74, options: ['styleApa', 'styleMla', 'styleChicago', 'styleIeee', 'styleHarvard'], value: 'styleApa' },
          { cmd: 'bibliography', menu: [{ custom: 'bibliographyGallery' }, '-', 'insertBibliography'] },
        ] },
      ],
    },
    {
      id: 'captions', icon: 'caption',
      controls: [
        { t: 'large', cmd: 'insertCaption', label: 'label.references.insertCaption' },
        { t: 'col', items: [{ cmd: 'insertTableOfFigures' }, { cmd: 'updateFigures' }, { cmd: 'crossReference' }] },
      ],
    },
    {
      id: 'index', icon: 'mark-entry',
      controls: [
        { t: 'large', cmd: 'markEntry', label: 'label.references.markEntry' },
        { t: 'col', items: [{ cmd: 'insertIndex' }, { cmd: 'updateIndex' }] },
      ],
    },
  ],
};

export function register(registry) { registry.register(commands); }
