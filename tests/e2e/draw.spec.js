/**
 * M10: the Draw tab — pen, pencil and highlighter strokes as ODF paths,
 * eraser, lasso, Ink to Shape, Drawing Canvas, Ink Replay. Every test saves
 * and re-opens (identical model); LibreOffice re-saves the file and keeps
 * the drawings.
 */
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import path from 'node:path';
import { openApp } from './helpers.js';
import { readZipText, makePng } from '../lib/odf.mjs';

const OUT = path.resolve('test-results/draw');
mkdirSync(OUT, { recursive: true });
const soffice = ['soffice', 'libreoffice'].find((bin) => spawnSync(bin, ['--version'], { timeout: 60_000 }).status === 0);

const run = (page, id, ...args) => page.evaluate(({ id, args }) => { const r = window.odtEditor.registry.run(id, ...args); return r instanceof Promise ? 'pending' : r; }, { id, args });
const body = (page) => page.locator('.page-flow > .odt-doc > .ProseMirror');
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
    const A = JSON.stringify(editor.getDoc().toJSON());
    const B = JSON.stringify(b.doc.toJSON());
    let i = 0;
    while (i < A.length && A[i] === B[i]) i++;
    return { same: A === B, diff: A === B ? null : [A.slice(Math.max(0, i - 200), i + 200), B.slice(Math.max(0, i - 200), i + 200)], out: btoa(bin) };
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

const frames = (page) => page.evaluate(() => {
  const out = [];
  window.odtEditor.editor.view.state.doc.descendants((n, pos) => { if (n.type.name === 'frame') out.push({ pos, kind: n.attrs.kind, element: n.attrs.element, name: n.attrs.frameAttrs['draw:name'], parts: (n.attrs.parts || []).map((p) => p.n) }); return true; });
  return out;
});

async function stroke(page, pts, opts = {}) {
  const pg = await page.locator('.page-bgs .pg').first().boundingBox();
  await page.mouse.move(pg.x + pts[0][0], pg.y + pts[0][1]);
  await page.mouse.down();
  for (const [x, y] of pts.slice(1)) await page.mouse.move(pg.x + x, pg.y + y, { steps: opts.steps || 4 });
  await page.mouse.up();
}

