/**
 * Small form-building helpers for dialogs: labelled inputs, selects,
 * checkboxes, radio groups, colour inputs, length spinners and tabs.
 */
import { getSetting } from '../core/settings.js';
import { convert, parseUserLength, UNIT_DECIMALS } from '../layout/units.js';
import { h, uid } from './dom.js';

export function field(label, control, { wide = false } = {}) {
  const id = control.id || uid('f');
  control.id = id;
  return h('div', { class: `fm-field${wide ? ' wide' : ''}` }, h('label', { for: id, class: 'fm-label' }, label), control);
}

export const text = (value = '', attrs = {}) => h('input', { type: 'text', class: 'fm-input', value, spellcheck: 'false', ...attrs });
export const number = (value, attrs = {}) => h('input', { type: 'number', class: 'fm-input fm-num', value: String(value), ...attrs });

export function select(options, value, attrs = {}) {
  const el = h('select', { class: 'fm-select', ...attrs });
  for (const o of options) {
    const [v, label] = Array.isArray(o) ? o : [o, o];
    const opt = h('option', { value: v }, label);
    if (v === value) opt.selected = true;
    el.append(opt);
  }
  return el;
}

export function check(label, checked = false, attrs = {}) {
  const input = h('input', { type: 'checkbox', ...attrs });
  input.checked = !!checked;
  const el = h('label', { class: 'fm-check' }, input, label);
  el.input = input;
  return el;
}

export function radios(name, options, value) {
  const wrap = h('div', { class: 'fm-radios', role: 'radiogroup' });
  for (const [v, label] of options) {
    const input = h('input', { type: 'radio', name, value: v });
    if (v === value) input.checked = true;
    wrap.append(h('label', { class: 'fm-check' }, input, label));
  }
  wrap.value = () => wrap.querySelector('input:checked')?.value ?? null;
  return wrap;
}

export const colour = (value = '#000000', attrs = {}) => h('input', { type: 'color', class: 'fm-colour', value, ...attrs });

/**
 * A length input that accepts "1.5 cm", "12pt", '2"' or a bare number. Lengths
 * given in cm are shown in the measurement unit chosen in Options.
 */
export function length(valuePx, unit, attrs = {}) {
  const u = unit === 'cm' ? (getSetting('units') || 'cm') : unit;
  const el = h('input', { type: 'text', class: 'fm-input fm-len', value: `${+convert(valuePx, 'px', u).toFixed(UNIT_DECIMALS[u] ?? 2)} ${u}`, ...attrs });
  el.px = () => parseUserLength(el.value, u, 'px');
  return el;
}

/** Tabbed container: tabs = [[label, contentNode]]; `initial` = index of the tab shown first. */
export function tabs(list, initial = 0) {
  const bar = h('div', { class: 'fm-tabs', role: 'tablist' });
  const panels = h('div', { class: 'fm-panels' });
  list.forEach(([label, content], i) => {
    const id = uid('tp');
    const btn = h('button', { type: 'button', role: 'tab', class: 'fm-tab', 'aria-selected': String(i === initial), 'aria-controls': id }, label);
    const panel = h('div', { role: 'tabpanel', id, class: 'fm-panel', hidden: i !== initial }, content);
    btn.addEventListener('click', () => {
      bar.querySelectorAll('.fm-tab').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
      panels.querySelectorAll('.fm-panel').forEach((p) => { p.hidden = p !== panel; });
    });
    bar.append(btn);
    panels.append(panel);
  });
  return h('div', { class: 'fm-tabbed' }, bar, panels);
}

export const row = (...children) => h('div', { class: 'fm-row' }, ...children);
export const group = (title, ...children) => h('fieldset', { class: 'fm-group' }, h('legend', {}, title), ...children);
