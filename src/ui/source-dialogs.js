/**
 * Citations & Bibliography dialogs: Create / Edit Source, Add Placeholder,
 * Manage Sources (master list ↔ current document, import from BibTeX, RIS or
 * CSL-JSON, preview in the current style) and Insert Citation's picker.
 */
import { h } from './dom.js';
import { t } from '../i18n/index.js';
import { showDialog, alertDialog } from './dialog.js';
import { field, select, text, row } from './form.js';
import { SOURCE_TYPES, parseNames, namesText, yearOf, sourceLabel, uniqueTag, parseSources } from '../core/bibliography.js';

const okCancel = (ok = t('common.ok')) => [{ label: ok, value: true, primary: true }, { label: t('common.cancel'), value: false }];

/** Container label by type (journal name, book title, website…). */
const containerLabel = (type) => t(type === 'chapter' || type === 'paper-conference' ? 'src.bookTitle' : type === 'webpage' ? 'src.website' : type.startsWith('article') ? 'src.journal' : 'src.series');

/**
 * Create Source / Edit Source. item: existing source or null. used: tags taken.
 * → CSL item or null
 */
export async function sourceDialog(item, used = new Set()) {
  const it = item || { type: 'book' };
  const type = select(SOURCE_TYPES.map(([v]) => [v, t(`src.type.${v}`)]), it.type || 'book');
  const author = text(namesText(it.author), { placeholder: t('src.authorHint') });
  const editor = text(namesText(it.editor));
  const title = text(it.title || '');
  const year = text(yearOf(it), { inputmode: 'numeric', style: 'width:80px' });
  const container = text(it['container-title'] || it['collection-title'] || '');
  const city = text(it['publisher-place'] || '');
  const publisher = text(it.publisher || '');
  const volume = text(it.volume || '', { style: 'width:70px' });
  const issue = text(it.issue || '', { style: 'width:70px' });
  const pages = text(it.page || '', { style: 'width:90px' });
  const edition = text(it.edition || '', { style: 'width:70px' });
  const url = text(it.URL || '');
  const doi = text(it.DOI || '');
  const tag = text(it.id || '', { style: 'width:140px' });
  const containerField = field(containerLabel(type.value), container, { wide: true });
  type.addEventListener('change', () => { containerField.querySelector('label').textContent = containerLabel(type.value); });
  const draft = () => {
    const out = { ...(item || {}), type: type.value };
    const set = (k, v) => { v = String(v).trim(); if (v) out[k] = v; else delete out[k]; };
    const a = parseNames(author.value);
    if (a.length) out.author = a; else delete out.author;
    const e = parseNames(editor.value);
    if (e.length) out.editor = e; else delete out.editor;
    set('title', title.value);
    const y = year.value.trim();
    if (y) out.issued = { 'date-parts': [[Number(y) || y]] }; else delete out.issued;
    delete out['collection-title'];
    set(type.value === 'book' || type.value === 'report' ? 'collection-title' : 'container-title', container.value);
    if (type.value === 'book' || type.value === 'report') delete out['container-title'];
    set('publisher-place', city.value);
    set('publisher', publisher.value);
    set('volume', volume.value);
    set('issue', issue.value);
    set('page', pages.value);
    set('edition', edition.value);
    set('URL', url.value);
    set('DOI', doi.value);
    delete out.placeholder;
    return out;
  };
  // A tag is suggested from the author and year until the user types one.
  let tagTouched = !!it.id;
  tag.addEventListener('input', () => { tagTouched = true; });
  const suggest = () => { if (!tagTouched) tag.value = uniqueTag(draft(), used); };
  [author, year, title].forEach((x) => x.addEventListener('input', suggest));
  suggest();
  const body = h('div', { class: 'ref-dlg src-dlg' },
    field(t('src.typeLabel'), type),
    field(t('src.author'), author, { wide: true }),
    field(t('src.editor'), editor, { wide: true }),
    field(t('src.title'), title, { wide: true }),
    containerField,
    row(field(t('src.year'), year), field(t('src.volume'), volume), field(t('src.issue'), issue), field(t('src.pages'), pages), field(t('src.edition'), edition)),
    row(field(t('src.city'), city), field(t('src.publisher'), publisher)),
    field(t('src.url'), url, { wide: true }),
    row(field(t('src.doi'), doi), field(t('src.tag'), tag)));
  const ok = await showDialog({
    title: t(item ? 'src.editTitle' : 'src.createTitle'), message: body, buttons: okCancel(), cancelValue: false, wide: true,
    validate: () => {
      const id = tag.value.trim();
      if (!id) { tag.focus(); return false; }
      if (used.has(id) && id !== item?.id) { tag.setCustomValidity(t('src.tagTaken')); tag.reportValidity(); tag.setCustomValidity(''); return false; }
      if (!title.value.trim() && !author.value.trim()) { title.focus(); return false; }
      return true;
    },
  });
  if (!ok) return null;
  return { ...draft(), id: tag.value.trim() };
}

