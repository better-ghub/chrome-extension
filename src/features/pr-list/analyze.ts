// Better GHub - GraphQL pull request → row model (pure, unit-tested).

import type { ChecksState, ReviewDecision } from '../../core/messages';
import { daysSince, isReady, isStale } from '../../core/readiness';
import { suggestLabels, type LabelId } from './labels';

interface Login {
  login?: string | null;
}
interface Nodes<T> {
  nodes?: (T | null)[] | null;
}

export interface RawPR {
  number?: number;
  url?: string;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  mergeable?: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN' | string;
  reviewDecision?: string | null;
  isDraft?: boolean;
  createdAt?: string;
  updatedAt?: string;
  author?: Login | null;
  commits?: Nodes<{
    commit?: {
      committedDate?: string;
      messageHeadline?: string;
      statusCheckRollup?: { state?: string | null } | null;
      author?: { name?: string | null; user?: Login | null } | null;
    };
  }>;
  reviewRequests?: Nodes<{
    requestedReviewer?: { __typename?: string; login?: string; avatarUrl?: string; name?: string; slug?: string } | null;
  }>;
  timelineItems?: Nodes<{ createdAt?: string; requestedReviewer?: { __typename?: string; login?: string } | null }>;
  comments?: Nodes<{ author?: Login | null; createdAt?: string }>;
  reviews?: Nodes<{ author?: Login | null; submittedAt?: string | null; state?: string }>;
  reviewThreads?: Nodes<{ isResolved?: boolean; isOutdated?: boolean; comments?: Nodes<{ author?: Login | null }> }>;
  files?: Nodes<{ path?: string }>;
}

export type SizeBucket = 'XS' | 'S' | 'M' | 'L' | 'XL';
export type Reviewer = { kind: 'user'; login: string; avatarUrl: string | null } | { kind: 'team'; name: string; slug: string };
export type ActivityKind = 'commit' | 'comment' | 'approved' | 'changes' | 'reviewed';

export interface Activity {
  kind: ActivityKind;
  actor: string;
  at: string;
}

export interface ThreadAuthor {
  login: string;
  count: number;
  outdated: number;
}

export interface RowModel {
  url: string;
  isDraft: boolean;
  size: { bucket: SizeBucket; additions: number; deletions: number; changedFiles: number };
  conflicts: boolean;
  /** Unresolved review threads; outdated-but-unresolved threads are counted too. */
  unresolved: { total: number; outdated: number; byAuthor: ThreadAuthor[] };
  review: { viewerRequested: boolean; reviewers: Reviewer[]; requestedAt: string | null };
  lastActivity: Activity | null;
  /** null when label suggestions are disabled. */
  labels: LabelId[] | null;
  /** Combined status of the last commit's checks (null = no checks). */
  checks: ChecksState;
  reviewDecision: ReviewDecision;
  /** Approved, checks green, no conflicts / unresolved threads, not a draft. */
  ready: boolean;
  /** Whole days since the last activity (or the last update). */
  idleDays: number;
  /** No activity for settings.staleDays days. */
  stale: boolean;
}

export interface AnalyzeOptions {
  /** settings.staleDays (0 = never stale). */
  staleDays?: number;
  now?: number;
}

const CHECK_STATES: readonly NonNullable<ChecksState>[] = ['SUCCESS', 'FAILURE', 'PENDING', 'ERROR', 'EXPECTED'];
const REVIEW_DECISIONS: readonly NonNullable<ReviewDecision>[] = ['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED'];

export function checksState(pr: RawPR): ChecksState {
  const state = nodes(pr.commits)[0]?.commit?.statusCheckRollup?.state;
  return CHECK_STATES.includes(state as NonNullable<ChecksState>) ? (state as ChecksState) : null;
}

function reviewDecision(pr: RawPR): ReviewDecision {
  return REVIEW_DECISIONS.includes(pr.reviewDecision as NonNullable<ReviewDecision>) ? (pr.reviewDecision as ReviewDecision) : null;
}

const nodes = <T>(c: Nodes<T> | null | undefined): T[] => (c?.nodes ?? []).filter((n): n is T => !!n);
const time = (iso: string | null | undefined): number => (iso ? Date.parse(iso) || 0 : 0);
const same = (a: string | null | undefined, b: string): boolean => !!a && !!b && a.toLowerCase() === b.toLowerCase();

export function sizeBucket(changedLines: number): SizeBucket {
  if (changedLines < 10) return 'XS';
  if (changedLines < 100) return 'S';
  if (changedLines < 500) return 'M';
  if (changedLines < 1000) return 'L';
  return 'XL';
}

function reviewKind(state: string | undefined): ActivityKind {
  if (state === 'APPROVED') return 'approved';
  if (state === 'CHANGES_REQUESTED') return 'changes';
  return 'reviewed';
}

