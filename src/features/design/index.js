/** Design tab: Document Formatting and Page Background (wired up in M5). */
import { defineCommands } from '../define.js';

export const commands = defineCommands('design', {
  themes: { icon: 'themes' },
  resetTheme: {},
  styleSet: { keywords: ['style set'] },
  colours: { icon: 'colours' },
  fonts: { icon: 'fonts' },
  paragraphSpacing: { icon: 'paragraph-spacing' },
  effects: { icon: 'effects' },
  setAsDefault: { icon: 'set-default' },
  watermark: { icon: 'watermark' },
  customWatermark: {},
  removeWatermark: {},
  pageColour: { icon: 'page-colour' },
  pageColourNone: {},
  pageBorders: { icon: 'page-borders' },
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
        { t: 'large', cmd: 'pageColour', label: 'label.design.pageColour', menu: [{ custom: 'colourPalette' }, '-', 'pageColourNone'] },
        { t: 'large', cmd: 'pageBorders', label: 'label.design.pageBorders' },
      ],
    },
  ],
};

export function register(registry) { registry.register(commands); }
