// Better GHub - One pull request row in the dashboard card.

import { h } from '../../core/dom';
import { icon, type IconName } from '../../core/icons';
import type { InboxItem } from '../../core/messages';
import { t } from '../../i18n';
import { formatNumber, tPlural } from '../../ui/format';
import { relativeTime } from '../../ui/time';

type Tone = 'success' | 'danger' | 'attention' | 'muted' | 'done';

/** Status glyph with an accessible name (role=img) and a native title. */
function status(name: IconName, tone: Tone, label: string, text?: string): HTMLElement {
  return h(
    'span',
    { class: `bghub-dash-status bghub-dash-status--${tone}`, attrs: { role: 'img', 'aria-label': label, title: label } },
    icon(name, 16),
    text ? h('span', { attrs: { 'aria-hidden': 'true' }, text }) : null
  );
}

function checksStatus(item: InboxItem): HTMLElement | null {
  switch (item.checks) {
    case 'SUCCESS':
      return status('check', 'success', t('dashChecksSuccess', 'Checks passing'));
    case 'FAILURE':
    case 'ERROR':
      return status('x', 'danger', t('dashChecksFailure', 'Checks failing'));
    case 'PENDING':
    case 'EXPECTED':
      return status('dot-fill', 'attention', t('dashChecksPending', 'Checks running'));
    default:
      return null;
  }
}

function reviewStatus(item: InboxItem): HTMLElement | null {
  switch (item.reviewDecision) {
    case 'APPROVED':
      return status('check-circle', 'success', t('dashApproved', 'Approved'));
    case 'CHANGES_REQUESTED':
      return status('file-diff', 'danger', t('dashChangesRequested', 'Changes requested'));
    case 'REVIEW_REQUIRED':
      return status('eye', 'muted', t('dashReviewRequired', 'Review required'));
    default:
      return null;
  }
}

export function renderRow(item: InboxItem, onOpen: (url: string) => void): HTMLLIElement {
  const prIcon = item.isDraft
    ? h('span', { class: 'bghub-dash-pr-icon bghub-dash-pr-icon--draft', attrs: { role: 'img', 'aria-label': t('dashDraft', 'Draft pull request') } }, icon('git-pull-request-draft', 16))
    : h('span', { class: 'bghub-dash-pr-icon bghub-dash-pr-icon--open', attrs: { role: 'img', 'aria-label': t('dashOpenPR', 'Open pull request') } }, icon('git-pull-request', 16));

  const open = (): void => onOpen(item.url);
  // Inbox data comes from the GitHub API; still never trust it as a URL scheme.
  const href = item.url.startsWith('https://github.com/') ? item.url : `https://github.com/${item.repo}/pull/${item.number}`;
  const statuses = [
    checksStatus(item),
    reviewStatus(item),
    item.hasConflicts ? status('alert', 'danger', t('dashConflicts', 'Merge conflicts')) : null,
    item.unresolvedThreads
      ? status('comment-discussion', 'attention', tPlural('prlUnresolved', item.unresolvedThreads, '$1 unresolved thread', '$1 unresolved threads'), formatNumber(item.unresolvedThreads))
      : null,
  ];

  return h(
    'li',
    { class: `bghub-dash-row${item.unseen ? ' bghub-dash-row--unseen' : ''}` },
    item.unseen ? h('span', { class: 'bghub-dash-dot' }, h('span', { class: 'bghub-sr-only', text: t('dashNew', 'New activity') })) : null,
    prIcon,
    h(
      'div',
      { class: 'bghub-dash-main' },
      h(
        'div',
        { class: 'bghub-dash-meta' },
        h('a', { class: 'bghub-dash-repo', attrs: { href: `https://github.com/${item.repo}` }, text: item.repo }),
        h('span', { class: 'bghub-dash-number', text: `#${item.number}` }),
        item.reasons.includes('review-requested')
          ? h('span', { class: 'bghub-dash-reason', text: t('dashReviewRequested', 'Review requested') })
          : null
      ),
      h('a', {
        class: 'bghub-dash-title',
        attrs: { href },
        text: item.title,
        on: { click: open, auxclick: open },
      })
    ),
    h(
      'div',
      { class: 'bghub-dash-side' },
      h('span', { class: 'bghub-dash-statuses' }, statuses),
      item.updatedAt ? relativeTime(item.updatedAt, { micro: true, className: 'bghub-time bghub-dash-time' }) : null
    )
  );
}

export function renderSkeletonRow(): HTMLLIElement {
  return h(
    'li',
    { class: 'bghub-dash-row bghub-dash-row--skeleton', attrs: { 'aria-hidden': 'true' } },
    h('span', { class: 'bghub-skeleton bghub-dash-skel-icon' }),
    h(
      'div',
      { class: 'bghub-dash-main' },
      h('span', { class: 'bghub-skeleton', style: { width: '30%' } }),
      h('span', { class: 'bghub-skeleton', style: { width: '75%' } })
    )
  );
}
