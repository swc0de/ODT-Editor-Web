/**
 * Sources and citations. A source is a CSL-JSON item (the format citeproc-js
 * and Zotero use). The document's sources and its citation style live in
 * state.bibliography = { style, sources } and are saved in the package as
 * Bibliography/sources.json; every citation in the text is also an ODF
 * text:bibliography-mark carrying the source's fields, so LibreOffice (and
 * a re-import without the JSON) still knows each cited source.
 *
 * Importers: BibTeX, RIS and CSL-JSON (what Zotero, Mendeley and most
 * reference managers export).
 */

export const CITATION_STYLES = ['apa', 'mla', 'chicago', 'ieee', 'harvard'];
export const SOURCES_FILE = 'Bibliography/sources.json';

/** The kinds of source offered in the Create Source dialog: CSL type → ODF bibliography-type. */
export const SOURCE_TYPES = [
  ['book', 'book'],
  ['chapter', 'inbook'],
  ['article-journal', 'article'],
  ['article-magazine', 'journal'],
  ['article-newspaper', 'journal'],
  ['paper-conference', 'inproceedings'],
  ['report', 'techreport'],
  ['thesis', 'phdthesis'],
  ['webpage', 'www'],
  ['manuscript', 'unpublished'],
  ['document', 'misc'],
];
const CSL_TO_ODF = Object.fromEntries(SOURCE_TYPES);
const ODF_TO_CSL = {
  article: 'article-journal', book: 'book', booklet: 'book', conference: 'paper-conference', inbook: 'chapter', incollection: 'chapter',
  inproceedings: 'paper-conference', journal: 'article-magazine', manual: 'report', mastersthesis: 'thesis', misc: 'document', phdthesis: 'thesis',
  proceedings: 'book', techreport: 'report', unpublished: 'manuscript', www: 'webpage', email: 'personal_communication',
};

// ------------------------------------------------------------------ names

/** "Family, Given" or "Given Family" → { family, given }; a {Braced} name stays whole. */
export function parseName(s) {
  s = String(s).trim();
  if (!s) return null;
  if (/^\{.*\}$/.test(s)) return { literal: s.slice(1, -1) };
  if (s.includes(',')) {
    const [family, ...rest] = s.split(',');
    return { family: family.trim(), given: rest.join(',').trim() };
  }
  const parts = s.split(/\s+/);
  if (parts.length === 1) return { family: parts[0] };
  // Particles stay with the family name ("Ludwig van Beethoven").
  let i = parts.length - 1;
  while (i > 1 && /^(van|von|der|de|da|di|du|la|le|del|dos|ten|ter)$/i.test(parts[i - 1])) i--;
  return { family: parts.slice(i).join(' '), given: parts.slice(0, i).join(' ') };
}

/** Names separated by " and " or ";" → CSL names. */
export const parseNames = (s) => String(s || '').split(/\s+and\s+|;/i).map(parseName).filter(Boolean);

/** CSL names → "Family, Given; Family, Given" */
export const namesText = (list) => (list || []).map((n) => n.literal || [n.family, n.given].filter(Boolean).join(', ')).join('; ');

export const yearOf = (item) => String(item?.issued?.['date-parts']?.[0]?.[0] ?? item?.issued?.literal ?? '');

/** A short label for lists: "Author (Year) Title". */
export function sourceLabel(item) {
  if (item.placeholder) return item.id;
  const a = item.author?.[0];
  const who = a ? (a.literal || a.family) : item.editor?.[0]?.family || '';
  const y = yearOf(item);
  return [who, y && `(${y})`, item.title].filter(Boolean).join(' ');
}

/** A tag (citation key) not used yet: "Smi20", "Smi201"… */
export function uniqueTag(item, used) {
  const a = item.author?.[0];
  const base = (`${(a?.family || a?.literal || item.title || 'Src').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 3)}${yearOf(item).slice(-2)}`) || 'Src';
  let tag = base;
  let i = 1;
  while (used.has(tag)) tag = `${base}${i++}`;
  return tag;
}

// ------------------------------------------------------------------ ODF marks

