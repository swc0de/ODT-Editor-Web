import { test, expect } from '@playwright/test';
import { openApp, openFixture } from './helpers.js';

const docText = (page) => page.evaluate(() => {
  const out = [];
  window.odtEditor.editor.getDoc().forEach((n) => out.push(n.textContent));
  return out;
});

test.describe('editing', () => {
  let problems;
  test.beforeEach(async ({ page }) => { problems = await openApp(page); });
  test.afterEach(() => {
    expect(problems.pageErrors).toEqual([]);
    expect(problems.consoleErrors).toEqual([]);
    expect(problems.networkRequests).toEqual([]);
  });

  test('typing, Enter, Shift+Enter, Tab and the word count', async ({ page }) => {
    await page.locator('.ProseMirror').click();
    await page.keyboard.type('Hello world');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Second');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('line');
    await page.keyboard.press('Tab');
    await page.keyboard.type('x');
    expect(await docText(page)).toEqual(['Hello world', 'Second\nline\tx']);
    await expect(page.locator('.ProseMirror p').nth(1).locator('br')).toHaveCount(1);
    await expect(page.locator('.status-bar')).toContainText('5 words');
    await expect(page).toHaveTitle(/^● Document1 - ODT Editor$/);
  });

  test('undo and redo group typing', async ({ page }) => {
    await page.locator('.ProseMirror').click();
    await page.keyboard.type('first');
    await page.waitForTimeout(700); // a pause starts a new undo group
    await page.keyboard.type(' second');
    await page.keyboard.press('Control+z');
    expect(await docText(page)).toEqual(['first']);
    await page.keyboard.press('Control+z');
    expect(await docText(page)).toEqual(['']);
    await page.keyboard.press('Control+y');
    expect(await docText(page)).toEqual(['first']);
    expect(await page.evaluate(() => window.odtEditor.registry.isEnabled('file.redo'))).toBe(true);
  });

  test('IME composition inserts the composed text', async ({ page }) => {
    await page.locator('.ProseMirror').click();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.imeSetComposition', { text: 'か', selectionStart: 1, selectionEnd: 1 });
    await cdp.send('Input.imeSetComposition', { text: 'かん', selectionStart: 2, selectionEnd: 2 });
    await cdp.send('Input.insertText', { text: '漢' });
    await expect.poll(() => docText(page)).toEqual(['漢']);
  });

  async function paste(page, data, { click = true } = {}) {
    if (click) await page.locator('.ProseMirror').click();
    await page.evaluate((data) => {
      const dt = new DataTransfer();
      for (const [type, value] of Object.entries(data)) dt.setData(type, value);
      const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      document.querySelector('.ProseMirror').dispatchEvent(ev);
    }, data);
  }

  const marksOf = (page) => page.evaluate(() => {
    const out = [];
    window.odtEditor.editor.getDoc().descendants((n) => {
      if (n.isText) out.push({ text: n.text, props: n.marks.find((m) => m.type.name === 'textProps')?.attrs.auto?.props['style:text-properties'].a || null });
    });
    return out;
  });

  test('rich paste from HTML keeps formatting, headings, lists and tables', async ({ page }) => {
    await paste(page, {
      'text/html': '<h2>Title here</h2><p>Plain <b>bold <i>both</i></b> <span style="color:#c00000;font-size:16pt">red</span></p><ul><li>one</li><li>two</li></ul><table><tr><td>a</td><td>b</td></tr></table>',
      'text/plain': 'ignored',
    });
    const types = await page.evaluate(() => { const o = []; window.odtEditor.editor.getDoc().forEach((n) => o.push(n.type.name)); return o; });
    expect(types).toEqual(expect.arrayContaining(['heading', 'paragraph', 'list', 'table']));
    const marks = await marksOf(page);
    expect(marks.find((m) => m.text === 'both').props).toMatchObject({ 'fo:font-weight': 'bold', 'fo:font-style': 'italic' });
    expect(marks.find((m) => m.text === 'red').props).toMatchObject({ 'fo:color': '#c00000', 'fo:font-size': '16pt' });
  });

  test('paste from Word drops Office markup', async ({ page }) => {
    const word = `<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><style>p.MsoNormal{margin:0}</style></head><body>
      <!--StartFragment--><p class=MsoTitle>Report<o:p></o:p></p><p class=MsoNormal><b><span style='mso-bidi-font-weight:normal'>Key</span></b> point<o:p></o:p></p><!--EndFragment--></body></html>`;
    await paste(page, { 'text/html': word });
    const info = await page.evaluate(() => { const o = []; window.odtEditor.editor.getDoc().forEach((n) => o.push([n.attrs.styleName, n.textContent])); return o; });
    expect(info).toEqual(expect.arrayContaining([['Title', 'Report'], ['Standard', 'Key point']]));
    expect((await marksOf(page)).find((m) => m.text === 'Key').props).toMatchObject({ 'fo:font-weight': 'bold' });
  });

  test('paste from LibreOffice keeps <font> formatting and alignment', async ({ page }) => {
    const lo = '<!DOCTYPE html><html><head><meta name="generator" content="LibreOffice"/><style type="text/css">p { line-height: 115%; margin-bottom: 0.25cm }</style></head><body lang="en-GB" dir="ltr"><p align="center" style="margin-bottom: 0cm"><font face="Liberation Serif"><font size="4" style="font-size: 14pt"><b>Centred heading-ish</b></font></font></p><p><font color="#c9211e">Red words</font> then <i>italic</i></p></body></html>';
    await paste(page, { 'text/html': lo });
    const marks = await marksOf(page);
    expect(marks.find((m) => m.text === 'Centred heading-ish').props).toMatchObject({ 'style:font-name': 'Liberation Serif', 'fo:font-size': '14pt', 'fo:font-weight': 'bold' });
    expect(marks.find((m) => m.text === 'Red words').props).toMatchObject({ 'fo:color': '#c9211e' });
    const align = await page.evaluate(() => window.odtEditor.editor.getDoc().child(0).attrs.auto?.props['style:paragraph-properties'].a['fo:text-align']);
    expect(align).toBe('center');
  });

  test('plain-text paste makes plain paragraphs', async ({ page }) => {
    await paste(page, { 'text/plain': 'alpha\n\nbeta' });
    const text = await docText(page);
    expect(text.join('|')).toContain('alpha');
    expect(text.join('|')).toContain('beta');
    expect((await marksOf(page)).every((m) => m.props === null)).toBe(true);
  });

  test('copy and paste within the editor is lossless', async ({ page }) => {
    await openFixture(page, 'formatting-zoo.odt');
    const before = await page.evaluate(() => window.odtEditor.editor.getDoc().child(1).toJSON());
    // Serialise the second paragraph as the clipboard would, then paste it back.
    await page.evaluate(() => {
      const { view } = window.odtEditor.editor;
      const node = view.state.doc.child(1);
      const from = view.state.doc.child(0).nodeSize;
      const slice = view.state.doc.slice(from, from + node.nodeSize);
      const html = view.serializeForClipboard ? view.serializeForClipboard(slice).dom.innerHTML : null;
      window.__html = html;
    });
    const html = await page.evaluate(() => window.__html);
    test.skip(!html, 'serializeForClipboard unavailable');
    await page.evaluate(() => {
      const { view } = window.odtEditor.editor;
      view.focus();
      view.dispatch(view.state.tr.setSelection(view.state.selection.constructor.atEnd(view.state.doc)));
    });
    await paste(page, { 'text/html': html }, { click: false });
    const after = await page.evaluate(() => { const d = window.odtEditor.editor.getDoc(); return d.child(d.childCount - 1).toJSON(); });
    expect(after.content).toEqual(before.content);
  });

  test('ribbon Undo is disabled until there is something to undo', async ({ page }) => {
    expect(await page.evaluate(() => window.odtEditor.registry.isEnabled('file.undo'))).toBe(false);
    await page.locator('.ProseMirror').click();
    await page.keyboard.type('x');
    expect(await page.evaluate(() => window.odtEditor.registry.isEnabled('file.undo'))).toBe(true);
  });
});
