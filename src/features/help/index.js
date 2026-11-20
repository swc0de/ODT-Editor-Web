/** Help tab: Help (keyboard shortcuts), Feedback (a local note), What's New, About (licences). */
import { defineCommands } from '../define.js';
import { shortcutsDialog, feedbackDialog, whatsNewDialog } from '../../ui/help.js';
import { TABS } from '../index.js';

export const commands = defineCommands('help', {
  help: { icon: 'help', shortcut: 'F1', keywords: ['keyboard shortcuts', 'keys'], run: (c) => shortcutsDialog(c.ui.registry, TABS) },
  feedback: { icon: 'feedback', run: (c) => feedbackDialog(c.ui.toast) },
  whatsNew: { icon: 'whats-new', run: () => whatsNewDialog() },
  about: { icon: 'about', run: (c) => c.store.set({ backstageOpen: true, backstagePage: 'about' }) },
});

export const ribbon = {
  id: 'help',
  keytip: 'Y',
  groups: [
    { id: 'help', icon: 'help', controls: [{ t: 'large', cmd: 'help' }, { t: 'large', cmd: 'feedback' }, { t: 'large', cmd: 'whatsNew', label: 'label.help.whatsNew' }, { t: 'large', cmd: 'about' }] },
  ],
};

export function register(registry) { registry.register(commands); }
