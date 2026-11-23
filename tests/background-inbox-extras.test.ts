/**
 * @jest-environment node
 */
// Inbox readiness/staleness flags, snooze & pin, desktop notifications.

import type * as InboxModule from '../src/background/inbox';
import type * as NotifyModule from '../src/background/notify';
import type * as RouterModule from '../src/background/router';
import type * as StoreModule from '../src/background/store';
import type { Inbox, InboxItem } from '../src/core/messages';
import { DEFAULT_SETTINGS, type Settings } from '../src/core/settings';
import { nextSnoozeEnd, pinState, pruneMarks, snoozeState, toInbox, type InboxState } from '../src/background/inbox-model';
import {
  deliverable,
  diffNotifications,
  eventValue,
  inQuietHours,
  parseNotificationId,
  prNotificationId,
  type PendingNotification,
} from '../src/background/notify-model';
import { fakeIndexedDB } from './fake-indexeddb';

type Mods = { inbox: typeof InboxModule; notify: typeof NotifyModule; router: typeof RouterModule; store: typeof StoreModule };

function load(): Mods {
  let mods!: Mods;
  jest.isolateModules(() => {
    mods = {
      inbox: require('../src/background/inbox'),
      notify: require('../src/background/notify'),
      router: require('../src/background/router'),
      store: require('../src/background/store'),
    };
  });
  return mods;
}

const TOKEN = `ghp_${'a'.repeat(36)}`;
const NOW = '2026-11-23T12:00:00.000Z';
const url = (n: number) => `https://github.com/o/r/pull/${n}`;
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

function item(n: number, over: Partial<InboxItem> = {}): InboxItem {
  return {
    url: url(n), repo: 'o/r', number: n, title: `PR ${n}`, author: 'me', authorAvatarUrl: null, isDraft: false,
    updatedAt: NOW, reasons: ['authored'], reviewDecision: null, checks: null, unresolvedThreads: 0,
    additions: 0, deletions: 0, hasConflicts: false, reviewRequestedAt: null, lastActivity: null, unseen: false,
    ...over,
  };
}

// --- pure: enrichment, snooze, pin ---------------------------------------------------

