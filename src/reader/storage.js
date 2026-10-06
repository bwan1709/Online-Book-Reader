// Where the reader's own PDFs live — always on their machine, never on a server.
//
//  1. A folder on disk the user picks once (File System Access API, Chrome/Edge). PDFs are real files
//     there, so clearing browser data doesn't lose them, and PDFs dropped into the folder by hand show
//     up on the shelf. The browser asks to re-confirm access once per session.
//  2. Otherwise IndexedDB, with persistent storage requested so the browser won't evict it on its own.
//
// Keys: a shelf book's attached PDF uses the book id ("nexus"); the reader's own books use "own:…".
// In the folder, attached PDFs are named "nexvs-<bookId>.pdf"; every other PDF is one of their books.

const DB_NAME = 'nexvs-library';
const OWN = 'own:';
const attachedFile = (bookId) => `nexvs-${bookId}.pdf`;

// ---------- IndexedDB ----------
let dbPromise;
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 3);
    req.onupgradeneeded = () => {
      for (const name of ['pdfs', 'meta', 'settings', 'bookmarks', 'progress']) {
        if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function idb(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}
const idbGet = (store, key) => idb(store, 'readonly', (s) => s.get(key));
const idbPut = (store, key, value) => idb(store, 'readwrite', (s) => s.put(value, key));
const idbDel = (store, key) => idb(store, 'readwrite', (s) => s.delete(key));
const idbKeys = (store) => idb(store, 'readonly', (s) => s.getAllKeys());

// ---------- Folder on disk ----------
export const folderSupported = typeof window.showDirectoryPicker === 'function';
let folder = null;

async function folderReady() {
  return !!folder && (await folder.queryPermission({ mode: 'readwrite' })) === 'granted';
}

async function writeFile(name, file) {
  const handle = await folder.getFileHandle(name, { create: true });
  const out = await handle.createWritable();
  await out.write(file);
  await out.close();
}

async function readFile(name) {
  try {
    return await (await folder.getFileHandle(name)).getFile();
  } catch {
    return undefined;
  }
}

async function folderPdfs() {
  const names = [];
  for await (const [name, handle] of folder.entries()) {
    if (handle.kind === 'file' && /\.pdf$/i.test(name)) names.push(name);
  }
  return names.sort((a, b) => a.localeCompare(b, 'vi'));
}

/** A file name not yet used in the folder: "Sách.pdf", "Sách (2).pdf", … */
async function uniqueName(name) {
  const taken = new Set(await folderPdfs());
  const base = name.replace(/\.pdf$/i, '');
  let candidate = `${base}.pdf`;
  for (let i = 2; taken.has(candidate); i++) candidate = `${base} (${i}).pdf`;
  return candidate;
}

/** Moves everything kept in the browser into the newly linked folder. */
async function migrateToFolder() {
  for (const key of await idbKeys('pdfs')) {
    const file = await idbGet('pdfs', key);
    if (!file) continue;
    if (String(key).startsWith(OWN)) {
      const meta = (await idbGet('meta', key)) || {};
      await writeFile(await uniqueName(meta.name || file.name || 'Sách.pdf'), file);
      await idbDel('meta', key);
    } else {
      await writeFile(attachedFile(key), file);
    }
    await idbDel('pdfs', key);
  }
}

// ---------- Setup & status ----------
export async function initStorage() {
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* not supported — fine */
  }
  if (folderSupported) folder = (await idbGet('settings', 'folder').catch(() => null)) || null;
}

/** 'unsupported' | 'none' | 'needs-permission' | 'ready' */
export async function folderStatus() {
  if (!folderSupported) return 'unsupported';
  if (!folder) return 'none';
  return (await folderReady()) ? 'ready' : 'needs-permission';
}

export const folderName = () => folder?.name;

/** Asks the user to pick a folder (must be called from a click). */
export async function linkFolder() {
  folder = await window.showDirectoryPicker({ id: 'nexvs-books', mode: 'readwrite', startIn: 'documents' });
  await idbPut('settings', 'folder', folder);
  await migrateToFolder();
}

/** Re-grants access to the remembered folder (must be called from a click). */
export async function reconnectFolder() {
  return (await folder.requestPermission({ mode: 'readwrite' })) === 'granted';
}

// ---------- PDFs attached to shelf books ----------
/** @returns {Promise<File | undefined>} */
export async function getAttachedPdf(bookId) {
  if (await folderReady()) {
    const file = await readFile(attachedFile(bookId));
    if (file) return file;
  }
  return idbGet('pdfs', bookId).catch(() => undefined);
}

export async function attachPdf(bookId, file) {
  if (await folderReady()) return writeFile(attachedFile(bookId), file);
  return idbPut('pdfs', bookId, file);
}

export async function detachPdf(bookId) {
  if (await folderReady()) await folder.removeEntry(attachedFile(bookId)).catch(() => {});
  await idbDel('pdfs', bookId).catch(() => {});
}

export async function listAttached() {
  const ids = (await idbKeys('pdfs').catch(() => [])).filter((k) => !String(k).startsWith(OWN));
  if (await folderReady()) {
    for (const name of await folderPdfs()) {
      const m = name.match(/^nexvs-(.+)\.pdf$/i);
      if (m) ids.push(m[1]);
    }
  }
  return ids;
}

// ---------- The reader's own books ----------
/** @returns {Promise<{ id: string, name: string, where: 'folder' | 'browser' }[]>} */
export async function listOwnBooks() {
  const books = [];
  if (await folderReady()) {
    for (const name of await folderPdfs()) {
      if (!/^nexvs-/i.test(name)) books.push({ id: OWN + name, name: name.replace(/\.pdf$/i, ''), where: 'folder' });
    }
  }
  for (const key of await idbKeys('pdfs').catch(() => [])) {
    if (!String(key).startsWith(OWN)) continue;
    const meta = (await idbGet('meta', key)) || {};
    books.push({ id: key, name: (meta.name || 'Sách').replace(/\.pdf$/i, ''), where: 'browser' });
  }
  return books;
}

/** Saves a PDF the reader opened; returns its id. */
export async function addOwnBook(file) {
  if (await folderReady()) {
    const name = await uniqueName(file.name || 'Sách.pdf');
    await writeFile(name, file);
    return OWN + name;
  }
  const id = `${OWN}${Date.now()}`;
  await idbPut('pdfs', id, file);
  await idbPut('meta', id, { name: file.name || 'Sách.pdf' });
  return id;
}

/** @returns {Promise<File | undefined>} */
export async function getOwnBook(id) {
  if (await folderReady()) {
    const file = await readFile(id.slice(OWN.length));
    if (file) return file;
  }
  return idbGet('pdfs', id).catch(() => undefined);
}

export async function removeOwnBook(id) {
  if (await folderReady()) await folder.removeEntry(id.slice(OWN.length)).catch(() => {});
  await idbDel('pdfs', id).catch(() => {});
  await idbDel('meta', id).catch(() => {});
  await idbDel('meta', `thumb:${id}`).catch(() => {});
  await idbDel('bookmarks', id).catch(() => {});
  await idbDel('progress', id).catch(() => {});
}

// Cover thumbnails (first page) are cached in the browser; they're cheap to regenerate if lost.
export const getThumb = (id) => idbGet('meta', `thumb:${id}`).catch(() => undefined);
export const setThumb = (id, dataUrl) => idbPut('meta', `thumb:${id}`, dataUrl).catch(() => {});

// ---------- Bookmarks & Reading Progress ----------
/**
 * @param {string} bookKey
 * @returns {Promise<Array<{ id: string, spread: number, pageLabel: string, note?: string, createdAt: number }>>}
 */
export async function getBookmarks(bookKey) {
  try {
    return (await idbGet('bookmarks', bookKey)) || [];
  } catch {
    return [];
  }
}

/**
 * @param {string} bookKey
 * @param {{ spread: number, pageLabel: string, note?: string }} bookmark
 */
export async function addBookmark(bookKey, bookmark) {
  try {
    const list = (await idbGet('bookmarks', bookKey)) || [];
    const item = {
      id: `bm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      spread: bookmark.spread,
      pageLabel: bookmark.pageLabel,
      note: bookmark.note || '',
      createdAt: Date.now(),
    };
    const idx = list.findIndex((b) => b.spread === bookmark.spread);
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...item };
    } else {
      list.push(item);
      list.sort((a, b) => a.spread - b.spread);
    }
    await idbPut('bookmarks', bookKey, list);
    return { list, item };
  } catch (err) {
    console.error('Failed to add bookmark', err);
    return { list: [], item: null };
  }
}

/**
 * @param {string} bookKey
 * @param {string|number} idOrSpread
 */
export async function removeBookmark(bookKey, idOrSpread) {
  try {
    const list = (await idbGet('bookmarks', bookKey)) || [];
    const filtered = list.filter((b) => b.id !== idOrSpread && b.spread !== idOrSpread);
    await idbPut('bookmarks', bookKey, filtered);
    return filtered;
  } catch (err) {
    console.error('Failed to remove bookmark', err);
    return [];
  }
}

/**
 * @param {string} bookKey
 * @param {string} id
 * @param {string} note
 */
export async function updateBookmarkNote(bookKey, id, note) {
  try {
    const list = (await idbGet('bookmarks', bookKey)) || [];
    const item = list.find((b) => b.id === id);
    if (item) {
      item.note = note.trim();
      await idbPut('bookmarks', bookKey, list);
    }
    return list;
  } catch (err) {
    console.error('Failed to update bookmark note', err);
    return [];
  }
}

/**
 * @param {string} bookKey
 * @returns {Promise<number | null>}
 */
export async function getReadingProgress(bookKey) {
  try {
    const record = await idbGet('progress', bookKey);
    return record?.spread ?? null;
  } catch {
    return null;
  }
}

/**
 * @param {string} bookKey
 * @param {number} spread
 */
export async function saveReadingProgress(bookKey, spread) {
  try {
    await idbPut('progress', bookKey, { spread, updatedAt: Date.now() });
  } catch (err) {
    console.error('Failed to save progress', err);
  }
}

