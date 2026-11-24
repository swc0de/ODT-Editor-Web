/**
 * MathML (the editor's equations) → OMML (Word's equations, m:oMath), so
 * Word shows and edits equations as equations. Covers the presentation
 * elements the equation editor produces: tokens, rows, fractions, scripts,
 * radicals, under/over scripts (n-ary operators), fences, tables and text.
 * Anything else falls back to its text.
 */

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const NARY = new Set(['∑', '∏', '∐', '∫', '∬', '∭', '∮', '⋃', '⋂', '⋁', '⋀']);

const run = (text, plain = false) => (text ? `<m:r>${plain ? '<m:rPr><m:sty m:val="p"/></m:rPr>' : ''}<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/></w:rPr><m:t xml:space="preserve">${esc(text)}</m:t></m:r>` : '');
const kids = (el) => [...el.children];
const e = (inner) => `<m:e>${inner}</m:e>`;

function conv(el) {
  if (!el) return '';
  const name = el.localName;
  const k = kids(el);
  switch (name) {
    case 'math': case 'mrow': case 'mstyle': case 'mpadded': case 'mphantom': case 'semantics': case 'menclose':
      return name === 'semantics' ? conv(k[0]) : convRow(k);
    case 'annotation': case 'annotation-xml': return '';
    case 'mi': return run(el.textContent, el.textContent.length > 1 || el.getAttribute('mathvariant') === 'normal');
    case 'mn': return run(el.textContent, true);
    case 'mo': return run(el.textContent, true);
    case 'mtext': case 'ms': return run(el.textContent, true);
    case 'mspace': return run(' ', true);
    case 'mfrac': return `<m:f>${el.getAttribute('linethickness') === '0' ? '<m:fPr><m:type m:val="noBar"/></m:fPr>' : ''}<m:num>${conv(k[0])}</m:num><m:den>${conv(k[1])}</m:den></m:f>`;
    case 'msqrt': return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/>${e(k.map(conv).join(''))}</m:rad>`;
    case 'mroot': return `<m:rad><m:deg>${conv(k[1])}</m:deg>${e(conv(k[0]))}</m:rad>`;
    case 'msup': return `<m:sSup>${e(conv(k[0]))}<m:sup>${conv(k[1])}</m:sup></m:sSup>`;
    case 'msub': return `<m:sSub>${e(conv(k[0]))}<m:sub>${conv(k[1])}</m:sub></m:sSub>`;
    case 'msubsup': return `<m:sSubSup>${e(conv(k[0]))}<m:sub>${conv(k[1])}</m:sub><m:sup>${conv(k[2])}</m:sup></m:sSubSup>`;
    case 'munderover': case 'munder': case 'mover': {
      const base = k[0];
      const under = name === 'mover' ? null : k[1];
      const over = name === 'munderover' ? k[2] : name === 'mover' ? k[1] : null;
      if (base?.localName === 'mo' && NARY.has(base.textContent.trim())) {
        // An n-ary operator: its argument is what follows (Word puts it inside).
        const chr = base.textContent.trim();
        const rest = [];
        for (let n = el.nextElementSibling; n; n = n.nextElementSibling) rest.push(n);
        el.__consumed = rest;
        for (const r of rest) r.__skip = true;
        return `<m:nary><m:naryPr><m:chr m:val="${esc(chr)}"/>${under ? '' : '<m:subHide m:val="1"/>'}${over ? '' : '<m:supHide m:val="1"/>'}</m:naryPr><m:sub>${under ? conv(under) : ''}</m:sub><m:sup>${over ? conv(over) : ''}</m:sup>${e(rest.map((r) => { r.__skip = false; const x = conv(r); r.__skip = true; return x; }).join(''))}</m:nary>`;
      }
      if (name === 'munder') return `<m:limLow>${e(conv(base))}<m:lim>${conv(under)}</m:lim></m:limLow>`;
      if (name === 'mover') {
        const acc = over?.localName === 'mo' && over.textContent.trim().length === 1 ? over.textContent.trim() : null;
        if (acc) return `<m:acc><m:accPr><m:chr m:val="${esc(acc)}"/></m:accPr>${e(conv(base))}</m:acc>`;
        return `<m:limUpp>${e(conv(base))}<m:lim>${conv(over)}</m:lim></m:limUpp>`;
      }
      return `<m:limLow>${e(`<m:limUpp>${e(conv(base))}<m:lim>${conv(over)}</m:lim></m:limUpp>`)}<m:lim>${conv(under)}</m:lim></m:limLow>`;
    }
    case 'mfenced': {
      const open = el.getAttribute('open') ?? '(';
      const close = el.getAttribute('close') ?? ')';
      return `<m:d><m:dPr><m:begChr m:val="${esc(open)}"/><m:endChr m:val="${esc(close)}"/></m:dPr>${k.map((x) => e(conv(x))).join('')}</m:d>`;
    }
    case 'mtable': return `<m:m>${k.map((row) => `<m:mr>${kids(row).map((cell) => e(conv(cell))).join('')}</m:mr>`).join('')}</m:m>`;
    case 'mtr': case 'mtd': return k.map(conv).join('');
    default: return run(el.textContent, true);
  }
}

/** A row of siblings, skipping those an n-ary operator took as its argument. */
function convRow(nodes) {
  let out = '';
  for (const n of nodes) { if (n.__skip) continue; out += conv(n); }
  return out;
}

/** MathML text (a formula object's content.xml) → <m:oMath>…</m:oMath>, or '' if it can't be read. */
export function mathmlToOmml(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const math = [...doc.getElementsByTagName('*')].find((x) => x.localName === 'math');
  if (!math || doc.getElementsByTagName('parsererror').length) return '';
  const body = conv(math);
  return body ? `<m:oMath>${body}</m:oMath>` : '';
}
