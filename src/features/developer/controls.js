/**
 * Developer ▸ Controls: content controls (LibreOffice's loext:content-control,
 * which LibreOffice also makes from Word's content controls). A control is a
 * contentControl mark on its content. Behaviour:
 *   placeholder  — clicking selects the whole placeholder so typing replaces it
 *   check box    — click toggles between the checked and unchecked symbols
 *   drop-down / combo box — click opens the list (a combo box can be typed in too)
 *   date picker  — click opens a calendar; the date is written in the control's format
 *   picture      — click to choose a picture
 *   locking      — "contents cannot be edited" / "control cannot be deleted"
 * Restrict Editing ▸ Filling in forms allows changes only inside controls.
 */
import { Plugin, PluginKey, TextSelection, NodeSelection } from 'prosemirror-state';
import { ReplaceStep, AddMarkStep, RemoveMarkStep } from 'prosemirror-transform';
import { schema } from '../../core/schema.js';

export const ccKey = new PluginKey('contentControls');
export const PLACEHOLDER = { rich: 'Click or tap here to enter text.', plain: 'Click or tap here to enter text.', date: 'Click or tap to enter a date.', dropdown: 'Choose an item.', combobox: 'Choose an item.' };

export const kindOf = (a = {}) => (a['loext:checkbox'] === 'true' ? 'checkbox' : a['loext:combobox'] === 'true' ? 'combobox' : a['loext:dropdown'] === 'true' ? 'dropdown' : a['loext:date'] === 'true' ? 'date' : a['loext:picture'] === 'true' ? 'picture' : a['loext:plain-text'] === 'true' ? 'plain' : 'rich');

/** The control around a position: { from, to, mark } (its whole extent) or null. */
export function controlAt(state, pos) {
  const $p = state.doc.resolve(pos);
  if (!$p.parent.inlineContent) return null;
  const start = $p.start();
  const end = $p.end();
  return controlsOf(state.doc).find((c) => c.from >= start && c.to <= end && c.from <= pos && pos <= c.to) || null;
}

/** Every control in the document: [{ from, to, mark }]. */
export function controlsOf(doc) {
  const out = [];
  doc.descendants((n, pos) => {
    if (!n.inlineContent) return true;
    let cur = null;
    n.forEach((ch, off) => {
      const m = ch.marks.find((x) => x.type.name === 'contentControl');
      const a = pos + 1 + off;
      if (m && cur && cur.mark.eq(m) && cur.to === a) cur.to = a + ch.nodeSize;
      else { if (cur) out.push(cur); cur = m ? { from: a, to: a + ch.nodeSize, mark: m } : null; }
    });
    if (cur) out.push(cur);
    return false;
  });
  return out;
}

const newId = () => String(Math.floor(Math.random() * 2 ** 31));

/** Attributes of a new control of a kind (in LibreOffice's order). */
export function controlAttrs(kind) {
  const a = {};
  if (kind !== 'checkbox' && kind !== 'picture') a['loext:showing-place-holder'] = 'true';
  if (kind === 'plain') a['loext:plain-text'] = 'true';
  if (kind === 'checkbox') Object.assign(a, { 'loext:checkbox': 'true', 'loext:checked': 'false', 'loext:checked-state': '☒', 'loext:unchecked-state': '☐' });
  if (kind === 'picture') a['loext:picture'] = 'true';
  if (kind === 'combobox') Object.assign(a, { 'loext:combobox': 'true', 'loext:dropdown': 'true' });
  if (kind === 'dropdown') a['loext:dropdown'] = 'true';
  if (kind === 'date') Object.assign(a, { 'loext:date': 'true', 'loext:date-format': 'dd/MM/yyyy', 'loext:date-rfc-language-tag': 'en-GB' });
  a['loext:id'] = newId();
  return a;
}

