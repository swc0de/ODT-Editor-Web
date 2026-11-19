/**
 * Contextual tabs for drawing objects:
 *   Picture Format (contextual 'picture'): Adjust (corrections, colour,
 *     transparency, change / reset picture), Alt Text, Picture Styles
 *     (gallery, border, effects), Arrange, Size (crop, height, width).
 *   Shape Format (contextual 'shape'): Insert Shapes, Shape Styles (gallery,
 *     fill, outline, effects), WordArt Styles (text fill / outline), Text
 *     (align text, add / edit text), Alt Text, Arrange, Size.
 */
import { defineCommands } from '../define.js';
import { withGraphic, withRotation, withSize, sizeOf, altTextOf, withAltText, graphicProps, cm, imageAttrs, originOf, wrapOf } from '../../core/objects.js';
import { sel, hasObj, hasKind, update, gpOf, styleIndex } from './shared.js';
import { arrangeCommands, arrangeGroup, moreLayoutOptions } from './arrange.js';
import { altTextDialog, wordArtTextDialog } from '../../ui/object-dialogs.js';
import { naturalSize } from '../../ui/objects.js';
import { toPx } from '../../layout/units.js';

const CM = 96 / 2.54;
const isPic = hasKind('image');
const isShape = hasKind('shape', 'textbox', 'wordart', 'line');
const isTextual = hasKind('shape', 'textbox', 'wordart');

// ------------------------------------------------------------ presets

/** Picture Styles: graphic properties for the picture frame. */
export const PICTURE_STYLES = {
  plain: { 'fo:border': 'none', 'style:shadow': 'none', 'fo:padding': null },
  simpleFrameWhite: { 'fo:border': '6pt solid #ffffff', 'style:shadow': '#808080 0.1cm 0.1cm', 'fo:padding': null },
  simpleFrameBlack: { 'fo:border': '6pt solid #000000', 'style:shadow': 'none', 'fo:padding': null },
  thickMatteBlack: { 'fo:border': '12pt solid #262626', 'style:shadow': 'none', 'fo:padding': null },
  thinBorderGrey: { 'fo:border': '1pt solid #7f7f7f', 'style:shadow': 'none', 'fo:padding': null },
  doubleFrameBlack: { 'fo:border': '4.5pt double #000000', 'style:shadow': 'none', 'fo:padding': null },
  dropShadow: { 'fo:border': 'none', 'style:shadow': '#404040 0.18cm 0.18cm', 'fo:padding': null },
  softShadow: { 'fo:border': '0.75pt solid #d9d9d9', 'style:shadow': '#a6a6a6 0.08cm 0.12cm', 'fo:padding': null },
  accentFrame: { 'fo:border': '3pt solid #156082', 'style:shadow': 'none', 'fo:padding': null },
  orangeFrame: { 'fo:border': '3pt solid #e97132', 'style:shadow': '#808080 0.1cm 0.1cm', 'fo:padding': null },
};

/** Shape Styles: [fill, outline colour, text colour, shadow?] per accent × variant. */
const ACCENTS = ['#000000', '#156082', '#e97132', '#196b24', '#0f9ed5', '#a02b93', '#4ea72e'];
const LIGHT = { '#000000': '#d9d9d9', '#156082': '#c1e4f5', '#e97132': '#fbe3d6', '#196b24': '#c1f0c8', '#0f9ed5': '#caeefb', '#a02b93': '#f2cfee', '#4ea72e': '#daf2d0' };
const darker = (hex) => `#${[1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * 0.7).toString(16).padStart(2, '0')).join('')}`;
export const SHAPE_STYLES = Object.fromEntries(ACCENTS.flatMap((acc, i) => [
  [`outline${i}`, { fill: '#ffffff', stroke: acc, text: '#000000', width: '1pt' }],
  [`fill${i}`, { fill: acc, stroke: darker(acc), text: '#ffffff', width: '0.75pt' }],
  [`light${i}`, { fill: LIGHT[acc], stroke: acc, text: '#000000', width: '1pt' }],
  [`intense${i}`, { fill: acc, stroke: 'none', text: '#ffffff', width: '0pt', shadow: true }],
]));

