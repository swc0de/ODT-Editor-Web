/**
 * M15 §5: every editor feature survives DOCX. Each command (all registry
 * commands that change the document, run on a sample document, accepting
 * their dialogs) and each interactive feature (shapes, equations, ink,
 * watermark, page colour and borders, line numbers, hyphenation, themes,
 * tracked changes incl. formatting, comment threads, Restrict Editing,
 * properties, links, SmartArt) goes through Save as DOCX → reopen; the
 * document and state summaries must be equal, or the loss is listed in
 * KNOWN_LOSSES (and in PROGRESS.md and lossesFor()).
 */
import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

/** Losses that can't be avoided, by command or scenario id (none at present). */
const KNOWN_LOSSES = {};

const SUMMARY = () => {
  const O = window.odtEditor;
  const st = O.session.currentState();
  const s = {};
  const add = (k) => { s[k] = (s[k] || 0) + 1; };
  st.doc.descendants((n) => {
    add(`node:${n.type.name}`);
    if (n.type.name === 'frame') add(`frame:${n.attrs.kind}`);
    if (n.type.name === 'field') add(`field:${n.attrs.element}`);
    if (n.type.name === 'annotation') { if (n.attrs.extra?.['loext:parent-name']) add('comment:reply'); if (n.attrs.extra?.['loext:resolved'] === 'true') add('comment:resolved'); }
    for (const m of n.marks || []) add(`mark:${m.type.name}`);
  });
  const m = (st.masterStyles?.c || []).find((x) => x.n === 'style:master-page');
  const l = (st.stylesAutoStyles?.c || []).find((x) => x.n === 'style:page-layout' && x.a['style:name'] === m?.a['style:page-layout-name']);
  const lp = (l?.c || []).find((x) => x.n === 'style:page-layout-properties')?.a || {};
  for (const k of ['fo:background-color', 'fo:border', 'fo:border-top', 'style:print-orientation']) if (lp[k]) s[`page:${k}`] = lp[k].replace(/^(\S+) /, '');
  const ln = (st.commonStyles?.c || []).find((x) => x.n === 'text:linenumbering-configuration');
  if (ln?.a['text:number-lines'] === 'true') s.lineNumbers = ln.a['text:increment'];
  const def = (st.commonStyles?.c || []).find((x) => x.n === 'style:default-style' && x.a['style:family'] === 'paragraph');
  if ((def?.c || []).find((x) => x.n === 'style:text-properties')?.a['fo:hyphenate'] === 'true') s.hyphenate = true;
  const wm = JSON.stringify(st.masterStyles).includes('PowerPlusWaterMarkObject');
  if (wm) s.watermark = true;
  if (st.trackChanges) s.trackChanges = true;
  const r = /ODTEditorRestrictEditing[^>]*>([^<]*)</.exec(st.settingsXml || '');
  if (r) s.restrict = r[1];
  const title = (st.meta?.c || []).find((x) => x.n === 'dc:title');
  if (title) s.title = (title.c || []).join('');
  const h1 = (st.commonStyles?.c || []).find((x) => x.a?.['style:name'] === 'Heading_20_1');
  const col = JSON.stringify(h1 || '').match(/"fo:color":"(#[0-9a-f]+)"/i);
  if (col) s.h1Colour = col[1].toLowerCase();
  return s;
};

const SCENARIOS = {
  shape: async (page) => { await run(page, 'insert.insertShape', 'rectangle'); await drag(page); },
  ellipse: async (page) => { await run(page, 'insert.insertShape', 'ellipse'); await drag(page); },
  textBoxDraw: async (page) => { await run(page, 'insert.drawTextBox'); await drag(page); },
  equation: async (page) => run(page, 'insert.insertEquationPreset', 'quadratic'),
  ink: async (page) => { await run(page, 'draw.pen'); await drag(page, 30); await run(page, 'draw.select'); },
  watermark: async (page) => run(page, 'design.watermark', 'confidential'),
  pageColour: async (page) => run(page, 'design.pageColour', '#fff2cc'),
  pageBorders: async (page) => page.evaluate(() => {
    const st = window.odtEditor.session.state;
    const m = st.masterStyles.c.find((x) => x.n === 'style:master-page');
    const l = st.stylesAutoStyles.c.find((x) => x.n === 'style:page-layout' && x.a['style:name'] === m.a['style:page-layout-name']);
    const p = l.c.find((x) => x.n === 'style:page-layout-properties');
    Object.assign(p.a, { 'fo:border': '1.5pt solid #1f3864', 'fo:padding': '0.5cm' });
  }),
  lineNumbers: async (page) => run(page, 'layout.lineNumbersContinuous'),
  hyphenation: async (page) => run(page, 'layout.hyphenationAuto'),
  theme: async (page) => run(page, 'design.themes', 'harbour'),
  trackChanges: async (page) => { await run(page, 'review.trackChanges'); await page.keyboard.type(' inserted'); await page.keyboard.press('Shift+Home'); await page.keyboard.press('Control+b'); },
  trackDelete: async (page) => { await run(page, 'review.trackChanges'); await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace'); },
  commentThread: async (page) => {
    await run(page, 'insert.comment');
    await page.keyboard.type('First comment');
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      const O = window.odtEditor;
      const v = O.editor.view;
      let first = null;
      v.state.doc.descendants((n, p) => { if (n.type.name === 'annotation' && !first) first = { n, p }; });
      const reply = v.state.schema.nodes.annotation.create({ name: '__Annotation__reply1', creator: 'B', date: '2026-01-01T10:00:00', body: [{ type: 'paragraph', content: [{ type: 'text', text: 'A reply' }] }], extra: { 'loext:parent-name': first.n.attrs.name } });
      const tr = v.state.tr.setNodeMarkup(first.p, null, { ...first.n.attrs, extra: { 'loext:resolved': 'true' } });
      tr.insert(first.p + 1, reply);
      v.dispatch(tr);
    });
  },
  restrict: async (page) => page.evaluate(() => { const s = window.odtEditor.session.state; s.settingsXml = (s.settingsXml || '<office:document-settings xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"><office:settings><config:config-item-set config:name="ooo:configuration-settings"></config:config-item-set></office:settings></office:document-settings>').replace('</config:config-item-set>', '<config:config-item config:name="ODTEditorRestrictEditing" config:type="string">comments</config:config-item></config:config-item-set>'); }),
  title: async (page) => page.evaluate(() => { const s = window.odtEditor.session.state; s.meta = { ...s.meta, c: [...(s.meta.c || []).filter((x) => x.n !== 'dc:title'), { n: 'dc:title', a: {}, c: ['Round trip title'] }] }; }),
  link: async (page) => page.evaluate(() => { const v = window.odtEditor.editor.view; const l = v.state.schema.marks.link.create({ href: 'https://example.org/' }); v.dispatch(v.state.tr.addMark(v.state.selection.from, v.state.selection.to, l)); }),
  smartArt: async (page) => run(page, 'insert.smartArt'),
  chart: async (page) => run(page, 'insert.chart'),
  landscape: async (page) => run(page, 'layout.orientationLandscape'),
};

