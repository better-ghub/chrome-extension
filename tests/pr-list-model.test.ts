import { buildPRQuery, chunk, prKey, type PRRef } from '../src/features/pr-list/query';
import { analyzePR, lastActivity, reviewState, sizeBucket, summarize, unresolvedThreads, type RawPR } from '../src/features/pr-list/analyze';
import { isTestPath, suggestLabels } from '../src/features/pr-list/labels';

const ref = (owner: string, repo: string, number: number): PRRef => ({ owner, repo, number, key: prKey(owner, repo, number) });

describe('buildPRQuery', () => {
  test('one aliased repository/pullRequest selection per ref, with typed variables', () => {
    const { query, variables, aliases } = buildPRQuery([ref('o', 'r', 1), ref('acme', 'web', 42)], { withFiles: false });
    expect(aliases).toEqual(['pr0', 'pr1']);
    expect(variables).toEqual({ o0: 'o', r0: 'r', n0: 1, o1: 'acme', r1: 'web', n1: 42 });
    expect(query).toContain('query BghubPRList($o0: String!, $r0: String!, $n0: Int!, $o1: String!, $r1: String!, $n1: Int!)');
    expect(query).toContain('pr0: repository(owner: $o0, name: $r0) { pullRequest(number: $n0) { ...BghubRow } }');
    expect(query).toContain('pr1: repository(owner: $o1, name: $r1) { pullRequest(number: $n1) { ...BghubRow } }');
    expect(query).toContain('fragment BghubRow on PullRequest');
    expect(query).toContain('reviewThreads(first: 100)');
    expect(query).not.toContain('files(first: 100)');
  });

  test('never interpolates user data into the document', () => {
    const { query } = buildPRQuery([ref('evil") { x }', 'r', 1)], { withFiles: false });
    expect(query).not.toContain('evil');
  });

  test('files only when label suggestions are on', () => {
    expect(buildPRQuery([ref('o', 'r', 1)], { withFiles: true }).query).toContain('files(first: 100) { nodes { path } }');
  });

  test('chunk splits into groups of at most 10', () => {
    const items = Array.from({ length: 25 }, (_, i) => i);
    expect(chunk(items).map((c) => c.length)).toEqual([10, 10, 5]);
    expect(chunk([])).toEqual([]);
  });
});

describe('analyze', () => {
  test('size buckets', () => {
    expect([0, 9, 10, 99, 100, 499, 500, 999, 1000, 50_000].map(sizeBucket)).toEqual(['XS', 'XS', 'S', 'S', 'M', 'M', 'L', 'L', 'XL', 'XL']);
  });

  test('unresolved threads by author, counting outdated-but-unresolved too', () => {
    const pr: RawPR = {
      reviewThreads: {
        nodes: [
          { isResolved: false, isOutdated: false, comments: { nodes: [{ author: { login: 'alice' } }] } },
          { isResolved: false, isOutdated: true, comments: { nodes: [{ author: { login: 'alice' } }] } },
          { isResolved: true, isOutdated: false, comments: { nodes: [{ author: { login: 'bob' } }] } },
          { isResolved: false, isOutdated: false, comments: { nodes: [{ author: null }] } },
          { isResolved: false, isOutdated: false, comments: { nodes: [{ author: { login: 'bob' } }] } },
          null,
        ],
      },
    };
    expect(unresolvedThreads(pr)).toEqual({
      total: 4,
      outdated: 1,
      byAuthor: [
        { login: 'alice', count: 2, outdated: 1 },
        { login: 'bob', count: 1, outdated: 0 },
        { login: 'ghost', count: 1, outdated: 0 },
      ],
    });
  });

  test('last activity is the most recent of commit / comment / review (not always "commit")', () => {
    const pr: RawPR = {
      commits: { nodes: [{ commit: { committedDate: '2026-11-01T10:00:00Z', author: { name: 'Bob B', user: { login: 'bob' } } } }] },
      comments: { nodes: [{ author: { login: 'alice' }, createdAt: '2026-11-02T10:00:00Z' }] },
      reviews: { nodes: [{ author: { login: 'carol' }, submittedAt: '2026-11-01T12:00:00Z', state: 'APPROVED' }] },
    };
    expect(lastActivity(pr)).toEqual({ kind: 'comment', actor: 'alice', at: '2026-11-02T10:00:00Z' });

    pr.reviews = { nodes: [{ author: { login: 'carol' }, submittedAt: '2026-11-03T12:00:00Z', state: 'CHANGES_REQUESTED' }] };
    expect(lastActivity(pr)).toMatchObject({ kind: 'changes', actor: 'carol' });

    pr.commits = { nodes: [{ commit: { committedDate: '2026-11-04T00:00:00Z', author: { name: 'Unlinked Dev', user: null } } }] };
    expect(lastActivity(pr)).toEqual({ kind: 'commit', actor: 'Unlinked Dev', at: '2026-11-04T00:00:00Z' });
    expect(lastActivity({})).toBeNull();
  });

  test('viewer is a requested reviewer (case-insensitive); teams listed but not attributed', () => {
    const pr: RawPR = {
      reviewRequests: {
        nodes: [
          { requestedReviewer: { __typename: 'User', login: 'Me', avatarUrl: 'https://avatars.githubusercontent.com/u/1' } },
          { requestedReviewer: { __typename: 'Team', name: 'Core', slug: 'core' } },
        ],
      },
      timelineItems: {
        nodes: [
          { createdAt: '2026-11-02T00:00:00Z', requestedReviewer: { __typename: 'User', login: 'someone' } },
          { createdAt: '2026-11-01T00:00:00Z', requestedReviewer: { __typename: 'User', login: 'me' } },
        ],
      },
    };
    const r = reviewState(pr, 'me');
    expect(r.viewerRequested).toBe(true);
    expect(r.requestedAt).toBe('2026-11-01T00:00:00Z'); // the viewer's own request
    expect(r.reviewers).toEqual([
      { kind: 'user', login: 'Me', avatarUrl: 'https://avatars.githubusercontent.com/u/1' },
      { kind: 'team', name: 'Core', slug: 'core' },
    ]);

    const other = reviewState(pr, 'stranger');
    expect(other.viewerRequested).toBe(false);
    expect(other.requestedAt).toBe('2026-11-02T00:00:00Z');
    expect(reviewState({ timelineItems: pr.timelineItems }, 'me').requestedAt).toBeNull(); // nobody pending
  });

  test('analyzePR: conflicts, sizes and labels (needs-tests suppressed on truncated file lists)', () => {
    const pr: RawPR = {
      url: 'https://github.com/o/r/pull/1',
      additions: 120,
      deletions: 30,
      changedFiles: 2,
      mergeable: 'CONFLICTING',
      files: { nodes: [{ path: 'src/app.ts' }, { path: 'README.md' }] },
    };
    const m = analyzePR(pr, 'me', true);
    expect(m.conflicts).toBe(true);
    expect(m.size).toEqual({ bucket: 'M', additions: 120, deletions: 30, changedFiles: 2 });
    expect(m.labels).toEqual(['needs-tests', 'documentation']);
    expect(analyzePR({ ...pr, changedFiles: 300 }, 'me', true).labels).toEqual(['documentation']);
    expect(analyzePR(pr, 'me', false).labels).toBeNull();
  });

  test('summarize', () => {
    const base = analyzePR({ url: 'u' }, 'me', false);
    const needs = { ...base, review: { viewerRequested: true, reviewers: [], requestedAt: null } };
    const conflict = { ...base, conflicts: true, unresolved: { total: 3, outdated: 0, byAuthor: [] } };
    expect(summarize([base, needs, conflict])).toEqual({ needYourReview: 1, ready: 0, conflicts: 1, unresolvedThreads: 3 });
  });
});

