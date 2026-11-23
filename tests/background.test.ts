/**
 * @jest-environment node
 */
// Background worker behaviour with a mocked fetch (node env: real Response/Headers).

import type * as ApiModule from '../src/background/api';
import type * as AlarmsModule from '../src/background/alarms';
import type * as AuthModule from '../src/background/auth';
import type * as AuthCheckModule from '../src/background/auth-check';
import type * as HttpModule from '../src/background/http';
import type * as InboxModule from '../src/background/inbox';
import type * as RouterModule from '../src/background/router';
import type * as SecretStoreModule from '../src/background/secret-store';
import type * as StoreModule from '../src/background/store';
import type * as TokensModule from '../src/background/tokens';
import { initialMeta } from '../src/background/token-model';

type Mods = {
  api: typeof ApiModule;
  alarms: typeof AlarmsModule;
  auth: typeof AuthModule;
  authCheck: typeof AuthCheckModule;
  http: typeof HttpModule;
  inbox: typeof InboxModule;
  router: typeof RouterModule;
  secrets: typeof SecretStoreModule;
  store: typeof StoreModule;
  tokens: typeof TokensModule;
};

const TOKEN = `ghp_${'a'.repeat(36)}`;
const TOKEN_B = `ghp_${'b'.repeat(36)}`;
const fetchMock = jest.fn();

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** Let queued promise chains / timers run until `cond` holds. */
async function until(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 0));
  if (!cond()) throw new Error('condition not reached');
}

const authHeader = (call: unknown[]): string => ((call[1] as RequestInit).headers as Record<string, string>).Authorization;

function respond(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(text, {
    status,
    headers: { 'x-ratelimit-resource': 'core', 'x-ratelimit-remaining': '4999', 'x-ratelimit-limit': '5000', 'x-ratelimit-reset': '9999999999', ...headers },
  });
}

function load(): Mods {
  let mods!: Mods;
  jest.isolateModules(() => {
    mods = {
      api: require('../src/background/api'),
      alarms: require('../src/background/alarms'),
      auth: require('../src/background/auth'),
      authCheck: require('../src/background/auth-check'),
      http: require('../src/background/http'),
      inbox: require('../src/background/inbox'),
      router: require('../src/background/router'),
      secrets: require('../src/background/secret-store'),
      store: require('../src/background/store'),
      tokens: require('../src/background/tokens'),
    };
  });
  return mods;
}