export function shapeStyleGraphic(id) {
  const s = SHAPE_STYLES[id];
  return {
    'draw:fill': 'solid', 'draw:fill-color': s.fill,
    'draw:stroke': s.stroke === 'none' ? 'none' : 'solid', 'svg:stroke-color': s.stroke === 'none' ? null : s.stroke, 'svg:stroke-width': s.stroke === 'none' ? null : cm(toPx(s.width)),
    'draw:shadow': s.shadow ? 'visible' : 'hidden', 'draw:shadow-offset-x': s.shadow ? '0.1cm' : null, 'draw:shadow-offset-y': s.shadow ? '0.1cm' : null, 'draw:shadow-color': s.shadow ? '#808080' : null, 'draw:shadow-opacity': s.shadow ? '60%' : null,
  };
}

/** Text colour for every run of a body (shape text). */
export function bodyWithColour(body, colour) {
  const set = (n) => {
    if (n.type === 'text') {
      const marks = (n.marks || []).filter((m) => m.type !== 'textProps');
      const old = (n.marks || []).find((m) => m.type === 'textProps')?.attrs?.auto;
      const auto = structuredClone(old || { styleAttrs: {}, props: {} });
      auto.props['style:text-properties'] = { a: { ...(auto.props['style:text-properties']?.a || {}), 'fo:color': colour } };
      return { ...n, marks: [...marks, { type: 'textProps', attrs: { auto } }] };
    }
    return n.content ? { ...n, content: n.content.map(set) } : n;
  };
  return (body || []).map(set);
}

const WEIGHTS = ['0.25pt', '0.5pt', '0.75pt', '1pt', '1.5pt', '2.25pt', '3pt', '4.5pt', '6pt'];
const wid = (w) => `weight${w.replace('.', '_').replace('pt', '')}`;
const DASHES = { dashSolid: null, dashRound: 'Fine_20_Dotted', dashSquare: 'Dot', dashDash: 'Dash', dashLong: 'Long_20_Dash', dashDot: 'Dash_20_Dot' };
const TRANSPARENCY = [0, 15, 30, 50, 65, 80, 95];
const SHADOWS = {
  shadowNone: null,
  shadowBottomRight: ['0.18cm', '0.18cm'], shadowBottom: ['0cm', '0.18cm'], shadowBottomLeft: ['-0.18cm', '0.18cm'],
  shadowRight: ['0.18cm', '0cm'], shadowTopRight: ['0.18cm', '-0.18cm'],
};

// ------------------------------------------------------------ picture ops

/** Border of a picture (fo:border shorthand) or the outline of a shape. */
function setOutline(c, change) {
  update(c, (a) => {
    const gp = graphicProps(a, styleIndex(c));
    if (a.element === 'draw:frame') {
      const cur = (gp['fo:border'] && gp['fo:border'] !== 'none' ? gp['fo:border'] : '0.75pt solid #000000').split(/\s+/);
      if (change.none) return withGraphic(a, { 'fo:border': 'none' });
      const [w, style, col] = [change.width || cur[0], change.style || (cur[1] === 'none' ? 'solid' : cur[1]), change.colour || cur[2] || '#000000'];
      return withGraphic(a, { 'fo:border': `${w} ${style} ${col}`, 'fo:border-top': null, 'fo:border-bottom': null, 'fo:border-left': null, 'fo:border-right': null });
    }
    if (change.none) return withGraphic(a, { 'draw:stroke': 'none' });
    const g = { 'draw:stroke': gp['draw:stroke'] === 'none' || !gp['draw:stroke'] ? 'solid' : gp['draw:stroke'] };
    if (change.colour) g['svg:stroke-color'] = change.colour;
    if (change.width) g['svg:stroke-width'] = cm(toPx(change.width));
    if ('dash' in change) { g['draw:stroke'] = change.dash ? 'dash' : 'solid'; g['draw:stroke-dash'] = change.dash || null; }
    return withGraphic(a, g);
  });
}

