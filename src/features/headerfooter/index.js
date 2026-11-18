/**
 * Header & Footer contextual tab (shown while a header or footer is being
 * edited): Header & Footer, Insert, Navigation, Options, Position, Close.
 */
import { defineCommands } from '../define.js';
import { fields, insertInline } from './actions.js';
import { editState } from '../../core/state-step.js';
import { findMaster, partOptions, setPartOptions } from '../../core/page-setup.js';
import { PAGE_KEYS, bodyView, masterChain } from '../layout/sections.js';
import { dateTimeDialog } from '../../ui/layout-dialogs.js';

const active = (c) => !!c.ui.hf?.isActive();

function setOption(c, key) {
  const name = c.ui.hf.masterName();
  if (!name) return;
  const cur = partOptions(findMaster(c.session.state, name));
  editState(bodyView(c), c.session.state, PAGE_KEYS, (st) => setPartOptions(st, masterChain(st, name), { [key]: !cur[key] }));
  c.ui.hf.reopen();
}

const optionCmd = (key) => ({
  isEnabled: active,
  isChecked: (c) => active(c) && partOptions(findMaster(c.session.state, c.ui.hf.masterName()))[key],
  run: (c) => setOption(c, key),
});

const spin = (part) => ({
  isEnabled: active,
  run: (c, v) => { if (Number.isFinite(v) && v >= 0) c.ui.hf.setDistance(part, v); },
});

export async function insertDateTime(c) {
  const res = await dateTimeDialog();
  if (res) insertInline(c, fields.date(c, res));
}

export const commands = defineCommands('headerFooter', {
  dateTime: { icon: 'date-time', run: insertDateTime },
  docInfo: { icon: 'quick-parts', menuOnly: true },
  docAuthor: { run: (c) => insertInline(c, fields.author(c)) },
  docFileName: { run: (c) => insertInline(c, fields.fileName(c)) },
  docTitle: { run: (c) => insertInline(c, fields.title(c)) },
  pageCountField: { run: (c) => insertInline(c, fields.pageCount(c)) },
  goToHeader: { icon: 'header', isEnabled: (c) => active(c) && c.ui.hf.current()?.part !== 'header', run: (c) => c.ui.hf.goPart('header') },
  goToFooter: { icon: 'footer', isEnabled: (c) => active(c) && c.ui.hf.current()?.part !== 'footer', run: (c) => c.ui.hf.goPart('footer') },
  previous: { icon: 'chevron-up', isEnabled: (c) => active(c) && c.ui.hf.hasPrevious(), run: (c) => c.ui.hf.previous() },
  next: { icon: 'chevron-down', isEnabled: (c) => active(c) && c.ui.hf.hasNext(), run: (c) => c.ui.hf.next() },
  linkToPrevious: { icon: 'link', isEnabled: (c) => active(c) && c.ui.hf.canLink(), isChecked: (c) => active(c) && c.ui.hf.canLink() && c.ui.hf.linkedToPrevious(), run: (c) => c.ui.hf.linkToPrevious() },
  differentFirst: optionCmd('firstPage'),
  differentOddEven: optionCmd('oddEven'),
  showDocumentText: { isEnabled: active, isChecked: (c) => active(c) && c.ui.hf.bodyShown(), run: (c) => c.ui.hf.toggleBody() },
  headerFromTop: { icon: 'header', ...spin('header') },
  footerFromBottom: { icon: 'footer', ...spin('footer') },
  close: { icon: 'close', isEnabled: active, run: (c) => c.ui.hf.close() },
});

export const ribbon = {
  id: 'headerFooter',
  keytip: 'JH',
  contextual: 'headerFooter',
  groups: [
    {
      id: 'headerFooter', icon: 'header',
      controls: [
        { t: 'large', cmd: 'insert.header', menu: [{ custom: 'headerGallery' }, '-', 'insert.editHeader', 'insert.removeHeader'] },
        { t: 'large', cmd: 'insert.footer', menu: [{ custom: 'footerGallery' }, '-', 'insert.editFooter', 'insert.removeFooter'] },
        { t: 'large', cmd: 'insert.pageNumber', label: 'label.insert.pageNumber', menu: [{ cmd: 'insert.pageNumberTop', sub: ['insert.pageNumberTopLeft', 'insert.pageNumberTopCentre', 'insert.pageNumberTopRight'] }, { cmd: 'insert.pageNumberBottom', sub: ['insert.pageNumberBottomLeft', 'insert.pageNumberBottomCentre', 'insert.pageNumberBottomRight'] }, 'insert.pageNumberCurrent', '-', 'insert.pageNumberFormat', 'insert.removePageNumbers'] },
      ],
    },
    {
      id: 'insert', icon: 'date-time',
      controls: [
        { t: 'large', cmd: 'dateTime', label: 'label.hf.dateTime' },
        { t: 'large', cmd: 'docInfo', label: 'label.hf.docInfo', menu: ['docAuthor', 'docFileName', 'docTitle', 'pageCountField'] },
        { t: 'large', cmd: 'insert.pictures' },
      ],
    },
    {
      id: 'navigation', icon: 'header',
      controls: [
        { t: 'large', cmd: 'goToHeader', label: 'label.hf.goToHeader' },
        { t: 'large', cmd: 'goToFooter', label: 'label.hf.goToFooter' },
        { t: 'col', items: [{ cmd: 'previous' }, { cmd: 'next' }, { cmd: 'linkToPrevious' }] },
      ],
    },
    {
      id: 'options', icon: 'set-default',
      controls: [{ t: 'col', items: [{ t: 'check', cmd: 'differentFirst' }, { t: 'check', cmd: 'differentOddEven' }, { t: 'check', cmd: 'showDocumentText' }] }],
    },
    {
      id: 'position', icon: 'margins',
      controls: [{ t: 'spins', header: 'label.hf.position', items: [{ cmd: 'headerFromTop', label: 'label.hf.headerFromTop', unit: 'cm', value: 1.25, step: 0.1, decimals: 2 }, { cmd: 'footerFromBottom', label: 'label.hf.footerFromBottom', unit: 'cm', value: 1.25, step: 0.1, decimals: 2 }] }],
    },
    { id: 'close', icon: 'close', controls: [{ t: 'large', cmd: 'close', label: 'label.hf.close' }] },
  ],
};

export function register(registry) { registry.register(commands); }