async function run(page, id, arg) { await page.evaluate(([id, arg]) => { window.odtEditor.registry.run(id, arg); }, [id, arg]); await page.waitForTimeout(250); for (let k = 0; k < 2; k++) { const d = page.locator('.dlg-overlay').last(); if (!(await d.count())) break; await d.locator('.dlg-btn.primary, .dlg-btn').first().click(); await page.waitForTimeout(200); } }
async function drag(page, step = 0) {
  const box = await page.locator('.page-bgs .pg').first().boundingBox();
  const x = box.x + 200;
  const y = box.y + 300;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x + i * 20, y + i * (step ? (i % 2 ? step : -step) / 3 + 5 : 10));
  await page.mouse.up();
  await page.waitForTimeout(200);
}


async function sample(page) {
  await page.evaluate(async () => {
    const O = window.odtEditor;
    await O.session.newDocument({ skipGuard: true });
    const v = O.editor.view;
    v.dispatch(v.state.tr.insertText('Heading text here', 1));
    v.dispatch(v.state.tr.split(v.state.doc.content.size - 1).insertText('Second paragraph with some words to select.'));
    const pos = v.state.doc.content.size - 10;
    v.dispatch(v.state.tr.setSelection(O.pm.TextSelection.create(v.state.doc, pos - 5, pos)));
    v.focus();
  });
}

async function roundTrip(page) {
  const s0 = await page.evaluate(SUMMARY);
  const bytes = await page.evaluate(async () => Array.from(await window.odtEditor.session.serializeAs('docx')));
  await page.evaluate(async (b) => { await window.odtEditor.session.openBytes(new Uint8Array(b), { name: 'x.docx', skipGuard: true }); }, bytes);
  const s1 = await page.evaluate(SUMMARY);
  const diff = {};
  for (const k of new Set([...Object.keys(s0), ...Object.keys(s1)])) if (JSON.stringify(s0[k]) !== JSON.stringify(s1[k])) diff[k] = `${s0[k] ?? '-'} → ${s1[k] ?? '-'}`;
  return diff;
}

test.describe('every feature survives DOCX', () => {
  let problems;
  test.beforeEach(async ({ page }) => { problems = await openApp(page); });
  test.afterEach(() => { expect([...problems.pageErrors, ...problems.consoleErrors]).toEqual([]); });

  for (const [name, fn] of Object.entries(SCENARIOS)) {
    test(`${name}`, async ({ page }) => {
      await sample(page);
      await fn(page);
      await page.keyboard.press('Escape');
      const diff = await roundTrip(page);
      if (KNOWN_LOSSES[name]) return;
      expect(diff).toEqual({});
    });
  }

  test('every registry command that changes the document', async ({ page }) => {
    test.setTimeout(600_000);
    const ids = await page.evaluate(() => window.odtEditor.registry.list().map((c) => c.id).filter((id) => !/^(file|view|app|help|immersive|immersiveReader)\./.test(id)));
    const failures = {};
    let changed = 0;
    for (const id of ids) {
      await sample(page);
      const before = await page.evaluate(() => JSON.stringify(window.odtEditor.editor.getDoc().toJSON()));
      const ran = await page.evaluate(async (id) => {
        const O = window.odtEditor;
        if (!O.registry.isEnabled(id)) return false;
        try { O.registry.run(id); } catch { return false; }
        await new Promise((r) => setTimeout(r, 120));
        for (let k = 0; k < 2; k++) {
          const dlg = [...document.querySelectorAll('.dlg-overlay')].at(-1);
          if (!dlg) break;
          (dlg.querySelector('.dlg-btn.primary') || dlg.querySelector('.dlg-btn'))?.click();
          await new Promise((r) => setTimeout(r, 120));
        }
        return true;
      }, id);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      if (!ran) continue;
      if (await page.evaluate(() => JSON.stringify(window.odtEditor.editor.getDoc().toJSON())) === before) continue;
      changed++;
      const diff = await roundTrip(page);
      if (Object.keys(diff).length && !KNOWN_LOSSES[id]) failures[id] = diff;
    }
    expect(changed).toBeGreaterThan(100);
    expect(failures).toEqual({});
  });
});
