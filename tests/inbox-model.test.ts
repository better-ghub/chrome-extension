import {
  applySeen,
  INBOX_QUERY,
  INBOX_VARIABLES,
  mergeInboxItems,
  lastActivityOf,
  markSeenState,
  mergeSeen,
  normalizePrUrl,
  parseInbox,
  SEEN_MAX_AGE_MS,
  SEEN_MAX_OTHERS,
  toInbox,
  type RawInboxPR,
} from '../src/background/inbox-model';
import type { InboxItem } from '../src/core/messages';

const NOW = '2026-11-22T12:00:00.000Z';

function pr(n: number, extra: Partial<RawInboxPR> = {}): RawInboxPR {
  return {
    url: `https://github.com/o/r/pull/${n}`,
    number: n,
    title: `PR ${n}`,
    updatedAt: `2026-11-2${n % 10}T00:00:00Z`,
    repository: { nameWithOwner: 'o/r' },
    author: { login: 'me', avatarUrl: null },
    ...extra,
  };
}

function item(url: string, over: Partial<InboxItem> = {}): InboxItem {
  return {
    url,
    repo: 'o/r',
    number: 1,
    title: 't',
    author: 'me',
    authorAvatarUrl: null,
    isDraft: false,
    updatedAt: NOW,
    reasons: ['authored'],
    reviewDecision: null,
    checks: null,
    unresolvedThreads: 0,
    additions: 0,
    deletions: 0,
    hasConflicts: false,
    reviewRequestedAt: null,
    lastActivity: null,
    unseen: false,
    ...over,
  };
}