describe('label rules', () => {
  test('test directories are anchored to a path segment', () => {
    expect(isTestPath('tests/a.ts')).toBe(true);
    expect(isTestPath('src/test/a.ts')).toBe(true);
    expect(isTestPath('pkg/__tests__/a.ts')).toBe(true);
    expect(isTestPath('src/a.test.ts')).toBe(true);
    expect(isTestPath('src/a.spec.tsx')).toBe(true);
    expect(isTestPath('pkg/a_test.go')).toBe(true);
    expect(isTestPath('src/latest/x.ts')).toBe(false);
    expect(isTestPath('src/contests/x.ts')).toBe(false);
    expect(isTestPath('src/attestation.ts')).toBe(false);
  });

  test('lang/ is i18n only as a whole segment (golang/ is not)', () => {
    expect(suggestLabels(['lang/en.json'])).toContain('i18n');
    expect(suggestLabels(['_locales/pl/messages.json'])).toContain('i18n');
    expect(suggestLabels(['tools/golang/config.json'])).not.toContain('i18n');
  });

  test('needs-tests vs has-tests', () => {
    expect(suggestLabels(['src/a.ts'])).toEqual(['needs-tests']);
    expect(suggestLabels(['src/latest/a.ts'])).toEqual(['needs-tests']);
    expect(suggestLabels(['src/a.ts', 'tests/a.test.ts'])).toEqual(['has-tests']);
    expect(suggestLabels(['README.md'])).toEqual(['documentation']);
    expect(suggestLabels([])).toEqual([]);
  });

  test('category rules', () => {
    expect(suggestLabels(['.github/workflows/ci.yml'])).toContain('ci');
    expect(suggestLabels(['package.json', 'package-lock.json'])).toEqual(['dependencies']);
    expect(suggestLabels(['src/styles/app.scss'])).toContain('styling');
    expect(suggestLabels(['db/migrations/001.sql'])).toContain('database');
    expect(suggestLabels(['src/api/users.ts'])).toContain('api');
    expect(suggestLabels(['src/rapid/users.ts'])).not.toContain('api');
    expect(suggestLabels(['Dockerfile'])).toContain('infrastructure');
    expect(suggestLabels(['tsconfig.json'])).toContain('config');
    expect(suggestLabels(['esbuild.config.js'])).toContain('build');
    expect(suggestLabels(['src/auth/login.ts'])).toContain('security');
    expect(suggestLabels(['src/oauthish/login.ts'])).not.toContain('security');
  });
});
