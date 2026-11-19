/**
 * The citation engine (citeproc-js, CPAL-1.0 / AGPL-1.0) with the bundled CSL
 * styles (CC BY-SA 3.0, Citation Style Language project) and en-GB / en-US
 * locales. Built as a separate chunk embedded in the HTML file; it is loaded
 * only when citations are formatted.
 */
import CSL from 'citeproc';
import apa from './csl/apa.csl';
import mla from './csl/modern-language-association.csl';
import chicago from './csl/chicago-author-date.csl';
import ieee from './csl/ieee.csl';
import harvard from './csl/harvard-cite-them-right.csl';
import enGB from './csl/locales-en-GB.xml';
import enUS from './csl/locales-en-US.xml';

export const STYLES = { apa, mla, chicago, ieee, harvard };
export const LOCALES = { 'en-GB': enGB, 'en-US': enUS };
export { CSL };
