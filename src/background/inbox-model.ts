// Better GHub - Inbox model: GraphQL query, response parsing and the
// "unseen" rules (pure, unit-tested; IO lives in inbox.ts).

import type { ChecksState, Inbox, InboxItem, ReviewDecision } from '../core/messages';
import { isReady, isStale } from '../core/readiness';

type Reason = InboxItem['reasons'][number];

const PR_FIELDS = `
  url number title isDraft updatedAt additions deletions mergeable reviewDecision
  repository { nameWithOwner }
  author { login avatarUrl }
  commits(last: 1) { nodes { commit { committedDate author { name user { login } } statusCheckRollup { state } } } }
  comments(last: 1) { nodes { author { login } createdAt } }
  reviews(last: 1, states: [APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED]) { nodes { author { login } submittedAt } }
  pendingReviews: reviews(states: PENDING, first: 1) { nodes { comments { totalCount } } }
  latestReviews(first: 20) { nodes { author { login } state submittedAt } }
  reviewThreads(first: 50) { nodes { isResolved } }
  timelineItems(last: 10, itemTypes: [REVIEW_REQUESTED_EVENT]) {
    nodes { ... on ReviewRequestedEvent { createdAt requestedReviewer { __typename ... on User { login } } } }
  }`;

/** One request, four aliased searches (4 x 25 PRs, each with small nested pages: far below the node limit). */
export const INBOX_QUERY = `query BghubInbox($authored: String!, $reviewRequested: String!, $assigned: String!, $reviewed: String!) {
  viewer { login name }
  authored: search(type: ISSUE, first: 25, query: $authored) { nodes { ...BghubInboxPR } }
  reviewRequested: search(type: ISSUE, first: 25, query: $reviewRequested) { nodes { ...BghubInboxPR } }
  assigned: search(type: ISSUE, first: 25, query: $assigned) { nodes { ...BghubInboxPR } }
  reviewed: search(type: ISSUE, first: 25, query: $reviewed) { nodes { ...BghubInboxPR } }
}
fragment BghubInboxPR on PullRequest {${PR_FIELDS}
}`;

const BASE = 'is:pr is:open archived:false sort:updated-desc';
export const INBOX_VARIABLES = {
  authored: `${BASE} author:@me`,
  reviewRequested: `${BASE} review-requested:@me`,
  assigned: `${BASE} assignee:@me`,
  // PRs the viewer already reviewed; only those with newer commits become 'rereview'.
  reviewed: `${BASE} reviewed-by:@me -author:@me`,
} as const;

const SEARCH_REASONS: [keyof typeof INBOX_VARIABLES, Reason][] = [
  ['reviewRequested', 'review-requested'],
  ['authored', 'authored'],
  ['assigned', 'assigned'],
  ['reviewed', 'rereview'],
];

interface Login {
  login?: string | null;
}
interface Nodes<T> {
  nodes?: (T | null)[] | null;
}
export interface RawInboxPR {
  url?: string;
  number?: number;
  title?: string;
  isDraft?: boolean;
  updatedAt?: string;
  additions?: number;
  deletions?: number;
  mergeable?: string;
  reviewDecision?: ReviewDecision;
  repository?: { nameWithOwner?: string } | null;
  author?: (Login & { avatarUrl?: string | null }) | null;
  commits?: Nodes<{ commit?: { committedDate?: string; author?: { name?: string | null; user?: Login | null } | null; statusCheckRollup?: { state?: ChecksState } | null } }>;
  comments?: Nodes<{ author?: Login | null; createdAt?: string }>;
  reviews?: Nodes<{ author?: Login | null; submittedAt?: string | null }>;
  pendingReviews?: Nodes<{ comments?: { totalCount?: number } | null }>;
  latestReviews?: Nodes<{ author?: Login | null; state?: string; submittedAt?: string | null }>;
  reviewThreads?: Nodes<{ isResolved?: boolean }>;
  timelineItems?: Nodes<{ createdAt?: string; requestedReviewer?: { __typename?: string; login?: string } | null }>;
}
export interface RawInboxData {
  viewer?: (Login & { name?: string | null }) | null;
  authored?: Nodes<RawInboxPR> | null;
  reviewRequested?: Nodes<RawInboxPR> | null;
  assigned?: Nodes<RawInboxPR> | null;
  reviewed?: Nodes<RawInboxPR> | null;
}