/** Add New Placeholder → { id, placeholder: true } or null */
export async function placeholderDialog(used) {
  let i = 1;
  while (used.has(`Placeholder${i}`)) i++;
  const name = text(`Placeholder${i}`);
  const ok = await showDialog({
    title: t('src.placeholderTitle'), message: h('div', { class: 'ref-dlg' }, h('p', {}, t('src.placeholderHint')), field(t('src.tag'), name, { wide: true })),
    buttons: okCancel(), cancelValue: false, validate: () => !!name.value.trim() && !used.has(name.value.trim()),
  });
  return ok ? { id: name.value.trim(), type: 'document', placeholder: true } : null;
}

/** Reads a reference-manager export chosen by the user → CSL items (or null). */
export function pickSourceFile() {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: '.bib,.bibtex,.ris,.json,.txt,application/json', style: 'display:none' });
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      input.remove();
      if (!f) { resolve(null); return; }
      try {
        const items = parseSources(await f.text(), f.name);
        if (!items.length) throw new Error(t('src.importNone'));
        resolve(items);
      } catch (e) {
        await alertDialog(t('src.importTitle'), `${t('src.importFailed')} ${e.message || e}`);
        resolve(null);
      }
    });
    document.body.append(input);
    input.click();
  });
}

/**
 * Source Manager: the master list (all your sources, kept in this browser)
 * and the current list (this document's sources). api:
 *   master(), current(), cited(id), preview(item) → Promise<string>,
 *   setMaster(list), addToCurrent(items), updateCurrent(id, item), removeCurrent(id)
 */
