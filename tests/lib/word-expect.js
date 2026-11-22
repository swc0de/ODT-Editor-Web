/**
 * Expected paragraph formatting of a Word document, resolved from its own
 * XML the way Word does (independently of the app's reader): docDefaults →
 * paragraph style chain (w:basedOn, Normal at the root; toggle properties
 * flip along the chain) → numbering level indents → direct formatting.
 *
 * Loaded into the test page as a classic script: defines window.wordExpect(files),
 * files = { 'word/document.xml': text, 'word/styles.xml': text, 'word/numbering.xml': text }.
 * Returns one entry per body paragraph (table cells included, in order; TOC
 * field paragraphs left out; a page break inside a paragraph splits it, as
 * the editor does):
 *   { text, style, font, sizePt, bold, italic, color, beforePt, afterPt,
 *     line, lineRule, leftIn, rightIn, firstIn, hangingIn, jc, numId, ilvl }
 */
(function () {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const kids = (el, name) => (el ? [...el.children].filter((c) => !name || c.localName === name) : []);
  const kid = (el, name) => kids(el, name)[0] || null;
  const wa = (el, n) => (el ? el.getAttributeNS(W, n) ?? el.getAttribute(`w:${n}`) : null);
  const on = (el) => (el ? !['0', 'false', 'off'].includes(String(wa(el, 'val') ?? 'true')) : null);
  const parse = (t) => (t ? new DOMParser().parseFromString(t, 'application/xml') : null);

  window.wordExpect = function wordExpect(files) {
    const doc = parse(files['word/document.xml']);
    const styles = parse(files['word/styles.xml']);
    const numbering = parse(files['word/numbering.xml']);
    const theme = parse(files['word/theme/theme1.xml']);
    const themeFont = (which) => {
      if (!theme) return null;
      const f = [...theme.getElementsByTagName('*')].find((e) => e.localName === `${which}Font`);
      return kid(f, 'latin')?.getAttribute('typeface') || null;
    };
    // The last definition of a style id wins.
    const styleById = new Map();
    for (const s of kids(styles?.documentElement, 'style')) styleById.set(wa(s, 'styleId'), s);
    const defaultPara = [...styleById.values()].find((s) => wa(s, 'type') === 'paragraph' && wa(s, 'default') === '1');
    const dd = kid(styles?.documentElement, 'docDefaults');

    const base = () => ({ font: null, sizePt: 10, bold: false, italic: false, color: null, beforePt: 0, afterPt: 0, line: 240, lineRule: 'auto', left: 0, right: 0, first: 0, hanging: 0, jc: 'left' });
    const applyR = (o, rPr, toggle) => {
      if (!rPr) return;
      const f = kid(rPr, 'rFonts');
      if (f) { const th = wa(f, 'asciiTheme'); o.font = th ? themeFont(/^major/.test(th) ? 'major' : 'minor') : (wa(f, 'ascii') || o.font); }
      const sz = wa(kid(rPr, 'sz'), 'val');
      if (sz) o.sizePt = Number(sz) / 2;
      for (const [k, prop] of [['b', 'bold'], ['i', 'italic']]) {
        const v = on(kid(rPr, k));
        if (v == null) continue;
        // Toggle properties flip along the style chain; direct formatting sets them.
        o[prop] = toggle ? (v ? !o[`${prop}Style`] : false) : v;
        if (toggle) o[`${prop}Style`] = o[prop];
      }
      const c = wa(kid(rPr, 'color'), 'val');
      if (c) o.color = c === 'auto' ? null : `#${c.toLowerCase()}`;
    };
    const applyP = (o, pPr) => {
      if (!pPr) return;
      const sp = kid(pPr, 'spacing');
      if (sp) {
        if (wa(sp, 'before') != null) o.beforePt = Number(wa(sp, 'before')) / 20;
        if (wa(sp, 'after') != null) o.afterPt = Number(wa(sp, 'after')) / 20;
        if (wa(sp, 'line') != null) { o.line = Number(wa(sp, 'line')); o.lineRule = wa(sp, 'lineRule') || 'auto'; }
      }
      const ind = kid(pPr, 'ind');
      if (ind) {
        for (const [k, p] of [['left', 'left'], ['start', 'left'], ['right', 'right'], ['end', 'right']]) if (wa(ind, k) != null) o[p] = Number(wa(ind, k));
        if (wa(ind, 'hanging') != null) { o.hanging = Number(wa(ind, 'hanging')); o.first = 0; } else if (wa(ind, 'firstLine') != null) { o.first = Number(wa(ind, 'firstLine')); o.hanging = 0; }
      }
      const jc = wa(kid(pPr, 'jc'), 'val');
      if (jc) o.jc = jc === 'start' ? 'left' : jc === 'end' ? 'right' : jc;
      const np = kid(pPr, 'numPr');
      if (np) { o.numId = wa(kid(np, 'numId'), 'val'); o.ilvl = Number(wa(kid(np, 'ilvl'), 'val') || 0); }
    };
    const chain = (id) => {
      const out = [];
      const seen = new Set();
      for (let cur = id; cur && !seen.has(cur);) { seen.add(cur); const s = styleById.get(cur); if (!s) break; out.unshift(s); cur = wa(kid(s, 'basedOn'), 'val'); }
      return out;
    };
    const levelInd = (numId, ilvl) => {
      const num = kids(numbering?.documentElement, 'num').find((n) => wa(n, 'numId') === numId);
      const absId = wa(kid(num, 'abstractNumId'), 'val');
      const abs = kids(numbering?.documentElement, 'abstractNum').find((a) => wa(a, 'abstractNumId') === absId);
      const lvl = kids(abs, 'lvl').find((l) => Number(wa(l, 'ilvl')) === ilvl);
      return kid(kid(lvl, 'pPr'), 'ind');
    };

    const out = [];
    let inToc = 0;
    const para = (p) => {
      const instr = [...p.getElementsByTagName('*')].filter((e) => e.localName === 'instrText').map((e) => e.textContent).join('');
      const fcs = [...p.getElementsByTagName('*')].filter((e) => e.localName === 'fldChar').map((e) => wa(e, 'fldCharType'));
      if (/^\s*TOC\b/.test(instr) || inToc) {
        // TOC field paragraphs (begin … end) are not body text.
        for (const t of fcs) { if (t === 'begin') inToc++; else if (t === 'end') inToc--; }
        return;
      }
      const pPr = kid(p, 'pPr');
      const id = wa(kid(pPr, 'pStyle'), 'val') || wa(defaultPara, 'styleId');
      const o = base();
      applyR(o, kid(kid(dd, 'rPrDefault'), 'rPr'), false);
      applyP(o, kid(kid(dd, 'pPrDefault'), 'pPr'));
      for (const s of chain(id)) { applyP(o, kid(s, 'pPr')); applyR(o, kid(s, 'rPr'), true); }
      // Numbering (direct, else from the style): its indents, under direct ones.
      const own = kid(pPr, 'numPr');
      let numId = own ? wa(kid(own, 'numId'), 'val') : o.numId;
      const ilvl = own ? Number(wa(kid(own, 'ilvl'), 'val') || 0) : o.ilvl || 0;
      if (numId === '0') numId = null;
      if (numId) { const li = levelInd(numId, ilvl); if (li) applyP(o, { children: [li] }); }
      applyP(o, pPr);
      const text = [...p.getElementsByTagName('*')].filter((e) => e.localName === 't').map((e) => e.textContent).join('');
      const entry = {
        text, style: id, font: o.font, sizePt: o.sizePt, bold: !!o.bold, italic: !!o.italic, color: o.color,
        beforePt: o.beforePt, afterPt: o.afterPt, line: o.line, lineRule: o.lineRule,
        leftIn: o.left / 1440, rightIn: o.right / 1440, firstIn: o.first / 1440, hangingIn: o.hanging / 1440, jc: o.jc,
        numId: numId || null, ilvl: numId ? ilvl : null,
      };
      const breaks = [...p.getElementsByTagName('*')].filter((e) => e.localName === 'br' && wa(e, 'type') === 'page').length;
      for (let i = 0; i <= breaks; i++) out.push(i ? { ...entry, text: '' } : entry);
    };
    const walk = (el) => {
      for (const c of kids(el)) {
        if (c.localName === 'p') para(c);
        else if (c.localName === 'tc') {
          // A vertically merged continuation cell shows nothing (its content isn't displayed).
          const vm = kid(kid(c, 'tcPr'), 'vMerge');
          if (vm && (wa(vm, 'val') || 'continue') !== 'restart') continue;
          walk(c);
        } else if (['tbl', 'tr', 'sdt', 'sdtContent', 'customXml'].includes(c.localName)) walk(c);
      }
    };
    walk(kid(doc.documentElement, 'body'));
    return out;
  };
}());
