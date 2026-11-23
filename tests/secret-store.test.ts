/**
 * @jest-environment node
 */
// Secret store over IndexedDB (minimal async fake) and the token-list migrations.

import type * as SecretStoreModule from '../src/background/secret-store';
import type * as StoreModule from '../src/background/store';
import type * as TokensModule from '../src/background/tokens';
import { initialMeta } from '../src/background/token-model';
import { fakeIndexedDB } from './fake-indexeddb';

type Mods = { secrets: typeof SecretStoreModule; store: typeof StoreModule; tokens: typeof TokensModule };

const TOKEN = `ghp_${'a'.repeat(36)}`;
const OTHER = `ghp_${'c'.repeat(36)}`;

function load(): Mods {
  let mods!: Mods;
  jest.isolateModules(() => {
    mods = {
      secrets: require('../src/background/secret-store'),
      store: require('../src/background/store'),
      tokens: require('../src/background/tokens'),
    };
  });
  return mods;
}

const g = globalThis as unknown as { indexedDB?: unknown; __resetChromeStorage: () => void };

beforeEach(() => {
  g.__resetChromeStorage();
  delete g.indexedDB;
});

afterAll(() => {
  delete g.indexedDB;
});

describe('secret store', () => {
  test('round-trips through IndexedDB and survives a worker restart', async () => {
    const idb = fakeIndexedDB();
    g.indexedDB = idb.factory;
    const first = load();
    expect(await first.secrets.getSecret('k')).toBeUndefined();
    await first.secrets.setSecret('k', 'v1');
    expect(idb.dbs.get('bghub')?.get('secrets')?.get('k')).toBe('v1');

    // New module instance = restarted service worker with an empty memory cache.
    const second = load();
    expect(await second.secrets.getSecret('k')).toBe('v1');
    await second.secrets.deleteSecret('k');
    expect(await second.secrets.getSecret('k')).toBeUndefined();
    expect(await load().secrets.getSecret('k')).toBeUndefined();
  });

  test('a failed write rejects and does not leave a phantom value in memory', async () => {
    const idb = fakeIndexedDB();
    g.indexedDB = idb.factory;
    const { secrets } = load();
    idb.setFailWrites(true);
    await expect(secrets.setSecret('k', 'v')).rejects.toThrow('QuotaExceededError');
    idb.setFailWrites(false);
    expect(await secrets.getSecret('k')).toBeUndefined();
  });

  test('falls back to memory without IndexedDB', async () => {
    const { secrets } = load();
    await secrets.setSecret('k', 'v');
    expect(await secrets.getSecret('k')).toBe('v');
    await secrets.deleteSecret('k');
    expect(await secrets.getSecret('k')).toBeUndefined();
  });
});

describe('token list migration', () => {
  const secretsIn = (idb: ReturnType<typeof fakeIndexedDB>) => idb.dbs.get('bghub')?.get('secrets');
  const storedList = (idb: ReturnType<typeof fakeIndexedDB>) => JSON.parse(String(secretsIn(idb)?.get('githubTokens') ?? '[]')) as { id: string; token: string }[];

  test('moves a chrome.storage.local token into the IndexedDB list, once', async () => {
    const idb = fakeIndexedDB();
    g.indexedDB = idb.factory;
    await chrome.storage.local.set({ githubToken: TOKEN, language: 'pl' });
    const { store } = load();
    expect(await store.getToken()).toBe(TOKEN);
    const local = await chrome.storage.local.get(null);
    expect(local).not.toHaveProperty('githubToken');
    expect(JSON.stringify(local)).not.toContain(TOKEN); // metadata only
    expect(storedList(idb).map((e) => e.token)).toEqual([TOKEN]);
    // After a restart the token comes from IndexedDB alone.
    expect(await load().store.getToken()).toBe(TOKEN);
  });

  test('the single secret of the previous build becomes tokens[0] and survives a restart', async () => {
    const idb = fakeIndexedDB();
    g.indexedDB = idb.factory;
    await load().secrets.setSecret('githubToken', TOKEN);
    const { tokens } = load();
    expect((await tokens.listTokens()).map((t) => [t.token, t.pending])).toEqual([[TOKEN, true]]);
    expect(secretsIn(idb)?.has('githubToken')).toBe(false);
    const again = await load().tokens.listTokens();
    expect(again.map((t) => t.token)).toEqual([TOKEN]);
    expect(again[0].pending).toBe(true); // metadata persisted in chrome.storage.local
  });

  test('a stored list wins over a leftover legacy copy (which is removed)', async () => {
    const idb = fakeIndexedDB();
    g.indexedDB = idb.factory;
    const first = load();
    await first.tokens.addToken(OTHER, initialMeta(OTHER, '2026-11-01T00:00:00.000Z'));
    await chrome.storage.local.set({ githubToken: TOKEN });
    const { store } = load();
    expect(await store.getToken()).toBe(OTHER);
    expect(await chrome.storage.local.get('githubToken')).toEqual({});
  });

  test('clearTokens removes every secret and any legacy copy', async () => {
    const idb = fakeIndexedDB();
    g.indexedDB = idb.factory;
    const { tokens, store } = load();
    await tokens.addToken(TOKEN, initialMeta(TOKEN, '2026-11-01T00:00:00.000Z'));
    await tokens.clearTokens();
    expect(await store.getToken()).toBe('');
    expect(secretsIn(idb)?.size).toBe(0);
    expect(await load().store.getToken()).toBe('');
  });
});
