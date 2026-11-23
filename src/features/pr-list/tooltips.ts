// Better GHub - Tooltip bodies for PR list chips (built lazily on show).

import { h } from '../../core/dom';
import { icon } from '../../core/icons';
import { t } from '../../i18n';
import { formatNumber, tNodes, tPlural } from '../../ui/format';
import { relativeTime } from '../../ui/time';
import type { Reviewer, RowModel } from './analyze';

/** Only GitHub's avatar CDN; sized for 2x displays. */
export function avatarSrc(url: string | null, size = 32): string | null {
  if (!url || !url.startsWith('https://avatars.githubusercontent.com/')) return null;
  return `${url}${url.includes('?') ? '&' : '?'}s=${size}`;
}

function title(text: string): HTMLElement {
  return h('div', { class: 'bghub-tooltip-title', text });
}

export function sizeTooltip(model: RowModel): Node {
  const { bucket, additions, deletions, changedFiles } = model.size;
  return h(
    'div',
    null,
    title(t('prlSizeTooltip', 'Size $1 · $2 lines changed', [bucket, formatNumber(additions + deletions)])),
    h('div', null, tPlural('prlFilesChanged', changedFiles, '$1 file changed', '$1 files changed'))
  );
}

export function unresolvedTooltip(model: RowModel): Node {
  const { total, outdated, byAuthor } = model.unresolved;
  const rows = byAuthor.map((a) =>
    h(
      'li',
      { class: 'bghub-tooltip-row' },
      h('span', { class: 'bghub-tooltip-name', text: a.login }),
      h('span', { class: 'bghub-tooltip-count', text: formatNumber(a.count) }),
      a.outdated ? h('span', { class: 'bghub-tooltip-muted', text: t('prlOutdatedCount', '($1 outdated)', formatNumber(a.outdated)) }) : null
    )
  );
  return h(
    'div',
    null,
    title(tPlural('prlUnresolved', total, '$1 unresolved thread', '$1 unresolved threads')),
    h('div', { class: 'bghub-tooltip-muted', text: t('prlThreadsStartedBy', 'Started by') }),
    h('ul', { class: 'bghub-tooltip-list' }, rows),
    outdated ? h('div', { class: 'bghub-tooltip-muted', text: t('prlOutdatedNote', '$1 on outdated code', formatNumber(outdated)) }) : null
  );
}

function reviewerRow(r: Reviewer): HTMLElement {
  if (r.kind === 'team') {
    return h('li', { class: 'bghub-tooltip-row' }, icon('people', 16, 'bghub-tooltip-avatar'), h('span', { class: 'bghub-tooltip-name', text: r.name }));
  }
  const src = avatarSrc(r.avatarUrl);
  return h(
    'li',
    { class: 'bghub-tooltip-row' },
    src
      ? h('img', { class: 'bghub-tooltip-avatar', attrs: { src, alt: '', width: 16, height: 16, loading: 'lazy', decoding: 'async' } })
      : icon('person', 16, 'bghub-tooltip-avatar'),
    h('span', { class: 'bghub-tooltip-name', text: r.login })
  );
}

export function reviewTooltip(model: RowModel): Node {
  const { viewerRequested, reviewers, requestedAt } = model.review;
  const intro =
    viewerRequested && requestedAt
      ? h('div', null, ...tNodes('prlYourReviewTooltip', 'Your review was requested $1', [relativeTime(requestedAt)]))
      : null;
  return h(
    'div',
    null,
    intro,
    title(t('prlReviewersTitle', 'Requested reviewers')),
    h('ul', { class: 'bghub-tooltip-list' }, reviewers.map(reviewerRow))
  );
}
