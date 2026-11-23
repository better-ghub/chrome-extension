// Settings sync storage (sync + local fallback), migration and export/import.

import { DEFAULT_SETTINGS, getSettings, onSettingsChanged, resetSettings, setSettings } from '../src/core/settings';
import { LOCAL_ONLY_KEY, migrateSettingsToSync } from '../src/core/settings-storage';
import { buildSettingsFile, EXPORT_FILENAME, MAX_IMPORT_BYTES, parseSettingsFile, serializeSettings } from '../src/pages/settings-io';

const sync = chrome.storage.sync;
const local = chrome.storage.local;

beforeEach(() => {
  (globalThis as unknown as { __resetChromeStorage: () => void }).__resetChromeStorage();
  jest.restoreAllMocks();
});

describe('sync storage', () => {
  test('writes go to sync and leave local clean', async () => {
    await local.set({ staleDays: 3 });
    await setSettings({ staleDays: 14, language: 'pl' });
    expect(await sync.get(['staleDays', 'language'])).toEqual({ staleDays: 14, language: 'pl' });
    expect(await local.get(['staleDays', LOCAL_ONLY_KEY])).toEqual({});
    expect((await getSettings()).staleDays).toBe(14);
  });

  test('a failing sync write falls back to local and is read from there', async () => {
    jest.spyOn(sync, 'set').mockImplementation((() => Promise.reject(new Error('QUOTA_BYTES_PER_ITEM quota exceeded'))) as never);
    await setSettings({ staleDays: 30 });
    expect(await local.get(['staleDays', LOCAL_ONLY_KEY])).toEqual({ staleDays: 30, [LOCAL_ONLY_KEY]: ['staleDays'] });
    expect((await getSettings()).staleDays).toBe(30);
  });

  test('an oversized value stays local; a stale sync copy cannot win', async () => {
    await setSettings({ generatedPatterns: ['a'] });
    const big = Array.from({ length: 100 }, (_, i) => `${'x'.repeat(190)}${i}`);
    await setSettings({ generatedPatterns: big });
    expect((await local.get(LOCAL_ONLY_KEY))[LOCAL_ONLY_KEY]).toEqual(['generatedPatterns']);
    expect(await sync.get('generatedPatterns')).toEqual({});
    expect((await getSettings()).generatedPatterns).toHaveLength(100);
    // Once it fits again it returns to sync.
    await setSettings({ generatedPatterns: ['b'] });
    expect(await local.get(LOCAL_ONLY_KEY)).toEqual({});
    expect((await getSettings()).generatedPatterns).toEqual(['b']);
  });

  test('un-migrated local values are still read; sync wins otherwise', async () => {
    await local.set({ staleDays: 3, cacheDuration: 10 });
    await sync.set({ staleDays: 14 });
    const s = await getSettings();
    expect(s.staleDays).toBe(14);
    expect(s.cacheDuration).toBe(10);
  });

  test('works without chrome.storage.sync', async () => {
    const original = chrome.storage.sync;
    (chrome.storage as unknown as { sync?: unknown }).sync = undefined;
    try {
      await setSettings({ staleDays: 3 });
      expect((await getSettings()).staleDays).toBe(3);
    } finally {
      (chrome.storage as unknown as { sync: unknown }).sync = original;
    }
  });

  test('reset clears both areas', async () => {
    await setSettings({ staleDays: 3 });
    await local.set({ language: 'en' });
    await resetSettings();
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
    expect(await sync.get(null)).toEqual({});
  });

  test('onSettingsChanged reacts to sync and local, ignoring the bookkeeping key', () => {
    let listener: (c: Record<string, unknown>, area: string) => void = () => undefined;
    jest.spyOn(chrome.storage.onChanged, 'addListener').mockImplementation(((fn: typeof listener) => (listener = fn)) as never);
    const cb = jest.fn();
    onSettingsChanged(cb);
    listener({ [LOCAL_ONLY_KEY]: {} }, 'local');
    listener({ other: {} }, 'sync');
    listener({ staleDays: {} }, 'session');
    return Promise.resolve().then(async () => {
      expect(cb).not.toHaveBeenCalled();
      listener({ staleDays: {} }, 'sync');
      listener({ language: {} }, 'local');
      await new Promise((r) => setTimeout(r, 0));
      expect(cb).toHaveBeenCalledTimes(2);
      expect(cb.mock.calls[0][1]).toEqual(['staleDays']);
    });
  });
});