function setFill(c, colour) {
  update(c, (a) => {
    if (a.element === 'draw:frame') return withGraphic(a, colour ? { 'fo:background-color': colour, 'draw:fill': 'solid', 'draw:fill-color': colour } : { 'fo:background-color': 'transparent', 'draw:fill': 'none', 'draw:fill-color': null });
    return withGraphic(a, colour ? { 'draw:fill': 'solid', 'draw:fill-color': colour } : { 'draw:fill': 'none' });
  });
}

function setShadow(c, id) {
  const off = SHADOWS[id];
  update(c, (a) => {
    if (a.element === 'draw:frame') return withGraphic(a, { 'style:shadow': off ? `#808080 ${off[0]} ${off[1]}` : 'none' });
    return withGraphic(a, off ? { 'draw:shadow': 'visible', 'draw:shadow-offset-x': off[0], 'draw:shadow-offset-y': off[1], 'draw:shadow-color': '#808080', 'draw:shadow-opacity': '60%' } : { 'draw:shadow': 'hidden' });
  });
}

const shadowChecked = (id) => (c) => {
  const gp = gpOf(c);
  const s = sel(c);
  if (!s) return false;
  const off = SHADOWS[id];
  if (s.node.attrs.element === 'draw:frame') {
    const v = gp['style:shadow'];
    if (!off) return !v || v === 'none';
    return !!v && v.includes(` ${off[0]} ${off[1]}`);
  }
  if (!off) return gp['draw:shadow'] !== 'visible';
  return gp['draw:shadow'] === 'visible' && gp['draw:shadow-offset-x'] === off[0] && gp['draw:shadow-offset-y'] === off[1];
};

async function changePicture(c) {
  const s = sel(c);
  if (!s) return;
  const file = await c.ui.pickFile?.('image/*');
  if (!file) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = file.type || 'image/png';
  const path = c.ui.addPicture(bytes, type);
  const nat = await naturalSize(bytes, type);
  update(c, (a) => {
    const { w } = sizeOf(a);
    const h = nat.w ? (w * nat.h) / nat.w : sizeOf(a).h;
    const parts = a.parts.map((p, i) => (p.n === 'draw:image' && i === a.parts.findIndex((q) => q.n === 'draw:image') ? { ...p, a: { ...p.a, 'xlink:href': path, 'draw:mime-type': type } } : p));
    return withGraphic(withSize({ ...a, parts, href: path }, w, h), { 'fo:clip': null });
  });
}

function resetPicture(c, size) {
  update(c, (a) => {
    let next = withGraphic(a, {
      'draw:luminance': null, 'draw:contrast': null, 'draw:red': null, 'draw:green': null, 'draw:blue': null, 'draw:gamma': null,
      'draw:color-mode': null, 'draw:image-opacity': null, 'style:mirror': null, 'fo:clip': null, 'fo:border': null, 'style:shadow': null,
    });
    const nat = sel(c)?.ov?.natural;
    if (size && nat) {
      const { w: maxW } = { w: c.ui.docArea.model?.first?.bodyWidth || 600 };
      const k = Math.min(1, maxW / nat.w);
      next = withSize(next, nat.w * k, nat.h * k);
    }
    if (size && next.frameAttrs['draw:transform']) next = withRotation(next, 0, wrapOf(next, styleIndex(c)) === 'inline' ? { x: 0, y: 0 } : originOf(next));
    return next;
  });
}

async function editAltText(c) {
  const s = sel(c);
  if (!s) return;
  const r = await altTextDialog(altTextOf(s.node.attrs));
  if (r) update(c, (a) => withAltText(a, r));
}

/** Height / width spins (cm). Pictures keep their proportions. */
const sizeSpin = (dim) => ({
  isEnabled: hasObj,
  run: (c, v) => {
    if (!Number.isFinite(v) || v <= 0) return;
    update(c, (a) => {
      const { w, h } = sizeOf(a);
      const px = v * CM;
      const keep = a.kind === 'image';
      if (dim === 'h') return withSize(a, keep && h ? (w * px) / h : w, px);
      return withSize(a, px, keep && w ? (h * px) / w : h);
    });
  },
});