test.describe('draw', () => {
  let problems;
  test.beforeEach(async ({ page }) => { problems = await openApp(page); });
  test.afterEach(() => {
    expect(problems.pageErrors).toEqual([]);
    expect(problems.consoleErrors).toEqual([]);
    expect(problems.networkRequests).toEqual([]);
  });

  test('pens, colour and thickness, eraser, lasso, Ink to Shape, round trip with LibreOffice', async ({ page }) => {
    await typeText(page, 'A paragraph to draw beside. '.repeat(6));
    await page.locator('[role=tab][data-tab="draw"]').click();
    // Pen with a colour and thickness.
    await page.locator('[data-command="draw.pen"]').click();
    await expect(page.locator('.ink-layer')).toBeVisible();
    await run(page, 'draw.penColour', '#c00000');
    await run(page, 'draw.penThickness', 2);
    await stroke(page, [[150, 320], [200, 350], [260, 330], [320, 370]]);
    // Pencil and highlighter.
    await page.locator('[data-command="draw.pencil"]').click();
    await stroke(page, [[150, 420], [300, 440], [400, 420]]);
    await page.locator('[data-command="draw.highlighter"]').click();
    await stroke(page, [[110, 210], [500, 212]]);
    await expect.poll(async () => (await frames(page)).map((f) => f.name).sort()).toEqual(['Highlighter 1', 'Pen 1', 'Pencil 1']);
    const pen = await page.evaluate(() => { let a = null; window.odtEditor.editor.view.state.doc.descendants((n) => { if (n.attrs?.frameAttrs?.['draw:name'] === 'Pen 1') a = n.attrs; return true; }); return a.auto.props['style:graphic-properties'].a; });
    expect(pen['svg:stroke-color']).toBe('#c00000');
    expect(pen['svg:stroke-width']).toBe('0.200cm');
    // Settings are remembered per pen.
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.endsWith(':settings')))).inkPens.pen)).toEqual({ colour: '#c00000', width: 2 });
    await expect(page.locator('.odt-obj.kind-ink')).toHaveCount(3);
    // Eraser removes the pencil stroke.
    await page.locator('[data-command="draw.eraser"]').click();
    await stroke(page, [[290, 415], [300, 445]], { steps: 6 });
    await expect.poll(async () => (await frames(page)).map((f) => f.name).sort()).toEqual(['Highlighter 1', 'Pen 1']);
    // Lasso the pen stroke and move it, then delete the highlighter.
    await page.locator('[data-command="draw.lasso"]').click();
    await stroke(page, [[130, 300], [360, 300], [360, 400], [130, 400], [130, 302]]);
    await expect(page.locator('.ink-selection')).toBeVisible();
    const before = await page.locator('.odt-obj[data-name="Pen 1"] .obj-box').boundingBox();
    const sel = await page.locator('.ink-selection').boundingBox();
    await page.mouse.move(sel.x + sel.width / 2, sel.y + sel.height / 2);
    await page.mouse.down();
    await page.mouse.move(sel.x + sel.width / 2 + 60, sel.y + sel.height / 2 + 40, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => Math.round((await page.locator('.odt-obj[data-name="Pen 1"] .obj-box').boundingBox()).x - before.x)).toBe(60);
    await stroke(page, [[100, 190], [520, 190], [520, 240], [100, 240], [100, 192]]);
    await page.keyboard.press('Delete');
    await expect.poll(async () => (await frames(page)).map((f) => f.name).sort()).toEqual(['Pen 1']);
    // Ink to Shape: a rough rectangle becomes a rectangle shape, a straight stroke a line.
    await page.locator('[data-command="draw.inkToShape"]').click();
    await page.locator('[data-command="draw.pen"]').click();
    await stroke(page, [[450, 450], [600, 452], [602, 550], [452, 548], [450, 455]]);
    await stroke(page, [[150, 600], [400, 610]]);
    await expect.poll(async () => (await frames(page)).filter((f) => f.kind !== 'ink').map((f) => f.element).sort()).toEqual(['draw:custom-shape', 'draw:line']);
    const rect = await page.evaluate(() => { let a = null; window.odtEditor.editor.view.state.doc.descendants((n) => { if (n.attrs?.element === 'draw:custom-shape') a = n.attrs; return true; }); return a.parts[0].a['draw:type']; });
    expect(rect).toBe('rectangle');
    await page.locator('[data-command="draw.select"]').click();
    await expect(page.locator('.ink-layer')).toBeHidden();
    await settled(page);
    const rt = await roundTrip(page, 'ink.odt');
    expect(rt.diff).toBe(null);
    expect(rt.content).toMatch(/<draw:path draw:style-name="gr\d+" draw:name="Pen 1" text:anchor-type="paragraph" draw:z-index="\d+" svg:x="[\d.-]+cm" svg:y="[\d.-]+cm" svg:width="[\d.]+cm" svg:height="[\d.]+cm" svg:viewBox="0 0 \d+ \d+" svg:d="M[^"]+"/);
    if (soffice) {
      const lo = libreOfficeResave(rt.file);
      expect(lo['content.xml']).toMatch(/<draw:path [^>]*draw:name="Pen 1"/);
    }
  });

  test('Drawing Canvas, Add Pen, Ink Replay, round trip', async ({ page }) => {
    await typeText(page, 'Before the canvas.');
    await page.keyboard.press('Enter');
    await page.locator('[role=tab][data-tab="draw"]').click();
    await page.locator('[data-command="draw.drawingCanvas"]').click();
    await expect(page.locator('.odt-obj.kind-canvas')).toHaveCount(1);
    expect(await page.evaluate(() => window.odtEditor.store.get().drawTool)).toBe('pen');
    const cv = await page.locator('.odt-obj.kind-canvas .obj-box').boundingBox();
    const pg = await page.locator('.page-bgs .pg').first().boundingBox();
    const at = (x, y) => [cv.x - pg.x + x, cv.y - pg.y + y];
    await stroke(page, [at(30, 30), at(80, 60), at(140, 40)]);
    await stroke(page, [at(30, 120), at(200, 130)]);
    await expect.poll(async () => (await frames(page))[0].parts).toEqual(['draw:rect', 'draw:path', 'draw:path']);
    await expect(page.locator('.odt-obj.kind-ink')).toHaveCount(0);
    // Add Pen saves the current pen; the saved pen can be chosen again.
    await run(page, 'draw.penColour', '#0070c0');
    await run(page, 'draw.addPenPen');
    await run(page, 'draw.penColour', '#00b050');
    await run(page, 'draw.usePen', 0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.endsWith(':settings')))).inkPens.pen.colour)).toBe('#0070c0');
    // Ink Replay redraws the strokes in order.
    await run(page, 'draw.inkReplay');
    await expect(page.locator('.ink-replay-bar')).toBeVisible();
    await expect(page.locator('.ink-replay-bar')).toHaveCount(0, { timeout: 6000 });
    // The eraser removes a stroke from the canvas but not the canvas.
    await page.locator('[data-command="draw.eraser"]').click();
    const box = await page.locator('.odt-obj.kind-canvas .obj-box').boundingBox();
    await page.mouse.move(box.x + 100, box.y + 115);
    await page.mouse.down();
    await page.mouse.move(box.x + 100, box.y + 140, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => (await frames(page))[0].parts).toEqual(['draw:rect', 'draw:path']);
    await page.locator('[data-command="draw.select"]').click();
    await settled(page);
    const rt = await roundTrip(page, 'canvas.odt');
    expect(rt.diff).toBe(null);
    expect(rt.content).toMatch(/<draw:g draw:style-name="gr\d+" draw:name="Drawing Canvas 1" text:anchor-type="paragraph" draw:z-index="\d+"><draw:rect draw:style-name="gr\d+" draw:name="Canvas background"/);
    if (soffice) {
      const lo = libreOfficeResave(rt.file);
      expect(lo['content.xml']).toContain('<draw:g');
      expect(lo['content.xml']).toMatch(/<draw:path [^>]*svg:d=/);
    }
  });

  test('pressure from a pen makes a filled, variable-width stroke', async ({ page }) => {
    await typeText(page, 'Pressure.');
    await run(page, 'draw.pen');
    const pg = await page.locator('.page-bgs .pg').first().boundingBox();
    await page.evaluate(({ x, y }) => {
      const layer = document.querySelector('.ink-layer');
      const ev = (type, i, p) => layer.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: 'pen', pressure: p, button: 0, clientX: x + 150 + i * 30, clientY: y + 300 + (i % 2) * 15 }));
      ev('pointerdown', 0, 0.2);
      for (let i = 1; i < 8; i++) ev('pointermove', i, 0.2 + i * 0.1);
      ev('pointerup', 8, 0.9);
    }, { x: pg.x, y: pg.y });
    await expect(page.locator('.odt-obj.kind-ink')).toHaveCount(1);
    const g = await page.evaluate(() => { let a = null; window.odtEditor.editor.view.state.doc.descendants((n) => { if (n.attrs?.kind === 'ink') a = n.attrs; return true; }); return { gp: a.auto.props['style:graphic-properties'].a, d: a.frameAttrs['svg:d'] }; });
    expect(g.gp['draw:fill']).toBe('solid');
    expect(g.d).toMatch(/Z$/);
    const rt = await roundTrip(page, 'pressure.odt');
    expect(rt.diff).toBe(null);
  });
});
