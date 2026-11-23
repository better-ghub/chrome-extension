// Better GHub - PR page: unresolved review threads (discovery + resolved check).

import { outermost, queryAll, SEL, sortByDocumentOrder } from '../dom-queries';

const RESOLVED_LABEL = /^resolved$/i;
const UNRESOLVE_BUTTON = /^unresolve conversation$/i;

/**
 * Whether a thread is resolved. `data-resolved` is authoritative wherever
 * GitHub renders it (conversation threads, most inline threads); the rest are
 * defensive fallbacks for markup without it: an `.is-resolved` marker, a
 * "Resolved" label in the header, or an "Unresolve conversation" button.
 */
export function isResolved(thread: Element): boolean {
  const own = thread.getAttribute('data-resolved');
  if (own !== null) return own === 'true';
  const marked = thread.closest('[data-resolved]') ?? thread.querySelector('[data-resolved]');
  if (marked) return marked.getAttribute('data-resolved') === 'true';
  if (thread.classList.contains('is-resolved') || thread.querySelector('.is-resolved')) return true;
  for (const el of Array.from(thread.querySelectorAll('.Label, [class*="Label-module__"], [data-testid*="resolved"]'))) {
    if (el.closest(SEL.userContent)) continue;
    if (RESOLVED_LABEL.test((el.textContent ?? '').trim())) return true;
  }
  for (const btn of Array.from(thread.querySelectorAll('button'))) {
    if (UNRESOLVE_BUTTON.test((btn.textContent ?? '').replace(/\s+/g, ' ').trim())) return true;
  }
  return false;
}

/**
 * All unresolved threads in document order, across UI generations. Hidden
 * ones (collapsed file, comments toggled off, outdated wrapper) are included:
 * navigating to them reveals them.
 */
export function collectUnresolvedThreads(root: ParentNode): Element[] {
  const threads = outermost(queryAll<Element>(root, SEL.threadRoots));
  // Classic inline comments without any recognised thread root inside: treat
  // the container itself as the thread.
  const bare = queryAll<Element>(root, SEL.classicInlineComments).filter(
    (c) => !threads.some((t) => c.contains(t) || t.contains(c))
  );
  return sortByDocumentOrder(outermost([...threads, ...bare])).filter((el) => !el.closest('[hidden], template') && !isResolved(el));
}

/**
 * Index of the thread to jump to.
 * - `current` (the thread we jumped to last, if still relevant) → step from it.
 * - otherwise by position: next = first thread below the reading line,
 *   prev = last thread above it. Both wrap around.
 * `tops` are viewport-relative tops in document order; `line` is the reading line.
 */
export function pickThreadIndex(tops: readonly number[], dir: 1 | -1, line: number, current: number | null): number {
  const n = tops.length;
  if (!n) return -1;
  if (current !== null && current >= 0 && current < n) return (((current + dir) % n) + n) % n;
  const EPS = 4;
  if (dir === 1) {
    const i = tops.findIndex((top) => top > line + EPS);
    return i === -1 ? 0 : i;
  }
  for (let i = n - 1; i >= 0; i--) if (tops[i] < line - EPS) return i;
  return n - 1;
}
