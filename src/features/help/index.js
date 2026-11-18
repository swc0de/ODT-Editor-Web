/** Help tab: Help (shortcuts), Feedback, What's New, About (M13). */
import { defineCommands } from '../define.js';

export const commands = defineCommands('help', {
  help: { icon: 'help', shortcut: 'F1' },
  feedback: { icon: 'feedback' },
  whatsNew: { icon: 'whats-new' },
  about: { icon: 'about' },
});

export const ribbon = {
  id: 'help',
  keytip: 'Y',
  groups: [
    { id: 'help', icon: 'help', controls: [{ t: 'large', cmd: 'help' }, { t: 'large', cmd: 'feedback' }, { t: 'large', cmd: 'whatsNew', label: 'label.help.whatsNew' }, { t: 'large', cmd: 'about' }] },
  ],
};

export function register(registry) { registry.register(commands); }
