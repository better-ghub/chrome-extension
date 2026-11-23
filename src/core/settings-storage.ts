// Better GHub - Settings storage layer (chrome.storage.sync with local fallback)
//
// Settings are stored one item per key in chrome.storage.sync so they follow the
// user across Chrome profiles. Sync has hard limits (8192 bytes per item, 102400
// in total, write-rate limits) and may be unavailable, so every key can also live
// in chrome.storage.local. The rules are deliberately simple and deterministic:
//
//   write(key):  value fits the per-item budget AND sync.set succeeds
//                  -> value lives in sync; key is removed from local and from the
//                     local-only list.
//                otherwise (too large, quota/rate error, sync missing)
//                  -> value lives in local; key is added to LOCAL_ONLY_KEY and
//                     removed from sync (best effort) so a stale copy can't win.
//   read(key):   key listed in LOCAL_ONLY_KEY -> local value
//                else sync value if present -> sync value
//                else local value (un-migrated legacy data) -> else undefined.
//   remove(key): removed from both areas and from the local-only list.
//
// LOCAL_ONLY_KEY itself is never synced: it describes this profile only.
// Tokens are never stored here (see background/secret-store.ts).

/** Local-only bookkeeping: storage keys whose value is held in chrome.storage.local. */
export const LOCAL_ONLY_KEY = 'settingsLocalOnly';

/** Leave headroom below QUOTA_BYTES_PER_ITEM (8192; counted as key + JSON value). */
const MAX_ITEM_BYTES = 8000;

type Items = Record<string, unknown>;

function syncArea(): chrome.storage.StorageArea | undefined {
  try {
    return chrome.storage.sync;
  } catch {
    return undefined;
  }
}

export function fitsSyncItem(key: string, value: unknown): boolean {
  try {
    const json = JSON.stringify(value);
    return json !== undefined && key.length + json.length <= MAX_ITEM_BYTES;
  } catch {
    return false;
  }
}

async function localOnlyList(): Promise<string[]> {
  const got = await chrome.storage.local.get(LOCAL_ONLY_KEY);
  const list = got[LOCAL_ONLY_KEY];
  return Array.isArray(list) ? list.filter((k): k is string => typeof k === 'string') : [];
}

async function setLocalOnlyList(list: string[]): Promise<void> {
  if (list.length) await chrome.storage.local.set({ [LOCAL_ONLY_KEY]: [...new Set(list)] });
  else await chrome.storage.local.remove(LOCAL_ONLY_KEY);
}

/** Resolve the current raw value of each key (see the read rule above). */
export async function readSettingItems(keys: string[]): Promise<Items> {
  const [local, localOnly] = await Promise.all([chrome.storage.local.get(keys), localOnlyList()]);
  let synced: Items = {};
  try {
    synced = (await syncArea()?.get(keys)) ?? {};
  } catch {
    /* sync unavailable: local values only */
  }
  const out: Items = {};
  for (const key of keys) {
    if (localOnly.includes(key)) {
      if (key in local) out[key] = local[key];
    } else if (key in synced) out[key] = synced[key];
    else if (key in local) out[key] = local[key];
  }
  return out;
}

/** Write raw values following the write rule; `undefined` removes the key. */
export async function writeSettingItems(items: Items): Promise<void> {
  const sync = syncArea();
  const localOnly = new Set(await localOnlyList());
  const toLocal: Items = {};
  const removeLocal: string[] = [];
  const removeSync: string[] = [];

  for (const [key, value] of Object.entries(items)) {
    if (value === undefined) {
      removeLocal.push(key);
      removeSync.push(key);
      localOnly.delete(key);
      continue;
    }
    let synced = false;
    if (sync && fitsSyncItem(key, value)) {
      try {
        await sync.set({ [key]: value });
        synced = true;
      } catch {
        /* quota / rate limit / sync disabled: fall back to local */
      }
    }
    if (synced) {
      removeLocal.push(key);
      localOnly.delete(key);
    } else {
      toLocal[key] = value;
      removeSync.push(key);
      localOnly.add(key);
    }
  }

  if (Object.keys(toLocal).length) await chrome.storage.local.set(toLocal);
  if (removeLocal.length) await chrome.storage.local.remove(removeLocal);
  if (removeSync.length && sync) await Promise.resolve(sync.remove(removeSync)).catch(() => undefined);
  await setLocalOnlyList([...localOnly]);
}

export async function removeSettingItems(keys: string[]): Promise<void> {
  await writeSettingItems(Object.fromEntries(keys.map((k) => [k, undefined])));
}

/**
 * One-time (idempotent) migration of settings from local to sync: runs only when
 * sync holds none of the keys yet but local holds some. Keys that can't be
 * synced stay in local and are marked local-only. Returns the migrated count.
 */
export async function migrateSettingsToSync(keys: string[]): Promise<number> {
  const sync = syncArea();
  if (!sync) return 0;
  try {
    const [synced, local, localOnly] = await Promise.all([sync.get(keys), chrome.storage.local.get(keys), localOnlyList()]);
    if (Object.keys(synced).length) return 0;
    const legacy = keys.filter((k) => k in local && !localOnly.includes(k));
    if (!legacy.length) return 0;
    const before = new Set(localOnly);
    await writeSettingItems(Object.fromEntries(legacy.map((k) => [k, local[k]])));
    const after = new Set(await localOnlyList());
    return legacy.filter((k) => !after.has(k) || before.has(k)).length;
  } catch {
    return 0;
  }
}

/** Whether a storage change in `area` can affect a setting. */
export function isSettingsArea(area: string): boolean {
  return area === 'local' || area === 'sync';
}
