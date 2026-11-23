import * as fs from 'fs';
import * as path from 'path';
import { reloadI18n } from '../src/i18n';
import { authErrorMessage } from '../src/pages/auth-view';
import { normalizeAuthStatus, normalizeTokenSummary } from '../src/pages/bg';
import { timeUntil } from '../src/pages/format';
import { addTokenHash, parseRoute } from '../src/pages/route';
import {
  coverageText,
  differentAccountLogin,
  expiryInfo,
  normalizeOwner,
  TOKEN_NAME_MAX,
  tokenName,
  tokenNeedsAttention,
  tokenPrefillUrl,
  tokensSummary,
} from '../src/pages/tokens';

const NOW = Date.parse('2026-11-22T12:00:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const iso = (ms: number): string => new Date(ms).toISOString();

describe('coverage text', () => {
  test('fine-grained with private owners lists them', () => {
    expect(coverageText({ owners: ['acme', 'octo-org'], publicOnly: false })).toBe('Private repos: acme, octo-org');
  });

  test('public-only (or nothing discovered) hints at a pending approval', () => {
    expect(coverageText({ owners: [], publicOnly: true })).toBe('Public repositories only — pending organization approval?');
    expect(coverageText({ owners: [], publicOnly: false })).toBe('Public repositories only — pending organization approval?');
  });

  test('classic / OAuth tokens (owners: null) cover every organization', () => {
    expect(coverageText({ owners: null, publicOnly: false })).toBe('All your organizations');
  });
});

describe('expiry', () => {
  test('no expiry date', () => {
    expect(expiryInfo(null, NOW, 'en')).toEqual({ text: 'No expiration', tone: 'muted', date: '' });
    expect(expiryInfo('not a date', NOW, 'en').text).toBe('No expiration');
  });

  test('far away is muted, within 7 days needs attention, past is danger', () => {
    expect(expiryInfo(iso(NOW + 12 * DAY), NOW, 'en')).toMatchObject({ text: 'Expires in 12 days', tone: 'muted' });
    expect(expiryInfo(iso(NOW + 7 * DAY), NOW, 'en')).toMatchObject({ text: 'Expires in 7 days', tone: 'attention' });
    expect(expiryInfo(iso(NOW + 5 * HOUR), NOW, 'en')).toMatchObject({ text: 'Expires in 5 hours', tone: 'attention' });
    expect(expiryInfo(iso(NOW - DAY), NOW, 'en')).toMatchObject({ text: 'Expired', tone: 'danger' });
    expect(expiryInfo(iso(NOW + 12 * DAY), NOW, 'en').date).toMatch(/2026/);
  });

  test('timeUntil picks a readable unit and is localized', () => {
    expect(timeUntil(NOW + 20 * 60_000, NOW, 'en')).toBe('in 20 minutes');
    expect(timeUntil(NOW + 30 * 1000, NOW, 'en')).toBe('in 1 minute');
    expect(timeUntil(NOW + DAY, NOW, 'en')).toBe('in 1 day');
    expect(timeUntil(NOW + 90 * DAY, NOW, 'en')).toBe('in 3 months');
    expect(timeUntil(NOW + 12 * DAY, NOW, 'pl')).toBe('za 12 dni');
    expect(timeUntil(NOW - DAY, NOW, 'en')).toBe('');
    expect(timeUntil(null, NOW, 'en')).toBe('');
  });

  test('attention: a problem, or an expiry within 7 days (or past)', () => {
    expect(tokenNeedsAttention({ problem: null, expiresAt: null }, NOW)).toBe(false);
    expect(tokenNeedsAttention({ problem: null, expiresAt: iso(NOW + 30 * DAY) }, NOW)).toBe(false);
    expect(tokenNeedsAttention({ problem: null, expiresAt: iso(NOW + 6 * DAY) }, NOW)).toBe(true);
    expect(tokenNeedsAttention({ problem: null, expiresAt: iso(NOW - DAY) }, NOW)).toBe(true);
    expect(tokenNeedsAttention({ problem: 'sso', expiresAt: null }, NOW)).toBe(true);
    expect(tokenNeedsAttention({ problem: 'invalid', expiresAt: null }, NOW)).toBe(true);
  });
});

describe('popup summary', () => {
  test('counts tokens and merges owners', () => {
    expect(
      tokensSummary(
        [
          { owners: ['acme'], publicOnly: false },
          { owners: ['octo-org', 'acme'], publicOnly: false },
        ],
        'en'
      )
    ).toBe('2 tokens · acme, octo-org');
  });

  test('a classic token covers all organizations', () => {
    expect(tokensSummary([{ owners: null, publicOnly: false }], 'en')).toBe('1 token · all organizations');
    expect(tokensSummary([{ owners: ['acme'], publicOnly: false }, { owners: null, publicOnly: false }], 'en')).toBe(
      '2 tokens · all organizations'
    );
  });

  test('public-only and long owner lists', () => {
    expect(tokensSummary([{ owners: [], publicOnly: true }], 'en')).toBe('1 token · public repositories only');
    expect(tokensSummary([{ owners: ['a', 'b', 'c', 'd', 'e'], publicOnly: false }], 'en')).toBe('1 token · a, b, c, +2');
  });
});

describe('prefill link', () => {
  const parse = (url: string): URL => new URL(url);

  test('organization: name, description, target, 90 days, read-only permissions — in order', () => {
    const url = tokenPrefillUrl('acme', 'Pull requests & more');
    expect(url.startsWith('https://github.com/settings/personal-access-tokens/new?')).toBe(true);
    const u = parse(url);
    expect([...u.searchParams.keys()]).toEqual([
      'name',
      'description',
      'target_name',
      'expires_in',
      'pull_requests',
      'contents',
      'metadata',
    ]);
    expect(u.searchParams.get('name')).toBe('Better GHub – acme');
    expect(u.searchParams.get('description')).toBe('Pull requests & more');
    expect(u.searchParams.get('target_name')).toBe('acme');
    expect(u.searchParams.get('expires_in')).toBe('90');
    expect(u.searchParams.get('pull_requests')).toBe('read');
    expect(u.searchParams.get('contents')).toBe('read');
    expect(u.searchParams.get('metadata')).toBe('read');
  });

  test('values are percent-encoded (spaces as %20, no raw & or –)', () => {
    const url = tokenPrefillUrl('acme', 'a & b');
    expect(url).toContain('name=Better%20GHub%20%E2%80%93%20acme');
    expect(url).toContain('description=a%20%26%20b');
    expect(url).not.toContain(' ');
  });

  test('empty or invalid organization: no target_name (GitHub defaults to the user)', () => {
    for (const org of ['', '   ', 'not a login!']) {
      const u = parse(tokenPrefillUrl(org, 'x'));
      expect(u.searchParams.has('target_name')).toBe(false);
      expect(u.searchParams.get('name')).toBe('Better GHub');
    }
  });

  test('the name never exceeds GitHub’s 40-character limit', () => {
    const long = 'a'.repeat(39);
    const name = tokenName(long);
    expect(Array.from(name)).toHaveLength(TOKEN_NAME_MAX);
    expect(name.endsWith('…')).toBe(true);
    expect(parse(tokenPrefillUrl(long, 'x')).searchParams.get('name')).toBe(name);
    expect(parse(tokenPrefillUrl(long, 'x')).searchParams.get('target_name')).toBe(long);
    expect(tokenName('a'.repeat(26))).toHaveLength(40);
    expect(tokenName('a'.repeat(26)).endsWith('…')).toBe(false);
  });

  test('normalizeOwner accepts logins, @logins and github.com URLs', () => {
    expect(normalizeOwner(' acme ')).toBe('acme');
    expect(normalizeOwner('@Octo-Org')).toBe('Octo-Org');
    expect(normalizeOwner('https://github.com/acme/repo')).toBe('acme');
    expect(normalizeOwner('github.com/orgs/acme')).toBe('acme');
    expect(normalizeOwner('')).toBe('');
    expect(normalizeOwner('-acme')).toBeNull();
    expect(normalizeOwner('a b')).toBeNull();
  });
});

describe('add-token route', () => {
  test.each([
    ['#add-token/acme', 'acme'],
    ['#add-token/Octo-Org', 'Octo-Org'],
    ['#/add-token/acme/', 'acme'],
    ['#add-token/%40acme', 'acme'],
    ['#ADD-TOKEN/acme', 'acme'],
    ['#add-token', ''],
    ['#add-token/', ''],
    ['#add-token/<script>', ''],
  ])('%s → Account with the form for %j', (hash, owner) => {
    expect(parseRoute(hash)).toEqual({ section: 'account', welcome: false, addTokenFor: owner });
  });

  test('other routes keep working and carry no add-token owner', () => {
    expect(parseRoute('#shortcuts')).toEqual({ section: 'shortcuts', welcome: false });
    expect(parseRoute('#welcome')).toEqual({ section: 'account', welcome: true });
    expect(parseRoute('#add-tokens')).toEqual({ section: 'account', welcome: false });
    expect('addTokenFor' in parseRoute('#account')).toBe(false);
  });

  test('addTokenHash round-trips through parseRoute', () => {
    expect(addTokenHash('acme')).toBe('add-token/acme');
    expect(addTokenHash('bad owner')).toBe('add-token');
    expect(parseRoute(`#${addTokenHash('acme')}`).addTokenFor).toBe('acme');
  });
});

describe('auth error messages', () => {
  test.each([
    ['duplicate', {}, 'This token is already added.'],
    ['different-account', { login: 'mona' }, 'This token belongs to a different GitHub account. Use a token created by @mona.'],
    ['different-account:octocat', { login: 'mona' }, 'This token belongs to @octocat, not @mona.'],
    ['different-account', {}, 'This token belongs to a different GitHub account.'],
    ['invalid', {}, 'GitHub didn’t accept this token. It may have expired or been revoked.'],
    ['network', {}, 'Couldn’t reach GitHub. Check your connection and try again.'],
    ['rate-limited', {}, 'GitHub’s rate limit was hit. Try again in a few minutes.'],
    ['forbidden', {}, 'GitHub refused access. Check the token’s permissions and organization (SSO) approval.'],
    ['format', {}, 'This doesn’t look like a GitHub token. It should start with github_pat_ or ghp_.'],
    ['unknown', {}, 'Couldn’t verify the token. Try again.'],
    [undefined, {}, 'Couldn’t verify the token. Try again.'],
    ['HTTP 401: Bad credentials', {}, 'GitHub didn’t accept this token. It may have expired or been revoked.'],
  ])('%s %j → %s', (error, ctx, message) => {
    expect(authErrorMessage(error, ctx)).toBe(message);
  });

  test('differentAccountLogin parses the optional login', () => {
    expect(differentAccountLogin('different-account')).toBe('');
    expect(differentAccountLogin('different-account:@octocat')).toBe('octocat');
    expect(differentAccountLogin('invalid')).toBeUndefined();
    expect(differentAccountLogin(undefined)).toBeUndefined();
  });

  describe('in Polish', () => {
    const runtime = chrome.runtime as unknown as { id?: string; sendMessage: unknown };
    const originalSend = runtime.sendMessage;

    beforeAll(async () => {
      const messages = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '_locales', 'pl', 'messages.json'), 'utf8'));
      runtime.id = 'test-extension';
      runtime.sendMessage = (msg: { type: string }) =>
        Promise.resolve(msg.type === 'i18n:load' ? { ok: true, messages } : undefined);
      await chrome.storage.local.set({ language: 'pl' });
      await reloadI18n();
    });

    afterAll(async () => {
      runtime.sendMessage = originalSend;
      delete runtime.id;
      await chrome.storage.local.remove('language');
      await reloadI18n();
    });

    test('messages, plurals and relative expiry', () => {
      expect(authErrorMessage('different-account:octocat', { login: 'mona' })).toBe('Ten token należy do @octocat, a nie do @mona.');
      expect(tokensSummary([{ owners: null, publicOnly: false }])).toBe('1 token · wszystkie organizacje');
      expect(tokensSummary([{ owners: ['a'], publicOnly: false }, { owners: ['b'], publicOnly: false }])).toBe('2 tokeny · a, b');
      expect(tokensSummary(Array.from({ length: 5 }, () => ({ owners: null, publicOnly: false })))).toBe(
        '5 tokenów · wszystkie organizacje'
      );
      expect(expiryInfo(iso(NOW + 12 * DAY), NOW).text).toBe('Wygasa za 12 dni');
      expect(coverageText({ owners: ['acme'], publicOnly: false })).toBe('Prywatne repozytoria: acme');
    });
  });
});

