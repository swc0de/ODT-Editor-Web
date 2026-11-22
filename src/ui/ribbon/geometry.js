/**
 * Group widths of the ribbon (px, divider to divider) read from the
 * reference screenshots (reference/*.png, M14 table 6.1, in window
 * coordinates: the ribbon crops are offset from the window by 5 / 1 / 5 / 4
 * px on Insert / Draw / Layout / View). A group is at least this wide, so
 * its divider and its centred label sit where the reference has them; it
 * still grows when its controls need more room (other languages, more
 * controls). Tabs and groups not listed size to their content.
 */
export const GROUP_WIDTHS = {
  home: { clipboard: 128, font: 354, paragraph: 279, paragraphTools: 108, styles: 487, editing: 86, voice: 64, editorGroup: 57 },
  insert: { pages: 110, tables: 64, illustrations: 212, links: 132, comments: 80, headerFooter: 199, text: 185, symbols: 147 },
  draw: { drawingTools: 388, convert: 105, insert: 70, replay: 62 },
  layout: { pageSetup: 461, paragraph: 232, arrange: 271 },
  view: { views: 219, immersive: 127, pageMovement: 116, show: 252, zoom: 298, darkMode: 134, window: 448, macros: 65, templates: 81 },
};
