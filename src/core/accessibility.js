/**
 * Check Accessibility: problems a screen-reader user or a reader with low
 * vision would hit.
 *   errors   — pictures and objects without alternative text, tables
 *              without a header row
 *   warnings — headings that skip a level, empty headings, hard-to-read
 *              text contrast, no document title
 *   tips     — a long document without headings
 * Each issue: { severity, rule, pos, label }
 */
import { altTextOf } from './objects.js';
import { metaTitle } from './document.js';

const hex = (c) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(c || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const lum = (rgb) => {
  const [r, g, b] = rgb.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** WCAG contrast ratio of two #rrggbb colours. */
export function contrast(a, b) {
  const x = hex(a);
  const y = hex(b);
  if (!x || !y) return 21;
  const [l1, l2] = [lum(x), lum(y)].sort((p, q) => q - p);
  return (l1 + 0.05) / (l2 + 0.05);
}

const textProps = (marks) => marks.find((m) => m.type.name === 'textProps')?.attrs.auto?.props?.['style:text-properties']?.a || {};

export function checkAccessibility(state, { pages = 1, pageColour = '#ffffff' } = {}) {
  const doc = state.doc;
  const issues = [];
  let lastLevel = 0;
  let headings = 0;
  const contrastSeen = new Set();
  doc.descendants((n, pos, parent) => {
    const name = n.type.name;
    if (name === 'frame') {
      const alt = altTextOf(n.attrs);
      const decorative = n.attrs.frameAttrs?.['loext:decorative'] === 'true';
      if (!decorative && !alt.title && !alt.desc && n.attrs.kind !== 'textbox') {
        issues.push({ severity: 'error', rule: 'altText', pos, label: n.attrs.frameAttrs?.['draw:name'] || n.attrs.kind });
      }
      return false;
    }
    if (name === 'table') {
      const first = n.firstChild;
      if (!first?.attrs.header && n.childCount > 1) issues.push({ severity: 'error', rule: 'tableHeader', pos, label: n.attrs.name || '' });
      return true;
    }
    if (name === 'index') return false;
    if (name === 'heading') {
      headings++;
      const level = n.attrs.level;
      if (!n.textContent.trim()) issues.push({ severity: 'warning', rule: 'emptyHeading', pos, label: `Heading ${level}` });
      else if (lastLevel && level > lastLevel + 1) issues.push({ severity: 'warning', rule: 'headingOrder', pos, label: n.textContent.trim().slice(0, 60) });
      lastLevel = level;
    }
    if (n.isText) {
      const a = textProps(n.marks);
      const colour = a['fo:color'];
      if (colour && colour !== 'auto') {
        const bg = a['fo:background-color'] && a['fo:background-color'] !== 'transparent' ? a['fo:background-color'] : pageColour;
        if (contrast(colour, bg) < 4.5) {
          const key = `${colour}|${bg}|${parent ? doc.resolve(pos).before(1) : pos}`;
          if (!contrastSeen.has(key)) { contrastSeen.add(key); issues.push({ severity: 'warning', rule: 'contrast', pos, label: n.text.slice(0, 40) }); }
        }
      }
    }
    return true;
  });
  if (!metaTitle(state)) issues.push({ severity: 'warning', rule: 'title', pos: null, label: '' });
  if (!headings && pages >= 3) issues.push({ severity: 'tip', rule: 'useHeadings', pos: null, label: '' });
  return issues;
}
