/**
 * Review ▸ Proofing and Language: Spelling & Grammar (the Editor pane),
 * Word Count, Language (mark text as a language or as not to be checked).
 */
import { TextSelection } from 'prosemirror-state';
import { documentStats } from '../../core/document.js';
import { applyTextProps } from '../../core/commands/text.js';
import { recheckAll } from '../../core/proofing.js';
import { wordCountDialog, languageDialog } from '../../ui/review-dialogs.js';
import { t } from '../../i18n/index.js';

export const LANGUAGES = [
  ['en-GB', 'English (United Kingdom)'], ['en-US', 'English (United States)'], ['en-AU', 'English (Australia)'], ['en-CA', 'English (Canada)'],
  ['en-IE', 'English (Ireland)'], ['fr-FR', 'French (France)'], ['de-DE', 'German (Germany)'], ['es-ES', 'Spanish (Spain)'], ['it-IT', 'Italian (Italy)'],
  ['nl-NL', 'Dutch (Netherlands)'], ['pt-PT', 'Portuguese (Portugal)'], ['pt-BR', 'Portuguese (Brazil)'], ['sv-SE', 'Swedish (Sweden)'], ['da-DK', 'Danish (Denmark)'],
  ['nb-NO', 'Norwegian Bokmål (Norway)'], ['fi-FI', 'Finnish (Finland)'], ['pl-PL', 'Polish (Poland)'], ['cy-GB', 'Welsh (United Kingdom)'], ['ga-IE', 'Irish (Ireland)'],
];

/** Word Count: the body, or with text boxes, footnotes and endnotes. */
export function countStats(c, includeNotes) {
  const doc = c.mainEditor.view.state.doc;
  const s = documentStats(doc);
  if (includeNotes) {
    const add = (body) => {
      for (const b of body || []) {
        const text = JSON.stringify(b).match(/"text":"((?:[^"\\]|\\.)*)"/g)?.map((x) => JSON.parse(`{${x}}`).text).join(' ') || '';
        s.words += (text.match(/[\p{L}\p{N}]+(?:['’\-.][\p{L}\p{N}]+)*/gu) || []).length;
        s.chars += text.length;
        s.charsNoSpace += text.replace(/\s/g, '').length;
        s.paragraphs++;
      }
    };
    doc.descendants((n) => { if (n.type.name === 'note' || (n.type.name === 'frame' && n.attrs.body?.length)) add(n.attrs.body); return true; });
  }
  s.pages = c.ui.docArea?.pages.length || 1;
  // Lines: distinct line boxes of the paragraphs as laid out.
  let lines = 0;
  for (const p of c.mainEditor.view.dom.querySelectorAll('p, h1, h2, h3, h4, h5, h6')) {
    const r = document.createRange();
    r.selectNodeContents(p);
    const tops = new Set([...r.getClientRects()].map((x) => Math.round(x.top)));
    lines += Math.max(tops.size, p.textContent.trim() ? 1 : 0);
  }
  s.lines = lines;
  return s;
}

export function wordCount(c) {
  return wordCountDialog(countStats(c, false), (notes) => countStats(c, notes));
}

/** The language at the selection: 'en-GB' etc., and whether it's marked not to be checked. */
function currentLanguage(c) {
  const st = c.editor.view.state;
  const marks = st.selection.$from.marks();
  const a = marks.find((m) => m.type.name === 'textProps')?.attrs.auto?.props?.['style:text-properties']?.a || {};
  if (a['fo:language'] === 'zxx') return { lang: 'en-GB', noProof: true };
  if (a['fo:language']) return { lang: `${a['fo:language']}-${a['fo:country'] || ''}`.replace(/-$/, ''), noProof: false };
  return { lang: 'en-GB', noProof: false };
}

/** Language dialog: marks the selection (or the paragraph) as a language. */
export async function setLanguage(c) {
  const cur = currentLanguage(c);
  const r = await languageDialog(LANGUAGES, cur.lang, cur.noProof);
  if (!r) return;
  const view = c.editor.view;
  const [lang, country] = r.lang.split('-');
  const change = r.noProof ? { 'fo:language': 'zxx', 'fo:country': 'none' } : { 'fo:language': lang, 'fo:country': country || null };
  // With no selection, the whole paragraph.
  if (view.state.selection.empty) {
    const $f = view.state.selection.$from;
    const st = view.state.apply(view.state.tr.setSelection(TextSelection.create(view.state.doc, $f.start(), $f.end())));
    applyTextProps(st, (tr) => mergeInto(view, tr), c.ui.docArea.styleIndex, change);
  } else applyTextProps(view.state, view.dispatch, c.ui.docArea.styleIndex, change);
  c.store.set({ language: r.noProof ? null : r.lang });
  recheckAll(c.mainEditor.view);
  view.focus();
}

/** Applies a transaction built on a derived state to the view. */
function mergeInto(view, tr) {
  const out = view.state.tr;
  for (const s of tr.steps) out.step(s);
  view.dispatch(out);
  return true;
}

export const languageLabel = (code) => (LANGUAGES.find(([c]) => c === code)?.[1]) || t('lang.en-GB');
