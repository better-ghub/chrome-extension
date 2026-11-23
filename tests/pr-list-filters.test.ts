// PR list: readiness / staleness in the row model, quick filters (pure) and
// their projection onto the list (jsdom).

import { analyzePR, summarize, type RawPR, type RowModel } from '../src/features/pr-list/analyze';
import { FILTERED_ATTR, PRListController } from '../src/features/pr-list/controller';
import { filterCounts, matchesFilter, rowVisible, toggleFilter, type QuickFilter } from '../src/features/pr-list/filters';
import { buildPRQuery } from '../src/features/pr-list/query';

const NOW = Date.parse('2026-11-23T12:00:00Z');
const DAY = 86_400_000;
const iso = (ms: number): string => new Date(ms).toISOString();

const commit = (at: number, state: string | null): RawPR['commits'] => ({
  nodes: [{ commit: { committedDate: iso(at), statusCheckRollup: state ? { state } : null } }],
});

const READY: RawPR = {
  url: 'https://github.com/o/r/pull/1',
  reviewDecision: 'APPROVED',
  mergeable: 'MERGEABLE',
  commits: commit(NOW - DAY, 'SUCCESS'),
};

describe('row model: checks, readiness, staleness', () => {
  test('the query asks for the last commit’s check rollup and updatedAt', () => {
    const { query } = buildPRQuery([{ owner: 'o', repo: 'r', number: 1, key: 'o/r#1' }], { withFiles: false });
    expect(query).toContain('statusCheckRollup { state }');
    expect(query).toContain('updatedAt');
  });

  test('ready = approved + green (or no) checks + no conflicts/threads + not a draft', () => {
    const m = analyzePR(READY, 'me', false, { now: NOW });
    expect(m.checks).toBe('SUCCESS');
    expect(m.reviewDecision).toBe('APPROVED');
    expect(m.ready).toBe(true);
    expect(analyzePR({ ...READY, commits: commit(NOW, null) }, 'me', false).ready).toBe(true);
    expect(analyzePR({ ...READY, commits: commit(NOW, 'FAILURE') }, 'me', false).ready).toBe(false);
    expect(analyzePR({ ...READY, commits: commit(NOW, 'PENDING') }, 'me', false).ready).toBe(false);
    expect(analyzePR({ ...READY, reviewDecision: null }, 'me', false).ready).toBe(false);
    expect(analyzePR({ ...READY, isDraft: true }, 'me', false).ready).toBe(false);
    expect(analyzePR({ ...READY, mergeable: 'CONFLICTING' }, 'me', false).ready).toBe(false);
    const thread = { nodes: [{ isResolved: false, comments: { nodes: [] } }] };
    expect(analyzePR({ ...READY, reviewThreads: thread }, 'me', false).ready).toBe(false);
    expect(analyzePR({ ...READY, commits: commit(NOW, 'WEIRD') }, 'me', false).checks).toBeNull();
  });

  test('stale after staleDays without activity (0 disables); falls back to updatedAt', () => {
    const old: RawPR = { url: 'u', commits: commit(NOW - 9 * DAY - 1000, null) };
    expect(analyzePR(old, 'me', false, { staleDays: 7, now: NOW })).toMatchObject({ stale: true, idleDays: 9 });
    expect(analyzePR(old, 'me', false, { staleDays: 14, now: NOW }).stale).toBe(false);
    expect(analyzePR(old, 'me', false, { staleDays: 0, now: NOW }).stale).toBe(false);
    expect(analyzePR({ url: 'u', updatedAt: iso(NOW - 30 * DAY) }, 'me', false, { staleDays: 7, now: NOW })).toMatchObject({
      stale: true,
      idleDays: 30,
    });
  });

  test('summary counts ready pull requests', () => {
    const ready = analyzePR(READY, 'me', false);
    const other = analyzePR({ url: 'x' }, 'me', false);
    expect(summarize([ready, other, ready]).ready).toBe(2);
  });
});

