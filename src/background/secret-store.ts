// Better GHub - Secrets (the GitHub token) in the extension origin's IndexedDB.
//
// chrome.storage.local is readable by content scripts, and every write fires
// chrome.storage.onChanged in every github.com tab with the plain value in
// newValue/oldValue. IndexedDB is per-origin: content scripts run in
// github.com's origin and cannot open the extension's database. Only the
// background worker uses this module.
//
// Without `indexedDB` (jest) the in-memory cache is the only store.

const DB_NAME = 'bghub';
const STORE = 'secrets';

/** key → value (undefined = known to be absent). Also the fallback store. */
const cache = new Map<string, string | undefined>();
let dbPromise: Promise<IDBDatabase> | null = null;

function hasIdb(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another context upgrading the schema must not be blocked by us.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error('indexedDB.open failed'));
  });
  // Retry the open on the next call instead of caching a failure forever.
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

async function run<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = op(tx.objectStore(STORE));
    // Resolve on commit, not on request success, so writes are durable.
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error ?? req.error ?? new Error('indexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('indexedDB transaction aborted'));
  });
}

export async function getSecret(key: string): Promise<string | undefined> {
  if (cache.has(key)) return cache.get(key);
  if (!hasIdb()) return undefined;
  const value = await run('readonly', (s) => s.get(key) as IDBRequest<unknown>);
  // A set/delete that landed while we were reading wins over the older read.
  if (!cache.has(key)) cache.set(key, typeof value === 'string' ? value : undefined);
  return cache.get(key);
}

export async function setSecret(key: string, value: string): Promise<void> {
  cache.set(key, value);
  if (!hasIdb()) return;
  try {
    await run('readwrite', (s) => s.put(value, key));
  } catch (error) {
    cache.delete(key); // next read goes back to the database
    throw error;
  }
}

export async function deleteSecret(key: string): Promise<void> {
  cache.set(key, undefined);
  if (!hasIdb()) return;
  try {
    await run('readwrite', (s) => s.delete(key));
  } catch (error) {
    cache.delete(key);
    throw error;
  }
}