export function objectSpinValues(c) {
  const s = sel(c);
  if (!s) return {};
  const dom = s.view.nodeDOM(s.pos)?.querySelector?.('.obj-box');
  const k = c.state.zoom / 100;
  let { w, h } = sizeOf(s.node.attrs);
  if (dom && s.node.attrs.kind === 'textbox') h = dom.getBoundingClientRect().height / k;
  const out = { 'pictureFormat.height': h / CM, 'pictureFormat.width': w / CM, 'shapeFormat.height': h / CM, 'shapeFormat.width': w / CM };
  return out;
}

// ------------------------------------------------------------ text in shapes

async function editShapeText(c) {
  const s = sel(c);
  if (!s) return;
  const a = s.node.attrs;
  if (a.kind === 'wordart') {
    const cur = (a.body || []).map((b) => (b.content || []).map((x) => x.text || '').join('')).join('\n');
    const next = await wordArtTextDialog(cur);
    if (next == null) return;
    const marks = a.body?.[0]?.content?.[0]?.marks;
    const body = next.split('\n').map((line) => ({ type: 'paragraph', attrs: a.body?.[0]?.attrs || { styleName: 'Standard' }, ...(line ? { content: [{ type: 'text', text: line, ...(marks ? { marks } : {}) }] } : {}) }));
    update(c, (x) => ({ ...x, body }));
    return;
  }
  if (a.element === 'draw:line') return;
  // Give the shape a text body (if it has none) and put the caret in it.
  if (!a.body?.length || !a.parts.some((p) => p.n === '#body' || p['#body'])) {
    const parts = a.parts.some((p) => p.n === '#body' || p['#body']) ? a.parts : [{ n: '#body' }, ...a.parts];
    update(c, (x) => ({ ...x, parts, body: x.body?.length ? x.body : [{ type: 'paragraph', attrs: { styleName: 'Standard', auto: { styleAttrs: {}, props: { 'style:paragraph-properties': { a: { 'fo:text-align': 'center' } } } } } }] }));
  }
  requestAnimationFrame(() => {
    const s2 = sel(c);
    const dom = s2 && s2.view.nodeDOM(s2.pos);
    const pm = dom?.querySelector('.obj-text .ProseMirror');
    pm?.focus();
  });
}

// ------------------------------------------------------------ commands

