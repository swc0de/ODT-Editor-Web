/**
 * Printing (and PDF through the browser's "Save as PDF"): the pages are laid
 * out once more with no gaps between them, then a copy of the page stack is
 * placed in a print-only container. A page range is a window onto that copy;
 * every page size gets its own named @page rule, so landscape sections print
 * landscape. Headings stay h1–h6, so browsers that make a PDF outline from
 * headings give the PDF bookmarks. Comment balloons are left out.
 */
import { h } from './dom.js';

/** "1-3, 5" → [[1,3],[5,5]] (1-based, clamped, merged). Null if invalid. */
export function parseRanges(text, count) {
  const out = [];
  for (const part of String(text).split(/[,;]/).map((x) => x.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)\s*(?:[-–]\s*(\d+))?$/);
    if (!m) return null;
    let a = Number(m[1]);
    let b = m[2] ? Number(m[2]) : a;
    if (a > b) [a, b] = [b, a];
    a = Math.max(1, a);
    b = Math.min(count, b);
    if (a <= b) out.push([a, b]);
  }
  return out.length ? out : null;
}

export function createPrint({ docArea, store, toast, t }) {
  const root = h('div', { id: 'print-root', 'aria-hidden': 'true' });
  const pageCss = h('style', { id: 'print-page-css' });
  document.body.append(root);
  document.head.append(pageCss);

  /** Fills the print container. opts = { range: 'all' | 'current' | 'custom', pages: '1-3' } → page count or 0. */
  async function prepare(opts = {}) {
    await docArea.setPrinting(true);
    const pages = docArea.pages;
    const view = docArea.view;
    const n = pages.length;
    let ranges = [[1, n]];
    if (opts.range === 'current') { const cur = Math.min(n, Math.max(1, store.get().page || 1)); ranges = [[cur, cur]]; }
    if (opts.range === 'custom') ranges = parseRanges(opts.pages || '', n);
    if (!ranges) return 0;
    const stack = view.stack.cloneNode(true);
    stack.style.zoom = '1';
    stack.classList.remove('with-comments', 'side', 'gridlines', 'hide-white');
    for (const x of stack.querySelectorAll('[contenteditable]')) x.removeAttribute('contenteditable');
    for (const x of stack.querySelectorAll('.comments-layer, .ProseMirror-separator, .obj-handles, .ProseMirror-gapcursor')) x.remove();
    for (const x of stack.querySelectorAll('.sp-err, .gr-err, .odt-find, .ra-word')) x.replaceWith(...x.childNodes);
    root.replaceChildren();
    const sizes = new Map();
    let printed = 0;
    // Segments: consecutive pages of the same size in a range share one copy of
    // the stack (pages follow each other with no gaps, so the browser breaks
    // the segment exactly between pages).
    const segments = [];
    for (const [a, b] of ranges) {
      let seg = null;
      for (let i = a - 1; i <= b - 1; i++) {
        const el = view.pageElement(i);
        if (!el) continue;
        const key = `${el.offsetWidth}x${el.offsetHeight}`;
        if (!sizes.has(key)) sizes.set(key, { name: `p${sizes.size}`, w: el.offsetWidth, h: el.offsetHeight });
        if (!seg || seg.key !== key || el.offsetTop !== seg.bottom) { seg = { key, first: el, bottom: el.offsetTop, count: 0 }; segments.push(seg); }
        seg.count++;
        seg.bottom = el.offsetTop + el.offsetHeight;
        printed++;
      }
    }
    segments.forEach((seg, k) => {
      const size = sizes.get(seg.key);
      const copy = k === 0 ? stack : stack.cloneNode(true);
      copy.style.position = 'absolute';
      copy.style.left = `${-seg.first.offsetLeft}px`;
      copy.style.top = `${-seg.first.offsetTop}px`;
      // The copy ends with the segment's last page (anything below would add blank pages).
      copy.style.height = `${seg.bottom}px`;
      copy.style.overflow = 'hidden';
      root.append(h('div', { class: 'print-segment', style: { width: `${size.w}px`, height: `${size.h * seg.count}px`, page: size.name } }, copy));
    });
    pageCss.textContent = [...sizes.values()].map((s) => `@page ${s.name} { size: ${s.w}px ${s.h}px; margin: 0; }`).join('\n')
      + `\n@page { size: ${[...sizes.values()][0]?.w || 794}px ${[...sizes.values()][0]?.h || 1123}px; margin: 0; }`;
    return printed;
  }

  async function cleanup() {
    root.replaceChildren();
    pageCss.textContent = '';
    await docArea.setPrinting(false);
  }

  /** Print (or Save as PDF) with the browser's print dialog. */
  async function run(opts = {}) {
    const n = await prepare(opts);
    if (!n) { toast(t('print.badRange')); await cleanup(); return false; }
    const done = () => { removeEventListener('afterprint', done); cleanup(); };
    addEventListener('afterprint', done);
    if (opts.pdf) toast(t('print.pdfHint'));
    window.print();
    return true;
  }

  return { run, prepare, cleanup, root };
}
