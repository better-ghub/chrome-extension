// Better GHub - Inbox model: grouping, ordering and status descriptors.
//
// Pure functions over InboxItem[]; the popup renders whatever these return.

import type { InboxItem } from '../core/messages';
import type { IconName } from '../core/icons';
import { daysSince } from '../core/readiness';
import { t } from '../i18n';
import { plural } from './format';

export type InboxTab = 'review' | 'authored' | 'assigned';

export const INBOX_TABS: readonly InboxTab[] = ['review', 'authored', 'assigned'];

export type InboxGroups = Record<InboxTab, InboxItem[]>;

type Reason = InboxItem['reasons'][number];
/** Review work = requests plus PRs with new commits since the viewer's own review. */
const REASONS_FOR_TAB: Record<InboxTab, readonly Reason[]> = {
  review: ['review-requested', 'rereview'],
  authored: ['authored'],
  assigned: ['assigned'],
};

/** Most recent meaningful timestamp of an item (epoch ms, 0 when unknown). */
export function activityTime(item: InboxItem): number {
  const requested = item.reasons.includes('review-requested') ? item.reviewRequestedAt : null;
  const times = [item.updatedAt, item.lastActivity?.at, requested].map((v) => (v ? Date.parse(v) : NaN));
  const valid = times.filter((n) => Number.isFinite(n));
  return valid.length ? Math.max(...valid) : 0;
}

/** Pinned first, then an unsubmitted review (easy to forget), then unseen, then most recent activity; ties broken by URL. */
export function sortItems(items: readonly InboxItem[]): InboxItem[] {
  return [...items].sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    const aDraft = (a.pendingReviewComments ?? 0) > 0;
    if (aDraft !== (b.pendingReviewComments ?? 0) > 0) return aDraft ? -1 : 1;
    if (a.unseen !== b.unseen) return a.unseen ? -1 : 1;
    const diff = activityTime(b) - activityTime(a);
    if (diff !== 0) return diff;
    return a.url < b.url ? -1 : a.url > b.url ? 1 : 0;
  });
}

/** Snoozed until a moment that hasn't come yet. */
export function isSnoozed(item: InboxItem, now = Date.now()): boolean {
  const until = item.snoozedUntil ? Date.parse(item.snoozedUntil) : NaN;
  return Number.isFinite(until) && until > now;
}

/**
 * Split items into tabs. A PR can legitimately appear in more than one tab.
 * Snoozed items stay out of the tabs (see snoozedItems).
 */
export function groupInbox(items: readonly InboxItem[], now = Date.now()): InboxGroups {
  const groups: InboxGroups = { review: [], authored: [], assigned: [] };
  const active = items.filter((i) => !isSnoozed(i, now));
  for (const tab of INBOX_TABS) {
    groups[tab] = sortItems(active.filter((i) => i.reasons.some((r) => REASONS_FOR_TAB[tab].includes(r))));
  }
  return groups;
}

/** Snoozed items, soonest to wake up first. */
export function snoozedItems(items: readonly InboxItem[], now = Date.now()): InboxItem[] {
  return items
    .filter((i) => isSnoozed(i, now))
    .sort((a, b) => Date.parse(a.snoozedUntil ?? '') - Date.parse(b.snoozedUntil ?? '') || (a.url < b.url ? -1 : 1));
}

/** Optimistic local snooze (until = null un-snoozes); returns a new array. */
export function withSnooze(items: readonly InboxItem[], url: string, until: string | null): InboxItem[] {
  return items.map((i) => (i.url === url ? { ...i, snoozedUntil: until } : i));
}

/** Optimistic local pin / unpin; returns a new array. */
export function withPin(items: readonly InboxItem[], url: string, pinned: boolean): InboxItem[] {
  return items.map((i) => (i.url === url ? { ...i, pinned } : i));
}

/** Tabs to show: review requests and own PRs always, "Assigned" only when non-empty. */
export function visibleTabs(groups: InboxGroups): InboxTab[] {
  return INBOX_TABS.filter((tab) => tab !== 'assigned' || groups.assigned.length > 0);
}

/**
 * Initial tab. What changed matters most (the badge brought the user here), so:
 * the remembered tab if it has unseen items, else any tab with unseen items,
 * else the remembered tab if non-empty, else the first non-empty tab.
 */
export function pickTab(groups: InboxGroups, preferred?: string | null): InboxTab {
  const tabs = visibleTabs(groups);
  const pref = preferred && (tabs as string[]).includes(preferred) ? (preferred as InboxTab) : null;
  const hasUnseen = (tab: InboxTab): boolean => groups[tab].some((i) => i.unseen);
  if (pref && hasUnseen(pref)) return pref;
  const unseenTab = tabs.find(hasUnseen);
  if (unseenTab) return unseenTab;
  if (pref && groups[pref].length > 0) return pref;
  return tabs.find((tab) => groups[tab].length > 0) ?? pref ?? 'review';
}

export function unseenIn(items: readonly InboxItem[]): number {
  return items.reduce((n, i) => n + (i.unseen ? 1 : 0), 0);
}

/** Mark the given URLs (or everything) as seen; returns a new array. */
export function markSeen(items: readonly InboxItem[], urls?: readonly string[]): InboxItem[] {
  const set = urls ? new Set(urls) : null;
  return items.map((i) => (i.unseen && (!set || set.has(i.url)) ? { ...i, unseen: false } : i));
}

// ------------------------------------------------------------ status badges

export type StatusTone = 'success' | 'danger' | 'attention' | 'muted';