const pic = {
  removeBackground: { icon: 'remove-background' },
  corrections: { icon: 'corrections', isEnabled: isPic, menuOnly: true },
  correction: {
    isEnabled: isPic,
    isChecked: () => false,
    run: (c, v) => { if (v && typeof v === 'object') update(c, (a) => withGraphic(a, { 'draw:luminance': v.b ? `${v.b}%` : null, 'draw:contrast': v.c ? `${v.c}%` : null })); },
  },
  pictureColour: { icon: 'colour-picture', isEnabled: isPic, menuOnly: true },
  recolour: {
    isEnabled: isPic,
    run: (c, v) => {
      if (!v || typeof v !== 'object') return;
      update(c, (a) => withGraphic(a, { 'draw:color-mode': v.mode || null, 'draw:red': v.r ? `${v.r}%` : null, 'draw:green': v.g ? `${v.g}%` : null, 'draw:blue': v.b ? `${v.b}%` : null }));
    },
  },
  artisticEffects: { icon: 'artistic-effects' },
  transparency: { icon: 'transparency', isEnabled: isPic, menuOnly: true },
  ...Object.fromEntries(TRANSPARENCY.map((p) => [`transparency${p}`, {
    isEnabled: isPic,
    isChecked: (c) => Math.round(100 - (parseFloat(gpOf(c)['draw:image-opacity'] || '100') || 100)) === p,
    run: (c) => update(c, (a) => withGraphic(a, { 'draw:image-opacity': p ? `${100 - p}%` : null })),
  }])),
  compressPictures: { icon: 'compress' },
  changePicture: { icon: 'change-picture', isEnabled: isPic, run: changePicture },
  resetPicture: { icon: 'reset-picture', isEnabled: isPic, split: true, run: (c) => resetPicture(c, false) },
  resetPictureSize: { isEnabled: isPic, run: (c) => resetPicture(c, true) },
  altText: { icon: 'alt-text', isEnabled: hasObj, run: editAltText },
  pictureStyle: {
    isEnabled: isPic,
    run: (c, id) => { if (PICTURE_STYLES[id]) update(c, (a) => withGraphic(a, { ...PICTURE_STYLES[id], 'fo:border-top': null, 'fo:border-bottom': null, 'fo:border-left': null, 'fo:border-right': null })); },
  },
  pictureBorder: { icon: 'picture-border', isEnabled: isPic, run: (c, colour) => setOutline(c, typeof colour === 'string' ? { colour } : {}) },
  pictureBorderNone: { isEnabled: isPic, run: (c) => setOutline(c, { none: true }) },
  pictureBorderWeight: { isEnabled: isPic, menuOnly: true },
  ...Object.fromEntries(WEIGHTS.map((w) => [`border${wid(w)}`, { label: `cmd.shapeFormat.${wid(w)}`, isEnabled: isPic, run: (c) => setOutline(c, { width: w }) }])),
  pictureEffects: { icon: 'picture-effects', isEnabled: isPic, menuOnly: true },
  ...Object.fromEntries(Object.keys(SHADOWS).map((id) => [id, { label: `cmd.shapeFormat.${id}`, isEnabled: isPic, isChecked: shadowChecked(id), run: (c) => setShadow(c, id) }])),
  pictureLayout: { icon: 'smartart' },
  crop: {
    icon: 'crop', isEnabled: isPic, isChecked: (c) => !!c.state.cropMode,
    run: (c) => {
      const s = sel(c);
      c.store.set({ cropMode: !c.state.cropMode });
      // Re-draw the handles in (or out of) crop mode.
      if (s?.ov?.selected) s.ov.render(s.ov.node);
    },
  },
  cropToShape: { },
  height: { icon: 'height', ...sizeSpin('h') },
  width: { icon: 'width', ...sizeSpin('w') },
  sizeDialog: { isEnabled: hasObj, run: (c) => moreLayoutOptions(c, 2) },
};

