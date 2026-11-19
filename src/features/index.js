/** Registers every ribbon tab's commands, in tab-bar order (as in the reference screenshots). */
import * as file from './file/index.js';
import * as home from './home/index.js';
import * as insert from './insert/index.js';
import * as draw from './draw/index.js';
import * as design from './design/index.js';
import * as layout from './layout/index.js';
import * as references from './references/index.js';
import * as mailings from './mailings/index.js';
import * as review from './review/index.js';
import * as view from './view/index.js';
import * as developer from './developer/index.js';
import * as zotero from './zotero/index.js';
import * as help from './help/index.js';
import * as headerFooter from './headerfooter/index.js';
import * as tableDesign from './table/design.js';
import * as tableLayout from './table/layout.js';
import * as app from './app.js';
import { pictureTab, shapeTab } from './objects/format.js';

export const TAB_MODULES = Object.freeze([file, home, insert, draw, design, layout, references, mailings, review, view, developer, zotero, help, headerFooter, tableDesign, tableLayout, pictureTab, shapeTab]);
export const TABS = Object.freeze(TAB_MODULES.map((m) => m.ribbon));

export function registerFeatures(registry) {
  app.register(registry);
  for (const mod of TAB_MODULES) mod.register(registry);
}