describe('inbox query', () => {
  test('one request with four aliased searches', () => {
    expect(INBOX_QUERY.match(/search\(type: ISSUE, first: 25/g)).toHaveLength(4);
    expect(INBOX_QUERY).toContain('viewer { login name }');
    expect(INBOX_VARIABLES.authored).toContain('is:pr is:open archived:false');
    expect(INBOX_VARIABLES.authored).toContain('author:@me');
    expect(INBOX_VARIABLES.reviewRequested).toContain('review-requested:@me');
    expect(INBOX_VARIABLES.assigned).toContain('assignee:@me');
  });
});

describe('parseInbox', () => {
  test('merges searches by url and records every reason', () => {
    const { viewer, items } = parseInbox({
      viewer: { login: 'me' },
      authored: { nodes: [pr(1), pr(2)] },
      reviewRequested: { nodes: [pr(3, { author: { login: 'bob' } })] },
      assigned: { nodes: [pr(1), {}, null] },
    });
    expect(viewer).toBe('me');
    expect(items.map((i) => i.number).sort()).toEqual([1, 2, 3]);
    expect(items.find((i) => i.number === 1)?.reasons.sort()).toEqual(['assigned', 'authored']);
    expect(items.find((i) => i.number === 3)?.reasons).toEqual(['review-requested']);
  });

  test('maps checks, conflicts and unresolved threads', () => {
    const { items } = parseInbox({
      viewer: { login: 'me' },
      authored: {
        nodes: [
          pr(1, {
            mergeable: 'CONFLICTING',
            commits: { nodes: [{ commit: { committedDate: NOW, statusCheckRollup: { state: 'FAILURE' } } }] },
            reviewThreads: { nodes: [{ isResolved: false }, { isResolved: true }, { isResolved: false }] },
          }),
        ],
      },
    });
    expect(items[0]).toMatchObject({ hasConflicts: true, checks: 'FAILURE', unresolvedThreads: 2 });
  });
});

describe('lastActivityOf', () => {
  test("ignores the viewer's own commits, comments and reviews", () => {
    const raw = pr(1, {
      commits: { nodes: [{ commit: { committedDate: '2026-11-22T10:00:00Z', author: { user: { login: 'ME' } } } }] },
      comments: { nodes: [{ author: { login: 'me' }, createdAt: '2026-11-22T11:00:00Z' }] },
      reviews: { nodes: [{ author: { login: 'bob' }, submittedAt: '2026-11-21T09:00:00Z' }] },
    });
    expect(lastActivityOf(raw, 'me')).toEqual({ kind: 'review', actor: 'bob', at: '2026-11-21T09:00:00Z' });
  });

  test('matches unlinked commit authors by display name', () => {
    const raw = pr(1, { commits: { nodes: [{ commit: { committedDate: NOW, author: { name: 'Filip C', user: null } } }] } });
    expect(lastActivityOf(raw, 'me', 'Filip C')).toBeNull();
    expect(lastActivityOf(raw, 'me')).toMatchObject({ kind: 'commit', actor: 'Filip C' });
  });
});

describe('applySeen', () => {
  const urlA = 'https://github.com/o/r/pull/1';
  const urlB = 'https://github.com/o/r/pull/2';

  test('never-seen authored PR is seen (seen initialised to now); never-seen review request is unseen', () => {
    const { items, seen } = applySeen(
      [item(urlA), item(urlB, { reasons: ['review-requested'] })],
      {},
      NOW
    );
    expect(items.map((i) => i.unseen)).toEqual([false, true]);
    expect(seen).toEqual({ [urlA]: NOW });
  });

  test('activity by others after the last look makes it unseen; older activity does not', () => {
    const seen = { [urlA]: '2026-11-22T10:00:00Z' };
    const newer = item(urlA, { lastActivity: { kind: 'comment', actor: 'bob', at: '2026-11-22T11:00:00Z' } });
    const older = item(urlA, { lastActivity: { kind: 'comment', actor: 'bob', at: '2026-11-22T09:00:00Z' } });
    expect(applySeen([newer], seen, NOW).items[0].unseen).toBe(true);
    expect(applySeen([older], seen, NOW).items[0].unseen).toBe(false);
    // Own activity never reaches lastActivity (see lastActivityOf), so: no activity → seen.
    expect(applySeen([item(urlA)], seen, NOW).items[0].unseen).toBe(false);
  });

  test('a re-requested review after the last look is unseen', () => {
    const seen = { [urlB]: '2026-11-22T10:00:00Z' };
    const re = item(urlB, { reasons: ['review-requested'], reviewRequestedAt: '2026-11-22T11:00:00Z' });
    expect(applySeen([re], seen, NOW).items[0].unseen).toBe(true);
  });

  test('prunes seen entries by age, not by inbox membership', () => {
    const old = new Date(Date.parse(NOW) - SEEN_MAX_AGE_MS - 1000).toISOString();
    const recent = new Date(Date.parse(NOW) - 24 * 3600_000).toISOString();
    const urlC = 'https://github.com/o/r/pull/3';
    const { seen } = applySeen([item(urlA)], { [urlA]: old, [urlB]: recent, [urlC]: old }, NOW);
    // urlA: in the inbox (kept however old); urlB: left recently (kept); urlC: left long ago (pruned).
    expect(seen).toEqual({ [urlA]: old, [urlB]: recent });
  });

  test('caps entries for PRs outside the inbox, keeping the newest', () => {
    const base = Date.parse(NOW) - 3600_000;
    const many: Record<string, string> = {};
    for (let i = 0; i < SEEN_MAX_OTHERS + 5; i++) many[`https://github.com/x/y/pull/${i}`] = new Date(base + i * 1000).toISOString();
    const { seen } = applySeen([], many, NOW);
    expect(Object.keys(seen)).toHaveLength(SEEN_MAX_OTHERS);
    expect(seen['https://github.com/x/y/pull/0']).toBeUndefined();
    expect(seen[`https://github.com/x/y/pull/${SEEN_MAX_OTHERS + 4}`]).toBeDefined();
  });

  test('an authored PR that drops out of the top 25 keeps its seen time, so its next activity is badged', () => {
    const t0 = '2026-11-20T10:00:00.000Z';
    // First sync: seen initialised.
    const first = applySeen([item(urlA)], {}, t0);
    expect(first.seen[urlA]).toBe(t0);
    // Next syncs: the PR is not in the result (25 newer PRs pushed it out).
    const away = applySeen([], first.seen, '2026-11-21T10:00:00.000Z');
    expect(away.seen[urlA]).toBe(t0);
    // It comes back because someone commented after the user last looked.
    const back = item(urlA, { lastActivity: { kind: 'comment', actor: 'bob', at: '2026-11-22T09:00:00Z' } });
    const again = applySeen([back], away.seen, NOW);
    expect(again.items[0].unseen).toBe(true);
    expect(again.seen[urlA]).toBe(t0);
  });

  test('keys are case-insensitive: GitHub\'s canonical url matches a lower-cased seen key', () => {
    const canonical = 'https://github.com/Owner/Repo/pull/5';
    const seen = { 'https://github.com/owner/repo/pull/5': '2026-11-22T10:00:00Z' };
    const re = item(canonical, { reasons: ['review-requested'], reviewRequestedAt: '2026-11-22T09:00:00Z' });
    const out = applySeen([re], seen, NOW);
    expect(out.items[0].unseen).toBe(false);
    expect(Object.keys(out.seen)).toEqual(['https://github.com/owner/repo/pull/5']);
  });
});

describe('normalizePrUrl / mergeSeen', () => {
  test.each([
    ['https://github.com/Owner/Repo/pull/12', 'https://github.com/owner/repo/pull/12'],
    ['  https://github.com/o/r/pull/12/  ', 'https://github.com/o/r/pull/12'],
    ['https://github.com/o/r/pull/12/files?w=1#diff', 'https://github.com/o/r/pull/12'],
    ['https://GITHUB.com/o/r/pull/12#issuecomment-1', 'https://github.com/o/r/pull/12'],
  ])('normalizes %s', (input, out) => {
    expect(normalizePrUrl(input)).toBe(out);
  });

  test.each([
    ['https://github.com/o/r/issues/12'],
    ['https://github.com/o/r/pull/abc'],
    ['http://github.com/o/r/pull/12'],
    ['https://github.com.evil.example/o/r/pull/12'],
    ['https://evil.example/https://github.com/o/r/pull/12'],
    ['https://github.com/o/pull/12'],
    [''],
    [42],
    [null],
  ])('rejects %p', (input) => {
    expect(normalizePrUrl(input)).toBeNull();
  });

  test('mergeSeen lower-cases keys and keeps the newest time per PR', () => {
    expect(
      mergeSeen(
        { 'https://github.com/O/R/pull/1': '2026-11-22T10:00:00Z', 'https://github.com/o/r/pull/2': '2026-11-01T00:00:00Z', bad: 5 },
        { 'https://github.com/o/r/pull/1': '2026-11-21T10:00:00Z' }
      )
    ).toEqual({ 'https://github.com/o/r/pull/1': '2026-11-22T10:00:00Z', 'https://github.com/o/r/pull/2': '2026-11-01T00:00:00Z' });
  });
});

describe('markSeenState / toInbox', () => {
  test('marking one url clears only that item', () => {
    const urlA = 'https://github.com/o/r/pull/1';
    const urlB = 'https://github.com/o/r/pull/2';
    const state = {
      fetchedAt: 1,
      seen: {},
      items: [item(urlA, { reasons: ['review-requested'], unseen: true }), item(urlB, { reasons: ['review-requested'], unseen: true })],
    };
    const one = markSeenState(state, [urlA, 'not a url', 'https://github.com/o/r/issues/3'], NOW);
    expect(toInbox(one).unseenCount).toBe(1);
    expect(one.seen).toEqual({ [urlA]: NOW });
    expect(toInbox(markSeenState(state, undefined, NOW)).unseenCount).toBe(0);
    expect(toInbox(null)).toEqual({ items: [], unseenCount: 0, fetchedAt: 0 });
  });

  test('a PR visited before it is in the inbox stays seen when its review request shows up', () => {
    const url = 'https://github.com/o/r/pull/9';
    // Opened from GitHub's own notification right after the request, before any refresh.
    const visited = markSeenState({ fetchedAt: 1, seen: {}, items: [] }, ['https://github.com/O/R/pull/9/files'], NOW);
    expect(visited.seen).toEqual({ [url]: NOW });
    // Next refresh: the review request (made before the visit) is in the inbox.
    const req = item('https://github.com/O/R/pull/9', { reasons: ['review-requested'], reviewRequestedAt: '2026-11-22T11:00:00Z' });
    expect(applySeen([req], visited.seen, '2026-11-22T12:05:00.000Z').items[0].unseen).toBe(false);
  });

  test('marking with address-bar casing clears an item stored with GitHub casing', () => {
    const state = { fetchedAt: 1, seen: {}, items: [item('https://github.com/Owner/Repo/pull/5', { reasons: ['review-requested'], unseen: true })] };
    expect(toInbox(markSeenState(state, ['https://github.com/owner/repo/pull/5'], NOW)).unseenCount).toBe(0);
  });
});

describe('pending review and re-review', () => {
  const commitAt = (iso: string) => ({ nodes: [{ commit: { committedDate: iso, author: { user: { login: 'bob' } } } }] });
  const review = (state: string, at: string, login = 'me') => ({ nodes: [{ author: { login }, state, submittedAt: at }] });

  test('query asks for pending reviews and latest reviews on a fourth search', () => {
    expect(INBOX_QUERY).toContain('reviews(states: PENDING, first: 1)');
    expect(INBOX_QUERY).toContain('latestReviews(first: 20)');
    expect(INBOX_VARIABLES.reviewed).toContain('reviewed-by:@me -author:@me');
  });

  test('pendingReviewComments comes from the pending review, 0 when none or empty', () => {
    const { items } = parseInbox({
      viewer: { login: 'me' },
      reviewRequested: {
        nodes: [
          pr(1, { pendingReviews: { nodes: [{ comments: { totalCount: 3 } }] } }),
          pr(2),
          pr(3, { pendingReviews: { nodes: [{ comments: { totalCount: 0 } }] } }),
        ],
      },
    });
    expect(items.map((i) => [i.number, i.pendingReviewComments]).sort()).toEqual([[1, 3], [2, 0], [3, 0]]);
  });

  test.each([
    ['CHANGES_REQUESTED', '2026-11-20T10:00:00Z', true],
    ['COMMENTED', '2026-11-20T10:00:00Z', true],
    ['APPROVED', '2026-11-20T10:00:00Z', false],
    ['CHANGES_REQUESTED', '2026-11-22T10:00:00Z', false],
  ])('rereview for a %s review at %s: %s', (state, at, expected) => {
    const { items } = parseInbox({
      viewer: { login: 'me' },
      reviewed: { nodes: [pr(1, { latestReviews: review(state, at), commits: commitAt('2026-11-21T10:00:00Z') })] },
    });
    expect(items.map((i) => i.reasons)).toEqual(expected ? [['rereview']] : []);
  });

  test("another reviewer's latest review does not count; rereview merges with other reasons", () => {
    const base = { commits: commitAt('2026-11-21T10:00:00Z') };
    const { items } = parseInbox({
      viewer: { login: 'me' },
      reviewRequested: { nodes: [pr(1, base)] },
      reviewed: {
        nodes: [pr(1, { ...base, latestReviews: review('COMMENTED', '2026-11-20T00:00:00Z') }), pr(2, { ...base, latestReviews: review('COMMENTED', '2026-11-20T00:00:00Z', 'zed') })],
      },
    });
    expect(items).toHaveLength(1);
    expect(items[0].reasons).toEqual(['review-requested', 'rereview']);
    expect(items[0].rereviewCommitAt).toBe('2026-11-21T10:00:00Z');
  });

  test('rereview is unseen only for commits newer than the last look; reasons survive a token merge', () => {
    const item = { ...({} as InboxItem), ...parseInbox({
      viewer: { login: 'me' },
      reviewed: { nodes: [pr(1, { latestReviews: review('COMMENTED', '2026-11-20T00:00:00Z'), commits: commitAt('2026-11-21T10:00:00Z') })] },
    }).items[0] };
    const key = item.url.toLowerCase();
    expect(applySeen([item], { [key]: '2026-11-21T09:00:00Z' }, NOW).items[0].unseen).toBe(true);
    expect(applySeen([item], { [key]: '2026-11-21T11:00:00Z' }, NOW).items[0].unseen).toBe(false);
    const merged = mergeInboxItems([[item], [{ ...item, reasons: ['assigned'], rereviewCommitAt: undefined, pendingReviewComments: 2 }]]);
    expect(merged[0].reasons).toEqual(['rereview', 'assigned']);
    expect(merged[0]).toMatchObject({ rereviewCommitAt: '2026-11-21T10:00:00Z', pendingReviewComments: 2 });
  });
});
