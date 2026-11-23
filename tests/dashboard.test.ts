import { pickDashboardItems } from '../src/features/dashboard/order';
import { DashboardCard } from '../src/features/dashboard/card';
import type { Inbox, InboxItem } from '../src/core/messages';
import { formatMicro, formatAgo } from '../src/ui/time';
import { tNodes, tPlural } from '../src/ui/format';

function item(n: number, over: Partial<InboxItem> = {}): InboxItem {
  return {
    url: `https://github.com/o/r/pull/${n}`,
    repo: 'o/r',
    number: n,
    title: `PR ${n}`,
    author: 'me',
    authorAvatarUrl: null,
    isDraft: false,
    updatedAt: `2026-11-${10 + n}T00:00:00Z`,
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

describe('pickDashboardItems', () => {
  test('review requests first (newest request first), then the rest by update, max 6', () => {
    const items = [
      item(1),
      item(2, { reasons: ['review-requested'], reviewRequestedAt: '2026-11-01T00:00:00Z' }),
      item(3),
      item(4, { reasons: ['review-requested'], reviewRequestedAt: '2026-11-05T00:00:00Z' }),
      item(5, { reasons: ['assigned'] }),
      item(6),
      item(7),
      item(8),
    ];
    expect(pickDashboardItems(items).map((i) => i.number)).toEqual([4, 2, 8, 7, 6, 5]);
  });
});

describe('DashboardCard', () => {
  let sendMessage: jest.Mock;
  const reply = (inbox: Partial<Inbox>) => (msg: { type: string }) =>
    Promise.resolve(msg.type === 'inbox:get' ? { items: [], unseenCount: 0, fetchedAt: 1, ...inbox } : { ok: true, unseenCount: 0 });

  beforeEach(() => {
    sendMessage = jest.fn();
    chrome.runtime.sendMessage = sendMessage as unknown as typeof chrome.runtime.sendMessage;
    document.body.innerHTML = '<main><div id="col"></div></main>';
  });

  test('renders rows with draft/open icons, statuses and the unseen dot; marks seen on open', async () => {
    sendMessage.mockImplementation(
      reply({
        items: [
          item(1, { isDraft: true, checks: 'SUCCESS', unseen: true }),
          item(2, { reasons: ['review-requested'], hasConflicts: true, unresolvedThreads: 2, reviewDecision: 'CHANGES_REQUESTED' }),
        ],
      })
    );
    const ac = new AbortController();
    const card = new DashboardCard(ac.signal);
    document.getElementById('col')!.append(card.el);
    const loading = card.load(false);
    expect(card.el.querySelectorAll('.bghub-dash-row--skeleton')).toHaveLength(3);
    await loading;

    const rows = card.el.querySelectorAll('.bghub-dash-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Review requested');
    expect(rows[0].querySelector('[aria-label="Merge conflicts"]')).not.toBeNull();
    expect(rows[0].querySelector('[aria-label="2 unresolved threads"]')).not.toBeNull();
    expect(rows[0].querySelector('[aria-label="Changes requested"]')).not.toBeNull();
    expect(rows[1].querySelector('.bghub-dash-pr-icon--draft .octicon-git-pull-request-draft')).not.toBeNull();
    expect(rows[1].querySelector('[aria-label="Checks passing"]')).not.toBeNull();
    expect(rows[1].querySelector('.bghub-dash-dot')?.textContent).toBe('New activity');
    expect(card.el.querySelector('.bghub-dash-counter')?.textContent).toBe('2');

    const title = rows[1].querySelector<HTMLAnchorElement>('.bghub-dash-title')!;
    title.addEventListener('click', (e) => e.preventDefault()); // jsdom cannot navigate
    title.dispatchEvent(new MouseEvent('click', { cancelable: true }));
    expect(sendMessage).toHaveBeenCalledWith({ type: 'inbox:markSeen', urls: ['https://github.com/o/r/pull/1'] });
    ac.abort();
    expect(card.el.isConnected).toBe(false);
  });

  test('error state with Retry (forced refresh) — no automatic retry loop', async () => {
    sendMessage.mockImplementation(reply({ error: 'rate-limited' }));
    const ac = new AbortController();
    const card = new DashboardCard(ac.signal);
    document.body.append(card.el);
    await card.load(false);
    expect(card.el.querySelector('[role="alert"]')?.textContent).toContain('rate limit');
    expect(sendMessage).toHaveBeenCalledTimes(1);

    sendMessage.mockImplementation(reply({ items: [] }));
    card.el.querySelector<HTMLButtonElement>('.bghub-dash-btn')!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(sendMessage).toHaveBeenLastCalledWith({ type: 'inbox:get', force: true });
    expect(card.el.textContent).toContain('No open pull requests');
    ac.abort();
  });

  test('no token → the card removes itself', async () => {
    sendMessage.mockImplementation(reply({ needsAuth: true }));
    const ac = new AbortController();
    const card = new DashboardCard(ac.signal);
    document.body.append(card.el);
    await card.load(false);
    expect(card.el.isConnected).toBe(false);
    expect(card.closed).toBe(true);
  });
});

describe('formatting helpers', () => {
  const now = Date.parse('2026-11-22T12:00:00Z');
  test('localized compact and long relative times (no hard-coded "5m ago")', () => {
    expect(formatMicro('2026-11-22T11:55:00Z', now, 'en')).toBe('5m');
    expect(formatMicro('2026-11-22T10:00:00Z', now, 'en')).toBe('2h');
    expect(formatMicro('2026-11-19T12:00:00Z', now, 'en')).toBe('3d');
    expect(formatAgo('2026-11-22T10:00:00Z', now, 'en')).toBe('2 hours ago');
    expect(formatAgo('2026-11-22T10:00:00Z', now, 'pl')).toBe('2 godziny temu');
  });

  test('tNodes splices nodes into placeholders without concatenation', () => {
    const strong = document.createElement('strong');
    strong.textContent = 'alice';
    const parts = tNodes('missingKey', '$1 commented · $2', [strong, '2h']);
    expect(parts[0]).toBe(strong);
    expect(parts.slice(1)).toEqual([' commented · ', '2h']);
  });

  test('tPlural picks the plural category', () => {
    expect(tPlural('missingKey', 1, '$1 thread', '$1 threads')).toBe('1 thread');
    expect(tPlural('missingKey', 3, '$1 thread', '$1 threads')).toBe('3 threads');
  });
});