/** text:bibliography-mark attributes for a source. */
export function markAttrs(item) {
  const a = { 'text:identifier': item.id, 'text:bibliography-type': CSL_TO_ODF[item.type] || 'misc' };
  const set = (k, v) => { if (v != null && String(v).trim()) a[`text:${k}`] = String(v); };
  set('author', namesText(item.author));
  set('editor', namesText(item.editor));
  set('title', item.title);
  set('year', yearOf(item));
  const month = item.issued?.['date-parts']?.[0]?.[1];
  if (month) set('month', month);
  const container = item['container-title'];
  if (item.type === 'chapter' || item.type === 'paper-conference') set('booktitle', container);
  else if (item.type?.startsWith('article')) set('journal', container);
  else set('series', item['collection-title'] || null);
  set('publisher', item.publisher);
  set('address', item['publisher-place']);
  set('volume', item.volume);
  set('number', item.issue || item.number);
  set('pages', item.page);
  set('edition', item.edition);
  set('isbn', item.ISBN);
  set('issn', item.ISSN);
  set('url', item.URL || (item.DOI ? `https://doi.org/${item.DOI}` : null));
  set('note', item.note);
  if (item.type === 'thesis' || item.type === 'report') set(item.type === 'thesis' ? 'school' : 'institution', item.publisher);
  if (item.type === 'chapter') set('chapter', item['chapter-number']);
  return a;
}

/** A source from a text:bibliography-mark's attributes. */
export function itemFromMark(a) {
  const g = (k) => a[`text:${k}`] || '';
  const type = ODF_TO_CSL[g('bibliography-type')] || 'document';
  const item = { id: g('identifier') || 'Source', type };
  if (g('author')) item.author = parseNames(g('author'));
  if (g('editor')) item.editor = parseNames(g('editor'));
  if (g('title')) item.title = g('title');
  if (g('year')) item.issued = { 'date-parts': [[Number(g('year')) || g('year'), ...(Number(g('month')) ? [Number(g('month'))] : [])]] };
  const container = g('journal') || g('booktitle');
  if (container) item['container-title'] = container;
  if (g('series')) item['collection-title'] = g('series');
  const pub = g('publisher') || g('school') || g('institution') || g('organizations');
  if (pub) item.publisher = pub;
  if (g('address')) item['publisher-place'] = g('address');
  for (const [k, v] of [['volume', 'volume'], ['number', 'issue'], ['pages', 'page'], ['edition', 'edition'], ['isbn', 'ISBN'], ['issn', 'ISSN'], ['url', 'URL'], ['note', 'note'], ['chapter', 'chapter-number']]) if (g(k)) item[v] = g(k);
  return item;
}

// ------------------------------------------------------------------ BibTeX

const BIB_TYPES = {
  article: 'article-journal', book: 'book', booklet: 'book', inbook: 'chapter', incollection: 'chapter', inproceedings: 'paper-conference',
  conference: 'paper-conference', proceedings: 'book', manual: 'report', mastersthesis: 'thesis', phdthesis: 'thesis', techreport: 'report',
  report: 'report', thesis: 'thesis', unpublished: 'manuscript', misc: 'document', online: 'webpage', electronic: 'webpage', www: 'webpage', webpage: 'webpage',
};
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const ACCENTS = { '`': '̀', "'": '́', '^': '̂', '~': '̃', '=': '̄', '.': '̇', '"': '̈', c: '̧', v: '̌', u: '̆', H: '̋', r: '̊', k: '̨' };