const shape = {
  insertShape: { icon: 'shapes', isEnabled: (c) => !!c.editor && c.state.editingMode !== 'viewing', run: (c, id) => c.ui.registry.run('insert.insertShape', id) },
  editShape: { icon: 'edit-shape' },
  drawTextBox: { icon: 'text-box', isEnabled: (c) => !!c.editor && c.state.editingMode !== 'viewing', run: (c) => c.ui.registry.run('insert.textBoxSimple') },
  shapeStyle: {
    isEnabled: isShape,
    run: (c, id) => {
      if (!SHAPE_STYLES[id]) return;
      update(c, (a) => {
        let next = withGraphic(a, shapeStyleGraphic(id));
        if (a.element === 'draw:frame') next = withGraphic(next, { 'fo:background-color': SHAPE_STYLES[id].fill, 'fo:border': SHAPE_STYLES[id].stroke === 'none' ? 'none' : `${SHAPE_STYLES[id].width} solid ${SHAPE_STYLES[id].stroke}` });
        if (a.kind !== 'wordart' && next.body?.length) next = { ...next, body: bodyWithColour(next.body, SHAPE_STYLES[id].text) };
        return next;
      });
    },
  },
  shapeFill: { icon: 'shape-fill', isEnabled: isShape, split: true, run: (c, colour) => setFill(c, typeof colour === 'string' ? colour : c.state.lastShapeFill || '#156082') },
  shapeFillNone: { isEnabled: isShape, run: (c) => setFill(c, null) },
  shapeOutline: { icon: 'shape-outline', isEnabled: isShape, split: true, run: (c, colour) => setOutline(c, { colour: typeof colour === 'string' ? colour : '#000000' }) },
  shapeOutlineNone: { isEnabled: isShape, run: (c) => setOutline(c, { none: true }) },
  outlineWeight: { isEnabled: isShape, menuOnly: true },
  ...Object.fromEntries(WEIGHTS.map((w) => [wid(w), { isEnabled: isShape, run: (c) => setOutline(c, { width: w }) }])),
  outlineDashes: { isEnabled: isShape, menuOnly: true },
  ...Object.fromEntries(Object.entries(DASHES).map(([id, name]) => [id, { isEnabled: isShape, run: (c) => { c.ui.ensureDash?.(name); setOutline(c, { dash: name }); } }])),
  shapeEffects: { icon: 'shape-effects', isEnabled: isShape, menuOnly: true },
  ...Object.fromEntries(Object.keys(SHADOWS).map((id) => [id, { isEnabled: isShape, isChecked: shadowChecked(id), run: (c) => setShadow(c, id) }])),
  textFill: {
    icon: 'text-fill', isEnabled: isTextual, split: true,
    run: (c, colour) => {
      const col = typeof colour === 'string' ? colour : '#000000';
      update(c, (a) => (a.kind === 'wordart' ? withGraphic(a, { 'draw:fill': 'solid', 'draw:fill-color': col }) : { ...a, body: bodyWithColour(a.body, col) }));
    },
  },
  textOutline: {
    icon: 'text-outline', isEnabled: hasKind('wordart'), split: true,
    run: (c, colour) => update(c, (a) => withGraphic(a, { 'draw:stroke': 'solid', 'svg:stroke-color': typeof colour === 'string' ? colour : '#000000' })),
  },
  textOutlineNone: { isEnabled: hasKind('wordart'), run: (c) => update(c, (a) => withGraphic(a, { 'draw:stroke': 'none' })) },
  textEffects: { icon: 'text-effects' },
  alignText: { icon: 'align-text', isEnabled: hasKind('shape', 'textbox'), menuOnly: true },
  ...Object.fromEntries(['top', 'middle', 'bottom'].map((v) => [`alignText${v[0].toUpperCase()}${v.slice(1)}`, {
    isEnabled: hasKind('shape', 'textbox'),
    isChecked: (c) => (gpOf(c)['draw:textarea-vertical-align'] || (sel(c)?.node.attrs.kind === 'textbox' ? 'top' : 'middle')) === v,
    run: (c) => update(c, (a) => withGraphic(a, { 'draw:textarea-vertical-align': v })),
  }])),
  editText: { icon: 'type', isEnabled: isTextual, run: editShapeText },
  createLink: { icon: 'link' },
  altText: { icon: 'alt-text', isEnabled: hasObj, run: editAltText },
  height: { icon: 'height', ...sizeSpin('h') },
  width: { icon: 'width', ...sizeSpin('w') },
  sizeDialog: { isEnabled: hasObj, run: (c) => moreLayoutOptions(c, 2) },
};

export const pictureCommands = defineCommands('pictureFormat', pic);
export const shapeCommands = defineCommands('shapeFormat', shape);

const sizeGroup = (extra = []) => ({
  id: 'size', icon: 'crop', launcher: 'sizeDialog',
  controls: [
    ...extra,
    { t: 'spins', header: 'label.objects.size', items: [{ cmd: 'height', label: 'label.objects.height', unit: 'cm', value: 0, step: 0.1, decimals: 2 }, { cmd: 'width', label: 'label.objects.width', unit: 'cm', value: 0, step: 0.1, decimals: 2 }] },
  ],
});

