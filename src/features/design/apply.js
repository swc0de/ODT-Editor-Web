/**
 * Design tab: document-wide formatting through the named styles (themes,
 * style sets, colours, fonts, paragraph spacing, set as default) and the
 * page background (watermark, page colour, page borders). Every change is
 * one undoable step.
 */
import { fontworkGeometry } from '../../core/shapes.js';
import { editState } from '../../core/state-step.js';
import { ensureStyles, findStyle, ownFormatting, setStyleFormatting } from '../../core/style-edit.js';
import { mergeAuto } from '../../core/odt/styles.js';
import { updatePageLayouts } from '../../core/page-setup.js';
import { isWatermark } from '../../layout/page-model.js';
import { bodyView, sections, masterChain, PAGE_KEYS } from '../layout/sections.js';
import { setSetting } from '../../core/settings.js';

const TP = 'style:text-properties';
const PP = 'style:paragraph-properties';

export const COLOUR_SETS = {
  classic: { title: '#000000', heading: '#0f4761', subtitle: '#595959', swatches: ['#0e2841', '#156082', '#e97132', '#196b24', '#0f9ed5', '#a02b93'] },
  harbour: { title: '#1b3a57', heading: '#2e6f9e', subtitle: '#5b7590', swatches: ['#1b3a57', '#2e6f9e', '#5aa0c8', '#f0b44c', '#d9643a', '#6c8a3a'] },
  meadow: { title: '#2f4f2f', heading: '#4f7f3f', subtitle: '#6b7f5b', swatches: ['#2f4f2f', '#4f7f3f', '#8db255', '#e3c84a', '#b5651d', '#5f8fae'] },
  ember: { title: '#5a1e0e', heading: '#b8471d', subtitle: '#8a5a48', swatches: ['#5a1e0e', '#b8471d', '#e58e2e', '#f2c14e', '#7a3b69', '#3f6e8c'] },
  ink: { title: '#111111', heading: '#444444', subtitle: '#666666', swatches: ['#111111', '#444444', '#777777', '#aaaaaa', '#c0392b', '#2c7fb8'] },
  dune: { title: '#5b4636', heading: '#a0763a', subtitle: '#8c7a66', swatches: ['#5b4636', '#a0763a', '#d4b483', '#c1666b', '#48a9a6', '#4b5d67'] },
};
export const FONT_SETS = {
  carlito: ['Carlito', 'Carlito'],
  caladea: ['Caladea', 'Carlito'],
  sans: ['Liberation Sans', 'Liberation Sans'],
  serif: ['Liberation Serif', 'Liberation Serif'],
  contrast: ['Liberation Sans', 'Liberation Serif'],
  bookish: ['Caladea', 'Caladea'],
};
export const THEMES = {
  classic: { colours: 'classic', fonts: 'carlito' },
  harbour: { colours: 'harbour', fonts: 'sans' },
  meadow: { colours: 'meadow', fonts: 'caladea' },
  ember: { colours: 'ember', fonts: 'serif' },
  ink: { colours: 'ink', fonts: 'contrast' },
  dune: { colours: 'dune', fonts: 'bookish' },
};
export const SPACING = {
  default: { after: '0.282cm', before: null, lh: '115%' },
  none: { after: '0cm', before: null, lh: '100%' },
  compact: { after: '0.141cm', before: null, lh: '100%' },
  tight: { after: '0.212cm', before: null, lh: '106%' },
  open: { after: '0.353cm', before: '0.212cm', lh: '115%' },
  relaxed: { after: '0.212cm', before: null, lh: '150%' },
  double: { after: '0.282cm', before: null, lh: '200%' },
};

const HEADINGS = ['Heading_20_1', 'Heading_20_2', 'Heading_20_3'];
const RESET = { 'fo:font-weight': null, 'fo:color': null, 'fo:background-color': null, 'fo:letter-spacing': null, 'fo:text-transform': null };
const RESET_P = { 'fo:text-align': null, 'fo:border-bottom': null, 'fo:padding-bottom': null, 'fo:background-color': null };

