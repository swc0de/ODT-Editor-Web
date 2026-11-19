/** References tab: TOC, Footnotes, Citations & Bibliography, Captions, Index (M8). */
import { defineCommands } from '../define.js';
import { insertToc, removeToc, updateAllTocs, outlineLevelAt, setOutlineLevel } from './toc.js';
import { findIndexes, tocOptions, TOC_DEFAULTS } from '../../core/indexes.js';
import { tocDialog, updateTableDialog, footnoteDialog } from '../../ui/reference-dialogs.js';
import { insertNote, gotoNote, showNotes, applyNoteOptions, noteOptions, hasNotes, focusedNote } from './notes.js';

const canEdit = (c) => !!c.editor && c.state.editingMode !== 'viewing';
const bodyOnly = (c) => canEdit(c) && !c.state.hfEditing && c.editor === c.mainEditor;
const hasToc = (c) => !!c.mainEditor && findIndexes(c.mainEditor.view.state.doc, 'text:table-of-content').length > 0;
const level = (n) => ({ isEnabled: bodyOnly, isChecked: (c) => outlineLevelAt(c) === n, run: (c) => setOutlineLevel(c, n) });

export const commands = defineCommands('references', {
  toc: { icon: 'toc', isEnabled: bodyOnly, menuOnly: true },
  insertToc: { label: 'cmd.references.toc', isEnabled: bodyOnly, run: (c, id) => insertToc(c, { title: id === 'auto2' ? 'Table of Contents' : 'Contents' }) },
  tocCustom: {
    isEnabled: bodyOnly,
    run: async (c) => {
      const cur = findIndexes(c.mainEditor.view.state.doc, 'text:table-of-content')[0];
      const r = await tocDialog(cur ? tocOptions(cur.node.attrs.source) : TOC_DEFAULTS);
      if (r) insertToc(c, r);
    },
  },
  removeToc: { isEnabled: (c) => bodyOnly(c) && hasToc(c), run: removeToc },
  addText: { icon: 'add-text', isEnabled: bodyOnly, menuOnly: true },
  addTextNone: level(0),
  addTextLevel1: level(1),
  addTextLevel2: level(2),
  addTextLevel3: level(3),
  updateToc: {
    icon: 'update-table', isEnabled: (c) => bodyOnly(c) && hasToc(c),
    run: async (c) => { const mode = await updateTableDialog('toc'); if (mode) updateAllTocs(c, { pagesOnly: mode === 'pages' }); },
  },
  insertFootnote: { icon: 'footnote', shortcut: 'Mod-Alt-f', isEnabled: bodyOnly, run: (c) => insertNote(c, 'footnote') },
  insertEndnote: { icon: 'endnote', shortcut: 'Mod-Alt-d', isEnabled: bodyOnly, run: (c) => insertNote(c, 'endnote') },
  nextFootnote: { icon: 'next-footnote', isEnabled: (c) => hasNotes(c, 'footnote'), run: (c) => gotoNote(c, 'footnote', 1) },
  previousFootnote: { isEnabled: (c) => hasNotes(c, 'footnote'), run: (c) => gotoNote(c, 'footnote', -1) },
  nextEndnote: { isEnabled: (c) => hasNotes(c, 'endnote'), run: (c) => gotoNote(c, 'endnote', 1) },
  previousEndnote: { isEnabled: (c) => hasNotes(c, 'endnote'), run: (c) => gotoNote(c, 'endnote', -1) },
  showNotes: { icon: 'show-notes', isEnabled: (c) => hasNotes(c) || !!focusedNote(c), run: showNotes },
  footnoteOptions: {
    icon: 'footnote', isEnabled: (c) => canEdit(c) && !!c.mainEditor,
    run: async (c) => {
      const r = await footnoteDialog((cls) => noteOptions(c, cls));
      if (!r) return;
      applyNoteOptions(c, r);
      if (r.action === 'insert' && bodyOnly(c)) insertNote(c, r.cls, r.mark);
    },
  },
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
