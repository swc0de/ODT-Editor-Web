/** Registers every ribbon tab's commands, in tab-bar order. */
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
import * as help from './help/index.js';

export const TABS = Object.freeze([
  ['file', file], ['home', home], ['insert', insert], ['draw', draw], ['design', design], ['layout', layout],
  ['references', references], ['mailings', mailings], ['review', review], ['view', view],
  ['developer', developer], ['help', help],
]);

export function registerFeatures(registry) {
  for (const [, mod] of TABS) mod.register(registry);
}
