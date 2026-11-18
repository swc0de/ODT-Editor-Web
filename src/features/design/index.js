/** Design tab: Document Formatting and Page Background. */
import { defineCommands } from '../define.js';
import { applyTheme, applyStyleSet, applyColours, applyFonts, applySpacing, setAsDefault, setPageColour, setPageBorders, setWatermark, pageBackground, WATERMARKS } from './apply.js';
import { watermarkDialog, pageBordersDialog } from '../../ui/layout-dialogs.js';
import { t } from '../../i18n/index.js';

const canEdit = (c) => !!c.editor && c.state.editingMode !== 'viewing';

export const commands = defineCommands('design', {
  themes: { icon: 'themes', isEnabled: canEdit, run: (c, id) => { if (typeof id === 'string') applyTheme(c, id); } },
  resetTheme: { isEnabled: canEdit, run: (c) => applyTheme(c, 'classic') },
  styleSet: { keywords: ['style set'], isEnabled: canEdit, run: (c, id) => applyStyleSet(c, typeof id === 'string' ? id : 'default') },
  colours: { icon: 'colours', isEnabled: canEdit, run: (c, id) => { if (typeof id === 'string') applyColours(c, id); } },
  fonts: { icon: 'fonts', isEnabled: canEdit, run: (c, id) => { if (typeof id === 'string') applyFonts(c, id); } },
  paragraphSpacing: { icon: 'paragraph-spacing', isEnabled: canEdit, run: (c, id) => { if (typeof id === 'string') applySpacing(c, id); } },
  effects: { icon: 'effects' },
  setAsDefault: { icon: 'set-default', isEnabled: canEdit, run: (c) => { setAsDefault(c); c.ui.toast?.(t('design.defaultSaved')); } },
  watermark: { icon: 'watermark', isEnabled: canEdit, run: (c, id) => { const w = WATERMARKS.find(([k]) => k === id); if (w) setWatermark(c, { kind: 'text', text: w[1], colour: '#c0c0c0', font: 'Carlito', semi: true, layout: 'diagonal' }); } },
  customWatermark: {
    isEnabled: canEdit,
    run: async (c) => {
      const res = await watermarkDialog({ addPicture: c.ui.addPicture });
      if (res === undefined) return;
      setWatermark(c, res);
    },
  },
  removeWatermark: { isEnabled: canEdit, run: (c) => setWatermark(c, null) },
  pageColour: { icon: 'page-colour', isEnabled: canEdit, run: (c, colour) => { const col = typeof colour === 'string' ? colour : c.state.lastPageColour; c.store.set({ lastPageColour: col }); setPageColour(c, col); } },
  pageColourNone: { isEnabled: canEdit, run: (c) => setPageColour(c, null) },
  pageBorders: { icon: 'page-borders', isEnabled: canEdit, run: async (c) => { const res = await pageBordersDialog(pageBackground(c)); if (res !== undefined) setPageBorders(c, res); } },
});

export const ribbon = {
  id: 'design',
  keytip: 'G',
  groups: [
    {
      id: 'documentFormatting', icon: 'themes',
      controls: [
        { t: 'large', cmd: 'themes', menu: [{ custom: 'themeGallery' }, '-', 'resetTheme'] },
        { t: 'gallery', id: 'styleSets', cmd: 'styleSet' },
        { t: 'large', cmd: 'colours', menu: [{ custom: 'themeColours' }] },
        { t: 'large', cmd: 'fonts', menu: [{ custom: 'themeFonts' }] },
        { t: 'col', items: [{ cmd: 'paragraphSpacing', menu: [{ custom: 'paragraphSpacingPresets' }] }, { cmd: 'effects', menu: [{ custom: 'effectsGallery' }] }, { cmd: 'setAsDefault' }] },
      ],
    },
    {
      id: 'pageBackground', icon: 'page-colour',
      controls: [
        { t: 'large', cmd: 'watermark', menu: [{ custom: 'watermarkGallery' }, '-', 'customWatermark', 'removeWatermark'] },
        { t: 'large', cmd: 'pageColour', label: 'label.design.pageColour', menu: [{ custom: 'colourPalette', cmd: 'pageColour' }, '-', 'pageColourNone'] },
        { t: 'large', cmd: 'pageBorders', label: 'label.design.pageBorders' },
      ],
    },
  ],
};

export function register(registry) { registry.register(commands); }
