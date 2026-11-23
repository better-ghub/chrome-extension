// Better GHub - Quick filters for the PR list (pure, unit-tested).
//
// Client-side only: they act on the rows of the current page whose data has
// loaded. Several active filters combine with AND.

import type { RowModel } from './analyze';

export type QuickFilter = 'review' | 'ready' | 'conflicts' | 'stale' | 'hideDrafts';

export const QUICK_FILTERS: readonly QuickFilter[] = ['review', 'ready', 'conflicts', 'stale', 'hideDrafts'];

export function matchesFilter(m: RowModel, filter: QuickFilter): boolean {
  switch (filter) {
    case 'review':
      return m.review.viewerRequested;
    case 'ready':
      return m.ready;
    case 'conflicts':
      return m.conflicts;
    case 'stale':
      return m.stale;
    case 'hideDrafts':
      return !m.isDraft;
  }
}

/**
 * Whether a row stays visible. With no active filter everything does; with
 * one, rows without data yet (loading / unreadable) can't be judged and hide.
 */
export function rowVisible(m: RowModel | null, active: ReadonlySet<QuickFilter>): boolean {
  if (!active.size) return true;
  if (!m) return false;
  for (const filter of active) if (!matchesFilter(m, filter)) return false;
  return true;
}

export type FilterCounts = Record<QuickFilter, number>;

/**
 * Per-chip counts over the loaded rows, each filter on its own (so a chip
 * says how many rows it would keep). 'hideDrafts' counts the drafts it hides.
 */
export function filterCounts(models: readonly RowModel[]): FilterCounts {
  const counts: FilterCounts = { review: 0, ready: 0, conflicts: 0, stale: 0, hideDrafts: 0 };
  for (const m of models) {
    if (m.review.viewerRequested) counts.review++;
    if (m.ready) counts.ready++;
    if (m.conflicts) counts.conflicts++;
    if (m.stale) counts.stale++;
    if (m.isDraft) counts.hideDrafts++;
  }
  return counts;
}

/** Toggle one filter; returns a new set. */
export function toggleFilter(active: ReadonlySet<QuickFilter>, filter: QuickFilter): Set<QuickFilter> {
  const next = new Set(active);
  if (next.has(filter)) next.delete(filter);
  else next.add(filter);
  return next;
}
