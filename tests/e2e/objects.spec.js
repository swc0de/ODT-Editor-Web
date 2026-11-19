/**
 * M7: the Insert tab — pictures (Picture Format, crop, wrapping), shapes,
 * text boxes, WordArt, Arrange and the Selection Pane, links, bookmarks,
 * Quick Parts and fields, cover / blank pages, symbols, equations and charts.
 * Every test saves and re-opens (identical model); where it matters,
 * LibreOffice opens and re-saves the file and keeps what we wrote.
 */
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import path from 'node:path';
import { openApp } from './helpers.js';
import { readZipText, makePng } from '../lib/odf.mjs';

const OUT = path.resolve('test-results/objects');
mkdirSync(OUT, { recursive: true });
const soffice = ['soffice', 'libreoffice'].find((bin) => spawnSync(bin, ['--version'], { timeout: 60_000 }).status === 0);

const run = (page, id, ...args) => page.evaluate(({ id, args }) => { const r = window.odtEditor.registry.run(id, ...args); return r instanceof Promise ? 'pending' : r; }, { id, args });
const body = (page) => page.locator('.page-flow > .odt-doc > .ProseMirror');
const frames = (page) => page.evaluate(() => {
  const out = [];
  window.odtEditor.editor.view.state.doc.descendants((n, pos) => { if (n.type.name === 'frame') out.push({ pos, ...n.attrs }); return true; });
  return out;
});
const selected = (page) => page.evaluate(() => { const s = window.odtEditor.editor.view.state.selection; return s.node?.type.name === 'frame' ? s.node.attrs : null; });
const gp = (a) => a?.auto?.props?.['style:graphic-properties']?.a || {};

async function settled(page) {
  let last = '';
  for (let i = 0; i < 60; i++) {
    const [sig, pending] = await page.evaluate(() => [window.odtEditor.docArea.pages.map((p) => `${p.startPos}:${Math.round(p.top)}`).join(','), window.odtEditor.docArea.layoutPending]);
    if (sig === last && !pending) return;
    last = sig;
    await page.waitForTimeout(120);
  }
}

/** Saves, re-opens (model must match) and returns the package parts. */
async function roundTrip(page, name) {
  const r = await page.evaluate(async () => {
    const { session, editor, io } = window.odtEditor;
    const bytes = await session.serialize();
    const b = io.importOdt(bytes);
    let bin = '';
    for (const c of bytes) bin += String.fromCharCode(c);
    return { same: JSON.stringify(editor.getDoc().toJSON()) === JSON.stringify(b.doc.toJSON()), out: btoa(bin) };
  });
  const bytes = Buffer.from(r.out, 'base64');
  const file = path.join(OUT, name);
  writeFileSync(file, bytes);
  const zip = readZipText(new Uint8Array(bytes));
  return { ...r, file, zip, content: zip['content.xml'], styles: zip['styles.xml'] };
}

/** LibreOffice opens our file and saves it again: its package text parts. */
function libreOfficeResave(file) {
  const dir = path.join(OUT, 'lo');
  execFileSync(soffice, [`-env:UserInstallation=file://${OUT}/lo-profile-${path.basename(file, '.odt')}`, '--headless', '--norestore', '--convert-to', 'odt', '--outdir', dir, file], { stdio: 'pipe', timeout: 120_000 });
  const out = path.join(dir, path.basename(file));
  return existsSync(out) ? readZipText(new Uint8Array(readFileSync(out))) : null;
}

async function dialogOk(page) {
  await page.locator('.dlg button.primary').click();
  await expect(page.locator('.dlg')).toHaveCount(0);
  // The command finishes after the dialog closes.
  await page.waitForTimeout(80);
}

async function typeText(page, text) {
  await body(page).click();
  await page.keyboard.type(text);
}

