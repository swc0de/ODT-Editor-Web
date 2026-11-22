/**
 * M14: Word DOCX fidelity (reference/docx/DOCX-Fidelity-Reference.docx).
 *
 * Runs on tests/fixtures/word-fidelity/docx-editor-test.docx (the user's
 * test document, 8 pages in Word) when it is present, and always on
 * synthetic-fidelity.docx (made by tests/make-word-fidelity-fixture.mjs with
 * the same structures: three sections, first-page / default / inherited
 * headers and footers, positional tab, two-column landscape section with a
 * separator, anchored picture, cell margins, vertical cell, mixed borders,
 * green ✓ list, dark header row, page fields and an empty TOC field).
 *
 *   model   every paragraph's formatting = Word's, resolved from the file's own XML
 *   layout  page count and starts, headers / footers, columns, indents, tabs,
 *           floating picture, cell padding, heading weight, label colour,
 *           automatic colour (D1–D14, L-rules)
 *   trip    fixture → import → export DOCX → import gives the same model; the
 *           export keeps every property the fixture uses; LibreOffice opens it
 *           with the same page starts
 */
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { openApp } from './helpers.js';

const DIR = path.resolve('tests/fixtures/word-fidelity');
const OUT = path.resolve('test-results/docx-fidelity');
const soffice = spawnSync('soffice', ['--version']).status === 0 ? 'soffice' : null;
const FIXTURES = [
  { name: 'docx-editor-test.docx', real: true },
  { name: 'synthetic-fidelity.docx', real: false },
];
const EXPECT_SRC = readFileSync(path.resolve('tests/lib/word-expect.js'), 'utf8');

const xmlFiles = (bytes) => {
  const z = unzipSync(new Uint8Array(bytes));
  const out = {};
  for (const [k, v] of Object.entries(z)) if (k.endsWith('.xml')) out[k] = strFromU8(v);
  return out;
};

async function openDocx(page, name, bytes) {
  await page.evaluate(async ({ b64, name }) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await window.odtEditor.session.openFile(new File([bytes], name));
  }, { b64: Buffer.from(bytes).toString('base64'), name });
  await page.evaluate(() => window.odtEditor.registry.run('view.zoom100'));
  await settle(page);
}

/** Waits until pagination (and the TOC update after opening) has settled. */
async function settle(page) {
  let last = '';
  let same = 0;
  for (let i = 0; i < 120 && same < 5; i++) {
    await page.waitForTimeout(200);
    const sig = await page.evaluate(() => (window.odtEditor.docArea.layoutPending ? 'pending' : `${window.odtEditor.docArea.pages.map((p) => p.startPos).join(',')}|${window.odtEditor.editor.view.state.doc.content.size}`));
    if (sig !== 'pending' && sig === last) same++; else { same = 0; last = sig; }
  }
}

/** Text at the start of every page and the header / footer shown on it. */
const pagesInfo = (page) => page.evaluate(() => {
  const { docArea, editor } = window.odtEditor;
  const doc = editor.view.state.doc;
  const pgs = [...document.querySelectorAll('.page-bgs .pg')];
  return docArea.pages.map((p, i) => ({
    start: doc.textBetween(p.startPos, Math.min(doc.content.size, p.startPos + 60), ' ', ' ').replace(/\s+/g, ' ').trim(),
    master: p.master,
    header: pgs[i]?.querySelector('.pg-header')?.textContent.replace(/\s+/g, ' ').trim() || '',
    footer: pgs[i]?.querySelector('.pg-footer')?.textContent.replace(/\s+/g, ' ').trim() || '',
  }));
});