describe('inbox enrichment, snooze and pin (pure)', () => {
  const nowMs = Date.parse(NOW);

  test('ready / stale / snoozed / pinned flags; snoozed items leave unseenCount', () => {
    const state: InboxState = {
      fetchedAt: 1,
      seen: {},
      items: [
        item(1, { reviewDecision: 'APPROVED', checks: 'SUCCESS', updatedAt: iso(nowMs - 10 * DAY) }),
        item(2, { reviewDecision: 'APPROVED', checks: 'SUCCESS', isDraft: true, unseen: true }),
        item(3, { unseen: true, lastActivity: { kind: 'comment', actor: 'bob', at: iso(nowMs - 2 * DAY) }, updatedAt: iso(nowMs - 20 * DAY) }),
      ],
      snoozes: { [url(2)]: { until: iso(nowMs + DAY), at: NOW, prevSeen: null }, [url(3)]: { until: iso(nowMs - 1), at: NOW, prevSeen: null } },
      pins: { [url(3)]: { at: NOW, lastInInbox: NOW } },
    };
    const inbox = toInbox(state, { staleDays: 7, now: nowMs });
    expect(inbox.items.map((i) => [i.ready, i.stale, i.snoozedUntil, i.pinned])).toEqual([
      [true, true, null, false],
      [false, false, iso(nowMs + DAY), false],
      [false, false, null, true], // stale uses lastActivity (2 days) before updatedAt; snooze ended
    ]);
    expect(inbox.unseenCount).toBe(1);
    expect(toInbox(state, { staleDays: 0, now: nowMs }).items[0].stale).toBe(false);
  });

  test('snoozing counts as a look; extending keeps the start; early un-snooze restores the old seen time', () => {
    const base: InboxState = { fetchedAt: 1, seen: { [url(1)]: '2026-11-20T00:00:00.000Z' }, items: [item(1, { reasons: ['review-requested'], unseen: true })] };
    const snoozed = snoozeState(base, url(1), iso(Date.parse(NOW) + DAY), NOW);
    expect(snoozed.seen[url(1)]).toBe(NOW);
    expect(snoozed.items[0].unseen).toBe(false);
    const extended = snoozeState(snoozed, url(1), iso(Date.parse(NOW) + 3 * DAY), '2026-11-23T13:00:00.000Z');
    expect(extended.snoozes?.[url(1)]).toMatchObject({ at: NOW, prevSeen: '2026-11-20T00:00:00.000Z', until: iso(Date.parse(NOW) + 3 * DAY) });
    const undone = snoozeState(extended, url(1), null, '2026-11-23T14:00:00.000Z');
    expect(undone.snoozes).toEqual({});
    expect(undone.seen[url(1)]).toBe('2026-11-20T00:00:00.000Z');
    // Capped at a year.
    const far = snoozeState(base, url(1), '2099-01-01T00:00:00.000Z', NOW).snoozes?.[url(1)].until ?? '';
    expect(Date.parse(far) - Date.parse(NOW)).toBeLessThanOrEqual(366 * DAY);
  });

  test('pins survive while the PR is in the inbox and are pruned 30 days after it left; ended snoozes are pruned', () => {
    let state: InboxState = { fetchedAt: 1, seen: {}, items: [item(1)] };
    state = pinState(pinState(state, url(1), true, NOW), url(9), true, NOW);
    state = { ...state, snoozes: { [url(1)]: { until: iso(Date.parse(NOW) + 1000), at: NOW, prevSeen: null } } };
    expect(nextSnoozeEnd(state, Date.parse(NOW))).toBe(Date.parse(NOW) + 1000);
    const later = pruneMarks(state, iso(Date.parse(NOW) + 31 * DAY));
    expect(Object.keys(later.pins ?? {})).toEqual([url(1)]); // #9 never came back
    expect(later.pins?.[url(1)].lastInInbox).toBe(iso(Date.parse(NOW) + 31 * DAY));
    expect(later.snoozes).toEqual({});
    expect(nextSnoozeEnd(later, Date.parse(NOW))).toBeNull();
    expect(pinState(later, url(1), false, NOW).pins).toEqual({});
  });
});

// --- pure: notification rules ------------------------------------------------------