describe('migration', () => {
  const KEYS = ['staleDays', 'language'];

  test('copies local settings to sync once and removes them from local', async () => {
    await local.set({ staleDays: 3, language: 'pl', inboxState: { x: 1 } });
    expect(await migrateSettingsToSync(KEYS)).toBe(2);
    expect(await sync.get(KEYS)).toEqual({ staleDays: 3, language: 'pl' });
    expect(await local.get(null)).toEqual({ inboxState: { x: 1 } });
    expect(await migrateSettingsToSync(KEYS)).toBe(0);
  });

  test('does nothing when sync already has settings', async () => {
    await sync.set({ language: 'en' });
    await local.set({ staleDays: 3 });
    expect(await migrateSettingsToSync(KEYS)).toBe(0);
    expect(await local.get('staleDays')).toEqual({ staleDays: 3 });
  });

  test('keeps keys local when sync fails', async () => {
    await local.set({ staleDays: 3 });
    jest.spyOn(sync, 'set').mockImplementation((() => Promise.reject(new Error('quota'))) as never);
    await migrateSettingsToSync(KEYS);
    expect(await local.get(['staleDays', LOCAL_ONLY_KEY])).toEqual({ staleDays: 3, [LOCAL_ONLY_KEY]: ['staleDays'] });
    expect((await getSettings()).staleDays).toBe(3);
  });
});

describe('export / import', () => {
  test('serialize produces the documented envelope without extras', () => {
    const file = JSON.parse(serializeSettings({ ...DEFAULT_SETTINGS, staleDays: 14 }, '0.4.0', new Date('2026-01-02T03:04:05Z')));
    expect(file.app).toBe('better-ghub');
    expect(file.version).toBe('0.4.0');
    expect(file.exportedAt).toBe('2026-01-02T03:04:05.000Z');
    expect(file.settings.staleDays).toBe(14);
    expect('shortcutBindings' in file.settings).toBe(false);
    expect(Object.keys(file)).toEqual(['app', 'version', 'exportedAt', 'settings']);
    expect(EXPORT_FILENAME).toBe('better-ghub-settings.json');
  });

  test('round trip', () => {
    const text = serializeSettings({ ...DEFAULT_SETTINGS, language: 'pl', quietHoursStart: '21:30' }, '1');
    const res = parseSettingsFile(text);
    expect(res.ok && res.settings).toMatchObject({ language: 'pl', quietHoursStart: '21:30' });
    expect(res.ok && res.count).toBe(Object.keys(buildSettingsFile(DEFAULT_SETTINGS, '1').settings).length);
  });

  test('rejects invalid JSON, wrong app and empty/oversized input', () => {
    expect(parseSettingsFile('{nope')).toEqual({ ok: false, error: 'invalid-json' });
    expect(parseSettingsFile('[]')).toEqual({ ok: false, error: 'wrong-app' });
    expect(parseSettingsFile('{"app":"other","settings":{}}')).toEqual({ ok: false, error: 'wrong-app' });
    expect(parseSettingsFile('{"app":"better-ghub"}')).toEqual({ ok: false, error: 'no-settings' });
    expect(parseSettingsFile('{"app":"better-ghub","settings":{"bogus":1}}')).toEqual({ ok: false, error: 'no-settings' });
    expect(parseSettingsFile(' '.repeat(MAX_IMPORT_BYTES + 1))).toEqual({ ok: false, error: 'too-large' });
  });

  test('validates through coerce and ignores unknown keys', () => {
    const res = parseSettingsFile(
      JSON.stringify({
        app: 'better-ghub',
        settings: { staleDays: 9999, language: 'pl', bogus: true, quietHoursStart: 'nope', githubToken: 'ghp_x', shortcutBindings: 'str', prListEnabled: false, cacheDuration: null },
      }),
    );
    expect(res).toEqual({ ok: true, count: 4, settings: { staleDays: 7, language: 'pl', quietHoursStart: '22:00', prListEnabled: false } });
  });
});
