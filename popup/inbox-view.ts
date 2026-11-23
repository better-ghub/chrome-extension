// Better GHub - Popup inbox: tabs, PR rows, skeleton, empty and error states.

import { h } from '../src/core/dom';
import { icon, type IconName } from '../src/core/icons';
import type { Inbox, InboxItem } from '../src/core/messages';
import { t } from '../src/i18n';
import { checksTabUrl, loadChecks, type ChecksSummary } from '../src/core/checks-model';
import { announce, avatar, btnLabel, stagger, toast, uid } from '../src/pages/dom-ui';
import { request, TIMEOUT } from '../src/pages/bg';
import { absoluteTime, plural, relativeTime, relativeTimeLong } from '../src/pages/format';
import {
  activityTime,
  compactCount,
  diffLabel,
  groupInbox,
  isSnoozed,
  itemStatuses,
  markSeen,
  pickTab,
  snoozedItems,
  unseenIn,
  visibleTabs,
  withPin,
  withSnooze,
  type InboxGroups,
  type InboxTab,
  type StatusDescriptor,
} from '../src/pages/inbox';
import { attachMenu, isMenuOpen, whenMenuClosed, type MenuItem } from '../src/pages/menu';
import { pageIcon } from '../src/pages/page-icons';
import { SNOOZE_OPTIONS, snoozedUntilText, snoozeOptionLabel, snoozeUntil } from '../src/pages/snooze';

export interface InboxViewHandlers {
  /** Open a PR. `background` = keep the popup open (Ctrl/⌘/middle click). */
  onOpen(item: InboxItem, background: boolean): void;
  /** Open a GitHub link (failed check details). `background` = keep the popup open. */
  onOpenUrl?(url: string, background: boolean): void;
  onMarkAllSeen(): void;
  onRetry(): void;
  onTabChange(tab: InboxTab): void;
  /** Pin / unpin. Resolves to the fresh inbox, or null when it failed (the view rolls back). */
  pin(url: string, pinned: boolean): Promise<Inbox | null>;
  /** Snooze until an ISO time (null = unsnooze). Resolves like `pin`. */
  snooze(url: string, until: string | null): Promise<Inbox | null>;
}

type FocusPart = 'row' | 'actions' | 'wake' | 'snoozed-link';

const GITHUB_LISTS: Record<InboxTab, string> = {
  review: 'https://github.com/pulls/review-requested',
  authored: 'https://github.com/pulls',
  assigned: 'https://github.com/pulls/assigned',
};

function tabLabel(tab: InboxTab): string {
  switch (tab) {
    case 'review':
      return t('inboxTabReview', 'Review requests');
    case 'authored':
      return t('inboxTabAuthored', 'Your PRs');
    case 'assigned':
      return t('inboxTabAssigned', 'Assigned');
  }
}

function emptyState(tab: InboxTab): HTMLElement {
  const copy: Record<InboxTab, { icon: IconName; title: string; body: string }> = {
    review: {
      icon: 'code-review',
      title: t('inboxEmptyReviewTitle', 'You’re all caught up'),
      body: t('inboxEmptyReviewBody', 'No one is waiting on your review. New requests show up here.'),
    },
    authored: {
      icon: 'git-pull-request',
      title: t('inboxEmptyAuthoredTitle', 'No open pull requests'),
      body: t('inboxEmptyAuthoredBody', 'Pull requests you open appear here with their checks, reviews and threads.'),
    },
    assigned: {
      icon: 'person',
      title: t('inboxEmptyAssignedTitle', 'Nothing assigned to you'),
      body: t('inboxEmptyAssignedBody', 'Pull requests assigned to you will appear here.'),
    },
  };
  const c = copy[tab];
  return h(
    'div',
    { class: 'empty' },
    h('div', { class: 'empty-icon', dataset: { tone: tab === 'review' ? 'success' : 'brand' } }, icon(c.icon, 24)),
    h('p', { class: 'empty-title', text: c.title }),
    h('p', { class: 'empty-body', text: c.body })
  );
}