describe('token summaries from the background are normalized', () => {
  test('keeps valid fields and drops unsafe ones', () => {
    expect(
      normalizeTokenSummary({
        id: 't1',
        kind: 'fine-grained',
        hint: '…a1b2',
        owners: ['acme', 'acme', 'bad owner', 42],
        publicOnly: false,
        addedAt: '2026-11-01T00:00:00Z',
        expiresAt: 'soon',
        problem: 'sso',
        ssoUrl: 'javascript:alert(1)',
      })
    ).toEqual({
      id: 't1',
      kind: 'fine-grained',
      hint: 'a1b2',
      owners: ['acme'],
      publicOnly: false,
      addedAt: '2026-11-01T00:00:00Z',
      expiresAt: null,
      problem: 'sso',
      ssoUrl: null,
    });
    expect(normalizeTokenSummary({ kind: 'classic' })).toBeNull();
    expect(normalizeTokenSummary({ id: 'c', kind: 'classic' })?.owners).toBeNull();
    expect(normalizeTokenSummary({ id: 'x', kind: 'weird', problem: 'boom' })).toMatchObject({ kind: 'unknown', owners: [], problem: null });
    expect(normalizeTokenSummary({ id: 's', ssoUrl: 'https://github.com/orgs/acme/sso?x=1' })?.ssoUrl).toBe(
      'https://github.com/orgs/acme/sso?x=1'
    );
  });

  test('auth status carries a de-duplicated token list only when the background sends one', () => {
    const account = { login: 'mona', name: 'Mona', avatarUrl: 'https://avatars.githubusercontent.com/u/1', htmlUrl: 'https://github.com/mona' };
    const status = normalizeAuthStatus({ authenticated: true, account, tokens: [{ id: 'a' }, { id: 'a' }, null, { id: 'b' }] });
    expect(status.tokens?.map((x) => x.id)).toEqual(['a', 'b']);
    expect('tokens' in normalizeAuthStatus({ authenticated: true, account })).toBe(false);
    expect(normalizeAuthStatus({ authenticated: true, account, error: 'duplicate' }).error).toBe('duplicate');
  });
});