describe('quick filter logic', () => {
  const base = analyzePR({ url: 'u' }, 'me', false);
  const model = (over: Partial<RowModel>): RowModel => ({ ...base, ...over });
  const review = model({ review: { viewerRequested: true, reviewers: [], requestedAt: null } });
  const ready = model({ ready: true });
  const conflictDraft = model({ conflicts: true, isDraft: true });
  const staleReview = model({ stale: true, review: { viewerRequested: true, reviewers: [], requestedAt: null } });
  const all = [review, ready, conflictDraft, staleReview, base];
  const set = (...f: QuickFilter[]): Set<QuickFilter> => new Set(f);

  test('each filter on its own', () => {
    expect(all.filter((m) => matchesFilter(m, 'review'))).toEqual([review, staleReview]);
    expect(all.filter((m) => matchesFilter(m, 'ready'))).toEqual([ready]);
    expect(all.filter((m) => matchesFilter(m, 'conflicts'))).toEqual([conflictDraft]);
    expect(all.filter((m) => matchesFilter(m, 'stale'))).toEqual([staleReview]);
    expect(all.filter((m) => matchesFilter(m, 'hideDrafts'))).not.toContain(conflictDraft);
  });

  test('several filters combine with AND', () => {
    expect(all.filter((m) => rowVisible(m, set('review', 'stale')))).toEqual([staleReview]);
    expect(all.filter((m) => rowVisible(m, set('conflicts', 'hideDrafts')))).toEqual([]);
    expect(all.filter((m) => rowVisible(m, set('review', 'hideDrafts')))).toEqual([review, staleReview]);
  });

  test('no filter shows everything, including rows still loading', () => {
    expect(all.every((m) => rowVisible(m, set()))).toBe(true);
    expect(rowVisible(null, set())).toBe(true);
    expect(rowVisible(null, set('ready'))).toBe(false);
  });

  test('counts per chip (each filter on its own; drafts for "Hide drafts")', () => {
    expect(filterCounts(all)).toEqual({ review: 2, ready: 1, conflicts: 1, stale: 1, hideDrafts: 1 });
    expect(filterCounts([])).toEqual({ review: 0, ready: 0, conflicts: 0, stale: 0, hideDrafts: 0 });
  });

  test('toggleFilter returns a new set', () => {
    const a = set('ready');
    const b = toggleFilter(a, 'review');
    expect([...b].sort()).toEqual(['ready', 'review']);
    expect([...a]).toEqual(['ready']);
    expect([...toggleFilter(b, 'ready')]).toEqual(['review']);
  });
});

// ------------------------------------------------------------- DOM

const PRS: Record<number, RawPR> = {
  1: { ...READY, url: 'https://github.com/o/r/pull/1' },
  2: {
    url: 'https://github.com/o/r/pull/2',
    reviewRequests: { nodes: [{ requestedReviewer: { __typename: 'User', login: 'me' } }] },
    commits: commit(Date.now() - 10 * DAY, 'PENDING'),
  },
  3: { url: 'https://github.com/o/r/pull/3', isDraft: true, mergeable: 'CONFLICTING', commits: commit(Date.now(), 'FAILURE') },
};

type Msg = { type: string; variables?: Record<string, string | number> };

function fixture(numbers: number[]): HTMLUListElement {
  const row = (n: number): string => `
    <li>
      <div>
        <div data-listview-item-title-container="true">
          <h3><a data-testid="listitem-title-link" href="/o/r/pull/${n}">PR ${n}</a></h3>
        </div>
        <div><span data-testid="timestamp-container">x</span></div>
      </div>
    </li>`;
  document.body.innerHTML = `<main><ul data-listview-component="items-list">${numbers.map(row).join('')}</ul></main>`;
  return document.querySelector('ul')!;
}

async function settle(ms = 0): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  if (ms) await new Promise((r) => setTimeout(r, ms));
}