const same = (a: string | null | undefined, b: string): boolean => !!a && a.toLowerCase() === b.toLowerCase();
const nodes = <T>(c: Nodes<T> | null | undefined): T[] => (c?.nodes ?? []).filter((n): n is T => !!n);
const time = (iso: string | null | undefined): number => (iso ? Date.parse(iso) || 0 : 0);

/**
 * Most recent commit / comment / review by someone OTHER than the viewer.
 * Commits whose email is not linked to an account only carry a name, so the
 * viewer's display name is matched too.
 */
export function lastActivityOf(pr: RawInboxPR, viewer: string, viewerName = ''): InboxItem['lastActivity'] {
  const candidates: NonNullable<InboxItem['lastActivity']>[] = [];
  const commit = nodes(pr.commits)[0]?.commit;
  if (commit?.committedDate) {
    const actor = commit.author?.user?.login ?? commit.author?.name ?? '';
    candidates.push({ kind: 'commit', actor, at: commit.committedDate });
  }
  const comment = nodes(pr.comments)[0];
  if (comment?.createdAt) candidates.push({ kind: 'comment', actor: comment.author?.login ?? 'ghost', at: comment.createdAt });
  const review = nodes(pr.reviews)[0];
  if (review?.submittedAt) candidates.push({ kind: 'review', actor: review.author?.login ?? 'ghost', at: review.submittedAt });

  const others = candidates.filter((c) => !same(c.actor, viewer) && !(viewerName && same(c.actor, viewerName)));
  others.sort((a, b) => time(b.at) - time(a.at));
  return others[0] ?? null;
}

/** When the viewer's review was last requested (team requests count: membership is unknown). */
export function reviewRequestedAtOf(pr: RawInboxPR, viewer: string): string | null {
  const events = nodes(pr.timelineItems).filter((e) => e.createdAt);
  const mine = events.filter((e) => e.requestedReviewer?.__typename !== 'User' || same(e.requestedReviewer.login, viewer));
  const pick = (mine.length ? mine : events).sort((a, b) => time(b.createdAt) - time(a.createdAt))[0];
  return pick?.createdAt ?? null;
}

/**
 * Comments in the viewer's own pending review. GitHub shows a pending review
 * only to its author, so any node is the viewer's draft. 0 = none (an empty
 * draft is not worth a warning).
 */
export function pendingCommentsOf(pr: RawInboxPR): number {
  const count = nodes(pr.pendingReviews)[0]?.comments?.totalCount;
  return typeof count === 'number' && count > 0 ? count : 0;
}

/**
 * ISO commit time when the viewer's latest review (CHANGES_REQUESTED or
 * COMMENTED; an APPROVED review is done, a DISMISSED one no longer stands)
 * predates the last commit, else null.
 */
export function rereviewCommitOf(pr: RawInboxPR, viewer: string): string | null {
  if (!viewer) return null;
  const mine = nodes(pr.latestReviews).find((r) => same(r.author?.login, viewer));
  if (!mine || (mine.state !== 'CHANGES_REQUESTED' && mine.state !== 'COMMENTED')) return null;
  const committed = nodes(pr.commits)[0]?.commit?.committedDate;
  return committed && time(committed) > time(mine.submittedAt) ? committed : null;
}

function toItem(pr: RawInboxPR, viewer: string, viewerName: string): InboxItem | null {
  if (!pr.url || typeof pr.number !== 'number') return null;
  const commit = nodes(pr.commits)[0]?.commit;
  return {
    url: pr.url,
    repo: pr.repository?.nameWithOwner ?? pr.url.split('/').slice(3, 5).join('/'),
    number: pr.number,
    title: pr.title ?? '',
    author: pr.author?.login ?? 'ghost',
    authorAvatarUrl: pr.author?.avatarUrl ?? null,
    isDraft: !!pr.isDraft,
    updatedAt: pr.updatedAt ?? '',
    reasons: [],
    reviewDecision: pr.reviewDecision ?? null,
    checks: commit?.statusCheckRollup?.state ?? null,
    unresolvedThreads: nodes(pr.reviewThreads).filter((t) => t.isResolved === false).length,
    additions: pr.additions ?? 0,
    deletions: pr.deletions ?? 0,
    hasConflicts: pr.mergeable === 'CONFLICTING',
    reviewRequestedAt: reviewRequestedAtOf(pr, viewer),
    pendingReviewComments: pendingCommentsOf(pr),
    lastActivity: lastActivityOf(pr, viewer, viewerName),
    unseen: false,
  };
}

