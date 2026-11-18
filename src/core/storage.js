/**
 * IndexedDB storage (local to this browser): recent files, copies of their
 * bytes for reopening, and autosaves. Every call fails soft: if IndexedDB is
 * unavailable the app keeps working without these features.
 */
import { APP_ID } from '../config.js';

const DB_NAME = `${APP_ID}`;
const VERSION = 1;
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('recent')) db.createObjectStore('recent', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('autosave')) db.createObjectStore('autosave', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((e) => { console.warn('Storage unavailable:', e.message); dbPromise = null; throw e; });
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

export const storage = {
  async getAll(store) { try { return await tx(store, 'readonly', (s) => req(s.getAll())); } catch { return []; } },
  async get(store, id) { try { return await tx(store, 'readonly', (s) => req(s.get(id))); } catch { return undefined; } },
  async put(store, value) { try { await tx(store, 'readwrite', (s) => req(s.put(value))); return true; } catch (e) { console.warn('Could not save to storage:', e.message); return false; } },
  async delete(store, id) { try { await tx(store, 'readwrite', (s) => req(s.delete(id))); return true; } catch { return false; } },
};

// ------------------------------------------------------------------ recent

const MAX_RECENT = 30;
const MAX_STORED_BYTES = 10; // keep file copies for the 10 most recent unpinned + all pinned
const MAX_FILE_SIZE = 25 * 1024 * 1024;

/** Adds/updates a recent entry; keeps a copy of the bytes so it can be reopened. */
export async function addRecent({ name, bytes, handle = null }) {
  const id = name;
  const prev = await storage.get('recent', id);
  const entry = { id, name, openedAt: Date.now(), pinned: prev?.pinned || false, size: bytes?.length || 0, handle: handle || prev?.handle || null, hasCopy: false };
  if (bytes && bytes.length <= MAX_FILE_SIZE) {
    entry.hasCopy = await storage.put('files', { id, bytes });
  }
  if (!(await storage.put('recent', entry))) {
    // Some handles can't be stored (e.g. in other browsers): retry without.
    entry.handle = null;
    await storage.put('recent', entry);
  }
  await pruneRecent();
}

export async function listRecent() {
  const all = await storage.getAll('recent');
  return all.sort((a, b) => (b.pinned - a.pinned) || (b.openedAt - a.openedAt));
}

export async function setPinned(id, pinned) {
  const e = await storage.get('recent', id);
  if (e) await storage.put('recent', { ...e, pinned });
}

export async function removeRecent(id) {
  await storage.delete('recent', id);
  await storage.delete('files', id);
}

async function pruneRecent() {
  const all = await listRecent();
  let copies = 0;
  for (const [i, e] of all.entries()) {
    if (i >= MAX_RECENT && !e.pinned) { await removeRecent(e.id); continue; }
    if (e.hasCopy && !e.pinned && ++copies > MAX_STORED_BYTES) {
      await storage.delete('files', e.id);
      await storage.put('recent', { ...e, hasCopy: false });
    }
  }
}

export async function recentBytes(id) {
  const f = await storage.get('files', id);
  return f?.bytes || null;
}
