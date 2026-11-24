/**
 * Watermarks (Design ▸ Watermark): a fontwork text shape (or a washed-out
 * picture) in every page style's header, as LibreOffice writes it. Used by
 * the Design tab and by the DOCX reader (Word's VML watermarks).
 *
 * spec = { kind: 'text', text, colour, font, semi, layout: 'diagonal'|'horizontal' }
 *      | { kind: 'image', path, width, height } | null (remove)
 */
import { fontworkGeometry } from './shapes.js';
import { isWatermark } from '../layout/page-model.js';

/** Applies a watermark to the headers of some page styles (the header parts must exist). */
export function applyWatermark(st, masters, spec) {
    const styleName = 'Mgrwm1';
    const textStyle = 'MPwm1';
    let autos = (st.stylesAutoStyles?.c || []).filter((t) => typeof t === 'string' || (t.a?.['style:name'] !== styleName && t.a?.['style:name'] !== textStyle));
    let shape = null;
    if (spec?.kind === 'text') {
      const diag = spec.layout !== 'horizontal';
      autos = [...autos,
        { n: 'style:style', a: { 'style:name': styleName, 'style:family': 'graphic' }, c: [{ n: 'style:graphic-properties', a: { 'draw:stroke': 'none', 'draw:fill': 'solid', 'draw:fill-color': spec.colour, 'draw:auto-grow-height': 'false', 'draw:auto-grow-width': 'false', 'draw:opacity': spec.semi ? '50%' : '100%', 'draw:shadow': 'hidden', 'style:run-through': 'background', 'style:wrap': 'run-through', 'style:number-wrapped-paragraphs': 'no-limit', 'style:vertical-pos': 'middle', 'style:vertical-rel': 'page-content', 'style:horizontal-pos': 'center', 'style:horizontal-rel': 'page-content' } }] },
        { n: 'style:style', a: { 'style:name': textStyle, 'style:family': 'paragraph' }, c: [{ n: 'style:text-properties', a: { 'style:font-name': spec.font || 'Carlito' } }] }];
      shape = {
        n: 'draw:custom-shape',
        a: { 'text:anchor-type': 'char', 'draw:z-index': '0', 'draw:name': 'PowerPlusWaterMarkObject1', 'draw:style-name': styleName, 'draw:text-style-name': textStyle, 'svg:width': diag ? '16cm' : '15cm', 'svg:height': diag ? '4cm' : '3cm', ...(diag ? { 'draw:transform': 'rotate (0.785398163397448)' } : {}) },
        c: [{ n: 'text:p', a: {}, c: [spec.text] }, fontworkGeometry('shape')],
      };
    } else if (spec?.kind === 'image') {
      autos = [...autos, { n: 'style:style', a: { 'style:name': styleName, 'style:family': 'graphic' }, c: [{ n: 'style:graphic-properties', a: { 'draw:stroke': 'none', 'draw:fill': 'none', 'draw:image-opacity': '30%', 'draw:luminance': '50%', 'draw:contrast': '-70%', 'style:run-through': 'background', 'style:wrap': 'run-through', 'style:vertical-pos': 'middle', 'style:vertical-rel': 'page-content', 'style:horizontal-pos': 'center', 'style:horizontal-rel': 'page-content' } }] }];
      shape = {
        n: 'draw:frame',
        a: { 'text:anchor-type': 'char', 'draw:z-index': '0', 'draw:name': 'PowerPlusWaterMarkObject2', 'draw:style-name': styleName, 'svg:width': `${spec.width}cm`, 'svg:height': `${spec.height}cm` },
        c: [{ n: 'draw:image', a: { 'xlink:href': spec.path, 'xlink:type': 'simple', 'xlink:show': 'embed', 'xlink:actuate': 'onLoad' } }],
      };
    }
    st.stylesAutoStyles = { ...st.stylesAutoStyles, c: autos };
    const set = new Set(masters);
    st.masterStyles = {
      ...st.masterStyles,
      c: (st.masterStyles?.c || []).map((m) => {
        if (typeof m === 'string' || m.n !== 'style:master-page' || !set.has(m.a['style:name'])) return m;
        return {
          ...m,
          c: (m.c || []).map((p) => {
            if (typeof p === 'string' || !/^style:header(-left|-first)?$/.test(p.n)) return p;
            let paras = (p.c || []).map((x) => (typeof x === 'string' ? x : { ...x, c: (x.c || []).filter((y) => !isWatermark(y)) }));
            if (shape) {
              const i = paras.findIndex((x) => typeof x !== 'string' && (x.n === 'text:p' || x.n === 'text:h'));
              if (i >= 0) paras[i] = { ...paras[i], c: [structuredClone(shape), ...(paras[i].c || [])] };
              else paras = [{ n: 'text:p', a: { 'text:style-name': 'Header' }, c: [structuredClone(shape)] }, ...paras];
            }
            return { ...p, c: paras };
          }),
        };
      }),
    };
}

/** The watermark of a header tree as a spec (text watermarks), or null. */
export function watermarkSpec(st, tree) {
  for (const p of tree?.c || []) {
    if (typeof p === 'string') continue;
    for (const x of p.c || []) {
      if (!isWatermark(x) || x.n !== 'draw:custom-shape') continue;
      const style = (st.stylesAutoStyles?.c || []).find((t) => typeof t !== 'string' && t.a?.['style:name'] === x.a['draw:style-name']);
      const gp = (style?.c || []).find((t) => t.n === 'style:graphic-properties')?.a || {};
      const textStyle = (st.stylesAutoStyles?.c || []).find((t) => typeof t !== 'string' && t.a?.['style:name'] === x.a['draw:text-style-name']);
      const font = (textStyle?.c || []).find((t) => t.n === 'style:text-properties')?.a?.['style:font-name'] || 'Carlito';
      const text = (x.c || []).filter((t) => typeof t !== 'string' && t.n === 'text:p').map((t) => (t.c || []).filter((y) => typeof y === 'string').join('')).join(' ');
      return { kind: 'text', text, colour: gp['draw:fill-color'] || '#c0c0c0', font, semi: gp['draw:opacity'] === '50%', layout: /rotate/.test(x.a['draw:transform'] || '') ? 'diagonal' : 'horizontal' };
    }
  }
  return null;
}
