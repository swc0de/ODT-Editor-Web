/**
 * Review tab dialogs: Track Changes Options (what markup shows, your user
 * name and initials), Reviewers (whose changes show), Word Count, Language.
 */
import { h } from './dom.js';
import { t } from '../i18n/index.js';
import { showDialog } from './dialog.js';
import { field, text, check, select, group } from './form.js';

const okCancel = () => [{ label: t('common.ok'), value: true, primary: true }, { label: t('common.cancel'), value: false }];

/** cur = { name, initials, comments, insdel, fmt } → same shape or null */
export async function trackingOptionsDialog(cur) {
  const comments = check(t('rv.optComments'), cur.comments);
  const insdel = check(t('rv.optInsDel'), cur.insdel);
  const fmt = check(t('rv.optFormatting'), cur.fmt);
  const name = text(cur.name, { 'aria-label': t('rv.userName') });
  const initials = text(cur.initials, { maxlength: '6', style: 'width:90px', 'aria-label': t('rv.initials') });
  const body = h('div', { class: 'ref-dlg' },
    group(t('rv.show'), comments, insdel, fmt),
    group(t('rv.userTitle'), field(t('rv.userName'), name, { wide: true }), field(t('rv.initials'), initials)),
    h('p', { class: 'fm-hint' }, t('rv.userHint')));
  const ok = await showDialog({ title: t('rv.optionsTitle'), message: body, buttons: okCancel(), cancelValue: false, validate: () => !!name.value.trim() });
  if (!ok) return null;
  return { name: name.value.trim(), initials: initials.value.trim(), comments: comments.input.checked, insdel: insdel.input.checked, fmt: fmt.input.checked };
}

/** Reviewers: names → checked set (names shown) or null */
export async function reviewersDialog(names, shown) {
  if (!names.length) {
    await showDialog({ title: t('rv.reviewersTitle'), message: t('rv.noReviewers'), buttons: [{ label: t('common.ok'), value: true, primary: true }], cancelValue: true });
    return null;
  }
  const all = check(t('rv.allReviewers'), names.every((n) => shown.has(n)));
  const boxes = names.map((n) => check(n, shown.has(n)));
  all.input.addEventListener('change', () => boxes.forEach((b) => { b.input.checked = all.input.checked; }));
  const ok = await showDialog({ title: t('rv.reviewersTitle'), message: h('div', { class: 'ref-dlg' }, all, ...boxes), buttons: okCancel(), cancelValue: false });
  if (!ok) return null;
  return new Set(names.filter((_, i) => boxes[i].input.checked));
}

/** Word Count. stats = { pages, words, chars, charsNoSpace, paragraphs, lines }; recount(includeNotes) → stats */
export async function wordCountDialog(stats, recount) {
  const rows = h('table', { class: 'wc-table' });
  const fill = (s) => rows.replaceChildren(...[['wc.pages', s.pages], ['wc.words', s.words], ['wc.chars', s.charsNoSpace], ['wc.charsSpaces', s.chars], ['wc.paragraphs', s.paragraphs], ['wc.lines', s.lines]]
    .map(([k, v]) => h('tr', {}, h('td', {}, t(k)), h('td', { class: 'wc-num' }, Number(v ?? 0).toLocaleString('en-GB')))));
  fill(stats);
  const notes = check(t('wc.includeNotes'), false);
  notes.input.addEventListener('change', () => fill(recount(notes.input.checked)));
  await showDialog({ title: t('wc.title'), message: h('div', { class: 'ref-dlg wc-dlg' }, h('div', { class: 'fm-label' }, t('wc.statistics')), rows, notes), buttons: [{ label: t('common.close'), value: true, primary: true }], cancelValue: true });
}

/** Language: languages [[code, label]], cur → { lang, noProof } or null */
export async function languageDialog(languages, cur, noProof) {
  const list = h('select', { class: 'src-list', size: '12', 'aria-label': t('lang.mark') });
  for (const [v, label] of languages) {
    const o = h('option', { value: v }, label);
    if (v === cur) o.selected = true;
    list.append(o);
  }
  const skip = check(t('lang.noProof'), noProof);
  const body = h('div', { class: 'ref-dlg lang-dlg' }, h('label', { class: 'fm-label' }, t('lang.mark')), list, skip, h('p', { class: 'fm-hint' }, t('lang.hint')));
  const ok = await showDialog({ title: t('lang.title'), message: body, buttons: okCancel(), cancelValue: false });
  if (!ok) return null;
  return { lang: list.value || cur, noProof: skip.input.checked };
}

export { select };