function skeletonRows(count = 4): HTMLElement {
  const rows: HTMLElement[] = [];
  for (let i = 0; i < count; i += 1) {
    rows.push(
      h(
        'div',
        { class: 'pr-skeleton' },
        h('span', { class: 'skeleton pr-skeleton-icon' }),
        h(
          'span',
          { class: 'pr-skeleton-lines' },
          h('span', { class: 'skeleton', style: { width: '42%', height: '10px' } }),
          h('span', { class: 'skeleton', style: { width: i % 2 ? '70%' : '88%', height: '12px' } }),
          h('span', { class: 'skeleton', style: { width: '30%', height: '10px' } })
        )
      )
    );
  }
  return h('div', { class: 'pr-skeletons', attrs: { 'aria-hidden': 'true' } }, rows);
}

function statusNode(s: StatusDescriptor): HTMLElement {
  if (s.text) {
    return h(
      'span',
      { class: `badge pr-badge${s.tone === 'muted' ? '' : ` badge-${s.tone}`}`, dataset: { status: s.id } },
      s.icon ? icon(s.icon, 12) : null,
      h('span', { text: s.text })
    );
  }
  return h(
    'span',
    {
      class: `pr-status-icon tone-${s.tone}`,
      dataset: { status: s.id },
      attrs: { role: 'img', 'aria-label': s.label, 'data-tooltip': s.label },
    },
    s.icon ? icon(s.icon, 14) : null
  );
}

function activityText(item: InboxItem, tab: InboxTab): string | null {
  const a = item.lastActivity;
  if (a?.actor) {
    if (a.kind === 'commit') return t('inboxActivityCommit', '$1 pushed', a.actor);
    if (a.kind === 'review') return t('inboxActivityReview', '$1 reviewed', a.actor);
    return t('inboxActivityComment', '$1 commented', a.actor);
  }
  if (tab !== 'authored' && item.author) return t('inboxByAuthor', 'by $1', item.author);
  return null;
}