describe('quick filters on the page', () => {
  beforeEach(() => {
    (globalThis as unknown as { __resetChromeStorage: () => void }).__resetChromeStorage();
    chrome.runtime.sendMessage = jest.fn((msg: Msg) => {
      if (msg.type !== 'api:graphql') return Promise.resolve(undefined);
      const data: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(msg.variables ?? {})) {
        if (k.startsWith('n')) data[`pr${k.slice(1)}`] = PRS[v as number] ? { pullRequest: PRS[v as number] } : null;
      }
      return Promise.resolve({ ok: true, data });
    }) as unknown as typeof chrome.runtime.sendMessage;
  });

  function mount(numbers = [1, 2, 3]): { list: HTMLUListElement; ac: AbortController; c: PRListController } {
    const list = fixture(numbers);
    const ac = new AbortController();
    const c = new PRListController({
      signal: ac.signal,
      owner: 'o',
      repo: 'r',
      authenticated: true,
      noticeDismissed: false,
      viewer: 'me',
      withLabels: false,
      staleDays: 7,
    });
    c.scan();
    return { list, ac, c };
  }

  const chip = (f: QuickFilter): HTMLButtonElement => document.querySelector(`.bghub-prl-filter[data-filter="${f}"]`)!;
  const hidden = (list: HTMLUListElement): boolean[] => [...list.children].map((li) => li.hasAttribute(FILTERED_ATTR));

  test('ready / stale chips and the summary', async () => {
    const { list, ac } = mount();
    await settle();
    const slot = (n: number): string => list.querySelector(`[data-bghub-pr="o/r#${n}"]`)?.textContent ?? '';
    expect(slot(1)).toContain('Ready to merge');
    expect(slot(2)).toContain('Stale · 10d');
    expect(list.querySelector('[data-bghub-pr="o/r#2"] .bghub-prl-stale')?.getAttribute('aria-label')).toBe('No activity for 10 days');
    expect(slot(3)).not.toContain('Ready to merge');
    expect(document.querySelector('.bghub-prl-bar')?.textContent).toContain('1 ready to merge');
    ac.abort();
  });

  test('chips show live counts, toggle with aria-pressed and hide non-matching rows', async () => {
    const { list, ac, c } = mount();
    const bar = document.querySelector<HTMLElement>('.bghub-prl-filters')!;
    expect(bar.hidden).toBe(true); // nothing loaded yet
    await settle();
    expect(bar.hidden).toBe(false);
    expect(bar.getAttribute('role')).toBe('group');
    expect(chip('review').textContent).toContain('Needs my review1');
    expect(chip('review').textContent).toContain('on this page');
    expect(chip('ready').querySelector('.bghub-prl-filter-count')?.textContent).toBe('1');
    expect(chip('conflicts').querySelector('.bghub-prl-filter-count')?.textContent).toBe('1');
    expect(chip('stale').querySelector('.bghub-prl-filter-count')?.textContent).toBe('1');
    expect(bar.querySelector<HTMLAnchorElement>('.bghub-prl-filter-search')?.getAttribute('href')).toBe(
      '/o/r/pulls?q=is%3Apr%20is%3Aopen%20review-requested%3A%40me'
    );

    chip('review').click();
    expect(chip('review').getAttribute('aria-pressed')).toBe('true');
    expect([...c.activeFilters]).toEqual(['review']);
    expect(hidden(list)).toEqual([true, false, true]);
    expect(list.children[0].getAttribute('aria-hidden')).toBe('true');
    expect(list.children[1].hasAttribute('aria-hidden')).toBe(false);
    await settle(150); // fade-out done → removed from layout
    expect(list.children[0].getAttribute(FILTERED_ATTR)).toBe('');
    expect(bar.querySelector('[role="status"]')?.textContent).toBe('1 of 3 shown');

    chip('hideDrafts').click(); // AND: still PR 2 only
    expect(hidden(list)).toEqual([true, false, true]);
    chip('review').click();
    expect(hidden(list)).toEqual([false, false, true]); // only drafts hidden
    chip('hideDrafts').click();
    expect(hidden(list)).toEqual([false, false, false]);
    expect(list.children[2].hasAttribute('aria-hidden')).toBe(false);
    ac.abort();
  });

  test('nothing matches → one inline empty row with "Clear filters"', async () => {
    const { list, ac } = mount();
    await settle();
    chip('ready').click();
    chip('conflicts').click();
    const empty = document.querySelector<HTMLElement>('.bghub-prl-empty')!;
    expect(empty.hidden).toBe(false);
    expect(empty.textContent).toContain('No pull requests on this page match');
    expect(hidden(list)).toEqual([true, true, true]);

    empty.querySelector<HTMLButtonElement>('button')!.click();
    expect(empty.hidden).toBe(true);
    expect(hidden(list)).toEqual([false, false, false]);
    expect(chip('ready').getAttribute('aria-pressed')).toBe('false');
    expect(document.activeElement).toBe(chip('review'));
    ac.abort();
  });

  test('filters are per mount, and unmounting restores every row', async () => {
    const { list, ac } = mount();
    await settle();
    chip('ready').click();
    ac.abort();
    expect(hidden(list)).toEqual([false, false, false]);
    expect([...list.children].some((li) => li.hasAttribute('aria-hidden'))).toBe(false);
    expect(document.querySelector('.bghub-prl-filters')).toBeNull();

    const again = mount();
    await settle();
    expect(again.c.activeFilters.size).toBe(0);
    again.ac.abort();
  });

  test('the stale chip is hidden when stale detection is off', async () => {
    const list = fixture([1]);
    const ac = new AbortController();
    new PRListController({ signal: ac.signal, owner: 'o', repo: 'r', authenticated: true, noticeDismissed: false, viewer: 'me', withLabels: false, staleDays: 0 }).scan();
    await settle();
    expect(chip('stale').hidden).toBe(true);
    expect(list.querySelector('.bghub-prl-stale')).toBeNull();
    ac.abort();
  });
});
