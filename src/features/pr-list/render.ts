// Better GHub - PR list chip row (pure DOM builders; no data fetching).

import { h } from '../../core/dom';
import { icon, type IconName } from '../../core/icons';
import { t } from '../../i18n';
import { attachTooltip } from '../../ui/tooltip';
import { attachPopover } from '../../ui/popover';
import { checksPopoverContent } from './checks-popover';
import { formatNumber, tNodes, tPlural } from '../../ui/format';
import { relativeTime } from '../../ui/time';
import type { Activity, ActivityKind, RowModel } from './analyze';
import type { LabelId } from './labels';
import { reviewTooltip, sizeTooltip, unresolvedTooltip } from './tooltips';

const MAX_LABELS = 3;
/** Chips past this index share the last stagger delay (keeps the reveal short). */
const MAX_STAGGER = 2;

type Variant = 'accent' | 'success' | 'attention' | 'danger' | 'done';

interface ChipOptions {
  variant?: Variant;
  icon?: IconName;
  className?: string;
  /** Accessible name for button chips whose visible text is terse. */
  label?: string;
  tooltip?: () => Node;
  signal: AbortSignal;
}

function chip(children: (Node | string)[], o: ChipOptions): HTMLElement {
  const cls = ['bghub-chip', 'bghub-prl-chip', o.variant ? `bghub-chip--${o.variant}` : '', o.className ?? ''].filter(Boolean).join(' ');
  const kids = [o.icon ? icon(o.icon, 12) : null, ...children];
  if (!o.tooltip) return h('span', { class: cls }, ...kids);
  const btn = h('button', { class: `${cls} bghub-prl-chip--button`, attrs: { type: 'button', 'aria-label': o.label } }, ...kids);
  attachTooltip(btn, o.tooltip, o.signal);
  return btn;
}

function reviewChip(m: RowModel, signal: AbortSignal): HTMLElement | null {
  const { viewerRequested, reviewers, requestedAt } = m.review;
  if (viewerRequested) {
    return chip([t('prlYourReview', 'Your review')], { variant: 'done', icon: 'eye', tooltip: () => reviewTooltip(m), signal });
  }
  if (!reviewers.length) return null;
  const text = requestedAt
    ? tNodes('prlReviewRequested', 'Review requested · $1', [relativeTime(requestedAt, { micro: true })])
    : [t('prlReviewRequestedNoTime', 'Review requested')];
  return chip(text, { variant: 'accent', icon: 'code-review', tooltip: () => reviewTooltip(m), signal });
}

function readyChip(m: RowModel, signal: AbortSignal): HTMLElement | null {
  if (!m.ready) return null;
  return chip([t('prlReady', 'Ready to merge')], { variant: 'success', icon: 'check-circle', className: 'bghub-prl-ready', signal });
}

function staleChip(m: RowModel, signal: AbortSignal): HTMLElement | null {
  if (!m.stale) return null;
  const tip = tPlural('prlStaleTooltip', m.idleDays, 'No activity for $1 day', 'No activity for $1 days');
  return chip([t('prlStale', 'Stale · $1d', formatNumber(m.idleDays))], {
    icon: 'hourglass',
    className: 'bghub-prl-stale',
    label: tip,
    tooltip: () => document.createTextNode(tip),
    signal,
  });
}

/** Red "Checks failing" chip; a button opening the list of failed jobs (loaded on first open). */
function checksChip(m: RowModel, signal: AbortSignal): HTMLElement | null {
  if (m.checks !== 'FAILURE' && m.checks !== 'ERROR') return null;
  const text = t('prlChecksFailing', 'Checks failing');
  const btn = h(
    'button',
    { class: 'bghub-chip bghub-prl-chip bghub-chip--danger bghub-prl-chip--button bghub-prl-checks', attrs: { type: 'button', 'aria-label': text } },
    icon('x', 12),
    text
  );
  attachPopover(btn, checksPopoverContent(m.url), t('checksPopoverLabel', 'Failed checks'), signal);
  return btn;
}

function sizeChip(m: RowModel, signal: AbortSignal): HTMLElement {
  const { bucket, additions, deletions } = m.size;
  return chip(
    [
      h('span', { class: 'bghub-prl-size', text: bucket }),
      h('span', { class: 'bghub-prl-add', text: `+${formatNumber(additions, true)}` }),
      h('span', { class: 'bghub-prl-del', text: `−${formatNumber(deletions, true)}` }),
    ],
    {
      className: 'bghub-prl-size-chip',
      label: t('prlSizeLabel', 'Size $1: $2 additions, $3 deletions', [bucket, formatNumber(additions), formatNumber(deletions)]),
      tooltip: () => sizeTooltip(m),
      signal,
    }
  );
}