describe('notification rules (pure)', () => {
  const settings = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...over }) as Settings;
  const diff = (prev: InboxItem[] | null, next: InboxItem[], notified = {}, baseline = false, snoozed: string[] = []) =>
    diffNotifications(prev, next, notified, { baseline, nowIso: NOW, snoozed: (k) => snoozed.includes(k) });

  test('each event type fires on its transition', () => {
    const prev = [item(1, { reviewDecision: 'REVIEW_REQUIRED', checks: 'PENDING' }), item(2, { checks: 'SUCCESS' }), item(3, { reviewDecision: 'REVIEW_REQUIRED' })];
    const next = [
      item(1, { reviewDecision: 'CHANGES_REQUESTED', checks: 'PENDING' }),
      item(2, { checks: 'ERROR' }),
      item(3, { reviewDecision: 'APPROVED' }),
      item(4, { reasons: ['review-requested'], author: 'bob', reviewRequestedAt: NOW }),
    ];
    expect(diff(prev, next).events.map((e) => [e.item.number, e.event])).toEqual([
      [1, 'changes-requested'],
      [2, 'checks-failed'],
      [3, 'approved'],
      [4, 'review-requested'],
    ]);
    // Only for the user's own PRs (except review requests).
    expect(eventValue(item(5, { reasons: ['assigned'], reviewDecision: 'APPROVED', checks: 'FAILURE' }), 'checks-failed')).toBeNull();
    // FAILURE → ERROR is not a new failure.
    expect(diff([item(2, { checks: 'FAILURE' })], [item(2, { checks: 'ERROR' })]).events).toEqual([]);
  });

  test('baseline records without notifying; the record dedupes churn and is reset when the condition clears', () => {
    const rr = item(4, { reasons: ['review-requested'], reviewRequestedAt: NOW });
    const base = diff(null, [rr], {}, true);
    expect(base.events).toEqual([]);
    // The PR drops out of the top 25 and comes back: no repeat.
    const gone = diff([rr], [], base.notified);
    expect(diff([], [rr], gone.notified).events).toEqual([]);
    // Checks: fail → recover → fail again fires twice.
    const fail = item(2, { checks: 'FAILURE' });
    const ok = item(2, { checks: 'SUCCESS' });
    const first = diff([ok], [fail]);
    expect(first.events).toHaveLength(1);
    const recovered = diff([fail], [ok], first.notified);
    expect(diff([ok], [fail], recovered.notified).events).toHaveLength(1);
    // A re-request (new request time) is a new review request.
    const again = item(4, { reasons: ['review-requested'], reviewRequestedAt: '2026-11-24T09:00:00.000Z' });
    expect(diff([rr], [again], base.notified).events.map((e) => e.event)).toEqual(['review-requested']);
  });

  test('snoozed PRs are recorded but not notified', () => {
    const out = diff([item(2, { checks: 'SUCCESS' })], [item(2, { checks: 'FAILURE' })], {}, false, [url(2)]);
    expect(out.events).toEqual([]);
    expect(Object.keys(out.notified)).toEqual([`${url(2)} checks-failed`]);
  });

  test('quiet hours: same-day and across midnight; start === end never', () => {
    const at = (h: number, m = 0) => new Date(2026, 10, 23, h, m);
    expect(inQuietHours('12:00', '14:00', at(13))).toBe(true);
    expect(inQuietHours('12:00', '14:00', at(14))).toBe(false);
    expect(inQuietHours('22:00', '08:00', at(23, 30))).toBe(true);
    expect(inQuietHours('22:00', '08:00', at(3))).toBe(true);
    expect(inQuietHours('22:00', '08:00', at(8))).toBe(false);
    expect(inQuietHours('22:00', '08:00', at(12))).toBe(false);
    expect(inQuietHours('09:00', '09:00', at(9))).toBe(false);
    expect(inQuietHours('bad', '08:00', at(3))).toBe(false);
  });

  test('deliverable: master switch, per-type switches, quiet hours', () => {
    const events: PendingNotification[] = [
      { event: 'review-requested', item: item(1) },
      { event: 'approved', item: item(2) },
    ];
    const noon = new Date(2026, 10, 23, 12, 0);
    expect(deliverable(events, settings(), noon).map((e) => e.event)).toEqual(['review-requested']); // approved is off by default
    expect(deliverable(events, settings({ notifyApproved: true }), noon)).toHaveLength(2);
    expect(deliverable(events, settings({ desktopNotifications: false }), noon)).toEqual([]);
    expect(deliverable(events, settings({ quietHoursEnabled: true, quietHoursStart: '11:00', quietHoursEnd: '13:00' }), noon)).toEqual([]);
  });

  test('notification ids encode the PR url', () => {
    expect(parseNotificationId(prNotificationId(url(5), 'review-requested'))).toEqual({ kind: 'pr', url: url(5) });
    expect(parseNotificationId('bghub:summary:123')).toEqual({ kind: 'summary' });
    expect(parseNotificationId('bghub:pr:https://evil.example/x')).toBeNull();
    expect(parseNotificationId('other')).toBeNull();
  });
});

// --- integration ---------------------------------------------------------------------

