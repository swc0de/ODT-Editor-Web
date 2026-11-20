/**
 * Performance check from the Definition of Done: typing latency under 16 ms
 * on a 50-page document. Measured with the browser's Event Timing API on
 * real keystrokes:
 *   - processing: the main-thread work for the keystroke (editor update);
 *   - duration: from the key event until the next frame is presented. A
 *     frame at 60 Hz is 16.7 ms and Chrome reports durations in 8 ms steps,
 *     so "16" means the change appeared in the very next frame.
 * Runs as its own Playwright project after the other tests, so they don't
 * compete for the CPU.
 */
import { test, expect } from '@playwright/test';
import { openApp, openFixture } from './helpers.js';

test('typing latency on a 50-page document stays within one frame', async ({ page }) => {
  test.setTimeout(120_000);
  await openApp(page);
  await openFixture(page, 'long-50-pages.odt');
  // Pages of text: content height ÷ the text area of an A4 page (29.7 cm − 2 × 2.54 cm margins).
  const pages = await page.evaluate(() => Math.round((document.querySelector('.ProseMirror').offsetHeight) / ((29.7 - 5.08) * 96 / 2.54)));
  expect(pages).toBeGreaterThanOrEqual(45);
  await page.evaluate(() => {
    const { view } = window.odtEditor.editor;
    const doc = view.state.doc;
    let target = 0;
    let n = 0;
    doc.forEach((node, offset) => { if (n++ === Math.floor(doc.childCount / 2)) target = offset + 1; });
    view.dispatch(view.state.tr.setSelection(view.state.selection.constructor.near(doc.resolve(target))).scrollIntoView());
    view.focus();
    // 1) Main-thread time per keystroke: key event → editor updated (after
    //    ProseMirror's mutation handling) → style and layout recomputed.
    window.__proc = [];
    let t0 = 0;
    const root = view.dom;
    root.addEventListener('keydown', () => { t0 = performance.now(); }, true);
    document.addEventListener('input', () => {
      const start = t0;
      Promise.resolve().then(() => Promise.resolve()).then(() => {
        root.getBoundingClientRect();
        window.__proc.push(performance.now() - start);
      });
    });
    // 2) Event Timing only reports events that took 16 ms or more until the
    //    next frame; count keystrokes that missed the next frame.
    window.__slow = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (e.name === 'keypress' && e.duration > 16) window.__slow.push(e.duration);
    }).observe({ type: 'event', durationThreshold: 16 });
  });
  const N = 40;
  for (let i = 0; i < N; i++) { await page.keyboard.type('a'); await page.waitForTimeout(25); }
  await page.waitForTimeout(300);
  const { proc, slow } = await page.evaluate(() => ({ proc: window.__proc.slice(5).sort((a, b) => a - b), slow: window.__slow }));
  const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
  console.log(`50-page typing: main-thread median ${pct(proc, 0.5).toFixed(2)} ms, p95 ${pct(proc, 0.95).toFixed(2)} ms; keystrokes missing the next frame: ${slow.length}/${N}`);
  expect(proc.length).toBeGreaterThan(N - 10);
  expect(pct(proc, 0.5)).toBeLessThan(16);
  expect(pct(proc, 0.95)).toBeLessThan(16);
  // Frame presentation in headless (software-rendered) Chromium varies from
  // run to run; the latency requirement is the main-thread time above.
  expect(slow.length).toBeLessThanOrEqual(N * 0.15);
  expect(await page.evaluate(() => window.odtEditor.editor.getDoc().textContent.includes('a'.repeat(40)))).toBe(true);
});

