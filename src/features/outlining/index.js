/**
 * Outlining contextual tab (shown in Outline view): outline level, promote /
 * demote, move up / down, expand / collapse, Show Level, Show Text
 * Formatting, Show First Line Only, Close Outline View.
 */
import { defineCommands } from '../define.js';
import { BODY } from '../../core/outline.js';
import {
  promote, demote, promoteToHeading1, demoteToBody, setLevel, levelAt, moveItems, expand, showLevel, shownLevel,
} from '../view/outline.js';

const on = (c) => c.state.view === 'outline' && !!c.mainEditor;
const lvl = (c) => (on(c) ? levelAt(c.mainEditor.view) : null);
const levelCmd = (n) => ({ isEnabled: on, isChecked: (c) => lvl(c) === n, run: (c) => setLevel(c, n) });
const showCmd = (n) => ({ isEnabled: on, isChecked: (c) => on(c) && shownLevel(c) === n, run: (c) => showLevel(c, n) });

export const commands = defineCommands('outlining', {
  outlineLevel: { isEnabled: on, menuOnly: true },
  ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [`level${n}`, levelCmd(n)])),
  levelBody: levelCmd(BODY),
  promoteToHeading1: { icon: 'promote-h1', isEnabled: (c) => on(c) && lvl(c) !== 1, run: promoteToHeading1 },
  // Also used by the Navigation pane's heading menu, in any view.
  promote: { icon: 'promote', shortcut: 'Alt-Shift-ArrowLeft', isEnabled: (c) => !!c.mainEditor && levelAt(c.mainEditor.view) !== 1, run: promote },
  demote: { icon: 'demote', shortcut: 'Alt-Shift-ArrowRight', isEnabled: (c) => !!c.mainEditor && ![BODY, 9].includes(levelAt(c.mainEditor.view)), run: demote },
  demoteToBody: { icon: 'demote-body', isEnabled: (c) => on(c) && lvl(c) !== BODY, run: demoteToBody },
  moveUp: { icon: 'move-up', shortcut: 'Alt-Shift-ArrowUp', isEnabled: on, run: (c) => moveItems(c, -1) },
  moveDown: { icon: 'move-down', shortcut: 'Alt-Shift-ArrowDown', isEnabled: on, run: (c) => moveItems(c, 1) },
  expand: { icon: 'expand-outline', shortcut: 'Alt-Shift-=', isEnabled: on, run: (c) => expand(c, true) },
  collapse: { icon: 'collapse-outline', shortcut: 'Alt-Shift--', isEnabled: on, run: (c) => expand(c, false) },
  showLevel: { isEnabled: on, menuOnly: true },
  showAll: showCmd(BODY),
  ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [`show${n}`, showCmd(n)])),
  showFormatting: { isEnabled: on, isChecked: (c) => c.state.outlineFormatting !== false, run: (c) => c.store.set((s) => ({ outlineFormatting: s.outlineFormatting === false })) },
  firstLineOnly: { isEnabled: on, isChecked: (c) => !!c.state.outlineFirstLine, run: (c) => c.store.set((s) => ({ outlineFirstLine: !s.outlineFirstLine })) },
  close: { icon: 'close-view', isEnabled: on, run: (c) => c.store.set({ view: 'print', activeTab: 'view' }) },
});

const LEVELS = [...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `level${n}`), 'levelBody'];
const SHOWS = ['showAll', ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `show${n}`)];

export const ribbon = {
  id: 'outlining',
  keytip: 'U',
  contextual: 'outline',
  groups: [
    {
      id: 'tools', icon: 'multilevel',
      controls: [
        {
          t: 'rows',
          rows: [
            [{ cmd: 'promoteToHeading1', iconOnly: true }, { cmd: 'promote', iconOnly: true }, { t: 'select', cmd: 'outlineLevel', width: 104, options: LEVELS, value: 'levelBody' }, { cmd: 'demote', iconOnly: true }, { cmd: 'demoteToBody', iconOnly: true }],
            [{ cmd: 'moveUp', iconOnly: true }, { cmd: 'moveDown', iconOnly: true }, { cmd: 'expand', iconOnly: true }, { cmd: 'collapse', iconOnly: true }, { t: 'select', cmd: 'showLevel', width: 104, options: SHOWS, value: 'showAll' }],
          ],
        },
        { t: 'col', items: [{ t: 'check', cmd: 'showFormatting' }, { t: 'check', cmd: 'firstLineOnly' }] },
      ],
    },
    { id: 'close', icon: 'close-view', controls: [{ t: 'large', cmd: 'close', label: 'label.outlining.close' }] },
  ],
};

export function register(registry) { registry.register(commands); }
