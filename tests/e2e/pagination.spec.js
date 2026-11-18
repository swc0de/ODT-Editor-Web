import { test, expect } from '@playwright/test';
import { openApp, openFixture } from './helpers.js';

/** Waits until the page count is stable (layouts can span frames). */
async function settled(page) {
  let last = -1;
  for (let i = 0; i < 60; i++) {
    const [n, pending] = await page.evaluate(() => [window.odtEditor.docArea.pages.length, window.odtEditor.docArea.layoutPending]);
    if (n === last && !pending) return n;
    last = n;
    await page.waitForTimeout(120);
  }
  return last;
}

/** Text lines that are not inside any page's body area. */
const linesOutsideBodies = (page) => page.evaluate(() => {
  const { docArea, editor, store } = window.odtEditor;
  const stack = docArea.view.stack.getBoundingClientRect();
  const z = store.get().zoom / 100;
  const pages = docArea.pages;
  const out = [];
  const range = document.createRange();
  const walker = document.createTreeWalker(editor.view.dom, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.data.trim()) continue;
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) {
      const top = (r.top - stack.top) / z;
      const bottom = (r.bottom - stack.top) / z;
      if (!pages.some((p) => top >= p.top + p.box.top - 2 && bottom <= p.top + p.box.bottom + 2)) out.push(n.data.slice(0, 30));
    }
  }
  return out;
});

/** Page index of a document element (by its first line). */
const pageOfRect = (r, stack, pages, z) => pages.findIndex((p) => (r.top - stack.top) / z >= p.top - 1 && (r.top - stack.top) / z < p.top + p.box.pageHeight);

