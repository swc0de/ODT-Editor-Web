/**
 * Font availability. Bundled fonts (Carlito, Caladea, Liberation *) are
 * embedded as WOFF2 @font-face rules by the build. System fonts are listed
 * via the Local Font Access API when permitted (M4), else a curated list.
 */
import { BUNDLED_FONTS, DEFAULT_BODY_FONT } from '../config.js';

export const CURATED_FONTS = Object.freeze([
  'Aptos', 'Arial', 'Calibri', 'Cambria', 'Candara', 'Consolas', 'Constantia', 'Corbel', 'Courier New',
  'DejaVu Sans', 'DejaVu Serif', 'Georgia', 'Helvetica', 'Noto Sans', 'Noto Serif', 'Segoe UI',
  'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana',
]);

let ctx = null;
function measure(font) {
  ctx = ctx || document.createElement('canvas').getContext('2d');
  ctx.font = font;
  return ctx.measureText('mmmmmmmmmmlli1WQ@#ÅÉ').width;
}

/** True if the font family is bundled or installed locally (canvas width probe). */
export function isFontAvailable(family) {
  if (BUNDLED_FONTS.includes(family)) return true;
  for (const generic of ['monospace', 'serif', 'sans-serif']) {
    if (measure(`72px "${family}", ${generic}`) !== measure(`72px ${generic}`)) return true;
  }
  return false;
}

/** Aptos if installed, otherwise the bundled Carlito. */
export function defaultBodyFont() {
  return isFontAvailable(DEFAULT_BODY_FONT.preferred) ? DEFAULT_BODY_FONT.preferred : DEFAULT_BODY_FONT.fallback;
}

/** Resolves once the bundled faces used by the page are decoded. */
export function loadBundledFonts() {
  if (!document.fonts) return Promise.resolve();
  const faces = BUNDLED_FONTS.flatMap((f) => [`400 12pt "${f}"`, `700 12pt "${f}"`]);
  return Promise.all(faces.map((f) => document.fonts.load(f))).then(() => undefined);
}