export const pictureRibbon = {
  id: 'pictureFormat',
  keytip: 'JP',
  contextual: 'picture',
  groups: [
    {
      id: 'adjust', icon: 'corrections',
      controls: [
        { t: 'large', cmd: 'removeBackground', label: 'label.pictureFormat.removeBackground' },
        { t: 'large', cmd: 'corrections', menu: [{ custom: 'correctionsGallery', cmd: 'pictureFormat.correction' }] },
        { t: 'large', cmd: 'pictureColour', label: 'label.pictureFormat.colour', menu: [{ custom: 'recolourGallery', cmd: 'pictureFormat.recolour' }] },
        { t: 'large', cmd: 'artisticEffects', label: 'label.pictureFormat.artisticEffects' },
        { t: 'large', cmd: 'transparency', menu: TRANSPARENCY.map((p) => `transparency${p}`) },
        { t: 'col', items: [{ cmd: 'compressPictures', iconOnly: true }, { cmd: 'changePicture', iconOnly: true }, { cmd: 'resetPicture', iconOnly: true, split: true, menu: ['resetPicture', 'resetPictureSize'] }] },
      ],
    },
    { id: 'accessibility', icon: 'alt-text', controls: [{ t: 'large', cmd: 'altText', label: 'label.objects.altText' }] },
    {
      id: 'pictureStyles', icon: 'picture-border',
      controls: [
        { t: 'gallery', id: 'pictureStyles', cmd: 'pictureStyle' },
        { t: 'col', items: [
          { cmd: 'pictureBorder', split: true, menu: [{ custom: 'colourPalette', cmd: 'pictureFormat.pictureBorder' }, '-', 'pictureBorderNone', { cmd: 'pictureBorderWeight', sub: WEIGHTS.map((w) => `border${wid(w)}`) }] },
          { cmd: 'pictureEffects', menu: Object.keys(SHADOWS) },
          { cmd: 'pictureLayout' },
        ] },
      ],
    },
    { ...arrangeGroup('layout.') },
    sizeGroup([{ t: 'large', cmd: 'crop', split: true, menu: ['crop', 'cropToShape'] }]),
  ],
};

export const shapeRibbon = {
  id: 'shapeFormat',
  keytip: 'JD',
  contextual: 'shape',
  groups: [
    {
      id: 'insertShapes', icon: 'shapes',
      controls: [
        { t: 'gallery', id: 'shapesMini', cmd: 'insertShape' },
        { t: 'col', items: [{ cmd: 'editShape', iconOnly: true }, { cmd: 'drawTextBox', iconOnly: true }, { cmd: 'editText', iconOnly: true }] },
      ],
    },
    {
      id: 'shapeStyles', icon: 'shape-fill',
      controls: [
        { t: 'gallery', id: 'shapeStyles', cmd: 'shapeStyle' },
        { t: 'col', items: [
          { cmd: 'shapeFill', split: true, menu: [{ custom: 'colourPalette', cmd: 'shapeFormat.shapeFill' }, '-', 'shapeFillNone'] },
          { cmd: 'shapeOutline', split: true, menu: [{ custom: 'colourPalette', cmd: 'shapeFormat.shapeOutline' }, '-', 'shapeOutlineNone', { cmd: 'outlineWeight', sub: WEIGHTS.map(wid) }, { cmd: 'outlineDashes', sub: Object.keys(DASHES) }] },
          { cmd: 'shapeEffects', menu: Object.keys(SHADOWS) },
        ] },
      ],
    },
    {
      id: 'wordArtStyles', icon: 'text-fill',
      controls: [
        { t: 'col', items: [
          { cmd: 'textFill', split: true, menu: [{ custom: 'colourPalette', cmd: 'shapeFormat.textFill' }] },
          { cmd: 'textOutline', split: true, menu: [{ custom: 'colourPalette', cmd: 'shapeFormat.textOutline' }, '-', 'textOutlineNone'] },
          { cmd: 'textEffects' },
        ] },
      ],
    },
    { id: 'text', icon: 'align-text', controls: [{ t: 'col', items: [{ cmd: 'alignText', menu: ['alignTextTop', 'alignTextMiddle', 'alignTextBottom'] }, { cmd: 'editText' }, { cmd: 'createLink' }] }] },
    { id: 'accessibility', icon: 'alt-text', controls: [{ t: 'large', cmd: 'altText', label: 'label.objects.altText' }] },
    { ...arrangeGroup('layout.') },
    sizeGroup(),
  ],
};

export const pictureTab = { ribbon: pictureRibbon, register: (registry) => registry.register(pictureCommands) };
export const shapeTab = { ribbon: shapeRibbon, register: (registry) => registry.register(shapeCommands) };

export { arrangeCommands, wrapOf, originOf, imageAttrs };
