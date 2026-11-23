import { blockedUntil, isRateLimitResponse, parseRateLimit, predictResource, RateLimitTracker } from '../src/background/rate-limit';
import { hashString, isMutation, isReadOnlyQuery, isTokenFormatValid, parseJsonBody, stableStringify, stripGraphQL, tokenKindOf, validateRestPath } from '../src/background/request-utils';
import { cacheKey } from '../src/background/cache';

const headers = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });

describe('rate-limit classification', () => {
  test('403 "Resource not accessible by personal access token" is NOT a rate limit', () => {
    const h = headers({ 'x-ratelimit-remaining': '4321', 'x-ratelimit-resource': 'core' });
    expect(isRateLimitResponse(403, h, 'Resource not accessible by personal access token')).toBe(false);
  });

  test('403 SAML enforcement is NOT a rate limit', () => {
    expect(isRateLimitResponse(403, headers({}), 'Resource protected by organization SAML enforcement.')).toBe(false);
  });

  test('primary limit: remaining === "0"', () => {
    expect(isRateLimitResponse(403, headers({ 'x-ratelimit-remaining': '0' }), 'API rate limit exceeded')).toBe(true);
    expect(isRateLimitResponse(429, headers({ 'x-ratelimit-remaining': '0' }))).toBe(true);
  });

  test('secondary limit: retry-after or message', () => {
    expect(isRateLimitResponse(403, headers({ 'retry-after': '60' }))).toBe(true);
    expect(isRateLimitResponse(403, headers({}), 'You have exceeded a secondary rate limit')).toBe(true);
    expect(isRateLimitResponse(429, headers({}))).toBe(false);
  });

  test('other statuses are never rate limits', () => {
    expect(isRateLimitResponse(401, headers({ 'x-ratelimit-remaining': '0' }))).toBe(false);
    expect(isRateLimitResponse(500, headers({ 'retry-after': '1' }))).toBe(false);
  });

  test('blockedUntil prefers retry-after, then reset, then one minute', () => {
    const now = 1_000_000;
    expect(blockedUntil(headers({ 'retry-after': '30' }), now)).toBe(now + 30_000);
    expect(blockedUntil(headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '2000' }), now)).toBe(2_000_000);
    expect(blockedUntil(headers({}), now)).toBe(now + 60_000);
  });

  test('parseRateLimit + predictResource', () => {
    const h = headers({ 'x-ratelimit-remaining': '10', 'x-ratelimit-limit': '5000', 'x-ratelimit-reset': '99', 'x-ratelimit-resource': 'graphql' });
    expect(parseRateLimit(h)).toEqual({ remaining: 10, limit: 5000, reset: 99, resource: 'graphql' });
    expect(predictResource('graphql')).toBe('graphql');
    expect(predictResource('rest', '/search/issues?q=x')).toBe('search');
    expect(predictResource('rest', '/search/code?q=x')).toBe('code_search');
    expect(predictResource('rest', '/repos/o/r')).toBe('core');
  });
});

describe('RateLimitTracker', () => {
  test('budgets are per resource', () => {
    const t = new RateLimitTracker();
    t.record('search', { remaining: 0, limit: 30, reset: 2000 }, 1_000_000);
    expect(t.blockedUntil('search', 1_000_000)).toBe(2_000_000);
    expect(t.blockedUntil('core', 1_000_000)).toBe(0);
    expect(t.blockedUntil('graphql', 1_000_000)).toBe(0);
  });

  test('blocks expire', () => {
    const t = new RateLimitTracker();
    t.block('core', 5_000);
    expect(t.blockedUntil('core', 4_999)).toBe(5_000);
    expect(t.blockedUntil('core', 5_000)).toBe(0);
  });

  test('round-trips through JSON (survives SW restarts)', () => {
    const t = new RateLimitTracker();
    t.record('core', { remaining: 3, limit: 5000, reset: 10 }, 0);
    t.block('graphql', 9_000);
    const restored = new RateLimitTracker();
    restored.load(JSON.parse(JSON.stringify(t.toJSON())), 1_000);
    expect(restored.snapshot('core')).toEqual({ remaining: 3, limit: 5000, reset: 10 });
    expect(restored.blockedUntil('graphql', 1_000)).toBe(9_000);
    const later = new RateLimitTracker();
    later.load(t.toJSON(), 10_000);
    expect(later.blockedUntil('graphql', 10_000)).toBe(0);
  });

  test('clear() forgets budgets and blocks', () => {
    const t = new RateLimitTracker();
    t.record('core', { remaining: 0, limit: 5000, reset: 9_999 }, 0);
    t.clear();
    expect(t.snapshot('core')).toBeUndefined();
    expect(t.blockedUntil('core', 1)).toBe(0);
  });
});