/** Style sets (Design gallery): changes to Title and the headings. */
export const STYLE_SETS = {
  default: (cs) => ({ Title: { text: { ...RESET, 'fo:color': cs.title }, para: RESET_P }, H: { text: { ...RESET, 'fo:color': cs.heading }, para: RESET_P } }),
  basic: () => ({ Title: { text: { ...RESET, 'fo:font-weight': 'bold', 'fo:color': '#000000' }, para: RESET_P }, H: { text: { ...RESET, 'fo:font-weight': 'bold', 'fo:color': '#000000' }, para: RESET_P } }),
  elegant: () => ({ Title: { text: { ...RESET, 'style:font-name': 'Caladea', 'fo:color': '#404040', 'fo:letter-spacing': '0.05cm' }, para: RESET_P }, H: { text: { ...RESET, 'style:font-name': 'Caladea', 'fo:color': '#806000' }, para: RESET_P } }),
  formal: () => ({ Title: { text: { ...RESET, 'style:font-name': 'Liberation Serif', 'fo:color': '#000000' }, para: { ...RESET_P, 'fo:text-align': 'center' } }, H: { text: { ...RESET, 'style:font-name': 'Liberation Serif', 'fo:color': '#000000' }, para: RESET_P } }),
  lines: () => ({ Title: { text: { ...RESET, 'fo:color': '#000000' }, para: { ...RESET_P, 'fo:border-bottom': '1pt solid #000000', 'fo:padding-bottom': '0.1cm' } }, H: { text: { ...RESET, 'fo:color': '#000000' }, para: { ...RESET_P, 'fo:border-bottom': '0.5pt solid #999999', 'fo:padding-bottom': '0.05cm' } } }),
  minimal: () => ({ Title: { text: { ...RESET, 'fo:color': '#595959' }, para: RESET_P }, H: { text: { ...RESET, 'fo:color': '#595959' }, para: RESET_P } }),
  shaded: () => ({ Title: { text: { ...RESET, 'fo:color': '#ffffff' }, para: { ...RESET_P, 'fo:background-color': '#156082' } }, H: { text: { ...RESET, 'fo:color': '#156082' }, para: RESET_P } }),
};

function patchStyle(st, family, name, { text = {}, para = {} }) {
  const own = ownFormatting(st, family, name) || { styleAttrs: {}, props: {} };
  const auto = mergeAuto(own, null) || { styleAttrs: {}, props: {} };
  const apply = (key, change) => {
    if (!Object.keys(change).length) return;
    const p = auto.props[key] ? { ...auto.props[key], a: { ...auto.props[key].a } } : { a: {} };
    for (const [k, v] of Object.entries(change)) { if (v == null) delete p.a[k]; else p.a[k] = v; }
    if (Object.keys(p.a).length || p.c) auto.props[key] = p; else delete auto.props[key];
  };
  apply(TP, text);
  if (family === 'paragraph') apply(PP, para);
  setStyleFormatting(st, family, name, auto);
}

function setDefaultFont(st, font) {
  st.commonStyles = {
    ...st.commonStyles,
    c: (st.commonStyles.c || []).map((t) => {
      if (typeof t === 'string' || t.n !== 'style:default-style' || t.a['style:family'] !== 'paragraph') return t;
      const d = structuredClone(t);
      d.c = d.c || [];
      let tp = d.c.find((x) => x.n === 'style:text-properties');
      if (!tp) { tp = { n: 'style:text-properties', a: {} }; d.c.push(tp); }
      tp.a['style:font-name'] = font;
      return d;
    }),
  };
}

function ensureFontFaces(st, names) {
  const have = new Set((st.fontFaces || []).map((f) => f.a['style:name']));
  const add = names.filter((n) => n && !have.has(n)).map((n) => ({ n: 'style:font-face', a: { 'style:name': n, 'svg:font-family': /\s/.test(n) ? `'${n}'` : n } }));
  if (add.length) st.fontFaces = [...(st.fontFaces || []), ...add];
}

/** Applies { Title, H (headings), Subtitle, Normal } patches and fonts as one step. */
function restyle(c, patches, { headingFont = null, bodyFont = null } = {}) {
  editState(bodyView(c), c.session.state, ['commonStyles', 'fontFaces'], (st) => {
    ensureStyles(st, 'paragraph', ['Title', 'Subtitle', 'Standard', ...HEADINGS]);
    ensureFontFaces(st, [headingFont, bodyFont]);
    if (patches.Title) patchStyle(st, 'paragraph', 'Title', patches.Title);
    if (patches.Subtitle) patchStyle(st, 'paragraph', 'Subtitle', patches.Subtitle);
    if (patches.H) for (const h of HEADINGS) patchStyle(st, 'paragraph', h, patches.H);
    if (patches.Normal) patchStyle(st, 'paragraph', 'Standard', patches.Normal);
    if (headingFont) {
      for (const n of ['Title', 'Subtitle', ...HEADINGS]) patchStyle(st, 'paragraph', n, { text: { 'style:font-name': headingFont } });
      if (findStyle(st, 'paragraph', 'Heading')) patchStyle(st, 'paragraph', 'Heading', { text: { 'style:font-name': headingFont } });
    }
    if (bodyFont) { setDefaultFont(st, bodyFont); patchStyle(st, 'paragraph', 'Standard', { text: { 'style:font-name': bodyFont } }); }
  });
  c.store.set({ designSet: null });
}

