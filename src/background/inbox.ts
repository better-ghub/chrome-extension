// Better GHub - Inbox (PRs that involve the user) + toolbar badge.
// The background is the ONLY writer of INBOX_STATE_KEY; popup, options and
// the dashboard widget read it through 'inbox:get'.
//
// Every read-modify-write of INBOX_STATE_KEY (fetch-save, markSeen, snooze,
// pin, expire, clear) runs through one promise queue, so a markSeen landing
// while a refresh waits for GitHub is never overwritten by the refresh's stale
// copy. The slow GraphQL request itself runs outside the queue.

import type { ApiResult, Inbox, InboxItem } from '../core/messages';
import { INBOX_STATE_KEY } from '../core/settings';
import { githubGraphQL } from './http';
import {
  activeSnooze,
  applySeen,
  INBOX_QUERY,
  INBOX_VARIABLES,
  markSeenState,
  mergeInboxItems,
  mergeSeen,
  nextSnoozeEnd,
  normalizePrUrl,
  parseInbox,
  pinState,
  pruneMarks,
  snoozeState,
  toInbox,
  type InboxState,
  type RawInboxData,
} from './inbox-model';
import { authGeneration, bgSettings, getToken } from './store';
import { scheduleTokenCheck } from './auth-check';
import { diffNotifications, type PendingNotification } from './notify-model';
import { deliverNotifications } from './notify';
import { usableTokens } from './token-model';
import { listTokens } from './tokens';

const BADGE_COLOR = '#8250df';
/** Upper bound on urls per 'inbox:markSeen' (content scripts send one). */
const MAX_MARK_URLS = 100;
const NEEDS_AUTH: Inbox = { items: [], unseenCount: 0, fetchedAt: 0, needsAuth: true };
/** One-shot alarm at the earliest snooze end (the badge must change then). */
export const ALARM_SNOOZE = 'inbox:snooze-end';

let refreshing: Promise<Inbox> | null = null;
let queue: Promise<unknown> = Promise.resolve();

/** Run `fn` after every previously queued inbox-state mutation has finished. */
function withInboxLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

async function loadState(): Promise<InboxState | null> {
  try {
    const items = await chrome.storage.local.get(INBOX_STATE_KEY);
    const s = items[INBOX_STATE_KEY] as Partial<InboxState> | undefined;
    if (!s || !Array.isArray(s.items)) return null;
    const map = <T>(v: unknown): Record<string, T> | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, T>) : undefined);
    return {
      items: s.items,
      fetchedAt: typeof s.fetchedAt === 'number' ? s.fetchedAt : 0,
      seen: mergeSeen(s.seen), // lower-cases keys written by older versions
      snoozes: map(s.snoozes),
      pins: map(s.pins),
      notified: map(s.notified),
      scope: typeof s.scope === 'string' ? s.scope : undefined,
    };
  } catch {
    return null;
  }
}

async function saveState(state: InboxState): Promise<void> {
  await chrome.storage.local.set({ [INBOX_STATE_KEY]: state });
}

/** True when credentials changed since `gen` was captured or there is no token. */
async function stale(gen: number): Promise<boolean> {
  return gen !== authGeneration() || !(await getToken());
}

/** Inbox response for `state` with the current settings (readiness, staleness, snooze/pin flags). */
async function view(state: InboxState | null): Promise<Inbox> {
  const { staleDays } = await bgSettings();
  return toInbox(state, { staleDays, now: Date.now() });
}

/** Badge = unseen, non-snoozed count (`count`, or computed from storage); always empty without a token. */
export async function updateBadge(count?: number): Promise<void> {
  try {
    const { notificationsEnabled } = await bgSettings();
    let n = 0;
    if (notificationsEnabled && (await getToken())) n = count ?? (await view(await loadState())).unseenCount;
    const text = n <= 0 ? '' : n > 99 ? '99+' : String(n);
    await chrome.action.setBadgeText({ text });
    if (text) await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
  } catch {
    /* action API unavailable */
  }
}

