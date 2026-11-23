// jsdom: chips rendered into a fixture that mirrors GitHub's React PR list.

import { PRListController } from '../src/features/pr-list/controller';
import type { RawPR } from '../src/features/pr-list/analyze';

type Msg = { type: string; variables?: Record<string, string | number> };

const PRS: Record<number, RawPR> = {
  1: {
    url: 'https://github.com/o/r/pull/1',
    additions: 120,
    deletions: 30,
    changedFiles: 4,
    mergeable: 'CONFLICTING',
    reviewRequests: { nodes: [{ requestedReviewer: { __typename: 'User', login: 'me', avatarUrl: null as unknown as string } }] },
    timelineItems: { nodes: [{ createdAt: '2026-11-21T00:00:00Z', requestedReviewer: { __typename: 'User', login: 'me' } }] },
    comments: { nodes: [{ author: { login: 'alice' }, createdAt: '2026-11-22T08:00:00Z' }] },
    reviewThreads: { nodes: [{ isResolved: false, isOutdated: false, comments: { nodes: [{ author: { login: 'bob' } }] } }] },
  },
  2: { url: 'https://github.com/o/r/pull/2', additions: 2, deletions: 1, changedFiles: 1, mergeable: 'MERGEABLE' },
  3: { url: 'https://github.com/o/r/pull/3', additions: 2000, deletions: 0, changedFiles: 40 },
};

let sendMessage: jest.Mock;

function row(n: number): string {
  return `
    <li class="listItem__X41oTe">
      <div class="mainContent__a1">
        <div data-listview-item-title-container="true">
          <h3><a data-testid="listitem-title-link" data-hovercard-type="pull_request" href="/o/r/pull/${n}">PR ${n}</a></h3>
          <span class="trailingBadges__b2"></span>
        </div>
        <div class="meta__c3">
          <span>#${n}</span>
          <span data-testid="timestamp-container"><relative-time datetime="2026-11-20T00:00:00Z">Nov 20</relative-time></span>
          <a data-testid="author-filter-link" href="#">alice</a>
        </div>
      </div>
    </li>`;
}

function fixture(numbers: number[]): HTMLUListElement {
  document.body.innerHTML = `<main><div class="Box"><ul data-listview-component="items-list">${numbers.map(row).join('')}</ul></div></main>`;
  return document.querySelector('ul')!;
}

function graphqlResponse(msg: Msg): unknown {
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(msg.variables ?? {})) {
    if (!k.startsWith('n')) continue;
    const pr = PRS[v as number];
    data[`pr${k.slice(1)}`] = pr ? { pullRequest: pr } : null;
  }
  return { ok: true, data };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

function controller(signal: AbortSignal, authenticated = true): PRListController {
  return new PRListController({ signal, owner: 'o', repo: 'r', authenticated, noticeDismissed: false, viewer: 'me', withLabels: false });
}

beforeEach(() => {
  (globalThis as unknown as { __resetChromeStorage: () => void }).__resetChromeStorage();
  sendMessage = jest.fn((msg: Msg) => Promise.resolve(msg.type === 'api:graphql' ? graphqlResponse(msg) : undefined));
  chrome.runtime.sendMessage = sendMessage as unknown as typeof chrome.runtime.sendMessage;
});

test('one batched request; skeletons first, then chips right after the meta line', async () => {
  const list = fixture([1, 2]);
  const ac = new AbortController();
  const c = controller(ac.signal);
  c.scan();

  const slots = list.querySelectorAll<HTMLElement>('.bghub-prl-slot');
  expect(slots).toHaveLength(2);
  expect(slots[0].querySelector('.bghub-prl-skeleton')?.getAttribute('aria-hidden')).toBe('true');
  expect(slots[0].previousElementSibling?.querySelector('[data-testid="timestamp-container"]')).not.toBeNull();
  expect(document.querySelector('[role="status"]')?.textContent).toBe('Loading review activity…');

  await settle();
  expect(sendMessage).toHaveBeenCalledTimes(1);
  const first = list.querySelector<HTMLElement>('[data-bghub-pr="o/r#1"]')!;
  expect(first.dataset.state).toBe('ready');
  const text = first.textContent ?? '';
  expect(text).toContain('Your review');
  expect(text).toContain('Conflicts');
  expect(text).toContain('M+120');
  expect(text).toContain('alice commented');
  expect(first.querySelector('relative-time[datetime="2026-11-22T08:00:00Z"]')).not.toBeNull();
  expect(first.querySelectorAll('button[type="button"]').length).toBe(3); // review, threads, size
  expect(list.children[0].hasAttribute('data-bghub-accent')).toBe(true);
  expect(list.children[1].hasAttribute('data-bghub-accent')).toBe(false);

  const bar = document.querySelector('.bghub-prl-bar')!;
  expect(bar.textContent).toContain('1 needs your review');
  expect(bar.textContent).toContain('1 has conflicts');
  expect(bar.querySelector('a')?.getAttribute('href')).toBe('/o/r/pulls?q=is%3Apr%20is%3Aopen%20review-requested%3A%40me');
  expect(document.querySelector('[role="status"]')?.textContent).toBe('Review activity loaded.');
  ac.abort();
});

