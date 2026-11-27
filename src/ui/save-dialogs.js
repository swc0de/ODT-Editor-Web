/**
 * Dialogs of Save / Save As (M15):
 *   lossyPrompt         Word's compatibility prompt before saving as Web Page
 *                       or Plain Text, with the features that will be lost
 *   fileConversion      Word's File Conversion dialog for Plain Text:
 *                       encoding, line endings, character substitution and a
 *                       live preview with unencodable characters in red
 *   webOptions          Web Page options (title, keep data for lossless reopening)
 *   passwordUnsupported a password the format can't keep
 *   compatibilityDialog File ▸ Info ▸ Check for Issues ▸ Check Compatibility
 */
import { h } from './dom.js';
import { showDialog } from './dialog.js';
import { field, select, check, text } from './form.js';
import { t } from '../i18n/index.js';
import { lossesFor } from '../core/losses.js';
import { ENCODINGS, LINE_ENDINGS, canEncode, SUBSTITUTIONS } from '../core/convert/text-encoding.js';
import { toText } from '../core/convert/writers.js';
import { SAVE_FORMATS, formatById } from '../core/formats.js';

function lossList(losses) {
  if (!losses.length) return h('p', { class: 'sv-note' }, t('lossy.nothing'));
  return h('table', { class: 'sv-losses', 'data-losses': '' },
    h('thead', {}, h('tr', {}, h('th', {}, t('lossy.listTitle')), h('th', { class: 'num' }, t('compat.count')))),
    h('tbody', {}, losses.map((l) => h('tr', { 'data-loss': l.id }, h('td', {}, t(l.labelKey)), h('td', { class: 'num' }, String(l.count))))));
}

/** Resolves { choice: 'keep' | 'docx' | 'cancel', dontAsk }. */
export async function lossyPrompt({ format, name, state }) {
  const losses = lossesFor(state, format.id);
  const dontAsk = check(t('lossy.dontAsk'), false, { 'data-dont-ask': '' });
  const body = h('div', { class: 'sv-dlg sv-lossy' },
    h('p', {}, t('lossy.message', { name, format: t(`fmt.short.${format.id}`) })),
    lossList(losses),
    format.id === 'html' ? h('p', { class: 'sv-note' }, t('lossy.webNote')) : null,
    dontAsk);
  const choice = await showDialog({
    title: t('lossy.title'), message: body, wide: true,
    buttons: [{ label: t('lossy.keep'), value: 'keep', primary: true }, { label: t('lossy.saveDocx'), value: 'docx' }, { label: t('common.cancel'), value: 'cancel' }],
    cancelValue: 'cancel',
  });
  return { choice, dontAsk: dontAsk.input.checked };
}

/** The File Conversion dialog. Resolves the options, or null. */
export async function fileConversion(current, state) {
  const enc = select(ENCODINGS.map((e) => [e.id, t(e.labelKey)]), current.encoding || 'utf-8', { 'data-option': 'encoding', size: '7' });
  const eol = select(LINE_ENDINGS.map((l) => [l.id, t(l.labelKey)]), current.lineEnding || 'crlf', { 'data-option': 'lineEnding' });
  const sub = check(t('conv.substitute'), !!current.substitute, { 'data-option': 'substitute' });
  const preview = h('div', { class: 'sv-preview', 'data-preview': '', tabindex: '0', role: 'region', 'aria-label': t('conv.preview') });
  const status = h('p', { class: 'sv-note', role: 'status' });
  const sample = toText(state).slice(0, 4000);
  const draw = () => {
    const e = enc.value;
    const single = ENCODINGS.find((x) => x.id === e)?.single;
    const frag = [];
    let bad = 0;
    let run = '';
    const flush = () => { if (run) { frag.push(run); run = ''; } };
    for (const ch of sample) {
      let out = ch;
      if (single && sub.input.checked && !canEncode(e, ch.codePointAt(0)) && SUBSTITUTIONS[ch] != null) out = SUBSTITUTIONS[ch];
      if (ch !== '\n' && [...out].some((c) => !canEncode(e, c.codePointAt(0)))) { flush(); bad++; frag.push(h('span', { class: 'sv-bad' }, ch)); } else run += out;
    }
    flush();
    preview.replaceChildren(...frag);
    status.textContent = bad ? t('conv.unencodable', { count: bad }) : t('conv.allOk');
    sub.input.disabled = !single;
  };
  enc.addEventListener('change', draw);
  sub.input.addEventListener('change', draw);
  draw();
  const body = h('div', { class: 'sv-dlg sv-conv' },
    h('p', {}, t('conv.intro')),
    h('div', { class: 'sv-conv-grid' }, field(t('conv.encoding'), enc, { wide: true }), h('div', {}, field(t('conv.lineEnding'), eol), sub)),
    h('h3', { class: 'opt-h' }, t('conv.preview')), preview, status);
  const ok = await showDialog({ title: t('conv.title'), message: body, wide: true, buttons: [{ label: t('common.ok'), value: true, primary: true }, { label: t('common.cancel'), value: false }], cancelValue: false });
  return ok ? { encoding: enc.value, lineEnding: eol.value, substitute: sub.input.checked } : null;
}

/** Web Page options. Resolves the options, or null. */
export async function webOptions(current, defaultTitle) {
  const title = text(current.title || defaultTitle || '', { 'data-option': 'title' });
  const keep = check(t('web.keepSource'), current.keepSource !== false, { 'data-option': 'keepSource' });
  const body = h('div', { class: 'sv-dlg' }, field(t('web.pageTitle'), title, { wide: true }), keep, h('p', { class: 'sv-note' }, t('web.keepSourceHint')));
  const ok = await showDialog({ title: t('web.title'), message: body, buttons: [{ label: t('common.ok'), value: true, primary: true }, { label: t('common.cancel'), value: false }], cancelValue: false });
  return ok ? { title: title.value.trim(), keepSource: keep.input.checked } : null;
}