type RawPR = Record<string, unknown>;
const world: { authored: RawPR[]; reviewRequested: RawPR[]; assigned: RawPR[] } = { authored: [], reviewRequested: [], assigned: [] };
const locales: Record<string, unknown> = {};
const fetchMock = jest.fn();
const notifications = {
  create: jest.fn((id: string, _opts: chrome.notifications.NotificationOptions) => Promise.resolve(id)),
  clear: jest.fn((_id: string) => Promise.resolve(true)),
  onClicked: { addListener: () => undefined },
};

function raw(n: number, o: { author?: string; decision?: string; checks?: string; comment?: [string, string]; review?: [string, string]; requestedAt?: string; title?: string; updatedAt?: string } = {}): RawPR {
  return {
    url: url(n),
    number: n,
    title: o.title ?? `PR ${n}`,
    updatedAt: o.updatedAt ?? NOW,
    repository: { nameWithOwner: 'o/r' },
    author: { login: o.author ?? 'me' },
    reviewDecision: o.decision ?? null,
    commits: o.checks ? { nodes: [{ commit: { committedDate: '2026-11-19T00:00:00Z', author: { user: { login: 'me' } }, statusCheckRollup: { state: o.checks } } }] } : undefined,
    comments: o.comment ? { nodes: [{ author: { login: o.comment[0] }, createdAt: o.comment[1] }] } : undefined,
    reviews: o.review ? { nodes: [{ author: { login: o.review[0] }, submittedAt: o.review[1] }] } : undefined,
    timelineItems: o.requestedAt ? { nodes: [{ createdAt: o.requestedAt, requestedReviewer: { __typename: 'User', login: 'me' } }] } : undefined,
  };
}

function respond(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'x-ratelimit-resource': 'graphql', 'x-ratelimit-remaining': '4999', 'x-ratelimit-limit': '5000', ...headers } });
}

const g = globalThis as unknown as { indexedDB?: unknown; fetch: unknown; __resetChromeStorage: () => void };
const chromeAny = chrome as unknown as { notifications?: unknown };

beforeEach(async () => {
  g.__resetChromeStorage();
  g.indexedDB = fakeIndexedDB().factory; // token ids survive a simulated worker restart
  world.authored = [];
  world.reviewRequested = [];
  world.assigned = [];
  for (const k of Object.keys(locales)) delete locales[k];
  notifications.create.mockClear();
  notifications.clear.mockClear();
  chromeAny.notifications = notifications;
  fetchMock.mockReset();
  fetchMock.mockImplementation((u: string) => {
    if (u.startsWith('_locales/')) return Promise.resolve(locales[u] ? new Response(JSON.stringify(locales[u])) : new Response('', { status: 404 }));
    if (u.endsWith('/graphql')) {
      return Promise.resolve(
        respond(200, {
          data: { viewer: { login: 'me' }, authored: { nodes: world.authored }, reviewRequested: { nodes: world.reviewRequested }, assigned: { nodes: world.assigned } },
        })
      );
    }
    return Promise.resolve(respond(404, { message: 'Not Found' }));
  });
  g.fetch = fetchMock;
  await chrome.storage.local.set({ githubToken: TOKEN }); // migrated into the (fake) IndexedDB list
});

afterAll(() => {
  delete g.indexedDB;
  delete chromeAny.notifications;
});

async function setSettings(m: Mods, patch: Partial<Settings>): Promise<void> {
  await chrome.storage.local.set(patch);
  m.store.invalidateSettings();
}

const refresh = (m: Mods): Promise<Inbox> => m.inbox.refreshInbox();
const created = () => notifications.create.mock.calls.map(([id, o]) => ({ id, ...o }));
const stored = async () => (await chrome.storage.local.get('inboxState')).inboxState as InboxState;

