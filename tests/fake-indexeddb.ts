// Minimal async IndexedDB fake for background tests (jest has no IndexedDB).

/** Just enough of IDBFactory for secret-store.ts: open, one store, get/put/delete, async callbacks. */
export function fakeIndexedDB() {
  const dbs = new Map<string, Map<string, Map<unknown, unknown>>>();
  const later = (fn: () => void) => setTimeout(fn, 0);
  let failWrites = false;
  const factory = {
    open(name: string) {
      const req: Record<string, unknown> & { onsuccess?: () => void; onupgradeneeded?: () => void } = { result: undefined, error: null };
      later(() => {
        const fresh = !dbs.has(name);
        const stores = dbs.get(name) ?? new Map<string, Map<unknown, unknown>>();
        dbs.set(name, stores);
        req.result = {
          objectStoreNames: { contains: (n: string) => stores.has(n) },
          createObjectStore: (n: string) => stores.set(n, new Map()),
          close: () => undefined,
          transaction(storeName: string, mode: string) {
            const map = stores.get(storeName);
            if (!map) throw new Error('NotFoundError');
            const tx: Record<string, unknown> & { oncomplete?: () => void; onerror?: () => void } = { error: null };
            const result = (value: unknown) => ({ result: value });
            tx.objectStore = () => ({
              get: (k: unknown) => result(map.get(k)),
              put: (v: unknown, k: unknown) => (mode === 'readwrite' && !failWrites ? (map.set(k, v), result(k)) : result(undefined)),
              delete: (k: unknown) => (mode === 'readwrite' && !failWrites ? (map.delete(k), result(undefined)) : result(undefined)),
            });
            later(() => {
              if (failWrites && mode === 'readwrite') {
                tx.error = new Error('QuotaExceededError');
                tx.onerror?.();
              } else tx.oncomplete?.();
            });
            return tx;
          },
        };
        if (fresh) req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
  return { factory, dbs, setFailWrites: (v: boolean) => (failWrites = v) };
}
