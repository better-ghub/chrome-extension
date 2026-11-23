// Better GHub - PR page: jump to next / previous unresolved thread (and to a
// specific one, for the threads panel).

import { t } from '../../../i18n';
import { viewportTop } from '../dom-queries';
import { revealThread } from '../toggles';
import { createHighlighter, focusWithoutScroll, jumpOffset, scrollToElement } from './scroll';
import { collectUnresolvedThreads, pickThreadIndex } from './threads';
import type { ThreadNavigator } from './types';

const HIGHLIGHT_CLASS = 'bghub-thread-focus';
const HIGHLIGHT_MS = 1600;
/** Rapid presses step from the last target even while smooth scrolling is still moving the page. */
const TRUST_MS = 1500;

function inViewport(el: Element): boolean {
  if (!el.getClientRects().length) return false;
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.top < window.innerHeight;
}

export function createThreadNavigator(signal: AbortSignal): ThreadNavigator {
  let last: Element | null = null;
  let trustUntil = 0;
  const highlighter = createHighlighter(HIGHLIGHT_CLASS, HIGHLIGHT_MS, signal);

  /** Expand, scroll to and highlight `thread`; focus it unless the caller keeps focus (panel). */
  const reveal = (thread: Element, opts: { focus?: boolean } = {}): void => {
    const el = thread as HTMLElement;
    revealThread(el);
    last = el;
    trustUntil = Date.now() + TRUST_MS;
    // Measure after expanding (React views re-render on the next frame).
    requestAnimationFrame(() => {
      if (signal.aborted || !el.isConnected) return;
      scrollToElement(el);
      if (opts.focus !== false) focusWithoutScroll(el);
      highlighter.light(el);
    });
  };

  return {
    reveal,
    step(dir, ctx) {
      const threads = collectUnresolvedThreads(document);
      if (!threads.length) {
        last = null;
        ctx.toasts.show(t('prPageNoUnresolved', 'No unresolved threads. Nice work!'), { icon: 'check-circle', binding: ctx.binding, id: 'thread-nav' });
        return;
      }
      const lastIdx = last ? threads.indexOf(last) : -1;
      const current = lastIdx >= 0 && (Date.now() < trustUntil || inViewport(threads[lastIdx])) ? lastIdx : null;
      const idx = pickThreadIndex(threads.map(viewportTop), dir, jumpOffset(), current);
      reveal(threads[idx]);
      ctx.toasts.show(t('prPageThreadPosition', 'Unresolved thread $1 of $2', [String(idx + 1), String(threads.length)]), {
        variant: 'info',
        icon: 'comment-discussion',
        binding: ctx.binding,
        id: 'thread-nav',
      });
    },
  };
}