/** Inserts a 400×300 PNG through Insert ▸ Pictures and the file chooser. */
async function insertPicture(page) {
  const png = makePng(400, 300, (x, y) => (x < 200 && y < 150 ? [255, 255, 255, 255] : [21, 96, 130, 255]));
  const chooser = page.waitForEvent('filechooser');
  await run(page, 'insert.pictures');
  await (await chooser).setFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  await expect.poll(async () => (await frames(page)).length).toBe(1);
  await settled(page);
}

async function drag(page, locator, dx, dy) {
  const b = await locator.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

test.describe('insert tab and drawing objects', () => {
  let problems;
  test.beforeEach(async ({ page }) => { problems = await openApp(page); });
  test.afterEach(() => {
    expect(problems.pageErrors).toEqual([]);
    expect(problems.consoleErrors).toEqual([]);
    expect(problems.networkRequests).toEqual([]);
  });

  test('pictures: insert in line, Picture Format, wrapping, handles, crop, alt text', async ({ page }) => {
    await typeText(page, 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(12));
    await page.keyboard.press('Control+Home');
    await insertPicture(page);
    // Inserted in line with text, selected, with the Picture Format tab.
    let a = await selected(page);
    expect(a.kind).toBe('image');
    expect(a.frameAttrs['text:anchor-type']).toBe('as-char');
    expect(a.frameAttrs['svg:width']).toBe('10.583cm');
    await expect(page.locator('[role=tab][data-tab="pictureFormat"]')).toHaveAttribute('aria-selected', 'true');
    // Corner handle keeps the proportions.
    await drag(page, page.locator('.obj-handle.se'), -100, 0);
    a = await selected(page);
    expect(parseFloat(a.frameAttrs['svg:width']) / parseFloat(a.frameAttrs['svg:height'])).toBeCloseTo(4 / 3, 2);
    expect(parseFloat(a.frameAttrs['svg:width'])).toBeLessThan(9);
    // Square wrapping: anchored to the paragraph, text beside it.
    await run(page, 'layout.wrapSquare');
    a = await selected(page);
    expect(a.frameAttrs['text:anchor-type']).toBe('paragraph');
    expect(gp(a)['style:wrap']).toBe('parallel');
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('.odt-obj .obj-float')).float)).toBe('left');
    // Drag to move; arrow keys nudge.
    await drag(page, page.locator('.odt-obj .obj-box'), 80, 30);
    a = await selected(page);
    const x = parseFloat(a.frameAttrs['svg:x']);
    expect(x).toBeGreaterThan(1.5);
    await page.keyboard.press('ArrowRight');
    expect(parseFloat((await selected(page)).frameAttrs['svg:x'])).toBeCloseTo(x + 0.1, 2);
    // Picture Format: style, corrections, recolour, transparency, rotate, crop.
    await run(page, 'pictureFormat.pictureStyle', 'simpleFrameBlack');
    await run(page, 'pictureFormat.correction', { b: 20, c: -20 });
    await run(page, 'pictureFormat.recolour', { mode: 'greyscale' });
    await run(page, 'pictureFormat.transparency30');
    await run(page, 'layout.rotateRight');
    a = await selected(page);
    expect(gp(a)['fo:border']).toBe('6pt solid #000000');
    expect(gp(a)['draw:luminance']).toBe('20%');
    expect(gp(a)['draw:color-mode']).toBe('greyscale');
    expect(gp(a)['draw:image-opacity']).toBe('70%');
    expect(a.frameAttrs['draw:transform']).toMatch(/^rotate \(4\.71/);
    await expect(page.locator('.odt-obj img')).toHaveCSS('filter', /grayscale/);
    await run(page, 'layout.rotateLeft');
    await run(page, 'pictureFormat.crop');
    await drag(page, page.locator('.obj-handle.crop.e'), -40, 0);
    a = await selected(page);
    expect(gp(a)['fo:clip']).toMatch(/^rect\(0cm, [\d.]+cm, 0cm, 0cm\)$/);
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => window.odtEditor.store.get().cropMode)).toBe(false);
    // Alt text.
    expect(await run(page, 'pictureFormat.altText')).toBe('pending');
    await page.locator('.dlg input').first().fill('Blue and white test picture');
    await dialogOk(page);
    const rt = await roundTrip(page, 'pictures.odt');
    expect(rt.same).toBe(true);
    expect(rt.content).toMatch(/<draw:frame draw:style-name="fr\d+" draw:name="Picture 1" text:anchor-type="paragraph"/);
    expect(rt.content).toContain('<svg:title>Blue and white test picture</svg:title>');
    expect(rt.content).toMatch(/fo:clip="rect\(0cm, [\d.]+cm, 0cm, 0cm\)"/);
    if (soffice) {
      const lo = libreOfficeResave(rt.file);
      expect(lo['content.xml']).toContain('Blue and white test picture');
      expect(lo['content.xml']).toContain('style:wrap="parallel"');
      expect(lo['content.xml']).toMatch(/draw:luminance="20%"/);
      expect(lo['content.xml']).toMatch(/fo:clip="rect\(/);
    }
  });

  test('shapes, lines, text boxes and WordArt; Shape Format; text inside shapes', async ({ page }) => {
    await typeText(page, 'Shapes paragraph. '.repeat(30));
    // Draw a star with the mouse.
    await run(page, 'insert.insertShape', 'star5');
    await expect(page.locator('.canvas.draw-mode')).toHaveCount(1);
    const pg = await page.locator('.pg').first().boundingBox();
    await page.mouse.move(pg.x + 200, pg.y + 300);
    await page.mouse.down();
    await page.mouse.move(pg.x + 320, pg.y + 400, { steps: 5 });
    await page.mouse.up();
    let a = await selected(page);
    expect(a.element).toBe('draw:custom-shape');
    expect(a.parts.find((p) => p.n === 'draw:enhanced-geometry').a['draw:type']).toBe('star5');
    expect(parseFloat(a.frameAttrs['svg:width'])).toBeCloseTo(120 * 2.54 / 96, 1);
    await expect(page.locator('[role=tab][data-tab="shapeFormat"]')).toHaveAttribute('aria-selected', 'true');
    // Fill, outline, shadow, style.
    await run(page, 'shapeFormat.shapeFill', '#e97132');
    await run(page, 'shapeFormat.weight3');
    await run(page, 'shapeFormat.shadowBottomRight');
    a = await selected(page);
    expect(gp(a)['draw:fill-color']).toBe('#e97132');
    expect(gp(a)['svg:stroke-width']).toBe('0.106cm');
    expect(gp(a)['draw:shadow']).toBe('visible');
    // A rectangle with text.
    await body(page).click();
    await page.keyboard.press('Control+End');
    await run(page, 'insert.insertShape', 'rectangle');
    await page.mouse.click(pg.x + 400, pg.y + 520);
    await run(page, 'shapeFormat.editText');
    await expect(page.locator('.odt-obj .obj-text .ProseMirror')).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest('.obj-text') != null)).toBe(true);
    await page.keyboard.type('Inside');
    // The Home tab acts on the shape's text.
    await page.keyboard.press('Control+a');
    await run(page, 'home.bold');
    expect(JSON.stringify((await frames(page)).find((f) => f.kind === 'shape' && f.body.length)?.body)).toContain('"fo:font-weight":"bold"');
    // An arrow line.
    await body(page).click();
    await run(page, 'insert.insertShape', 'arrow');
    await page.mouse.move(pg.x + 150, pg.y + 650);
    await page.mouse.down();
    await page.mouse.move(pg.x + 450, pg.y + 700, { steps: 4 });
    await page.mouse.up();
    a = await selected(page);
    expect(a.element).toBe('draw:line');
    expect(gp(a)['draw:marker-end']).toBe('Arrow');
    // Text box and WordArt.
    await body(page).click();
    await run(page, 'insert.insertTextBox', 'sidebar');
    await expect(page.locator('.odt-obj.kind-textbox .obj-text')).toContainText('Sidebar title');
    await page.locator('.odt-obj.kind-textbox .obj-text .ProseMirror').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' Typed in the box.');
    await body(page).click();
    await run(page, 'insert.insertWordArt', 'blueFill');
    await expect(page.locator('.odt-obj.kind-wordart svg text')).toHaveText('Your text here');
    expect((await frames(page)).find((f) => f.kind === 'textbox').body.map((b) => (b.content || []).map((x) => x.text).join('')).join('|')).toContain('Typed in the box.');
    const rt = await roundTrip(page, 'shapes.odt');
    expect(rt.same).toBe(true);
    expect(rt.content).toMatch(/<draw:custom-shape draw:style-name="gr\d+"[^>]*>/);
    expect(rt.content).toContain('draw:type="star5"');
    expect(rt.content).toContain('draw:type="fontwork-plain-text"');
    expect(rt.content).toMatch(/<draw:line [^>]*svg:x1=/);
    expect(rt.content).toMatch(/<draw:text-box[^>]*>.*Typed in the box\./);
    expect(rt.styles).toContain('draw:name="Arrow"');
    if (soffice) {
      const lo = libreOfficeResave(rt.file)['content.xml'];
      expect(lo).toContain('draw:type="star5"');
      expect(lo).toContain('Inside');
      expect(lo).toContain('Typed in the box.');
      expect(lo).toContain('Your text here');
      expect(lo).toContain('draw:marker-end');
    }
  });

  test('Arrange: position, order, align, flip, Layout dialog, Selection Pane', async ({ page }) => {
    await typeText(page, 'Arrange me. '.repeat(80));
    await page.keyboard.press('Control+Home');
    await insertPicture(page);
    await run(page, 'layout.position', 'middleRight');
    let a = await selected(page);
    expect(gp(a)['style:horizontal-pos']).toBe('right');
    expect(gp(a)['style:wrap']).toBe('parallel');
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('.odt-obj .obj-float')).float)).toBe('right');
    await run(page, 'layout.flipHorizontal');
    expect(gp(await selected(page))['style:mirror']).toBe('horizontal');
    await run(page, 'layout.alignLeft');
    expect(gp(await selected(page))['style:horizontal-pos']).toBe('left');
    // Layout dialog: size and wrap distance.
    expect(await run(page, 'layout.moreLayoutOptions')).toBe('pending');
    await page.locator('.dlg [role=tab]').nth(2).click();
    await page.locator('.dlg .fm-panel:not([hidden]) input.fm-len').nth(1).fill('5 cm');
    await page.locator('.dlg .fm-panel:not([hidden]) input.fm-len').nth(1).dispatchEvent('change');
    await dialogOk(page);
    a = await selected(page);
    expect(parseFloat(a.frameAttrs['svg:width'])).toBeCloseTo(5, 1);
    expect(parseFloat(a.frameAttrs['svg:height'])).toBeCloseTo(3.75, 1);
    // Two more objects: order.
    await body(page).click();
    await run(page, 'insert.insertTextBox', 'simple');
    await run(page, 'layout.sendToBack');
    const z = async () => Object.fromEntries((await frames(page)).map((f) => [f.frameAttrs['draw:name'], Number(f.frameAttrs['draw:z-index'])]));
    let zs = await z();
    expect(zs['Text Box 1']).toBeLessThan(zs['Picture 1']);
    await run(page, 'layout.bringToFront');
    zs = await z();
    expect(zs['Text Box 1']).toBeGreaterThan(zs['Picture 1']);
    // Selection Pane: list, hide, rename, select.
    await run(page, 'layout.selectionPane');
    const rows = page.locator('.selp-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('Text Box 1');
    await rows.nth(1).locator('.selp-eye').click();
    await expect(page.locator('.odt-obj.obj-hidden')).toHaveCount(1);
    await rows.nth(1).dblclick();
    await page.locator('.selp-input').fill('Hero image');
    await page.keyboard.press('Enter');
    await expect(page.locator('.selp-row').nth(1)).toContainText('Hero image');
    await page.locator('.selp-row').nth(1).click();
    expect((await selected(page)).frameAttrs['draw:name']).toBe('Hero image');
    const rt = await roundTrip(page, 'arrange.odt');
    expect(rt.same).toBe(true);
    expect(rt.content).toContain('draw:name="Hero image"');
    expect(rt.content).toContain('draw:display="none"');
    expect(rt.content).toContain('style:mirror="horizontal"');
  });

  test('links, bookmarks, Quick Parts, fields, signature line, cover and blank pages', async ({ page }) => {
    await typeText(page, 'See the summary. ');
    // Ctrl+K: a link to a web page.
    await page.keyboard.press('Control+k');
    await page.locator('.dlg input').first().fill('our website');
    await page.locator('.lk-panel input').fill('example.org/docs');
    await dialogOk(page);
    await expect(body(page).locator('a.odt-link')).toHaveAttribute('href', 'https://example.org/docs');
    await expect(body(page).locator('a.odt-link')).toHaveText('our website');
    // A bookmark at the end, then a link to it; Ctrl+click follows it.
    await page.keyboard.press('Enter');
    await page.keyboard.type('Summary paragraph.');
    expect(await run(page, 'insert.bookmark')).toBe('pending');
    await page.locator('.dlg input').first().fill('Summary');
    await dialogOk(page);
    await page.keyboard.press('Control+Home');
    // The editor takes native caret moves from selectionchange, a moment later.
    await expect.poll(() => page.evaluate(() => window.odtEditor.editor.view.state.selection.from)).toBe(1);
    await page.keyboard.press('Control+k');
    await page.locator('.lk-mode[data-mode=place]').click();
    await page.locator('.lk-places').selectOption('Summary');
    await page.locator('.dlg input').first().fill('Jump');
    await dialogOk(page);
    await page.keyboard.press('Control+Home');
    await body(page).locator('a.odt-link', { hasText: 'Jump' }).click({ modifiers: ['Control'] });
    await expect.poll(() => page.evaluate(() => window.odtEditor.editor.view.state.selection.$from.parent.textContent)).toBe('Summary paragraph.');
    // Fields: NumPages and document Title; AutoText.
    await page.keyboard.press('End');
    expect(await run(page, 'insert.field')).toBe('pending');
    await page.locator('.dlg select.fd-list').selectOption('numPages');
    await dialogOk(page);
    await run(page, 'insert.docPropTitle');
    await page.keyboard.press('Shift+Home');
    await expect.poll(() => page.evaluate(() => !window.odtEditor.editor.view.state.selection.empty)).toBe(true);
    expect(await run(page, 'insert.saveAutoText')).toBe('pending');
    await page.locator('.dlg input').first().fill('Summary block');
    await dialogOk(page);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await run(page, 'insert.autoTextEntry', 'Summary block');
    // Signature line, cover page, blank page.
    await page.keyboard.press('Enter');
    expect(await run(page, 'insert.signatureLine')).toBe('pending');
    await page.locator('.dlg input').first().fill('Alex Morgan');
    await dialogOk(page);
    await run(page, 'insert.insertCoverPage', 'banded');
    await run(page, 'insert.insertCoverPage', 'classic'); // replaces the first
    await page.keyboard.press('Control+End');
    await run(page, 'insert.blankPage');
    await settled(page);
    const doc = await page.evaluate(() => window.odtEditor.editor.view.state.doc.toJSON());
    expect(doc.content.filter((n) => n.type === 'section' && n.attrs.name === 'CoverPage')).toHaveLength(1);
    expect(await page.evaluate(() => window.odtEditor.docArea.pages.length)).toBe(4);
    const rt = await roundTrip(page, 'text-parts.odt');
    expect(rt.same).toBe(true);
    expect(rt.content).toContain('xlink:href="https://example.org/docs"');
    expect(rt.content).toContain('xlink:href="#Summary"');
    expect(rt.content).toContain('<text:bookmark text:name="Summary"/>');
    expect(rt.content).toMatch(/<text:page-count[^>]*>/);
    expect(rt.content).toMatch(/<text:title[^>]*>/);
    expect(rt.content).toContain('Alex Morgan');
    expect(rt.content).toContain('text:name="CoverPage"');
    expect(rt.content.match(/Summary paragraph\./g).length).toBeGreaterThanOrEqual(2);
    if (soffice) {
      const lo = libreOfficeResave(rt.file)['content.xml'];
      expect(lo).toContain('xlink:href="https://example.org/docs"');
      expect(lo).toContain('text:name="Summary"');
      expect(lo).toContain('text:page-count');
      expect(lo).toContain('CoverPage');
    }
    await run(page, 'insert.removeCoverPage');
    expect((await page.evaluate(() => window.odtEditor.editor.view.state.doc.toJSON())).content.some((n) => n.attrs?.name === 'CoverPage')).toBe(false);
  });

  test('symbols, Alt+X, icons and drop cap', async ({ page }) => {
    await typeText(page, 'Price ');
    await run(page, 'insert.insertSymbol', '€');
    expect(await run(page, 'insert.moreSymbols')).toBe('pending');
    await page.locator('.sym-body input[type=search]').fill('snowman');
    await page.locator('.sym-cell[data-cp="2603"]').click();
    await expect(page.locator('.sym-info')).toContainText('U+2603');
    await dialogOk(page);
    await page.keyboard.type(' 2192');
    await page.keyboard.press('Alt+x');
    await page.keyboard.type(' é');
    await page.keyboard.press('Alt+x');
    expect(await page.evaluate(() => window.odtEditor.editor.view.state.doc.textContent)).toBe('Price €☃ → 00E9');
    // The recent symbols list remembers what was used.
    await page.locator('.ribbon-tab, [role=tab]').filter({ hasText: 'Insert' }).first().click();
    await page.locator('.ribbon-panel [data-command="insert.symbol"]').first().click();
    await expect(page.locator('.symbol-grid .symbol-cell').first()).toHaveText('☃');
    await page.keyboard.press('Escape');
    // Icons: two at once, as SVG pictures.
    await body(page).click();
    await page.keyboard.press('End');
    expect(await run(page, 'insert.icons')).toBe('pending');
    await page.locator('.ic-cell[data-icon="heart"]').click();
    await page.locator('.ic-cell[data-icon="star"]').click();
    await dialogOk(page);
    await expect.poll(async () => (await frames(page)).length).toBe(2);
    expect((await frames(page))[0].parts[0].a['draw:mime-type']).toBe('image/svg+xml');
    // Drop cap.
    await page.keyboard.press('Enter');
    await page.keyboard.type('Once upon a time there was a long paragraph that runs over several lines of text so the drop cap has room.');
    await run(page, 'insert.dropCapDropped');
    await expect(body(page).locator('p.has-dropcap')).toHaveCount(1);
    const rt = await roundTrip(page, 'symbols.odt');
    expect(rt.same).toBe(true);
    expect(rt.content).toMatch(/<style:drop-cap style:lines="3"/);
    expect(rt.content).toContain('☃');
  });

  test('equations: built-in, editor, MathML objects that LibreOffice reads', async ({ page }) => {
    await typeText(page, 'Roots: ');
    await run(page, 'insert.insertEquationPreset', 'quadratic');
    await expect(page.locator('.odt-obj.kind-equation math')).toHaveCount(1);
    await page.keyboard.type(' done.');
    await page.keyboard.press('Enter');
    await run(page, 'insert.insertNewEquation');
    await expect(page.locator('math-field')).toHaveCount(1, { timeout: 15_000 });
    await page.locator('.eq-tex').fill('a^2+b^2=c^2');
    await dialogOk(page);
    await expect(page.locator('.odt-obj.kind-equation math')).toHaveCount(2);
    // Edit the second one: the editor opens with its LaTeX.
    const f = (await frames(page)).find((x) => x.frameAttrs['draw:name'] === 'Equation 2');
    await page.evaluate((pos) => { const v = window.odtEditor.editor.view; v.dispatch(v.state.tr.setSelection(window.odtEditor.pm.NodeSelection.create(v.state.doc, pos))); }, f.pos);
    await run(page, 'insert.editEquation');
    await expect(page.locator('.eq-tex')).toHaveValue('a^2+b^2=c^2');
    await page.locator('.eq-tex').fill('E=mc^2');
    await dialogOk(page);
    await expect(page.locator('.odt-obj.kind-equation math').nth(1)).toContainText('mc');
    const rt = await roundTrip(page, 'equations.odt');
    expect(rt.same).toBe(true);
    expect(rt.content).toMatch(/<draw:object xlink:href="\.\/Object 1"/);
    expect(rt.zip['Object 2/content.xml']).toContain('<annotation encoding="application/x-tex">E=mc^2</annotation>');
    expect(rt.zip['META-INF/manifest.xml']).toContain('manifest:full-path="Object 1/" manifest:media-type="application/vnd.oasis.opendocument.formula"');
    if (soffice) {
      const lo = libreOfficeResave(rt.file);
      expect(lo['Object 1/content.xml']).toMatch(/<math[\s>]/);
      expect(lo['Object 2/content.xml']).toContain('mc');
    }
  });

  test('charts: column and pie, data grid, edit; ODF chart objects', async ({ page }) => {
    await typeText(page, 'Results');
    await page.keyboard.press('Enter');
    expect(await run(page, 'insert.chart')).toBe('pending');
    await page.locator('.ch-grid td input').first().fill('9');
    await page.locator('.ch-tools button').first().click(); // add a row
    await expect(page.locator('.ch-grid tr')).toHaveCount(6);
    await dialogOk(page);
    await expect(page.locator('.odt-obj.kind-chart svg rect')).not.toHaveCount(0);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    expect(await run(page, 'insert.chart')).toBe('pending');
    await page.locator('.ch-type[data-type=pie]').click();
    await page.locator('.dlg input').first().fill('Share of sales');
    await dialogOk(page);
    await expect(page.locator('.odt-obj.kind-chart')).toHaveCount(2);
    // Edit the first chart's data.
    const first = (await frames(page))[0];
    await page.evaluate((pos) => { const v = window.odtEditor.editor.view; v.dispatch(v.state.tr.setSelection(window.odtEditor.pm.NodeSelection.create(v.state.doc, pos))); }, first.pos);
    await run(page, 'insert.editChart');
    await expect(page.locator('.ch-grid td input').first()).toHaveValue('9');
    await page.locator('.ch-type[data-type=line]').click();
    await dialogOk(page);
    const rt = await roundTrip(page, 'charts.odt');
    expect(rt.same).toBe(true);
    expect(rt.zip['Object 1/content.xml']).toContain('chart:class="chart:line"');
    expect(rt.zip['Object 1/content.xml']).toContain('office:value="9"');
    expect(rt.zip['Object 2/content.xml']).toContain('chart:class="chart:circle"');
    expect(rt.zip['Object 2/content.xml']).toContain('Share of sales');
    if (soffice) {
      const lo = libreOfficeResave(rt.file);
      expect(lo['Object 1/content.xml']).toContain('chart:class="chart:line"');
      expect(lo['Object 1/content.xml']).toMatch(/office:value="9"/);
      expect(lo['Object 2/content.xml']).toContain('Share of sales');
    }
  });
});