/** LaTeX accents, escapes and braces → plain Unicode text. */
export function latexToText(s) {
  return String(s)
    .replace(/\\([`'^~=."cvuHrk])\s*\{?\\?([A-Za-z])\}?/g, (m, acc, ch) => (ACCENTS[acc] ? (ch + ACCENTS[acc]).normalize('NFC') : m))
    .replace(/\\(ss|ae|AE|oe|OE|o|O|l|L|aa|AA)\b\s*/g, (_, w) => ({ ss: 'ß', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', o: 'ø', O: 'Ø', l: 'ł', L: 'Ł', aa: 'å', AA: 'Å' }[w]))
    .replace(/\\textendash\b|--/g, '–').replace(/\\textemdash\b|---/g, '—')
    .replace(/\\(?:textit|emph|textbf|textsc|textrm|mathrm)\{([^}]*)\}/g, '$1')
    .replace(/\\([&%$#_{}])/g, '$1')
    .replace(/~/g, ' ')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parses BibTeX / BibLaTeX text → CSL items. */
export function parseBibTeX(text) {
  const items = [];
  const strings = {};
  let i = 0;
  const n = text.length;
  const skipWs = () => { while (i < n && /\s/.test(text[i])) i++; };
  const readBraced = () => {
    const open = text[i];
    const close = open === '{' ? '}' : ')';
    let depth = 0;
    const start = i + 1;
    for (; i < n; i++) {
      if (text[i] === '\\') { i++; continue; }
      if (text[i] === open) depth++;
      else if (text[i] === close && --depth === 0) { i++; return text.slice(start, i - 1); }
    }
    return text.slice(start);
  };
  while (i < n) {
    const at = text.indexOf('@', i);
    if (at < 0) break;
    i = at + 1;
    const typeM = /^[A-Za-z]+/.exec(text.slice(i));
    if (!typeM) continue;
    const type = typeM[0].toLowerCase();
    i += typeM[0].length;
    skipWs();
    if (text[i] !== '{' && text[i] !== '(') continue;
    const body = readBraced();
    if (type === 'comment' || type === 'preamble') continue;
    // Parse "key, field = value, …" inside the entry.
    const fields = {};
    let key = '';
    {
      let j = 0;
      const t = body;
      if (type === 'string') {
        const m = /^\s*([^=\s]+)\s*=\s*([\s\S]*)$/.exec(t);
        if (m) { const sub = parseValueIn(m[2]); strings[m[1].toLowerCase()] = sub; }
        continue;
      }
      const kc = t.indexOf(',');
      key = (kc < 0 ? t : t.slice(0, kc)).trim();
      j = kc < 0 ? t.length : kc + 1;
      while (j < t.length) {
        const m = /^\s*([A-Za-z][\w:-]*)\s*=\s*/.exec(t.slice(j));
        if (!m) break;
        j += m[0].length;
        // Reuse the value reader on the entry body.
        const sub = { s: t, j };
        const v = valueAt(sub);
        j = sub.j;
        fields[m[1].toLowerCase()] = v;
        const c = /^\s*,?/.exec(t.slice(j));
        j += c[0].length;
      }
    }
    items.push(bibToCsl(type, key, fields));
  }
  return items;

  function parseValueIn(s) { const sub = { s, j: 0 }; return valueAt(sub); }
  function valueAt(sub) {
    const t = sub.s;
    let out = '';
    const ws = () => { while (sub.j < t.length && /\s/.test(t[sub.j])) sub.j++; };
    for (;;) {
      ws();
      const ch = t[sub.j];
      if (ch === '{') {
        let depth = 0;
        const start = sub.j + 1;
        for (; sub.j < t.length; sub.j++) {
          if (t[sub.j] === '\\') { sub.j++; continue; }
          if (t[sub.j] === '{') depth++;
          else if (t[sub.j] === '}' && --depth === 0) break;
        }
        out += t.slice(start, sub.j);
        sub.j++;
      } else if (ch === '"') {
        let depth = 0;
        const start = ++sub.j;
        for (; sub.j < t.length; sub.j++) {
          if (t[sub.j] === '\\') { sub.j++; continue; }
          if (t[sub.j] === '{') depth++;
          else if (t[sub.j] === '}') depth--;
          else if (t[sub.j] === '"' && depth === 0) break;
        }
        out += t.slice(start, sub.j);
        sub.j++;
      } else {
        const m = /^[^,#\s}]+/.exec(t.slice(sub.j));
        const word = m ? m[0] : '';
        sub.j += word.length;
        out += /^\d+$/.test(word) ? word : (strings[word.toLowerCase()] ?? MONTHS[word.toLowerCase().slice(0, 3)] ?? word);
      }
      ws();
      if (t[sub.j] === '#') { sub.j++; continue; }
      return out;
    }
  }
}

function bibToCsl(type, key, f) {
  const item = { id: key || `bib${Math.random().toString(36).slice(2, 7)}`, type: BIB_TYPES[type] || 'document' };
  const txt = (k) => (f[k] != null ? latexToText(f[k]) : '');
  if (f.author) item.author = splitBibNames(f.author);
  if (f.editor) item.editor = splitBibNames(f.editor);
  if (f.title) item.title = txt('title');
  const container = txt('journal') || txt('journaltitle') || txt('booktitle');
  if (container) item['container-title'] = container;
  if (f.series) item['collection-title'] = txt('series');
  const year = txt('year') || (txt('date').match(/\d{4}/) || [''])[0];
  if (year) {
    const parts = [Number(year) || year];
    const mon = Number(txt('month')) || MONTHS[txt('month').toLowerCase().slice(0, 3)];
    if (mon) parts.push(mon);
    item.issued = { 'date-parts': [parts] };
  }
  const pub = txt('publisher') || txt('school') || txt('institution') || txt('organization');
  if (pub) item.publisher = pub;
  if (f.address || f.location) item['publisher-place'] = txt('address') || txt('location');
  const map = { volume: 'volume', number: 'issue', pages: 'page', edition: 'edition', isbn: 'ISBN', issn: 'ISSN', url: 'URL', doi: 'DOI', note: 'note', chapter: 'chapter-number', abstract: 'abstract' };
  for (const [k, v] of Object.entries(map)) if (f[k]) item[v] = txt(k);
  if (item.page) item.page = item.page.replace(/\s*[-–]+\s*/, '–');
  if (type === 'mastersthesis') item.genre = "Master's thesis";
  if (type === 'phdthesis') item.genre = 'PhD thesis';
  return item;
}

function splitBibNames(s) {
  return s.split(/\s+and\s+/i).map((x) => {
    const raw = x.trim();
    if (/^\{[^{}]*\}$/.test(raw)) return { literal: latexToText(raw) };
    return parseName(latexToText(raw));
  }).filter(Boolean);
}

// ------------------------------------------------------------------ RIS

const RIS_TYPES = {
  JOUR: 'article-journal', JFULL: 'article-journal', MGZN: 'article-magazine', NEWS: 'article-newspaper', BOOK: 'book', EBOOK: 'book', EDBOOK: 'book',
  CHAP: 'chapter', ECHAP: 'chapter', CONF: 'paper-conference', CPAPER: 'paper-conference', RPRT: 'report', THES: 'thesis', ELEC: 'webpage', WEB: 'webpage',
  UNPB: 'manuscript', MANSCPT: 'manuscript', GEN: 'document',
};

/** Parses RIS text → CSL items. */
export function parseRIS(text) {
  const items = [];
  let cur = null;
  let startPage = '';
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z][A-Z0-9])  - ?(.*)$/.exec(line);
    if (!m) continue;
    const [, tag, raw] = m;
    const v = raw.trim();
    if (tag === 'TY') { cur = { id: '', type: RIS_TYPES[v] || 'document' }; startPage = ''; continue; }
    if (!cur) continue;
    switch (tag) {
      case 'ER': if (cur.page == null && startPage) cur.page = startPage; items.push(cur); cur = null; break;
      case 'AU': case 'A1': case 'A2': case 'A3': case 'ED': {
        const key = tag === 'ED' || tag === 'A2' && cur.type === 'chapter' ? 'editor' : 'author';
        (cur[key] ??= []).push(parseName(v));
        break;
      }
      case 'TI': case 'T1': cur.title = v; break;
      case 'T2': case 'JO': case 'JF': case 'JA': case 'BT': if (!cur['container-title']) cur['container-title'] = v; break;
      case 'T3': cur['collection-title'] = v; break;
      case 'PY': case 'Y1': case 'DA': {
        const d = v.split(/[/-]/).map((x) => Number(x)).filter((x) => x);
        if (d.length && !cur.issued) cur.issued = { 'date-parts': [d.slice(0, 3)] };
        break;
      }
      case 'VL': cur.volume = v; break;
      case 'IS': cur.issue = v; break;
      case 'SP': startPage = v; break;
      case 'EP': cur.page = startPage ? `${startPage}–${v}` : v; break;
      case 'PB': cur.publisher = v; break;
      case 'CY': cur['publisher-place'] = v; break;
      case 'SN': if (/^[\d-]{8,9}X?$/i.test(v)) cur.ISSN = v; else cur.ISBN = v; break;
      case 'UR': cur.URL = cur.URL || v; break;
      case 'DO': cur.DOI = v; break;
      case 'ET': cur.edition = v; break;
      case 'AB': cur.abstract = v; break;
      case 'N1': cur.note = v; break;
      case 'ID': cur.id = v; break;
      default: break;
    }
  }
  return items;
}

// ------------------------------------------------------------------ CSL-JSON

/** Parses CSL-JSON (an array of items, or one item) → CSL items. */
export function parseCslJson(text) {
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data : data.items || [data];
  return list.filter((x) => x && typeof x === 'object').map((x) => ({ ...x, id: String(x.id ?? x['citation-key'] ?? '') }));
}

/** Detects the format of reference-manager text and parses it. */
export function parseSources(text, name = '') {
  const s = text.trim();
  if (/\.json$/i.test(name) || s.startsWith('[') || s.startsWith('{')) return parseCslJson(s);
  if (/\.ris$/i.test(name) || /^TY {2}-/m.test(s)) return parseRIS(s);
  return parseBibTeX(s);
}

/** Gives every item a unique, non-empty tag (id), keeping existing ones where possible. */
export function withUniqueIds(items, used = new Set()) {
  return items.map((it) => {
    let id = String(it.id || '').trim();
    if (!id || used.has(id)) id = uniqueTag(it, used);
    used.add(id);
    return { ...it, id };
  });
}
