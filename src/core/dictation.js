/**
 * Dictate: the Web Speech API's speech recognition (en-GB) inserts what the
 * user says at the cursor. Only available where the browser supports it; the
 * Dictate button is disabled elsewhere.
 */
const Recognition = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;

export const dictationSupported = () => !!Recognition;

const PUNCTUATION = [
  [/\s*\b(full stop|period)\b/gi, '.'], [/\s*\bcomma\b/gi, ','], [/\s*\bquestion mark\b/gi, '?'],
  [/\s*\bexclamation mark\b/gi, '!'], [/\s*\bcolon\b/gi, ':'], [/\s*\bsemicolon\b/gi, ';'],
  [/\s*\bnew line\b\s*/gi, '\n'], [/\s*\bnew paragraph\b\s*/gi, '\n\n'],
];

export function createDictation({ editor, store, toast, t }) {
  let rec = null;

  function insert(text) {
    let s = text.trim();
    for (const [re, rep] of PUNCTUATION) s = s.replace(re, rep);
    if (!s) return;
    const view = editor.view;
    const { $from } = view.state.selection;
    const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 2), $from.parentOffset);
    if (before && !/\s$/.test(before) && !/^[.,?!:;\n]/.test(s)) s = ` ${s}`;
    if (!before.trim() || /[.?!]\s*$/.test(before)) s = s.replace(/^(\s*)(\p{L})/u, (_, a, b) => a + b.toUpperCase());
    const parts = s.split('\n');
    let tr = view.state.tr;
    parts.forEach((p, i) => {
      if (i > 0) tr = tr.split(tr.selection.from);
      if (p) tr = tr.insertText(p);
    });
    view.dispatch(tr.scrollIntoView());
  }

  function stop() {
    if (!rec) return;
    const r = rec;
    rec = null;
    try { r.stop(); } catch { /* already stopped */ }
    store.set({ dictating: false });
  }

  function start() {
    if (!Recognition) return;
    rec = new Recognition();
    rec.lang = 'en-GB';
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) insert(e.results[i][0].transcript);
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast(t('dictate.blocked'));
      else if (e.error !== 'no-speech' && e.error !== 'aborted') toast(t('dictate.error', { error: e.error }));
      stop();
    };
    rec.onend = () => { if (rec) stop(); };
    try {
      rec.start();
      store.set({ dictating: true });
      editor.focus();
      toast(t('dictate.listening'));
    } catch (err) {
      toast(t('dictate.error', { error: err.message }));
      rec = null;
    }
  }

  return { toggle: () => (rec ? stop() : start()), stop, isActive: () => !!rec };
}
