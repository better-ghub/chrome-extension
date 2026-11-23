// Better GHub - Quick filter chips above the PR list, and the inline "nothing
// matches" row. State lives per mount (a navigation starts unfiltered).

import { h } from '../../core/dom';
import { icon, type IconName } from '../../core/icons';
import { t } from '../../i18n';
import { formatNumber } from '../../ui/format';
import { attachTooltip } from '../../ui/tooltip';
import { QUICK_FILTERS, toggleFilter, type FilterCounts, type QuickFilter } from './filters';

interface FilterSpec {
  icon: IconName;
  label: () => string;
  tooltip: () => string;
  /** "Hide drafts" is a plain toggle without a count. */
  counted: boolean;
}

const SPECS: Record<QuickFilter, FilterSpec> = {
  review: {
    icon: 'eye',
    label: () => t('prlFilterReview', 'Needs my review'),
    tooltip: () => t('prlFilterReviewTip', 'Only pull requests on this page that wait for your review'),
    counted: true,
  },
  ready: {
    icon: 'check-circle',
    label: () => t('prlFilterReady', 'Ready to merge'),
    tooltip: () => t('prlFilterReadyTip', 'Only pull requests on this page that are approved, green and conflict-free'),
    counted: true,
  },
  conflicts: {
    icon: 'alert',
    label: () => t('prlFilterConflicts', 'Conflicts'),
    tooltip: () => t('prlFilterConflictsTip', 'Only pull requests on this page with merge conflicts'),
    counted: true,
  },
  stale: {
    icon: 'hourglass',
    label: () => t('prlFilterStale', 'Stale'),
    tooltip: () => t('prlFilterStaleTip', 'Only pull requests on this page without recent activity'),
    counted: true,
  },
  hideDrafts: {
    icon: 'git-pull-request-draft',
    label: () => t('prlFilterHideDrafts', 'Hide drafts'),
    tooltip: () => t('prlFilterHideDraftsTip', 'Hide draft pull requests on this page'),
    counted: false,
  },
};

export interface FilterBarOptions {
  signal: AbortSignal;
  /** Server-side "review requested" search (all pages). */
  reviewQueueHref: string;
  onChange(active: ReadonlySet<QuickFilter>): void;
}

export interface FilterBarState {
  counts: FilterCounts;
  /** Rows with data. */
  loaded: number;
  /** PR rows on the page. */
  total: number;
  /** Rows still visible with the active filters. */
  visible: number;
  busy: boolean;
  staleEnabled: boolean;
}

export class FilterBar {
  readonly el: HTMLElement;
  /** Inline "No pull requests on this page match" row. */
  readonly empty: HTMLElement;
  private readonly status: HTMLElement;
  private readonly chips = new Map<QuickFilter, { btn: HTMLButtonElement; count: HTMLElement | null }>();
  private active = new Set<QuickFilter>();
  private last: FilterBarState | null = null;

  constructor(private readonly o: FilterBarOptions) {
    const onPage = t('prlFilterOnPage', 'on this page');
    const items: HTMLElement[] = [];
    for (const filter of QUICK_FILTERS) {
      const spec = SPECS[filter];
      const count = spec.counted ? h('span', { class: 'bghub-prl-filter-count', text: '0' }) : null;
      const btn = h(
        'button',
        { class: 'bghub-prl-filter', attrs: { type: 'button', 'aria-pressed': 'false' }, dataset: { filter } },
        icon(spec.icon, 12),
        h('span', { text: spec.label() }),
        count,
        spec.counted ? h('span', { class: 'bghub-sr-only', text: ` ${onPage}` }) : null
      );
      btn.addEventListener('click', () => this.toggle(filter));
      attachTooltip(btn, spec.tooltip, o.signal);
      this.chips.set(filter, { btn, count });
      items.push(btn);
      if (filter === 'review') {
        items.push(
          h(
            'a',
            {
              class: 'bghub-prl-filter-search',
              attrs: {
                href: o.reviewQueueHref,
                'aria-label': t('prlFilterSearchAllLabel', 'Search all pull requests that need your review'),
              },
            },
            t('prlFilterSearchAll', 'search all'),
            icon('link-external', 12)
          )
        );
      }
    }
    this.status = h('span', { class: 'bghub-sr-only', attrs: { role: 'status', 'aria-live': 'polite' } });
    this.el = h(
      'div',
      {
        class: 'bghub-prl-filters',
        attrs: { role: 'group', 'aria-label': t('prlFiltersLabel', 'Quick filters for this page'), hidden: true },
      },
      items,
      this.status
    );

    const clear = h('button', { class: 'bghub-prl-btn', attrs: { type: 'button' }, text: t('prlFilterClear', 'Clear filters') });
    clear.addEventListener('click', () => {
      this.setActive(new Set());
      this.chips.get('review')?.btn.focus();
    });
    this.empty = h(
      'div',
      { class: 'bghub-prl-empty', attrs: { hidden: true } },
      icon('filter', 16, 'bghub-prl-bar-icon'),
      h('span', { class: 'bghub-prl-bar-text', text: t('prlFilterEmpty', 'No pull requests on this page match') }),
      clear
    );
  }

  get activeFilters(): ReadonlySet<QuickFilter> {
    return this.active;
  }

  private toggle(filter: QuickFilter): void {
    this.setActive(toggleFilter(this.active, filter));
  }

  private setActive(next: Set<QuickFilter>): void {
    this.active = next;
    for (const [filter, { btn }] of this.chips) btn.setAttribute('aria-pressed', String(next.has(filter)));
    this.o.onChange(next);
    // onChange rescans synchronously → `last` is fresh.
    const s = this.last;
    if (!s) return;
    this.status.textContent = next.size
      ? t('prlFilterResult', '$1 of $2 shown', [formatNumber(s.visible), formatNumber(s.total)])
      : t('prlFiltersCleared', 'Filters cleared');
  }

  update(s: FilterBarState): void {
    this.last = s;
    this.el.hidden = s.loaded === 0 && this.active.size === 0;
    for (const [filter, { btn, count }] of this.chips) {
      if (count) {
        const text = formatNumber(s.counts[filter]);
        if (count.textContent !== text) count.textContent = text;
      }
      if (filter === 'stale') btn.hidden = !s.staleEnabled && !this.active.has('stale');
    }
    this.empty.hidden = !(this.active.size > 0 && s.visible === 0 && !s.busy);
  }
}
