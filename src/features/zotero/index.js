/**
 * Zotero tab (shown in the reference screenshots).
 *
 * The live Zotero connector / local API (http://127.0.0.1:23119) can't be
 * used: this app runs from a file:// page whose Content-Security-Policy only
 * allows data: and blob: connections (it never touches the network), and
 * even without that, browsers treat a file:// page as an opaque origin that
 * Zotero's server doesn't answer with CORS / Private Network Access headers.
 * So the tab works from Zotero's own exports instead: Import Library reads a
 * BibTeX, RIS or CSL-JSON export (File ▸ Export Library… in Zotero) into the
 * document's sources, and the citation buttons use the same citeproc-js
 * engine as References ▸ Citations & Bibliography.
 */
import { defineCommands } from '../define.js';
import { t } from '../../i18n/index.js';
import { insertCitation, insertBibliography, refreshCitations, allSources, bibState, setCitationStyle, saveSources, citationsOf } from '../references/citations.js';
import { pickSourceFile, pickSourceDialog, stylePrefsDialog } from '../../ui/source-dialogs.js';
import { findIndexes } from '../../core/indexes.js';
import { CITATION_STYLES } from '../../core/bibliography.js';
import { schema } from '../../core/schema.js';

const canEdit = (c) => !!c.editor && c.state.editingMode !== 'viewing';
const bodyOnly = (c) => canEdit(c) && !c.state.hfEditing && c.editor === c.mainEditor;
const hasCitations = (c) => !!c.mainEditor && citationsOf(c.mainEditor.view.state.doc).length > 0;

export const commands = defineCommands('zotero', {
  importLibrary: {
    icon: 'manage-sources', isEnabled: (c) => canEdit(c) && !!c.mainEditor,
    run: async (c) => {
      const items = await pickSourceFile();
      if (!items) return;
      const have = new Set(bibState(c.session.state).sources.map((s) => s.id));
      const fresh = items.filter((s) => !s.id || !have.has(s.id));
      await saveSources(c, fresh);
      c.ui.toast?.(t('zot.imported', { n: fresh.length }));
    },
  },
  addCitation: {
    icon: 'citation', isEnabled: bodyOnly,
    run: async (c) => {
      const id = await pickSourceDialog(allSources(c).filter((s) => !s.placeholder));
      if (id) await insertCitation(c, id);
    },
  },
  addBibliography: {
    icon: 'bibliography', isEnabled: bodyOnly,
    // Inserts one, or refreshes the existing bibliography.
    run: (c) => (findIndexes(c.mainEditor.view.state.doc, 'text:bibliography').length ? refreshCitations(c, { history: true }) : insertBibliography(c, 'bibliography')),
  },
  addNote: { icon: 'zotero-note' },
  refresh: { icon: 'refresh', isEnabled: (c) => canEdit(c) && !!c.mainEditor, run: (c) => refreshCitations(c, { history: true }) },
  documentPreferences: {
    icon: 'preferences', isEnabled: (c) => canEdit(c) && !!c.mainEditor,
    run: async (c) => {
      const style = await stylePrefsDialog(CITATION_STYLES.map((s) => [s, t(`zot.style.${s}`)]), bibState(c.session.state).style);
      if (style) await setCitationStyle(c, style);
    },
  },
  unlinkCitations: {
    icon: 'unlink', isEnabled: (c) => canEdit(c) && hasCitations(c),
    // Citations become plain text (they no longer update).
    run: (c) => {
      const view = c.mainEditor.view;
      const tr = view.state.tr;
      for (const { node, pos } of citationsOf(view.state.doc).reverse()) tr.replaceWith(pos, pos + node.nodeSize, node.attrs.text ? schema.text(node.attrs.text) : []);
      view.dispatch(tr);
    },
  },
});

export const ribbon = {
  id: 'zotero',
  keytip: 'X',
  groups: [
    {
      id: 'citations', icon: 'citation',
      controls: [
        { t: 'large', cmd: 'addCitation', label: 'label.zotero.addCitation' },
        { t: 'large', cmd: 'addBibliography', label: 'label.zotero.addBibliography' },
        { t: 'large', cmd: 'addNote', label: 'label.zotero.addNote' },
      ],
    },
    {
      id: 'document', icon: 'preferences',
      controls: [{ t: 'col', items: [{ cmd: 'refresh' }, { cmd: 'documentPreferences' }, { cmd: 'unlinkCitations' }] }, { t: 'large', cmd: 'importLibrary', label: 'label.zotero.importLibrary' }],
    },
  ],
};

export function register(registry) { registry.register(commands); }
