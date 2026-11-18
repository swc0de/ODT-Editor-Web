/**
 * Static checks of the ribbon definitions: every control, menu item and
 * launcher refers to a registered command; every icon exists; every label,
 * tab and group name is in the en-GB catalogue; tabs are in screenshot order.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CommandRegistry } from '../../src/core/command-registry.js';
import { registerFeatures, TABS } from '../../src/features/index.js';
import { resolveId } from '../../src/features/define.js';
import { hasIcon } from '../../src/ui/icons.js';
import { hasKey, t } from '../../src/i18n/index.js';
import { assignKeyTips } from '../../src/ui/keytips.js';

const registry = new CommandRegistry({ mac: false, translate: t });
registerFeatures(registry);

function walk(visit) {
  const go = (spec, tab, path) => {
    if (spec == null) return;
    if (typeof spec === 'string') { if (spec !== '-') visit({ ref: spec, tab, path }); return; }
    if (spec.cmd) visit({ ref: spec.cmd, tab, path, spec });
    if (spec.value && spec.t === 'select') visit({ ref: spec.value, tab, path });
    for (const k of ['items', 'menu', 'sub', 'options', 'controls']) (spec[k] || []).forEach((s) => go(s, tab, `${path}/${k}`));
    (spec.rows || []).forEach((row) => row.forEach((s) => go(s, tab, `${path}/rows`)));
  };
  for (const tab of TABS) for (const g of tab.groups) {
    if (g.launcher) visit({ ref: g.launcher, tab: tab.id, path: `${tab.id}/${g.id}/launcher` });
    g.controls.forEach((c) => go(c, tab.id, `${tab.id}/${g.id}`));
  }
}

test('tabs are in the reference order', () => {
  assert.deepEqual(TABS.filter((x) => !x.contextual).map((x) => x.id), ['file', 'home', 'insert', 'draw', 'design', 'layout', 'references', 'mailings', 'review', 'view', 'developer', 'zotero', 'help']);
  // Contextual tabs (shown while their object is being edited) come after Help.
  assert.deepEqual(TABS.filter((x) => x.contextual).map((x) => x.id), ['headerFooter', 'tableDesign', 'tableLayout']);
  for (const tab of TABS) assert.ok(hasKey(`tab.${tab.id}`), `tab.${tab.id} missing`);
});

test('every ribbon reference resolves to a registered command', () => {
  const missing = [];
  walk(({ ref, tab, path }) => { if (!registry.has(resolveId(tab, ref))) missing.push(`${path}: ${ref}`); });
  assert.deepEqual(missing, []);
});

test('every command has an en-GB label and every icon exists', () => {
  const noLabel = registry.all().filter((c) => !hasKey(c.label)).map((c) => c.id);
  assert.deepEqual(noLabel, []);
  const noIcon = registry.all().filter((c) => c.icon && !hasIcon(c.icon)).map((c) => `${c.id}: ${c.icon}`);
  assert.deepEqual(noIcon, []);
  const groupIcons = TABS.flatMap((tab) => tab.groups.filter((g) => !hasIcon(g.icon)).map((g) => `${tab.id}/${g.id}: ${g.icon}`));
  assert.deepEqual(groupIcons, []);
});

test('every group name and label override is in the catalogue', () => {
  const missing = [];
  for (const tab of TABS) for (const g of tab.groups) {
    if (!hasKey(`group.${tab.id}.${g.id}`)) missing.push(`group.${tab.id}.${g.id}`);
  }
  walk(({ spec }) => {
    if (spec?.label && !hasKey(spec.label)) missing.push(spec.label);
    if (spec?.header && !hasKey(spec.header)) missing.push(spec.header);
  });
  assert.deepEqual(missing, []);
});

test('every built command appears somewhere in the UI or search', () => {
  // Commands are reachable through Alt+Q unless hidden; hidden ones must be in the ribbon/backstage.
  const inRibbon = new Set();
  walk(({ ref, tab }) => inRibbon.add(resolveId(tab, ref)));
  const unreachable = registry.all().filter((c) => c.hidden && !inRibbon.has(c.id) && !c.id.startsWith('file.') && !c.id.startsWith('app.')).map((c) => c.id);
  assert.deepEqual(unreachable, []);
});

test('KeyTips are unique and prefix-free', () => {
  const labels = ['Paste', 'Cut', 'Copy', 'Format Painter', 'Bold', 'Bullets', 'Borders', 'Find', 'Replace', 'Select', 'Éditor', '123'];
  const codes = assignKeyTips(labels);
  assert.equal(new Set(codes).size, codes.length);
  for (const a of codes) for (const b of codes) if (a !== b) assert.ok(!b.startsWith(a), `${a} is a prefix of ${b}`);
  assert.equal(codes[labels.indexOf('Replace')], 'R');
  assert.equal(codes[labels.indexOf('Éditor')], 'E');
  const reserved = assignKeyTips(['Quit'], new Set(['Q']));
  assert.equal(reserved[0], 'U');
});
