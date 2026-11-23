// Better GHub - Where to put the card on the github.com dashboard.
//
// The logged-in dashboard markup changes often and could not be verified, so
// we try known anchors in order, wait at most 8 s (once — the old code retried
// every second forever), and otherwise give up silently.

import { waitFor } from '../../core/dom';

const CANDIDATES = ['feed-container', '#dashboard .news', '[data-testid*="feed"]', 'main .dashboard'];
const TIMEOUT_MS = 8_000;
/** `[data-testid*="feed"]` also matches small controls (filter buttons…). */
const MIN_WIDTH = 280;

export interface Anchor {
  insert(card: HTMLElement): void;
}

function wideEnough(el: Element): boolean {
  const w = el.getBoundingClientRect().width;
  return w === 0 || w >= MIN_WIDTH; // 0 = not laid out yet: accept
}

/** Synchronous lookup (used again if GitHub re-renders the card away). */
export function resolveAnchor(): Anchor | null {
  for (const sel of CANDIDATES) {
    const el = [...document.querySelectorAll(sel)].find(wideEnough);
    if (el) return { insert: (card) => el.before(card) };
  }
  const column = document.querySelector('main')?.firstElementChild;
  if (column) return { insert: (card) => column.prepend(card) };
  return null;
}

export async function findAnchor(signal: AbortSignal): Promise<Anchor | null> {
  await waitFor(CANDIDATES.join(', '), { signal, timeout: TIMEOUT_MS });
  if (signal.aborted) return null;
  return resolveAnchor();
}