describe('inbox flags (integration)', () => {
  test('ready / stale come with the inbox; a staleDays change applies without a refetch', async () => {
    const m = load();
    world.authored = [raw(1, { decision: 'APPROVED', checks: 'SUCCESS', updatedAt: '2026-01-01T00:00:00Z' }), raw(2, { checks: 'FAILURE', updatedAt: new Date().toISOString() })];
    const inbox = await m.inbox.getInbox(true);
    expect(inbox.items.map((i) => [i.number, i.ready, i.stale, i.pinned, i.snoozedUntil])).toEqual([
      [2, false, false, false, null],
      [1, true, true, false, null],
    ]);
    const calls = fetchMock.mock.calls.length;
    await setSettings(m, { staleDays: 0 });
    expect((await m.inbox.getInbox()).items.map((i) => i.stale)).toEqual([false, false]);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });
});

describe('snooze and pin (integration)', () => {
  test('a snoozed PR leaves the badge; when the snooze ends it is unseen only if someone acted meanwhile', async () => {
    const m = load();
    world.reviewRequested = [raw(2, { author: 'bob' }), raw(3, { author: 'bob' })];
    const badge = jest.spyOn(chrome.action, 'setBadgeText');
    const alarm = jest.spyOn(chrome.alarms, 'create');
    expect((await refresh(m)).unseenCount).toBe(2);
    expect(badge).toHaveBeenLastCalledWith({ text: '2' });

    const until = new Date(Date.now() + 3600_000).toISOString();
    await m.inbox.snooze(url(2), until);
    const snoozed = await m.inbox.snooze(url(3), until);
    expect(snoozed.unseenCount).toBe(0);
    expect(snoozed.items.map((i) => i.snoozedUntil)).toEqual([until, until]);
    expect(badge).toHaveBeenLastCalledWith({ text: '' });
    expect(alarm).toHaveBeenLastCalledWith('inbox:snooze-end', { when: Date.parse(until) + 1000 });

    // Activity on #2 while snoozed: still hidden from the badge.
    world.reviewRequested = [raw(2, { author: 'bob', comment: ['carol', new Date(Date.now() + 1000).toISOString()] }), raw(3, { author: 'bob' })];
    expect((await refresh(m)).unseenCount).toBe(0);

    // Time passes: the snooze alarm fires.
    const state = await stored();
    for (const s of Object.values(state.snoozes ?? {})) s.until = new Date(Date.now() - 1).toISOString();
    await chrome.storage.local.set({ inboxState: state });
    await m.inbox.onSnoozeAlarm();
    expect(badge).toHaveBeenLastCalledWith({ text: '1' });
    const after = await m.inbox.getInbox();
    expect(after.items.map((i) => [i.number, i.unseen, i.snoozedUntil])).toEqual([
      [2, true, null],
      [3, false, null],
    ]);
    expect((await stored()).snoozes).toEqual({});
    badge.mockRestore();
    alarm.mockRestore();
  });

  test('un-snoozing early brings back the previous unseen state', async () => {
    const m = load();
    world.reviewRequested = [raw(2, { author: 'bob' })];
    await refresh(m);
    expect((await m.inbox.snooze(url(2), new Date(Date.now() + 3600_000).toISOString())).unseenCount).toBe(0);
    expect((await m.inbox.snooze(url(2), null)).unseenCount).toBe(1);
  });

  test('pins persist across refreshes and via the router; invalid requests are rejected', async () => {
    const m = load();
    world.authored = [raw(1), raw(4)];
    await refresh(m);
    const content = { id: 'test-extension-id', url: 'https://github.com/', tab: { id: 1 } as chrome.tabs.Tab };
    const pinned = await new Promise<Inbox>((resolve) => m.router.onMessage({ type: 'inbox:pin', url: 'https://github.com/O/R/pull/4', pinned: true }, content, (r) => resolve(r as Inbox)));
    expect(pinned.items.find((i) => i.number === 4)?.pinned).toBe(true);
    expect((await refresh(m)).items.map((i) => [i.number, i.pinned])).toEqual([
      [1, false],
      [4, true],
    ]);
    expect((await m.inbox.pin(url(4), false)).items.every((i) => !i.pinned)).toBe(true);
    expect(await m.inbox.pin('https://github.com/o/r/issues/1', true)).toMatchObject({ error: 'invalid-request' });
    expect(await m.inbox.snooze(url(4), 'tomorrow')).toMatchObject({ error: 'invalid-request' });
  });
});