export async function manageSourcesDialog(api) {
  const search = text('', { placeholder: t('src.search'), 'aria-label': t('src.search') });
  const masterList = h('select', { class: 'src-list', size: '12', multiple: '', 'aria-label': t('src.masterList') });
  const currentList = h('select', { class: 'src-list', size: '12', multiple: '', 'aria-label': t('src.currentList') });
  const preview = h('div', { class: 'ref-preview src-preview', 'aria-live': 'polite' });
  const btn = (label, fn) => h('button', { type: 'button', class: 'dlg-btn', onclick: fn }, label);
  const fill = (el, items, mark) => {
    const q = search.value.trim().toLowerCase();
    const keep = new Set([...el.selectedOptions].map((o) => o.value));
    el.replaceChildren(...items.filter((s) => !q || sourceLabel(s).toLowerCase().includes(q) || s.id.toLowerCase().includes(q)).map((s) => {
      const o = h('option', { value: s.id }, `${mark?.(s) || ''}${sourceLabel(s)}`);
      if (keep.has(s.id)) o.selected = true;
      return o;
    }));
  };
  const draw = () => {
    fill(masterList, api.master());
    fill(currentList, api.current(), (s) => (api.cited(s.id) ? '✓ ' : ' '));
  };
  const selected = (el, list) => [...el.selectedOptions].map((o) => list.find((s) => s.id === o.value)).filter(Boolean);
  let seq = 0;
  const showPreview = async (s) => {
    const n = ++seq;
    if (!s) { preview.textContent = ''; return; }
    try {
      const html = await api.preview(s);
      if (n === seq) preview.innerHTML = html;
    } catch { if (n === seq) preview.textContent = sourceLabel(s); }
  };
  masterList.addEventListener('change', () => showPreview(selected(masterList, api.master())[0]));
  currentList.addEventListener('change', () => showPreview(selected(currentList, api.current())[0]));
  search.addEventListener('input', draw);

  const copyRight = () => {
    const add = selected(masterList, api.master()).filter((s) => !api.current().some((x) => x.id === s.id));
    if (add.length) api.addToCurrent(add);
    draw();
  };
  const copyLeft = () => {
    const list = [...api.master()];
    for (const s of selected(currentList, api.current())) {
      const i = list.findIndex((x) => x.id === s.id);
      if (i >= 0) list[i] = s; else list.push(s);
    }
    api.setMaster(list);
    draw();
  };
  const del = async () => {
    const cur = selected(currentList, api.current());
    const mas = selected(masterList, api.master());
    for (const s of cur) {
      if (api.cited(s.id)) { await alertDialog(t('src.manageTitle'), t('src.citedCantDelete', { name: sourceLabel(s) })); continue; }
      api.removeCurrent(s.id);
    }
    if (mas.length) api.setMaster(api.master().filter((s) => !mas.some((m) => m.id === s.id)));
    draw();
  };
  const usedIds = () => new Set([...api.master(), ...api.current()].map((s) => s.id));
  const edit = async () => {
    const inCur = selected(currentList, api.current())[0];
    const inMas = !inCur && selected(masterList, api.master())[0];
    const s = inCur || inMas;
    if (!s) return;
    const used = usedIds();
    used.delete(s.id);
    const r = await sourceDialog(s.placeholder ? { ...s, placeholder: undefined } : s, used);
    if (!r) return;
    if (inCur) api.updateCurrent(s.id, r);
    else api.setMaster(api.master().map((x) => (x.id === s.id ? r : x)));
    draw();
    showPreview(r);
  };
  const add = async () => {
    const r = await sourceDialog(null, usedIds());
    if (!r) return;
    api.addToCurrent([r]);
    api.setMaster([...api.master().filter((x) => x.id !== r.id), r]);
    draw();
  };
  const importFile = async () => {
    const items = await pickSourceFile();
    if (!items) return;
    const used = new Set(api.master().map((s) => s.id));
    const fresh = items.map((it) => ({ ...it, id: it.id && !used.has(it.id) ? it.id : uniqueTag(it, used) }));
    fresh.forEach((it) => used.add(it.id));
    api.setMaster([...api.master(), ...fresh]);
    draw();
  };
  draw();
  const body = h('div', { class: 'src-manager' },
    h('div', { class: 'src-search' }, search, btn(t('src.import'), importFile)),
    h('div', { class: 'src-cols' },
      h('div', { class: 'src-col' }, h('label', { class: 'fm-label' }, t('src.masterList')), masterList),
      h('div', { class: 'src-mid' }, btn(t('src.copyRight'), copyRight), btn(t('src.copyLeft'), copyLeft), btn(t('src.delete'), del), btn(t('src.edit'), edit), btn(t('src.new'), add)),
      h('div', { class: 'src-col' }, h('label', { class: 'fm-label' }, t('src.currentList')), currentList)),
    h('div', { class: 'src-legend' }, t('src.citedLegend')),
    h('label', { class: 'fm-label' }, t('src.preview')), preview);
  await showDialog({ title: t('src.manageTitle'), message: body, buttons: [{ label: t('common.close'), value: true, primary: true }], cancelValue: false, wide: true });
}
