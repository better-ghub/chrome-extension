// Better GHub - Which inbox items the dashboard card shows (pure, unit-tested).

import type { InboxItem } from '../../core/messages';

export const MAX_ROWS = 6;

const time = (iso: string | null | undefined): number => (iso ? Date.parse(iso) || 0 : 0);

/**
 * Review requests first (newest request first), then the user's own and
 * assigned PRs by last update. Capped at `max`.
 */
export function pickDashboardItems(items: InboxItem[], max = MAX_ROWS): InboxItem[] {
  const isReview = (i: InboxItem): boolean => i.reasons.includes('review-requested');
  const reviews = items
    .filter(isReview)
    .sort((a, b) => time(b.reviewRequestedAt ?? b.updatedAt) - time(a.reviewRequestedAt ?? a.updatedAt));
  const rest = items.filter((i) => !isReview(i)).sort((a, b) => time(b.updatedAt) - time(a.updatedAt));
  return [...reviews, ...rest].slice(0, max);
}