export class InboxView {
  readonly el: HTMLElement;
  private readonly tablist: HTMLElement;
  private readonly toolbar: HTMLElement;
  private readonly updated: HTMLElement;
  private readonly markAll: HTMLButtonElement;
  private readonly panel: HTMLElement;
  private readonly panelId = uid('inbox-panel');
  private items: InboxItem[] = [];
  /** Inbox that arrived while an action menu was open (applied when it closes). */
  private pendingInbox: Inbox | null = null;
  private groups: InboxGroups = { review: [], authored: [], assigned: [] };
  private tab: InboxTab;
  private fetchedAt = 0;
  private hasData = false;
  private snoozedOpen = false;
  /** PR urls whose failed-checks disclosure is open (survives re-renders). */
  private checksOpen = new Set<string>();
  private clock: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly handlers: InboxViewHandlers,
    private readonly preferredTab: string | null
  ) {
    this.tab = 'review';
    this.tablist = h('div', {
      class: 'segmented inbox-tabs',
      attrs: { role: 'tablist', 'aria-label': t('inboxTabsLabel', 'Pull request inbox') },
    });
    this.tablist.addEventListener('keydown', (e) => this.onTabKeydown(e));

    this.updated = h('span', { class: 'inbox-updated' });
    this.markAll = h(
      'button',
      { class: 'btn-link', attrs: { type: 'button', hidden: true } },
      icon('check', 14),
      btnLabel(t('inboxMarkAllRead', 'Mark all as read'))
    );
    this.markAll.addEventListener('click', () => this.handlers.onMarkAllSeen());
    this.toolbar = h('div', { class: 'inbox-toolbar' }, this.updated, this.markAll);

    this.panel = h('div', {
      class: 'inbox-panel scroll-area',
      attrs: { id: this.panelId, role: 'tabpanel', tabindex: '-1' },
    });
    this.panel.addEventListener('keydown', (e) => this.onListKeydown(e));

    this.el = h(
      'section',
      { class: 'inbox', attrs: { 'aria-labelledby': `${this.panelId}-title` } },
      h('h2', { class: 'sr-only', attrs: { id: `${this.panelId}-title` }, text: t('inboxTitle', 'Inbox') }),
      h('div', { class: 'inbox-head' }, this.tablist, this.toolbar),
      this.panel
    );
    this.renderTabs();
    this.showLoading();
    // Keep "updated 2 min ago" honest while the popup stays open.
    this.clock = setInterval(() => this.renderUpdated(), 30_000);
  }

  destroy(): void {
    clearInterval(this.clock);
  }

  get currentTab(): InboxTab {
    return this.tab;
  }

  /** Skeleton only on first load; later refreshes keep the current list. */
  showLoading(): void {
    if (this.hasData) return;
    this.panel.setAttribute('aria-busy', 'true');
    this.panel.replaceChildren(skeletonRows());
    this.updated.textContent = t('inboxLoading', 'Loading pull requests…');
  }

  setRefreshing(refreshing: boolean): void {
    this.el.classList.toggle('is-refreshing', refreshing);
    if (refreshing && this.hasData) this.updated.textContent = t('inboxRefreshing', 'Refreshing…');
    else if (!refreshing) this.renderUpdated();
  }

  setInbox(inbox: Inbox): void {
    // A background refresh landing while a row's action menu is open would
    // re-render the list and destroy the menu under the user's pointer.
    if (isMenuOpen()) {
      const firstWait = this.pendingInbox === null;
      this.pendingInbox = inbox;
      if (firstWait) {
        whenMenuClosed(() => {
          const next = this.pendingInbox;
          this.pendingInbox = null;
          if (next) this.setInbox(next);
        });
      }
      return;
    }
    const first = !this.hasData;
    this.items = inbox.items;
    this.fetchedAt = inbox.fetchedAt;
    this.regroup(first);
  }

  private regroup(first: boolean): void {
    this.groups = groupInbox(this.items);
    if (first) this.tab = pickTab(this.groups, this.preferredTab);
    else if (!visibleTabs(this.groups).includes(this.tab)) this.tab = pickTab(this.groups, null);
    this.hasData = true;
    this.panel.removeAttribute('aria-busy');
    this.renderTabs();
    this.renderPanel(first);
    this.renderUpdated();
  }

  /** Inline error: full state when there is nothing to show, otherwise a banner above the list. */
  showError(message: string): void {
    this.panel.removeAttribute('aria-busy');
    if (!this.hasData || this.items.length === 0) {
      const retry = h('button', { class: 'btn btn-sm', attrs: { type: 'button' } }, icon('sync', 14), t('commonRetry', 'Try again'));
      retry.addEventListener('click', () => this.handlers.onRetry());
      this.panel.replaceChildren(
        h(
          'div',
          { class: 'empty', attrs: { role: 'alert' } },
          h('div', { class: 'empty-icon', dataset: { tone: 'danger' } }, icon('alert', 24)),
          h('p', { class: 'empty-title', text: t('inboxErrorTitle', 'Couldn’t load your inbox') }),
          h('p', { class: 'empty-body', text: message }),
          retry
        )
      );
      this.updated.textContent = '';
      return;
    }
    this.panel.querySelector('.inbox-error')?.remove();
    const retry = h('button', { class: 'btn-link', attrs: { type: 'button' } }, t('commonRetry', 'Try again'));
    retry.addEventListener('click', () => this.handlers.onRetry());
    this.panel.prepend(
      h(
        'div',
        { class: 'notice notice-danger inbox-error', attrs: { role: 'alert' } },
        icon('alert', 16),
        h('span', { class: 'inbox-error-text', text: message }),
        retry
      )
    );
  }

  /** Local "seen" update (after opening a PR or "Mark all as read"). */
  markSeen(urls?: string[]): void {
    this.items = markSeen(this.items, urls);
    this.groups = groupInbox(this.items);
    const set = urls ? new Set(urls) : null;
    this.panel.querySelectorAll<HTMLAnchorElement>('.pr-row.is-unseen').forEach((row) => {
      if (!set || set.has(row.dataset.url ?? '')) {
        row.classList.remove('is-unseen');
        row.querySelector('.pr-title > .sr-only')?.remove();
      }
    });
    this.renderTabs();
    this.renderToolbar();
  }

  get unseenCount(): number {
    return unseenIn(this.activeItems());
  }

  /** Items that are not snoozed (what the tabs and the badge count). */
  private activeItems(): InboxItem[] {
    const now = Date.now();
    return this.items.filter((i) => !isSnoozed(i, now));
  }

  // ------------------------------------------------- pin / snooze actions

  private menuItems(item: InboxItem): MenuItem[] {
    return [
      {
        label: item.pinned ? t('inboxUnpin', 'Unpin') : t('inboxPin', 'Pin to top'),
        icon: pageIcon('pin', 16),
        onSelect: () => void this.pin(item, !item.pinned),
      },
      ...SNOOZE_OPTIONS.map((option) => ({
        label: snoozeOptionLabel(option),
        icon: icon('clock', 16),
        onSelect: () => void this.snooze(item, snoozeUntil(option).toISOString()),
      })),
    ];
  }

  private async pin(item: InboxItem, pinned: boolean): Promise<void> {
    await this.optimistic(
      withPin(this.items, item.url, pinned),
      () => this.handlers.pin(item.url, pinned),
      pinned ? t('inboxPinnedAnnounce', 'Pinned to the top') : t('inboxUnpinnedAnnounce', 'Unpinned'),
      t('inboxPinFailed', 'Couldn’t update the pin. Try again.'),
      () => this.focusPart(item.url, 'actions')
    );
  }

  /** `until` = null brings a snoozed PR back. */
  private async snooze(item: InboxItem, until: string | null): Promise<void> {
    const index = this.rows().findIndex((r) => r.dataset.url === item.url);
    const focusAfter = (): void => {
      if (until) {
        // The row left the list: focus the one that took its place.
        const rows = this.rows();
        const next = rows[Math.min(Math.max(index, 0), rows.length - 1)];
        if (next) {
          this.setRoving(next);
          next.focus({ preventScroll: true });
        } else {
          this.tablist.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
        }
      } else if (!this.focusPart(item.url, 'row') && !this.focusPart(item.url, 'wake')) {
        this.panel.querySelector<HTMLElement>('.inbox-snoozed > summary')?.focus();
      }
    };
    await this.optimistic(
      withSnooze(this.items, item.url, until),
      () => this.handlers.snooze(item.url, until),
      until
        ? t('inboxSnoozedAnnounce', 'Snoozed $1', snoozedUntilText(until))
        : t('inboxUnsnoozedAnnounce', 'Back in your inbox'),
      until ? t('inboxSnoozeFailed', 'Couldn’t snooze the pull request. Try again.') : t('inboxUnsnoozeFailed', 'Couldn’t unsnooze the pull request. Try again.'),
      focusAfter
    );
  }

  /** Apply `next` right away; roll back to the previous items when the background fails. */
  private async optimistic(
    next: InboxItem[],
    send: () => Promise<Inbox | null>,
    success: string,
    failure: string,
    focusAfter: () => void
  ): Promise<void> {
    const before = this.items;
    this.items = next;
    this.regroup(false);
    focusAfter();
    const fresh = await send();
    if (!this.el.isConnected) return;
    if (!fresh) {
      this.items = before;
      this.regroup(false);
      toast(failure, 'danger');
      return;
    }
    this.setInbox(fresh);
    announce(success);
  }

  /** Focus a part of the row for `url`; false when it isn't rendered. */
  private focusPart(url: string, part: FocusPart): boolean {
    const el = [...this.panel.querySelectorAll<HTMLElement>(`[data-part="${part}"]`)].find((x) => x.dataset.url === url);
    if (!el) return false;
    if (part === 'row' || part === 'actions') {
      const row = el.closest('.pr-item')?.querySelector<HTMLElement>('.pr-row');
      if (row) this.setRoving(row);
    }
    el.focus({ preventScroll: true });
    el.scrollIntoView?.({ block: 'nearest' });
    return true;
  }

  private focusMemo(): { url: string; part: FocusPart } | null {
    const el = document.activeElement as HTMLElement | null;
    if (!el || !this.panel.contains(el) || !el.dataset.part || !el.dataset.url) return null;
    return { url: el.dataset.url, part: el.dataset.part as FocusPart };
  }

  // ------------------------------------------------------------- rendering

  private renderTabs(): void {
    const tabs = visibleTabs(this.groups);
    const nodes = tabs.map((tab) => {
      const selected = tab === this.tab;
      const unseen = unseenIn(this.groups[tab]);
      const btn = h(
        'button',
        {
          class: 'segmented-item inbox-tab',
          attrs: {
            type: 'button',
            role: 'tab',
            id: `${this.panelId}-${tab}`,
            'aria-selected': String(selected),
            'aria-controls': this.panelId,
            tabindex: selected ? '0' : '-1',
          },
          dataset: { tab },
        },
        h('span', { class: 'segmented-label', text: tabLabel(tab) }),
        this.hasData ? h('span', { class: 'counter', text: String(this.groups[tab].length) }) : null,
        unseen ? h('span', { class: 'dot inbox-tab-dot', attrs: { 'aria-hidden': 'true' } }) : null,
        unseen ? h('span', { class: 'sr-only', text: `, ${t('inboxTabUnseen', '$1 new', String(unseen))}` }) : null
      );
      btn.addEventListener('click', () => this.selectTab(tab));
      return btn;
    });
    const focused = this.tablist.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.tab : null;
    this.tablist.replaceChildren(...nodes);
    this.panel.setAttribute('aria-labelledby', `${this.panelId}-${this.tab}`);
    if (focused) this.tablist.querySelector<HTMLElement>(`[data-tab="${focused}"]`)?.focus();
  }

  private selectTab(tab: InboxTab, focus = false): void {
    if (tab === this.tab) return;
    this.tab = tab;
    this.handlers.onTabChange(tab);
    this.renderTabs();
    if (focus) this.tablist.querySelector<HTMLElement>(`[data-tab="${tab}"]`)?.focus();
    if (this.hasData) this.renderPanel(true);
  }

  private renderPanel(animate: boolean): void {
    const items = this.groups[this.tab];
    const snoozed = snoozedItems(this.items);
    this.renderToolbar();
    const memo = this.focusMemo();
    const children: Node[] = [];
    if (!items.length) {
      children.push(emptyState(this.tab));
    } else {
      const list = h('ul', { class: `pr-list list-reset${animate ? ' anim-stagger' : ''}`, attrs: { role: 'list' } });
      items.forEach((item, i) => {
        const row = this.renderRow(item, i === 0);
        const li = h(
          'li',
          { class: `pr-item${item.pinned ? ' is-pinned' : ''}`, dataset: { url: item.url } },
          row,
          this.renderActions(item, row, i === 0),
          this.renderChecks(item)
        );
        if (animate) stagger(li, i);
        list.appendChild(li);
      });
      const more = h(
        'a',
        { class: 'inbox-more', attrs: { href: GITHUB_LISTS[this.tab], target: '_blank', rel: 'noopener noreferrer' } },
        t('inboxViewAll', 'View all on GitHub'),
        icon('link-external', 12)
      );
      children.push(list, more);
    }
    if (snoozed.length) children.push(this.renderSnoozed(snoozed));
    const scrollTop = animate ? 0 : this.panel.scrollTop;
    this.panel.replaceChildren(...children);
    this.panel.scrollTop = scrollTop;
    if (memo) this.focusPart(memo.url, memo.part);
  }

  /** Kebab button opening the row's Pin / Snooze menu. */
  private renderActions(item: InboxItem, row: HTMLElement, tabbable: boolean): HTMLButtonElement {
    const ref = `${item.repo}#${item.number}`;
    const btn = h(
      'button',
      {
        class: 'btn btn-ghost btn-icon btn-sm pr-actions',
        attrs: { type: 'button', tabindex: tabbable ? '0' : '-1', 'aria-label': t('inboxActionsLabel', 'Actions for $1', ref) },
        dataset: { url: item.url, part: 'actions' },
      },
      pageIcon('kebab-horizontal', 16)
    );
    attachMenu(btn, () => this.menuItems(item), { label: t('inboxActionsMenu', 'Actions for $1', ref) });
    btn.addEventListener('focus', () => this.setRoving(row));
    return btn;
  }

  /** All items (including snoozed), for the daily summary. */
  get allItems(): readonly InboxItem[] {
    return this.items;
  }

  /** "Failed checks" disclosure under a row whose checks fail; the jobs load on first open. */
  private renderChecks(item: InboxItem): HTMLElement | null {
    if (item.checks !== 'FAILURE' && item.checks !== 'ERROR') return null;
    const body = h('div', { class: 'disclosure-body pr-checks-body' });
    const details = h(
      'details',
      { class: 'disclosure pr-checks', dataset: { url: item.url } },
      h('summary', null, icon('chevron-right', 12), h('span', { text: t('inboxFailedChecks', 'Failed checks') })),
      body
    );
    const fill = (): void => {
      body.replaceChildren(h('span', { text: t('checksLoading', 'Loading checks…') }));
      void loadChecks(item.url, (query, variables, owner) =>
        request('api:graphql', { query, variables, owner }, { ok: false, error: 'unavailable' }, TIMEOUT.quick)
      ).then((summary) => {
        if (details.isConnected || details.open) body.replaceChildren(this.checksList(item, summary));
      });
    };
    details.addEventListener('toggle', () => {
      if (details.open) {
        this.checksOpen.add(item.url);
        fill();
      } else {
        this.checksOpen.delete(item.url);
      }
    });
    if (this.checksOpen.has(item.url)) details.open = true;
    return details;
  }

  private checksList(item: InboxItem, summary: ChecksSummary | null): Node {
    const tab = checksTabUrl(item.url);
    const link = (href: string, ...kids: (Node | string | null)[]): HTMLAnchorElement => {
      const a = h('a', { class: 'pr-checks-link', attrs: { href } }, ...kids);
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const background = e.metaKey || e.ctrlKey || e.shiftKey;
        if (this.handlers.onOpenUrl) this.handlers.onOpenUrl(href, background);
        else window.open(href, '_blank', 'noopener,noreferrer');
      });
      return a;
    };
    const all = link(tab, t('checksOpenTab', 'Open Checks tab'), icon('link-external', 12));
    if (!summary) return h('div', { class: 'pr-checks-list' }, h('span', { text: t('checksLoadFailed', 'Couldn’t load check details.') }), all);
    if (!summary.failed.length) return h('div', { class: 'pr-checks-list' }, h('span', { text: t('checksNoneFailed', 'No failed checks found. They may have been re-run.') }), all);
    const shown = summary.failed.slice(0, 8);
    const rest = summary.failed.length - shown.length;
    return h(
      'div',
      { class: 'pr-checks-list' },
      h('strong', { text: plural('checksFailedCount', summary.failed.length, { one: '$1 failed check', other: '$1 failed checks' }) }),
      h(
        'ul',
        { class: 'list-reset pr-checks-items', attrs: { role: 'list' } },
        shown.map((job) =>
          h(
            'li',
            { class: 'pr-checks-item' },
            icon('x-circle-fill', 14, 'pr-checks-icon'),
            link(job.url ?? tab, job.workflow ? h('span', { class: 'pr-checks-workflow', text: `${job.workflow} / ` }) : null, h('span', { text: job.name }))
          )
        )
      ),
      rest > 0 ? h('span', { text: t('checksMore', '+$1 more', String(rest)) }) : null,
      all
    );
  }

  /** Collapsible "Snoozed (n)" list with "until …" and Unsnooze. */
  private renderSnoozed(items: InboxItem[]): HTMLElement {
    const now = new Date();
    const list = h(
      'ul',
      { class: 'snoozed-list list-reset', attrs: { role: 'list' } },
      items.map((item) => {
        const link = h(
          'a',
          {
            class: 'snoozed-link',
            attrs: { href: item.url },
            dataset: { url: item.url, part: 'snoozed-link' },
          },
          h('span', { class: 'snoozed-title', text: item.title }),
          h(
            'span',
            { class: 'snoozed-meta' },
            h('span', { class: 'pr-repo', text: `${item.repo} #${item.number}` }),
            h('span', { class: 'snoozed-until' }, icon('clock', 12), snoozedUntilText(item.snoozedUntil, now))
          )
        );
        link.addEventListener('click', (e) => {
          e.preventDefault();
          this.handlers.onOpen(item, e.metaKey || e.ctrlKey || e.shiftKey);
        });
        const wake = h(
          'button',
          {
            class: 'btn btn-sm snoozed-wake',
            attrs: { type: 'button', 'aria-label': t('inboxUnsnoozeLabel', 'Unsnooze $1', `${item.repo}#${item.number}`) },
            dataset: { url: item.url, part: 'wake' },
          },
          t('inboxUnsnooze', 'Unsnooze')
        );
        wake.addEventListener('click', () => void this.snooze(item, null));
        return h('li', { class: 'snoozed-item', dataset: { url: item.url } }, link, wake);
      })
    );
    const details = h(
      'details',
      { class: 'disclosure inbox-snoozed' },
      h(
        'summary',
        null,
        icon('chevron-right', 12),
        h('span', { text: t('inboxSnoozedTitle', 'Snoozed ($1)', String(items.length)) })
      ),
      h('div', { class: 'disclosure-body' }, list)
    );
    details.open = this.snoozedOpen;
    details.addEventListener('toggle', () => {
      this.snoozedOpen = details.open;
    });
    return details;
  }

  private renderRow(item: InboxItem, tabbable: boolean): HTMLAnchorElement {
    // Same timestamp the list is sorted by (latest of update / activity / review request).
    const latest = activityTime(item);
    const time = latest ? new Date(latest).toISOString() : item.updatedAt;
    const titleId = uid('pr-title');
    const topId = uid('pr-top');
    const statusId = uid('pr-status');
    const statuses = itemStatuses(item, this.tab);
    const activity = activityText(item, this.tab);
    const hasDiff = item.additions > 0 || item.deletions > 0;

    const row = h(
      'a',
      {
        class: `pr-row${item.unseen ? ' is-unseen' : ''}${item.isDraft ? ' is-draft' : ''}`,
        attrs: {
          href: item.url,
          tabindex: tabbable ? '0' : '-1',
          'aria-labelledby': titleId,
          'aria-describedby': `${topId} ${statusId}`,
        },
        dataset: { url: item.url, part: 'row' },
      },
      h('span', { class: 'pr-unseen', attrs: { 'aria-hidden': 'true' } }),
      this.tab !== 'authored' && item.authorAvatarUrl
        ? h('span', { class: 'pr-lead' }, avatar(item.authorAvatarUrl, 20, 'pr-avatar'))
        : h(
            'span',
            { class: `pr-lead pr-state${item.isDraft ? ' is-draft' : ''}`, attrs: { 'aria-hidden': 'true' } },
            icon(item.isDraft ? 'git-pull-request-draft' : 'git-pull-request', 16)
          ),
      h(
        'span',
        { class: 'pr-body' },
        h(
          'span',
          { class: 'pr-top', attrs: { id: topId } },
          h(
            'span',
            { class: 'pr-ref' },
            item.pinned ? pageIcon('pin', 12, 'pr-pin') : null,
            item.pinned ? h('span', { class: 'sr-only', text: `${t('inboxPinnedLabel', 'Pinned')}: ` }) : null,
            h('span', { class: 'pr-repo', text: item.repo }),
            h('span', { class: 'pr-number', text: ` #${item.number}` })
          ),
          h('time', {
            class: 'pr-time',
            attrs: { datetime: time, title: absoluteTime(time), 'aria-label': relativeTimeLong(time) },
            text: relativeTime(time),
          })
        ),
        h(
          'span',
          { class: 'pr-title', attrs: { id: titleId } },
          item.unseen ? h('span', { class: 'sr-only', text: `${t('inboxNew', 'New')}: ` }) : null,
          item.title
        ),
        h(
          'span',
          { class: 'pr-bottom', attrs: { id: statusId } },
          statuses.map(statusNode),
          activity ? h('span', { class: 'pr-activity', text: activity }) : null,
          hasDiff
            ? h(
                'span',
                { class: 'pr-diff tabular', attrs: { role: 'img', 'aria-label': diffLabel(item) } },
                h('span', { class: 'pr-add', text: `+${compactCount(item.additions)}` }),
                h('span', { class: 'pr-del', text: `−${compactCount(item.deletions)}` })
              )
            : null
        )
      )
    );

    row.addEventListener('click', (e) => {
      e.preventDefault();
      this.handlers.onOpen(item, e.metaKey || e.ctrlKey || e.shiftKey);
    });
    row.addEventListener('auxclick', (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      this.handlers.onOpen(item, true);
    });
    row.addEventListener('focus', () => this.setRoving(row));
    return row;
  }

  private renderToolbar(): void {
    this.markAll.hidden = this.unseenCount === 0;
  }

  private renderUpdated(): void {
    if (!this.hasData) return;
    if (this.el.classList.contains('is-refreshing')) return;
    const newest = this.items.reduce((max, i) => Math.max(max, activityTime(i)), 0);
    const at = this.fetchedAt || newest;
    this.updated.textContent = at ? t('inboxUpdated', 'Updated $1', relativeTimeLong(at)) : '';
  }

  // ------------------------------------------------------------- keyboard

  private rows(): HTMLAnchorElement[] {
    return [...this.panel.querySelectorAll<HTMLAnchorElement>('.pr-row')];
  }

  /** One row (and its actions button) is in the tab order at a time. */
  private setRoving(active: HTMLElement): void {
    for (const r of this.rows()) {
      const on = r === active;
      r.tabIndex = on ? 0 : -1;
      const actions = r.parentElement?.querySelector<HTMLElement>('.pr-actions');
      if (actions) actions.tabIndex = on ? 0 : -1;
    }
  }

  private onListKeydown(e: KeyboardEvent): void {
    const rows = this.rows();
    const focused = (document.activeElement as HTMLElement | null)?.closest('.pr-item')?.querySelector<HTMLAnchorElement>('.pr-row');
    const index = focused ? rows.indexOf(focused) : -1;
    if (index < 0) return;
    // Shift+F10 / the context-menu key open the row's actions.
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      rows[index].parentElement?.querySelector<HTMLButtonElement>('.pr-actions')?.click();
      return;
    }
    let next = -1;
    if (e.key === 'ArrowDown') next = Math.min(rows.length - 1, index + 1);
    else if (e.key === 'ArrowUp') next = Math.max(0, index - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = rows.length - 1;
    if (next < 0) return;
    e.preventDefault();
    rows[next].focus();
  }

  private onTabKeydown(e: KeyboardEvent): void {
    const tabs = visibleTabs(this.groups);
    const index = tabs.indexOf(this.tab);
    let next: InboxTab | undefined;
    if (e.key === 'ArrowRight') next = tabs[(index + 1) % tabs.length];
    else if (e.key === 'ArrowLeft') next = tabs[(index - 1 + tabs.length) % tabs.length];
    else if (e.key === 'Home') next = tabs[0];
    else if (e.key === 'End') next = tabs[tabs.length - 1];
    else if (e.key === 'ArrowDown') {
      // Jump straight into the list.
      const row = this.panel.querySelector<HTMLElement>('.pr-row[tabindex="0"]') ?? this.panel.querySelector<HTMLElement>('.pr-row');
      if (row) {
        e.preventDefault();
        row.focus();
      }
      return;
    }
    if (!next) return;
    e.preventDefault();
    this.selectTab(next, true);
  }
}
