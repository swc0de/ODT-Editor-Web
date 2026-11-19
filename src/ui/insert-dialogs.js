/**
 * Insert tab dialogs: Hyperlink (web page or file, place in this document,
 * e-mail), Bookmark, Field and Signature Setup. Each returns the chosen
 * values or null when cancelled.
 */
import { h } from './dom.js';
import { t } from '../i18n/index.js';
import { showDialog } from './dialog.js';
import { field, select, check, row, group, text } from './form.js';

const okCancel = (ok = t('common.ok')) => [{ label: ok, value: true, primary: true }, { label: t('common.cancel'), value: false }];

/**
 * cur = { text, href, title, canEditText, headings: [name], bookmarks: [name], existing }
 * → { text, href, title } | { remove: true } | null
 */
export async function linkDialog(cur) {
  const isMail = /^mailto:/i.test(cur.href || '');
  const isPlace = (cur.href || '').startsWith('#');
  let mode = isMail ? 'mail' : (isPlace ? 'place' : 'web');
  const display = text(cur.text || '', { 'aria-label': t('link.display') });
  if (!cur.canEditText) display.disabled = true;
  const tip = text(cur.title || '', { 'aria-label': t('link.screenTip') });
  const url = text(mode === 'web' ? cur.href || '' : '', { 'aria-label': t('link.address'), placeholder: 'https://' });
  const mailParts = isMail ? /^mailto:([^?]*)(?:\?subject=(.*))?$/i.exec(cur.href) : null;
  const mail = text(mailParts ? decodeURIComponent(mailParts[1] || '') : '', { 'aria-label': t('link.email') });
  const subject = text(mailParts?.[2] ? decodeURIComponent(mailParts[2]) : '', { 'aria-label': t('link.subject') });
  const places = [['', t('link.topOfDocument')], ...cur.headings.map((x) => [`${x}|outline`, `${t('link.heading')}: ${x}`]), ...cur.bookmarks.map((x) => [x, `${t('link.bookmark')}: ${x}`])];
  const place = select(places, isPlace ? cur.href.slice(1) : '', { size: '8', class: 'fm-input lk-places', 'aria-label': t('link.place') });
  const panels = {
    web: h('div', { class: 'lk-panel' }, field(t('link.address'), url, { wide: true })),
    place: h('div', { class: 'lk-panel' }, field(t('link.place'), place, { wide: true })),
    mail: h('div', { class: 'lk-panel' }, field(t('link.email'), mail, { wide: true }), field(t('link.subject'), subject, { wide: true })),
  };
  const side = h('div', { class: 'lk-side', role: 'tablist', 'aria-label': t('link.linkTo') });
  const content = h('div', { class: 'lk-content' });
  const show = (m) => {
    mode = m;
    content.replaceChildren(panels[m]);
    side.querySelectorAll('button').forEach((b) => { b.classList.toggle('is-on', b.dataset.mode === m); b.setAttribute('aria-selected', String(b.dataset.mode === m)); });
  };
  for (const [m, label] of [['web', t('link.web')], ['place', t('link.placeInDoc')], ['mail', t('link.emailTab')]]) {
    side.append(h('button', { type: 'button', class: 'lk-mode', role: 'tab', 'data-mode': m, onclick: () => show(m) }, label));
  }
  show(mode);
  const body = h('div', { class: 'lk' }, field(t('link.display'), display, { wide: true }), h('div', { class: 'lk-main' }, side, content), field(t('link.screenTip'), tip, { wide: true }));
  const buttons = [...okCancel()];
  if (cur.existing) buttons.splice(1, 0, { label: t('link.remove'), value: 'remove' });
  const r = await showDialog({ title: t(cur.existing ? 'link.editTitle' : 'link.title'), message: body, buttons, cancelValue: false, wide: true });
  if (r === 'remove') return { remove: true };
  if (!r) return null;
  let href = '';
  if (mode === 'web') {
    href = url.value.trim();
    if (href && !/^[a-z][\w+.-]*:/i.test(href) && !href.startsWith('#') && !href.startsWith('.')) href = /@/.test(href) && !href.includes('/') ? `mailto:${href}` : `https://${href}`;
  } else if (mode === 'place') href = `#${place.value}`;
  else href = mail.value.trim() ? `mailto:${mail.value.trim()}${subject.value.trim() ? `?subject=${encodeURIComponent(subject.value.trim())}` : ''}` : '';
  if (!href || href === '#' && !place.value && mode !== 'place') return null;
  return { text: display.value, href, title: tip.value.trim() };
}