/** The model's paragraphs (body and cells, in order; TOCs left out) with Word-comparable formatting. */
const modelParagraphs = (page) => page.evaluate(() => {
  const { docArea, editor } = window.odtEditor;
  const index = docArea.styleIndex;
  const px = (v) => { const m = /^(-?[\d.]+)(cm|mm|in|pt|px)$/.exec(String(v || '')); if (!m) return 0; const n = Number(m[1]); return { cm: n * 96 / 2.54, mm: n * 96 / 25.4, in: n * 96, pt: n * 4 / 3, px: n }[m[2]]; };
  const pt = (v) => px(v) * 0.75;
  const merge = (a, b) => {
    const out = { para: { ...(a?.props?.['style:paragraph-properties']?.a || {}) }, text: { ...(a?.props?.['style:text-properties']?.a || {}) } };
    Object.assign(out.para, b?.props?.['style:paragraph-properties']?.a || {});
    Object.assign(out.text, b?.props?.['style:text-properties']?.a || {});
    return out;
  };
  const levelOf = (styleName, depth) => {
    const t = index.lists.get(styleName);
    const lvl = (t?.c || []).find((c) => c.a?.['text:level'] === String(depth + 1));
    const lab = lvl?.c?.find((c) => c.n === 'style:list-level-properties')?.c?.find((c) => c.n === 'style:list-level-label-alignment');
    return lab ? { left: px(lab.a['fo:margin-left']) / 96, indent: px(lab.a['fo:text-indent']) / 96 } : null;
  };
  const out = [];
  const walk = (node, list) => {
    node.forEach((n) => {
      const name = n.type.name;
      if (name === 'index') return;
      if (name === 'list') { walk(n, { style: n.attrs.styleName || list?.style, depth: list ? list.depth + 1 : 0 }); return; }
      if (name === 'list_item') { let first = true; n.forEach((c) => { if (c.isTextblock) { para(c, first ? list : null); first = false; } else if (c.type.name === 'list') walk({ forEach: (f) => f(c) }, list); else walk({ forEach: (f) => f(c) }, null); }); return; }
      if (n.isTextblock) { para(n, null); return; }
      walk(n, null);
    });
  };
  const para = (n, list) => {
    const eff = merge(index.effective('paragraph', n.attrs.styleName), n.attrs.auto);
    const p = eff.para;
    const t = eff.text;
    const lh = p['fo:line-height'];
    let line = 240;
    let lineRule = 'auto';
    if (lh && /%$/.test(lh)) line = Math.round(parseFloat(lh) * 2.4);
    else if (lh) { line = Math.round(pt(lh) * 20); lineRule = 'exact'; } else if (p['style:line-height-at-least']) { line = Math.round(pt(p['style:line-height-at-least']) * 20); lineRule = 'atLeast'; }
    // Word's indent is to the text: ODF margins reach a left / right border's outer edge.
    const bw = (side) => { const b = p[`fo:border-${side}`]; if (!b || b === 'none') return 0; const w = String(b).split(/\s+/)[0]; return (pt(w) + pt(p[`fo:padding-${side}`] || '0pt')) / 72; };
    let leftIn = px(p['fo:margin-left'] || '0cm') / 96 + bw('left');
    let firstIn = 0;
    let hangingIn = 0;
    const ti = px(p['fo:text-indent'] || '0cm') / 96;
    if (ti < 0) hangingIn = -ti; else firstIn = ti;
    if (list) {
      const own = n.attrs.auto?.props?.['style:paragraph-properties']?.a || {};
      const lv = levelOf(list.style, list.depth);
      if (lv && own['fo:margin-left'] == null) leftIn = lv.left;
      if (lv && own['fo:text-indent'] == null) { hangingIn = lv.indent < 0 ? -lv.indent : 0; firstIn = lv.indent > 0 ? lv.indent : 0; }
    }
    out.push({
      text: n.textContent, style: n.attrs.styleName, font: String(t['style:font-name'] || '').replace(/^['"]|['"]$/g, ''), sizePt: parseFloat(t['fo:font-size']),
      bold: t['fo:font-weight'] === 'bold' || Number(t['fo:font-weight']) >= 600, italic: t['fo:font-style'] === 'italic', color: t['fo:color'] ? t['fo:color'].toLowerCase() : null,
      beforePt: pt(p['fo:margin-top'] || '0cm'), afterPt: pt(p['fo:margin-bottom'] || '0cm'), line, lineRule,
      leftIn, rightIn: px(p['fo:margin-right'] || '0cm') / 96 + bw('right'), firstIn, hangingIn,
      jc: { start: 'left', left: 'left', end: 'right', right: 'right', center: 'center', justify: 'both' }[p['fo:text-align'] || 'start'],
      numId: list ? (/^WWNum(\d+)$/.exec(list.style)?.[1] || list.style) : null, ilvl: list ? list.depth : null,
    });
  };
  walk(editor.view.state.doc, null);
  return out;
});

for (const fx of FIXTURES) {
  const file = path.join(DIR, fx.name);
  test.describe(`docx fidelity: ${fx.name}`, () => {
    test.skip(!existsSync(file), `${fx.name} is not in tests/fixtures/word-fidelity (put the user's test document there)`);
    let problems;
    let bytes;
    test.beforeEach(async ({ page }) => {
      problems = await openApp(page);
      bytes = readFileSync(file);
      await openDocx(page, fx.name, bytes);
    });
    test.afterEach(() => {
      expect(problems.pageErrors).toEqual([]);
      expect(problems.consoleErrors).toEqual([]);
      expect(problems.networkRequests).toEqual([]);
    });

    test('L1/D4/D5/D11: every paragraph has the formatting Word resolves from the file (Appendix A)', async ({ page }) => {
      await page.addScriptTag({ content: EXPECT_SRC });
      const expected = await page.evaluate((files) => window.wordExpect(files), xmlFiles(bytes));
      const actual = await modelParagraphs(page);
      expect(actual.length).toBe(expected.length);
      const close = (a, b, tol) => Math.abs(a - b) <= tol;
      const problemsList = [];
      expected.forEach((e, i) => {
        const a = actual[i];
        const where = `#${i + 1} "${e.text.slice(0, 30)}"`;
        if (a.text.replace(/\s+/g, '').slice(0, 20) !== e.text.replace(/\s+/g, '').slice(0, 20)) problemsList.push(`${where}: text "${a.text.slice(0, 30)}"`);
        for (const k of ['bold', 'italic', 'jc', 'lineRule']) if (a[k] !== e[k]) problemsList.push(`${where}: ${k} ${a[k]} ≠ ${e[k]}`);
        if (e.font && a.font.toLowerCase() !== e.font.toLowerCase()) problemsList.push(`${where}: font ${a.font} ≠ ${e.font}`);
        if ((a.color || null) !== (e.color || null)) problemsList.push(`${where}: colour ${a.color} ≠ ${e.color}`);
        for (const [k, tol] of [['sizePt', 0.01], ['beforePt', 0.05], ['afterPt', 0.05], ['line', 1], ['leftIn', 0.002], ['rightIn', 0.002], ['firstIn', 0.002], ['hangingIn', 0.002]]) if (!close(a[k], e[k], tol)) problemsList.push(`${where}: ${k} ${a[k]} ≠ ${e[k]}`);
        if (String(a.numId) !== String(e.numId) || a.ilvl !== e.ilvl) problemsList.push(`${where}: list ${a.numId}:${a.ilvl} ≠ ${e.numId}:${e.ilvl}`);
      });
      expect(problemsList).toEqual([]);
    });

    test('D1/D2/L7/L8: page count, page starts, headers and footers of every section', async ({ page }) => {
      const pages = await pagesInfo(page);
      expect(pages.length).toBe(8);
      expect(pages[1].start).toMatch(/^1\. Character Formatting/);
      expect(pages[6].start).toMatch(/^9\. Landscape/);
      expect(pages[7].start).toMatch(/^10\. Back to Portrait/);
      if (fx.real) expect(pages[5].start).toMatch(/^5\. Images/);
      for (let i = 1; i < 6; i++) {
        expect(pages[i].header).toContain('DOCX Test — Portrait Header');
        expect(pages[i].header).toContain('Section 1');
        expect(pages[i].footer).toBe(`Page ${i + 1} of 8`);
      }
      // Section 3 has no parts of its own: it inherits section 2's.
      for (const i of [6, 7]) { expect(pages[i].header).toBe('LANDSCAPE SECTION HEADER'); expect(pages[i].footer).toBe(`Landscape page ${i + 1}`); }
      expect(pages[0].header).not.toContain('Portrait Header');
    });

    test('D2: the landscape page has two 432 px columns, a 48 px gap and a separator line', async ({ page }) => {
      const r = await page.evaluate(() => {
        const sec = [...document.querySelectorAll('.page-flow section')].find((s) => getComputedStyle(s).columnCount === '2');
        if (!sec) return null;
        const cs = getComputedStyle(sec);
        const w = sec.getBoundingClientRect().width;
        const gap = parseFloat(cs.columnGap);
        return { col: (w - gap) / 2, gap, rule: cs.columnRuleStyle, ruleWidth: parseFloat(cs.columnRuleWidth) };
      });
      expect(r).not.toBeNull();
      expect(Math.abs(r.col - 432)).toBeLessThanOrEqual(1);
      expect(Math.abs(r.gap - 48)).toBeLessThanOrEqual(1);
      expect(r.rule).toBe('solid');
    });

    test('D4/D7/L2/L6: indents, paragraph spacing and border spacing', async ({ page }) => {
      const r = await page.evaluate(() => {
        const ps = [...document.querySelectorAll('.page-flow .ProseMirror p')];
        const find = (t) => ps.find((p) => p.textContent.startsWith(t));
        const pageLeft = (el) => el.closest('.page-flow').getBoundingClientRect().left;
        const lines = (p) => { const r = document.createRange(); r.selectNodeContents(p); const rs = [...r.getClientRects()].filter((x) => x.width > 0); const tops = [...new Set(rs.map((x) => Math.round(x.top)))]; return tops.map((top) => Math.min(...rs.filter((x) => Math.round(x.top) === top).map((x) => x.left))); };
        const pgLeft = (el) => { const pg = [...document.querySelectorAll('.page-bgs .pg')].find((g) => { const b = g.getBoundingClientRect(); const e = el.getBoundingClientRect(); return e.top >= b.top - 1 && e.top < b.bottom; }); return pg.getBoundingClientRect().left; };
        const out = {};
        for (const [k, t] of [['left', 'Left indent 0.5 inch'], ['first', 'First-line indent'], ['hanging', 'Hanging indent'], ['right', 'Right indent 1 inch']]) {
          const p = find(t);
          const L = lines(p);
          out[k] = { first: L[0] - pgLeft(p), next: L[1] - pgLeft(p), right: p.getBoundingClientRect().right - pgLeft(p) };
        }
        // Spacing between two Normal paragraphs: line height + 6 pt.
        const a = find('Left-aligned paragraph.');
        const b = find('Center-aligned paragraph.');
        out.gap = b.getBoundingClientRect().top - a.getBoundingClientRect().top;
        out.line = a.getBoundingClientRect().height;
        const box = find('Boxed paragraph');
        const bs = getComputedStyle(box);
        out.box = { pad: [bs.paddingTop, bs.paddingRight, bs.paddingBottom, bs.paddingLeft].map(parseFloat), border: bs.borderTopStyle };
        const quote = find('This paragraph uses the custom');
        const qs = getComputedStyle(quote);
        out.quote = { pad: parseFloat(qs.paddingLeft), border: parseFloat(qs.borderLeftWidth), textLeft: quote.getBoundingClientRect().left + parseFloat(qs.borderLeftWidth) + parseFloat(qs.paddingLeft) - pgLeft(quote) };
        void pageLeft;
        return out;
      });
      // Margins 1 in (96 px); indents of 0.5 in, right indent 1 in.
      expect(Math.abs(r.left.first - 144)).toBeLessThanOrEqual(1);
      expect(Math.abs(r.left.next - 144)).toBeLessThanOrEqual(1);
      expect(Math.abs(r.first.first - 144)).toBeLessThanOrEqual(1);
      expect(Math.abs(r.first.next - 96)).toBeLessThanOrEqual(1);
      expect(Math.abs(r.hanging.first - 96)).toBeLessThanOrEqual(1);
      expect(Math.abs(r.hanging.next - 144)).toBeLessThanOrEqual(1);
      expect(Math.abs(r.right.right - (816 - 96 - 96))).toBeLessThanOrEqual(1);
      // L3: single spacing = Calibri's line height (≈13.4 pt), then 6 pt after (L2: added, not collapsed).
      expect(Math.abs(r.line - 17.9)).toBeLessThanOrEqual(1);
      expect(Math.abs(r.gap - (r.line + 8))).toBeLessThanOrEqual(1);
      // D7: text 4 pt inside the box on every side; quote text 8 pt right of its 2.25 pt bar, at the 0.5 in indent.
      for (const v of r.box.pad) expect(Math.abs(v - 16 / 3)).toBeLessThanOrEqual(0.5);
      expect(r.box.border).toBe('solid');
      expect(Math.abs(r.quote.pad - 32 / 3)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(r.quote.border - 3)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(r.quote.textLeft - 144)).toBeLessThanOrEqual(1);
    });

    test('D6/L5: tab stops from the margin on one line, right tab flush, dot leader, positional tab in the header', async ({ page }) => {
      const r = await page.evaluate(() => {
        const ps = [...document.querySelectorAll('.page-flow .ProseMirror p')];
        const pgOf = (el) => [...document.querySelectorAll('.page-bgs .pg')].find((g) => { const b = g.getBoundingClientRect(); const e = el.getBoundingClientRect(); return e.top >= b.top - 1 && e.top < b.bottom; }).getBoundingClientRect();
        const word = (p, w) => { const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT); let n; while ((n = walker.nextNode())) { const i = n.data.indexOf(w); if (i >= 0) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + w.length); return r.getBoundingClientRect(); } } return null; };
        const tabs = ps.find((p) => p.textContent.startsWith('Start'));
        const toc = ps.find((p) => p.textContent.startsWith('Chapter 1 Introduction'));
        const pg = pgOf(tabs);
        // Lines: the paragraph's height over one line's (tab boxes sit a little off the text's top).
        const lh = word(tabs, 'Start').height;
        const hdr = [...document.querySelectorAll('.page-bgs .pg')][1].querySelector('.pg-header p');
        const hpg = hdr.closest('.pg').getBoundingClientRect();
        return {
          lines: Math.round(tabs.getBoundingClientRect().height / lh), left2000: word(tabs, 'Left@2000').left - pg.left, center: (word(tabs, 'Center').left + word(tabs, 'Center').right) / 2 - pg.left, right: word(tabs, 'Right').right - pg.left,
          tocRight: word(toc, '42').right - pgOf(toc).left, leader: toc.querySelector('.odt-tab')?.dataset.leader || null,
          section1: word(hdr, 'Section 1').right - hpg.left, headerLeft: word(hdr, 'DOCX').left - hpg.left,
        };
      });
      expect(r.lines).toBe(1);
      expect(Math.abs(r.left2000 - (96 + 2000 / 15))).toBeLessThanOrEqual(1);
      expect(Math.abs(r.center - (96 + 4680 / 15))).toBeLessThanOrEqual(1);
      expect(Math.abs(r.right - 720)).toBeLessThanOrEqual(1);
      expect(Math.abs(r.tocRight - 720)).toBeLessThanOrEqual(1);
      expect(r.leader).toBe('dotted');
      expect(Math.abs(r.section1 - 720)).toBeLessThanOrEqual(1);
      expect(Math.abs(r.headerLeft - 96)).toBeLessThanOrEqual(1);
    });

    test('D3/L9: the floating picture sits 483 px from the page edge, top at its paragraph, with text beside it', async ({ page }) => {
      const r = await page.evaluate(() => {
        const ps = [...document.querySelectorAll('.page-flow .ProseMirror p')];
        const p = ps.find((x) => x.textContent.includes('Floating image anchored'));
        const img = p.querySelector('.odt-obj img, .odt-obj .obj-box');
        const pg = [...document.querySelectorAll('.page-bgs .pg')].find((g) => { const b = g.getBoundingClientRect(); const e = p.getBoundingClientRect(); return e.top >= b.top - 1 && e.top < b.bottom; }).getBoundingClientRect();
        const ib = img.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(p);
        const firstText = [...range.getClientRects()].filter((x) => x.width > 1 && x.height < 30)[0];
        return { left: ib.left - pg.left, width: ib.width, height: ib.height, top: ib.top - p.getBoundingClientRect().top, textBeside: firstText.right <= ib.left + 1 && firstText.top < ib.bottom };
      });
      expect(Math.abs(r.left - 482.9)).toBeLessThanOrEqual(1);
      expect(Math.abs(r.width - 160)).toBeLessThanOrEqual(1);
      expect(Math.abs(r.height - 80)).toBeLessThanOrEqual(1);
      expect(Math.abs(r.top)).toBeLessThanOrEqual(1);
      expect(r.textBeside).toBe(true);
    });

    test('D8/D9/D10/D12/L10/L11/L12: cell margins, vertical text, border styles and conflicts, white text on the dark header row', async ({ page }) => {
      const r = await page.evaluate(() => {
        const cells = [...document.querySelectorAll('.page-flow .ProseMirror td')];
        const cell = (t) => cells.find((c) => c.textContent.trim().startsWith(t));
        const apples = getComputedStyle(cell('Apples'));
        const product = cell('Product');
        const vert = getComputedStyle(cell('Vertical'));
        const right = getComputedStyle(cell('Bottom-aligned cell'));
        const middle = getComputedStyle(cell('Cell containing a nested table'));
        return {
          padL: parseFloat(apples.paddingLeft), padT: parseFloat(apples.paddingTop),
          productColour: getComputedStyle(product.querySelector('p')).color,
          writing: vert.writingMode, valign: vert.verticalAlign,
          top: [right.borderTopStyle, parseFloat(right.borderTopWidth), right.borderTopColor], left: [right.borderLeftStyle, right.borderLeftColor],
          bottom: [right.borderBottomStyle, right.borderBottomColor], rightB: [right.borderRightStyle, parseFloat(right.borderRightWidth)],
          middleRight: [middle.borderRightStyle, middle.borderRightColor],
        };
      });
      expect(Math.abs(r.padL - 8)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(r.padT - 16 / 3)).toBeLessThanOrEqual(0.5);
      expect(r.productColour).toBe('rgb(255, 255, 255)');
      expect(r.writing).toBe('sideways-lr');
      expect(r.valign).toBe('middle');
      expect(r.top[0]).toBe('double');
      expect(Math.abs(r.top[1] - 3)).toBeLessThanOrEqual(0.5);
      expect(r.top[2]).toBe('rgb(192, 0, 0)');
      expect(r.left).toEqual(['dotted', 'rgb(0, 112, 192)']);
      expect(r.bottom).toEqual(['dashed', 'rgb(0, 176, 80)']);
      expect(r.rightB[0]).toBe('solid');
      expect(Math.abs(r.rightB[1] - 3)).toBeLessThanOrEqual(0.5);
      // Word's rule: the heavier dotted border wins the shared edge over the grey single one.
      expect(r.middleRight).toEqual(['dotted', 'rgb(0, 112, 192)']);
    });

    test('D5/D11/D14: bold headings, green ✓ label at the level position, a TOC with page numbers', async ({ page }) => {
      const r = await page.evaluate(() => {
        const h1 = [...document.querySelectorAll('.page-flow .ProseMirror h1')].find((h) => h.textContent.startsWith('1. Character'));
        const tick = [...document.querySelectorAll('.page-flow .odt-label')].find((l) => l.textContent.trim() === '✓');
        const li = tick.closest('li');
        const p = li.querySelector('p');
        const pg = [...document.querySelectorAll('.page-bgs .pg')].find((g) => { const b = g.getBoundingClientRect(); const e = li.getBoundingClientRect(); return e.top >= b.top - 1 && e.top < b.bottom; }).getBoundingClientRect();
        const range = document.createRange();
        const text = [...p.childNodes].find((n) => n.nodeType === 3);
        range.setStart(text, 0); range.setEnd(text, 1);
        const toc = document.querySelector('.page-flow .odt-index');
        return {
          weight: getComputedStyle(h1).fontWeight, tickColour: getComputedStyle(tick).color,
          labelX: tick.getBoundingClientRect().left - pg.left, textX: range.getBoundingClientRect().left - pg.left,
          tocEntries: toc ? [...toc.querySelectorAll('p')].map((x) => x.textContent) : [],
        };
      });
      expect(r.weight).toBe('700');
      expect(r.tickColour).toBe('rgb(0, 176, 80)');
      // Label at left − hanging (0.25 in), text at left (0.5 in), from the 1 in margin.
      expect(Math.abs(r.labelX - (96 + 24))).toBeLessThanOrEqual(1);
      expect(Math.abs(r.textX - (96 + 48))).toBeLessThanOrEqual(1);
      expect(r.tocEntries.length).toBeGreaterThan(10);
      expect(r.tocEntries.find((t) => t.startsWith('1. Character Formatting'))).toMatch(/\t2$/);
      expect(r.tocEntries.find((t) => t.startsWith('10. Back to Portrait'))).toMatch(/\t8$/);
    });

    test('D13/L15: field shading is not printed', async ({ page }) => {
      expect(await page.evaluate(() => getComputedStyle(document.querySelector('.page-bgs .odt-field')).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
      await page.emulateMedia({ media: 'print' });
      expect(await page.evaluate(() => getComputedStyle(document.querySelector('.page-bgs .odt-field')).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
      await page.emulateMedia({ media: 'screen' });
    });

    test('round trip: import → export DOCX → import gives the same model; the export keeps every property; LibreOffice opens it', async ({ page }) => {
      test.setTimeout(240_000);
      mkdirSync(OUT, { recursive: true });
      const sorted = (pg = page) => pg.evaluate(() => { const sort = (v) => (Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])])) : v); return JSON.stringify(sort(window.odtEditor.editor.view.state.doc.toJSON())); });
      const before = await sorted();
      const pagesBefore = (await pagesInfo(page)).map((p) => p.start.slice(0, 20));
      const dl = page.waitForEvent('download');
      await page.evaluate(() => window.odtEditor.registry.run('file.export_docx'));
      const out = path.join(OUT, fx.name.replace('.docx', '-roundtrip.docx'));
      await (await dl).saveAs(out);
      const outBytes = readFileSync(out);
      // Re-import in a fresh window (the imported document is unsaved).
      const page2 = await page.context().newPage();
      const problems2 = await openApp(page2);
      await openDocx(page2, 'roundtrip.docx', outBytes);
      expect(await sorted(page2)).toBe(before);
      expect((await pagesInfo(page2)).map((p) => p.start.slice(0, 20))).toEqual(pagesBefore);
      expect([...problems2.pageErrors, ...problems2.consoleErrors]).toEqual([]);
      await page2.close();

      // Every property the fixture uses is still written (per property, not byte for byte).
      const props = (files, part) => {
        const xml = files[part] || '';
        const set = new Set();
        for (const m of xml.matchAll(/<w:(\w+)((?:\s+[\w:]+="[^"]*")*)\s*\/?>/g)) {
          set.add(m[1]);
          for (const a of m[2].matchAll(/w:(\w+)=/g)) set.add(`${m[1]}@${a[1]}`);
        }
        return set;
      };
      // Not written on purpose: Word's bookkeeping, UI hints and things the model doesn't keep (listed in PROGRESS.md).
      const IGNORE = /^(rsid\w*|proofErr|lastRenderedPageBreak|qFormat|uiPriority|semiHidden|unhideWhenUsed|docGrid|docGrid@\w+|lang@eastAsia|lang@bidi|tblLook@\w+|tblLook|link|rFonts@eastAsiaTheme|rFonts@cstheme|rFonts@\w*Theme|szCs|bCs|iCs|sdtPr|sdtEndPr|docPartObj|docPartGallery|docPartUnique|id|name|cols@space|tcW@type|tblW@type|gridCol|gridCol@w|cnfStyle|cnfStyle@\w+|noProof|tblStyle@val|tblStyle|tab@pos|tabs|fldSimple|fldSimple@instr|style@customStyle|style@default|style@type|style@styleId|basedOn@val|basedOn|next@val|next|name@val|aliases|autoRedefine|locked|personal\w*|rPrDefault|pPrDefault|docDefaults|latentStyles|lsdException\w*|nsid|nsid@val|tmpl|tmpl@val|multiLevelType|multiLevelType@val|abstractNumId@val|lvl@tplc|lvl@tentative|lvlRestart|isLgl|legacy\w*|pStyle@val|start@val|start|numFmt@format|tblInd@type|tcMar|tblCellMar|top@type|left@type|bottom@type|right@type|start@type|end@type)$/;
      const inFiles = xmlFiles(bytes);
      const outFiles = xmlFiles(outBytes);
      const missing = [];
      for (const part of ['word/document.xml', 'word/styles.xml', 'word/numbering.xml']) {
        const a = props(inFiles, part);
        const b = new Set([...props(outFiles, 'word/document.xml'), ...props(outFiles, 'word/styles.xml'), ...props(outFiles, 'word/numbering.xml')]);
        for (const p of a) if (!b.has(p) && !IGNORE.test(p)) missing.push(`${part}: ${p}`);
      }
      expect(missing).toEqual([]);

      if (soffice) {
        const dir = path.join(OUT, `lo-${fx.real ? 'real' : 'synthetic'}`);
        mkdirSync(dir, { recursive: true });
        const orig = path.join(dir, fx.name);
        writeFileSync(orig, bytes);
        const lo = (f) => {
          execFileSync('soffice', [`-env:UserInstallation=file://${OUT}/lo-profile-${fx.name}`, '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', dir, f], { stdio: 'pipe', timeout: 180_000 });
          const pdf = path.join(dir, `${path.basename(f, '.docx')}.pdf`);
          const n = Number(execFileSync('pdfinfo', [pdf]).toString().match(/Pages:\s+(\d+)/)[1]);
          const starts = Array.from({ length: n }, (_, i) => execFileSync('pdftotext', ['-f', String(i + 1), '-l', String(i + 1), pdf, '-']).toString().split('\n').map((l) => l.trim()).filter(Boolean).slice(1, 3).join(' '));
          return { n, starts };
        };
        const a = lo(orig);
        const b = lo(out);
        expect(b.n).toBe(8);
        expect(b.n).toBe(a.n);
        expect(b.starts.map((s) => s.slice(0, 12))).toEqual(a.starts.map((s) => s.slice(0, 12)));
      }
    });
  });
}

