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
  expect(slow.length).toBeLessThanOrEqual(N * 0.1);
  expect(await page.evaluate(() => window.odtEditor.editor.getDoc().textContent.includes('a'.repeat(40)))).toBe(true);
});