function errorCode(res: { rateLimited?: boolean; status?: number }): string {
  if (res.rateLimited) return 'rate-limited';
  if (res.status === 401) return 'invalid';
  if (!res.status || res.status >= 500) return 'network';
  return 'error';
}

/**
 * Run the inbox query with every token needed to see all of the user's PRs:
 * one classic/OAuth token sees everything; otherwise each fine-grained token
 * sees its owner's private PRs (plus public ones), so all of them run.
 */
async function queryInbox(): Promise<{ scope: string; results: { res: ApiResult<unknown>; items: InboxItem[] | null }[] }> {
  const usable = usableTokens(await listTokens());
  const broad = usable.find((t) => t.owners === null);
  const results: { res: ApiResult<unknown>; items: InboxItem[] | null }[] = [];
  for (const t of broad ? [broad] : usable) {
    const res = await githubGraphQL<RawInboxData>(t.token, INBOX_QUERY, { ...INBOX_VARIABLES });
    if (res.status === 401) scheduleTokenCheck(t.id);
    const parsed = res.data ? parseInbox(res.data) : null;
    results.push({ res, items: parsed?.viewer ? parsed.items : null });
  }
  // A different token set sees different PRs: its first refresh is a new notification baseline.
  return { scope: usable.map((t) => t.id).sort().join(','), results };
}

/** Save, update the badge and the snooze alarm; returns the inbox response. */
async function commit(state: InboxState): Promise<Inbox> {
  await saveState(state);
  const inbox = await view(state);
  await updateBadge(inbox.unseenCount);
  await scheduleSnoozeAlarm(state);
  return inbox;
}

async function scheduleSnoozeAlarm(state: InboxState | null): Promise<void> {
  try {
    const end = nextSnoozeEnd(state, Date.now());
    if (end === null) await chrome.alarms.clear(ALARM_SNOOZE);
    else await chrome.alarms.create(ALARM_SNOOZE, { when: end + 1000 });
  } catch {
    /* alarms API unavailable */
  }
}

async function fetchInbox(): Promise<Inbox> {
  const gen = authGeneration();
  if (!(await getToken())) return NEEDS_AUTH;
  const { scope, results } = await queryInbox();
  // Partial failures keep the successful tokens' PRs.
  const ok = results.map((r) => r.items).filter((items): items is InboxItem[] => !!items);
  let events: PendingNotification[] = [];

  const inbox = await withInboxLock(async () => {
    // Logged out or tokens changed while the requests were in flight: the
    // responses may belong to old tokens; never save them or touch the badge.
    if (await stale(gen)) return (await getToken()) ? view(await loadState()) : NEEDS_AUTH;
    // Re-read inside the lock: markSeen calls may have landed meanwhile.
    const current = await loadState();
    if (!ok.length) {
      const res = results[0]?.res ?? { ok: false, status: 401 };
      // Keep showing the last good data next to the error.
      return { ...(await view(current)), error: errorCode(res), needsAuth: results.every((r) => r.res.status === 401) || undefined };
    }
    const nowIso = new Date().toISOString();
    const applied = applySeen(mergeInboxItems(ok), current?.seen ?? {}, nowIso);
    const base = pruneMarks({ items: applied.items, seen: applied.seen, fetchedAt: Date.now(), snoozes: current?.snoozes, pins: current?.pins }, nowIso);
    const diff = diffNotifications(current?.items ?? null, base.items, current?.notified, {
      baseline: !current || current.scope !== scope,
      nowIso,
      snoozed: (key) => !!activeSnooze(base, key, Date.now()),
    });
    events = diff.events;
    return commit({ ...base, notified: diff.notified, scope });
  });
  // Outside the lock: showing notifications must not delay other inbox work.
  await deliverNotifications(events);
  return inbox;
}

/**
 * Fetch now (concurrent callers share one request). `restart` drops a shared
 * in-flight request (it may have been started with a previous token).
 */
export function refreshInbox(restart = false): Promise<Inbox> {
  if (restart) refreshing = null;
  if (!refreshing) {
    const p: Promise<Inbox> = fetchInbox().finally(() => {
      if (refreshing === p) refreshing = null;
    });
    refreshing = p;
  }
  return refreshing;
}

