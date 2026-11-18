/**
 * Central app configuration. The product name is defined ONLY here, so it can
 * be changed in one place (the build also reads it for the <title>).
 */
/* global __APP_VERSION__, __BUILD_DATE__ */

export const APP_NAME = 'ODT Editor';
export const APP_ID = 'odt-editor'; // storage keys, IndexedDB name, file ids

export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0-dev';
export const BUILD_DATE = typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : '';

export const DEFAULT_LOCALE = 'en-GB';

/** Measurement units shown in the UI: 'cm' | 'in' | 'pt' | 'mm'. */
export const DEFAULT_UNITS = 'cm';

/** Default body font: Aptos if installed, otherwise the bundled Carlito. */
export const DEFAULT_BODY_FONT = { preferred: 'Aptos', fallback: 'Carlito', sizePt: 12 };

/** Fonts bundled into the single HTML file (all SIL OFL 1.1). */
export const BUNDLED_FONTS = ['Carlito', 'Caladea', 'Liberation Sans', 'Liberation Serif', 'Liberation Mono'];

/** Default page: A4 portrait with 2.54 cm margins. */
export const DEFAULT_PAGE = { widthCm: 21, heightCm: 29.7, marginCm: { top: 2.54, right: 2.54, bottom: 2.54, left: 2.54 } };

export const AUTOSAVE_INTERVAL_MS = 30_000;

/** 'dark' | 'light' | 'system' */
export const DEFAULT_THEME = 'dark';

export const ODT_MIME = 'application/vnd.oasis.opendocument.text';
export const OTT_MIME = 'application/vnd.oasis.opendocument.text-template';
export const ODF_VERSION = '1.3';
