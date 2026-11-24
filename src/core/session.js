/**
 * The open document's lifecycle: New, Open (picker, drag & drop, Recent),
 * Save (File System Access write-back where available, otherwise download),
 * Save As, Close; the dirty flag and window title; autosave to IndexedDB with
 * crash recovery; unsaved-change prompts and the beforeunload guard.
 */
import { APP_NAME, AUTOSAVE_INTERVAL_MS } from '../config.js';
import { t } from '../i18n/index.js';
import { exportOdt } from './odt/export.js';
import { renderThumbnail } from './odt/thumbnail.js';
import { buildStyleIndex } from './odt/styles.js';
import { createBlankState, stateToJSON, stateFromJSON } from './document.js';
import { storage, addRecent, recentBytes, listRecent, addVersion, listVersions } from './storage.js';
import { getSetting } from './settings.js';
import { showDialog, alertDialog } from '../ui/dialog.js';
import { convertLib } from './convert/index.js';
import { passwordDialog } from '../ui/password-dialog.js';
import { readFile, writeFile, formatById, formatForName, stripExt, canWriteBack, isWritable, saveTypes, openTypes, pickerType, OPEN_ACCEPT, TEMPLATE_FORMATS, DEFAULT_FORMAT_CHOICES } from './formats.js';

const SESSION_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export function createSession({ editor, onLoad, onChange, toast }) {
  let untitledCounter = 0;
  const hooks = {}; // set by the app: formatEnv, lossyPrompt, fileConversion, passwordUnsupported, openSaveAsPage
  const s = {
    docId: uid(),
    state: null, // DocumentState minus the live doc (the editor holds it)
    name: '',
    handle: null,
    format: null, // format id of the file the document is (null: not saved yet)
    options: {}, // that format's options (text encoding and line endings, web page options…)
    fileName: '',
    dirty: false,
    autosaveDirty: false,
  };

  const fsAccess = () => getSetting('fileSystemAccess') !== false && typeof window.showSaveFilePicker === 'function';

  function currentState() { return { ...s.state, doc: editor.getDoc() }; }

  let titleSuffix = '';
  function updateTitle() {
    document.title = `${s.dirty ? '● ' : ''}${s.name}${titleSuffix} - ${APP_NAME}`;
    onChange?.(info());
  }

  function info() { return { name: s.name, dirty: s.dirty, hasHandle: !!s.handle, mime: s.state?.mime, format: s.format, fileName: s.fileName, options: s.options }; }

  function load(state, { name, handle = null, dirty = false, docId = uid(), format = null, options = {}, fileName = '' }) {
    s.password = null;
    s.lossyOk = null;
    s.recoveredFormat = null;
    s.state = state;
    s.name = name;
    s.handle = handle;
    s.format = format;
    s.options = options;
    s.fileName = fileName;
    s.docId = docId;
    s.dirty = dirty;
    s.autosaveDirty = dirty;
    onLoad?.(state); // before rendering: styles and picture URLs must be ready
    editor.setDoc(state.doc);
    updateTitle();
    editor.focus();
  }

  function markDirty() {
    if (!s.dirty) { s.dirty = true; updateTitle(); }
    s.autosaveDirty = true;
  }

  // ------------------------------------------------------------ guards

  /** Asks to save unsaved changes. Resolves false if the user cancels. */
  async function confirmDiscard() {
    if (!s.dirty) return true;
    const choice = await showDialog({
      title: APP_NAME,
      message: t('file.saveChangesPrompt', { name: s.name }),
      buttons: [{ label: t('file.save'), value: 'save', primary: true }, { label: t('file.dontSave'), value: 'discard' }, { label: t('common.cancel'), value: 'cancel' }],
      cancelValue: 'cancel',
    });
    if (choice === 'cancel') return false;
    if (choice === 'save') return save();
    return true;
  }

  addEventListener('beforeunload', (e) => {
    if (!s.dirty) return;
    autosaveNow();
    e.preventDefault();
    e.returnValue = '';
  });

  // ------------------------------------------------------------ new / open

  function untitledName() { untitledCounter++; return `${t('app.untitled').replace(/\d+$/, '')}${untitledCounter}`; }

  /** A blank document with the styles saved by Design ▸ Set as Default. */
  function blankState(opts) {
    const st = createBlankState(opts);
    let saved = null;
    try { saved = JSON.parse(getSetting('defaultStyles') || 'null'); } catch { saved = null; }
    if (!saved?.trees?.length) return st;
    const key = (x) => `${x.n}|${x.a?.['style:family'] || ''}|${x.a?.['style:name'] || ''}`;
    const byKey = new Map(saved.trees.map((x) => [key(x), x]));
    const c = (st.commonStyles.c || []).map((x) => (typeof x !== 'string' && byKey.has(key(x)) ? byKey.get(key(x)) : x));
    for (const x of saved.trees) if (!c.some((y) => typeof y !== 'string' && key(y) === key(x))) c.push(x);
    st.commonStyles = { ...st.commonStyles, c };
    const names = new Set((st.fontFaces || []).map((f) => f.a['style:name']));
    st.fontFaces = [...(st.fontFaces || []), ...(saved.fontFaces || []).filter((f) => !names.has(f.a['style:name']))];
    return st;
  }

  async function newDocument({ doc = null, skipGuard = false } = {}) {
    if (!skipGuard && !(await confirmDiscard())) return false;
    await discardAutosave();
    load(blankState({ doc }), { name: untitledName() });
    return true;
  }

  /**
   * Opens a file's bytes. DOCX, ODT, Word XML / flat ODT, HTML and text open
   * as that file (Save writes back in the same format); RTF and Markdown
   * open as a new document named after the file; templates (.dotx, .ott) as
   * a new untitled document.
   */
  async function openBytes(bytes, { name, handle = null, skipGuard = false, remember = true, generated = false }) {
    let result;
    try {
      result = await readFile(name, bytes, {
        askPassword: (error) => passwordDialog({ title: t('protect.openTitle'), message: t('protect.openPrompt', { name }), error: error ? t('protect.wrong') : '' }),
        convertLib,
      });
    } catch (e) {
      console.warn('Open failed:', e);
      await alertDialog(t('file.openFailedTitle'), t('file.openFailed', { name, reason: e.message }));
      return false;
    }
    if (!result) return false;
    if (!skipGuard && !(await confirmDiscard())) return false;
    await discardAutosave();
    const { state, format, options, asNew, password } = result;
    const fmt = formatById(format);
    if (generated) {
      // A document the app made (mail merge, compare): new and unsaved; Save uses the default format.
      load(state, { name: stripExt(name) });
    } else if (asNew && fmt?.kind === 'import') {
      // RTF, Markdown: a new document named after the file; its first Save goes to Save As.
      load(state, { name: stripExt(name), dirty: true });
      s.importedFrom = name;
      toast?.(t('file.imported', { name }));
    } else if (asNew) {
      state.mime = 'text';
      load(state, { name: untitledName() });
    } else {
      load(state, { name: stripExt(name), handle, format, options, fileName: name });
      s.password = password;
    }
    if (remember) addRecent({ name, bytes, handle, format }).then(() => onChange?.(info()));
    return true;
  }

  async function openFile(file, handle = null) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return openBytes(bytes, { name: file.name, handle });
  }

  /** Kept for callers that import a file as a new document. */
  async function importBytes(bytes, name) { return openBytes(bytes, { name }); }

  async function openDialog() {
    if (getSetting('fileSystemAccess') !== false && typeof window.showOpenFilePicker === 'function') {
      try {
        const [handle] = await window.showOpenFilePicker({ types: openTypes((f) => t(f.labelKey), t('fmt.allDocuments')), multiple: false, excludeAcceptAllOption: false });
        return openFile(await handle.getFile(), handle);
      } catch (e) {
        if (e.name !== 'AbortError') console.warn(e);
        return false;
      }
    }
    return new Promise((resolve) => {
      const input = Object.assign(document.createElement('input'), { type: 'file', accept: OPEN_ACCEPT.join(',') });
      input.addEventListener('change', () => resolve(input.files[0] ? openFile(input.files[0]) : false));
      input.addEventListener('cancel', () => resolve(false));
      input.click();
    });
  }

  async function openRecent(entry) {
    if (entry.handle) {
      try {
        let perm = await entry.handle.queryPermission?.({ mode: 'read' });
        if (perm !== 'granted') perm = await entry.handle.requestPermission?.({ mode: 'read' });
        if (perm === 'granted') return openFile(await entry.handle.getFile(), entry.handle);
      } catch (e) { console.warn('Recent handle failed:', e); }
    }
    const bytes = await recentBytes(entry.id);
    if (!bytes) { await alertDialog(t('file.openFailedTitle'), t('file.recentMissing', { name: entry.name })); return false; }
    return openBytes(bytes, { name: entry.name });
  }

  // ------------------------------------------------------------ save

  const defaultFormat = () => (DEFAULT_FORMAT_CHOICES.includes(getSetting('defaultFormat')) ? getSetting('defaultFormat') : 'docx');
  /** The format Save writes: the document's own, else the default. */
  const currentFormat = () => (canWriteBack(s.format) ? s.format : canWriteBack(s.recoveredFormat) ? s.recoveredFormat : defaultFormat());

  /** The document as ODT bytes (internal uses: mail merge, compare, Copy). */
  async function serialize({ asTemplate = false } = {}) {
    const state = currentState();
    let thumbnail;
    try { thumbnail = await renderThumbnail(state, buildStyleIndex(state)); } catch (e) { console.warn('Thumbnail failed:', e); }
    return exportOdt(state, { thumbnail, asTemplate }).bytes;
  }

  /** The document's bytes in a format (with the session's password when the format keeps one). */
  async function serializeAs(id, options = {}) {
    const env = { ...(hooks.formatEnv?.() || {}), state: currentState(), odt: (st, o) => serialize(o) };
    const fmt = formatById(id);
    return writeFile(id, env, { ...options, password: fmt?.encrypts || formatById(fmt?.base)?.encrypts ? s.password : null });
  }

  function download(bytes, fileName, mime = 'application/octet-stream') {
    const blob = new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: fileName });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  async function writeHandle(handle, bytes) {
    let perm = await handle.queryPermission?.({ mode: 'readwrite' });
    if (perm !== 'granted') perm = await handle.requestPermission?.({ mode: 'readwrite' });
    if (perm && perm !== 'granted') throw new Error('Permission denied');
    const w = await handle.createWritable();
    await w.write(bytes);
    await w.close();
  }

  function markSaved(name) {
    s.dirty = false;
    s.autosaveDirty = false;
    if (name) { s.fileName = name; s.name = stripExt(name); }
    updateTitle();
    discardAutosave();
  }

  /**
   * Checks before writing a format: the lossy prompt (HTML, TXT), a password
   * the format can't keep, the File Conversion options on a first save to
   * TXT. Resolves { format, options } to write, a request to go to Save As
   * as Word Document ({ saveAs: 'docx' }), or null to cancel.
   */
  async function prepareWrite(id, options, { first }) {
    const fmt = formatById(id);
    let opts = { ...defaultOptions(id), ...options };
    if (s.password && !fmt.encrypts && fmt.kind !== 'fixed') {
      const choice = await hooks.passwordUnsupported?.(fmt) ?? 'cancel';
      if (choice === 'cancel') return null;
      if (choice !== 'drop') return { saveAs: choice };
      s.password = null;
    }
    if (fmt.kind === 'lossy' && !s.lossyOk?.[id]) {
      const choice = await hooks.lossyPrompt?.({ format: fmt, name: s.name, state: currentState() }) ?? { choice: 'keep' };
      if (choice.choice === 'cancel') return null;
      if (choice.choice === 'docx') return { saveAs: 'docx' };
      if (choice.dontAsk) s.lossyOk = { ...s.lossyOk, [id]: true };
    }
    if (id === 'txt' && first && hooks.fileConversion) {
      const o = await hooks.fileConversion(opts, currentState());
      if (!o) return null;
      opts = { ...opts, ...o };
    }
    return { format: id, options: opts };
  }

  const defaultOptions = (id) => ({ txt: { encoding: 'utf-8', lineEnding: 'crlf', substitute: false }, html: { keepSource: true, title: '' } }[id] || {});

  async function save() {
    const id = currentFormat();
    if (s.handle && s.handle.createWritable && canWriteBack(s.format)) {
      const prep = await prepareWrite(id, s.options, { first: false });
      if (!prep) return false;
      if (prep.saveAs) return saveAs({ format: prep.saveAs });
      try {
        const bytes = await serializeAs(prep.format, prep.options);
        await writeHandle(s.handle, bytes);
        s.options = prep.options;
        markSaved();
        addRecent({ name: s.handle.name, bytes, handle: s.handle, format: s.format });
        toast?.(t('file.saved', { name: s.handle.name }));
        return true;
      } catch (e) {
        console.warn('Write-back failed, falling back to Save As:', e);
      }
    }
    return saveAs({ format: id });
  }

  /**
   * Save As. With File System Access the save picker opens (the format comes
   * from the chosen name's extension); without it, File ▸ Save As shows the
   * name and type fields, which call this with `direct: true` to download.
   * @param {{ format?: string, name?: string, options?: object, asTemplate?: boolean, direct?: boolean, forceDownload?: boolean }} [o]
   */
  async function saveAs(o = {}) {
    if (o.asTemplate && !o.format) o.format = 'dotx';
    let id = o.format || currentFormat();
    const usePicker = !o.forceDownload && fsAccess();
    if (!usePicker && !o.direct && hooks.openSaveAsPage) { hooks.openSaveAsPage({ format: id }); return false; }
    const fmt = formatById(id);
    if (!fmt || fmt.available === false) { await alertDialog(t('fmt.unavailableTitle'), t('fmt.unavailable', { format: t(fmt?.labelKey || 'fmt.docx') })); return false; }
    const base = (o.name || s.name || 'Document').replace(/[\\/:*?"<>|]+/g, '_');
    const isTemplate = fmt.kind === 'template';
    const fixed = fmt.kind === 'fixed';
    let handle = null;
    let fileName = `${stripExt(base)}${fmt.exts[0]}`;
    if (usePicker) {
      try {
        const types = isTemplate ? TEMPLATE_FORMATS.filter((f) => f.id === id).concat(TEMPLATE_FORMATS.filter((f) => f.id !== id)).map((f) => pickerType(f, t(f.labelKey))) : saveTypes(id, (f) => t(f.labelKey));
        handle = await window.showSaveFilePicker({ suggestedName: fileName, types, excludeAcceptAllOption: false });
        const chosen = formatForName(handle.name);
        if (chosen && isWritable(chosen) && chosen.kind !== 'import') id = chosen.id;
        fileName = handle.name;
      } catch (e) {
        if (e.name === 'AbortError') return false;
        console.warn('Save picker failed, downloading instead:', e);
        handle = null;
      }
    }
    const first = id !== s.format;
    const prep = await prepareWrite(id, { ...(id === s.format ? s.options : {}), ...o.options }, { first: first && !o.optionsChosen });
    if (!prep) return false;
    if (prep.saveAs) return saveAs({ ...o, format: prep.saveAs, options: undefined });
    const f2 = formatById(prep.format);
    let bytes;
    try { bytes = await serializeAs(prep.format, prep.options); } catch (e) {
      console.warn('Save failed:', e);
      await alertDialog(t('file.saveFailedTitle'), t('file.saveFailed', { name: fileName, reason: e.message || String(e) }));
      return false;
    }
    if (handle) {
      try { await writeHandle(handle, bytes); } catch (e) {
        console.warn('Write failed, downloading instead:', e);
        handle = null;
      }
    }
    if (!handle) download(bytes, fileName, f2.mime);
    addRecent({ name: fileName, bytes, handle, format: prep.format });
    if (fixed || isTemplate) {
      // A copy: the document stays attached to its file.
      toast?.(t(fixed ? 'fmt.exported' : (handle ? 'file.saved' : 'file.downloaded'), { name: fileName }));
      return true;
    }
    s.handle = handle;
    s.format = prep.format;
    s.options = prep.options;
    markSaved(fileName);
    toast?.(t(handle ? 'file.saved' : 'file.downloaded', { name: fileName }));
    return true;
  }

  /** Downloads a copy (current format, or the default for an unsaved document) without changing the document's file. */
  async function downloadCopy() {
    const fmt = formatById(currentFormat());
    const name = `${s.name || 'Document'}${fmt.exts[0]}`;
    download(await serializeAs(fmt.id, s.format === fmt.id ? s.options : {}), name, fmt.mime);
    toast?.(t('file.downloaded', { name }));
    return true;
  }

  async function close() {
    if (!(await confirmDiscard())) return false;
    await discardAutosave();
    load(blankState(), { name: untitledName() });
    return true;
  }

  // ------------------------------------------------------------ autosave

  async function autosaveNow() {
    if (!s.autosaveDirty || !s.state) return;
    s.autosaveDirty = false;
    const json = stateToJSON(currentState());
    await storage.put('autosave', { id: s.docId, sessionId: SESSION_ID, name: s.name, format: s.format, fileName: s.fileName, savedAt: Date.now(), json });
    // Password-protected documents keep no history in the browser.
    if (!s.password && getSetting('keepVersions') !== false) await addVersion({ docId: s.docId, name: s.name, json });
  }

  async function discardAutosave() { await storage.delete('autosave', s.docId); }

  let timer = null;
  function startAutosave() {
    clearInterval(timer);
    timer = setInterval(autosaveNow, getSetting('autosaveIntervalMs') || AUTOSAVE_INTERVAL_MS);
  }
  addEventListener('blur', autosaveNow);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') autosaveNow(); });

  /** Autosaved documents left by earlier sessions (crashes, closed tabs). */
  async function recoverable() {
    const all = await storage.getAll('autosave');
    return all.filter((e) => e.id !== s.docId).sort((a, b) => b.savedAt - a.savedAt);
  }

  async function recover(id) {
    const entry = await storage.get('autosave', id);
    if (!entry) return false;
    if (!(await confirmDiscard())) return false;
    await discardAutosave();
    let state;
    try { state = stateFromJSON(entry.json); } catch (e) {
      await alertDialog(t('file.openFailedTitle'), e.message);
      return false;
    }
    // Recovered documents have no file: Save goes to Save As, in the format they had.
    load(state, { name: entry.name, dirty: true, docId: entry.id });
    if (entry.format) s.recoveredFormat = entry.format;
    await storage.put('autosave', { ...entry, sessionId: SESSION_ID });
    return true;
  }

  async function deleteRecovered(id) { await storage.delete('autosave', id); }

  startAutosave();

  return {
    get info() { return info(); },
    get state() { return s.state; },
    currentState,
    newDocument,
    openDialog,
    openFile,
    openBytes,
    importBytes,
    openRecent,
    listRecent,
    save,
    saveAs,
    downloadCopy,
    close,
    serialize,
    serializeAs,
    hooks,
    fsAccess,
    defaultFormat,
    currentFormat,
    markDirty,
    autosaveNow,
    recoverable,
    recover,
    deleteRecovered,
    confirmDiscard,
    load,
    sessionId: SESSION_ID,
    /** ":1", ":2"… when the document is open in more than one window. */
    get protected() { return !!s.password; },
    get docId() { return s.docId; },
    versions: () => listVersions({ docId: s.docId, name: s.name }),
    /** Opens an earlier version as a new, unsaved document. */
    async openVersion(v) {
      if (!(await confirmDiscard())) return false;
      await discardAutosave();
      load(stateFromJSON(v.json), { name: t('info.versionName', { name: v.name, when: new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(v.savedAt)) }), dirty: true });
      return true;
    },
    /** Sets (or with null removes) the password the document is saved with. */
    setPassword(pw) { s.password = pw || null; markDirty(); onChange?.(info()); },
    setTitleSuffix(x) { if (x !== titleSuffix) { titleSuffix = x; updateTitle(); } },
  };
}
