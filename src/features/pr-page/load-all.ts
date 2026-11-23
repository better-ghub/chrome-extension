// Better GHub - PR page: "Load all" for the hidden timeline items.
//
// Clicks GitHub's own "Load more" button again and again until none is left,
// waiting for each batch. Only that one button is ever clicked. The extra
// "Load all" button is re-inserted next to it after every React re-render.

import { h, observe } from '../../core/dom';
import { t } from '../../i18n';
import type { ActionContext } from './actions/types';
import { loadedSoFar, MAX_ROUNDS, remainingFrom } from './load-all-model';
import type { Toaster } from './toast';

/** New React timeline first, classic (`.js-discussion`) pagination as fallback. */
// Classic PR markup: one form holding two submit buttons ("N hidden items" and "Load more…").
const MORE_SELECTORS = [
  'button[data-testid^="issue-timeline-load-more-load-"]',
  '.js-discussion form.ajax-pagination-form button.ajax-pagination-btn[data-disable-with]',
  '.js-discussion form.ajax-pagination-form button.ajax-pagination-btn',
];
const COUNT_SELECTOR = '[data-testid^="issue-timeline-load-more-count"]';
const BATCH_TIMEOUT_MS = 20000;
const POLL_MS = 150;

export interface LoadAll {
  run(ctx?: Pick<ActionContext, 'toasts' | 'binding'>): Promise<void>;
  isRunning(): boolean;
}

export function findLoadMore(root: ParentNode = document): HTMLButtonElement | null {
  for (const s of MORE_SELECTORS) {
    const el = root.querySelector<HTMLButtonElement>(s);
    if (el) return el;
  }
  return null;
}

function countText(btn: Element): string | null {
  const scope = btn.closest('[data-testid^="issue-timeline-load-more-wrapper"]') ?? btn.closest('form') ?? btn.parentElement;
  return scope?.querySelector(COUNT_SELECTOR)?.textContent ?? scope?.textContent ?? null;
}

/** Changes whenever a batch has landed (new button, new count or more timeline nodes). */
function signature(btn: Element): string {
  return `${countText(btn) ?? ''}|${document.querySelectorAll('.js-timeline-item, [data-wrapper-timeline-id]').length}`;
}

export function createLoadAll(signal: AbortSignal): LoadAll {
  let running = false;
  const url = location.pathname;
  const cancelled = (): boolean => signal.aborted || location.pathname !== url;

  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  /** Resolves true when the batch behind `btn` has loaded (or the button is gone). */
  async function waitBatch(btn: HTMLButtonElement, before: string): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < BATCH_TIMEOUT_MS) {
      await sleep(POLL_MS);
      if (cancelled()) return false;
      if (!btn.isConnected || signature(btn) !== before) {
        await sleep(POLL_MS); // let React settle before looking for the next button
        return true;
      }
    }
    return false;
  }

  async function run(ctx?: Pick<ActionContext, 'toasts' | 'binding'>): Promise<void> {
    const toasts: Toaster | undefined = ctx?.toasts;
    const binding = ctx?.binding ?? null;
    if (running) return;
    if (!findLoadMore()) {
      toasts?.show(t('prPageLoadAllNone', 'Nothing hidden: the whole conversation is already loaded'), { variant: 'info', binding, id: 'load-all' });
      return;
    }
    running = true;
    try {
      const initial = remainingFrom(countText(findLoadMore() as Element));
      let rounds = 0;
      for (; rounds < MAX_ROUNDS; rounds++) {
        const btn = findLoadMore();
        if (!btn) break;
        const remaining = remainingFrom(countText(btn));
        const loaded = loadedSoFar(initial, remaining);
        toasts?.show(
          initial !== null && loaded !== null
            ? t('prPageLoadAllProgress', 'Loaded $1 of ~$2 items…', [String(loaded), String(initial)])
            : t('prPageLoadAllProgressBatches', 'Loading more items… (batch $1)', String(rounds + 1)),
          { variant: 'info', id: 'load-all', duration: 4000 }
        );
        const before = signature(btn);
        btn.click();
        if (!(await waitBatch(btn, before))) {
          if (!cancelled()) toasts?.show(t('prPageLoadAllTimeout', 'GitHub did not respond. Try again.'), { variant: 'warning', id: 'load-all' });
          return;
        }
      }
      if (cancelled()) return;
      toasts?.show(
        findLoadMore()
          ? t('prPageLoadAllCapped', 'Stopped after $1 rounds. Run it again to load more.', String(rounds))
          : t('prPageLoadAllDone', 'Loaded the whole conversation'),
        { variant: findLoadMore() ? 'warning' : 'success', binding, id: 'load-all' }
      );
    } finally {
      running = false;
    }
  }

  return { run, isRunning: () => running };
}

/** Keeps a "Load all" button next to GitHub's "Load more" while it exists. */
export function mountLoadAllButton(signal: AbortSignal, loadAll: LoadAll, toasts: Toaster): void {
  const ensure = (): void => {
    const more = findLoadMore();
    if (!more) {
      document.querySelectorAll('.bghub-load-all').forEach((el) => el.remove());
      return;
    }
    if (more.nextElementSibling?.classList.contains('bghub-load-all')) return;
    more.parentElement?.querySelectorAll('.bghub-load-all').forEach((el) => el.remove());
    more.after(
      h('button', {
        class: 'bghub-load-all',
        attrs: { type: 'button', 'data-bghub': '' },
        text: t('prPageLoadAll', 'Load all'),
        on: {
          click: (ev) => {
            ev.preventDefault();
            void loadAll.run({ toasts, binding: null });
          },
        },
      })
    );
  };
  ensure();
  observe(document.body, ensure, signal);
  signal.addEventListener('abort', () => document.querySelectorAll('.bghub-load-all').forEach((el) => el.remove()), { once: true });
}
