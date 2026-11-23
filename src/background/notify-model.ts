// Better GHub - Desktop notification rules (pure, unit-tested; IO in notify.ts).
//
// After each successful inbox refresh the previous and the new items are
// compared. An event fires when its value appears/changes AND that exact value
// was never notified for the PR (persisted, so restarts and PRs dropping out
// of the top 25 and coming back do not repeat it).

import type { InboxItem } from '../core/messages';
import type { Settings } from '../core/settings';
import { seenKey, type Notified } from './inbox-model';

export type NotifyEvent = 'review-requested' | 'changes-requested' | 'checks-failed' | 'approved';
export const NOTIFY_EVENTS: readonly NotifyEvent[] = ['review-requested', 'changes-requested', 'checks-failed', 'approved'];

export interface PendingNotification {
  event: NotifyEvent;
  item: InboxItem;
}

/** Dedupe entries of conditions not observed for this long are dropped. */
export const NOTIFIED_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** More events than this in one refresh → one summary notification. */
export const MAX_SINGLE_NOTIFICATIONS = 3;

const authored = (i: InboxItem): boolean => i.reasons.includes('authored');

/** Value of an event's condition for `item` (null = condition does not hold). */
export function eventValue(item: InboxItem, event: NotifyEvent): string | null {
  switch (event) {
    case 'review-requested':
      // A re-request (new request time) is a new value.
      return item.reasons.includes('review-requested') ? item.reviewRequestedAt || 'requested' : null;
    case 'changes-requested':
      return authored(item) && item.reviewDecision === 'CHANGES_REQUESTED' ? 'CHANGES_REQUESTED' : null;
    case 'checks-failed':
      return authored(item) && (item.checks === 'FAILURE' || item.checks === 'ERROR') ? 'failed' : null;
    case 'approved':
      return authored(item) && item.reviewDecision === 'APPROVED' ? 'APPROVED' : null;
  }
}

/**
 * New events between `prev` and `next` plus the updated dedupe record.
 * - `baseline`: record everything, notify nothing (first fetch, sign-in, token set changed);
 * - snoozed PRs are recorded but never notified (dropped, not queued);
 * - a condition that stops holding is forgotten, so the next transition fires again.
 */
export function diffNotifications(
  prev: readonly InboxItem[] | null,
  next: readonly InboxItem[],
  notified: Record<string, Notified> | undefined,
  opts: { baseline: boolean; nowIso: string; snoozed: (key: string) => boolean }
): { events: PendingNotification[]; notified: Record<string, Notified> } {
  const out: Record<string, Notified> = { ...notified };
  const prevByKey = new Map((prev ?? []).map((i) => [seenKey(i.url), i]));
  const events: PendingNotification[] = [];
  for (const item of next) {
    const key = seenKey(item.url);
    const before = prevByKey.get(key);
    for (const event of NOTIFY_EVENTS) {
      const rk = `${key} ${event}`;
      const value = eventValue(item, event);
      if (value === null) {
        delete out[rk];
        continue;
      }
      const fresh = value !== (before ? eventValue(before, event) : null) && out[rk]?.v !== value;
      out[rk] = { v: value, at: opts.nowIso };
      if (fresh && !opts.baseline && !opts.snoozed(key)) events.push({ event, item });
    }
  }
  const nowMs = Date.parse(opts.nowIso);
  for (const [rk, n] of Object.entries(out)) if (!(nowMs - Date.parse(n.at) < NOTIFIED_MAX_AGE_MS)) delete out[rk];
  return { events, notified: out };
}

const minutes = (hhmm: string): number | null => {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** True when local time `now` is in [start, end); ranges may cross midnight. start === end = never. */
export function inQuietHours(start: string, end: string, now: Date): boolean {
  const s = minutes(start);
  const e = minutes(end);
  if (s === null || e === null || s === e) return false;
  const t = now.getHours() * 60 + now.getMinutes();
  return s < e ? t >= s && t < e : t >= s || t < e;
}

/** The events the user wants delivered right now (master switch, per-type switches, quiet hours). */
export function deliverable(events: readonly PendingNotification[], s: Settings, now: Date): PendingNotification[] {
  if (!s.desktopNotifications) return [];
  if (s.quietHoursEnabled && inQuietHours(s.quietHoursStart, s.quietHoursEnd, now)) return [];
  const on: Record<NotifyEvent, boolean> = {
    'review-requested': s.notifyReviewRequested,
    'changes-requested': s.notifyChangesRequested,
    'checks-failed': s.notifyChecksFailed,
    approved: s.notifyApproved,
  };
  return events.filter((e) => on[e.event]);
}

/** Who to show under the title: the reviewer for review outcomes, the author for review requests. */
export function actorOf(p: PendingNotification): string | null {
  if (p.event === 'review-requested') return p.item.author || null;
  if (p.event === 'changes-requested' || p.event === 'approved') {
    return p.item.lastActivity?.kind === 'review' ? p.item.lastActivity.actor : null;
  }
  return null;
}

const PR_PREFIX = 'bghub:pr:';
const SUMMARY_PREFIX = 'bghub:summary:';

/** "bghub:pr:<url>#<event>": one notification per PR and event (a second event must not replace the first). */
export function prNotificationId(url: string, event: NotifyEvent): string {
  return `${PR_PREFIX}${url}#${event}`;
}

export function summaryNotificationId(nowMs: number): string {
  return SUMMARY_PREFIX + nowMs;
}

/** What a clicked notification opens: a PR url, the PR list ('summary'), or null (not ours). */
export function parseNotificationId(id: string): { kind: 'pr'; url: string } | { kind: 'summary' } | null {
  if (id.startsWith(SUMMARY_PREFIX)) return { kind: 'summary' };
  if (!id.startsWith(PR_PREFIX)) return null;
  const url = id.slice(PR_PREFIX.length).replace(/#.*$/, '');
  return /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+$/i.test(url) ? { kind: 'pr', url } : null;
}
