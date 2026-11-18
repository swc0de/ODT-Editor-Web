/**
 * Zotero tab (shown in the reference screenshots). It will talk to the local
 * Zotero app's connector at 127.0.0.1:23119 in M8 if the browser allows it
 * from file://; until then every control is "Coming soon".
 */
import { defineCommands } from '../define.js';

export const commands = defineCommands('zotero', {
  addCitation: { icon: 'citation' },
  addBibliography: { icon: 'bibliography' },
  addNote: { icon: 'zotero-note' },
  refresh: { icon: 'refresh' },
  documentPreferences: { icon: 'preferences' },
  unlinkCitations: { icon: 'unlink' },
});

export const ribbon = {
  id: 'zotero',
  keytip: 'Z',
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
      controls: [{ t: 'col', items: [{ cmd: 'refresh' }, { cmd: 'documentPreferences' }, { cmd: 'unlinkCitations' }] }],
    },
  ],
};

export function register(registry) { registry.register(commands); }