/** A password the format can't keep: resolves 'docx' | 'odt' | 'drop' | 'cancel'. */
export function passwordUnsupported(format) {
  return showDialog({
    title: t('pwfmt.title'), message: t('pwfmt.message', { format: t(`fmt.short.${format.id}`) }),
    buttons: [{ label: t('pwfmt.docx'), value: 'docx', primary: true }, { label: t('pwfmt.odt'), value: 'odt' }, { label: t('pwfmt.drop'), value: 'drop' }, { label: t('common.cancel'), value: 'cancel' }],
    cancelValue: 'cancel',
  });
}

/** File ▸ Info ▸ Check for Issues ▸ Check Compatibility. */
export async function compatibilityDialog({ state, name, format = 'docx' }) {
  const choices = SAVE_FORMATS.filter((f) => f.kind !== 'fixed');
  const sel = select(choices.map((f) => [f.id, t(f.labelKey)]), format, { 'data-option': 'compatFormat' });
  const out = h('div', { class: 'sv-compat-list' });
  const draw = () => {
    const losses = lossesFor(state, sel.value);
    out.replaceChildren(losses.length ? lossList(losses) : h('p', { class: 'sv-note', 'data-compat-none': '' }, t('compat.none')));
  };
  sel.addEventListener('change', draw);
  draw();
  const body = h('div', { class: 'sv-dlg' }, h('p', {}, t('compat.intro', { name })), field(t('compat.format'), sel), out);
  await showDialog({ title: t('compat.title'), message: body, wide: true, buttons: [{ label: t('common.ok'), value: true, primary: true }], cancelValue: true });
  return formatById(sel.value);
}

/** Word's Options for PDF / XPS: page range, what to publish and (PDF) bookmarks, properties, tags, PDF/A, size. */
export async function fixedOptions(kind, cur, pageCount = 1) {
  const radio = (name, value, label, checked) => {
    const input = h('input', { type: 'radio', name, value, 'data-option': `${name}-${value}` });
    input.checked = !!checked;
    return h('label', { class: 'fm-check' }, input, label);
  };
  const from = h('input', { type: 'number', class: 'fm-input fm-num', min: '1', max: String(pageCount), value: String(cur.from || 1), 'aria-label': t('fixed.rangePages'), 'data-option': 'from' });
  const to = h('input', { type: 'number', class: 'fm-input fm-num', min: '1', max: String(pageCount), value: String(cur.to || pageCount), 'aria-label': t('fixed.to'), 'data-option': 'to' });
  const rangeBox = h('fieldset', { class: 'sv-fieldset' }, h('legend', {}, t('fixed.pageRange')),
    radio('range', 'all', t('fixed.rangeAll'), cur.range === 'all' || !cur.range), radio('range', 'current', t('fixed.rangeCurrent'), cur.range === 'current'), radio('range', 'selection', t('fixed.rangeSelection'), cur.range === 'selection'),
    h('div', { class: 'sv-pages' }, radio('range', 'pages', t('fixed.rangePages'), cur.range === 'pages'), from, h('span', {}, t('fixed.to')), to));
  for (const x of [from, to]) x.addEventListener('input', () => { rangeBox.querySelector('[value="pages"]').checked = true; });
  const what = h('fieldset', { class: 'sv-fieldset' }, h('legend', {}, t('fixed.publishWhat')), radio('what', 'document', t('fixed.document'), !cur.markup), radio('what', 'markup', t('fixed.markup'), cur.markup));
  const parts = [rangeBox, what];
  const checks = {};
  if (kind === 'pdf') {
    checks.bookmarks = check(t('fixed.bookmarks'), cur.bookmarks !== false, { 'data-option': 'bookmarks' });
    checks.properties = check(t('fixed.properties'), cur.properties !== false, { 'data-option': 'properties' });
    checks.tagged = check(t('fixed.tagged'), cur.tagged !== false, { 'data-option': 'tagged' });
    checks.pdfa = check(t('fixed.pdfa'), !!cur.pdfa, { 'data-option': 'pdfa' });
    const opt = h('fieldset', { class: 'sv-fieldset' }, h('legend', {}, t('fixed.optimize')), radio('opt', 'standard', t('fixed.standard'), !cur.minimumSize), radio('opt', 'minimum', t('fixed.minimum'), cur.minimumSize));
    parts.push(h('fieldset', { class: 'sv-fieldset' }, h('legend', {}, t('fixed.include')), checks.bookmarks, checks.properties, checks.tagged, checks.pdfa), opt);
    // PDF/A needs the tags' companions: properties and embedded fonts (always).
    checks.pdfa.input.addEventListener('change', () => { if (checks.pdfa.input.checked) checks.properties.input.checked = true; });
  }
  const body = h('div', { class: 'sv-dlg sv-fixed' }, ...parts);
  const ok = await showDialog({ title: t(kind === 'pdf' ? 'fixed.pdfTitle' : 'fixed.xpsTitle'), message: body, buttons: [{ label: t('common.ok'), value: true, primary: true }, { label: t('common.cancel'), value: false }], cancelValue: false });
  if (!ok) return null;
  const val = (name) => body.querySelector(`input[name="${name}"]:checked`)?.value;
  const out = { range: val('range') || 'all', from: Number(from.value) || 1, to: Number(to.value) || pageCount, markup: val('what') === 'markup' };
  if (kind === 'pdf') Object.assign(out, { bookmarks: checks.bookmarks.input.checked, properties: checks.properties.input.checked, tagged: checks.tagged.input.checked, pdfa: checks.pdfa.input.checked, minimumSize: val('opt') === 'minimum' });
  return out;
}