/** The existing Word fixtures through the same import → export → import chain. */
test.describe('docx round trip: existing fixtures', () => {
  for (const name of ['word-features.docx', 'lo-formatting-zoo.docx', 'lo-tables.docx']) {
    test(`${name}: the exported DOCX imports to the same model, and LibreOffice opens it`, async ({ page }) => {
      test.setTimeout(180_000);
      const problems = await openApp(page);
      const bytes = readFileSync(path.resolve('tests/fixtures', name));
      await openDocx(page, name, bytes);
      const sorted = (pg) => pg.evaluate(() => { const sort = (v) => (Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])])) : v); return JSON.stringify(sort(window.odtEditor.editor.view.state.doc.toJSON())); });
      const before = await sorted(page);
      const dl = page.waitForEvent('download');
      await page.evaluate(() => window.odtEditor.registry.run('file.export_docx'));
      mkdirSync(OUT, { recursive: true });
      const out = path.join(OUT, name.replace('.docx', '-roundtrip.docx'));
      await (await dl).saveAs(out);
      const page2 = await page.context().newPage();
      const problems2 = await openApp(page2);
      await openDocx(page2, 'roundtrip.docx', readFileSync(out));
      expect(await sorted(page2)).toBe(before);
      expect([...problems.pageErrors, ...problems.consoleErrors, ...problems2.pageErrors, ...problems2.consoleErrors]).toEqual([]);
      if (soffice) {
        const dir = path.join(OUT, 'lo-existing');
        mkdirSync(dir, { recursive: true });
        execFileSync('soffice', [`-env:UserInstallation=file://${OUT}/lo-profile-${name}`, '--headless', '--norestore', '--convert-to', 'txt:Text (encoded):UTF8', '--outdir', dir, out], { stdio: 'pipe', timeout: 120_000 });
        expect(readFileSync(path.join(dir, path.basename(out).replace('.docx', '.txt')), 'utf8').length).toBeGreaterThan(20);
      }
    });
  }
});

