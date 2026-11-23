import type { InboxItem } from '../src/core/messages';
import { buildSummary, summaryStatus } from '../src/pages/summary';

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
    unseen: false,
    ...over,
  };
}

describe('summaryStatus', () => {
  test.each([
    [{ isDraft: true, ready: true }, 'draft'],
    [{ ready: true, reviewDecision: 'APPROVED', checks: 'SUCCESS' }, 'ready'],
    [{ checks: 'FAILURE', reviewDecision: 'APPROVED' }, 'checks-failing'],
    [{ checks: 'ERROR' }, 'checks-failing'],
    [{ reviewDecision: 'CHANGES_REQUESTED', checks: 'SUCCESS' }, 'changes-requested'],
    [{ reviewDecision: 'APPROVED', checks: 'PENDING' }, 'approved-waiting'],
    [{ reviewDecision: 'APPROVED', checks: 'SUCCESS' }, 'approved'],
    [{ reviewDecision: 'REVIEW_REQUIRED' }, 'waiting'],
  ] as [Partial<InboxItem>, string][])('%j -> %s', (over, expected) => {
    expect(summaryStatus(item(over))).toBe(expected);
  });
});

describe('buildSummary', () => {
  const now = Date.parse('2026-11-23T10:00:00Z');

  test('groups authored and reviewing, skips snoozed and assigned-only', () => {
    const mine = item({ title: 'Fix [bug]', ready: true, checks: 'SUCCESS', reviewDecision: 'APPROVED', number: 101, url: 'https://github.com/o/r/pull/101' });
    const review = item({ reasons: ['review-requested'], number: 7, repo: 'a/b', url: 'https://github.com/a/b/pull/7', title: 'Add  thing' });
    const rereview = item({ reasons: ['rereview'], isDraft: true });
    const snoozed = item({ snoozedUntil: '2026-11-24T10:00:00Z' });
    const assigned = item({ reasons: ['assigned'] });
    const out = buildSummary([mine, review, rereview, snoozed, assigned], now);
    expect(out).toBe(
      [
        '### My pull requests',
        '- [o/r#101](https://github.com/o/r/pull/101) Fix \\[bug\\] — ready to merge',
        '',
        '### Reviewing',
        `- [a/b#7](https://github.com/a/b/pull/7) Add thing — waiting for review`,
        `- [o/r#${rereview.number}](${rereview.url}) ${rereview.title} — draft`,
      ].join('\n')
    );
  });

  test('pinned items come first; empty inbox gives an empty string', () => {
    const a = item({ updatedAt: '2026-11-22T10:00:00Z' });
    const b = item({ pinned: true, updatedAt: '2026-11-01T10:00:00Z' });
    const lines = buildSummary([a, b], now).split('\n');
    expect(lines[1]).toContain(`#${b.number}`);
    expect(buildSummary([], now)).toBe('');
  });
});