test.describe('print layout', () => {
  let problems;
  test.beforeEach(async ({ page }) => { problems = await openApp(page); });
  test.afterEach(() => {
    expect(problems.pageErrors).toEqual([]);
    expect(problems.consoleErrors).toEqual([]);
  });

  test('a 50-page document paginates with every line inside a page body', async ({ page }) => {
    await openFixture(page, 'long-50-pages.odt');
    const n = await settled(page);
    expect(n).toBeGreaterThanOrEqual(48); // LibreOffice: 51
    expect(n).toBeLessThanOrEqual(53);
    expect(await linesOutsideBodies(page)).toEqual([]);
    await expect(page.locator('.pg')).toHaveCount(n);
    await expect(page.locator('.status-bar')).toContainText(`of ${n}`);
  });

  test('headers, footers and page-number fields per page', async ({ page }) => {
    await openFixture(page, 'headers-footers.odt');
    expect(await settled(page)).toBe(3);
    const pgs = page.locator('.pg');
    await expect(pgs.nth(0).locator('.pg-header')).toContainText('First-page header');
    await expect(pgs.nth(0).locator('.pg-footer')).toContainText('First page footer');
    await expect(pgs.nth(1).locator('.pg-header')).toContainText('Left-page header');
    await expect(pgs.nth(1).locator('.pg-footer')).toContainText('Page 2 of 3');
    await expect(pgs.nth(2).locator('.pg-header')).toContainText('Studio handbook');
    await expect(pgs.nth(2).locator('.pg-footer')).toContainText('Page 3 of 3');
    expect(await linesOutsideBodies(page)).toEqual([]);
  });

  test('page breaks start a new page and keep-with-next keeps headings with their text', async ({ page }) => {
    await openFixture(page, 'long-100-pages.odt');
    await settled(page);
    const result = await page.evaluate(() => {
      const { docArea, editor, store } = window.odtEditor;
      const stack = docArea.view.stack.getBoundingClientRect();
      const z = store.get().zoom / 100;
      const pages = docArea.pages;
      const pageOf = (el) => { const r = el.getClientRects()[0]; return pages.findIndex((p) => (r.top - stack.top) / z >= p.top - 1 && (r.top - stack.top) / z < p.top + p.box.pageHeight); };
      let separated = 0;
      for (const hd of editor.view.dom.querySelectorAll('h1, h2')) {
        const next = hd.nextElementSibling?.matches('p') ? hd.nextElementSibling : null;
        if (next && pageOf(hd) !== pageOf(next)) separated++;
      }
      return { separated, headings: editor.view.dom.querySelectorAll('h1, h2').length };
    });
    expect(result.headings).toBeGreaterThan(90);
    expect(result.separated).toBe(0);

    await openFixture(page, 'formatting-zoo.odt');
    await settled(page);
    const breakPage = await page.evaluate(() => {
      const { docArea, editor, store } = window.odtEditor;
      const el = [...editor.view.dom.querySelectorAll('p')].find((p) => p.textContent.startsWith('This paragraph starts on a new page'));
      const r = el.getBoundingClientRect();
      const stack = docArea.view.stack.getBoundingClientRect();
      const z = store.get().zoom / 100;
      const p = docArea.pages.find((x) => (r.top - stack.top) / z >= x.top && (r.top - stack.top) / z < x.top + x.box.pageHeight);
      return { index: p.index, offset: (r.top - stack.top) / z - (p.top + p.box.top) };
    });
    expect(breakPage.index).toBeGreaterThan(0);
    expect(Math.abs(breakPage.offset)).toBeLessThan(2); // at the top of the body
  });

  test('widows and orphans: split paragraphs keep at least two lines on each page', async ({ page }) => {
    await openFixture(page, 'long-50-pages.odt');
    await settled(page);
    const bad = await page.evaluate(() => {
      const out = [];
      for (const gap of window.odtEditor.editor.view.dom.querySelectorAll('p > .pg-gap-inline')) {
        const p = gap.parentElement;
        const range = document.createRange();
        const lineTops = (from, to) => {
          range.setStartBefore(from); range.setEndAfter(to);
          return new Set([...range.getClientRects()].filter((r) => r.height > 0 && r.height < 40).map((r) => Math.round(r.top))).size;
        };
        const before = lineTops(p.firstChild, gap.previousSibling || gap);
        const after = lineTops(gap.nextSibling || gap, p.lastChild);
        if (before < 2 || after < 2) out.push([before, after]);
      }
      return out;
    });
    expect(bad).toEqual([]);
  });

  test('tables split between rows', async ({ page }) => {
    await page.locator('.ProseMirror').click();
    const rows = Array.from({ length: 70 }, (_, i) => `<tr><td>Row ${i + 1}</td><td>${'text '.repeat((i % 5) + 1)}</td></tr>`).join('');
    await page.evaluate((rows) => {
      const dt = new DataTransfer();
      dt.setData('text/html', `<p>Intro</p><table>${rows}</table><p>After the table</p>`);
      document.querySelector('.ProseMirror').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, rows);
    expect(await settled(page)).toBeGreaterThanOrEqual(2);
    expect(await linesOutsideBodies(page)).toEqual([]);
    await expect(page.locator('table.pg-split')).toHaveCount(1);
  });

  test('incremental re-layout after edits matches a full layout', async ({ page }) => {
    await openFixture(page, 'long-50-pages.odt');
    await settled(page);
    // Edit near the top: add and remove lines, which moves every later page break.
    await page.evaluate(() => {
      const { view } = window.odtEditor.editor;
      view.dispatch(view.state.tr.setSelection(view.state.selection.constructor.near(view.state.doc.resolve(40))));
      view.focus();
    });
    for (let i = 0; i < 4; i++) { await page.keyboard.press('Enter'); await page.keyboard.type('Added line.'); }
    await page.keyboard.press('Backspace');
    const incremental = await settled(page) && await page.evaluate(() => window.odtEditor.docArea.pages.map((p) => p.startPos));
    await page.evaluate(() => window.odtEditor.docArea.relayout());
    await page.waitForTimeout(200);
    await settled(page);
    const full = await page.evaluate(() => window.odtEditor.docArea.pages.map((p) => p.startPos));
    expect(incremental).toEqual(full);
    expect(await linesOutsideBodies(page)).toEqual([]);
  });

  test('status bar shows the caret page and the total', async ({ page }) => {
    await openFixture(page, 'long-50-pages.odt');
    const n = await settled(page);
    await page.locator('.ProseMirror').press('Control+End');
    await expect(page.locator('.status-bar')).toContainText(`Page ${n} of ${n}`);
    await page.locator('.ProseMirror').press('Control+Home');
    await expect(page.locator('.status-bar')).toContainText(`Page 1 of ${n}`);
  });
});

test.describe('zoom and view options', () => {
  test.beforeEach(async ({ page }) => { await openApp(page); });

  test('Ctrl+wheel, zoom buttons, the slider and the Zoom dialog', async ({ page }) => {
    const pct = page.locator('.status-bar .sb-pct');
    await expect(pct).toHaveText('100%');
    await page.locator('.canvas').hover();
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    await expect(pct).toHaveText('110%');
    await page.locator('.status-bar [data-command="view.zoomOut"]').click();
    await expect(pct).toHaveText('100%');
    const w100 = (await page.locator('.pg').first().boundingBox()).width;
    await page.getByRole('tab', { name: 'View', exact: true }).click();
    await page.locator('.ribbon-panel [data-command="view.zoomDialog"]').click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('200%').check();
    await dlg.getByRole('button', { name: 'OK' }).click();
    await expect(pct).toHaveText('200%');
    const w200 = (await page.locator('.pg').first().boundingBox()).width;
    expect(w200 / w100).toBeGreaterThan(1.95);
    await page.locator('.ribbon-panel [data-command="view.zoom100"]').click();
    await expect(pct).toHaveText('100%');
    await page.locator('.ribbon-panel [data-command="view.pageWidth"]').click();
    const canvas = await page.locator('.canvas').boundingBox();
    const pgBox = await page.locator('.pg').first().boundingBox();
    expect(pgBox.width).toBeGreaterThan(canvas.width - 80);
    expect(pgBox.width).toBeLessThan(canvas.width);
    // The slider: clicking the middle is 100 %.
    const slider = await page.locator('.sb-slider').boundingBox();
    await page.mouse.click(slider.x + slider.width / 2, slider.y + slider.height / 2);
    await expect(pct).toHaveText('100%');
  });

  test('Side to Side and Multiple Pages lay pages out horizontally', async ({ page }) => {
    await openFixture(page, 'headers-footers.odt');
    await page.getByRole('tab', { name: 'View', exact: true }).click();
    await page.locator('.ribbon-panel [data-command="view.sideToSide"]').click();
    await expect(page.locator('.page-stack')).toHaveClass(/side/);
    await expect.poll(() => page.locator('.pg').count()).toBeGreaterThanOrEqual(3);
    const lefts = await page.locator('.pg').evaluateAll((els) => els.map((e) => parseFloat(e.style.left)));
    expect(lefts[1]).toBeGreaterThan(lefts[0]);
    await page.locator('.ribbon-panel [data-command="view.vertical"]').click();
    await expect(page.locator('.page-stack')).not.toHaveClass(/side/);
    await expect.poll(() => page.evaluate(() => window.odtEditor.docArea.pages.length)).toBe(3);
  });

  test('Show: Ruler, Gridlines and Hide White Space', async ({ page }) => {
    await page.getByRole('tab', { name: 'View', exact: true }).click();
    const ruler = page.locator('.ribbon-panel .rb-check[data-command="view.ruler"] input');
    await expect(ruler).toBeChecked();
    await ruler.click();
    await expect(page.locator('.hruler-strip')).toBeHidden();
    await ruler.click();
    await expect(page.locator('.hruler-strip')).toBeVisible();
    await page.locator('.ribbon-panel .rb-check[data-command="view.gridlines"] input').click();
    await expect(page.locator('.page-stack')).toHaveClass(/gridlines/);
    const before = (await page.locator('.pg').first().boundingBox()).height;
    await page.locator('.ribbon-panel .rb-check[data-command="view.hideWhiteSpace"] input').click();
    await expect.poll(async () => (await page.locator('.pg').first().boundingBox()).height).toBeLessThan(before - 100);
  });
});

test.describe('rulers', () => {
  test.beforeEach(async ({ page }) => { await openApp(page); });
  const pp = (page) => page.evaluate(() => window.odtEditor.editor.getDoc().child(0).attrs.auto?.props['style:paragraph-properties'] || null);

  test('dragging the left indent marker indents the paragraph (undoable)', async ({ page }) => {
    await page.locator('.ProseMirror').click();
    await page.keyboard.type('Indent me');
    const m = await page.locator('.ruler-marker.left-indent').boundingBox();
    await page.mouse.move(m.x + m.width / 2, m.y + m.height / 2);
    await page.mouse.down();
    await page.mouse.move(m.x + m.width / 2 + 76, m.y + m.height / 2, { steps: 5 });
    await page.mouse.up();
    expect((await pp(page)).a['fo:margin-left']).toBe('2cm');
    await page.keyboard.press('Control+z');
    expect(await pp(page)).toBeNull();
  });

  test('clicking the ruler adds a tab stop, the tab aligns to it, dragging off removes it', async ({ page }) => {
    await page.locator('.ProseMirror').click();
    await page.keyboard.type('A');
    await page.keyboard.press('Tab');
    await page.keyboard.type('B');
    const body = await page.locator('.hruler-body').boundingBox();
    const z = 1;
    await page.mouse.click(body.x + (5 * 96 / 2.54) * z, body.y + body.height / 2);
    const stops = (await pp(page)).c.find((c) => c.n === 'style:tab-stops').c;
    expect(stops.map((s) => s.a['style:position'])).toEqual(['5cm']);
    // "B" starts at the stop.
    await expect.poll(async () => page.evaluate(() => {
      const p = window.odtEditor.editor.view.dom.querySelector('p');
      const range = document.createRange();
      const text = [...p.childNodes].filter((n) => n.nodeType === 3).pop();
      range.setStart(text, 0); range.setEnd(text, 1);
      return Math.round((range.getBoundingClientRect().left - p.getBoundingClientRect().left) / (96 / 2.54) * 10) / 10;
    })).toBe(5);
    const tab = await page.locator('.ruler-tab').first().boundingBox();
    await page.mouse.move(tab.x + 3, tab.y + 3);
    await page.mouse.down();
    await page.mouse.move(tab.x + 3, tab.y + 80, { steps: 5 });
    await page.mouse.up();
    await expect(page.locator('.ruler-tab')).toHaveCount(0);
  });

  test('dragging a margin edge changes the page margin', async ({ page }) => {
    const edge = await page.locator('.ruler-edge.h').first().boundingBox();
    await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
    await page.mouse.down();
    await page.mouse.move(edge.x + edge.width / 2 - 19, edge.y + edge.height / 2, { steps: 4 });
    await page.mouse.up();
    const margin = await page.evaluate(() => {
      const st = window.odtEditor.session.state;
      const layout = st.stylesAutoStyles.c.find((t) => t.n === 'style:page-layout');
      return layout.c.find((c) => c.n === 'style:page-layout-properties').a['fo:margin-left'];
    });
    expect(margin).toBe('2cm'); // snapped to 0.25 cm
    await expect(page).toHaveTitle(/^●/);
  });
});
