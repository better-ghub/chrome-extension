// Better GHub - "Your pull requests" card (loading / list / empty / error).
// Data comes from the background inbox ('inbox:get'), shared with the popup,
// so the card adds no GitHub requests of its own while the inbox is fresh.

import { h, prefersReducedMotion } from '../../core/dom';
import { icon } from '../../core/icons';
import { sendToBackground, type Inbox } from '../../core/messages';
import { t } from '../../i18n';
import { formatNumber } from '../../ui/format';
import { pickDashboardItems } from './order';
import { renderRow, renderSkeletonRow } from './row';

const VIEW_ALL = '/pulls?q=is%3Apr+is%3Aopen+author%3A%40me';
const TITLE_ID = 'bghub-dash-title';

export class DashboardCard {
  readonly el: HTMLElement;
  private readonly counter: HTMLElement;
  private readonly body: HTMLElement;
  private loads = 0;
  /** Removed on purpose (no token): must not be re-inserted. */
  closed = false;

  constructor(private readonly signal: AbortSignal) {
    this.counter = h('span', { class: 'bghub-dash-counter', attrs: { hidden: true } });
    this.body = h('div', { class: 'bghub-dash-body' });
    this.el = h(
      'section',
      { class: 'bghub-dash', attrs: { 'aria-labelledby': TITLE_ID } },
      h(
        'header',
        { class: 'bghub-dash-header' },
        h('h2', { class: 'bghub-dash-heading', attrs: { id: TITLE_ID } }, t('dashTitle', 'Your pull requests'), this.counter),
        h('a', { class: 'bghub-dash-viewall', attrs: { href: VIEW_ALL }, text: t('dashViewAll', 'View all') })
      ),
      this.body
    );
    signal.addEventListener('abort', () => this.el.remove(), { once: true });
  }

  async load(force: boolean): Promise<void> {
    const generation = ++this.loads;
    this.renderLoading();
    const fallback: Inbox = { items: [], unseenCount: 0, fetchedAt: 0, error: 'unavailable' };
    const inbox = await sendToBackground('inbox:get', force ? { force: true } : {}, fallback);
    // A newer load (Retry) or an abort supersedes this one.
    if (this.signal.aborted || generation !== this.loads) return;
    if (inbox.needsAuth) {
      this.closed = true;
      this.el.remove();
      return;
    }
    if (inbox.error && !inbox.items.length) {
      this.renderError(inbox.error);
      return;
    }
    this.renderItems(inbox);
  }

  private renderLoading(): void {
    this.body.setAttribute('aria-busy', 'true');
    this.body.replaceChildren(
      h('span', { class: 'bghub-sr-only', attrs: { role: 'status' }, text: t('dashLoading', 'Loading pull requests…') }),
      h('ul', { class: 'bghub-dash-list' }, [0, 1, 2].map(renderSkeletonRow))
    );
  }

  private renderItems(inbox: Inbox): void {
    this.body.removeAttribute('aria-busy');
    this.counter.hidden = !inbox.items.length;
    this.counter.textContent = formatNumber(inbox.items.length);
    const items = pickDashboardItems(inbox.items);
    if (!items.length) {
      this.body.replaceChildren(
        h(
          'div',
          { class: 'bghub-dash-empty' },
          icon('git-pull-request', 24),
          h('p', { class: 'bghub-dash-empty-title', text: t('dashEmptyTitle', 'No open pull requests') }),
          h('p', { class: 'bghub-dash-empty-body', text: t('dashEmptyBody', 'Pull requests you opened or that wait for your review will show up here.') })
        )
      );
      return;
    }
    const markSeen = (url: string): void => {
      void sendToBackground('inbox:markSeen', { urls: [url] }, { ok: false, unseenCount: 0 });
    };
    const list = h('ul', { class: `bghub-dash-list${prefersReducedMotion() ? '' : ' bghub-dash-list--enter'}` }, items.map((i) => renderRow(i, markSeen)));
    this.body.replaceChildren(list);
  }

  private renderError(code: string): void {
    this.body.removeAttribute('aria-busy');
    const detail =
      code === 'rate-limited'
        ? t('dashErrorRateLimited', 'GitHub API rate limit reached. Try again in a few minutes.')
        : code === 'network'
          ? t('dashErrorNetwork', "GitHub couldn't be reached. Check your connection.")
          : t('dashErrorGeneric', 'Check your connection or your token in the extension settings.');
    this.body.replaceChildren(
      h(
        'div',
        { class: 'bghub-dash-error', attrs: { role: 'alert' } },
        icon('alert', 16, 'bghub-dash-error-icon'),
        h(
          'div',
          null,
          h('p', { class: 'bghub-dash-error-title', text: t('dashErrorTitle', "Couldn't load your pull requests") }),
          h('p', { class: 'bghub-dash-error-body', text: detail }),
          h(
            'div',
            { class: 'bghub-dash-actions' },
            h('button', { class: 'bghub-dash-btn', attrs: { type: 'button' }, text: t('dashRetry', 'Retry'), on: { click: () => void this.load(true) } }),
            h('button', {
              class: 'bghub-dash-btn bghub-dash-btn--invisible',
              attrs: { type: 'button' },
              text: t('dashOpenSettings', 'Open settings'),
              on: { click: () => void sendToBackground('ui:openOptions', { section: 'account' }, { ok: false }) },
            })
          )
        )
      )
    );
  }
}