/** Bookmark dialog: cur = { names: [{ name, pos }], suggested } → { action: 'add'|'delete'|'goto', name } | null */
export async function bookmarkDialog(cur) {
  const name = text(cur.suggested || '', { 'aria-label': t('bm.name') });
  const sortBy = select([['name', t('bm.sortName')], ['location', t('bm.sortLocation')]], 'name');
  const hidden = check(t('bm.hidden'), false);
  const list = h('select', { class: 'fm-input bm-list', size: '8', 'aria-label': t('bm.list') });
  const note = h('div', { class: 'fm-note bm-note', role: 'status' });
  const render = () => {
    const items = cur.names.filter((x) => hidden.input.checked || !x.name.startsWith('_')).sort((a, b) => (sortBy.value === 'name' ? a.name.localeCompare(b.name) : a.pos - b.pos));
    list.replaceChildren(...items.map((x) => h('option', { value: x.name }, x.name)));
  };
  sortBy.addEventListener('change', render);
  hidden.input.addEventListener('change', render);
  list.addEventListener('change', () => { name.value = list.value; });
  render();
  const valid = (n) => /^[\p{L}_][\p{L}\p{N}_]*$/u.test(n) && n.length <= 40;
  const body = h('div', { class: 'bm' }, field(t('bm.name'), name, { wide: true }), list, row(field(t('bm.sortBy'), sortBy)), hidden, note);
  let result = null;
  const r = await showDialog({
    title: t('bm.title'), message: body, cancelValue: false, wide: false,
    buttons: [{ label: t('bm.add'), value: 'add', primary: true }, { label: t('bm.delete'), value: 'delete' }, { label: t('bm.goTo'), value: 'goto' }, { label: t('common.cancel'), value: false }],
    validate: (v) => {
      if (v === 'add' && !valid(name.value.trim())) { note.textContent = t('bm.invalid'); return false; }
      if ((v === 'delete' || v === 'goto') && !cur.names.some((x) => x.name === (list.value || name.value.trim()))) { note.textContent = t('bm.pick'); return false; }
      return true;
    },
  });
  if (!r) return null;
  result = { action: r, name: r === 'add' ? name.value.trim() : (list.value || name.value.trim()) };
  return result;
}

export const FIELDS = ['date', 'time', 'author', 'fileName', 'page', 'numPages', 'title', 'subject', 'keywords', 'comments', 'wordCount', 'charCount'];

/** Field dialog → { kind, format, fixed } | null */
export async function fieldDialog() {
  const list = h('select', { class: 'fm-input fd-list', size: '12', 'aria-label': t('fd.names') }, FIELDS.map((f, i) => h('option', { value: f, selected: i === 0 }, t(`fd.f.${f}`))));
  const desc = h('div', { class: 'fm-note fd-desc' });
  const fmt = select([['long', t('fd.fmt.long')], ['short', t('fd.fmt.short')], ['weekday', t('fd.fmt.weekday')], ['iso', 'yyyy-mm-dd']], 'long');
  const fixed = check(t('fd.fixed'), false);
  const fmtRow = row(field(t('fd.format'), fmt));
  const upd = () => {
    desc.textContent = t(`fd.d.${list.value}`);
    fmtRow.hidden = list.value !== 'date';
    fixed.hidden = !['date', 'time'].includes(list.value);
  };
  list.addEventListener('change', upd);
  upd();
  const body = h('div', { class: 'fd' }, h('div', { class: 'fd-main' }, group(t('fd.names'), list), h('div', { class: 'fd-props' }, desc, fmtRow, fixed)));
  const ok = await showDialog({ title: t('fd.title'), message: body, buttons: okCancel(), cancelValue: false, wide: true });
  if (!ok) return null;
  return { kind: list.value, format: fmt.value, fixed: fixed.input.checked };
}

/** Signature Setup → { signer, title, email, instructions, showDate } | null */
export async function signatureDialog() {
  const signer = text('', { 'aria-label': t('sig.signer') });
  const title = text('', { 'aria-label': t('sig.signerTitle') });
  const email = text('', { 'aria-label': t('sig.email') });
  const instr = text(t('sig.defaultInstructions'), { 'aria-label': t('sig.instructions') });
  const showDate = check(t('sig.showDate'), true);
  const body = h('div', {}, field(t('sig.signer'), signer, { wide: true }), field(t('sig.signerTitle'), title, { wide: true }), field(t('sig.email'), email, { wide: true }), field(t('sig.instructions'), instr, { wide: true }), showDate);
  const ok = await showDialog({ title: t('sig.title'), message: body, buttons: okCancel(), cancelValue: false });
  if (!ok) return null;
  return { signer: signer.value.trim(), title: title.value.trim(), email: email.value.trim(), instructions: instr.value.trim(), showDate: showDate.input.checked };
}

/** Name for a new AutoText entry. */
export async function autoTextNameDialog(suggested) {
  const name = text(suggested, { 'aria-label': t('qp.name') });
  const ok = await showDialog({ title: t('qp.newTitle'), message: h('div', {}, field(t('qp.name'), name, { wide: true })), buttons: okCancel(), cancelValue: false });
  return ok && name.value.trim() ? name.value.trim() : null;
}
