import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CommandRegistry, normalizeShortcut, formatShortcut, eventToShortcut } from '../../src/core/command-registry.js';

const key = (k, code, mods = {}) => ({ key: k, code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, preventDefault() { this.prevented = true; }, ...mods });

test('normalizeShortcut canonicalises modifiers and keys', () => {
  assert.equal(normalizeShortcut('ctrl+shift+B', { mac: false }), 'Ctrl-Shift-b');
  assert.equal(normalizeShortcut('Shift-Mod-=', { mac: false }), 'Mod-Shift-=');
  assert.equal(normalizeShortcut('Mod-Shift-=', { mac: false, resolveMod: true }), 'Ctrl-Shift-=');
  assert.equal(normalizeShortcut('Mod-b', { mac: true, resolveMod: true }), 'Meta-b');
  assert.equal(normalizeShortcut('f12'), 'F12');
  assert.equal(normalizeShortcut('Ctrl+-', { mac: false }), 'Ctrl--');
  assert.equal(normalizeShortcut('alt-esc'), 'Alt-Escape');
  assert.throws(() => normalizeShortcut('Hyper-x'));
});

test('formatShortcut renders platform labels', () => {
  assert.equal(formatShortcut('Mod-Shift-=', { mac: false }), 'Ctrl+Shift+=');
  assert.equal(formatShortcut('Mod-b', { mac: true }), '⌘B');
  assert.equal(formatShortcut('Ctrl--', { mac: false }), 'Ctrl+-');
  assert.equal(formatShortcut('F12', { mac: false }), 'F12');
});

test('eventToShortcut uses physical keys for shifted characters', () => {
  assert.equal(eventToShortcut(key('+', 'Equal', { ctrlKey: true, shiftKey: true })), 'Ctrl-Shift-=');
  assert.equal(eventToShortcut(key('B', 'KeyB', { ctrlKey: true, shiftKey: true })), 'Ctrl-Shift-b');
  assert.equal(eventToShortcut(key('*', 'Digit8', { ctrlKey: true, shiftKey: true })), 'Ctrl-Shift-8');
  assert.equal(eventToShortcut(key('Shift', 'ShiftLeft', { shiftKey: true })), '');
  assert.equal(eventToShortcut(key('F7', 'F7')), 'F7');
});

test('register, run, enabled and checked state', async () => {
  let ran = 0;
  let on = false;
  const reg = new CommandRegistry({ mac: false, translate: (s) => (s === 'cmd.bold' ? 'Bold' : s) });
  reg.register({ id: 'format.bold', label: 'cmd.bold', shortcut: 'Mod-b', run: () => { ran++; on = !on; }, isChecked: () => on });
  reg.register({ id: 'insert.chart', label: 'Chart' });
  reg.register({ id: 'never', label: 'Never', run: () => {}, isEnabled: () => false });

  assert.equal(reg.label('format.bold'), 'Bold');
  assert.equal(reg.shortcutText('format.bold'), 'Ctrl+B');
  assert.equal(reg.isEnabled('format.bold'), true);
  assert.equal(reg.run('format.bold'), true);
  assert.equal(ran, 1);
  assert.equal(reg.isChecked('format.bold'), true);

  // Commands without run() are "Coming soon": listed, disabled, not runnable.
  assert.equal(reg.get('insert.chart').comingSoon, true);
  assert.equal(reg.isEnabled('insert.chart'), false);
  assert.equal(reg.run('insert.chart'), false);
  assert.equal(reg.run('never'), false);
  assert.equal(reg.run('missing'), false);

  const ev = key('b', 'KeyB', { ctrlKey: true });
  assert.equal(reg.handleKeydown(ev), true);
  assert.equal(ev.prevented, true);
  assert.equal(ran, 2);

  let notified = 0;
  reg.onChange(() => notified++);
  reg.run('format.bold');
  await new Promise((r) => setTimeout(r));
  assert.equal(notified, 1);
});

test('duplicate ids and shortcuts are rejected', () => {
  const reg = new CommandRegistry({ mac: false });
  reg.register({ id: 'a', shortcut: 'Mod-k', run() {} });
  assert.throws(() => reg.register({ id: 'a', run() {} }), /Duplicate/);
  assert.throws(() => reg.register({ id: 'b', shortcut: 'Ctrl-k', run() {} }), /already used/);
});

test('search ranks prefix matches first and lists everything for an empty query', () => {
  const reg = new CommandRegistry({ mac: false });
  reg.register([
    { id: 'insert.table', label: 'Table', run() {} },
    { id: 'references.toc', label: 'Table of Contents', run() {} },
    { id: 'layout.tabs', label: 'Tabs', keywords: ['tab stops'], run() {} },
    { id: 'insert.chart', label: 'Chart' },
  ]);
  assert.deepEqual(reg.search('table').map((c) => c.id), ['insert.table', 'references.toc']);
  assert.deepEqual(reg.search('stops').map((c) => c.id), ['layout.tabs']);
  assert.equal(reg.search('').length, 4);
  assert.equal(reg.search('', { limit: 2 }).length, 2);
});
