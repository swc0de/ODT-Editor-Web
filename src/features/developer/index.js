/** Developer tab: content controls, Design Mode, Properties, Restrict Editing (M11). */
import { defineCommands } from '../define.js';

export const commands = defineCommands('developer', {
  richText: { icon: 'cc-rich-text' },
  plainText: { icon: 'cc-plain-text' },
  picture: { icon: 'cc-picture' },
  checkBox: { icon: 'cc-checkbox' },
  comboBox: { icon: 'cc-combo' },
  dropDownList: { icon: 'cc-dropdown' },
  datePicker: { icon: 'cc-date' },
  designMode: { icon: 'design-mode' },
  properties: { icon: 'properties' },
});

export const ribbon = {
  id: 'developer',
  keytip: 'L',
  groups: [
    {
      id: 'controls', icon: 'cc-rich-text',
      controls: [
        { t: 'rows', rows: [
          [{ cmd: 'richText' }, { cmd: 'plainText' }, { cmd: 'picture' }, { cmd: 'datePicker' }],
          [{ cmd: 'checkBox' }, { cmd: 'comboBox' }, { cmd: 'dropDownList' }],
        ] },
        { t: 'col', items: [{ cmd: 'designMode' }, { cmd: 'properties' }] },
      ],
    },
    { id: 'protect', icon: 'restrict', controls: [{ t: 'large', cmd: 'review.restrictEditing', label: 'label.review.restrictEditing' }] },
  ],
};

export function register(registry) { registry.register(commands); }