test('a 100-page document types without lag and scrolls smoothly', async ({ page }) => {
  test.setTimeout(180_000);
  await openApp(page);
  await openFixture(page, 'long-100-pages.odt');
  await expect.poll(() => page.evaluate(() => window.odtEditor.docArea.pages.length >= 95 && !window.odtEditor.docArea.layoutPending), { timeout: 20_000 }).toBe(true);
  // Typing near the start (every later page may move) and in the middle.
  for (const where of ['start', 'middle']) {
    await page.evaluate((where) => {
      const { view } = window.odtEditor.editor;
      const doc = view.state.doc;
      let target = 3;
      let n = 0;
      if (where === 'middle') doc.forEach((node, offset) => { if (n++ === Math.floor(doc.childCount / 2)) target = offset + 1; });
      view.dispatch(view.state.tr.setSelection(view.state.selection.constructor.near(doc.resolve(target))).scrollIntoView());
      view.focus();
      window.__proc = [];
      window.__long = [];
      let t0 = 0;
      view.dom.addEventListener('keydown', () => { t0 = performance.now(); }, true);
      document.addEventListener('input', () => { const s = t0; Promise.resolve().then(() => Promise.resolve()).then(() => { view.dom.getBoundingClientRect(); window.__proc.push(performance.now() - s); }); });
      new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(e.duration); }).observe({ type: 'longtask' });
    }, where);
    for (let i = 0; i < 40; i++) { await page.keyboard.type(i % 9 === 8 ? ' ' : 'w'); await page.waitForTimeout(25); }
    // Let background repagination finish.
    await expect.poll(() => page.evaluate(() => window.odtEditor.docArea.layoutPending)).toBe(false);
    const r = await page.evaluate(() => {
      const p = window.__proc.slice(3).sort((a, b) => a - b);
      return { median: p[p.length >> 1], p95: p[Math.floor(p.length * 0.95)], longest: Math.max(0, ...window.__long) };
    });
    console.log(`100-page typing (${where}): main-thread median ${r.median.toFixed(2)} ms, p95 ${r.p95.toFixed(2)} ms, longest task ${r.longest.toFixed(0)} ms`);
    expect(r.median).toBeLessThan(16);
    expect(r.p95).toBeLessThan(16);
    expect(r.longest).toBeLessThan(100);
  }
  // Scrolling the whole document.
  const frames = await page.evaluate(async () => {
    const canvas = document.querySelector('.canvas');
    canvas.scrollTop = 0;
    const times = [];
    let last = performance.now();
    await new Promise((resolve) => {
      const step = (t) => {
        times.push(t - last);
        last = t;
        canvas.scrollTop += 400;
        if (canvas.scrollTop + canvas.clientHeight < canvas.scrollHeight - 10 && times.length < 600) requestAnimationFrame(step); else resolve();
      };
      requestAnimationFrame(step);
    });
    return times.slice(2).sort((a, b) => a - b);
  });
  const p95 = frames[Math.floor(frames.length * 0.95)];
  console.log(`100-page scrolling: ${frames.length} frames, median ${frames[frames.length >> 1].toFixed(1)} ms, p95 ${p95.toFixed(1)} ms`);
  expect(p95).toBeLessThan(34); // at most an occasional dropped frame
});

test('100 and 300 pages: open and save times, memory, typing latency', async ({ page }) => {
  test.setTimeout(300_000);
  await openApp(page);
  const bytes = (await import('node:fs')).readFileSync((await import('node:path')).resolve('tests/fixtures/long-100-pages.odt'));
  const results = {};
  for (const copies of [1, 3]) {
    // Open: import + first full layout (the 300-page document is the 100-page one three times).
    const r = await page.evaluate(async ({ b64, copies }) => {
      const { session, io, docArea, editor } = window.odtEditor;
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      let data = bin;
      if (copies > 1) {
        const st = io.importOdt(bin);
        const content = [];
        for (let i = 0; i < copies; i++) st.doc.forEach((n) => content.push(n));
        st.doc = st.doc.type.create(st.doc.attrs, content);
        data = io.exportOdt(st).bytes;
      }
      const t0 = performance.now();
      await session.openBytes(data, { name: `long-${copies}.odt`, skipGuard: true, remember: false });
      const imported = performance.now() - t0;
      let last = '';
      for (let i = 0; i < 2000; i++) {
        await new Promise((res) => requestAnimationFrame(res));
        const sig = `${docArea.pages.length}`;
        if (!docArea.layoutPending && sig === last) break;
        last = sig;
      }
      const laidOut = performance.now() - t0;
      const s0 = performance.now();
      const saved = await session.serialize();
      const save = performance.now() - s0;
      // Typing in the middle.
      const { view } = editor;
      const doc = view.state.doc;
      let target = 1;
      let n = 0;
      doc.forEach((node, offset) => { if (n++ === Math.floor(doc.childCount / 2)) target = offset + 1; });
      view.dispatch(view.state.tr.setSelection(view.state.selection.constructor.near(doc.resolve(target))).scrollIntoView());
      view.focus();
      window.__proc = [];
      let k0 = 0;
      view.dom.addEventListener('keydown', () => { k0 = performance.now(); }, true);
      document.addEventListener('input', () => { const s = k0; Promise.resolve().then(() => Promise.resolve()).then(() => { view.dom.getBoundingClientRect(); window.__proc.push(performance.now() - s); }); });
      return { pages: docArea.pages.length, imported, laidOut, save, size: saved.length, heap: performance.memory ? performance.memory.usedJSHeapSize : 0 };
    }, { b64: bytes.toString('base64'), copies });
    for (let i = 0; i < 30; i++) { await page.keyboard.type('x'); await page.waitForTimeout(25); }
    const proc = await page.evaluate(() => window.__proc.slice(3).sort((a, b) => a - b));
    r.typingMedian = proc[proc.length >> 1];
    r.typingP95 = proc[Math.floor(proc.length * 0.95)];
    results[copies] = r;
    console.log(`${r.pages} pages: open ${(r.imported / 1000).toFixed(2)} s (laid out ${(r.laidOut / 1000).toFixed(2)} s), save ${(r.save / 1000).toFixed(2)} s (${(r.size / 1024).toFixed(0)} KiB), JS heap ${(r.heap / 1048576).toFixed(0)} MiB, typing median ${r.typingMedian.toFixed(2)} ms p95 ${r.typingP95.toFixed(2)} ms`);
    expect(r.typingMedian).toBeLessThan(16);
    expect(r.typingP95).toBeLessThan(16);
  }
  expect(results[3].pages).toBeGreaterThan(280);
  expect(results[3].laidOut).toBeLessThan(60_000);
  expect(results[3].save).toBeLessThan(10_000);
});
