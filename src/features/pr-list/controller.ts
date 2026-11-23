// Better GHub - PR list controller: idempotently projects loader state onto
// GitHub's (React-managed) rows. `scan()` is called on every relevant DOM
// mutation and must not touch the DOM when nothing changed.

import { h, prefersReducedMotion } from '../../core/dom';
import { sendToBackground } from '../../core/messages';
import { getLocale, t } from '../../i18n';
import { addTokenHash } from '../../pages/route';
import { summarize, type RowModel } from './analyze';
import { findList, findSlot, listRows, parseRow, SLOT_CLASS, type RowInfo } from './list-dom';
import { FilterBar } from './filter-bar';
import { filterCounts, rowVisible, type QuickFilter } from './filters';
import { RowLoader } from './loader';
import { pickListNotice, type ListNotice } from './notice';
import { renderChips, renderSkeleton } from './render';
import { TopBar } from './top-bar';

export const NOTICE_DISMISSED_KEY = 'prListNoticeDismissed';
const ACCENT_ATTR = 'data-bghub-accent';
/** Row hidden by a quick filter: 'leaving' while it fades out, '' once hidden. */
export const FILTERED_ATTR = 'data-bghub-filtered';
const FILTER_EXIT_MS = 120;

function hideRow(li: HTMLElement): void {
  if (li.hasAttribute(FILTERED_ATTR)) return;
  li.setAttribute('aria-hidden', 'true');
  if (prefersReducedMotion()) {
    li.setAttribute(FILTERED_ATTR, '');
    return;
  }
  li.setAttribute(FILTERED_ATTR, 'leaving');
  setTimeout(() => {
    if (li.getAttribute(FILTERED_ATTR) === 'leaving') li.setAttribute(FILTERED_ATTR, '');
  }, FILTER_EXIT_MS);
}

function showRow(li: HTMLElement): void {
  if (!li.hasAttribute(FILTERED_ATTR)) return;
  li.removeAttribute(FILTERED_ATTR);
  li.removeAttribute('aria-hidden');
}

function reviewQueueHref(owner: string, repo: string): string {
  return `/${owner}/${repo}/pulls?q=${encodeURIComponent('is:pr is:open review-requested:@me')}`;
}

export interface ControllerOptions {
  signal: AbortSignal;
  owner: string;
  repo: string;
  authenticated: boolean;
  noticeDismissed: boolean;
  viewer: string;
  withLabels: boolean;
  /** settings.staleDays (0 = never stale). */
  staleDays?: number;
}

interface Rendered {
  slot: HTMLElement;
  ctl: AbortController;
}

export class PRListController {
  private readonly loader: RowLoader;
  private readonly top: TopBar;
  private readonly filters: FilterBar;
  /** Per-row AbortController for tooltip listeners of the current chips. */
  private readonly rendered = new Map<string, Rendered>();
  private noticeDismissed: boolean;
  /** The "needs a token" / SSO notice was dismissed (this page view only). */
  private tokenNoticeDismissed = false;

  constructor(private readonly o: ControllerOptions) {
    this.noticeDismissed = o.noticeDismissed;
    this.top = new TopBar(o.signal);
    this.loader = new RowLoader({
      signal: o.signal,
      owner: o.owner,
      viewer: o.viewer,
      withLabels: o.withLabels,
      staleDays: o.staleDays,
      onUpdate: () => this.scan(),
    });
    this.filters = new FilterBar({
      signal: o.signal,
      reviewQueueHref: reviewQueueHref(o.owner, o.repo),
      onChange: () => this.scan(),
    });
    this.top.root.append(this.filters.el, this.filters.empty);
    o.signal.addEventListener('abort', () => this.destroy(), { once: true });
  }

  scan(): void {
    if (this.o.signal.aborted) return;
    const list = findList();
    if (!list) return;
    this.top.place(list);
    if (!this.o.authenticated) {
      this.renderNotice();
      return;
    }
    const models: RowModel[] = [];
    const active = this.filters.activeFilters;
    let total = 0;
    let visible = 0;
    for (const li of listRows(list)) {
      const info = parseRow(li);
      if (!info) continue;
      const model = this.applyRow(info);
      if (model) models.push(model);
      total++;
      if (rowVisible(model, active)) {
        visible++;
        showRow(li);
      } else {
        hideRow(li);
      }
    }
    for (const [key, r] of this.rendered) {
      if (!r.slot.isConnected) {
        r.ctl.abort();
        this.rendered.delete(key);
      }
    }
    this.renderTop(models);
    this.filters.update({
      counts: filterCounts(models),
      loaded: models.length,
      total,
      visible,
      busy: this.loader.busy(),
      staleEnabled: (this.o.staleDays ?? 0) > 0,
    });
  }

  /** Active quick filters (exposed for tests). */
  get activeFilters(): ReadonlySet<QuickFilter> {
    return this.filters.activeFilters;
  }

