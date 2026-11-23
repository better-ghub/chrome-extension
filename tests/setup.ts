// Minimal in-memory chrome API mock for unit tests (jsdom and node environments).
// Supports both the callback and promise forms of chrome.storage.local/session.

type Keys = string | string[] | Record<string, unknown> | null | undefined;

function makeArea() {
  const store: Record<string, unknown> = {};
  const pick = (keys: Keys): Record<string, unknown> => {
    if (keys == null) return { ...store };
    if (typeof keys === 'string') return keys in store ? { [keys]: store[keys] } : {};
    if (Array.isArray(keys)) {
      const out: Record<string, unknown> = {};
      for (const k of keys) if (k in store) out[k] = store[k];
      return out;
    }
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(keys)) out[k] = k in store ? store[k] : keys[k];
    return out;
  };
  const area = {
    get(keys: Keys, cb?: (items: Record<string, unknown>) => void) {
      // Clone like Chrome does (values are structured-cloned).
      const result = JSON.parse(JSON.stringify(pick(keys))) as Record<string, unknown>;
      if (typeof cb === 'function') return void cb(result);
      return Promise.resolve(result);
    },
    set(items: Record<string, unknown>, cb?: () => void) {
      Object.assign(store, JSON.parse(JSON.stringify(items)));
      if (typeof cb === 'function') return void cb();
      return Promise.resolve();
    },
    remove(keys: string | string[], cb?: () => void) {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k];
      if (typeof cb === 'function') return void cb();
      return Promise.resolve();
    },
    clear(cb?: () => void) {
      for (const k of Object.keys(store)) delete store[k];
      if (typeof cb === 'function') return void cb();
      return Promise.resolve();
    },
  };
  return { area, store };
}

const local = makeArea();
const session = makeArea();
const sync = makeArea();
const alarms: Record<string, { name: string; periodInMinutes?: number }> = {};
const noopEvent = { addListener: () => undefined, removeListener: () => undefined };

const chromeMock = {
  storage: {
    local: local.area,
    session: session.area,
    sync: sync.area,
    onChanged: noopEvent,
  },
  runtime: {
    id: 'test-extension-id',
    getURL: (p: string) => p,
    sendMessage: (_msg?: unknown) => Promise.resolve(undefined as unknown),
    getContexts: () => Promise.resolve([]),
    onMessage: noopEvent,
    onInstalled: noopEvent,
    onStartup: noopEvent,
    lastError: undefined,
  },
  i18n: { getUILanguage: () => 'en', getMessage: () => '' },
  tabs: {
    query: () => Promise.resolve([]),
    sendMessage: () => Promise.resolve(undefined),
    create: () => Promise.resolve({}),
    update: () => Promise.resolve({}),
  },
  windows: { update: () => Promise.resolve({}) },
  alarms: {
    create: (name: string, info: { periodInMinutes?: number }) => {
      alarms[name] = { name, periodInMinutes: info.periodInMinutes };
      return Promise.resolve();
    },
    get: (name: string) => Promise.resolve(alarms[name]),
    clear: (name: string) => {
      const had = name in alarms;
      delete alarms[name];
      return Promise.resolve(had);
    },
    onAlarm: noopEvent,
  },
  action: {
    setBadgeText: (_d?: unknown) => Promise.resolve(),
    setBadgeBackgroundColor: (_d?: unknown) => Promise.resolve(),
  },
};

(globalThis as unknown as { chrome: unknown }).chrome = chromeMock;
(globalThis as unknown as { __chromeSync: typeof sync }).__chromeSync = sync;
(globalThis as unknown as { __resetChromeStorage: () => void }).__resetChromeStorage = () => {
  for (const s of [local.store, session.store, sync.store, alarms]) for (const k of Object.keys(s)) delete (s as Record<string, unknown>)[k];
};
