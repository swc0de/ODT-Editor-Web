/**
 * Command registry. Every user action is a command:
 *   { id, label, icon, shortcut, keywords, run(ctx, ...args),
 *     isEnabled(ctx), isChecked(ctx), comingSoon }
 * The ribbon, menus, keyboard shortcuts, the Alt+Q command search and the
 * tests all go through here. A command registered without `run` is treated
 * as "Coming soon": it is listed but disabled.
 *
 * Shortcuts use ProseMirror-style key names: "Mod-b", "Mod-Shift-=", "F12",
 * "Alt-q". "Mod" is Cmd on macOS and Ctrl elsewhere.
 */

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');

const MODIFIER_ORDER = ['Mod', 'Ctrl', 'Alt', 'Shift', 'Meta'];
const KEY_ALIASES = {
  esc: 'Escape', escape: 'Escape', enter: 'Enter', return: 'Enter', space: 'Space', ' ': 'Space',
  tab: 'Tab', backspace: 'Backspace', delete: 'Delete', del: 'Delete', up: 'ArrowUp', down: 'ArrowDown',
  left: 'ArrowLeft', right: 'ArrowRight', arrowup: 'ArrowUp', arrowdown: 'ArrowDown', arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight', home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown', plus: '+',
};

/**
 * Normalises a shortcut string to a canonical form, e.g.
 * "ctrl+shift+B" → "Ctrl-Shift-b", "Mod-Shift-=" → "Mod-Shift-=".
 * @param {string} shortcut
 * @param {{mac?: boolean, resolveMod?: boolean}} [opts] resolveMod turns Mod into Meta/Ctrl
 */
export function normalizeShortcut(shortcut, opts = {}) {
  if (!shortcut) return '';
  const mac = opts.mac ?? IS_MAC;
  // Split on "-" or "+" separators, but keep a trailing "-"/"+" key.
  const parts = [];
  let rest = String(shortcut).trim();
  while (rest.length) {
    const m = rest.match(/^(.+?)[-+](?=.)/);
    if (!m) { parts.push(rest); break; }
    parts.push(m[1]);
    rest = rest.slice(m[0].length);
  }
  const mods = new Set();
  let key = parts.pop();
  for (const raw of parts) {
    const p = raw.toLowerCase();
    if (p === 'mod') mods.add(opts.resolveMod ? (mac ? 'Meta' : 'Ctrl') : 'Mod');
    else if (p === 'ctrl' || p === 'control' || p === 'c') mods.add('Ctrl');
    else if (p === 'alt' || p === 'option' || p === 'a') mods.add('Alt');
    else if (p === 'shift' || p === 's') mods.add('Shift');
    else if (p === 'meta' || p === 'cmd' || p === 'command' || p === 'm') mods.add('Meta');
    else throw new Error(`Unknown modifier "${raw}" in shortcut "${shortcut}"`);
  }
  const alias = KEY_ALIASES[key.toLowerCase()];
  if (alias) key = alias;
  else if (key.length === 1) key = key.toLowerCase();
  else if (/^f\d{1,2}$/i.test(key)) key = key.toUpperCase();
  const ordered = MODIFIER_ORDER.filter((m) => mods.has(m));
  return [...ordered, key].join('-');
}

/** Canonical shortcut string for a KeyboardEvent (Mod resolved to Ctrl/Meta). */
export function eventToShortcut(event) {
  let key = event.key;
  if (!key || key === 'Unidentified' || key === 'Dead') return '';
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock'].includes(key)) return '';
  // With Shift held, event.key is the shifted character ("+" for "="); use the
  // physical key for printable characters so "Mod-Shift-=" matches.
  if (event.code && key.length === 1) {
    const c = event.code;
    if (/^Key[A-Z]$/.test(c)) key = c.slice(3).toLowerCase();
    else if (/^Digit\d$/.test(c)) key = c.slice(5);
    else if (CODE_KEYS[c]) key = CODE_KEYS[c];
  }
  if (key === ' ') key = 'Space';
  if (key.length === 1) key = key.toLowerCase();
  const mods = [];
  if (event.ctrlKey) mods.push('Ctrl');
  if (event.altKey) mods.push('Alt');
  if (event.shiftKey) mods.push('Shift');
  if (event.metaKey) mods.push('Meta');
  return [...mods, key].join('-');
}

const CODE_KEYS = {
  Equal: '=', Minus: '-', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'",
  Backquote: '`', Backslash: '\\', Comma: ',', Period: '.', Slash: '/', NumpadMultiply: '*',
  NumpadAdd: '+', NumpadSubtract: '-',
};

