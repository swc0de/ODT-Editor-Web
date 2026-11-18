/**
 * In-ribbon galleries: the Home ▸ Styles gallery (each tile rendered in its
 * own style, as in reference/home-document-dark.png) and Design ▸ Style Sets.
 */
import { h } from '../dom.js';

/** Built-in paragraph/character styles shown in the Styles gallery. */
export const STYLE_GALLERY = [
  { id: 'normal', name: 'style.normal', sample: 'AaBbCcDd', css: { fontSize: '12.5px' } },
  { id: 'noSpacing', name: 'style.noSpacing', sample: 'AaBbCcDd', css: { fontSize: '12.5px' } },
  { id: 'heading1', name: 'style.heading1', sample: 'AaBbCc', css: { fontSize: '21px', color: '#0f4761' } },
  { id: 'title', name: 'style.title', sample: 'AaBb', css: { fontSize: '30px', lineHeight: '33px', letterSpacing: '-0.5px', marginTop: '-1px' } },
  { id: 'heading2', name: 'style.heading2', sample: 'AaBbCcD', css: { fontSize: '17px', color: '#0f4761' } },
  { id: 'subtitle', name: 'style.subtitle', sample: 'AaBbCcD', css: { fontSize: '17px', color: '#595959' } },
  { id: 'heading3', name: 'style.heading3', sample: 'AaBbCcDd', css: { fontSize: '13px', color: '#0f4761' } },
  { id: 'subtleEmphasis', name: 'style.subtleEmphasis', sample: 'AaBbCcDd', css: { fontSize: '11px', fontStyle: 'italic', color: '#404040' } },
  { id: 'emphasis', name: 'style.emphasis', sample: 'AaBbCcDd', css: { fontSize: '11px', fontStyle: 'italic' } },
  { id: 'intenseEmphasis', name: 'style.intenseEmphasis', sample: 'AaBbCcDd', css: { fontSize: '11px', fontStyle: 'italic', color: '#0f4761' } },
  { id: 'strong', name: 'style.strong', sample: 'AaBbCcDd', css: { fontSize: '11px', fontWeight: '700' } },
  { id: 'quote', name: 'style.quote', sample: 'AaBbCcDd', css: { fontSize: '11px', fontStyle: 'italic', color: '#404040', textAlign: 'center' } },
  { id: 'intenseQuote', name: 'style.intenseQuote', sample: 'AaBbCcDd', css: { fontSize: '11px', fontStyle: 'italic', color: '#0f4761', textAlign: 'center' } },
  { id: 'listParagraph', name: 'style.listParagraph', sample: 'AaBbCcDd', css: { fontSize: '11px', paddingLeft: '8px' } },
];

export const STYLE_SET_GALLERY = [
  { id: 'default', name: 'styleSet.default', title: { color: '#000' }, heading: { color: '#0f4761' } },
  { id: 'basic', name: 'styleSet.basic', title: { color: '#000', fontWeight: '700' }, heading: { color: '#000', fontWeight: '700' } },
  { id: 'elegant', name: 'styleSet.elegant', title: { color: '#404040', fontFamily: 'Caladea, serif', letterSpacing: '1px' }, heading: { color: '#806000', fontFamily: 'Caladea, serif' } },
  { id: 'formal', name: 'styleSet.formal', title: { color: '#000', fontFamily: '"Liberation Serif", serif', textAlign: 'center' }, heading: { color: '#000', fontFamily: '"Liberation Serif", serif' } },
  { id: 'lines', name: 'styleSet.lines', title: { color: '#000', borderBottom: '1px solid #000' }, heading: { color: '#000', borderBottom: '1px solid #999' } },
  { id: 'minimal', name: 'styleSet.minimal', title: { color: '#595959', fontWeight: '300' }, heading: { color: '#595959' } },
  { id: 'shaded', name: 'styleSet.shaded', title: { color: '#fff', background: '#156082' }, heading: { color: '#156082' } },
];

/** Renders one style tile (the preview box plus its name). */
export function styleTile(item, t) {
  return h('span', { class: 'gal-tile-inner' },
    h('span', { class: 'gal-preview' }, h('span', { class: 'gal-sample', style: { fontFamily: 'var(--doc-font)', ...item.css } }, item.sample)),
    h('span', { class: 'gal-name' }, t(item.name)));
}

/** Renders one Style Set thumbnail (a tiny page with title, heading and text lines). */
export function styleSetTile(item, t) {
  return h('span', { class: 'gal-tile-inner set' },
    h('span', { class: 'set-page' },
      h('span', { class: 'set-title', style: item.title }, t('style.title')),
      h('span', { class: 'set-heading', style: item.heading }, t('style.heading1')),
      h('span', { class: 'set-lines' }, h('i'), h('i'), h('i'))),
    h('span', { class: 'gal-name sr-only' }, t(item.name)));
}
