/** Developer tab: content controls, Design Mode, Properties, Restrict Editing (M11). */
import { TextSelection } from 'prosemirror-state';
import { defineCommands } from '../define.js';
import { t } from '../../i18n/index.js';
import { schema } from '../../core/schema.js';
import { controlAttrs, controlAt, setControl, kindOf, PLACEHOLDER } from './controls.js';
import { controlPropertiesDialog } from '../../ui/control-dialogs.js';

const canEdit = (c) => !!c.mainEditor && c.state.editingMode !== 'viewing' && c.editor === c.mainEditor;

/** Inserts a control: around the selected text, or with its placeholder. */
function insertControl(c, kind) {
  const view = c.mainEditor.view;
  const { from, to, empty } = view.state.selection;
  const attrs = controlAttrs(kind);
  const tr = view.state.tr;
  if (!empty && kind !== 'checkbox' && kind !== 'picture') {
    delete attrs['loext:showing-place-holder'];
    tr.addMark(from, to, schema.marks.contentControl.create({ attrs, items: [] }));
  } else {
    const content = kind === 'checkbox' ? '☐' : kind === 'picture' ? t('cc.picturePlaceholder') : PLACEHOLDER[kind];
    const mark = schema.marks.contentControl.create({ attrs, items: [] });
    const marks = view.state.selection.$from.marks().filter((m) => m.type.name !== 'contentControl' && m.type.name !== 'link');
    tr.replaceWith(from, to, schema.text(content, mark.addToSet(marks)));
    // A placeholder is selected (typing replaces it); otherwise the caret goes after the control.
    tr.setSelection(attrs['loext:showing-place-holder'] ? TextSelection.create(tr.doc, from, from + content.length) : TextSelection.create(tr.doc, from + content.length));
  }
  view.dispatch(tr.setMeta('ccInternal', true).scrollIntoView());
  view.focus();
}

const control = (kind) => ({ isEnabled: canEdit, run: (c) => insertControl(c, kind) });
const here = (c) => (c.mainEditor ? controlAt(c.mainEditor.view.state, c.mainEditor.view.state.selection.from) : null);

export const commands = defineCommands('developer', {
  richText: { icon: 'cc-rich-text', ...control('rich') },
  plainText: { icon: 'cc-plain-text', ...control('plain') },
  picture: { icon: 'cc-picture', ...control('picture') },
  checkBox: { icon: 'cc-checkbox', ...control('checkbox') },
  comboBox: { icon: 'cc-combo', ...control('combobox') },
  dropDownList: { icon: 'cc-dropdown', ...control('dropdown') },
  datePicker: { icon: 'cc-date', ...control('date') },
  designMode: { icon: 'design-mode', isEnabled: (c) => !!c.mainEditor, isChecked: (c) => !!c.state.ccDesign, run: (c) => { c.store.set((s) => ({ ccDesign: !s.ccDesign })); const v = c.mainEditor.view; v.dispatch(v.state.tr.setMeta('ccInternal', true).setMeta('addToHistory', false)); } },
  properties: {
    icon: 'properties', isEnabled: (c) => canEdit(c) && !!here(c),
    run: async (c) => {
      const ctl = here(c);
      if (!ctl) return;
      const r = await controlPropertiesDialog(kindOf(ctl.mark.attrs.attrs), ctl.mark.attrs.attrs, ctl.mark.attrs.items);
      if (!r) return;
      const view = c.mainEditor.view;
      const cur = controlAt(view.state, ctl.from + 1) || ctl;
      const tr = view.state.tr;
      setControl(tr, cur, r);
      view.dispatch(tr.setMeta('ccInternal', true));
      view.focus();
    },
  },
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