/** Human-readable shortcut: "Mod-Shift-=" → "Ctrl+Shift+=" (or "⌘⇧=" on macOS). */
export function formatShortcut(shortcut, opts = {}) {
  if (!shortcut) return '';
  const mac = opts.mac ?? IS_MAC;
  const parts = normalizeShortcut(shortcut, { mac }).split('-');
  // A trailing "-" key splits into ["…", "", ""]; repair it.
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === '' && i === parts.length - 1) { out[out.length - 1] = '-'; continue; }
    if (parts[i] === '') { out.push('-'); i++; continue; }
    out.push(parts[i]);
  }
  const names = mac
    ? { Mod: '⌘', Meta: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧' }
    : { Mod: 'Ctrl', Meta: 'Win', Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift' };
  const keyNames = { Space: 'Space', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc', Delete: 'Del' };
  const label = out.map((p, i) => (i < out.length - 1 ? names[p] || p : keyNames[p] || (p.length === 1 ? p.toUpperCase() : p)));
  return mac ? label.join('') : label.join('+');
}

export class CommandRegistry {
  /**
   * @param {{context?: () => any, translate?: (key: string) => string, mac?: boolean}} [opts]
   *   context: returns the object passed to run/isEnabled/isChecked.
   */
  constructor(opts = {}) {
    this._commands = new Map();
    this._byShortcut = new Map();
    this._listeners = new Set();
    this._context = opts.context || (() => ({}));
    this._translate = opts.translate || ((s) => s);
    this._mac = opts.mac ?? IS_MAC;
  }

  /** Registers a command (or an array of them). Returns the registry for chaining. */
  register(def) {
    if (Array.isArray(def)) { def.forEach((d) => this.register(d)); return this; }
    if (!def || typeof def.id !== 'string' || !def.id) throw new Error('Command needs a string id');
    if (this._commands.has(def.id)) throw new Error(`Duplicate command id "${def.id}"`);
    const cmd = {
      label: def.id,
      icon: null,
      shortcut: null,
      keywords: [],
      group: null,
      ...def,
      // menuOnly: a ▾ button whose items are the real commands (e.g. Interface Theme).
      comingSoon: def.comingSoon ?? (!def.menuOnly && typeof def.run !== 'function'),
      hidden: def.hidden ?? !!def.menuOnly,
    };
    cmd.shortcutHint = def.shortcutHint ? normalizeShortcut(def.shortcutHint, { mac: this._mac }) : null;
    const shortcuts = [].concat(cmd.shortcut || []);
    cmd.shortcuts = shortcuts.map((s) => normalizeShortcut(s, { mac: this._mac }));
    for (const s of cmd.shortcuts) {
      const resolved = normalizeShortcut(s, { mac: this._mac, resolveMod: true });
      if (this._byShortcut.has(resolved)) {
        throw new Error(`Shortcut ${s} of "${def.id}" is already used by "${this._byShortcut.get(resolved)}"`);
      }
      this._byShortcut.set(resolved, def.id);
    }
    this._commands.set(def.id, cmd);
    this.notify();
    return this;
  }

  /** The current command context (what run/isEnabled receive). */
  context() { return this._context(); }

  has(id) { return this._commands.has(id); }
  get(id) { return this._commands.get(id) || null; }
  all() { return [...this._commands.values()]; }

  /** Translated label of a command (labels may be i18n keys). */
  label(id) {
    const cmd = this.get(id);
    return cmd ? this._translate(cmd.label) : id;
  }

  /** Display string of the command's first shortcut. */
  shortcutText(id) {
    const cmd = this.get(id);
    const s = cmd && (cmd.shortcuts[0] || cmd.shortcutHint);
    return s ? formatShortcut(s, { mac: this._mac }) : '';
  }

  isEnabled(id) {
    const cmd = this.get(id);
    if (!cmd || cmd.comingSoon) return false;
    try { return cmd.isEnabled ? !!cmd.isEnabled(this._context()) : true; } catch { return false; }
  }

  isChecked(id) {
    const cmd = this.get(id);
    if (!cmd || !cmd.isChecked) return false;
    try { return !!cmd.isChecked(this._context()); } catch { return false; }
  }

  /** Runs a command. Returns false if it is unknown, disabled or coming soon. */
  run(id, ...args) {
    const cmd = this.get(id);
    if (!cmd || !this.isEnabled(id) || typeof cmd.run !== 'function') return false;
    const result = cmd.run(this._context(), ...args);
    this.notify();
    return result === undefined ? true : result;
  }

  /** Finds the command id bound to a keyboard event, or null. */
  commandForEvent(event) {
    const s = eventToShortcut(event);
    return s ? this._byShortcut.get(s) || null : null;
  }

  /**
   * Handles a keydown: runs the bound command. Returns the command id when the
   * shortcut belongs to a command (whether or not it could run), else null.
   * The browser default is always suppressed for app shortcuts, so e.g.
   * Ctrl+S never opens the browser's "Save page" dialog.
   */
  handleKeydown(event) {
    const id = this.commandForEvent(event);
    if (!id) return null;
    event.preventDefault();
    this.run(id);
    return id;
  }

  /**
   * Searches commands by label, id and keywords. Returns commands ranked best
   * first. An empty query lists every command alphabetically.
   */
  search(query, { limit = Infinity } = {}) {
    const q = String(query || '').trim().toLowerCase();
    const scored = [];
    for (const cmd of this._commands.values()) {
      if (cmd.hidden) continue;
      const label = this._translate(cmd.label).toLowerCase();
      if (!q) { scored.push([0, label, cmd]); continue; }
      const hay = [label, cmd.id.toLowerCase(), ...cmd.keywords.map((k) => this._translate(k).toLowerCase())];
      let score = -1;
      if (label === q) score = 100;
      else if (label.startsWith(q)) score = 80;
      else if (label.split(/[\s&/-]+/).some((w) => w.startsWith(q))) score = 60;
      else if (hay.some((h) => h.includes(q))) score = 40;
      else if (isSubsequence(q, label)) score = 10;
      if (score >= 0) scored.push([score - (cmd.comingSoon ? 5 : 0), label, cmd]);
    }
    scored.sort((a, b) => b[0] - a[0] || a[1].localeCompare(b[1]));
    return scored.slice(0, limit).map((s) => s[2]);
  }

  /** Subscribe to state changes (commands registered or run). Returns unsubscribe. */
  onChange(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }

  /** Tell listeners (ribbon, menus) to refresh enabled/checked state. */
  notify() {
    if (this._notifyQueued) return;
    this._notifyQueued = true;
    queueMicrotask(() => {
      this._notifyQueued = false;
      for (const fn of this._listeners) fn(this);
    });
  }
}

function isSubsequence(needle, hay) {
  let i = 0;
  for (const ch of hay) if (ch === needle[i]) i++;
  return i === needle.length;
}