beforeEach(() => {
  (globalThis as unknown as { __resetChromeStorage: () => void }).__resetChromeStorage();
  fetchMock.mockReset();
  (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
});

/** Seeds the token where versions <= 0.4 kept it; the migration moves it into the secret store. */
async function setToken(): Promise<void> {
  await chrome.storage.local.set({ githubToken: TOKEN });
}

/** Store a token directly (no validation request). */
function storeToken(mods: Mods, token: string): Promise<unknown> {
  return mods.tokens.addToken(token, initialMeta(token, new Date().toISOString()));
}

describe('API proxy', () => {
  test('without a token GitHub is never called (no anonymous 60/h burn)', async () => {
    const { api } = load();
    expect(await api.handleRest({ path: '/user' })).toEqual({ ok: false, status: 401, error: 'no-token' });
    expect(await api.handleGraphQL({ query: 'query { viewer { login } }' })).toMatchObject({ error: 'no-token' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('rejects absolute / protocol-relative paths before fetching', async () => {
    const { api } = load();
    await setToken();
    expect(await api.handleRest({ path: '//evil.example/x' })).toEqual({ ok: false, error: 'invalid-path' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('injects the token and does NOT treat a permissions 403 as a rate limit', async () => {
    const { api } = load();
    await setToken();
    fetchMock.mockResolvedValueOnce(respond(403, { message: 'Resource not accessible by personal access token' }));
    fetchMock.mockResolvedValueOnce(respond(200, { login: 'me' }));
    const first = await api.handleRest({ path: '/repos/o/private', noCache: true });
    expect(first).toMatchObject({ ok: false, status: 403, error: 'Resource not accessible by personal access token' });
    expect(first.rateLimited).toBeUndefined();
    const second = await api.handleRest({ path: '/user', noCache: true });
    expect(second).toMatchObject({ ok: true, data: { login: 'me' } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/o/private');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  test('an exhausted budget short-circuits that resource only', async () => {
    const { api } = load();
    await setToken();
    fetchMock.mockResolvedValueOnce(respond(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0' }));
    expect(await api.handleRest({ path: '/user', noCache: true })).toMatchObject({ ok: false, rateLimited: true });
    expect(await api.handleRest({ path: '/repos/o/r', noCache: true })).toMatchObject({ rateLimited: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce(respond(200, { data: { viewer: { login: 'me' } } }, { 'x-ratelimit-resource': 'graphql' }));
    expect(await api.handleGraphQL({ query: 'query { viewer { login } }', noCache: true })).toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('GraphQL errors come back with partial data and are not cached', async () => {
    const { api } = load();
    await setToken();
    const body = { data: { pr0: { pullRequest: { number: 1 } }, pr1: null }, errors: [{ type: 'NOT_FOUND', message: 'Could not resolve to a Repository' }] };
    fetchMock.mockImplementation(() => Promise.resolve(respond(200, body, { 'x-ratelimit-resource': 'graphql' })));
    const res = await api.handleGraphQL({ query: 'query Q { x }' });
    expect(res).toMatchObject({ ok: false, error: 'Could not resolve to a Repository', data: body.data });
    await api.handleGraphQL({ query: 'query Q { x }' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('successful responses are served from the session cache', async () => {
    const { api } = load();
    await setToken();
    fetchMock.mockImplementation(() => Promise.resolve(respond(200, { data: { ok: 1 } }, { 'x-ratelimit-resource': 'graphql' })));
    const a = await api.handleGraphQL({ query: 'query Q { x }', variables: { a: 1, b: 2 } });
    const b = await api.handleGraphQL({ query: 'query Q { x }', variables: { b: 2, a: 1 } });
    expect(a).toEqual(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await api.handleGraphQL({ query: 'mutation M { x }' });
    await api.handleGraphQL({ query: 'mutation M { x }' });
    expect(fetchMock).toHaveBeenCalledTimes(3); // mutations are never cached
  });

  test('HTML / non-JSON error bodies do not throw', async () => {
    const { api } = load();
    await setToken();
    fetchMock.mockResolvedValueOnce(respond(502, '<html>Bad gateway</html>'));
    expect(await api.handleRest({ path: '/user', noCache: true })).toMatchObject({ ok: false, status: 502, error: 'HTTP 502' });
  });

  test('network failures resolve to a result', async () => {
    const { api } = load();
    await setToken();
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await api.handleRest({ path: '/user', noCache: true })).toMatchObject({ ok: false, status: 0 });
  });

  test('at most 4 requests are in flight', async () => {
    const { api } = load();
    await setToken();
    let active = 0;
    let peak = 0;
    fetchMock.mockImplementation(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return respond(200, { ok: true });
    });
    await Promise.all(Array.from({ length: 12 }, (_, i) => api.handleRest({ path: `/repos/o/r/pulls/${i}`, noCache: true })));
    expect(fetchMock).toHaveBeenCalledTimes(12);
    expect(peak).toBeLessThanOrEqual(4);
  });
});

describe('alarms', () => {
  test('created only when missing or when the period changed', async () => {
    const { alarms, store } = load();
    const create = jest.spyOn(chrome.alarms, 'create');
    await alarms.syncAlarms();
    expect(create.mock.calls.map((c) => [c[0], (c[1] as chrome.alarms.AlarmCreateInfo).periodInMinutes])).toEqual([
      ['auth:validate', 360],
      ['inbox:refresh', 15],
    ]);
    create.mockClear();
    await alarms.syncAlarms(); // e.g. the next service-worker wake
    expect(create).not.toHaveBeenCalled();

    await chrome.storage.local.set({ notificationInterval: 30 });
    store.invalidateSettings();
    await alarms.syncAlarms();
    expect(create).toHaveBeenCalledTimes(1);
    expect(await chrome.alarms.get('inbox:refresh')).toMatchObject({ periodInMinutes: 30 });
    create.mockRestore();
  });

  test('disabling the badge clears it; the refresh alarm stays while desktop notifications need it', async () => {
    const { alarms, store } = load();
    await alarms.syncAlarms();
    const badge = jest.spyOn(chrome.action, 'setBadgeText');
    await chrome.storage.local.set({ notificationsEnabled: false });
    store.invalidateSettings();
    await alarms.syncAlarms();
    expect(badge).toHaveBeenLastCalledWith({ text: '' });
    expect(await chrome.alarms.get('inbox:refresh')).toBeDefined();

    await chrome.storage.local.set({ desktopNotifications: false });
    store.invalidateSettings();
    await alarms.syncAlarms();
    expect(await chrome.alarms.get('inbox:refresh')).toBeUndefined();
    badge.mockRestore();
  });
});

describe('inbox', () => {
  const pr = (n: number, extra: Record<string, unknown> = {}) => ({
    url: `https://github.com/o/r/pull/${n}`,
    number: n,
    title: `PR ${n}`,
    updatedAt: '2026-11-20T00:00:00Z',
    repository: { nameWithOwner: 'o/r' },
    author: { login: 'me' },
    ...extra,
  });

  test('no token → needsAuth without a request', async () => {
    const { inbox } = load();
    expect(await inbox.getInbox()).toMatchObject({ needsAuth: true, items: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('first sync badges only new review requests; markSeen clears them', async () => {
    const { inbox } = load();
    await setToken();
    const badge = jest.spyOn(chrome.action, 'setBadgeText');
    fetchMock.mockResolvedValueOnce(
      respond(200, {
        data: {
          viewer: { login: 'me' },
          authored: { nodes: [pr(1)] },
          reviewRequested: { nodes: [pr(2, { author: { login: 'bob' } })] },
          assigned: { nodes: [] },
        },
      }, { 'x-ratelimit-resource': 'graphql' })
    );
    const result = await inbox.getInbox();
    expect(result.unseenCount).toBe(1);
    expect(badge).toHaveBeenLastCalledWith({ text: '1' });

    // Fresh cache: no second request.
    expect((await inbox.getInbox()).items).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    expect(await inbox.markSeen(['https://github.com/o/r/pull/2'])).toEqual({ ok: true, unseenCount: 0 });
    expect(badge).toHaveBeenLastCalledWith({ text: '' });
    badge.mockRestore();
  });

  test('a failed refresh keeps the last good items and reports the error', async () => {
    const { inbox } = load();
    await setToken();
    await chrome.storage.local.set({ inboxState: { items: [{ url: 'u', reasons: ['authored'], unseen: false }], fetchedAt: 1, seen: {} } });
    fetchMock.mockResolvedValueOnce(respond(503, 'unavailable'));
    expect(await inbox.getInbox(true)).toMatchObject({ error: 'network', items: [{ url: 'u' }] });
  });
});

describe('message router', () => {
  const ext = { id: 'test-extension-id', url: 'chrome-extension://test-extension-id/options/options.html' };
  const content = { id: 'test-extension-id', url: 'https://github.com/o/r/pulls', tab: { id: 1 } as chrome.tabs.Tab };

  function send(router: Mods['router'], msg: unknown, sender: chrome.runtime.MessageSender): Promise<{ async: boolean; res: unknown }> {
    return new Promise((resolve) => {
      let isAsync = false;
      isAsync = router.onMessage(msg, sender, (res) => resolve({ async: isAsync, res }));
    });
  }

  test('rejects foreign senders and unknown requests, but always answers', async () => {
    const { router } = load();
    expect((await send(router, { type: 'auth:status' }, { id: 'other' })).res).toEqual({ ok: false, error: 'forbidden' });
    expect((await send(router, { type: 'nope' }, ext)).res).toEqual({ ok: false, error: 'unknown-request' });
  });

  test('content scripts cannot change credentials', async () => {
    const { router } = load();
    expect((await send(router, { type: 'auth:setToken', token: TOKEN }, content)).res).toEqual({ authenticated: false, error: 'forbidden' });
    expect((await send(router, { type: 'auth:logout' }, content)).res).toEqual({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('setToken: 401 → "invalid"; network error → distinct code; 200 → stored', async () => {
    const { router, store } = load();
    fetchMock.mockResolvedValueOnce(respond(401, { message: 'Bad credentials' }));
    expect((await send(router, { type: 'auth:setToken', token: TOKEN }, ext)).res).toEqual({ authenticated: false, error: 'invalid' });
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect((await send(router, { type: 'auth:setToken', token: TOKEN }, ext)).res).toEqual({ authenticated: false, error: 'network' });
    expect((await send(router, { type: 'auth:setToken', token: 'not a token' }, ext)).res).toEqual({ authenticated: false, error: 'format' });

    fetchMock.mockResolvedValue(respond(200, { login: 'me', name: 'Me', avatar_url: 'https://avatars.githubusercontent.com/u/1', html_url: 'https://github.com/me' }));
    const ok = (await send(router, { type: 'auth:setToken', token: `  ${TOKEN} ` }, ext)).res;
    expect(ok).toMatchObject({ authenticated: true, tokenKind: 'classic', account: { login: 'me', avatarUrl: 'https://avatars.githubusercontent.com/u/1' } });
    expect(await store.getToken()).toBe(TOKEN);
    // Never in chrome.storage (readable by content scripts, echoed by onChanged).
    expect(await chrome.storage.local.get('githubToken')).toEqual({});
  });

  test('content scripts may only run read queries through the GraphQL proxy', async () => {
    const { router } = load();
    await setToken();
    for (const query of [
      'mutation { addStar(input: {starrableId: "x"}) { clientMutationId } }',
      ',mutation{addStar(input:{starrableId:"x"}){clientMutationId}}',
      '# hi\nmutation { x }',
      'MUTATION { x }',
      'query { a } mutation { b }',
      'query { a(x: "#") } mutation { b }',
      'subscription { x }',
      '{ viewer { login } }',
    ]) {
      expect((await send(router, { type: 'api:graphql', query }, content)).res).toEqual({ ok: false, error: 'forbidden' });
    }
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockImplementation(() => Promise.resolve(respond(200, { data: { viewer: { login: 'me' } } }, { 'x-ratelimit-resource': 'graphql' })));
    expect((await send(router, { type: 'api:graphql', query: 'query { viewer { login } }' }, content)).res).toMatchObject({ ok: true });
    // Extension pages are not restricted.
    expect((await send(router, { type: 'api:graphql', query: 'mutation M { x }' }, ext)).res).toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('token storage', () => {
  test('a token left in chrome.storage.local is migrated into the secret store', async () => {
    const { store } = load();
    await setToken();
    expect(await store.getToken()).toBe(TOKEN);
    expect(await chrome.storage.local.get('githubToken')).toEqual({});
    // Still there after the legacy copy is gone.
    expect(await store.getToken()).toBe(TOKEN);
  });

  test('the single secret of the previous build becomes tokens[0] (discovery pending)', async () => {
    const { secrets, store, tokens } = load();
    await secrets.setSecret('githubToken', TOKEN);
    expect(await store.getToken()).toBe(TOKEN);
    const [t] = await tokens.listTokens();
    expect(t).toMatchObject({ token: TOKEN, kind: 'classic', hint: TOKEN.slice(-4), owners: null, pending: true });
    expect(await secrets.getSecret('githubToken')).toBeUndefined();
  });

  test('logout deletes the secret', async () => {
    const { store, router } = load();
    await setToken();
    const ext = { id: 'test-extension-id', url: 'chrome-extension://test-extension-id/popup/popup.html' };
    await new Promise((resolve) => router.onMessage({ type: 'auth:logout' }, ext, resolve));
    expect(await store.getToken()).toBe('');
  });
});

describe('inbox state races', () => {
  const url = (n: number) => `https://github.com/o/r/pull/${n}`;
  const raw = (n: number, extra: Record<string, unknown> = {}) => ({
    url: url(n),
    number: n,
    title: `PR ${n}`,
    updatedAt: '2026-11-20T00:00:00Z',
    repository: { nameWithOwner: 'o/r' },
    author: { login: 'bob' },
    ...extra,
  });
  const inboxResponse = (reviewRequested: number[], authored: number[] = []) =>
    respond(200, {
      data: {
        viewer: { login: 'me' },
        authored: { nodes: authored.map((n) => raw(n, { author: { login: 'me' } })) },
        reviewRequested: { nodes: reviewRequested.map((n) => raw(n)) },
        assigned: { nodes: [] },
      },
    }, { 'x-ratelimit-resource': 'graphql' });
  const unseenItem = (n: number) => ({ url: url(n), reasons: ['review-requested'], unseen: true });
  const stored = async () => (await chrome.storage.local.get('inboxState')).inboxState as { seen: Record<string, string>; items: { url: string }[] } | undefined;

  test('a markSeen landing while a refresh is in flight is not overwritten', async () => {
    const { inbox } = load();
    await setToken();
    await chrome.storage.local.set({ inboxState: { items: [unseenItem(2)], fetchedAt: 0, seen: {} } });
    const badge = jest.spyOn(chrome.action, 'setBadgeText');
    const gql = deferred<Response>();
    fetchMock.mockImplementationOnce(() => gql.promise);

    const refresh = inbox.refreshInbox();
    await until(() => fetchMock.mock.calls.length === 1);
    expect(await inbox.markSeen([url(2)])).toEqual({ ok: true, unseenCount: 0 });
    gql.resolve(inboxResponse([2]));

    expect((await refresh).unseenCount).toBe(0);
    expect((await stored())?.seen[url(2)]).toBeDefined();
    expect(badge).toHaveBeenLastCalledWith({ text: '' });
    badge.mockRestore();
  });

  test('concurrent markSeen calls do not clobber each other', async () => {
    const { inbox } = load();
    await setToken();
    await chrome.storage.local.set({ inboxState: { items: [unseenItem(1), unseenItem(2)], fetchedAt: Date.now(), seen: {} } });
    await Promise.all([inbox.markSeen([url(1)]), inbox.markSeen([url(2)])]);
    expect(Object.keys((await stored())?.seen ?? {}).sort()).toEqual([url(1), url(2)]);
    expect((await inbox.getInbox()).unseenCount).toBe(0);
  });

  test('a PR visited before the first refresh is remembered (lower-cased) and not badged later', async () => {
    const { inbox } = load();
    await setToken();
    expect(await inbox.markSeen(['https://github.com/O/R/pull/7'])).toEqual({ ok: true, unseenCount: 0 });
    expect((await stored())?.seen).toHaveProperty([url(7)]);
    fetchMock.mockResolvedValueOnce(inboxResponse([7]));
    expect((await inbox.getInbox()).unseenCount).toBe(0);
  });

  test('a refresh finishing after logout writes nothing back and leaves the badge empty', async () => {
    const { inbox, authCheck } = load();
    await setToken();
    const badge = jest.spyOn(chrome.action, 'setBadgeText');
    const gql = deferred<Response>();
    fetchMock.mockImplementationOnce(() => gql.promise);

    const refresh = inbox.refreshInbox();
    await until(() => fetchMock.mock.calls.length === 1);
    await authCheck.dropCredentials();
    gql.resolve(inboxResponse([1, 2]));

    expect(await refresh).toMatchObject({ needsAuth: true, items: [] });
    expect(await stored()).toBeUndefined();
    expect(badge).toHaveBeenLastCalledWith({ text: '' });
    badge.mockRestore();
  });

  test('markSeen racing a logout writes nothing back', async () => {
    const { inbox, authCheck } = load();
    await setToken();
    await chrome.storage.local.set({ inboxState: { items: [unseenItem(1), unseenItem(2)], fetchedAt: Date.now(), seen: {} } });
    await inbox.getInbox(); // migrate the token before racing
    // Either order: whatever markSeen wrote is gone once the logout finished.
    await Promise.all([inbox.markSeen([url(1)]), authCheck.dropCredentials()]);
    expect(await stored()).toBeUndefined();
    expect(await inbox.markSeen([url(2)])).toEqual({ ok: false, unseenCount: 0 });
    expect(await stored()).toBeUndefined();
  });

  test('updateBadge(count) never shows a count without a token', async () => {
    const { inbox } = load();
    const badge = jest.spyOn(chrome.action, 'setBadgeText');
    await inbox.updateBadge(3);
    expect(badge).toHaveBeenLastCalledWith({ text: '' });
    badge.mockRestore();
  });
});

describe('account switch', () => {
  const ext = { id: 'test-extension-id', url: 'chrome-extension://test-extension-id/options/options.html' };
  const user = (login: string) => respond(200, { login, name: null, avatar_url: '', html_url: `https://github.com/${login}` });
  const cacheKeys = async () => Object.keys(await chrome.storage.session.get(null)).filter((k) => k.startsWith('bghub:rc:'));

  function switchTo(router: Mods['router'], token: string): Promise<unknown> {
    return new Promise((resolve) => router.onMessage({ type: 'auth:setToken', token }, ext, resolve));
  }

  test('a response for the old token is not cached after the switch', async () => {
    const mods = load();
    const { api, router, authCheck } = mods;
    await setToken();
    const old = deferred<Response>();
    fetchMock.mockImplementationOnce(() => old.promise);
    fetchMock.mockImplementation((u: string) =>
      Promise.resolve(u.endsWith('/user') ? user('other') : respond(200, { data: { viewer: { login: 'other' } } }, { 'x-ratelimit-resource': 'graphql' }))
    );

    const pending = api.handleGraphQL({ query: 'query Q { x }' });
    await until(() => fetchMock.mock.calls.length === 1);
    await authCheck.dropCredentials(); // switching accounts = sign out + add
    await switchTo(router, TOKEN_B);
    old.resolve(respond(200, { data: { secret: 'old account' } }, { 'x-ratelimit-resource': 'graphql' }));
    await pending;
    expect(await cacheKeys()).toEqual([]);

    const calls = fetchMock.mock.calls.length;
    expect(await api.handleGraphQL({ query: 'query Q { x }' })).not.toMatchObject({ data: { secret: 'old account' } });
    expect(fetchMock.mock.calls.length).toBe(calls + 1);
    expect(authHeader(fetchMock.mock.calls[calls])).toBe(`Bearer ${TOKEN_B}`);
  });

  test('setToken restarts an in-flight inbox refresh; the old response is dropped', async () => {
    const { inbox, router, authCheck } = load();
    await setToken();
    await chrome.storage.local.set({ githubUser: { login: 'me' } });
    const old = deferred<Response>();
    fetchMock.mockImplementationOnce(() => old.promise);
    fetchMock.mockImplementation((u: string) =>
      Promise.resolve(
        u.endsWith('/user')
          ? user('other')
          : respond(200, { data: { viewer: { login: 'other' }, authored: { nodes: [{ url: 'https://github.com/x/y/pull/7', number: 7, author: { login: 'other' } }] } } }, { 'x-ratelimit-resource': 'graphql' })
      )
    );

    const stale = inbox.refreshInbox();
    await until(() => fetchMock.mock.calls.length === 1);
    await authCheck.dropCredentials();
    await switchTo(router, TOKEN_B);
    const fresh = inbox.refreshInbox(); // shares the refresh setToken started
    old.resolve(respond(200, { data: { viewer: { login: 'me' }, authored: { nodes: [{ url: 'https://github.com/o/r/pull/1', number: 1 }] } } }, { 'x-ratelimit-resource': 'graphql' }));

    await stale;
    expect((await fresh).items.map((i) => i.url)).toEqual(['https://github.com/x/y/pull/7']);
    const state = (await chrome.storage.local.get('inboxState')).inboxState as { items: { url: string }[] };
    expect(state.items.map((i) => i.url)).toEqual(['https://github.com/x/y/pull/7']);
    const graphqlCalls = fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/graphql'));
    expect(authHeader(graphqlCalls[graphqlCalls.length - 1])).toBe(`Bearer ${TOKEN_B}`);
  });

  test('an account check finishing after logout does not write the account back', async () => {
    const mods = load();
    const { authCheck, auth } = mods;
    await setToken();
    const check = deferred<Response>();
    fetchMock.mockImplementationOnce(() => check.promise);
    const validating = authCheck.validateStoredTokens();
    await until(() => fetchMock.mock.calls.length === 1);
    await authCheck.dropCredentials();
    check.resolve(user('me'));
    await validating;
    expect(await chrome.storage.local.get('githubUser')).toEqual({});

    await storeToken(mods, TOKEN); // the one-time legacy migration already ran
    const status = deferred<Response>();
    fetchMock.mockImplementationOnce(() => status.promise);
    const statusing = auth.authStatus(true);
    await until(() => fetchMock.mock.calls.length === 2);
    await authCheck.dropCredentials();
    status.resolve(user('me'));
    expect(await statusing).toEqual({ authenticated: false });
    expect(await chrome.storage.local.get('githubUser')).toEqual({});
  });
});

describe('rate limits and credentials', () => {
  const ext = { id: 'test-extension-id', url: 'chrome-extension://test-extension-id/options/options.html' };
  const exhausted = () => respond(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '9999999999' });

  test('a blocked REST budget does not stop validating a new token, and setToken resets the tracker', async () => {
    const { api, router } = load();
    await setToken();
    fetchMock.mockResolvedValueOnce(exhausted());
    expect(await api.handleRest({ path: '/repos/o/r', noCache: true })).toMatchObject({ rateLimited: true });
    expect(await api.handleRest({ path: '/user', noCache: true })).toMatchObject({ rateLimited: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValue(respond(200, { login: 'me' }));
    const res = await new Promise((resolve) => router.onMessage({ type: 'auth:setToken', token: TOKEN_B }, ext, resolve));
    expect(res).toMatchObject({ authenticated: true, rateLimit: { remaining: 4999, limit: 5000 } });
    // setToken also starts an inbox refresh (GraphQL); count the REST call only.
    const repoCalls = () => fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/repos/o/r')).length;
    expect(await api.handleRest({ path: '/repos/o/r', noCache: true })).toMatchObject({ ok: true });
    expect(repoCalls()).toBe(2);
  });

  test('a rejected candidate token leaves the stored token\'s budget untouched', async () => {
    const { auth, http } = load();
    await setToken();
    fetchMock.mockResolvedValueOnce(respond(200, { login: 'me' }, { 'x-ratelimit-remaining': '4000' }));
    await auth.authStatus(true);
    fetchMock.mockResolvedValueOnce(respond(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0' }));
    // A failed add reports the error next to the (still signed-in) current status.
    expect(await auth.setToken(TOKEN_B)).toMatchObject({ authenticated: true, error: 'rate-limited' });
    expect(http.rateLimitSnapshot('core')).toMatchObject({ remaining: 4000 });
  });

  test('headers of a 401 (anonymous 60/h budget) are not recorded', async () => {
    const { authCheck, http } = load();
    fetchMock.mockResolvedValueOnce(respond(401, { message: 'Bad credentials' }, { 'x-ratelimit-remaining': '59', 'x-ratelimit-limit': '60' }));
    expect((await authCheck.fetchAccount(TOKEN)).res.status).toBe(401);
    expect(http.rateLimitSnapshot('core')).toBeUndefined();
  });

  test('dropping credentials resets the tracker', async () => {
    const mods = load();
    const { api, authCheck, http } = mods;
    await setToken();
    fetchMock.mockResolvedValueOnce(exhausted());
    await api.handleRest({ path: '/repos/o/r', noCache: true });
    expect(http.rateLimitSnapshot('core')).toBeDefined();
    await authCheck.dropCredentials();
    expect(http.rateLimitSnapshot('core')).toBeUndefined();
    expect(await chrome.storage.session.get('bghub:rateLimits')).toEqual({});

    await storeToken(mods, TOKEN_B);
    fetchMock.mockResolvedValueOnce(respond(200, { ok: true }));
    expect(await api.handleRest({ path: '/repos/o/r', noCache: true })).toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