/** Merge the searches by url (a PR can be authored AND assigned). */
export function parseInbox(data: RawInboxData | null | undefined): { viewer: string; items: InboxItem[] } {
  const viewer = data?.viewer?.login ?? '';
  const viewerName = data?.viewer?.name ?? '';
  const byUrl = new Map<string, InboxItem>();
  for (const [alias, reason] of SEARCH_REASONS) {
    for (const raw of nodes(data?.[alias])) {
      const item = byUrl.get(raw.url ?? '') ?? toItem(raw, viewer, viewerName);
      if (!item) continue;
      if (reason === 'rereview') {
        const commitAt = rereviewCommitOf(raw, viewer);
        if (!commitAt) continue;
        item.rereviewCommitAt = commitAt;
      }
      if (!item.reasons.includes(reason)) item.reasons.push(reason);
      byUrl.set(item.url, item);
    }
  }
  const items = [...byUrl.values()];
  items.sort((a, b) => time(b.updatedAt) - time(a.updatedAt));
  return { viewer, items };
}

export interface Snooze {
  /** ISO end of the snooze. */
  until: string;
  /** ISO start (the PR counts as seen at that moment). */
  at: string;
  /** `seen` before the snooze, restored when the user un-snoozes early. */
  prevSeen: string | null;
}

export interface Pin {
  /** ISO time pinned. */
  at: string;
  /** ISO time the PR was last part of the inbox (pins are pruned 30 days after it left). */
  lastInInbox: string;
}

/** Dedupe record of a delivered (or deliberately dropped) desktop notification. */
export interface Notified {
  /** Event value (see notify-model.eventValue). */
  v: string;
  /** ISO time the condition was last observed (entries are pruned after 30 days). */
  at: string;
}

export interface InboxState {
  items: InboxItem[];
  /** Epoch ms of the last successful fetch. */
  fetchedAt: number;
  /** Lower-cased PR url (see seenKey) → ISO time the user last looked at it. */
  seen: Record<string, string>;
  /** seenKey → active snooze. */
  snoozes?: Record<string, Snooze>;
  /** seenKey → pin. */
  pins?: Record<string, Pin>;
  /** "<seenKey> <event>" → last notified value. */
  notified?: Record<string, Notified>;
  /**
   * Tokens the last successful refresh ran with. No notifications until a
   * refresh with the same scope exists (first fetch, sign-in, token added).
   */
  scope?: string;
}

/** `seen` entries for PRs outside the inbox are kept this long... */
export const SEEN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** ...and at most this many of them (newest first). */
export const SEEN_MAX_OTHERS = 1000;

const PR_URL = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/;

/**
 * Canonical, lower-cased "https://github.com/o/r/pull/N" for a PR url (the
 * address bar and GitHub's API disagree on owner/repo casing), or null when it
 * is not a github.com PR url. Query, hash, sub-pages (/files) and trailing
 * slashes are dropped.
 */
