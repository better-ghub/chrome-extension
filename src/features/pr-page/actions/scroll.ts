// Better GHub - PR page: scroll helpers (anchoring + jumping).

import { prefersReducedMotion } from '../../../core/dom';

/**
 * Line below GitHub's sticky chrome (global header ~64px, sticky PR title /
 * Files toolbar, sticky file headers). Positions above it are covered.
 */
const STICKY_LINE = 120;

/**
 * Where a jumped-to element should land: ~20% down the viewport, clamped.
 * Deep enough to clear every sticky header stack on both tabs, high enough
 * to show most of a review thread.
 */
export function jumpOffset(): number {
  const vh = typeof window.innerHeight === 'number' && window.innerHeight > 0 ? window.innerHeight : 800;
  return Math.round(Math.min(Math.max(vh * 0.2, 96), 180));
}

interface Anchor {
  el: Element;
  top: number;
}

/** First element (document order) that reaches below the sticky line. */
function captureAnchor(els: readonly Element[]): Anchor | null {
  if (!(window.scrollY > 0)) return null;
  for (const el of els) {
    if (!el.getClientRects().length) continue;
    const r = el.getBoundingClientRect();
    if (r.bottom > STICKY_LINE) return { el, top: r.top };
  }
  return null;
}

function restoreAnchor(a: Anchor): void {
  if (!a.el.isConnected || !a.el.getClientRects().length) return;
  // If we were inside the item (its top scrolled away), park its header just
  // below the sticky chrome; otherwise keep it exactly where it was.
  const desired = a.top < 0 ? STICKY_LINE - 40 : a.top;
  const delta = a.el.getBoundingClientRect().top - desired;
  if (Math.abs(delta) > 1) window.scrollBy({ top: delta, behavior: 'instant' });
}

/**
 * Run a bulk toggle without losing the reader's place: collapsing content
 * above or around the viewport would otherwise make the page jump (native
 * scroll anchoring gives up when its anchor node disappears). Re-applied on the
 * next frame for React views that re-render asynchronously.
 */
export function withScrollAnchor<T>(els: readonly Element[], fn: () => T): T {
  const anchor = captureAnchor(els);
  const result = fn();
  if (anchor) {
    restoreAnchor(anchor);
    requestAnimationFrame(() => restoreAnchor(anchor));
  }
  return result;
}

/** Scroll so `el` sits `jumpOffset()` below the top of the viewport. */
export function scrollToElement(el: Element): void {
  const top = el.getBoundingClientRect().top + window.scrollY - jumpOffset();
  try {
    window.scrollTo({ top: Math.max(0, top), behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  } catch {
    /* jsdom / exotic environments */
  }
}

/** Focus for assistive tech without a second scroll; a temporary tabindex is removed on blur. */
export function focusWithoutScroll(el: HTMLElement): void {
  if (!el.hasAttribute('tabindex') && !el.matches('a[href], button, input, select, textarea')) {
    el.setAttribute('tabindex', '-1');
    el.addEventListener('blur', () => el.removeAttribute('tabindex'), { once: true });
  }
  try {
    el.focus({ preventScroll: true });
  } catch {
    /* focus can throw on detached nodes */
  }
}

export interface Highlighter {
  light(el: Element): void;
}

/** One brief highlight at a time (`className` drives a CSS animation); cleared when `signal` aborts. */
export function createHighlighter(className: string, ms: number, signal: AbortSignal): Highlighter {
  let lit: { el: Element; timer: ReturnType<typeof setTimeout> } | null = null;
  const unlight = (): void => {
    if (!lit) return;
    clearTimeout(lit.timer);
    lit.el.classList.remove(className);
    lit = null;
  };
  signal.addEventListener('abort', unlight, { once: true });
  return {
    light(el) {
      unlight();
      void (el as HTMLElement).offsetWidth; // restart the animation on repeat jumps
      el.classList.add(className);
      lit = { el, timer: setTimeout(unlight, ms) };
    },
  };
}