test('re-scans are idempotent and React wipes are repaired without refetching', async () => {
  const list = fixture([1, 2]);
  const ac = new AbortController();
  const c = controller(ac.signal);
  c.scan();
  await settle();
  const slot = list.querySelector('[data-bghub-pr="o/r#2"]')!;
  const chips = [...slot.children];

  c.scan();
  c.scan();
  expect(list.querySelectorAll('.bghub-prl-slot')).toHaveLength(2);
  expect(list.querySelector('[data-bghub-pr="o/r#2"]')).toBe(slot);
  expect([...slot.children]).toEqual(chips);
  expect(document.querySelectorAll('.bghub-prl-top')).toHaveLength(1);

  // React re-renders the row and drops our node.
  slot.remove();
  c.scan();
  const again = list.querySelector('[data-bghub-pr="o/r#2"]')!;
  expect(again).not.toBeNull();
  expect(again.textContent).toContain('XS');
  expect(sendMessage).toHaveBeenCalledTimes(1);
  ac.abort();
});

test('a reused <li> showing another PR gets that PR\'s chips', async () => {
  const list = fixture([1, 2]);
  const ac = new AbortController();
  const c = controller(ac.signal);
  c.scan();
  await settle();
  list.children[1].querySelector('a[data-testid="listitem-title-link"]')!.setAttribute('href', '/o/r/pull/3');
  c.scan();
  expect(list.children[1].querySelector('[data-bghub-pr="o/r#2"]')).toBeNull();
  await settle();
  expect(list.children[1].querySelector('[data-bghub-pr="o/r#3"]')?.textContent).toContain('XL');
  expect(sendMessage).toHaveBeenCalledTimes(2);
  ac.abort();
});

test('failed rows render nothing and are retried later (not marked done forever)', async () => {
  const list = fixture([2]);
  sendMessage.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 0, error: 'network' }));
  const ac = new AbortController();
  const c = controller(ac.signal);
  c.scan();
  await settle();
  expect(list.querySelector('.bghub-prl-slot')).toBeNull();

  c.scan(); // within the backoff window: no new request
  expect(sendMessage).toHaveBeenCalledTimes(1);

  const now = Date.now();
  const spy = jest.spyOn(Date, 'now').mockReturnValue(now + 60_000);
  c.scan();
  await settle();
  spy.mockRestore();
  expect(sendMessage).toHaveBeenCalledTimes(2);
  expect(list.querySelector('[data-bghub-pr="o/r#2"]')?.getAttribute('data-state')).toBe('ready');
  ac.abort();
});

test('abort removes every injected node and attribute', async () => {
  const list = fixture([1, 2]);
  const ac = new AbortController();
  controller(ac.signal).scan();
  await settle();
  ac.abort();
  expect(document.querySelectorAll('.bghub-prl-slot, .bghub-prl-top, [data-bghub-accent]')).toHaveLength(0);
  expect(list.children).toHaveLength(2);
});

test('results arriving after abort are dropped (no duplicate rendering)', async () => {
  const list = fixture([1]);
  const ac = new AbortController();
  controller(ac.signal).scan();
  ac.abort();
  await settle();
  const ac2 = new AbortController();
  controller(ac2.signal).scan();
  await settle();
  expect(list.querySelectorAll('.bghub-prl-slot')).toHaveLength(1);
  ac2.abort();
});

test('without a token: no per-row UI, one dismissible notice', async () => {
  const list = fixture([1, 2]);
  const ac = new AbortController();
  const c = controller(ac.signal, false);
  c.scan();
  expect(list.querySelector('.bghub-prl-slot')).toBeNull();
  expect(sendMessage).not.toHaveBeenCalled();
  const bar = document.querySelector<HTMLElement>('.bghub-prl-notice')!;
  expect(bar.textContent).toContain('Connect a GitHub token');

  bar.querySelector<HTMLButtonElement>('.bghub-prl-btn')!.click();
  expect(sendMessage).toHaveBeenCalledWith({ type: 'ui:openOptions', section: 'account' });

  bar.querySelector<HTMLButtonElement>('.bghub-prl-dismiss')!.click();
  await settle();
  expect(document.querySelector<HTMLElement>('.bghub-prl-bar')!.hidden).toBe(true);
  expect((await chrome.storage.local.get('prListNoticeDismissed')).prListNoticeDismissed).toBe(true);
  ac.abort();
});

test('chip tooltips: focus shows, aria-describedby while open, Esc hides', async () => {
  const list = fixture([1]);
  const ac = new AbortController();
  controller(ac.signal).scan();
  await settle();
  const sizeBtn = list.querySelector<HTMLButtonElement>('.bghub-prl-size-chip')!;
  expect(sizeBtn.getAttribute('aria-label')).toBe('Size M: 120 additions, 30 deletions');

  sizeBtn.focus();
  const tip = document.getElementById('bghub-tooltip')!;
  expect(tip.getAttribute('role')).toBe('tooltip');
  expect(tip.hidden).toBe(false);
  expect(tip.textContent).toContain('4 files changed');
  expect(sizeBtn.getAttribute('aria-describedby')).toBe('bghub-tooltip');

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(tip.hidden).toBe(true);
  expect(sizeBtn.hasAttribute('aria-describedby')).toBe(false);
  expect(document.activeElement).toBe(sizeBtn);

  ac.abort();
  expect(document.getElementById('bghub-tooltip')).toBeNull();
});