export function normalizePrUrl(url: unknown): string | null {
  if (typeof url !== 'string' || url.length > 1024) return null;
  const key = url
    .trim()
    .toLowerCase()
    .replace(/[?#].*$/, '')
    .replace(/(\/pull\/\d+)\/.*$/, '$1')
    .replace(/\/+$/, '');
  return PR_URL.test(key) ? key : null;
}

/** Key of `url` in InboxState.seen. */
export function seenKey(url: string): string {
  return normalizePrUrl(url) ?? url.toLowerCase();
}

/** Merge seen maps under seenKey, keeping the newest time per PR (also migrates mixed-case keys). */
export function mergeSeen(...maps: (Record<string, unknown> | null | undefined)[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const map of maps) {
    for (const [url, at] of Object.entries(map ?? {})) {
      if (typeof at !== 'string') continue;
      const key = seenKey(url);
      if (out[key] === undefined || time(at) > time(out[key])) out[key] = at;
    }
  }
  return out;
}

/**
 * Compute `unseen` for every item and return the updated `seen` map:
 * - known item: unseen when someone else acted after the user last looked
 *   (own pushes/comments never count — lastActivity excludes the viewer), or
 *   the user's review was (re-)requested after that;
 * - never-seen review request: unseen (it is new work for the user);
 * - never-seen authored/assigned PR: seen now (no badge on first sync);
 * - entries for PRs outside the inbox are pruned by AGE, not membership: a PR
 *   visited before it entered the inbox, or one that dropped out of the top 25
 *   for a while, keeps its last-seen time.
 */
export function applySeen(items: InboxItem[], seen: Record<string, string>, nowIso: string): { items: InboxItem[]; seen: Record<string, string> } {
  const nextSeen: Record<string, string> = {};
  const out = items.map((item) => {
    const key = seenKey(item.url);
    const seenAt = seen[key];
    if (seenAt === undefined) {
      if (item.reasons.includes('review-requested')) return { ...item, unseen: true };
      nextSeen[key] = nowIso;
      return { ...item, unseen: false };
    }
    nextSeen[key] = seenAt;
    const seenMs = time(seenAt);
    const activity = !!item.lastActivity && time(item.lastActivity.at) > seenMs;
    const reRequested = item.reasons.includes('review-requested') && time(item.reviewRequestedAt) > seenMs;
    // New commits since the user's review count even when the committer is the viewer's alias.
    const rereview = item.reasons.includes('rereview') && time(item.rereviewCommitAt) > seenMs;
    return { ...item, unseen: activity || reRequested || rereview };
  });
  const nowMs = time(nowIso);
  const others = Object.entries(seen)
    .filter(([key, at]) => nextSeen[key] === undefined && nowMs - time(at) < SEEN_MAX_AGE_MS)
    .sort((a, b) => time(b[1]) - time(a[1]))
    .slice(0, SEEN_MAX_OTHERS);
  for (const [key, at] of others) nextSeen[key] = at;
  return { items: out, seen: nextSeen };
}

/**
 * Mark the given PR urls (or every inbox item) as seen now. Any github.com PR
 * url counts, not only current inbox items: a review request opened from
 * GitHub's own notification before the next refresh must not show up unread.
 * Invalid urls are ignored.
 */
export function markSeenState(state: InboxState, urls: string[] | undefined, nowIso: string): InboxState {
  const seen = { ...state.seen };
  const targets = urls ? urls.map(normalizePrUrl) : state.items.map((i) => seenKey(i.url));
  for (const key of targets) if (key) seen[key] = nowIso;
  const applied = applySeen(state.items, seen, nowIso);
  return { ...state, items: applied.items, seen: applied.seen };
}

/**
 * Merge per-token inbox results (fine-grained tokens each see one owner) by
 * normalized url: reasons are united; the other fields come from the entry
 * with the newest updatedAt. Sorted newest first.
 */
export function mergeInboxItems(lists: InboxItem[][]): InboxItem[] {
  const byKey = new Map<string, InboxItem>();
  for (const list of lists) {
    for (const item of list) {
      const key = seenKey(item.url);
      const prev = byKey.get(key);
      if (!prev) {
        byKey.set(key, { ...item, reasons: [...item.reasons] });
        continue;
      }
      const newer = time(item.updatedAt) > time(prev.updatedAt) ? item : prev;
      const reasons = [...prev.reasons, ...item.reasons.filter((r) => !prev.reasons.includes(r))];
      const merged: InboxItem = { ...newer, reasons };
      const pending = Math.max(prev.pendingReviewComments ?? 0, item.pendingReviewComments ?? 0);
      if (pending) merged.pendingReviewComments = pending;
      const commitAt = newer.rereviewCommitAt ?? prev.rereviewCommitAt ?? item.rereviewCommitAt;
      if (reasons.includes('rereview') && commitAt) merged.rereviewCommitAt = commitAt;
      byKey.set(key, merged);
    }
  }
  return [...byKey.values()].sort((a, b) => time(b.updatedAt) - time(a.updatedAt));
}

/** Snooze end when `key` is snoozed at `nowMs`, else null. */
export function activeSnooze(state: Pick<InboxState, 'snoozes'>, key: string, nowMs: number): string | null {
  const s = state.snoozes?.[key];
  return s && time(s.until) > nowMs ? s.until : null;
}

/**
 * Inbox response: items with readiness, staleness (computed on read so a
 * staleDays change applies without a refetch), snooze and pin flags. Snoozed
 * items do not count toward unseenCount (the badge).
 */
export function toInbox(state: InboxState | null, opts: { staleDays?: number; now?: number } = {}): Inbox {
  if (!state) return { items: [], unseenCount: 0, fetchedAt: 0 };
  const now = opts.now ?? Date.now();
  const items = state.items.map((item) => {
    const key = seenKey(item.url);
    return {
      ...item,
      ready: isReady(item),
      stale: isStale(item.lastActivity?.at ?? item.updatedAt, opts.staleDays ?? 0, now),
      snoozedUntil: activeSnooze(state, key, now),
      pinned: !!state.pins?.[key],
    };
  });
  return { items, unseenCount: items.filter((i) => i.unseen && !i.snoozedUntil).length, fetchedAt: state.fetchedAt };
}

/** Longest snooze accepted. */
export const SNOOZE_MAX_MS = 366 * 24 * 60 * 60 * 1000;
/** Pins of PRs that left the inbox are kept this long. */
export const PIN_MAX_ABSENT_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Snooze `key` until `until` (ISO), or un-snooze with null / a past time.
 * Snoozing counts as looking at the PR now, so it comes back unseen only when
 * someone acted after the snooze started. Extending keeps the original start;
 * un-snoozing early restores the previous seen time (unless the user looked
 * at it meanwhile).
 */
export function snoozeState(state: InboxState, key: string, until: string | null, nowIso: string): InboxState {
  const nowMs = time(nowIso);
  const snoozes = { ...state.snoozes };
  const seen = { ...state.seen };
  const current = snoozes[key];
  const untilMs = until ? time(until) : 0;
  if (untilMs > nowMs) {
    const end = new Date(Math.min(untilMs, nowMs + SNOOZE_MAX_MS)).toISOString();
    if (current && time(current.until) > nowMs) {
      snoozes[key] = { ...current, until: end };
    } else {
      snoozes[key] = { until: end, at: nowIso, prevSeen: seen[key] ?? null };
      seen[key] = nowIso;
    }
  } else if (current) {
    delete snoozes[key];
    if (time(current.until) > nowMs && seen[key] === current.at) {
      if (current.prevSeen) seen[key] = current.prevSeen;
      else delete seen[key];
    }
  }
  const applied = applySeen(state.items, seen, nowIso);
  return { ...state, items: applied.items, seen: applied.seen, snoozes };
}

export function pinState(state: InboxState, key: string, pinned: boolean, nowIso: string): InboxState {
  const pins = { ...state.pins };
  if (pinned) pins[key] = pins[key] ?? { at: nowIso, lastInInbox: nowIso };
  else delete pins[key];
  return { ...state, pins };
}

/** Drop ended snoozes and pins of PRs gone from the inbox for > 30 days; refresh lastInInbox. */
export function pruneMarks(state: InboxState, nowIso: string): InboxState {
  const nowMs = time(nowIso);
  const present = new Set(state.items.map((i) => seenKey(i.url)));
  const snoozes: Record<string, Snooze> = {};
  for (const [key, s] of Object.entries(state.snoozes ?? {})) if (time(s.until) > nowMs) snoozes[key] = s;
  const pins: Record<string, Pin> = {};
  for (const [key, p] of Object.entries(state.pins ?? {})) {
    if (present.has(key)) pins[key] = { ...p, lastInInbox: nowIso };
    else if (nowMs - time(p.lastInInbox) <= PIN_MAX_ABSENT_MS) pins[key] = p;
  }
  return { ...state, snoozes, pins };
}

/** Earliest active snooze end (epoch ms), or null. */
export function nextSnoozeEnd(state: InboxState | null, nowMs: number): number | null {
  const ends = Object.values(state?.snoozes ?? {})
    .map((s) => time(s.until))
    .filter((t) => t > nowMs);
  return ends.length ? Math.min(...ends) : null;
}
