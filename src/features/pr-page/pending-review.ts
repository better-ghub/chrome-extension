// Better GHub - PR page: warning about an unsubmitted (pending) review.
//
// GitHub keeps a pending review until "Submit review" and shows it only to its
// author, so a read-only query for `reviews(states: PENDING)` yields the
// viewer's own draft. Runs once per mount; silent when the API is unavailable.

import { h } from '../../core/dom';
import { icon } from '../../core/icons';
import { sendToBackground } from '../../core/messages';
import { prUrl, type PageContext } from '../../core/page';
import { plural } from '../../pages/format';
import { t } from '../../i18n';
import type { Toaster } from './toast';

export const PENDING_REVIEW_QUERY = `query BghubPendingReview($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) { reviews(states: PENDING, first: 1) { nodes { comments { totalCount } } } }
  }
}`;

/** Comments in the viewer's pending review, or 0 (none / empty draft / unexpected shape). */
export function pendingCommentsFrom(data: unknown): number {
  const repo = (data as { repository?: { pullRequest?: { reviews?: { nodes?: unknown } } | null } | null } | null)?.repository;
  const nodes = repo?.pullRequest?.reviews?.nodes;
  if (!Array.isArray(nodes) || !nodes[0]) return 0;
  const count = (nodes[0] as { comments?: { totalCount?: unknown } | null }).comments?.totalCount;
  return typeof count === 'number' && count > 0 ? count : 0;
}

/** Where the notice goes: right below the PR header (classic and React markup). */
const HEADER_SELECTORS = ['#partial-discussion-header', '.gh-header', '[data-testid="issue-header"]', '[data-component="PH_Title"]'];

const messageFor = (comments: number): string =>
  plural('prPendingReview', comments, {
    one: 'You have an unsubmitted review with $1 comment',
    other: 'You have an unsubmitted review with $1 comments',
  });

function noticeNode(comments: number, filesUrl: string, onDismiss: () => void): HTMLElement {
  const message = messageFor(comments);
  return h(
    'div',
    { class: 'bghub-pending-notice', attrs: { role: 'status', 'data-bghub': '' } },
    icon('alert', 16, 'bghub-pending-icon'),
    h('span', { class: 'bghub-pending-text', text: message }),
    h('a', { class: 'bghub-pending-link', text: t('prPendingReviewOpen', 'Open Files changed'), attrs: { href: filesUrl } }),
    h('button', {
      class: 'bghub-pending-dismiss',
      text: '×',
      attrs: { type: 'button', 'aria-label': t('prPendingReviewDismiss', 'Dismiss') },
      on: { click: onDismiss },
    })
  );
}

/** Last answer per PR url, so a settings remount neither refetches nor resurrects a dismissed notice. */
const known = new Map<string, { comments: number; dismissed: boolean }>();

export function mountPendingReview(opts: { page: PageContext; signal: AbortSignal; toasts: Toaster; fresh: boolean }): void {
  const { page, signal, toasts } = opts;
  const url = prUrl(page);
  if (!url || !page.owner || !page.repo || typeof page.number !== 'number') return;
  const variables = { owner: page.owner, name: page.repo, number: page.number };
  const filesUrl = `${url}/files`;

  const show = (comments: number): void => {
    if (signal.aborted || !comments || known.get(url)?.dismissed) return;
    known.set(url, { comments, dismissed: false });
    const anchor = HEADER_SELECTORS.map((s) => document.querySelector(s)).find((el): el is Element => !!el);
    if (!anchor) {
      toasts.show(messageFor(comments), {
        variant: 'warning',
        icon: 'alert',
        id: 'pending-review',
        action: { label: t('prPendingReviewOpen', 'Open Files changed'), run: () => location.assign(filesUrl) },
      });
      return;
    }
    const node = noticeNode(comments, filesUrl, () => {
      known.set(url, { comments, dismissed: true });
      node.remove();
    });
    anchor.after(node);
    signal.addEventListener('abort', () => node.remove(), { once: true });
  };

  const cached = known.get(url);
  if (cached && !opts.fresh) {
    show(cached.comments);
    return;
  }
  known.delete(url);

  void sendToBackground('api:graphql', { query: PENDING_REVIEW_QUERY, variables, owner: page.owner, noCache: true }, { ok: false, error: 'unavailable' }).then(
    (res) => {
      if (signal.aborted || !res.ok) return;
      show(pendingCommentsFrom(res.data));
    }
  );
}
