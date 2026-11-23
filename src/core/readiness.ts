// Better GHub - Pull request readiness & staleness (pure; shared by the
// background inbox, the PR list chips and the popup).

import type { ChecksState, ReviewDecision } from './messages';

export interface ReadinessInput {
  isDraft: boolean;
  reviewDecision: ReviewDecision;
  checks: ChecksState;
  hasConflicts: boolean;
  unresolvedThreads: number;
}

/**
 * "Ready to merge": approved, checks green (or no checks configured), no merge
 * conflicts, no unresolved review threads, not a draft. Repositories without
 * required reviews report reviewDecision === null; those are NOT treated as
 * approved — we only claim "ready" when a reviewer actually approved.
 */
export function isReady(pr: ReadinessInput): boolean {
  return (
    !pr.isDraft &&
    pr.reviewDecision === 'APPROVED' &&
    (pr.checks === 'SUCCESS' || pr.checks === null) &&
    !pr.hasConflicts &&
    pr.unresolvedThreads === 0
  );
}

/** Whole days since `isoTime` (floored; 0 for future/invalid times). */
export function daysSince(isoTime: string | null | undefined, now = Date.now()): number {
  const t = isoTime ? Date.parse(isoTime) : NaN;
  if (!Number.isFinite(t) || t > now) return 0;
  return Math.floor((now - t) / 86_400_000);
}

/** Stale when the last activity is at least `staleDays` days old (0 disables). */
export function isStale(lastActivityAt: string | null | undefined, staleDays: number, now = Date.now()): boolean {
  if (!staleDays || staleDays <= 0 || !lastActivityAt) return false;
  return daysSince(lastActivityAt, now) >= staleDays;
}