/** Replaces a control's content with text (keeping the control), with new attributes. */
export function setControl(tr, ctl, { text = null, attrs = null, items = null } = {}) {
  const mark = schema.marks.contentControl.create({ attrs: attrs || ctl.mark.attrs.attrs, items: items || ctl.mark.attrs.items });
  if (text != null) {
    const keep = tr.doc.nodeAt(ctl.from)?.marks.filter((m) => m.type.name !== 'contentControl') || [];
    tr.replaceWith(ctl.from, ctl.to, schema.text(text, mark.addToSet(keep)));
    return { from: ctl.from, to: ctl.from + text.length, mark };
  }
  tr.removeMark(ctl.from, ctl.to, schema.marks.contentControl);
  tr.addMark(ctl.from, ctl.to, mark);
  return { ...ctl, mark };
}

const withoutPlaceholder = (a) => { const { 'loext:showing-place-holder': _p, ...rest } = a; return rest; };

/** "dd/MM/yyyy"-style formats → text. */
export function formatDate(iso, fmt) {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const p2 = (n) => String(n).padStart(2, '0');
  return String(fmt || 'dd/MM/yyyy').replace(/dddd|ddd|dd|d|MMMM|MMM|MM|M|yyyy|yy/g, (k) => ({
    dddd: DAYS[d.getDay()], ddd: DAYS[d.getDay()].slice(0, 3), dd: p2(d.getDate()), d: String(d.getDate()),
    MMMM: MONTHS[d.getMonth()], MMM: MONTHS[d.getMonth()].slice(0, 3), MM: p2(d.getMonth() + 1), M: String(d.getMonth() + 1),
    yyyy: String(d.getFullYear()), yy: String(d.getFullYear()).slice(-2),
  }[k]));
}

// ------------------------------------------------------------------ plugin

/** Whether a transaction only changes text inside controls (Filling in forms). */
function insideControls(state, tr) {
  const list = controlsOf(state.doc);
  return tr.steps.every((step) => {
    if (!(step instanceof ReplaceStep) && !(step instanceof AddMarkStep) && !(step instanceof RemoveMarkStep)) return false;
    const { from, to } = step;
    return list.some((c) => from >= c.from && to <= c.to);
  });
}

/** Locked controls: contents can't be edited / the control can't be deleted. */
function violatesLock(state, tr) {
  for (const c of controlsOf(state.doc)) {
    const lock = c.mark.attrs.attrs['loext:lock'];
    if (!lock || lock === 'unlocked') continue;
    for (const step of tr.steps) {
      if (!(step instanceof ReplaceStep)) continue;
      const touches = step.from < c.to && step.to > c.from;
      if (!touches) continue;
      const whole = step.from <= c.from && step.to >= c.to;
      if ((lock === 'contentLocked' || lock === 'sdtContentLocked') && !whole) return true;
      if ((lock === 'sdtLocked' || lock === 'sdtContentLocked') && whole) return true;
    }
  }
  return false;
}

/**
 * o = { forms(): restrict is 'forms', openMenu(point, items), pickDate(point, iso) → Promise<iso|null>,
 *       pickPicture(pos), design(): Design Mode }
 */
