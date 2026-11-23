import type { InboxItem } from '../src/core/messages';
import {
  canonicalPrUrl,
  inboxFallback,
  normalizeAuthStatus,
  normalizeInbox,
  normalizeInboxItem,
  request,
  AUTH_UNAVAILABLE,
} from '../src/pages/bg';
import {
  activityTime,
  checksStatus,
  compactCount,
  diffLabel,
  groupInbox,
  itemStatuses,
  markSeen,
  pickTab,
  sortItems,
  unseenIn,
  visibleTabs,
} from '../src/pages/inbox';
import { ERROR_UNAVAILABLE } from '../src/pages/token';

let n = 0;
function item(over: Partial<InboxItem> = {}): InboxItem {
  n += 1;
  return {
    url: `https://github.com/o/r/pull/${n}`,
    repo: 'o/r',
    number: n,
    title: `PR ${n}`,
    author: 'mona',
    authorAvatarUrl: null,
    isDraft: false,
    updatedAt: '2026-11-20T10:00:00Z',
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

describe('sorting and grouping', () => {
  test('activityTime takes the latest of updatedAt / lastActivity / reviewRequestedAt', () => {
    const i = item({
      updatedAt: '2026-11-20T10:00:00Z',
      lastActivity: { kind: 'comment', actor: 'x', at: '2026-11-21T10:00:00Z' },
      reviewRequestedAt: '2026-11-19T10:00:00Z',
      reasons: ['review-requested'],
    });
    expect(activityTime(i)).toBe(Date.parse('2026-11-21T10:00:00Z'));
    expect(activityTime(item({ updatedAt: 'garbage' }))).toBe(0);
  });

  test('unseen first, then most recent first', () => {
    const old = item({ updatedAt: '2026-11-01T00:00:00Z' });
    const recent = item({ updatedAt: '2026-11-21T00:00:00Z' });
    const unseenOld = item({ updatedAt: '2026-10-01T00:00:00Z', unseen: true });
    expect(sortItems([old, recent, unseenOld]).map((i) => i.number)).toEqual([unseenOld.number, recent.number, old.number]);
  });

  test('groups by reason; a PR can be in several tabs', () => {
    const review = item({ reasons: ['review-requested'] });
    const both = item({ reasons: ['review-requested', 'assigned'] });
    const mine = item({ reasons: ['authored'] });
    const groups = groupInbox([review, both, mine]);
    expect(groups.review).toHaveLength(2);
    expect(groups.assigned.map((i) => i.url)).toEqual([both.url]);
    expect(groups.authored.map((i) => i.url)).toEqual([mine.url]);
  });

  test('"Assigned" is only visible when it has items', () => {
    expect(visibleTabs(groupInbox([item()]))).toEqual(['review', 'authored']);
    expect(visibleTabs(groupInbox([item({ reasons: ['assigned'] })]))).toEqual(['review', 'authored', 'assigned']);
  });
});

describe('pickTab', () => {
  const review = item({ reasons: ['review-requested'] });
  const mineUnseen = item({ reasons: ['authored'], unseen: true });
  const mine = item({ reasons: ['authored'] });

  test('prefers a tab with unseen items over the remembered one', () => {
    expect(pickTab(groupInbox([review, mineUnseen]), 'review')).toBe('authored');
  });

  test('keeps the remembered tab when it has unseen items too', () => {
    const reviewUnseen = item({ reasons: ['review-requested'], unseen: true });
    expect(pickTab(groupInbox([reviewUnseen, mineUnseen]), 'authored')).toBe('authored');
  });

  test('remembered tab when nothing is unseen and it has items', () => {
    expect(pickTab(groupInbox([review, mine]), 'authored')).toBe('authored');
  });

  test('falls back to the first non-empty tab', () => {
    expect(pickTab(groupInbox([mine]), 'review')).toBe('authored');
    expect(pickTab(groupInbox([mine]), 'assigned')).toBe('authored');
    expect(pickTab(groupInbox([mine]), 'bogus')).toBe('authored');
  });

  test('empty inbox → remembered visible tab or review', () => {
    expect(pickTab(groupInbox([]), null)).toBe('review');
    expect(pickTab(groupInbox([]), 'authored')).toBe('authored');
  });
});

describe('seen state', () => {
  test('markSeen for given urls or all, without mutating input', () => {
    const a = item({ unseen: true });
    const b = item({ unseen: true });
    const items = [a, b];
    expect(unseenIn(markSeen(items, [a.url]))).toBe(1);
    expect(unseenIn(markSeen(items))).toBe(0);
    expect(unseenIn(items)).toBe(2);
  });
});

describe('status descriptors', () => {
  test('checks map to icon + tone', () => {
    expect(checksStatus('SUCCESS')).toMatchObject({ icon: 'check', tone: 'success' });
    expect(checksStatus('FAILURE')).toMatchObject({ icon: 'x', tone: 'danger' });
    expect(checksStatus('ERROR')).toMatchObject({ tone: 'danger' });
    expect(checksStatus('PENDING')).toMatchObject({ tone: 'attention' });
    expect(checksStatus(null)).toBeNull();
  });

  test('ordered statuses with accessible labels', () => {
    const statuses = itemStatuses(
      item({ reviewDecision: 'CHANGES_REQUESTED', checks: 'FAILURE', hasConflicts: true, unresolvedThreads: 2 })
    );
    expect(statuses.map((s) => s.id)).toEqual(['review', 'checks', 'conflicts', 'threads']);
    expect(statuses[0]).toMatchObject({ text: 'Changes requested', tone: 'danger' });
    expect(statuses[3]).toMatchObject({ label: '2 unresolved threads', text: '2' });
    expect(itemStatuses(item({ unresolvedThreads: 1 }))[0].label).toBe('1 unresolved thread');
  });

  test('drafts show "Draft" instead of a review decision', () => {
    const s = itemStatuses(item({ isDraft: true, reviewDecision: 'APPROVED' }));
    expect(s.map((x) => x.id)).toEqual(['draft']);
  });

  test('"Review required" is implied in the review tab', () => {
    const i = item({ reviewDecision: 'REVIEW_REQUIRED' });
    expect(itemStatuses(i, 'review')).toEqual([]);
    expect(itemStatuses(i, 'authored').map((s) => s.text)).toEqual(['Review required']);
  });

  test('diff label and compact counts', () => {
    expect(diffLabel(item({ additions: 1, deletions: 8 }))).toBe('1 line added, 8 lines removed');
    expect(compactCount(999)).toBe('999');
    expect(compactCount(1234)).toBe('1.2k');
    expect(compactCount(2000)).toBe('2k');
    expect(compactCount(45678)).toBe('45k');
  });
});

describe('normalisers (defensive against a changing background)', () => {
  test('canonicalPrUrl accepts only github.com pull request URLs', () => {
    expect(canonicalPrUrl('https://github.com/o/r/pull/12')?.url).toBe('https://github.com/o/r/pull/12');
    expect(canonicalPrUrl('https://github.com/o/r/pull/12/files?x=1#y')).toBeNull();
    expect(canonicalPrUrl('https://github.com/o/r/pull/12/')?.number).toBe(12);
    expect(canonicalPrUrl('https://github.com/o/r/pull/12?notification=1')?.url).toBe('https://github.com/o/r/pull/12');
    expect(canonicalPrUrl('http://github.com/o/r/pull/12')).toBeNull();
    expect(canonicalPrUrl('https://evil.com/o/r/pull/12')).toBeNull();
    expect(canonicalPrUrl('javascript:alert(1)')).toBeNull();
    expect(canonicalPrUrl(42)).toBeNull();
  });

  test('normalizeInboxItem fills defaults and drops unsafe values', () => {
    const out = normalizeInboxItem({
      url: 'https://github.com/o/r/pull/7',
      title: '  Fix things  ',
      authorAvatarUrl: 'http://insecure/avatar.png',
      checks: 'WEIRD',
      reviewDecision: 'APPROVED',
      unresolvedThreads: -3,
      reasons: ['review-requested', 'bogus'],
      lastActivity: { kind: 'comment', actor: 'x', at: 'not-a-date' },
    });
    expect(out).toMatchObject({
      url: 'https://github.com/o/r/pull/7',
      repo: 'o/r',
      number: 7,
      title: 'Fix things',
      authorAvatarUrl: null,
      checks: null,
      reviewDecision: 'APPROVED',
      unresolvedThreads: 0,
      reasons: ['review-requested'],
      lastActivity: null,
      unseen: false,
    });
    expect(normalizeInboxItem({ url: 'https://example.com/x' })).toBeNull();
    expect(normalizeInboxItem(null)).toBeNull();
  });

  test('normalizeInbox de-duplicates and keeps flags', () => {
    const raw = {
      items: [{ url: 'https://github.com/o/r/pull/1', unseen: true }, { url: 'https://github.com/o/r/pull/1' }, 'junk'],
      fetchedAt: 123,
      needsAuth: true,
      error: 'boom',
    };
    const inbox = normalizeInbox(raw);
    expect(inbox.items).toHaveLength(1);
    expect(inbox.unseenCount).toBe(1);
    expect(inbox).toMatchObject({ fetchedAt: 123, needsAuth: true, error: 'boom' });
    expect(normalizeInbox(undefined)).toEqual(inboxFallback(ERROR_UNAVAILABLE));
  });

  test('normalizeAuthStatus requires a valid account to be authenticated', () => {
    expect(normalizeAuthStatus(null)).toEqual(AUTH_UNAVAILABLE);
    expect(normalizeAuthStatus({ authenticated: true }).authenticated).toBe(false);
    const ok = normalizeAuthStatus({
      authenticated: true,
      account: { login: 'mona', name: '', avatarUrl: 'javascript:x', htmlUrl: 'https://evil.com/mona' },
      tokenKind: 'fine-grained',
      rateLimit: { remaining: 10, limit: 5000, reset: 'soon' },
    });
    expect(ok).toEqual({
      authenticated: true,
      account: { login: 'mona', name: null, avatarUrl: '', htmlUrl: 'https://github.com/mona' },
      tokenKind: 'fine-grained',
      rateLimit: { remaining: 10, limit: 5000, reset: null },
    });
    expect(normalizeAuthStatus({ authenticated: false, error: 'Invalid token' })).toEqual({ authenticated: false, error: 'Invalid token' });
  });
});

describe('request()', () => {
  const runtime = chrome.runtime as unknown as { id?: string; sendMessage: unknown };
  const originalSend = runtime.sendMessage;

  beforeEach(() => {
    runtime.id = 'test-extension';
  });

  afterEach(() => {
    runtime.sendMessage = originalSend;
    delete runtime.id;
    jest.useRealTimers();
  });

  test('resolves with the background response', async () => {
    runtime.sendMessage = () => Promise.resolve({ ok: true });
    await expect(request('cache:clear', {}, { ok: false })).resolves.toEqual({ ok: true });
  });

  test('falls back when the background is gone', async () => {
    delete runtime.id;
    await expect(request('cache:clear', {}, { ok: false })).resolves.toEqual({ ok: false });
  });

  test('times out to the timeout fallback when the worker never answers', async () => {
    jest.useFakeTimers();
    runtime.sendMessage = () => new Promise(() => undefined);
    const pending = request('cache:clear', {}, { ok: false }, 1000, { ok: false, timedOut: true } as unknown as { ok: boolean });
    jest.advanceTimersByTime(1001);
    await expect(pending).resolves.toEqual({ ok: false, timedOut: true });
  });
});

describe('pending review and re-review in the inbox', () => {
  test('rereview items live in the review tab with a chip', () => {
    const re = item({ reasons: ['rereview'] });
    const groups = groupInbox([re, item({ reasons: ['authored'] })]);
    expect(groups.review).toEqual([re]);
    expect(itemStatuses(re, 'review')[0]).toMatchObject({ id: 'rereview', text: 'New changes since your review' });
  });

  test('an unsubmitted review gets a chip and sorts right after pins', () => {
    const draft = item({ pendingReviewComments: 3, unseen: false });
    const unseen = item({ unseen: true });
    const pinned = item({ pinned: true });
    expect(sortItems([unseen, draft, pinned]).map((i) => i.url)).toEqual([pinned.url, draft.url, unseen.url]);
    expect(itemStatuses(draft)[0]).toMatchObject({ id: 'pending-review', tone: 'attention', text: 'Unsubmitted review · 3' });
    expect(itemStatuses(item())).toEqual([]);
  });
});