/** Most recent of: last commit, last conversation comment, last submitted review. */
export function lastActivity(pr: RawPR): Activity | null {
  const candidates: Activity[] = [];
  const commit = nodes(pr.commits)[0]?.commit;
  if (commit?.committedDate) {
    candidates.push({ kind: 'commit', actor: commit.author?.user?.login ?? commit.author?.name ?? '', at: commit.committedDate });
  }
  const comment = nodes(pr.comments)[0];
  if (comment?.createdAt) candidates.push({ kind: 'comment', actor: comment.author?.login ?? 'ghost', at: comment.createdAt });
  const review = nodes(pr.reviews)[0];
  if (review?.submittedAt) candidates.push({ kind: reviewKind(review.state), actor: review.author?.login ?? 'ghost', at: review.submittedAt });
  candidates.sort((a, b) => time(b.at) - time(a.at));
  return candidates[0] ?? null;
}

export function unresolvedThreads(pr: RawPR): RowModel['unresolved'] {
  const byAuthor = new Map<string, ThreadAuthor>();
  let total = 0;
  let outdated = 0;
  for (const thread of nodes(pr.reviewThreads)) {
    if (thread.isResolved !== false) continue;
    total++;
    if (thread.isOutdated) outdated++;
    const login = nodes(thread.comments)[0]?.author?.login ?? 'ghost';
    const entry = byAuthor.get(login) ?? { login, count: 0, outdated: 0 };
    entry.count++;
    if (thread.isOutdated) entry.outdated++;
    byAuthor.set(login, entry);
  }
  const list = [...byAuthor.values()].sort((a, b) => b.count - a.count || a.login.localeCompare(b.login));
  return { total, outdated, byAuthor: list };
}

export function reviewState(pr: RawPR, viewer: string): RowModel['review'] {
  const reviewers: Reviewer[] = [];
  for (const { requestedReviewer: r } of nodes(pr.reviewRequests)) {
    if (r?.__typename === 'User' && r.login) reviewers.push({ kind: 'user', login: r.login, avatarUrl: r.avatarUrl ?? null });
    else if (r?.__typename === 'Team' && r.name) reviewers.push({ kind: 'team', name: r.name, slug: r.slug ?? '' });
  }
  // Only direct (user) requests are attributable: team membership is unknown here.
  const viewerRequested = reviewers.some((r) => r.kind === 'user' && same(r.login, viewer));
  const events = nodes(pr.timelineItems).filter((e) => e.createdAt).sort((a, b) => time(b.createdAt) - time(a.createdAt));
  const mine = events.find((e) => e.requestedReviewer?.__typename === 'User' && same(e.requestedReviewer.login, viewer));
  const requestedAt = (viewerRequested ? mine ?? events[0] : events[0])?.createdAt ?? null;
  return { viewerRequested, reviewers, requestedAt: reviewers.length ? requestedAt : null };
}

export function analyzePR(pr: RawPR, viewer: string, withLabels: boolean, opts: AnalyzeOptions = {}): RowModel {
  const now = opts.now ?? Date.now();
  const additions = pr.additions ?? 0;
  const deletions = pr.deletions ?? 0;
  const changedFiles = pr.changedFiles ?? 0;
  let labels: LabelId[] | null = null;
  if (withLabels) {
    const paths = nodes(pr.files).map((f) => f.path ?? '').filter(Boolean);
    labels = suggestLabels(paths, paths.length >= changedFiles);
  }
  const isDraft = !!pr.isDraft;
  const conflicts = pr.mergeable === 'CONFLICTING';
  const unresolved = unresolvedThreads(pr);
  const activity = lastActivity(pr);
  const checks = checksState(pr);
  const decision = reviewDecision(pr);
  const lastAt = activity?.at ?? pr.updatedAt ?? null;
  return {
    url: pr.url ?? '',
    isDraft,
    size: { bucket: sizeBucket(additions + deletions), additions, deletions, changedFiles },
    conflicts,
    unresolved,
    review: reviewState(pr, viewer),
    lastActivity: activity,
    labels,
    checks,
    reviewDecision: decision,
    ready: isReady({ isDraft, reviewDecision: decision, checks, hasConflicts: conflicts, unresolvedThreads: unresolved.total }),
    idleDays: daysSince(lastAt, now),
    stale: isStale(lastAt, opts.staleDays ?? 0, now),
  };
}

export interface ListSummary {
  needYourReview: number;
  ready: number;
  conflicts: number;
  unresolvedThreads: number;
}

export function summarize(models: RowModel[]): ListSummary {
  return {
    needYourReview: models.filter((m) => m.review.viewerRequested).length,
    ready: models.filter((m) => m.ready).length,
    conflicts: models.filter((m) => m.conflicts).length,
    unresolvedThreads: models.reduce((n, m) => n + m.unresolved.total, 0),
  };
}