export const applyColours = (c, id) => {
  const cs = COLOUR_SETS[id] || COLOUR_SETS.classic;
  restyle(c, { Title: { text: { 'fo:color': cs.title } }, Subtitle: { text: { 'fo:color': cs.subtitle } }, H: { text: { 'fo:color': cs.heading } } });
  c.store.set({ designColours: id });
};
export const applyFonts = (c, id) => {
  const [hf, bf] = FONT_SETS[id] || FONT_SETS.carlito;
  restyle(c, {}, { headingFont: hf, bodyFont: bf });
  c.store.set({ designFonts: id });
};
export const applyTheme = (c, id) => {
  const th = THEMES[id] || THEMES.classic;
  const cs = COLOUR_SETS[th.colours];
  const [hf, bf] = FONT_SETS[th.fonts];
  restyle(c, { Title: { text: { 'fo:color': cs.title } }, Subtitle: { text: { 'fo:color': cs.subtitle } }, H: { text: { 'fo:color': cs.heading } } }, { headingFont: hf, bodyFont: bf });
  c.store.set({ designTheme: id, designColours: th.colours, designFonts: th.fonts });
};
export const applyStyleSet = (c, id) => {
  const cs = COLOUR_SETS[c.state.designColours] || COLOUR_SETS.classic;
  restyle(c, (STYLE_SETS[id] || STYLE_SETS.default)(cs));
  c.store.set({ designSet: id });
};
export const applySpacing = (c, id) => {
  const sp = SPACING[id] || SPACING.default;
  restyle(c, { Normal: { para: { 'fo:margin-bottom': sp.after, 'fo:margin-top': sp.before, 'fo:line-height': sp.lh } } });
  c.store.set({ designSpacing: id });
};

/** Set as Default: the document's main styles become the styles of new documents. */
export function setAsDefault(c) {
  const st = c.session.state;
  const keep = new Set(['Standard', 'Title', 'Subtitle', 'Heading', ...HEADINGS]);
  const trees = (st.commonStyles?.c || []).filter((t) => typeof t !== 'string' && ((t.n === 'style:style' && t.a['style:family'] === 'paragraph' && keep.has(t.a['style:name'])) || (t.n === 'style:default-style' && t.a['style:family'] === 'paragraph')));
  setSetting('defaultStyles', JSON.stringify({ trees, fontFaces: st.fontFaces || [] }));
}

// ------------------------------------------------------------ page background

const allMasters = (c) => [...new Set(sections(c).flatMap((s) => masterChain(c.session.state, s.master)))];

export function setPageColour(c, colour) {
  editState(bodyView(c), c.session.state, PAGE_KEYS, (st) => updatePageLayouts(st, allMasters(c), () => ({
    attrs: colour ? { 'fo:background-color': colour, 'draw:fill': 'solid', 'draw:fill-color': colour } : { 'fo:background-color': null, 'draw:fill': null, 'draw:fill-color': null },
  })));
}

/** Page borders: { style, width, colour, shadow, applyTo } or null to remove. */
export function setPageBorders(c, b) {
  const masters = b?.applyTo === 'section' ? masterChain(c.session.state, sections(c).find((s) => { const h = bodyView(c).state.selection.head; return h >= s.start && h <= s.end; })?.master) : allMasters(c);
  editState(bodyView(c), c.session.state, PAGE_KEYS, (st) => updatePageLayouts(st, masters, () => ({
    attrs: {
      'fo:border': b ? `${b.width} ${b.style} ${b.colour}` : null,
      'fo:border-top': null, 'fo:border-bottom': null, 'fo:border-left': null, 'fo:border-right': null,
      'fo:padding': b ? '0.5cm' : null,
      'style:shadow': b?.shadow ? '#808080 0.18cm 0.18cm' : null,
    },
  })));
}

/** Current page colour / borders of the first page style (for the dialogs). */
export function pageBackground(c) {
  const st = c.session.state;
  const name = sections(c)[0]?.master;
  const m = (st.masterStyles?.c || []).find((x) => x.a?.['style:name'] === name);
  const l = (st.stylesAutoStyles?.c || []).find((x) => x.n === 'style:page-layout' && x.a['style:name'] === m?.a['style:page-layout-name']);
  return (l?.c || []).find((x) => x.n === 'style:page-layout-properties')?.a || {};
}

/**
 * Watermark: a fontwork text shape (or a washed-out picture) in every page
 * style's header, as LibreOffice writes it. spec = { kind: 'text', text,
 * colour, font, semi, layout: 'diagonal'|'horizontal' } | { kind: 'image',
 * path, width, height } | null (remove).
 */
export function setWatermark(c, spec) {
  const masters = allMasters(c);
  if (spec) for (const m of masters) c.ui.hf.ensurePart(m, 'header', 'right');
  editState(bodyView(c), c.session.state, PAGE_KEYS, (st) => {
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
  });
}

export const WATERMARKS = [
  ['confidential', 'CONFIDENTIAL'], ['doNotCopy', 'DO NOT COPY'], ['draft', 'DRAFT'], ['sample', 'SAMPLE'], ['urgent', 'URGENT'], ['asap', 'ASAP'],
];