function unresolvedChip(m: RowModel, signal: AbortSignal): HTMLElement | null {
  const { total } = m.unresolved;
  if (!total) return null;
  return chip([formatNumber(total)], {
    variant: 'attention',
    icon: 'comment-discussion',
    label: tPlural('prlUnresolved', total, '$1 unresolved thread', '$1 unresolved threads'),
    tooltip: () => unresolvedTooltip(m),
    signal,
  });
}

const ACTIVITY: Record<ActivityKind, { icon: IconName; key: string; fallback: string }> = {
  commit: { icon: 'git-commit', key: 'prlActCommit', fallback: '$1 pushed · $2' },
  comment: { icon: 'comment', key: 'prlActComment', fallback: '$1 commented · $2' },
  approved: { icon: 'check', key: 'prlActApproved', fallback: '$1 approved · $2' },
  changes: { icon: 'file-diff', key: 'prlActChanges', fallback: '$1 requested changes · $2' },
  reviewed: { icon: 'eye', key: 'prlActReviewed', fallback: '$1 reviewed · $2' },
};

function activityText(a: Activity): HTMLElement {
  const spec = ACTIVITY[a.kind];
  const actor = h('span', { class: 'bghub-prl-actor', text: a.actor || t('prlSomeone', 'someone') });
  return h(
    'span',
    { class: `bghub-prl-activity bghub-prl-activity--${a.kind}` },
    icon(spec.icon, 12),
    h('span', null, ...tNodes(spec.key, spec.fallback, [actor, relativeTime(a.at, { micro: true })]))
  );
}

const LABEL_TEXT: Record<LabelId, [string, string]> = {
  'needs-tests': ['prlLabelNeedsTests', 'needs tests'],
  'has-tests': ['prlLabelHasTests', 'has tests'],
  styling: ['prlLabelStyling', 'styling'],
  database: ['prlLabelDatabase', 'database'],
  documentation: ['prlLabelDocs', 'docs'],
  infrastructure: ['prlLabelInfra', 'infra'],
  ci: ['prlLabelCi', 'CI'],
  dependencies: ['prlLabelDeps', 'deps'],
  i18n: ['prlLabelI18n', 'i18n'],
  config: ['prlLabelConfig', 'config'],
  api: ['prlLabelApi', 'API'],
  media: ['prlLabelMedia', 'media'],
  build: ['prlLabelBuild', 'build'],
  security: ['prlLabelSecurity', 'security'],
};

export function labelText(id: LabelId): string {
  const [key, fallback] = LABEL_TEXT[id];
  return t(key, fallback);
}

function labels(ids: LabelId[]): HTMLElement[] {
  const prefix = t('prlSuggestedLabel', 'Suggested label:');
  const shown = ids.slice(0, MAX_LABELS).map((id) =>
    h(
      'span',
      { class: `bghub-prl-label${id === 'needs-tests' ? ' bghub-prl-label--attention' : ''}` },
      h('span', { class: 'bghub-sr-only', text: `${prefix} ` }),
      labelText(id)
    )
  );
  const rest = ids.slice(MAX_LABELS);
  if (rest.length) {
    shown.push(
      h(
        'span',
        { class: 'bghub-prl-label bghub-prl-label--more' },
        h('span', { attrs: { 'aria-hidden': 'true' }, text: `+${rest.length}` }),
        h('span', { class: 'bghub-sr-only', text: rest.map((id) => `${prefix} ${labelText(id)}`).join(', ') })
      )
    );
  }
  return shown;
}

/** Chips in priority order: ready → review → conflicts → threads → size → stale → activity → labels. */
export function renderChips(m: RowModel, opts: { signal: AbortSignal; animate: boolean }): HTMLElement[] {
  const { signal } = opts;
  const items = [
    readyChip(m, signal),
    reviewChip(m, signal),
    m.conflicts ? chip([t('prlConflicts', 'Conflicts')], { variant: 'danger', icon: 'alert', signal }) : null,
    checksChip(m, signal),
    unresolvedChip(m, signal),
    sizeChip(m, signal),
    staleChip(m, signal),
    m.lastActivity ? activityText(m.lastActivity) : null,
    ...(m.labels ? labels(m.labels) : []),
  ].filter((x): x is HTMLElement => !!x);
  if (opts.animate) {
    items.forEach((el, i) => {
      el.classList.add('bghub-prl-enter');
      el.style.setProperty('--bghub-i', String(Math.min(i, MAX_STAGGER)));
    });
  }
  return items;
}

/** Height-matched placeholder while the row's data loads (hidden from AT). */
export function renderSkeleton(): HTMLElement {
  return h(
    'span',
    { class: 'bghub-prl-skeleton', attrs: { 'aria-hidden': 'true' } },
    [56, 40, 112].map((w) => h('span', { class: 'bghub-skeleton', style: { width: `${w}px` } }))
  );
}
