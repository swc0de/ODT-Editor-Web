/**
 * Immersive Reader: the document as one comfortable column (no pages) with
 * reading aids — Column Width, Page Colour, Line Focus, Text Spacing,
 * Syllables and Read Aloud. The text stays editable.
 */
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { defineCommands } from '../define.js';
import { syllables } from '../../layout/hyphenate.js';

export const COLUMN_WIDTHS = { veryNarrow: 420, narrow: 540, moderate: 680, wide: 860 };
export const PAGE_COLOURS = { none: null, sepia: '#f4ecd8', inverse: '#111111', mint: '#e6f4ea', sky: '#e3eefc', rose: '#fbe7ec' };
const LINE_FOCUS = { none: 0, one: 1, three: 3, five: 5 };

const on = (c) => c.state.view === 'immersive';
const pick = (key, value) => ({ isEnabled: on, isChecked: (c) => on(c) && c.state[key] === value, run: (c) => c.store.set({ [key]: value }) });

export const commands = defineCommands('immersiveReader', {
  columnWidth: { icon: 'column-width', isEnabled: on, menuOnly: true },
  ...Object.fromEntries(Object.entries(COLUMN_WIDTHS).map(([k, v]) => [`col_${k}`, pick('irColumnWidth', v)])),
  pageColour: { icon: 'page-colour-ir', isEnabled: on, menuOnly: true },
  ...Object.fromEntries(Object.keys(PAGE_COLOURS).map((k) => [`colour_${k}`, pick('irPageColour', k)])),
  lineFocus: { icon: 'line-focus', isEnabled: on, menuOnly: true },
  ...Object.fromEntries(Object.entries(LINE_FOCUS).map(([k, v]) => [`focus_${k}`, pick('irLineFocus', v)])),
  textSpacing: { icon: 'text-spacing', isEnabled: on, isChecked: (c) => on(c) && !!c.state.irTextSpacing, run: (c) => c.store.set((s) => ({ irTextSpacing: !s.irTextSpacing })) },
  syllables: { icon: 'syllables', isEnabled: on, isChecked: (c) => on(c) && !!c.state.irSyllables, run: (c) => c.store.set((s) => ({ irSyllables: !s.irSyllables })) },
  readAloud: { icon: 'read-aloud', isEnabled: (c) => on(c) && c.ui.registry.isEnabled('review.readAloud'), isChecked: (c) => !!c.state.readingAloud, run: (c) => c.ui.registry.run('review.readAloud') },
  close: { icon: 'close-view', isEnabled: on, run: (c) => c.store.set({ view: 'print', activeTab: 'view' }) },
});

export const ribbon = {
  id: 'immersiveReader',
  keytip: 'I',
  contextual: 'immersive',
  groups: [
    {
      id: 'reading', icon: 'immersive-reader',
      controls: [
        { t: 'large', cmd: 'columnWidth', label: 'label.immersiveReader.columnWidth', menu: Object.keys(COLUMN_WIDTHS).map((k) => `col_${k}`) },
        { t: 'large', cmd: 'pageColour', label: 'label.immersiveReader.pageColour', menu: Object.keys(PAGE_COLOURS).map((k) => `colour_${k}`) },
        { t: 'large', cmd: 'lineFocus', label: 'label.immersiveReader.lineFocus', menu: Object.keys(LINE_FOCUS).map((k) => `focus_${k}`) },
        { t: 'large', cmd: 'textSpacing', label: 'label.immersiveReader.textSpacing' },
        { t: 'large', cmd: 'syllables' },
        { t: 'large', cmd: 'readAloud', label: 'label.immersiveReader.readAloud' },
      ],
    },
    { id: 'close', icon: 'close-view', controls: [{ t: 'large', cmd: 'close', label: 'label.immersiveReader.close' }] },
  ],
};

export function register(registry) { registry.register(commands); }

// ------------------------------------------------------------ syllables

export const syllableKey = new PluginKey('irSyllables');

/** Middle dots between syllables (widgets; the text is unchanged). */
export function syllablePlugin(isOn) {
  const compute = (doc) => {
    const decos = [];
    doc.descendants((node, pos) => {
      if (!node.isText) return true;
      const re = /\p{L}{4,}/gu;
      let m;
      while ((m = re.exec(node.text))) {
        for (const off of syllables(m[0])) {
          decos.push(Decoration.widget(pos + m.index + off, () => {
            const el = document.createElement('span');
            el.className = 'ir-syl';
            el.textContent = '·';
            el.setAttribute('aria-hidden', 'true');
            return el;
          }, { side: -1, key: 'syl', ignoreSelection: true }));
        }
      }
      return false;
    });
    return DecorationSet.create(doc, decos);
  };
  return new Plugin({
    key: syllableKey,
    state: {
      init: () => null,
      apply(tr, old, _o, state) {
        if (!isOn()) return null;
        if (old && !tr.docChanged) return old;
        return compute(state.doc);
      },
    },
    props: { decorations: (state) => syllableKey.getState(state) },
  });
}

// ------------------------------------------------------------ line focus

/**
 * Line Focus: dims everything except 1, 3 or 5 lines around the caret.
 * o = { host (positioned element over the canvas), canvas, getView, lines() }
 */
export function createLineFocus(o) {
  const top = document.createElement('div');
  const bottom = document.createElement('div');
  top.className = 'ir-mask ir-mask-top';
  bottom.className = 'ir-mask ir-mask-bottom';
  top.hidden = true;
  bottom.hidden = true;
  o.host.append(top, bottom);
  let frame = 0;
  function place() {
    frame = 0;
    const n = o.lines();
    if (!n) { top.hidden = true; bottom.hidden = true; return; }
    const view = o.getView();
    let c;
    try { c = view.coordsAtPos(view.state.selection.head); } catch { return; }
    const host = o.host.getBoundingClientRect();
    const lh = Math.max(12, c.bottom - c.top) * 1.15;
    const half = ((n - 1) / 2) * lh;
    const y0 = c.top - host.top - half - lh * 0.1;
    const y1 = c.bottom - host.top + half + lh * 0.1;
    top.hidden = false;
    bottom.hidden = false;
    top.style.height = `${Math.max(0, y0)}px`;
    bottom.style.top = `${y1}px`;
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(place); };
  o.canvas.addEventListener('scroll', schedule, { passive: true });
  return { update: schedule };
}