  private applyRow(info: RowInfo): RowModel | null {
    const { li, ref, anchor } = info;
    const state = this.loader.request(ref);
    let slot = findSlot(li);
    if (slot && slot.dataset.bghubPr !== ref.key) {
      slot.remove(); // React reused this <li> for another PR
      slot = null;
    }
    const model = state.status === 'ready' ? state.model : null;
    const accent = !!model?.review.viewerRequested;
    if (accent !== li.hasAttribute(ACCENT_ATTR)) li.toggleAttribute(ACCENT_ATTR, accent);

    if (state.status !== 'ready' && state.status !== 'loading') {
      slot?.remove();
      return null;
    }
    if (!slot) slot = h('div', { class: SLOT_CLASS, dataset: { bghubPr: ref.key } });
    if (slot.previousElementSibling !== anchor || !slot.isConnected) anchor.after(slot);
    if (slot.dataset.state === state.status) return model;

    if (!model) {
      slot.replaceChildren(renderSkeleton());
    } else {
      this.rendered.get(ref.key)?.ctl.abort();
      const ctl = new AbortController();
      this.rendered.set(ref.key, { slot, ctl });
      // Animate only the skeleton → data transition, not React re-inserts.
      const animate = slot.dataset.state === 'loading' && !prefersReducedMotion();
      slot.replaceChildren(...renderChips(model, { signal: ctl.signal, animate }));
    }
    slot.dataset.state = state.status;
    return model;
  }

  private renderNotice(): void {
    if (this.noticeDismissed) {
      this.top.clear();
      return;
    }
    this.top.notice(
      t('prlNoticeText', 'Connect a GitHub token to see review activity here.'),
      {
        label: t('prlNoticeConnect', 'Connect'),
        onClick: () => void sendToBackground('ui:openOptions', { section: 'account' }, { ok: false }),
      },
      () => {
        this.noticeDismissed = true;
        this.top.clear();
        void chrome.storage.local.set({ [NOTICE_DISMISSED_KEY]: true }).catch(() => undefined);
      }
    );
  }

  /** Current top-bar notice, if any (exposed for tests). */
  notice(models: RowModel[] = []): ListNotice | null {
    return pickListNotice({
      now: Date.now(),
      rateLimitedUntil: this.loader.rateLimitedUntil,
      ssoUrl: this.loader.ssoUrl,
      needsToken: this.loader.needsToken,
      accessError: this.loader.accessError,
      pageOwner: this.o.owner,
      hasModels: models.length > 0,
      busy: this.loader.busy(),
      tokenNoticeDismissed: this.tokenNoticeDismissed,
    });
  }

  private renderTop(models: RowModel[]): void {
    const busy = this.loader.busy();
    const notice = this.notice(models);
    const dismiss = (): void => {
      this.tokenNoticeDismissed = true;
      this.top.clear();
    };
    let status = busy ? t('prlLoading', 'Loading review activity…') : t('prlLoaded', 'Review activity loaded.');
    switch (notice?.kind) {
      case 'rate-limited': {
        const until = new Date(notice.until).toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' });
        this.top.message('stopwatch', t('prlRateLimited', 'GitHub API rate limit reached — activity paused until $1.', until));
        break;
      }
      case 'sso': {
        const label = t('prlAuthorizeSso', 'Authorize your token for $1 (SSO)', notice.owner);
        this.top.alert({ icon: 'shield-check', link: { label, href: notice.url }, onDismiss: dismiss });
        status = label;
        break;
      }
      case 'needs-token': {
        const text = t('prlNeedsToken', 'Private pull requests of $1 need a token for $1.', notice.owner);
        const owner = notice.owner;
        this.top.alert({
          icon: 'key',
          text,
          action: {
            label: t('prlAddToken', 'Add token'),
            onClick: () => void sendToBackground('ui:openOptions', { section: addTokenHash(owner) }, { ok: false }),
          },
          onDismiss: dismiss,
        });
        status = text;
        break;
      }
      case 'no-access':
        this.top.message('shield-check', t('prlNoAccess', "Your GitHub token can't read pull requests in this repository."), {
          label: t('prlOpenSettings', 'Settings'),
          onClick: () => void sendToBackground('ui:openOptions', { section: 'account' }, { ok: false }),
        });
        break;
      default:
        // No notice (or a dismissed one): the activity summary, once loaded.
        if (!busy) this.top.summary(summarize(models), reviewQueueHref(this.o.owner, this.o.repo));
    }
    this.top.announce(status);
  }

  private destroy(): void {
    for (const r of this.rendered.values()) r.ctl.abort();
    this.rendered.clear();
    document.querySelectorAll(`.${SLOT_CLASS}`).forEach((n) => n.remove());
    document.querySelectorAll(`[${ACCENT_ATTR}]`).forEach((n) => n.removeAttribute(ACCENT_ATTR));
    document.querySelectorAll<HTMLElement>(`[${FILTERED_ATTR}]`).forEach(showRow);
  }
}
