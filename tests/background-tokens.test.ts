/**
 * @jest-environment node
 */
// Several tokens for one GitHub account: storage, routing, fallback, inbox merge.

import type * as ApiModule from '../src/background/api';
import type * as AuthModule from '../src/background/auth';
import type * as AuthCheckModule from '../src/background/auth-check';
import type * as InboxModule from '../src/background/inbox';
import type * as RouterModule from '../src/background/router';
import type * as SecretStoreModule from '../src/background/secret-store';
import type * as TokensModule from '../src/background/tokens';
import type { AuthStatus, InboxItem } from '../src/core/messages';
import { cacheKey } from '../src/background/cache';
import { mergeInboxItems } from '../src/background/inbox-model';
import { sectionHash } from '../src/background/pages';
import {
  candidates,
  initialMeta,
  isAccessFailure,
  normalizeOwner,
  ownerFromPath,
  ownersFromRepos,
  parseSsoHeader,
  parseTokenExpiration,
  tokenKindOf,
  type StoredToken,
} from '../src/background/token-model';

type Mods = {
  api: typeof ApiModule;
  auth: typeof AuthModule;
  authCheck: typeof AuthCheckModule;
  inbox: typeof InboxModule;
  router: typeof RouterModule;
  secrets: typeof SecretStoreModule;
  tokens: typeof TokensModule;
};

function load(): Mods {
  let mods!: Mods;
  jest.isolateModules(() => {
    mods = {
      api: require('../src/background/api'),
      auth: require('../src/background/auth'),
      authCheck: require('../src/background/auth-check'),
      inbox: require('../src/background/inbox'),
      router: require('../src/background/router'),
      secrets: require('../src/background/secret-store'),
      tokens: require('../src/background/tokens'),
    };
  });
  return mods;
}

const FG_ACME = `github_pat_${'A'.repeat(40)}_acme`;
const FG_BETA = `github_pat_${'B'.repeat(40)}_beta`;
const CLASSIC = `ghp_${'c'.repeat(36)}`;
const STRANGER = `ghp_${'s'.repeat(36)}`;
const SSO_URL = 'https://github.com/orgs/acme/sso?authorization_request=abc123';

const fetchMock = jest.fn();
const ext = { id: 'test-extension-id', url: 'chrome-extension://test-extension-id/options/options.html' };
const content = { id: 'test-extension-id', url: 'https://github.com/acme/x/pulls', tab: { id: 1 } as chrome.tabs.Tab };

function respond(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'x-ratelimit-resource': 'core', 'x-ratelimit-remaining': '4999', 'x-ratelimit-limit': '5000', 'x-ratelimit-reset': '9999999999', ...headers },
  });
}

type Handler = (path: string, token: string, body: { query?: string; variables?: Record<string, unknown> } | undefined) => Response | undefined;

/** Fake GitHub: `handler` answers first, then sane defaults (/user → "me", no private repos). */
function github(handler: Handler = () => undefined): void {
  fetchMock.mockImplementation((url: string, init: RequestInit) => {
    const token = ((init.headers as Record<string, string>).Authorization ?? '').replace(/^Bearer /, '');
    const path = url.replace('https://api.github.com', '');
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const res = handler(path, token, body);
    if (res) return Promise.resolve(res);
    if (path === '/user') return Promise.resolve(respond(200, { login: 'me', name: 'Me' }));
    if (path.startsWith('/user/repos')) {
      const owner = token === FG_ACME ? 'Acme' : token === FG_BETA ? 'beta' : null;
      return Promise.resolve(respond(200, owner ? [{ owner: { login: owner } }, { owner: { login: owner } }] : []));
    }
    return Promise.resolve(respond(404, { message: 'Not Found' }));
  });
}

const tokenOf = (c: unknown[]): string => ((c[1] as RequestInit).headers as Record<string, string>).Authorization.replace(/^Bearer /, '');

/** Tokens used for each call, in order (only calls whose path matches). */
const usedTokens = (pathPart: string): string[] => fetchMock.mock.calls.filter((c) => String(c[0]).includes(pathPart)).map(tokenOf);