describe('validateRestPath', () => {
  test.each([
    ['/user', '/user'],
    ['/repos/o/r/pulls?per_page=5', '/repos/o/r/pulls?per_page=5'],
    ['/repos/o/r/../../user', '/repos/user'],
  ])('accepts %s', (input, out) => {
    expect(validateRestPath(input)).toBe(out);
  });

  test.each([
    ['https://evil.example/user'],
    ['//evil.example/user'],
    ['/\\evil.example/user'],
    ['user'],
    [''],
    ['/a b'],
    [42],
    [null],
  ])('rejects %p', (input) => {
    expect(validateRestPath(input)).toBeNull();
  });
});

describe('request utils', () => {
  test('isMutation', () => {
    expect(isMutation('mutation { addStar(input: {}) { clientMutationId } }')).toBe(true);
    expect(isMutation('  # comment\n mutation Foo { x }')).toBe(true);
    expect(isMutation('query { viewer { login } }')).toBe(false);
    expect(isMutation('query { repository { mutationCount } }')).toBe(false);
    // A "#" inside a string must not hide the rest of the line.
    expect(isMutation('query { a(x: "#") } mutation { b }')).toBe(true);
    expect(isMutation('query { a(x: "unterminated) }')).toBe(true);
  });

  test('token formats and kinds', () => {
    expect(isTokenFormatValid(`github_pat_${'A1_'.repeat(20)}`)).toBe(true);
    expect(isTokenFormatValid(`ghp_${'a'.repeat(36)}`)).toBe(true);
    expect(isTokenFormatValid(`gho_${'a'.repeat(36)}`)).toBe(true);
    expect(isTokenFormatValid('a'.repeat(40).replace(/a/g, 'f'))).toBe(true);
    expect(isTokenFormatValid('ghp_short')).toBe(false);
    expect(isTokenFormatValid('hello world token')).toBe(false);
    expect(tokenKindOf('github_pat_x')).toBe('fine-grained');
    expect(tokenKindOf('ghp_x')).toBe('classic');
    expect(tokenKindOf('ghs_x')).toBe('unknown');
  });

  test('parseJsonBody tolerates 204 and HTML bodies', () => {
    expect(parseJsonBody('')).toBeUndefined();
    expect(parseJsonBody('<!DOCTYPE html><html>')).toBeUndefined();
    expect(parseJsonBody('{"truncated":')).toBeUndefined();
    expect(parseJsonBody(' {"a":1}')).toEqual({ a: 1 });
  });

  test('cache keys are stable across variable key order and distinct otherwise', () => {
    expect(stableStringify({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe('{"a":[1,{"c":3,"d":2}],"b":1}');
    expect(cacheKey('graphql', 'q', { a: 1, b: 2 })).toBe(cacheKey('graphql', 'q', { b: 2, a: 1 }));
    expect(cacheKey('graphql', 'q', { a: 1 })).not.toBe(cacheKey('graphql', 'q', { a: 2 }));
    expect(cacheKey('rest', '/user')).not.toBe(cacheKey('graphql', '/user'));
    expect(hashString('abc')).toBe(hashString('abc'));
  });
});

describe('isReadOnlyQuery (GraphQL from content scripts)', () => {
  test.each([
    ['query { viewer { login } }'],
    ['query BghubPRList($o0: String!) { pr0: repository(owner: $o0, name: "r") { id } }'],
    ['  \n\tquery{viewer{login}}'],
    [',,query { viewer { login } }'],
    ['\uFEFFquery { viewer { login } }'],
    ['# leading comment\nquery { viewer { login } }'],
    ['query { a(x: "mutation { addStar }") } # mutation in a comment'],
    ['query { a(x: """subscription\n mutation""") }'],
    ['query { repository { viewerSubscription mutationCount } }'],
  ])('accepts %p', (q) => {
    expect(isReadOnlyQuery(q)).toBe(true);
  });

  test.each([
    ['mutation { addStar(input: {starrableId: "x"}) { clientMutationId } }'],
    [',mutation{addStar(input:{starrableId:"x"}){clientMutationId}}'],
    ['  mutation M { x }'],
    ['MUTATION { x }'],
    ['Mutation { x }'],
    ['subscription { x }'],
    ['query { a } mutation { b }'],
    ['query A { a }\nmutation B { b }'],
    ['query { a },mutation{ b }'],
    ['query { a }\n# comment\nmutation { b }'],
    ['# comment\nmutation { b }'],
    ['query { a(x: "#") } mutation { b }'],
    ['query { a(x: "\\"") } mutation { b }'],
    ['query { a(x: """\\""" #""") } mutation { b }'],
    ['query { a(x: "unterminated) } mutation { b }'],
    ['query { a(x: "line\nbreak") }'],
    ['{ viewer { login } }'],
    ['queryX { a }'],
    ['fragment F on User { login } query { viewer { ...F } }'],
    [''],
    [42],
    [undefined],
  ])('rejects %p', (q) => {
    expect(isReadOnlyQuery(q)).toBe(false);
  });

  test('stripGraphQL removes comments and strings in one pass', () => {
    expect(stripGraphQL('query { a(x: "# not a comment") } # comment\nmutation')).toBe('query { a(x:  ) }  \nmutation');
    expect(stripGraphQL('"open')).toBeNull();
    expect(stripGraphQL('"""open')).toBeNull();
  });
});