describe('desktop notifications (integration)', () => {
  test('first refresh is a baseline; later transitions notify once each, with title, message, actor and icon', async () => {
    const m = load();
    world.authored = [raw(1, { decision: 'REVIEW_REQUIRED' }), raw(6, { checks: 'SUCCESS' })];
    world.reviewRequested = [raw(7, { author: 'dave', requestedAt: '2026-11-20T00:00:00Z' })];
    await refresh(m);
    expect(notifications.create).not.toHaveBeenCalled();

    world.authored = [raw(1, { decision: 'CHANGES_REQUESTED', review: ['carol', NOW] }), raw(6, { checks: 'FAILURE' })];
    world.reviewRequested = [raw(7, { author: 'dave', requestedAt: '2026-11-20T00:00:00Z' }), raw(5, { author: 'bob', requestedAt: NOW, title: 'Add caching' })];
    await refresh(m);
    expect(created()).toEqual([
      { id: `bghub:pr:${url(5)}#review-requested`, type: 'basic', iconUrl: 'icons/icon128.png', title: 'Review requested · o/r#5', message: 'Add caching', contextMessage: '@bob' },
      { id: `bghub:pr:${url(1)}#changes-requested`, type: 'basic', iconUrl: 'icons/icon128.png', title: 'Changes requested · o/r#1', message: 'PR 1', contextMessage: '@carol' },
      { id: `bghub:pr:${url(6)}#checks-failed`, type: 'basic', iconUrl: 'icons/icon128.png', title: 'Checks failed · o/r#6', message: 'PR 6' },
    ]);

    // Same data again, and after a worker restart: nothing new.
    notifications.create.mockClear();
    await refresh(m);
    const restarted = load();
    await refresh(restarted);
    // Churn: #5 drops out of the results and comes back.
    world.reviewRequested = [raw(7, { author: 'dave', requestedAt: '2026-11-20T00:00:00Z' })];
    await refresh(restarted);
    world.reviewRequested = [raw(7, { author: 'dave', requestedAt: '2026-11-20T00:00:00Z' }), raw(5, { author: 'bob', requestedAt: NOW })];
    await refresh(restarted);
    expect(notifications.create).not.toHaveBeenCalled();

    // Approvals are opt-in.
    world.authored = [raw(1, { decision: 'APPROVED', review: ['carol', NOW] }), raw(6, { checks: 'FAILURE' })];
    await refresh(restarted);
    expect(notifications.create).not.toHaveBeenCalled();
    await setSettings(restarted, { notifyApproved: true });
    world.authored = [raw(1, { decision: 'CHANGES_REQUESTED', review: ['carol', NOW] }), raw(6, { checks: 'FAILURE' })];
    await refresh(restarted); // → changes requested (fires)
    world.authored = [raw(1, { decision: 'APPROVED', review: ['erin', NOW] }), raw(6, { checks: 'FAILURE' })];
    await refresh(restarted);
    expect(created().map((c) => c.title)).toEqual(['Changes requested · o/r#1', 'Approved · o/r#1']);
  });

  test('snoozed PRs, the master switch and quiet hours drop events (not queued)', async () => {
    const m = load();
    world.authored = [raw(6, { checks: 'SUCCESS' }), raw(8, { checks: 'SUCCESS' }), raw(9, { checks: 'SUCCESS' })];
    await refresh(m);
    await m.inbox.snooze(url(6), new Date(Date.now() + 3600_000).toISOString());

    world.authored = [raw(6, { checks: 'FAILURE' }), raw(8, { checks: 'SUCCESS' }), raw(9, { checks: 'SUCCESS' })];
    await refresh(m); // snoozed
    await setSettings(m, { desktopNotifications: false });
    world.authored = [raw(6, { checks: 'FAILURE' }), raw(8, { checks: 'FAILURE' }), raw(9, { checks: 'SUCCESS' })];
    await refresh(m); // master off

    const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    await setSettings(m, {
      desktopNotifications: true,
      quietHoursEnabled: true,
      quietHoursStart: hhmm(new Date(Date.now() - 3600_000)),
      quietHoursEnd: hhmm(new Date(Date.now() + 3600_000)),
    });
    world.authored = [raw(6, { checks: 'FAILURE' }), raw(8, { checks: 'FAILURE' }), raw(9, { checks: 'ERROR' })];
    await refresh(m); // quiet hours (may cross midnight)
    await setSettings(m, { quietHoursEnabled: false });
    await refresh(m); // nothing was queued
    expect(notifications.create).not.toHaveBeenCalled();
  });

  test('more than 3 events → one summary notification (localized when the locale has it)', async () => {
    const m = load();
    await refresh(m);
    world.reviewRequested = [1, 2, 3, 4].map((n) => raw(n, { author: 'bob', requestedAt: NOW }));
    await refresh(m);
    expect(created()).toEqual([
      { id: expect.stringMatching(/^bghub:summary:\d+$/), type: 'basic', iconUrl: 'icons/icon128.png', title: 'Better GHub', message: '4 updates in your pull requests' },
    ]);

    notifications.create.mockClear();
    locales['_locales/pl/messages.json'] = { notifyReviewRequestedTitle: { message: 'Prośba o review · $1' } };
    await setSettings(m, { language: 'pl' });
    world.reviewRequested.push(raw(10, { author: 'bob', requestedAt: NOW }));
    await refresh(m);
    expect(created().map((c) => c.title)).toEqual(['Prośba o review · o/r#10']);
  });

  test('clicking focuses an open tab of the PR (or opens one), marks it seen and dismisses the notification', async () => {
    const m = load();
    await refresh(m);
    world.reviewRequested = [raw(5, { author: 'bob', requestedAt: new Date(Date.now() - 60_000).toISOString() })];
    await refresh(m);
    const id = String(notifications.create.mock.calls[0][0]);
    expect((await m.inbox.getInbox()).unseenCount).toBe(1);

    const query = jest.spyOn(chrome.tabs, 'query').mockResolvedValue([
      { id: 3, windowId: 1, url: 'https://github.com/o/r/pull/50' } as chrome.tabs.Tab,
      { id: 7, windowId: 2, url: 'https://github.com/O/R/pull/5/files' } as chrome.tabs.Tab,
    ]);
    const update = jest.spyOn(chrome.tabs, 'update');
    const focus = jest.spyOn(chrome.windows, 'update');
    const create = jest.spyOn(chrome.tabs, 'create');
    await m.notify.onNotificationClicked(id);
    expect(update).toHaveBeenCalledWith(7, { active: true });
    expect(focus).toHaveBeenCalledWith(2, { focused: true });
    expect(create).not.toHaveBeenCalled();
    expect(notifications.clear).toHaveBeenCalledWith(id);
    expect((await m.inbox.getInbox()).unseenCount).toBe(0);

    query.mockResolvedValue([]);
    await m.notify.onNotificationClicked(id);
    expect(create).toHaveBeenLastCalledWith({ url: url(5) });
    await m.notify.onNotificationClicked('bghub:summary:1');
    expect(create).toHaveBeenLastCalledWith({ url: 'https://github.com/pulls' });
    create.mockClear();
    await m.notify.onNotificationClicked('someone-else');
    expect(create).not.toHaveBeenCalled();
    for (const s of [query, update, focus, create]) s.mockRestore();
  });
});