/** Tokens used for GraphQL calls whose document contains `part`. */
const usedTokensForQuery = (part: string): string[] =>
  fetchMock.mock.calls.filter((c) => String((c[1] as RequestInit).body ?? '').includes(part)).map(tokenOf);

function send<T = AuthStatus>(router: Mods['router'], msg: unknown, sender: chrome.runtime.MessageSender = ext): Promise<T> {
  return new Promise((resolve) => router.onMessage(msg, sender, (res) => resolve(res as T)));
}

const add = (m: Mods, token: string) => send(m.router, { type: 'auth:setToken', token });

/** Let fire-and-forget work (inbox refresh after an add, token checks) settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  (globalThis as unknown as { __resetChromeStorage: () => void }).__resetChromeStorage();
  fetchMock.mockReset();
  (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
});

// --- pure ------------------------------------------------------------------------

describe('token model', () => {
  const tok = (id: string, owners: string[] | null, extra: Partial<StoredToken> = {}): StoredToken => ({
    ...initialMeta(`ghp_${id.padEnd(36, 'x')}`, '2026-11-01T00:00:00Z'),
    id,
    token: id,
    owners,
    ...extra,
  });

  test('routing order: covering fine-grained → classic/unknown → other fine-grained; invalid skipped', () => {
    const list = [tok('fgA', ['acme']), tok('classic', null), tok('fgB', ['beta']), tok('dead', null, { problem: 'invalid' }), tok('sso', null, { problem: 'sso' })];
    expect(candidates(list, 'beta').map((t) => t.id)).toEqual(['fgB', 'classic', 'sso', 'fgA']);
    expect(candidates(list, 'acme').map((t) => t.id)).toEqual(['fgA', 'classic', 'sso', 'fgB']);
    expect(candidates(list, 'zed').map((t) => t.id)).toEqual(['classic', 'sso', 'fgA', 'fgB']);
    // No owner → primary (first usable) only.
    expect(candidates(list, null).map((t) => t.id)).toEqual(['fgA']);
    expect(candidates([tok('dead', null, { problem: 'invalid' })], 'acme')).toEqual([]);
  });

  test('kinds by prefix; OAuth tokens are not limited to one owner', () => {
    expect(tokenKindOf(FG_ACME)).toBe('fine-grained');
    expect(tokenKindOf(CLASSIC)).toBe('classic');
    expect(tokenKindOf(`gho_${'x'.repeat(36)}`)).toBe('classic');
    expect(tokenKindOf(`ghu_${'x'.repeat(36)}`)).toBe('classic');
    expect(tokenKindOf(`ghs_${'x'.repeat(36)}`)).toBe('unknown');
    expect(initialMeta(FG_ACME, 'now')).toMatchObject({ kind: 'fine-grained', owners: [], hint: 'acme' });
    expect(initialMeta(`ghs_${'x'.repeat(36)}`, 'now').owners).toBeNull();
  });

  test.each([
    ['2026-12-31 23:59:59 UTC', '2026-12-31T23:59:59.000Z'],
    ['2026-12-31 23:59:59 utc', '2026-12-31T23:59:59.000Z'],
    ['2026-12-31 23:59:59 +0100', '2026-12-31T22:59:59.000Z'],
    ['2026-12-31 23:59:59 -07:00', '2027-01-01T06:59:59.000Z'],
    ['2026-12-31 23:59', '2026-12-31T23:59:00.000Z'],
    ['2026-12-31T23:59:59Z', '2026-12-31T23:59:59.000Z'],
    ['  2026-06-01 08:00:00 UTC ', '2026-06-01T08:00:00.000Z'],
  ])('parses the expiration header %p', (header, iso) => {
    expect(parseTokenExpiration(header)).toBe(iso);
  });

  test.each([[null], [undefined], [''], ['never'], ['2026-13-45 99:99:99 UTC xyz']])('no expiration for %p', (header) => {
    expect(parseTokenExpiration(header)).toBeNull();
  });

  test('owners: REST paths, hints, /user/repos discovery', () => {
    expect(ownerFromPath('/repos/Acme/x/pulls/1')).toBe('acme');
    expect(ownerFromPath('/repos/acme')).toBeNull();
    expect(ownerFromPath('/user')).toBeNull();
    expect(normalizeOwner(' Beta-Org ')).toBe('beta-org');
    expect(normalizeOwner('../x')).toBeNull();
    expect(normalizeOwner(42)).toBeNull();
    expect(ownersFromRepos([{ owner: { login: 'Acme' } }, { owner: { login: 'acme' } }, null, {}])).toEqual(['acme']);
    expect(ownersFromRepos({ message: 'x' })).toEqual([]);
  });

  test('SSO header', () => {
    const h = (v: string | null) => ({ get: (n: string) => (n === 'x-github-sso' ? v : null) });
    expect(parseSsoHeader(h(`required; url=${SSO_URL}`))).toBe(SSO_URL);
    expect(parseSsoHeader(h('partial-results; organizations=1,2'))).toBeNull();
    expect(parseSsoHeader(h('required; url=https://evil.example/x'))).toBeNull();
    expect(parseSsoHeader(h(null))).toBeNull();
  });

  test('access failures', () => {
    expect(isAccessFailure({ ok: false, status: 404 }, 'rest', 'acme')).toBe(true);
    expect(isAccessFailure({ ok: false, status: 403 }, 'rest', 'acme')).toBe(true);
    expect(isAccessFailure({ ok: false, status: 403, rateLimited: true }, 'rest', 'acme')).toBe(false);
    expect(isAccessFailure({ ok: false, status: 500 }, 'rest', 'acme')).toBe(false);
    expect(isAccessFailure({ ok: false, status: 200, errorTypes: ['NOT_FOUND'] }, 'graphql', null)).toBe(true);
    expect(isAccessFailure({ ok: false, status: 200, errorTypes: ['FORBIDDEN'] }, 'graphql', null)).toBe(true);
    const nulls = { ok: false, status: 200, errorTypes: ['UNKNOWN'], data: { pr0: null, pr1: { pullRequest: null } } };
    expect(isAccessFailure(nulls, 'graphql', 'acme')).toBe(true);
    expect(isAccessFailure(nulls, 'graphql', null)).toBe(false);
    expect(isAccessFailure({ ...nulls, data: { pr0: { pullRequest: { id: 1 } }, pr1: null } }, 'graphql', 'acme')).toBe(false);
    expect(isAccessFailure({ ok: false, status: 200, errorTypes: ['MAX_NODE_LIMIT_EXCEEDED'] }, 'graphql', 'acme')).toBe(false);
  });

  test('cache keys are per token', () => {
    expect(cacheKey('graphql', 'q', { a: 1 }, 't1')).not.toBe(cacheKey('graphql', 'q', { a: 1 }, 't2'));
    expect(cacheKey('rest', '/repos/o/r', undefined, 't1')).toBe(cacheKey('rest', '/repos/o/r', undefined, 't1'));
  });

  test('mergeInboxItems unites reasons and keeps the newest entry', () => {
    const item = (url: string, updatedAt: string, reasons: InboxItem['reasons'], title = 't'): InboxItem => ({
      url, repo: 'o/r', number: 1, title, author: 'a', authorAvatarUrl: null, isDraft: false, updatedAt, reasons,
      reviewDecision: null, checks: null, unresolvedThreads: 0, additions: 0, deletions: 0, hasConflicts: false, unseen: false,
    });
    const merged = mergeInboxItems([
      [item('https://github.com/Pub/lib/pull/1', '2026-11-20T00:00:00Z', ['review-requested'], 'old'), item('https://github.com/acme/x/pull/2', '2026-11-19T00:00:00Z', ['authored'])],
      [item('https://github.com/pub/lib/pull/1', '2026-11-21T00:00:00Z', ['assigned'], 'new')],
    ]);
    expect(merged.map((i) => [i.url, i.title, i.reasons])).toEqual([
      ['https://github.com/pub/lib/pull/1', 'new', ['review-requested', 'assigned']],
      ['https://github.com/acme/x/pull/2', 't', ['authored']],
    ]);
  });

  test('options hash accepts add-token/<owner>', () => {
    expect(sectionHash('add-token/Acme-Inc')).toBe('#add-token/Acme-Inc');
    expect(sectionHash('account')).toBe('#account');
    expect(sectionHash('add-token/../x')).toBe('');
    expect(sectionHash('add-token/a/b')).toBe('');
    expect(sectionHash('javascript:alert(1)')).toBe('');
  });
});

// --- adding / removing --------------------------------------------------------------

describe('auth:setToken adds tokens of one account', () => {
  test('discovers kind, owners and expiry; rejects duplicates and other accounts', async () => {
    const m = load();
    github((path, token) =>
      path === '/user' && token === FG_ACME
        ? respond(200, { login: 'Me' }, { 'github-authentication-token-expiration': '2026-12-31 23:59:59 UTC' })
        : path === '/user' && token === STRANGER
          ? respond(200, { login: 'someone-else' })
          : undefined
    );
    const first = await add(m, FG_ACME);
    expect(first).toMatchObject({ authenticated: true, tokenKind: 'fine-grained', account: { login: 'Me' } });
    expect(first.tokens).toEqual([
      expect.objectContaining({ kind: 'fine-grained', hint: 'acme', owners: ['acme'], publicOnly: false, expiresAt: '2026-12-31T23:59:59.000Z', problem: null }),
    ]);

    const second = await add(m, CLASSIC);
    expect(second.tokens?.map((t) => [t.kind, t.owners])).toEqual([['fine-grained', ['acme']], ['classic', null]]);
    expect(second.tokenKind).toBe('fine-grained'); // primary = first added

    const calls = fetchMock.mock.calls.length;
    expect(await add(m, ` ${CLASSIC} `)).toMatchObject({ authenticated: true, error: 'duplicate' });
    expect(fetchMock.mock.calls.length).toBe(calls); // no request for a duplicate

    expect(await add(m, STRANGER)).toMatchObject({ authenticated: true, error: 'different-account' });
    expect((await m.tokens.listTokens()).map((t) => t.token)).toEqual([FG_ACME, CLASSIC]);
    // Never stored where content scripts can read it.
    expect(JSON.stringify(await chrome.storage.local.get(null))).not.toMatch(/github_pat_|ghp_/);
    await settle();
  });

  test('a fine-grained token without private repositories is public-only', async () => {
    const m = load();
    github((path) => (path.startsWith('/user/repos') ? respond(200, []) : undefined));
    expect((await add(m, FG_BETA)).tokens?.[0]).toMatchObject({ owners: [], publicOnly: true });
    await settle();
  });

  test('auth:removeToken removes one; removing the last one signs out', async () => {
    const m = load();
    github();
    await add(m, FG_ACME);
    const both = await add(m, FG_BETA);
    const [acme, beta] = both.tokens ?? [];
    await settle();

    expect(await send(m.router, { type: 'auth:removeToken', id: acme.id }, content)).toEqual({ authenticated: false, error: 'forbidden' });
    expect(await send(m.router, { type: 'auth:removeToken', id: 'nope' })).toMatchObject({ authenticated: true, error: 'unknown' });

    const one = await send(m.router, { type: 'auth:removeToken', id: acme.id });
    expect(one).toMatchObject({ authenticated: true, tokenKind: 'fine-grained' });
    expect(one.tokens?.map((t) => t.id)).toEqual([beta.id]);
    await settle();

    const badge = jest.spyOn(chrome.action, 'setBadgeText');
    const runtimeSend = jest.spyOn(chrome.runtime, 'sendMessage');
    expect(await send(m.router, { type: 'auth:removeToken', id: beta.id })).toEqual({ authenticated: false });
    expect(await chrome.storage.local.get(['githubUser', 'tokenMeta'])).toEqual({});
    expect(badge).toHaveBeenLastCalledWith({ text: '' });
    expect(runtimeSend).toHaveBeenLastCalledWith({ type: 'auth:changed', authenticated: false });
    badge.mockRestore();
    runtimeSend.mockRestore();
  });
});

describe('migration of the single secret', () => {
  test('becomes tokens[0]; owners and expiry are discovered on the next auth:status', async () => {
    const m = load();
    await m.secrets.setSecret('githubToken', FG_ACME);
    await chrome.storage.local.set({ githubUser: { login: 'me' } });
    github((path) => (path === '/user' ? respond(200, { login: 'me' }, { 'github-authentication-token-expiration': '2027-01-31 10:00:00 UTC' }) : undefined));
    const status = await send(m.router, { type: 'auth:status' });
    expect(status).toMatchObject({ authenticated: true, tokenKind: 'fine-grained' });
    expect(status.tokens).toEqual([expect.objectContaining({ owners: ['acme'], expiresAt: '2027-01-31T10:00:00.000Z' })]);
    expect((await m.tokens.listTokens())[0].pending).toBeUndefined();
    // Discovery ran once: the next status makes no request.
    const calls = fetchMock.mock.calls.length;
    await send(m.router, { type: 'auth:status' });
    expect(fetchMock.mock.calls.length).toBe(calls);
  });
});

// --- routing --------------------------------------------------------------------

describe('routing and fallback', () => {
  test('a covering token is used first; uncovered owners try classic, then the other fine-grained tokens', async () => {
    const m = load();
    github((path, token) => (path === '/repos/beta/y' && token === FG_BETA ? respond(200, { name: 'y' }) : undefined));
    await add(m, FG_ACME);
    await add(m, CLASSIC);
    await add(m, FG_BETA);
    await settle();

    expect(await m.api.handleRest({ path: '/repos/beta/y', noCache: true })).toMatchObject({ ok: true });
    expect(usedTokens('/repos/beta/y')).toEqual([FG_BETA]);

    const res = await m.api.handleRest({ path: '/repos/zed/z', noCache: true });
    expect(usedTokens('/repos/zed/z')).toEqual([CLASSIC, FG_ACME, FG_BETA]);
    expect(res).toMatchObject({ ok: false, status: 404, needsToken: { owner: 'zed' } });
  });

  test('a token that succeeds after a fallback learns the owner (REST and GraphQL)', async () => {
    const m = load();
    github((path, token, body) => {
      if (path.startsWith('/user/repos')) return respond(200, token === FG_ACME ? [{ owner: { login: 'acme' } }] : []); // beta: pending org approval
      if (path === '/repos/beta/y/pulls') return token === FG_BETA ? respond(200, []) : respond(404, { message: 'Not Found' });
      if (path === '/graphql' && body?.query?.includes('repository(owner: "gamma"')) {
        return token === FG_BETA
          ? respond(200, { data: { pr0: { name: 'g' } } }, { 'x-ratelimit-resource': 'graphql' })
          : respond(200, { data: { pr0: null }, errors: [{ type: 'NOT_FOUND', message: 'Could not resolve to a Repository' }] }, { 'x-ratelimit-resource': 'graphql' });
      }
      return undefined;
    });
    await add(m, FG_ACME);
    await add(m, FG_BETA); // public-only so far
    await settle();

    expect(await m.api.handleRest({ path: '/repos/beta/y/pulls', noCache: true })).toMatchObject({ ok: true });
    expect(usedTokens('/repos/beta/y/pulls')).toEqual([FG_ACME, FG_BETA]);
    const beta = (await m.tokens.listTokens()).find((t) => t.token === FG_BETA);
    expect(beta).toMatchObject({ owners: ['beta'], publicOnly: false });
    // Next time the learned token goes first.
    await m.api.handleRest({ path: '/repos/beta/y/pulls', noCache: true });
    expect(usedTokens('/repos/beta/y/pulls')).toEqual([FG_ACME, FG_BETA, FG_BETA]);

    const query = 'query { pr0: repository(owner: "gamma", name: "g") { name } }';
    expect(await m.api.handleGraphQL({ query, owner: 'Gamma', noCache: true })).toMatchObject({ ok: true, data: { pr0: { name: 'g' } } });
    expect(usedTokensForQuery('gamma')).toEqual([FG_ACME, FG_BETA]);
    expect((await m.tokens.listTokens()).find((t) => t.token === FG_BETA)?.owners).toEqual(['beta', 'gamma']);
  });

  test('no fallback without an owner: the primary token answers, no needsToken', async () => {
    const m = load();
    github();
    await add(m, FG_ACME);
    await add(m, FG_BETA);
    await settle();
    const res = await m.api.handleRest({ path: '/search/issues?q=x', noCache: true });
    expect(usedTokens('/search/issues')).toEqual([FG_ACME]);
    expect(res.needsToken).toBeUndefined();
  });

  test('SSO: the token is flagged, the URL is returned, other candidates are tried', async () => {
    const m = load();
    let ssoAuthorized = false;
    github((path, token) => {
      if (path !== '/repos/acme/x') return undefined;
      if (token === CLASSIC && !ssoAuthorized) return respond(403, { message: 'Resource protected by organization SAML enforcement.' }, { 'x-github-sso': `required; url=${SSO_URL}` });
      return token === CLASSIC ? respond(200, { name: 'x' }) : undefined; // FG_BETA: 404
    });
    await add(m, CLASSIC);
    await add(m, FG_BETA);
    await settle();

    const res = await m.api.handleRest({ path: '/repos/acme/x', noCache: true });
    expect(usedTokens('/repos/acme/x')).toEqual([CLASSIC, FG_BETA]);
    expect(res).toMatchObject({ ok: false, ssoUrl: SSO_URL, needsToken: { owner: 'acme' } });
    let status = await send(m.router, { type: 'auth:status' });
    expect(status.authenticated).toBe(true);
    expect(status.tokens?.[0]).toMatchObject({ kind: 'classic', problem: 'sso', ssoUrl: SSO_URL });

    // The user authorized SSO: the next success for that owner clears the flag.
    ssoAuthorized = true;
    expect(await m.api.handleRest({ path: '/repos/acme/x', noCache: true })).toMatchObject({ ok: true });
    status = await send(m.router, { type: 'auth:status' });
    expect(status.tokens?.[0]).toMatchObject({ problem: null, ssoUrl: null });
  });

  test('a revoked token is marked invalid, the others keep working; the last one signs out', async () => {
    const m = load();
    const revoked = new Set<string>();
    github((path, token) => {
      if (revoked.has(token)) return respond(401, { message: 'Bad credentials' });
      return path === '/repos/acme/x' && token === FG_ACME ? respond(200, { name: 'x' }) : undefined;
    });
    await add(m, CLASSIC);
    await add(m, FG_ACME);
    await settle();

    revoked.add(CLASSIC);
    expect(await m.api.handleRest({ path: '/repos/zed/z', noCache: true })).toMatchObject({ ok: false });
    await settle(); // the 401 triggers a GET /user check for that token
    let status = await send(m.router, { type: 'auth:status' });
    expect(status).toMatchObject({ authenticated: true, tokenKind: 'classic' });
    expect(status.tokens?.map((t) => t.problem)).toEqual(['invalid', null]);
    // Invalid tokens are skipped.
    await m.api.handleRest({ path: '/repos/acme/x', noCache: true });
    expect(usedTokens('/repos/acme/x')).toEqual([FG_ACME]);

    revoked.add(FG_ACME);
    await m.authCheck.validateStoredTokens(); // 'auth:validate' alarm
    status = await send(m.router, { type: 'auth:status' });
    expect(status).toEqual({ authenticated: false });
    expect(await m.tokens.listTokens()).toEqual([]);
  });

  test('validation refreshes expiry and treats another login on the primary token as invalid', async () => {
    const m = load();
    let login = 'me';
    github((path, token) =>
      path === '/user' ? respond(200, { login: token === CLASSIC ? login : 'me' }, { 'github-authentication-token-expiration': '2027-03-01 00:00:00 UTC' }) : undefined
    );
    await add(m, CLASSIC);
    await add(m, FG_ACME);
    await settle();
    await m.authCheck.validateStoredTokens();
    expect((await m.tokens.listTokens()).map((t) => t.expiresAt)).toEqual(['2027-03-01T00:00:00.000Z', '2027-03-01T00:00:00.000Z']);

    login = 'renamed';
    await m.authCheck.validateStoredTokens();
    expect((await m.tokens.listTokens()).map((t) => t.problem)).toEqual(['invalid', null]);
    expect((await send(m.router, { type: 'auth:status' })).authenticated).toBe(true);
  });

  test('cached responses are only served for the token that produced them', async () => {
    const m = load();
    github((path, token) => (path === '/graphql' ? respond(200, { data: { who: token === FG_ACME ? 'acme-view' : 'beta-view' } }, { 'x-ratelimit-resource': 'graphql' }) : undefined));
    const first = await add(m, FG_ACME);
    await add(m, FG_BETA);
    await settle();
    const query = 'query { viewer { login } }';
    expect(await m.api.handleGraphQL({ query, owner: 'acme' })).toMatchObject({ data: { who: 'acme-view' } });
    expect(await m.api.handleGraphQL({ query, owner: 'acme' })).toMatchObject({ data: { who: 'acme-view' } });
    expect(usedTokensForQuery('viewer { login }')).toEqual([FG_ACME]); // second answer came from the cache

    await send(m.router, { type: 'auth:removeToken', id: first.tokens?.[0].id });
    await settle();
    expect(await m.api.handleGraphQL({ query, owner: 'acme' })).toMatchObject({ data: { who: 'beta-view' } });
  });
});

// --- inbox --------------------------------------------------------------------------

describe('inbox across tokens', () => {
  const pr = (url: string, updatedAt: string, title = 'PR') => ({ url, number: Number(url.split('/').pop()), title, updatedAt, author: { login: 'me' } });
  const inboxData = (authored: unknown[], reviewRequested: unknown[] = []) => ({
    data: { viewer: { login: 'me' }, authored: { nodes: authored }, reviewRequested: { nodes: reviewRequested }, assigned: { nodes: [] } },
  });

  test('one query per fine-grained token, merged by url; partial failures keep the rest', async () => {
    const m = load();
    let betaDown = false;
    github((path, token, body) => {
      if (path !== '/graphql' || !body?.query?.includes('BghubInbox')) return undefined;
      const h = { 'x-ratelimit-resource': 'graphql' };
      if (token === FG_ACME) {
        return respond(200, inboxData([pr('https://github.com/acme/x/pull/1', '2026-11-20T00:00:00Z'), pr('https://github.com/Pub/lib/pull/9', '2026-11-18T00:00:00Z', 'old title')]), h);
      }
      if (betaDown) return respond(502, { message: 'Bad gateway' });
      return respond(200, inboxData([pr('https://github.com/beta/y/pull/2', '2026-11-21T00:00:00Z')], [pr('https://github.com/pub/lib/pull/9', '2026-11-22T00:00:00Z', 'new title')]), h);
    });
    await add(m, FG_ACME);
    await add(m, FG_BETA);
    await settle();

    const inbox = await m.inbox.getInbox(true);
    expect(inbox.error).toBeUndefined();
    expect(inbox.items.map((i) => [i.url, i.reasons])).toEqual([
      ['https://github.com/pub/lib/pull/9', ['authored', 'review-requested']],
      ['https://github.com/beta/y/pull/2', ['authored']],
      ['https://github.com/acme/x/pull/1', ['authored']],
    ]);
    expect(inbox.items[0].title).toBe('new title');

    betaDown = true;
    const partial = await m.inbox.getInbox(true);
    expect(partial.error).toBeUndefined();
    expect(partial.items.map((i) => i.url)).toEqual(['https://github.com/acme/x/pull/1', 'https://github.com/Pub/lib/pull/9']);
  });

  test('a classic token runs the inbox query once for everything', async () => {
    const m = load();
    github((path, _token, body) =>
      path === '/graphql' && body?.query?.includes('BghubInbox') ? respond(200, inboxData([pr('https://github.com/acme/x/pull/1', '2026-11-20T00:00:00Z')]), { 'x-ratelimit-resource': 'graphql' }) : undefined
    );
    await add(m, FG_ACME);
    await add(m, CLASSIC);
    await settle();
    fetchMock.mockClear();
    await m.inbox.getInbox(true);
    expect(usedTokens('/graphql')).toEqual([CLASSIC]);
  });

  test('every token failing reports the error and keeps the last good items', async () => {
    const m = load();
    github((path) => (path === '/graphql' ? respond(503, { message: 'unavailable' }) : undefined));
    await add(m, FG_ACME);
    await add(m, FG_BETA);
    await settle();
    expect(await m.inbox.getInbox(true)).toMatchObject({ error: 'network', items: [] });
  });
});
