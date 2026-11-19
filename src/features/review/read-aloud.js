/**
 * Review ▸ Read Aloud: reads the document from the caret (or the selection)
 * with the browser's speech synthesis, highlighting each word as it is read.
 * A small player floats over the document: previous / play-pause / next
 * paragraph, speed, voice, stop.
 */
import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { h } from '../../ui/dom.js';
import { t } from '../../i18n/index.js';
import { iconSvg } from '../../ui/icons.js';

export const readKey = new PluginKey('readAloud');
export const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';

/** Highlights the word being read. */
export function readAloudPlugin() {
  return new Plugin({
    key: readKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, set) {
        const m = tr.getMeta(readKey);
        if (m !== undefined) return m ? DecorationSet.create(tr.doc, [Decoration.inline(m.from, m.to, { class: 'ra-word' })]) : DecorationSet.empty;
        return set.map(tr.mapping, tr.doc);
      },
    },
    props: { decorations: (s) => readKey.getState(s) },
  });
}

/** Paragraphs from pos on: [{ from (pos of text start), text }] (textblock text with 1:1 offsets). */
function paragraphsFrom(doc, pos, to = null) {
  const out = [];
  doc.descendants((n, p) => {
    if (n.isTextblock) {
      const start = p + 1;
      const end = p + 1 + n.content.size;
      if (end >= pos && (to == null || start <= to)) {
        const text = n.textBetween(0, n.content.size, null, ' ');
        const a = Math.max(0, pos - start);
        const b = to == null ? text.length : Math.min(text.length, to - start);
        if (text.slice(a, b).trim()) out.push({ from: start + a, text: text.slice(a, b) });
      }
      return false;
    }
    return true;
  });
  return out;
}

export function createReadAloud({ store, getView, container }) {
  let player = null;
  let queue = [];
  let index = 0;
  let paused = false;
  let rate = 1;
  let voice = null;

  const highlight = (range) => { const v = getView(); v.dispatch(v.state.tr.setMeta(readKey, range).setMeta('addToHistory', false).setMeta('tcSkip', true).setMeta('pagination', true)); };

  function speak() {
    const synth = window.speechSynthesis;
    synth.cancel();
    if (index >= queue.length) { stop(); return; }
    const para = queue[index];
    const u = new SpeechSynthesisUtterance(para.text);
    u.rate = rate;
    u.lang = 'en-GB';
    if (voice) u.voice = voice;
    u.onboundary = (e) => {
      if (e.name && e.name !== 'word') return;
      const rest = para.text.slice(e.charIndex);
      const len = e.charLength || (rest.match(/^\S+/)?.[0].length ?? 1);
      highlight({ from: para.from + e.charIndex, to: para.from + e.charIndex + len });
    };
    u.onend = () => { if (store.get().readingAloud && !paused && queue[index] === para) { index++; speak(); } };
    highlight({ from: para.from, to: para.from + Math.min(para.text.length, para.text.search(/\s|$/) || 1) });
    const v = getView();
    try { v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, para.from)).scrollIntoView().setMeta('addToHistory', false)); } catch { /* position gone */ }
    synth.speak(u);
  }

  function buildPlayer() {
    const btn = (icon, label, fn) => h('button', { type: 'button', class: 'ra-btn', 'aria-label': label, 'data-tip': label, onclick: fn, html: iconSvg(icon, { size: 16 }) });
    const playBtn = btn('pause', t('ra.pause'), () => (paused ? resume() : pause()));
    const voices = window.speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang));
    const voiceSel = h('select', { class: 'ra-select', 'aria-label': t('ra.voice') }, h('option', { value: '' }, t('ra.defaultVoice')), ...voices.map((v) => h('option', { value: v.name }, `${v.name} (${v.lang})`)));
    voiceSel.addEventListener('change', () => { voice = voices.find((v) => v.name === voiceSel.value) || null; restartParagraph(); });
    const speed = h('input', { type: 'range', class: 'ra-speed', min: '0.5', max: '2', step: '0.25', value: String(rate), 'aria-label': t('ra.speed') });
    speed.addEventListener('change', () => { rate = Number(speed.value); restartParagraph(); });
    const el = h('div', { class: 'ra-player', role: 'toolbar', 'aria-label': t('ra.title') },
      btn('chevron-left', t('ra.previous'), () => { index = Math.max(0, index - 1); restartParagraph(); }),
      playBtn,
      btn('chevron-right', t('ra.next'), () => { index = Math.min(queue.length, index + 1); restartParagraph(); }),
      h('label', { class: 'ra-label' }, t('ra.speed'), speed), voiceSel,
      btn('close', t('ra.stop'), () => stop()));
    el.playBtn = playBtn;
    return el;
  }

  function restartParagraph() { paused = false; player?.playBtn && (player.playBtn.innerHTML = iconSvg('pause', { size: 16 })); speak(); }
  function pause() { paused = true; window.speechSynthesis.pause(); player.playBtn.innerHTML = iconSvg('play', { size: 16 }); player.playBtn.setAttribute('aria-label', t('ra.play')); }
  function resume() { paused = false; window.speechSynthesis.resume(); player.playBtn.innerHTML = iconSvg('pause', { size: 16 }); player.playBtn.setAttribute('aria-label', t('ra.pause')); }

  function start() {
    const v = getView();
    const { from, to, empty } = v.state.selection;
    queue = empty ? paragraphsFrom(v.state.doc, from) : paragraphsFrom(v.state.doc, from, to);
    if (!queue.length) queue = paragraphsFrom(v.state.doc, 0);
    index = 0;
    paused = false;
    store.set({ readingAloud: true });
    if (!player) { player = buildPlayer(); container().append(player); }
    speak();
  }

  function stop() {
    window.speechSynthesis?.cancel();
    store.set({ readingAloud: false });
    player?.remove();
    player = null;
    highlight(null);
  }

  return { start, stop, toggle: () => (store.get().readingAloud ? stop() : start()), get queue() { return queue; } };
}