/** Cached inbox when fresher than the notification interval, unless `force`. */
export async function getInbox(force = false): Promise<Inbox> {
  if (!(await getToken())) return NEEDS_AUTH;
  const state = await loadState();
  const { notificationInterval } = await bgSettings();
  const fresh = !!state && Date.now() - state.fetchedAt < notificationInterval * 60_000;
  if (fresh && !force) return view(state);
  return refreshInbox();
}

/** Alarm tick: refresh unless something else (popup, dashboard) just did. */
export async function onInboxAlarm(): Promise<void> {
  const { notificationsEnabled, desktopNotifications, notificationInterval } = await bgSettings();
  if (!(notificationsEnabled || desktopNotifications) || !(await getToken())) return;
  const state = await loadState();
  const age = state ? Date.now() - state.fetchedAt : Infinity;
  if (age < notificationInterval * 60_000 - 30_000) return;
  await refreshInbox();
}

/** Mark PR urls (any github.com PR, see markSeenState) or every inbox item as seen. */
export function markSeen(urls?: string[]): Promise<{ ok: boolean; unseenCount: number }> {
  const gen = authGeneration();
  const list = Array.isArray(urls) ? urls.filter((u): u is string => typeof u === 'string').slice(0, MAX_MARK_URLS) : undefined;
  return withInboxLock(async () => {
    if (await stale(gen)) return { ok: false, unseenCount: 0 };
    const loaded = await loadState();
    if (!loaded && !list?.length) return { ok: true, unseenCount: 0 };
    // No state yet (before the first refresh): still remember the visit.
    const state = loaded ?? { items: [], fetchedAt: 0, seen: {} };
    const { unseenCount } = await commit(markSeenState(state, list, new Date().toISOString()));
    return { ok: true, unseenCount };
  });
}

const EMPTY_STATE: InboxState = { items: [], fetchedAt: 0, seen: {} };

/** 'inbox:snooze': hide a PR from the badge until `until` (ISO); null un-snoozes. */
export function snooze(url: unknown, until: unknown): Promise<Inbox> {
  const gen = authGeneration();
  return withInboxLock(async () => {
    if (await stale(gen)) return NEEDS_AUTH;
    const state = (await loadState()) ?? EMPTY_STATE;
    const key = normalizePrUrl(url);
    const validUntil = until === null || (typeof until === 'string' && Number.isFinite(Date.parse(until)));
    if (!key || !validUntil) return { ...(await view(state)), error: 'invalid-request' };
    return commit(snoozeState(state, key, until as string | null, new Date().toISOString()));
  });
}

/** 'inbox:pin': pin / unpin a PR (kept across refreshes). */
export function pin(url: unknown, pinned: unknown): Promise<Inbox> {
  const gen = authGeneration();
  return withInboxLock(async () => {
    if (await stale(gen)) return NEEDS_AUTH;
    const state = (await loadState()) ?? EMPTY_STATE;
    const key = normalizePrUrl(url);
    if (!key || typeof pinned !== 'boolean') return { ...(await view(state)), error: 'invalid-request' };
    return commit(pinState(state, key, pinned, new Date().toISOString()));
  });
}

/** ALARM_SNOOZE: a snooze ended → drop it, update the badge, schedule the next one. */
export function onSnoozeAlarm(): Promise<void> {
  return withInboxLock(async () => {
    const state = await loadState();
    if (!state || !(await getToken())) return;
    await commit(pruneMarks(state, new Date().toISOString()));
  });
}

/** Invalidate freshness so the next 'inbox:get' refetches (keeps seen state). */
export function expireInbox(): Promise<void> {
  return withInboxLock(async () => {
    const state = await loadState();
    if (state) await saveState({ ...state, fetchedAt: 0 });
  });
}

export function clearInbox(): Promise<void> {
  return withInboxLock(async () => {
    await chrome.storage.local.remove(INBOX_STATE_KEY);
    await updateBadge(0);
    await scheduleSnoozeAlarm(null);
  });
}