export function controlsPlugin(o) {
  return new Plugin({
    key: ccKey,
    // The end of a control being typed into (typing there stays inside it), or null.
    state: {
      init: () => null,
      apply(tr, v) {
        const meta = tr.getMeta(ccKey);
        if (meta !== undefined) return meta;
        if (v == null) return null;
        const at = tr.mapping.map(v);
        if (tr.selectionSet && !(tr.selection.empty && tr.selection.from === at)) return null;
        return at;
      },
    },
    filterTransaction(tr, state) {
      if (!tr.docChanged || tr.getMeta('ccInternal') || tr.getMeta('load') || tr.getMeta('history$') || tr.getMeta('addToHistory') === false) return true;
      if (o.design?.()) return true;
      if (violatesLock(state, tr)) return false;
      if (o.forms?.() && !insideControls(state, tr)) return false;
      return true;
    },
    appendTransaction(trs, oldState, state) {
      // Typing into a placeholder ends it.
      if (!trs.some((t) => t.docChanged && !t.getMeta('ccInternal') && !t.getMeta('load'))) return null;
      let out = null;
      for (const c of controlsOf(state.doc)) {
        if (c.mark.attrs.attrs['loext:showing-place-holder'] !== 'true') continue;
        const text = state.doc.textBetween(c.from, c.to);
        const kind = kindOf(c.mark.attrs.attrs);
        if (text !== PLACEHOLDER[kind] && !(c.mark.attrs.items || []).some((i) => i.display === text && kind === 'none')) {
          out = out || state.tr;
          setControl(out, c, { attrs: withoutPlaceholder(c.mark.attrs.attrs) });
        }
      }
      return out ? out.setMeta('ccInternal', true) : null;
    },
    props: {
      attributes: () => (o.design?.() ? { class: 'cc-design' } : {}),
      // Typing over a whole control's content (a selected placeholder) keeps the control.
      handleTextInput(view, from, to, text) {
        let marks = null;
        if (from === to) {
          // Carry on typing inside a control that was just typed into (the mark isn't inclusive).
          if (ccKey.getState(view.state) !== from) return false;
          marks = view.state.doc.resolve(from).nodeBefore?.marks;
          if (!marks?.some((m) => m.type.name === 'contentControl')) return false;
        } else {
          // Typing over a whole control's content (a selected placeholder) keeps the control.
          const c = controlAt(view.state, from + 1);
          if (!c || c.from !== from || c.to !== to) return false;
          marks = view.state.doc.nodeAt(from)?.marks || [];
        }
        const tr = view.state.tr.replaceWith(from, to, schema.text(text, marks));
        tr.setSelection(TextSelection.create(tr.doc, from + text.length)).setMeta(ccKey, from + text.length);
        view.dispatch(tr);
        return true;
      },
      handleClick(view, pos, event) {
        if (o.design?.()) return false;
        const c = controlAt(view.state, pos);
        if (!c) return false;
        const a = c.mark.attrs.attrs;
        const kind = kindOf(a);
        if (o.forms?.() === false && !view.editable) return false;
        const point = { x: event.clientX, y: event.clientY + 4 };
        if (kind === 'checkbox') {
          const on = a['loext:checked'] !== 'true';
          const tr = view.state.tr;
          setControl(tr, c, { text: on ? (a['loext:checked-state'] || '☒') : (a['loext:unchecked-state'] || '☐'), attrs: { ...a, 'loext:checked': String(on) } });
          view.dispatch(tr.setMeta('ccInternal', true));
          return true;
        }
        if (kind === 'dropdown' || kind === 'combobox') {
          const items = c.mark.attrs.items || [];
          o.openMenu(point, items.map((it) => ({
            label: it.display,
            run: () => {
              const cur = controlAt(view.state, c.from + 1) || c;
              const tr = view.state.tr;
              setControl(tr, cur, { text: it.display, attrs: withoutPlaceholder(cur.mark.attrs.attrs) });
              view.dispatch(tr.setMeta('ccInternal', true));
              view.focus();
            },
          })));
          if (kind === 'dropdown') return true;
        }
        if (kind === 'date') {
          o.pickDate(point, a['loext:current-date'] || '').then((iso) => {
            if (!iso) return;
            const cur = controlAt(view.state, c.from + 1) || c;
            const at = cur.mark.attrs.attrs;
            const tr = view.state.tr;
            setControl(tr, cur, { text: formatDate(iso, at['loext:date-format']), attrs: { ...withoutPlaceholder(at), 'loext:current-date': `${iso.slice(0, 10)}T00:00:00Z` } });
            view.dispatch(tr.setMeta('ccInternal', true));
            view.focus();
          });
          return true;
        }
        if (kind === 'picture') {
          const n = view.state.doc.nodeAt(c.from);
          if (n?.type.name === 'frame') view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, c.from)));
          o.pickPicture?.(c.from);
          return true;
        }
        // A placeholder is selected whole, so typing replaces it.
        if (a['loext:showing-place-holder'] === 'true') {
          view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, c.from, c.to)));
          return true;
        }
        return false;
      },
    },
  });
}

export { withoutPlaceholder };