export interface StatusDescriptor {
  id: 'pending-review' | 'rereview' | 'checks' | 'review' | 'conflicts' | 'threads' | 'draft' | 'ready' | 'stale';
  icon: IconName | null;
  tone: StatusTone;
  /** Accessible name / tooltip. */
  label: string;
  /** Visible text (badges); icon-only when absent. */
  text?: string;
}

export function checksStatus(checks: InboxItem['checks']): StatusDescriptor | null {
  switch (checks) {
    case 'SUCCESS':
      return { id: 'checks', icon: 'check', tone: 'success', label: t('inboxChecksPassed', 'All checks passed') };
    case 'FAILURE':
    case 'ERROR':
      return { id: 'checks', icon: 'x', tone: 'danger', label: t('inboxChecksFailed', 'Some checks failed') };
    case 'PENDING':
    case 'EXPECTED':
      return { id: 'checks', icon: 'dot-fill', tone: 'attention', label: t('inboxChecksPending', 'Checks in progress') };
    default:
      return null;
  }
}

export function reviewStatus(decision: InboxItem['reviewDecision']): StatusDescriptor | null {
  switch (decision) {
    case 'APPROVED': {
      const text = t('inboxApproved', 'Approved');
      return { id: 'review', icon: 'check-circle', tone: 'success', label: text, text };
    }
    case 'CHANGES_REQUESTED': {
      const text = t('inboxChangesRequested', 'Changes requested');
      return { id: 'review', icon: 'file-diff', tone: 'danger', label: text, text };
    }
    case 'REVIEW_REQUIRED': {
      const text = t('inboxReviewRequired', 'Review required');
      return { id: 'review', icon: 'eye', tone: 'muted', label: text, text };
    }
    default:
      return null;
  }
}

/**
 * Ordered status descriptors for an inbox row. In the review-requests tab
 * "Review required" is implied (that's why the PR is there), so it is hidden.
 */
/** Days since the last activity (or update) — what "stale" is measured on. */
export function idleDays(item: InboxItem, now = Date.now()): number {
  return daysSince(item.lastActivity?.at ?? item.updatedAt, now);
}

export function readyStatus(): StatusDescriptor {
  const text = t('inboxReady', 'Ready to merge');
  return { id: 'ready', icon: 'check-circle', tone: 'success', label: text, text };
}

export function staleStatus(days: number): StatusDescriptor {
  return {
    id: 'stale',
    icon: 'hourglass',
    tone: 'muted',
    label: plural('inboxStaleFor', days, { one: 'No activity for $1 day', other: 'No activity for $1 days' }),
    text: t('inboxStale', 'Stale $1d', String(days)),
  };
}

export function pendingReviewStatus(comments: number): StatusDescriptor {
  return {
    id: 'pending-review',
    icon: 'alert',
    tone: 'attention',
    label: plural('inboxPendingReviewFor', comments, {
      one: 'You have an unsubmitted review with $1 comment. Open the PR and choose "Submit review".',
      other: 'You have an unsubmitted review with $1 comments. Open the PR and choose "Submit review".',
    }),
    text: t('inboxPendingReview', 'Unsubmitted review · $1', String(comments)),
  };
}

export function itemStatuses(item: InboxItem, tab: InboxTab = 'authored', now = Date.now()): StatusDescriptor[] {
  const out: StatusDescriptor[] = [];
  if ((item.pendingReviewComments ?? 0) > 0) out.push(pendingReviewStatus(item.pendingReviewComments ?? 0));
  if (item.reasons.includes('rereview')) {
    const text = t('inboxRereview', 'New changes since your review');
    out.push({ id: 'rereview', icon: 'file-diff', tone: 'attention', label: text, text });
  }
  if (item.isDraft) {
    const text = t('inboxDraft', 'Draft');
    out.push({ id: 'draft', icon: null, tone: 'muted', label: text, text });
  } else if (item.ready) {
    // Implies approved + green checks: one badge says it all.
    out.push(readyStatus());
  } else if (!(tab === 'review' && item.reviewDecision === 'REVIEW_REQUIRED')) {
    const review = reviewStatus(item.reviewDecision);
    if (review) out.push(review);
  }
  const checks = checksStatus(item.checks);
  if (checks) out.push(checks);
  if (item.hasConflicts) {
    out.push({ id: 'conflicts', icon: 'alert', tone: 'danger', label: t('inboxConflicts', 'Merge conflicts') });
  }
  if (item.unresolvedThreads > 0) {
    out.push({
      id: 'threads',
      icon: 'comment-discussion',
      tone: 'muted',
      label: plural('inboxUnresolvedThreads', item.unresolvedThreads, {
        one: '$1 unresolved thread',
        other: '$1 unresolved threads',
      }),
      text: String(item.unresolvedThreads),
    });
  }
  if (item.stale) out.push(staleStatus(idleDays(item, now)));
  return out;
}

/** Accessible description of the diff size, e.g. "120 lines added, 8 lines removed". */
export function diffLabel(item: InboxItem): string {
  const added = plural('inboxLinesAdded', item.additions, { one: '$1 line added', other: '$1 lines added' });
  const removed = plural('inboxLinesRemoved', item.deletions, { one: '$1 line removed', other: '$1 lines removed' });
  return `${added}, ${removed}`;
}

/** Short, compact diff number: 1234 → "1.2k". */
export function compactCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(Math.floor(n / 100) / 10).toFixed(1).replace(/\.0$/, '')}k`;
  return `${Math.floor(n / 1000)}k`;
}
