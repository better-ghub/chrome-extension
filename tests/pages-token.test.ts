import { parseRoute } from '../src/pages/route';
import { checkTokenFormat, classifyAuthError, ERROR_TIMEOUT, ERROR_UNAVAILABLE, tokenKindOf } from '../src/pages/token';

const FINE = `github_pat_${'A1b2C3d4E5'.repeat(8)}x`;
const CLASSIC = `ghp_${'a1B2c3D4e5F6'.repeat(3)}`; // 40 chars

describe('checkTokenFormat', () => {
  test('accepts fine-grained and classic personal access tokens', () => {
    expect(checkTokenFormat(FINE)).toEqual({ token: FINE, issue: null });
    expect(CLASSIC).toHaveLength(40);
    expect(checkTokenFormat(CLASSIC)).toEqual({ token: CLASSIC, issue: null });
  });

  test('trims whitespace and surrounding quotes from pasted values', () => {
    expect(checkTokenFormat(`  ${FINE}\n`).token).toBe(FINE);
    expect(checkTokenFormat(`"${FINE}"`)).toEqual({ token: FINE, issue: null });
    expect(checkTokenFormat(`'${CLASSIC}'`).issue).toBeNull();
  });

  test.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['""', 'empty'],
    [`${FINE.slice(0, 30)} ${FINE.slice(30)}`, 'whitespace'],
    [`gho_${'a'.repeat(36)}`, 'not-pat'],
    [`ghs_${'a'.repeat(36)}`, 'not-pat'],
    ['sk-live-abcdef', 'prefix'],
    [`token ${CLASSIC}`, 'whitespace'],
    [`ghp_${'a'.repeat(30)}-${'b'.repeat(6)}`, 'characters'],
    ['ghp_short', 'length'],
    ['github_pat_tooShort', 'length'],
  ])('%j → %s', (raw, issue) => {
    expect(checkTokenFormat(raw).issue).toBe(issue);
  });
});

describe('tokenKindOf', () => {
  test('detects the kind from the prefix', () => {
    expect(tokenKindOf(FINE)).toBe('fine-grained');
    expect(tokenKindOf(CLASSIC)).toBe('classic');
    expect(tokenKindOf('xyz')).toBe('unknown');
  });
});

describe('classifyAuthError', () => {
  test.each([
    [undefined, 'unknown'],
    ['', 'unknown'],
    [ERROR_UNAVAILABLE, 'unavailable'],
    [ERROR_TIMEOUT, 'network'],
    ['Invalid token', 'invalid'],
    ['HTTP 401: Bad credentials', 'invalid'],
    ['Token expired', 'invalid'],
    ['Network error: Failed to fetch', 'network'],
    ['GitHub returned 502', 'network'],
    ['Request timed out', 'network'],
    ['API rate limit exceeded', 'rate-limited'],
    ['HTTP 429', 'rate-limited'],
    ['403 Forbidden: SAML enforcement', 'permissions'],
    ['Something odd happened', 'unknown'],
  ])('%j → %s', (error, kind) => {
    expect(classifyAuthError(error)).toBe(kind);
  });
});

describe('parseRoute', () => {
  test.each([
    ['', 'account', false],
    ['#', 'account', false],
    ['#account', 'account', false],
    ['#welcome', 'account', true],
    ['#shortcuts', 'shortcuts', false],
    ['#/shortcuts', 'shortcuts', false],
    ['#SHORTCUTS', 'shortcuts', false],
    ['#pr-list', 'pr-list', false],
    ['#dashboard', 'dashboard', false],
    ['#notifications', 'notifications', false],
    ['#language', 'language', false],
    ['#about', 'about', false],
    ['#auth', 'account', false],
    ['#keyboard', 'shortcuts', false],
    ['#cache', 'language', false],
    ['#nope', 'account', false],
    ['#%E0%A4%A', 'account', false],
  ])('%s → %s (welcome: %s)', (hash, section, welcome) => {
    expect(parseRoute(hash)).toEqual({ section, welcome });
  });
});
