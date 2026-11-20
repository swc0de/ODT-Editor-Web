/**
 * The open document's lifecycle: New, Open (picker, drag & drop, Recent),
 * Save (File System Access write-back where available, otherwise download),
 * Save As, Close; the dirty flag and window title; autosave to IndexedDB with
 * crash recovery; unsaved-change prompts and the beforeunload guard.
 */
import { APP_NAME, AUTOSAVE_INTERVAL_MS } from '../config.js';
import { t } from '../i18n/index.js';
import { importOdt } from './odt/import.js';
import { exportOdt } from './odt/export.js';
import { renderThumbnail } from './odt/thumbnail.js';
import { buildStyleIndex } from './odt/styles.js';
import { createBlankState, stateToJSON, stateFromJSON } from './document.js';
import { storage, addRecent, recentBytes, listRecent, addVersion, listVersions } from './storage.js';
import { getSetting } from './settings.js';
import { showDialog, alertDialog } from '../ui/dialog.js';
import { importFile, isImportable, IMPORT_EXTENSIONS } from './convert/index.js';
import { isEncrypted, decryptPackage, encryptPackage } from './odt/crypto.js';
import { passwordDialog } from '../ui/password-dialog.js';

const SESSION_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const ODT_TYPES = [{ description: 'OpenDocument Text', accept: { 'application/vnd.oasis.opendocument.text': ['.odt'], 'application/vnd.oasis.opendocument.text-template': ['.ott'] } }];
const OPEN_TYPES = [
  { description: 'All documents', accept: { 'application/vnd.oasis.opendocument.text': ['.odt', '.ott', ...IMPORT_EXTENSIONS] } },
  ...ODT_TYPES,
  { description: 'Word document', accept: { 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'] } },
  { description: 'Web page, Markdown, Rich Text, Plain text', accept: { 'text/plain': ['.htm', '.html', '.md', '.markdown', '.rtf', '.txt'] } },
];
const ACCEPT = ['.odt', '.ott', ...IMPORT_EXTENSIONS].join(',');

export function createSession({ editor, onLoad, onChange, toast }) {
  let untitledCounter = 0;
  const s = {
    docId: uid(),
    state: null, // DocumentState minus the live doc (the editor holds it)
    name: '',
    handle: null,
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

  function info() { return { name: s.name, dirty: s.dirty, hasHandle: !!s.handle, mime: s.state?.mime }; }

  function load(state, { name, handle = null, dirty = false, docId = uid() }) {
    s.password = null;
    s.state = state;
    s.name = name;
    s.handle = handle;
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

  /** Opens bytes as a document. Templates (.ott) open as a new untitled document. */
  async function openBytes(bytes, { name, handle = null, skipGuard = false, remember = true }) {
    let state;
    let password = null;
    const original = bytes;
    // A password-protected document: ask for the password (again if it's wrong).
    if (isEncrypted(bytes)) {
      let error = '';
      for (;;) {
        password = await passwordDialog({ title: t('protect.openTitle'), message: t('protect.openPrompt', { name }), error });
        if (password == null) return false;
        try { bytes = await decryptPackage(bytes, password); break; } catch (e) {
          if (e.code !== 'wrong-password') { await alertDialog(t('file.openFailedTitle'), t('file.openFailed', { name, reason: e.message })); return false; }
          error = t('protect.wrong');
        }
      }
    }
    try {
      state = importOdt(bytes);
    } catch (e) {
      console.warn('Open failed:', e);
      await alertDialog(t('file.openFailedTitle'), t('file.openFailed', { name, reason: e.message }));
      return false;
    }
    if (!skipGuard && !(await confirmDiscard())) return false;
    await discardAutosave();
    const isTemplate = state.mime === 'template' || /\.ott$/i.test(name);
    if (isTemplate) {
      state.mime = 'text';
      load(state, { name: untitledName() });
    } else {
      load(state, { name: name.replace(/\.odt$/i, ''), handle });
      s.fileName = name;
      s.password = password;
    }
    if (remember) addRecent({ name, bytes: original, handle }).then(() => onChange?.(info()));
    return true;
  }

  async function openFile(file, handle = null) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (isImportable(file.name)) return importBytes(bytes, file.name);
    return openBytes(bytes, { name: file.name, handle });
  }

  /** DOCX, HTML, Markdown, RTF, TXT: a new document named after the file (saving writes ODT). */
  async function importBytes(bytes, name) {
    let result;
    try {
      result = await importFile(name, bytes);
    } catch (e) {
      console.warn('Import failed:', e);
      await alertDialog(t('file.openFailedTitle'), t('file.openFailed', { name, reason: e.message }));
      return false;
    }
    if (!(await confirmDiscard())) return false;
    await discardAutosave();
    load(result.state, { name: name.replace(/\.[^.]+$/, ''), dirty: true });
    s.importedFrom = name;
    toast?.(t('file.imported', { name }));
    return true;
  }

  async function openDialog() {
    if (getSetting('fileSystemAccess') !== false && typeof window.showOpenFilePicker === 'function') {
      try {
        const [handle] = await window.showOpenFilePicker({ types: OPEN_TYPES, multiple: false, excludeAcceptAllOption: false });
        return openFile(await handle.getFile(), handle);
      } catch (e) {
        if (e.name !== 'AbortError') console.warn(e);
        return false;
      }
    }
    return new Promise((resolve) => {
      const input = Object.assign(document.createElement('input'), { type: 'file', accept: `${ACCEPT},application/vnd.oasis.opendocument.text,application/vnd.oasis.opendocument.text-template` });
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

  async function serialize({ asTemplate = false } = {}) {
    const state = currentState();
    let thumbnail;
    try { thumbnail = await renderThumbnail(state, buildStyleIndex(state)); } catch (e) { console.warn('Thumbnail failed:', e); }
    const bytes = exportOdt(state, { thumbnail, asTemplate }).bytes;
    // Encrypt with Password (File ▸ Info ▸ Protect Document).
    return s.password ? encryptPackage(bytes, s.password) : bytes;
  }

  function download(bytes, fileName) {
    const blob = new Blob([bytes], { type: 'application/vnd.oasis.opendocument.text' });
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
    if (name) s.name = name.replace(/\.odt$/i, '');
    updateTitle();
    discardAutosave();
  }

  async function save() {
    if (s.handle && s.handle.createWritable) {
      try {
        const bytes = await serialize();
        await writeHandle(s.handle, bytes);
        markSaved();
        addRecent({ name: s.handle.name, bytes, handle: s.handle });
        toast?.(t('file.saved', { name: s.handle.name }));
        return true;
      } catch (e) {
        console.warn('Write-back failed, falling back to Save As:', e);
      }
    }
    return saveAs();
  }

  async function saveAs({ asTemplate = false, forceDownload = false } = {}) {
    const ext = asTemplate ? '.ott' : '.odt';
    const suggested = `${s.name || 'Document'}${ext}`;
    const bytes = await serialize({ asTemplate });
    if (!forceDownload && fsAccess()) {
      try {
        const handle = await window.showSaveFilePicker({ suggestedName: suggested, types: ODT_TYPES });
        await writeHandle(handle, bytes);
        if (!asTemplate) { s.handle = handle; markSaved(handle.name); }
        addRecent({ name: handle.name, bytes, handle });
        toast?.(t('file.saved', { name: handle.name }));
        return true;
      } catch (e) {
        if (e.name === 'AbortError') return false;
        console.warn('Save picker failed, downloading instead:', e);
      }
    }
    download(bytes, suggested);
    if (!asTemplate) markSaved(suggested);
    addRecent({ name: suggested, bytes });
    toast?.(t('file.downloaded', { name: suggested }));
    return true;
  }

  /** Downloads a copy without changing the document's name or file. */
  async function downloadCopy() {
    const name = `${s.name || 'Document'}.odt`;
    download(await serialize(), name);
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
    await storage.put('autosave', { id: s.docId, sessionId: SESSION_ID, name: s.name, savedAt: Date.now(), json });
    // Password-protected documents keep no history in the browser.
    if (!s.password) await addVersion({ docId: s.docId, name: s.name, json });
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
    load(state, { name: entry.name, dirty: true, docId: entry.id });
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
