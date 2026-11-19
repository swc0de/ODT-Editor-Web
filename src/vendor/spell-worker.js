/**
 * Spelling worker: nspell (MIT) with the en-GB and en-US Hunspell
 * dictionaries (wooorm/dictionaries, MIT AND BSD). Built as a separate
 * chunk, embedded in the page and run as a Web Worker from a blob: URL.
 *
 * Messages in:  { id, type: 'check', lang, words: [] }  → { id, misspelled: [] }
 *               { id, type: 'suggest', lang, word }     → { id, suggestions: [] }
 *               { type: 'add', words: [] }               (personal dictionary)
 */
import nspell from 'nspell';
import gbAff from '../../node_modules/dictionary-en-gb/index.aff';
import gbDic from '../../node_modules/dictionary-en-gb/index.dic';
import usAff from '../../node_modules/dictionary-en/index.aff';
import usDic from '../../node_modules/dictionary-en/index.dic';

const DICTS = { 'en-GB': [gbAff, gbDic], 'en-US': [usAff, usDic] };
const spellers = {};
const personal = [];

function speller(lang) {
  const key = DICTS[lang] ? lang : 'en-GB';
  if (!spellers[key]) {
    const [aff, dic] = DICTS[key];
    spellers[key] = nspell(aff, dic);
    for (const w of personal) spellers[key].add(w);
  }
  return spellers[key];
}

/** Damerau–Levenshtein distance; a swap of two letters counts as one edit. */
function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}
const sameLetters = (a, b) => [...a.toLowerCase()].sort().join('') === [...b.toLowerCase()].sort().join('');

/** Suggestions closest first: fewest edits, then the same letters (a typo swap), then nspell's order. */
function ranked(word, list) {
  return list.map((s, i) => ({ s, i, d: distance(word.toLowerCase(), s.toLowerCase()), same: sameLetters(word, s) ? 0 : 1 }))
    .sort((x, y) => x.d - y.d || x.same - y.same || x.i - y.i).map((x) => x.s);
}

/* global self */
self.onmessage = (e) => {
  const m = e.data || {};
  if (m.type === 'add') {
    for (const w of m.words || []) { personal.push(w); for (const s of Object.values(spellers)) s.add(w); }
    return;
  }
  const sp = speller(m.lang);
  if (m.type === 'check') {
    // A word passes as it is, or with its first letter lower-cased (sentence starts).
    const misspelled = (m.words || []).filter((w) => !sp.correct(w) && !(w[0] !== w[0].toLowerCase() && sp.correct(w[0].toLowerCase() + w.slice(1))));
    self.postMessage({ id: m.id, misspelled });
  } else if (m.type === 'suggest') {
    self.postMessage({ id: m.id, suggestions: ranked(m.word, sp.suggest(m.word)).slice(0, 8) });
  }
};