/** Single Word layout rules on small documents built from raw OOXML. */
test.describe('docx rules', () => {
  let builder;
  test.beforeAll(async () => { builder = await import('../lib/docx-builder.mjs'); });
  const open = async (page, docx) => { const problems = await openApp(page); await openDocx(page, 'rule.docx', Buffer.from(docx)); return problems; };
  const sect = (refs = '') => `<w:sectPr>${refs}<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`;

  test('L1: bold toggles along the style chain and against a character style', async ({ page }) => {
    const { buildDocx, p, r } = builder;
    const styles = '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
      + '<w:style w:type="paragraph" w:styleId="Strong1"><w:name w:val="Strong one"/><w:basedOn w:val="Normal"/><w:rPr><w:b/></w:rPr></w:style>'
      + '<w:style w:type="paragraph" w:styleId="Strong2"><w:name w:val="Strong two"/><w:basedOn w:val="Strong1"/><w:rPr><w:b/></w:rPr></w:style>'
      + '<w:style w:type="character" w:styleId="BoldChar"><w:name w:val="Bold char"/><w:rPr><w:b/></w:rPr></w:style>';
    const body = p('one', { style: 'Strong1' }) + p('two', { style: 'Strong2' }) + p([r('three', '<w:rStyle w:val="BoldChar"/>')], { style: 'Strong1' }) + p([r('four', '<w:rStyle w:val="BoldChar"/>')]);
    await open(page, buildDocx({ body, sectPr: sect(), styles }));
    const w = await page.evaluate(() => Object.fromEntries(['one', 'two', 'three', 'four'].map((t) => { const walker = document.createTreeWalker(document.querySelector('.page-flow .ProseMirror'), NodeFilter.SHOW_TEXT); let n; while ((n = walker.nextNode())) if (n.data === t) return [t, getComputedStyle(n.parentElement).fontWeight]; return [t, null]; })));
    expect(w).toEqual({ one: '700', two: '400', three: '400', four: '700' });
  });

  test('L2: contextual spacing removes the space between paragraphs of the same style only', async ({ page }) => {
    const { buildDocx, p } = builder;
    const styles = '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="240"/></w:pPr></w:style>'
      + '<w:style w:type="paragraph" w:styleId="Tight"><w:name w:val="Tight"/><w:basedOn w:val="Normal"/><w:pPr><w:contextualSpacing/></w:pPr></w:style>';
    const body = p('a', { style: 'Tight' }) + p('b', { style: 'Tight' }) + p('c') + p('d');
    await open(page, buildDocx({ body, sectPr: sect(), styles }));
    const tops = await page.evaluate(() => [...document.querySelectorAll('.page-flow .ProseMirror p')].map((x) => x.getBoundingClientRect().top));
    const line = tops[1] - tops[0];
    // a→b: no space; b→c: 12 + 12 pt added (32 px) plus a line; c→d the same.
    expect(Math.abs(tops[2] - tops[1] - (line + 32))).toBeLessThanOrEqual(1);
    expect(Math.abs(tops[3] - tops[2] - (line + 32))).toBeLessThanOrEqual(1);
    expect(line).toBeLessThan(25);
  });

  test('D1/L7: evenAndOddHeaders off (w:val="false") or absent shows the default header on even pages; on shows the even one', async ({ page }) => {
    const { buildDocx, p, pageBreak } = builder;
    const refs = '<w:headerReference w:type="default" r:id="rIdH1"/><w:headerReference w:type="even" r:id="rIdH2"/>';
    const body = p('page one') + p([pageBreak()]) + p('page two');
    for (const [settings, even] of [['<w:evenAndOddHeaders w:val="false"/>', 'DEFAULT'], ['', 'DEFAULT'], ['<w:evenAndOddHeaders/>', 'EVEN']]) {
      await open(page, buildDocx({ body, sectPr: sect(refs), settings, headers: { rIdH1: p('DEFAULT'), rIdH2: p('EVEN') } }));
      const hs = await page.evaluate(() => [...document.querySelectorAll('.page-bgs .pg')].map((g) => g.querySelector('.pg-header')?.textContent.trim() || ''));
      expect(hs).toEqual(['DEFAULT', even]);
    }
  });
});
