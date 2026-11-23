// Popup inbox: pinned / snoozed grouping (pure) and the row actions menu with
// optimistic updates (jsdom).

import type { Inbox, InboxItem } from '../src/core/messages';
import { normalizeInboxItem } from '../src/pages/bg';
import { groupInbox, isSnoozed, itemStatuses, snoozedItems, sortItems, withPin, withSnooze } from '../src/pages/inbox';
import { InboxView, type InboxViewHandlers } from '../popup/inbox-view';

const NOW = Date.parse('2026-11-23T10:00:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const iso = (ms: number): string => new Date(ms).toISOString();
const flush = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

function pr(n: number, over: Partial<InboxItem> = {}): InboxItem {
  return {
    url: `https://github.com/o/r/pull/${n}`,
    repo: 'o/r',
    number: n,
    title: `Title ${n}`,
    author: 'mona',
    authorAvatarUrl: null,
    isDraft: false,
    updatedAt: iso(NOW - n * HOUR),
    reasons: ['review-requested'],
    reviewDecision: null,
    checks: null,
    unresolvedThreads: 0,
    additions: 1,
    deletions: 1,
    hasConflicts: false,
    unseen: false,
    ...over,
  };
}

describe('inbox model: pinned and snoozed', () => {
  test('pinned items float to the top of their tab, before unseen ones', () => {
    const items = [pr(1, { unseen: true }), pr(2), pr(3, { pinned: true }), pr(4, { pinned: true, unseen: true })];
    expect(sortItems(items).map((i) => i.number)).toEqual([4, 3, 1, 2]);
  });

  test('snoozed items leave the tabs until their time comes', () => {
    const items = [
      pr(1, { snoozedUntil: iso(NOW + HOUR) }),
      pr(2, { snoozedUntil: iso(NOW - HOUR) }), // expired: back in the tab
      pr(3, { reasons: ['authored'], snoozedUntil: iso(NOW + DAY) }),
      pr(4),
    ];
    const groups = groupInbox(items, NOW);
    expect(groups.review.map((i) => i.number)).toEqual([2, 4]);
    expect(groups.authored).toEqual([]);
    expect(snoozedItems(items, NOW).map((i) => i.number)).toEqual([1, 3]); // soonest first
    expect(isSnoozed(items[0], NOW)).toBe(true);
    expect(isSnoozed(items[1], NOW)).toBe(false);
    expect(isSnoozed(pr(5, { snoozedUntil: 'garbage' }), NOW)).toBe(false);
  });

  test('optimistic helpers return new arrays and touch only the target', () => {
    const items = [pr(1), pr(2)];
    const pinned = withPin(items, items[1].url, true);
    expect(pinned).not.toBe(items);
    expect(pinned[1].pinned).toBe(true);
    expect(pinned[0]).toBe(items[0]);
    const snoozed = withSnooze(items, items[0].url, iso(NOW + HOUR));
    expect(snoozed[0].snoozedUntil).toBe(iso(NOW + HOUR));
    expect(withSnooze(snoozed, items[0].url, null)[0].snoozedUntil).toBeNull();
  });

  test('ready and stale badges', () => {
    const ready = itemStatuses(pr(1, { ready: true, reviewDecision: 'APPROVED', checks: 'SUCCESS' }), 'authored', NOW);
    expect(ready.map((s) => s.id)).toEqual(['ready', 'checks']); // "Approved" folds into "Ready to merge"
    expect(ready[0].text).toBe('Ready to merge');

    const stale = itemStatuses(pr(2, { stale: true, lastActivity: { kind: 'comment', actor: 'x', at: iso(NOW - 9 * DAY - HOUR) } }), 'review', NOW);
    const chip = stale.find((s) => s.id === 'stale');
    expect(chip?.text).toBe('Stale 9d');
    expect(chip?.label).toBe('No activity for 9 days');
    expect(itemStatuses(pr(3), 'review', NOW).some((s) => s.id === 'stale' || s.id === 'ready')).toBe(false);
  });

  test('normalizeInboxItem keeps the new fields', () => {
    const item = normalizeInboxItem({ ...pr(1), ready: true, stale: 'yes', pinned: true, snoozedUntil: iso(NOW + HOUR) });
    expect(item).toMatchObject({ ready: true, stale: false, pinned: true, snoozedUntil: iso(NOW + HOUR) });
    expect(normalizeInboxItem({ ...pr(1), snoozedUntil: 'soon' })?.snoozedUntil).toBeNull();
  });
});

describe('row actions menu', () => {
  let handlers: jest.Mocked<InboxViewHandlers>;
  let view: InboxView;

  function inbox(items: InboxItem[]): Inbox {
    return { items, unseenCount: 0, fetchedAt: Date.now() };
  }

  function mount(items: InboxItem[]): void {
    handlers = {
      onOpen: jest.fn(),
      onMarkAllSeen: jest.fn(),
      onRetry: jest.fn(),
      onTabChange: jest.fn(),
      pin: jest.fn(),
      snooze: jest.fn(),
    };
    view = new InboxView(handlers, 'review');
    document.body.append(view.el);
    view.setInbox(inbox(items));
  }

  const kebab = (n: number): HTMLButtonElement =>
    [...document.querySelectorAll<HTMLButtonElement>('.pr-actions')].find((b) => b.dataset.url?.endsWith(`/${n}`))!;
  const menuItems = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>('.menu [role="menuitem"]')];
  const rowNumbers = (): number[] =>
    [...document.querySelectorAll<HTMLElement>('.pr-list .pr-row')].map((r) => Number(r.dataset.url?.split('/').pop()));
  const key = (el: Element, k: string, init: KeyboardEventInit = {}): void => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
  };

  afterEach(() => {
    view.destroy();
    document.body.replaceChildren();
  });

  test('menu button semantics and keyboard: arrows, Home/End, Esc returns focus', () => {
    mount([pr(1), pr(2)]);
    const btn = kebab(2);
    expect(btn.getAttribute('aria-haspopup')).toBe('menu');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.getAttribute('aria-label')).toBe('Actions for o/r#2');

    btn.click();
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(btn.getAttribute('aria-controls')).toBe(menu.id);
    expect(menuItems().map((b) => b.textContent)).toEqual([
      'Pin to top',
      'Snooze for 1 hour',
      'Snooze until tomorrow 9:00',
      'Snooze until Monday 9:00',
    ]);
    expect(document.activeElement).toBe(menuItems()[0]);
    key(menu, 'ArrowDown');
    expect(document.activeElement).toBe(menuItems()[1]);
    key(menu, 'ArrowUp');
    key(menu, 'ArrowUp'); // wraps
    expect(document.activeElement).toBe(menuItems()[3]);
    key(menu, 'Home');
    expect(document.activeElement).toBe(menuItems()[0]);
    key(menu, 'End');
    expect(document.activeElement).toBe(menuItems()[3]);
    key(menu, 'Escape');
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(btn);

    // ArrowUp on the button opens with the last item focused.
    key(btn, 'ArrowUp');
    expect(document.activeElement).toBe(menuItems()[3]);
    key(document.querySelector('[role="menu"]')!, 'Tab');
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  test('pin: optimistic move to the top, then the fresh inbox', async () => {
    mount([pr(1), pr(2), pr(3)]);
    let resolve: (v: Inbox | null) => void = () => undefined;
    handlers.pin.mockImplementation(() => new Promise((r) => (resolve = r)));
    kebab(3).click();
    menuItems()[0].click();

    expect(handlers.pin).toHaveBeenCalledWith('https://github.com/o/r/pull/3', true);
    expect(rowNumbers()).toEqual([3, 1, 2]); // before the background answered
    expect(document.querySelector('.pr-item.is-pinned .pr-pin')).not.toBeNull();
    expect(document.activeElement).toBe(kebab(3));

    resolve(inbox([pr(1), pr(2), pr(3, { pinned: true })]));
    await flush(20);
    expect(rowNumbers()).toEqual([3, 1, 2]);
    expect(document.getElementById('bghub-announcer')?.textContent).toBe('Pinned to the top');
  });

  test('a failed action rolls back and says so', async () => {
    mount([pr(1), pr(2)]);
    handlers.pin.mockResolvedValue(null);
    kebab(2).click();
    menuItems()[0].click();
    expect(rowNumbers()).toEqual([2, 1]);
    await flush();
    expect(rowNumbers()).toEqual([1, 2]);
    expect(document.querySelector('.toast')?.textContent).toMatch(/Couldn’t update the pin/);
  });

  test('snooze hides the row, lists it under "Snoozed (n)" and can be undone', async () => {
    mount([pr(1), pr(2), pr(3)]);
    handlers.snooze.mockImplementation((url, until) =>
      Promise.resolve(inbox([pr(1), pr(2, { snoozedUntil: url.endsWith('/2') ? until : null }), pr(3)]))
    );
    kebab(2).click();
    menuItems()[1].click(); // 1 hour
    const [url, until] = handlers.snooze.mock.calls[0];
    expect(url).toBe('https://github.com/o/r/pull/2');
    expect(Date.parse(until!) - Date.now()).toBeGreaterThan(59 * 60_000);
    expect(rowNumbers()).toEqual([1, 3]);
    // Focus moves to the row that took its place.
    expect((document.activeElement as HTMLElement).dataset.url).toBe('https://github.com/o/r/pull/3');

    await flush(20);
    const section = document.querySelector<HTMLDetailsElement>('.inbox-snoozed')!;
    expect(section.querySelector('summary')?.textContent).toBe('Snoozed (1)');
    expect(section.querySelector('.snoozed-until')?.textContent).toMatch(/^until /);
    expect(document.getElementById('bghub-announcer')?.textContent).toMatch(/^Snoozed until /);
    expect(document.querySelector('.inbox-tab[data-tab="review"] .counter')?.textContent).toBe('2');

    handlers.snooze.mockResolvedValue(inbox([pr(1), pr(2), pr(3)]));
    section.open = true;
    section.querySelector<HTMLButtonElement>('.snoozed-wake')!.click();
    expect(handlers.snooze).toHaveBeenLastCalledWith('https://github.com/o/r/pull/2', null);
    expect(rowNumbers()).toEqual([1, 2, 3]);
    expect(document.querySelector('.inbox-snoozed')).toBeNull();
    expect((document.activeElement as HTMLElement).dataset.url).toBe('https://github.com/o/r/pull/2');
  });

  test('Shift+F10 on a row opens its actions', () => {
    mount([pr(1)]);
    const row = document.querySelector<HTMLElement>('.pr-row')!;
    row.focus();
    key(row, 'F10', { shiftKey: true });
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    expect(kebab(1).getAttribute('aria-expanded')).toBe('true');
    key(document.querySelector('[role="menu"]')!, 'Escape');
  });
});
